// Ferramentas de áudio de estúdio: limpeza de voz (FFmpeg) e plugins VST3 (pedalboard num Python isolado).

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { StemEngine } = require('./stems.cjs')

const isWin = process.platform === 'win32'
const SCRIPT = path.join(__dirname, 'vst.py').replace('app.asar', 'app.asar.unpacked')

/** Cadeias de limpeza de voz por intensidade (redução de ruído adaptativa + corte de graves). */
const CLEAN = {
  light: { reduction: 8, floor: -40, highpass: 70, deep: 0, declick: false },
  medium: { reduction: 14, floor: -35, highpass: 80, deep: 0, declick: true },
  strong: { reduction: 24, floor: -30, highpass: 90, deep: 7, declick: true },
}

/**
 * Cadeia de limpeza do FFmpeg a partir dos ajustes:
 * reduction = dB tirados do ruído (afftdn), floor = nível do ruído de fundo (dB),
 * highpass = corte de graves (Hz, 0 = desligado), deep = força do redutor extra para
 * ruídos que variam (anlmdn, 0 = desligado), declick = remove estalos.
 */
function cleanFilter(o) {
  const parts = []
  if (o.highpass > 0) parts.push(`highpass=f=${Math.round(o.highpass)}`)
  if (o.reduction > 0) parts.push(`afftdn=nr=${Math.min(97, Math.max(0.01, o.reduction)).toFixed(1)}:nf=${Math.min(-20, Math.max(-80, o.floor)).toFixed(0)}:tn=1`)
  if (o.deep > 0) parts.push(`anlmdn=s=${Math.min(20, Math.max(1, o.deep)).toFixed(1)}:p=0.002:r=0.006`)
  if (o.declick) parts.push('adeclick')
  return parts.join(',') || 'anull'
}

class AudioTools {
  constructor(baseDir, ffmpeg) {
    this.dir = path.join(baseDir, 'audio-tools')
    this.out = path.join(baseDir, 'processed-audio')
    this.ffmpeg = ffmpeg
    // Reaproveita a busca do Python e o executor de processos do motor de separação.
    this.helper = new StemEngine(baseDir, ffmpeg)
  }

  get venvPython() {
    return path.join(this.dir, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python')
  }

  key(...parts) {
    return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
  }

  /** Extrai o trecho usado do clipe para WAV 48 kHz estéreo. */
  async extract(filePath, inPoint, duration, dest) {
    await this.helper.run(this.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', inPoint.toFixed(3), '-t', duration.toFixed(3), '-i', filePath, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s24le', dest], () => {})
  }

  /** Remove ruído de fundo da voz. Devolve o caminho do WAV limpo. */
  /** `level`: 'light' | 'medium' | 'strong' ou ajustes próprios ({ reduction, floor, highpass, deep, declick }). */
  async clean(filePath, inPoint, duration, level) {
    fs.mkdirSync(this.out, { recursive: true })
    const stat = fs.statSync(filePath)
    const opts = typeof level === 'string' ? CLEAN[level] || CLEAN.medium : { ...CLEAN.medium, ...level }
    const out = path.join(this.out, `clean-${this.key(filePath, stat.mtimeMs, inPoint, duration, JSON.stringify(opts))}.wav`)
    if (!fs.existsSync(out)) {
      await this.helper.run(
        this.ffmpeg,
        ['-y', '-hide_banner', '-loglevel', 'error', '-ss', inPoint.toFixed(3), '-t', duration.toFixed(3), '-i', filePath, '-vn', '-af', cleanFilter(opts), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s24le', out],
        () => {},
      )
    }
    return out
  }

  // ---------- VST3 ----------

  async status() {
    const installed = fs.existsSync(path.join(this.dir, 'installed.json')) && fs.existsSync(this.venvPython)
    const python = installed ? null : await this.helper.findPython()
    return { installed, python: python ? python.version : null }
  }

  async install(onProgress) {
    const python = await this.helper.findPython()
    if (!python) throw new Error('Python 3.9 ou mais novo não foi encontrado. Instale em python.org e tente de novo.')
    fs.mkdirSync(this.dir, { recursive: true })
    const log = (stage) => (line) => onProgress({ stage, line })
    if (!fs.existsSync(this.venvPython)) await this.helper.run(python.exe, ['-m', 'venv', path.join(this.dir, 'venv')], log('Criando ambiente Python'))
    await this.helper.run(this.venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', 'pedalboard', 'numpy'], log('Instalando o pedalboard'))
    await this.helper.run(this.venvPython, ['-c', 'import pedalboard; print(pedalboard.__version__)'], log('Verificando'))
    fs.writeFileSync(path.join(this.dir, 'installed.json'), JSON.stringify({ at: Date.now() }))
    return this.status()
  }

  /** Procura plugins VST3 nas pastas padrão do sistema. */
  scan() {
    const roots = isWin
      ? [
          path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'VST3'),
          path.join(process.env['CommonProgramFiles(x86)'] || 'C:\\Program Files (x86)\\Common Files', 'VST3'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Common', 'VST3'),
        ]
      : ['/Library/Audio/Plug-Ins/VST3', path.join(process.env.HOME || '', 'Library/Audio/Plug-Ins/VST3'), '/usr/lib/vst3', path.join(process.env.HOME || '', '.vst3')]
    const found = []
    const walk = (dir, depth) => {
      let entries = []
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.name.toLowerCase().endsWith('.vst3')) found.push({ name: e.name.replace(/\.vst3$/i, ''), path: full, vendor: path.basename(path.dirname(full)) })
        else if (e.isDirectory() && depth < 4) walk(full, depth + 1)
      }
    }
    for (const r of roots) walk(r, 0)
    const seen = new Set()
    return found.filter((p) => (seen.has(p.path) ? false : seen.add(p.path))).sort((a, b) => a.name.localeCompare(b.name))
  }

  async py(args) {
    let result = null
    let err = null
    await this.helper
      .run(this.venvPython, [SCRIPT, ...args], (line, stream) => {
        if (stream !== 'out' || !line.startsWith('{')) return
        try {
          const msg = JSON.parse(line)
          if (msg.error) err = msg.error
          else result = msg
        } catch {
          // linha comum
        }
      })
      .catch((e) => {
        throw new Error(err || e.message)
      })
    if (err) throw new Error(err)
    return result
  }

  /** Abre a interface do plugin (janela nativa) e devolve o estado ao fechar. */
  editor(pluginPath, state) {
    return this.py(['editor', '--plugin', pluginPath, ...(state ? ['--state', state] : [])])
  }

  /** Processa o trecho usado do clipe pelo plugin. Devolve o caminho do WAV. */
  async apply(filePath, inPoint, duration, pluginPath, state) {
    fs.mkdirSync(this.out, { recursive: true })
    const id = this.key(filePath, inPoint, duration, pluginPath, state, Date.now())
    const input = path.join(this.out, `vst-in-${id}.wav`)
    const out = path.join(this.out, `vst-${id}.wav`)
    await this.extract(filePath, inPoint, duration, input)
    try {
      await this.py(['process', '--plugin', pluginPath, ...(state ? ['--state', state] : []), '--input', input, '--output', out])
    } finally {
      fs.rmSync(input, { force: true })
    }
    return out
  }
}

module.exports = { AudioTools, cleanFilter, CLEAN }
