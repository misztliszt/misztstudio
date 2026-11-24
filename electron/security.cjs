// Regras de segurança do processo principal: o que a interface pode pedir e o que ela pode ler.
// Funções puras (sem Electron) para poderem ser testadas.

const path = require('node:path')

const norm = (p) => {
  const n = path.normalize(String(p))
  return process.platform === 'win32' ? n.toLowerCase() : n
}

/** Caminho de arquivo local absoluto (nunca uma URL, nunca algo que comece com "-"). */
function isLocalPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096 || p.includes('\0')) return false
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(p)) return false // http://, file://, concat:// …
  if (/^(concat|subfile|pipe|crypto|data|tcp|udp|rtmp|rtsp):/i.test(p)) return false
  return path.isAbsolute(p)
}

/** Só arquivos que o próprio programa conhece podem ser lidos pelo protocolo media://. */
class MediaAllowlist {
  constructor() {
    this.files = new Set()
  }
  add(p) {
    if (isLocalPath(p)) this.files.add(norm(p))
  }
  has(p) {
    return isLocalPath(p) && this.files.has(norm(p))
  }
  /** Libera as mídias citadas num projeto (caminho, URL media://, miniatura e proxy) ao abri-lo. */
  addFromProject(json) {
    let proj
    try {
      proj = JSON.parse(json)
    } catch {
      return
    }
    const media = proj && typeof proj === 'object' && proj.media && typeof proj.media === 'object' ? Object.values(proj.media) : []
    for (const m of media) {
      if (!m || typeof m !== 'object') continue
      for (const v of [m.path, m.proxy]) if (typeof v === 'string') this.add(v.startsWith('media://') ? fromMediaUrl(v) : v)
      for (const v of [m.url, m.thumb]) if (typeof v === 'string' && v.startsWith('media://')) this.add(fromMediaUrl(v))
    }
  }
}

function fromMediaUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1))
  } catch {
    return ''
  }
}

/** Origens da própria interface (a empacotada e, só em desenvolvimento, o servidor do Vite). */
function isTrustedUrl(url, isDev) {
  if (typeof url !== 'string') return false
  if (url.startsWith('app://bundle/')) return true
  return !!isDev && url.startsWith('http://localhost:5173/')
}

/** Valor do cabeçalho CORS do media://: só as origens da própria interface. */
function corsOrigin(origin, isDev) {
  if (origin === 'app://bundle') return origin
  if (isDev && origin === 'http://localhost:5173') return origin
  return null
}

const SETTING_KEYS = {
  downloadDir: 'dir',
  recordDir: 'dir',
  exportDir: 'dir',
  lastExportDir: 'dir',
  autosaveSeconds: 'seconds',
  previewQuality: ['full', 'half', 'quarter'],
  proxyMode: ['auto', 'always', 'never'],
  checkUpdates: 'bool',
  shortcuts: 'map',
}

/**
 * Confere um pedaço de preferências vindo da interface. Devolve só chaves conhecidas, já validadas;
 * `isDir` diz se uma pasta existe. Lança Error se algum valor for inválido.
 */
function sanitizeSettingsPatch(patch, isDir) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Preferências inválidas')
  const out = {}
  for (const [key, value] of Object.entries(patch)) {
    const rule = SETTING_KEYS[key]
    if (!rule) continue // chaves desconhecidas são ignoradas
    if (rule === 'dir') {
      if (value === null || value === '') out[key] = null
      else if (isLocalPath(value) && isDir(value)) out[key] = value
      else throw new Error('A pasta escolhida não existe')
    } else if (rule === 'seconds') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 5 || value > 3600) throw new Error('Intervalo de salvamento inválido')
      out[key] = Math.round(value)
    } else if (rule === 'bool') out[key] = value === true
    else if (rule === 'map') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Atalhos inválidos')
      const clean = {}
      for (const [k, v] of Object.entries(value)) if (typeof v === 'string' && v.length <= 64 && /^[\w.-]{1,64}$/.test(k)) clean[k] = v
      out[key] = clean
    } else if (Array.isArray(rule)) {
      if (!rule.includes(value)) throw new Error(`Valor inválido para ${key}`)
      out[key] = value
    }
  }
  return out
}

const hasProjectExt = (p) => typeof p === 'string' && path.extname(p).toLowerCase() === '.edproj'

module.exports = { isLocalPath, MediaAllowlist, isTrustedUrl, corsOrigin, sanitizeSettingsPatch, hasProjectExt, norm }
