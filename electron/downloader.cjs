// Importação de vídeos por link com o yt-dlp (https://github.com/yt-dlp/yt-dlp).
// O executável oficial é baixado do GitHub só quando o usuário pede, para a pasta de dados do app.

const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { spawn, killTree, lineFeeder } = require('./procs.cjs')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const crypto = require('node:crypto')

const isWin = process.platform === 'win32'
const RELEASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'}`

/** Só endereços http(s): qualquer outra coisa (inclusive algo que pareça uma opção) é recusada. */
function assertHttpUrl(url) {
  let u
  try {
    u = new URL(String(url))
  } catch {
    throw new Error('Endereço inválido')
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || String(url).length > 2048) throw new Error('Use um endereço http ou https')
  return u.href
}

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
    // Vários processos podem rodar ao mesmo tempo (um download e uma consulta): Cancelar encerra todos.
    this.procs = new Set()
    this.abort = null
  }

  run(args, { onLine, timeout } = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
      this.procs.add(proc)
      let out = ''
      let err = ''
      const timer = timeout ? setTimeout(() => killTree(proc), timeout) : null
      // utf-8 inteiro e linhas inteiras: um título com acento cortado no meio do bloco não vira lixo.
      proc.stdout.setEncoding('utf8')
      proc.stderr.setEncoding('utf8')
      const lines = lineFeeder((line, stream) => onLine && onLine(line, stream))
      proc.stdout.on('data', (text) => {
        out += text
        lines.push('out', text)
      })
      proc.stderr.on('data', (text) => {
        err = (err + text).slice(-4000)
        lines.push('err', text)
      })
      proc.on('error', (e) => {
        this.procs.delete(proc)
        reject(e)
      })
      proc.on('close', (code) => {
        this.procs.delete(proc)
        lines.flush()
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
    try {
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp))
      await this.verifyHash(tmp)
      fs.renameSync(tmp, this.exe)
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      this.abort = null
      throw err
    }
    if (!isWin) fs.chmodSync(this.exe, 0o755)
    this.abort = null
    return this.status()
  }

  /** Confere o SHA-256 do download com a lista publicada junto do executável. */
  async verifyHash(file) {
    const name = RELEASE_URL.split('/').pop()
    const sums = await fetch(RELEASE_URL.replace(/[^/]+$/, 'SHA2-256SUMS'), { redirect: 'follow', signal: AbortSignal.timeout(30000) })
    if (!sums.ok) throw new Error('Não foi possível conferir a integridade do yt-dlp')
    const line = (await sums.text()).split(/\r?\n/).find((l) => l.trim().endsWith('  ' + name) || l.trim().endsWith(' *' + name))
    const expected = line && line.trim().split(/\s+/)[0].toLowerCase()
    if (!expected) throw new Error('Não foi possível conferir a integridade do yt-dlp')
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    if (actual !== expected) throw new Error('O arquivo baixado do yt-dlp não confere com o hash oficial; instalação cancelada')
  }

  async update() {
    const out = await this.run(['-U'], { timeout: 120000 })
    return { message: out.trim().split(/\r?\n/).pop(), ...(await this.status()) }
  }

  /** Metadados do vídeo (sem baixar). */
  async info(url) {
    url = assertHttpUrl(url)
    const json = await this.run(['-J', '--no-playlist', '--no-warnings', '--', url], { timeout: 60000 })
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

  /** Pesquisa no YouTube (lista rápida, sem abrir cada vídeo). */
  async search(query, count = 16) {
    const json = await this.run([`ytsearch${count}:${query}`, '--flat-playlist', '-J', '--no-warnings'], { timeout: 60000 })
    return (JSON.parse(json).entries || [])
      .filter((e) => e && e.id && e.live_status !== 'is_live')
      .map((e) => {
        const thumbs = (e.thumbnails || []).filter((t) => t.url)
        const thumb = thumbs.find((t) => t.width >= 320) || thumbs[thumbs.length - 1]
        return {
          id: e.id,
          title: e.title || e.id,
          channel: e.channel || e.uploader || null,
          duration: e.duration || 0,
          views: e.view_count || null,
          thumbnail: thumb ? thumb.url : `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
          url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
        }
      })
  }

  /** Baixa o vídeo; devolve o caminho do arquivo final. */
  async download(url, preset, onProgress) {
    url = assertHttpUrl(url)
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
      ...(Object.hasOwn(PRESETS, preset) ? PRESETS[preset] : PRESETS.best),
      '--',
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
    for (const proc of this.procs) killTree(proc)
  }
}

/** Deixa só a mensagem útil do yt-dlp ("ERROR: ..."). */
function cleanError(stderr) {
  const lines = stderr.split(/\r?\n/).filter(Boolean)
  const err = lines.reverse().find((l) => l.startsWith('ERROR:'))
  return (err || lines[0] || '').replace(/^ERROR:\s*/, '').replace(/\[\w+\]\s*[\w-]+:\s*/, '').trim()
}

module.exports = { Downloader, assertHttpUrl }
