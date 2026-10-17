// Separação de faixas (voz, bateria, baixo, …) com o Demucs rodando num Python isolado.
// O motor só é instalado quando o usuário pede, dentro da pasta de dados do app.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')

const isWin = process.platform === 'win32'
const SCRIPT = path.join(__dirname, 'separate.py').replace('app.asar', 'app.asar.unpacked')
const DEMUCS_DEPS = ['numpy', 'soundfile', 'dora-search', 'einops', 'julius', 'openunmix', 'pyyaml', 'tqdm']

function exec(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, timeout: 20000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

class StemEngine {
  constructor(baseDir, ffmpeg) {
    this.dir = path.join(baseDir, 'separation')
    this.cacheDir = path.join(baseDir, 'stems')
    this.ffmpeg = ffmpeg
    this.proc = null
    this.canceled = false
  }

  get venvPython() {
    return path.join(this.dir, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python')
  }

  get marker() {
    return path.join(this.dir, 'installed.json')
  }

  async findPython() {
    const candidates = isWin ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]]
    for (const [bin, pre] of candidates) {
      try {
        const out = await exec(bin, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2]); print(sys.executable)'])
        const [ver, exe] = out.trim().split(/\r?\n/)
        const [major, minor] = ver.split('.').map(Number)
        if (major === 3 && minor >= 9) return { exe: exe.trim(), version: ver }
      } catch {
        // tenta o próximo
      }
    }
    return null
  }

  async hasNvidia() {
    try {
      await exec('nvidia-smi', ['-L'])
      return true
    } catch {
      return false
    }
  }

  async status() {
    let installed = null
    try {
      installed = JSON.parse(fs.readFileSync(this.marker, 'utf8'))
      if (!fs.existsSync(this.venvPython)) installed = null
    } catch {
      installed = null
    }
    const python = installed ? null : await this.findPython()
    return { installed: Boolean(installed), device: installed ? installed.device : null, python: python ? python.version : null, gpu: await this.hasNvidia(), dir: this.dir }
  }

  /** Roda um processo repassando cada linha de saída para `onLine`. */
  run(bin, args, onLine, env = {}) {
    if (this.canceled) return Promise.reject(new Error('Cancelado'))
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...env } })
      this.proc = proc
      let tail = ''
      const feed = (chunk, stream) => {
        const text = chunk.toString()
        tail = (tail + text).slice(-4000)
        for (const line of text.split(/[\r\n]+/)) if (line.trim()) onLine(line, stream)
      }
      proc.stdout.on('data', (c) => feed(c, 'out'))
      proc.stderr.on('data', (c) => feed(c, 'err'))
      proc.on('error', (err) => {
        this.proc = null
        reject(err)
      })
      proc.on('close', (code) => {
        this.proc = null
        if (code === 0) resolve()
        else reject(new Error(this.canceled ? 'Cancelado' : tail.slice(-1500) || `Processo saiu com código ${code}`))
      })
    })
  }

  /** Cria o ambiente Python e instala PyTorch + Demucs. `variant`: 'cuda' | 'cpu'. */
  async install(variant, onProgress) {
    this.canceled = false
    const python = await this.findPython()
    if (!python) throw new Error('Python 3.9 ou mais novo não foi encontrado. Instale em python.org e tente de novo.')
    fs.mkdirSync(this.dir, { recursive: true })
    fs.rmSync(this.marker, { force: true })
    const log = (stage, step) => (line) => onProgress({ stage, step, total: 5, line })
    const venvPy = this.venvPython
    const pip = (args, stage, step) => this.run(venvPy, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...args], log(stage, step))

    if (!fs.existsSync(venvPy)) await this.run(python.exe, ['-m', 'venv', path.join(this.dir, 'venv')], log('Criando ambiente Python', 1))
    const index = variant === 'cuda' ? 'https://download.pytorch.org/whl/cu126' : 'https://download.pytorch.org/whl/cpu'
    await pip(['torch', 'torchaudio', '--index-url', index], variant === 'cuda' ? 'Baixando PyTorch para GPU (~2,5 GB)' : 'Baixando PyTorch para CPU', 2)
    await pip(DEMUCS_DEPS, 'Instalando dependências', 3)
    // Sem dependências: evita o `lameenc` (codificador MP3 que não usamos e nem sempre tem pacote pronto).
    await pip(['--no-deps', 'demucs'], 'Instalando Demucs', 4)

    let cuda = 'False'
    await this.run(venvPy, ['-c', 'import torch, demucs.apply, demucs.pretrained; print(torch.cuda.is_available())'], (line, stream) => {
      if (stream === 'out') cuda = line.trim()
      log('Verificando instalação', 5)(line)
    })
    const device = cuda === 'True' ? 'cuda' : 'cpu'
    fs.writeFileSync(this.marker, JSON.stringify({ device, variant, at: Date.now() }))
    return { device }
  }

  /**
   * Separa o trecho [inPoint, inPoint + duration] de `filePath`.
   * Resultado em cache por arquivo + trecho + modelo.
   */
  async separate({ filePath, inPoint, duration, model, twoStems }, onProgress) {
    this.canceled = false
    if (!fs.existsSync(this.marker)) throw new Error('O motor de separação não está instalado')
    const stat = fs.statSync(filePath)
    const key = crypto
      .createHash('sha1')
      .update(JSON.stringify([filePath, stat.size, stat.mtimeMs, inPoint.toFixed(3), duration.toFixed(3), model, twoStems]))
      .digest('hex')
      .slice(0, 16)
    const outDir = path.join(this.cacheDir, key)
    const doneFile = path.join(outDir, 'stems.json')
    if (fs.existsSync(doneFile)) return JSON.parse(fs.readFileSync(doneFile, 'utf8'))

    fs.mkdirSync(outDir, { recursive: true })
    const input = path.join(outDir, 'input.wav')
    onProgress({ stage: 'decoding', text: 'Preparando o áudio…', progress: 0 })
    await this.run(this.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(inPoint), '-t', String(duration), '-i', filePath, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_f32le', input], () => {})

    let stems = null
    let failure = null
    await this.run(
      this.venvPython,
      [SCRIPT, '--input', input, '--out', outDir, '--model', model, ...(twoStems ? ['--two-stems'] : [])],
      (line, stream) => {
        if (stream === 'out' && line.startsWith('{')) {
          try {
            const msg = JSON.parse(line)
            if (msg.stage === 'done') stems = msg.stems
            else if (msg.stage === 'error') failure = msg.text
            else onProgress({ stage: msg.stage, text: msg.text, device: msg.device })
          } catch {
            // linha comum
          }
        } else if (stream === 'err') {
          // Barras do tqdm (separação) e do torch.hub (download do modelo).
          const m = /(\d{1,3})%\|/.exec(line)
          if (m) onProgress({ stage: 'progress', progress: Number(m[1]) / 100, download: /B\/s|MB|M\//.test(line) })
        }
      },
      { TORCH_HOME: path.join(this.dir, 'torch') },
    ).catch((err) => {
      throw new Error(failure || err.message)
    })
    if (!stems) throw new Error(failure || 'A separação terminou sem gerar faixas')
    fs.rmSync(input, { force: true })
    fs.writeFileSync(doneFile, JSON.stringify(stems))
    return stems
  }

  cancel() {
    this.canceled = true
    if (this.proc) this.proc.kill()
  }
}

module.exports = { StemEngine }
