// Biblioteca de músicas e efeitos sonoros livres (Creative Commons), via API do Openverse
// (https://openverse.org, catálogo aberto mantido pela WordPress Foundation).

const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const API = 'https://api.openverse.org/v1/audio/'
const EXT = { mp32: 'mp3', mp3: 'mp3', mpeg: 'mp3', ogg: 'ogg', oga: 'ogg', wav: 'wav', flac: 'flac', m4a: 'm4a', aac: 'aac', opus: 'opus' }

const LICENSE_NAMES = { cc0: 'CC0 (domínio público)', pdm: 'Domínio público', by: 'CC BY', 'by-sa': 'CC BY-SA', 'by-nd': 'CC BY-ND', 'by-nc': 'CC BY-NC', 'by-nc-sa': 'CC BY-NC-SA', 'by-nc-nd': 'CC BY-NC-ND', sampling: 'Sampling+', 'nc-sampling': 'NC Sampling+' }

class Library {
  constructor(userAgent) {
    this.userAgent = userAgent
    this.abort = null
  }

  /**
   * @param {{ q: string, category?: 'music'|'sound_effect'|'', commercial?: boolean, page?: number }} opts
   */
  async search({ q, category = '', commercial = true, page = 1 }) {
    const params = new URLSearchParams({ q, page_size: '20', page: String(page) })
    // Uso comercial e permissão de modificar (editar o som num vídeo é uma modificação).
    params.set('license_type', commercial ? 'commercial,modification' : 'modification')
    if (category) params.set('category', category)
    const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } })
    if (res.status === 429) throw new Error('Muitas buscas seguidas. Espere um minuto e tente de novo.')
    if (!res.ok) throw new Error(`O Openverse respondeu ${res.status}`)
    const data = await res.json()
    return {
      total: data.result_count || 0,
      pages: data.page_count || 0,
      items: (data.results || [])
        .filter((r) => r.url)
        .map((r) => ({
          id: r.id,
          title: r.title || 'Sem título',
          creator: r.creator || null,
          license: r.license,
          licenseName: `${LICENSE_NAMES[r.license] || r.license.toUpperCase()}${r.license_version && !['cc0', 'pdm'].includes(r.license) ? ` ${r.license_version}` : ''}`,
          licenseUrl: r.license_url || null,
          attribution: r.attribution || null,
          landing: r.foreign_landing_url || null,
          source: r.source || r.provider || null,
          url: r.url,
          ext: EXT[(r.filetype || '').toLowerCase()] || 'mp3',
          duration: r.duration ? r.duration / 1000 : 0,
          thumbnail: r.thumbnail || null,
          category: r.category || null,
          genres: r.genres || [],
          // Atribuição obrigatória em tudo, exceto CC0 e domínio público.
          needsCredit: !['cc0', 'pdm'].includes(r.license),
          shareAlike: /sa/.test(r.license),
        })),
    }
  }

  /** Baixa o arquivo para a pasta escolhida e devolve o caminho. */
  async download(item, dir, onProgress) {
    fs.mkdirSync(dir, { recursive: true })
    const safe = `${item.title}${item.creator ? ` - ${item.creator}` : ''}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 90).trim()
    const file = path.join(dir, `${safe} [${item.id.slice(0, 8)}].${item.ext}`)
    if (fs.existsSync(file)) return file
    this.abort = new AbortController()
    const res = await fetch(item.url, { signal: this.abort.signal, redirect: 'follow', headers: { 'User-Agent': this.userAgent } })
    if (!res.ok || !res.body) throw new Error(`Não foi possível baixar (HTTP ${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    let got = 0
    const tmp = `${file}.part`
    const counter = new (require('node:stream').Transform)({
      transform(chunk, _enc, cb) {
        got += chunk.length
        if (total) onProgress(got / total)
        cb(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp))
      fs.renameSync(tmp, file)
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      throw err
    } finally {
      this.abort = null
    }
    return file
  }

  cancel() {
    if (this.abort) this.abort.abort()
  }
}

module.exports = { Library }
