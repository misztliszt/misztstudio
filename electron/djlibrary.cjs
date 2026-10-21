// Leitura das bibliotecas dos programas de DJ do próprio usuário, para importar BPM, grade de
// batidas, tom e hot cues. Só lê arquivos abertos/exportados (XML, NML, tags ID3, SQLite sem
// criptografia); o banco criptografado do rekordbox (master.db) não é usado: no rekordbox,
// use Arquivo → Exportar coleção em formato xml.
//
// Formato comum devolvido:
//   { source, file, tracks: [{ id, path, title, artist, duration, bpm, key, grid, cues, exists }], playlists: [{ name, trackIds }] }

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { camelot } = require('../src/dsp/key-core.js')

// ---------- Tons ----------

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const makeKey = (key, mode) => ({ key: ((key % 12) + 12) % 12, mode, camelot: camelot(((key % 12) + 12) % 12, mode), confidence: 1, alternative: null })

/** "Fm", "F#m", "Bbmin", "4A" (Camelot), "9m"/"9d" (Open Key) → tom. */
function parseKeyName(text) {
  if (!text) return null
  const t = String(text).trim().replace('♯', '#').replace('♭', 'b')
  let m = /^(\d{1,2})([AB])$/i.exec(t)
  if (m) {
    const n = Number(m[1])
    if (n < 1 || n > 12) return null
    const major = (((7 * (n - 8)) % 12) + 12) % 12
    return m[2].toUpperCase() === 'B' ? makeKey(major, 'major') : makeKey(major + 9, 'minor')
  }
  m = /^(\d{1,2})([dm])$/.exec(t)
  if (m) {
    const n = Number(m[1])
    if (n < 1 || n > 12) return null
    // Open Key 1d = Camelot 8B.
    return parseKeyName(`${((n + 6) % 12) + 1}${m[2] === 'd' ? 'B' : 'A'}`)
  }
  m = /^([A-G])([#b]?)\s*(m|min|minor|maj|major)?$/i.exec(t)
  if (!m) return null
  const base = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
  const minor = !!m[3] && /^m(in(or)?)?$/i.test(m[3])
  return makeKey(base, minor ? 'minor' : 'major')
}

// Traktor: MUSICAL_KEY 0–11 = Dó maior … Si maior, 12–23 = Dó menor … Si menor.
const traktorKey = (v) => (Number.isFinite(v) && v >= 0 && v < 24 ? makeKey(v % 12, v < 12 ? 'major' : 'minor') : null)

// Engine DJ: ordem do círculo de quintas (como no libdjinterop): Dó, Lá m, Sol, Mi m, Ré, Si m…
const ENGINE_KEYS = ['C', 'Am', 'G', 'Em', 'D', 'Bm', 'A', 'F#m', 'E', 'C#m', 'B', 'G#m', 'F#', 'Ebm', 'Db', 'Bbm', 'Ab', 'Fm', 'Eb', 'Cm', 'Bb', 'Gm', 'F', 'Dm']
const engineKey = (v) => (Number.isInteger(v) && v >= 0 && v < 24 ? parseKeyName(ENGINE_KEYS[v]) : null)

// ---------- XML simples (atributos de tags), suficiente para rekordbox e Traktor ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? all)))

/** Percorre as tags chamando onOpen(nome, atributos, autoFechada) e onClose(nome). */
function scanXml(text, onOpen, onClose) {
  const tag = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g
  const attr = /([\w:.-]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = tag.exec(text))) {
    if (m[1]) {
      onClose(m[2])
      continue
    }
    const attrs = {}
    let a
    attr.lastIndex = 0
    while ((a = attr.exec(m[3]))) attrs[a[1]] = decode(a[2])
    onOpen(m[2], attrs, !!m[4])
    if (m[4]) onClose(m[2])
  }
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------- rekordbox (XML exportado) ----------

function rekordboxPath(location) {
  if (!location) return null
  let p = location.replace(/^file:\/\/localhost\//i, '').replace(/^file:\/\/\//i, '')
  try {
    p = decodeURI(p)
  } catch {
    // mantém como está
  }
  if (/^[A-Za-z]:/.test(p)) return p.replace(/\//g, path.sep)
  return '/' + p
}

function parseRekordbox(text) {
  const tracks = []
  const byId = new Map()
  const playlists = []
  let section = null
  let current = null
  let playlist = null
  scanXml(
    text,
    (name, a, selfClosing) => {
      if (name === 'COLLECTION') section = 'collection'
      else if (name === 'PLAYLISTS') section = 'playlists'
      else if (section === 'collection' && name === 'TRACK') {
        current = {
          id: `rb-${a.TrackID}`,
          path: rekordboxPath(a.Location),
          title: a.Name || null,
          artist: a.Artist || null,
          duration: num(a.TotalTime) || 0,
          bpm: num(a.AverageBpm) || null,
          key: parseKeyName(a.Tonality),
          grid: null,
          cues: [],
        }
        tracks.push(current)
        byId.set(a.TrackID, current)
        if (selfClosing) current = null
      } else if (current && name === 'TEMPO' && !current.grid) {
        const bpm = num(a.Bpm)
        if (bpm) current.grid = { bpm, offset: num(a.Inizio) || 0 }
      } else if (current && name === 'POSITION_MARK') {
        const n = num(a.Num)
        const color = a.Red !== undefined ? `rgb(${a.Red},${a.Green},${a.Blue})` : null
        // Num -1 = memory cue; 0–7 = hot cues A–H. Type 4 = loop.
        current.cues.push({ name: a.Name || '', time: num(a.Start) || 0, num: n !== null && n >= 0 ? n : null, color, loop: a.Type === '4' ? (num(a.End) || 0) - (num(a.Start) || 0) : null })
      } else if (section === 'playlists' && name === 'NODE' && a.Type === '1') {
        playlist = { name: a.Name || 'Playlist', trackIds: [] }
        playlists.push(playlist)
      } else if (playlist && name === 'TRACK' && a.Key) {
        const t = byId.get(a.Key)
        if (t) playlist.trackIds.push(t.id)
      }
    },
    (name) => {
      if (name === 'TRACK') current = null
      else if (name === 'NODE') playlist = null
      else if (name === 'COLLECTION' || name === 'PLAYLISTS') section = null
    },
  )
  return { tracks, playlists }
}

// ---------- Traktor (collection.nml) ----------

const traktorPath = (volume, dir, file) => {
  const d = (dir || '').replace(/\/:/g, '/')
  const vol = volume && /^[A-Za-z]:$/.test(volume) ? volume : ''
  return path.normalize(`${vol}${d}${file || ''}`)
}

function parseTraktor(text) {
  const tracks = []
  const byKey = new Map()
  const playlists = []
  let section = null
  let current = null
  let playlist = null
  scanXml(
    text,
    (name, a) => {
      if (name === 'COLLECTION') section = 'collection'
      else if (name === 'PLAYLISTS') section = 'playlists'
      else if (section === 'collection' && name === 'ENTRY') {
        current = { id: `tk-${tracks.length}`, path: null, title: a.TITLE || null, artist: a.ARTIST || null, duration: 0, bpm: null, key: null, grid: null, cues: [] }
        tracks.push(current)
      } else if (current && name === 'LOCATION') {
        current.path = traktorPath(a.VOLUME, a.DIR, a.FILE)
        byKey.set(`${a.VOLUME || ''}${a.DIR || ''}${a.FILE || ''}`, current)
      } else if (current && name === 'INFO') {
        current.duration = num(a.PLAYTIME_FLOAT) || num(a.PLAYTIME) || 0
        if (!current.key && a.KEY) current.key = parseKeyName(a.KEY)
      } else if (current && name === 'TEMPO') {
        current.bpm = num(a.BPM) || null
      } else if (current && name === 'MUSICAL_KEY') {
        current.key = traktorKey(num(a.VALUE)) || current.key
      } else if (current && name === 'CUE_V2') {
        const start = (num(a.START) || 0) / 1000
        const type = a.TYPE
        if (type === '4') {
          // Marcador da grade: a primeira batida.
          if (!current.grid && current.bpm) current.grid = { bpm: current.bpm, offset: start }
        } else {
          const hot = num(a.HOTCUE)
          current.cues.push({ name: a.NAME && a.NAME !== 'n.n.' ? a.NAME : '', time: start, num: hot !== null && hot >= 0 ? hot : null, color: null, loop: type === '5' ? (num(a.LEN) || 0) / 1000 : null })
        }
      } else if (section === 'playlists' && name === 'NODE' && a.TYPE === 'PLAYLIST') {
        playlist = { name: a.NAME || 'Playlist', trackIds: [] }
        playlists.push(playlist)
      } else if (playlist && name === 'PRIMARYKEY' && a.KEY) {
        const t = byKey.get(a.KEY)
        if (t) playlist.trackIds.push(t.id)
      }
    },
    (name) => {
      if (name === 'ENTRY' && section === 'collection') {
        if (current && !current.grid && current.bpm) current.grid = { bpm: current.bpm, offset: 0 }
        current = null
      } else if (name === 'NODE') playlist = null
      else if (name === 'COLLECTION' || name === 'PLAYLISTS') section = null
    },
  )
  return { tracks: tracks.filter((t) => t.path), playlists }
}

// ---------- Serato (tags ID3 dentro dos MP3) ----------

const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3]

/** Lê só o bloco ID3v2 do começo do arquivo. */
function readId3(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(10)
    if (fs.readSync(fd, head, 0, 10, 0) < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null
    const version = head[3]
    const size = syncsafe(head, 6)
    if (size <= 0 || size > 64 * 1024 * 1024) return null
    const body = Buffer.alloc(size)
    fs.readSync(fd, body, 0, size, 10)
    const frames = new Map()
    let o = 0
    while (o + 10 <= body.length) {
      const id = body.toString('latin1', o, o + 4)
      if (!/^[A-Z0-9]{4}$/.test(id)) break
      const len = version === 4 ? syncsafe(body, o + 4) : body.readUInt32BE(o + 4)
      if (len <= 0 || o + 10 + len > body.length) break
      const data = body.subarray(o + 10, o + 10 + len)
      if (!frames.has(id)) frames.set(id, [])
      frames.get(id).push(data)
      o += 10 + len
    }
    return frames
  } finally {
    fs.closeSync(fd)
  }
}

function decodeText(enc, buf) {
  if (enc === 1 || enc === 2) {
    let b = buf
    let le = enc === 1
    if (b[0] === 0xff && b[1] === 0xfe) (le = true), (b = b.subarray(2))
    else if (b[0] === 0xfe && b[1] === 0xff) (le = false), (b = b.subarray(2))
    if (!le) {
      const swapped = Buffer.from(b.subarray(0, b.length - (b.length % 2)))
      swapped.swap16()
      b = swapped
    }
    return b.toString('utf16le').replace(/\0+$/, '')
  }
  return buf.toString(enc === 3 ? 'utf8' : 'latin1').replace(/\0+$/, '')
}

const textFrame = (frames, id) => {
  const f = frames.get(id)
  return f ? decodeText(f[0][0], f[0].subarray(1)).split('\0')[0].trim() : null
}

/** Conteúdo de um GEOB pela descrição (ex.: "Serato Markers2"). */
function geob(frames, description) {
  for (const f of frames.get('GEOB') || []) {
    const enc = f[0]
    let o = 1
    const mimeEnd = f.indexOf(0, o)
    o = mimeEnd + 1
    const wide = enc === 1 || enc === 2
    const findEnd = (from) => {
      if (!wide) return f.indexOf(0, from)
      for (let i = from; i + 1 < f.length; i += 2) if (f[i] === 0 && f[i + 1] === 0) return i
      return -1
    }
    const fileEnd = findEnd(o)
    o = fileEnd + (wide ? 2 : 1)
    const descEnd = findEnd(o)
    const desc = decodeText(enc, f.subarray(o, descEnd))
    if (desc === description) return f.subarray(descEnd + (wide ? 2 : 1))
  }
  return null
}

/** Hot cues do "Serato Markers2" (base64 com cabeçalho 01 01 e entradas nome/tamanho/dados). */
function seratoCues(data) {
  if (!data || data.length < 2) return []
  const b64 = data.subarray(2).toString('latin1').replace(/[^A-Za-z0-9+/]/g, '')
  const raw = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64')
  const cues = []
  let o = 2
  while (o < raw.length) {
    const end = raw.indexOf(0, o)
    if (end <= o) break
    const name = raw.toString('latin1', o, end)
    const len = raw.readUInt32BE(end + 1)
    const d = raw.subarray(end + 5, end + 5 + len)
    o = end + 5 + len
    if (name === 'CUE' && d.length >= 12) {
      const idx = d[1]
      const ms = d.readUInt32BE(2)
      const color = `rgb(${d[7]},${d[8]},${d[9]})`
      const labelEnd = d.indexOf(0, 12)
      const label = d.toString('utf8', 12, labelEnd < 0 ? d.length : labelEnd)
      cues.push({ name: label, time: ms / 1000, num: idx, color, loop: null })
    }
  }
  return cues
}

function seratoTrack(file, i) {
  const frames = readId3(file)
  if (!frames) return null
  const cues = seratoCues(geob(frames, 'Serato Markers2'))
  const bpm = num(textFrame(frames, 'TBPM'))
  const key = parseKeyName(textFrame(frames, 'TKEY'))
  if (!cues.length && !bpm && !key) return null
  return { id: `se-${i}`, path: file, title: textFrame(frames, 'TIT2') || path.basename(file, path.extname(file)), artist: textFrame(frames, 'TPE1'), duration: 0, bpm, key, grid: bpm ? { bpm, offset: 0 } : null, cues }
}

/** Procura MP3 com dados do Serato (BPM, tom ou hot cues) numa pasta. */
function scanSerato(dir, limit = 5000) {
  const tracks = []
  const walk = (d, depth) => {
    if (tracks.length >= limit || depth > 6) return
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (tracks.length >= limit) return
      const p = path.join(d, e.name)
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '_Serato_') walk(p, depth + 1)
      else if (e.isFile() && /\.mp3$/i.test(e.name)) {
        try {
          const t = seratoTrack(p, tracks.length)
          if (t) tracks.push(t)
        } catch {
          // arquivo com tag quebrada: ignora
        }
      }
    }
  }
  walk(dir, 0)
  return { tracks, playlists: [] }
}

// ---------- Engine DJ (Database2/m.db, SQLite) ----------

/** Descompacta um blob qCompress (4 bytes de tamanho + zlib). */
const qUncompress = (blob) => (blob && blob.length > 4 ? zlib.inflateSync(Buffer.from(blob).subarray(4)) : null)

async function parseEngine(dbFile) {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) })
  const db = new SQL.Database(fs.readFileSync(dbFile))
  try {
    const cols = (table) => {
      try {
        return db.exec(`PRAGMA table_info(${table})`)[0]?.values.map((r) => r[1]) || []
      } catch {
        return []
      }
    }
    const trackCols = cols('Track')
    if (!trackCols.length) throw new Error('Banco do Engine DJ sem a tabela Track')
    const perfCols = cols('PerformanceData')
    const inTrack = trackCols.includes('quickCues')
    const pick = (c) => (trackCols.includes(c) ? `t.${c}` : 'NULL')
    const perf = (c) => (inTrack ? pick(c) : perfCols.includes(c) ? `p.${c}` : 'NULL')
    const sql = `SELECT t.id, ${pick('path')}, ${pick('title')}, ${pick('artist')}, ${pick('length')}, ${pick('bpmAnalyzed')}, ${pick('bpm')}, ${pick('key')}, ${perf('trackData')}, ${perf('beatData')}, ${perf('quickCues')} FROM Track t${!inTrack && perfCols.length ? ' LEFT JOIN PerformanceData p ON p.trackId = t.id' : ''}`
    const rows = db.exec(sql)[0]?.values || []
    const libDir = path.dirname(path.dirname(dbFile))
    const tracks = rows
      .filter((r) => r[1])
      .map(([id, p, title, artist, length, bpmA, bpm, key, trackData, beatData, quickCues]) => {
        let sampleRate = 44100
        try {
          const td = qUncompress(trackData)
          if (td && td.length >= 8) sampleRate = td.readDoubleBE(0) || sampleRate
        } catch {
          // sem dados de desempenho
        }
        const cues = []
        try {
          const q = qUncompress(quickCues)
          if (q && q.length >= 8) {
            const count = Number(q.readBigInt64BE(0))
            let o = 8
            for (let i = 0; i < count && o < q.length; i++) {
              const len = q[o]
              const label = q.toString('utf8', o + 1, o + 1 + len)
              o += 1 + len
              const pos = q.readDoubleBE(o)
              const [, r, g, b] = [q[o + 8], q[o + 9], q[o + 10], q[o + 11]]
              o += 12
              if (pos >= 0) cues.push({ name: label, time: pos / sampleRate, num: i, color: `rgb(${r},${g},${b})`, loop: null })
            }
          }
        } catch {
          // cues ilegíveis: ignora
        }
        let grid = null
        const tempo = num(bpmA) || num(bpm)
        try {
          const bd = qUncompress(beatData)
          // sampleRate (double), samples (double), grade definida (u8), nº de marcadores (i64), 1º marcador: posição (double), índice da batida (i64).
          if (bd && bd.length >= 41 && tempo) {
            const sr = bd.readDoubleBE(0) || sampleRate
            const pos = bd.readDoubleBE(25)
            const beatIndex = Number(bd.readBigInt64BE(33))
            const offset = pos / sr - (beatIndex * 60) / tempo
            grid = { bpm: tempo, offset: ((offset % (60 / tempo)) + 60 / tempo) % (60 / tempo) }
          }
        } catch {
          // sem grade
        }
        if (!grid && tempo) grid = { bpm: tempo, offset: 0 }
        return { id: `en-${id}`, path: path.resolve(libDir, String(p)), title: title || null, artist: artist || null, duration: num(length) || 0, bpm: tempo, key: engineKey(num(key)), grid, cues }
      })
    let playlists = []
    try {
      const lists = db.exec('SELECT id, title FROM Playlist')[0]?.values || []
      const entries = db.exec('SELECT listId, trackId FROM PlaylistEntity')[0]?.values || []
      playlists = lists.map(([lid, title]) => ({ name: String(title), trackIds: entries.filter((e) => e[0] === lid).map((e) => `en-${e[1]}`) }))
    } catch {
      // versões sem playlists
    }
    return { tracks, playlists }
  } finally {
    db.close()
  }
}

