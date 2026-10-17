// Importação de vídeos por link com o yt-dlp (https://github.com/yt-dlp/yt-dlp).
// O executável oficial é baixado do GitHub só quando o usuário pede, para a pasta de dados do app.

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const isWin = process.platform === 'win32'
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'}`

/** Seletores de formato: prefere H.264 + AAC (tocam direto na prévia, sem proxy). */
const PRESETS = {
  best: ['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4'],
  hd720: ['-f', 'bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4'],
  max: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
  audio: ['-f', 'ba[ext=m4a]/ba', '-x', '--audio-format', 'm4a'],
}

class Downloader {
  constructor(baseDir, ffmpegPath, outDir) {
    this.dir = path.join(baseDir, 'tools')
    this.exe = path.join(this.dir, isWin ? 'yt-dlp.exe' : 'yt-dlp')
    this.ffmpegDir = path.dirname(ffmpegPath)
    this.outDir = outDir
    this.proc = null
    this.abort = null
  }

  run(args, { onLine, timeout } = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
      this.proc = proc
      let out = ''
      let err = ''
      const timer = timeout ? setTimeout(() => proc.kill(), timeout) : null
      const feed = (chunk, stream) => {
        const text = chunk.toString('utf8')
        if (stream === 'out') out += text
        else err = (err + text).slice(-4000)
        if (onLine) for (const line of text.split(/[\r\n]+/)) if (line.trim()) onLine(line, stream)
      }
      proc.stdout.on('data', (c) => feed(c, 'out'))
      proc.stderr.on('data', (c) => feed(c, 'err'))
      proc.on('error', (e) => {
        this.proc = null
        reject(e)
      })
      proc.on('close', (code) => {
        this.proc = null
        if (timer) clearTimeout(timer)
        if (code === 0) resolve(out)
        else reject(new Error(cleanError(err) || `yt-dlp saiu com código ${code}`))
      })
    })
  }

  async status() {
    if (!fs.existsSync(this.exe)) return { installed: false, version: null, outDir: this.outDir }
    try {
      const v = await this.run(['--version'], { timeout: 15000 })
      return { installed: true, version: v.trim(), outDir: this.outDir }
    } catch {
      return { installed: false, version: null, outDir: this.outDir }
    }
  }

  /** Baixa o executável oficial do GitHub (com progresso). */
  async install(onProgress) {
    fs.mkdirSync(this.dir, { recursive: true })
    this.abort = new AbortController()
    const res = await fetch(RELEASE_URL, { signal: this.abort.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`Não foi possível baixar o yt-dlp (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    let got = 0
    const tmp = this.exe + '.part'
    const counter = new (require('node:stream').Transform)({
      transform(chunk, _enc, cb) {
        got += chunk.length
        if (total) onProgress({ stage: 'install', progress: got / total })
        cb(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp))
    fs.renameSync(tmp, this.exe)
    if (!isWin) fs.chmodSync(this.exe, 0o755)
    this.abort = null
    return this.status()
  }

  async update() {
    const out = await this.run(['-U'], { timeout: 120000 })
    return { message: out.trim().split(/\r?\n/).pop(), ...(await this.status()) }
  }

  /** Metadados do vídeo (sem baixar). */
  async info(url) {
    const json = await this.run(['-J', '--no-playlist', '--no-warnings', url], { timeout: 60000 })
    const d = JSON.parse(json)
    const heights = [...new Set((d.formats || []).map((f) => f.height).filter(Boolean))].sort((a, b) => b - a)
    return {
      id: d.id,
      title: d.title,
      uploader: d.uploader || d.channel || null,
      duration: d.duration || 0,
      thumbnail: d.thumbnail || null,
      maxHeight: heights[0] || null,
      extractor: d.extractor_key || d.extractor || null,
      license: d.license || null,
      webpage: d.webpage_url || url,
    }
  }

  /** Baixa o vídeo; devolve o caminho do arquivo final. */
  async download(url, preset, onProgress) {
    fs.mkdirSync(this.outDir, { recursive: true })
    let file = null
    let part = 0
    const args = [
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--windows-filenames',
      '--ffmpeg-location', this.ffmpegDir,
      '-P', this.outDir,
      '-o', '%(title).90s [%(id)s].%(ext)s',
      '--print', 'after_move:filepath',
      // --print liga o modo silencioso; --progress mantém as linhas de progresso.
      '--progress',
      ...(PRESETS[preset] || PRESETS.best),
      url,
    ]
    await this.run(args, {
      onLine: (line, stream) => {
        if (stream === 'out' && !line.startsWith('[') && fs.existsSync(line.trim())) {
          file = line.trim()
          return
        }
        if (/\[download\] Destination:/.test(line)) {
          part++
          onProgress({ stage: 'download', part, progress: 0 })
        }
        const m = /\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+\w+))?(?:\s+at\s+([\d.]+\w+\/s))?(?:\s+ETA\s+([\d:]+))?/.exec(line)
        if (m) onProgress({ stage: 'download', part: Math.max(1, part), progress: Number(m[1]) / 100, size: m[2] || null, speed: m[3] || null, eta: m[4] || null })
        else if (/\[(Merger|ExtractAudio|FixupM4a|VideoConvertor)\]/.test(line)) onProgress({ stage: 'processing' })
      },
    })
    if (!file) throw new Error('O download terminou, mas o arquivo não foi encontrado')
    return file
  }

  cancel() {
    if (this.abort) this.abort.abort()
    if (this.proc) this.proc.kill()
  }
}

/** Deixa só a mensagem útil do yt-dlp ("ERROR: ..."). */
function cleanError(stderr) {
  const lines = stderr.split(/\r?\n/).filter(Boolean)
  const err = lines.reverse().find((l) => l.startsWith('ERROR:'))
  return (err || lines[0] || '').replace(/^ERROR:\s*/, '').replace(/\[\w+\]\s*[\w-]+:\s*/, '').trim()
}

module.exports = { Downloader }