// ---------- Localização padrão ----------

function detectSources() {
  const home = os.homedir()
  const found = {}
  const ni = path.join(home, 'Documents', 'Native Instruments')
  try {
    const dirs = fs
      .readdirSync(ni)
      .filter((d) => /^Traktor/i.test(d))
      .map((d) => path.join(ni, d, 'collection.nml'))
      .filter((f) => fs.existsSync(f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (dirs[0]) found.traktor = dirs[0]
  } catch {
    // sem Traktor
  }
  const engine = path.join(home, 'Music', 'Engine Library', 'Database2', 'm.db')
  if (fs.existsSync(engine)) found.engine = engine
  const serato = path.join(home, 'Music', '_Serato_')
  if (fs.existsSync(serato)) found.serato = path.join(home, 'Music')
  return found
}

/**
 * @param {'rekordbox'|'traktor'|'serato'|'engine'} source
 * @param {string} target arquivo (XML, NML, m.db) ou pasta (Serato)
 */
async function loadLibrary(source, target) {
  let lib
  if (source === 'rekordbox') lib = parseRekordbox(fs.readFileSync(target, 'utf8'))
  else if (source === 'traktor') lib = parseTraktor(fs.readFileSync(target, 'utf8'))
  else if (source === 'serato') lib = scanSerato(target)
  else if (source === 'engine') lib = await parseEngine(target)
  else throw new Error(`Fonte desconhecida: ${source}`)
  for (const t of lib.tracks) {
    t.exists = !!t.path && fs.existsSync(t.path)
    t.cues.sort((a, b) => (a.num ?? 99) - (b.num ?? 99) || a.time - b.time)
  }
  return { source, file: target, ...lib }
}

module.exports = { loadLibrary, detectSources, parseKeyName, parseRekordbox, parseTraktor, seratoCues, scanSerato, parseEngine, traktorKey, engineKey }
