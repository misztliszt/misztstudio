const { app, BrowserWindow, ipcMain, dialog, protocol, shell, session, desktopCapturer, globalShortcut } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { Readable } = require('node:stream')
const { prepareExport, buildMixdownArgs } = require('./export.cjs')
const { StemEngine } = require('./stems.cjs')
const { Downloader } = require('./downloader.cjs')
const { AudioTools } = require('./audiotools.cjs')
const { ExportQueue } = require('./exportqueue.cjs')
const { setupUpdater } = require('./updater.cjs')
const { detectKeyFile } = require('./analysis.cjs')
const { Library } = require('./library.cjs')
const { loadLibrary, detectSources } = require('./djlibrary.cjs')

const isDev = process.argv.includes('--dev')

// ffmpeg-static/ffprobe-static ficam dentro de app.asar.unpacked quando empacotado.
function binPath(p) {
  return p ? p.replace('app.asar', 'app.asar.unpacked') : null
}
const FFMPEG = binPath(require('ffmpeg-static')) || 'ffmpeg'
const FFPROBE = binPath(require('ffprobe-static').path) || 'ffprobe'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.gif': 'image/gif',
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  // A interface empacotada é servida por app:// (e não file://) para que workers e o AudioWorklet carreguem como módulos.
  { scheme: 'app', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
])

const DIST = path.join(__dirname, '..', 'dist')
const APP_MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
}

function handleApp(request) {
  const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
  const file = path.normalize(path.join(DIST, rel))
  if (!file.startsWith(DIST + path.sep)) return new Response('forbidden', { status: 403 })
  try {
    const data = fs.readFileSync(file)
    return new Response(data, { headers: { 'Content-Type': APP_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

/** Projeto passado na linha de comando (duplo clique num .edproj). */
function projectFromArgs(argv) {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith('.edproj') && fs.existsSync(a)) || null
}

const thumbDir = path.join(os.tmpdir(), 'miszt-studio-thumbs')

// Serve arquivos locais com suporte a Range, necessário para o <video> buscar posições.
function handleMedia(request) {
  const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1))
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    return new Response('not found', { status: 404 })
  }
  const headers = {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
  }
  const range = request.headers.get('range')
  const match = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (match) {
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
    if (start >= stat.size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
    }
    const stream = fs.createReadStream(filePath, { start, end })
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}` },
    })
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(stat.size) },
  })
}

function mediaUrl(filePath) {
  return 'media://local/' + encodeURIComponent(filePath)
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

async function probe(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath])
  const info = JSON.parse(out)
  const streams = info.streams || []
  const video = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic))
  const audio = streams.find((s) => s.codec_type === 'audio')
  const kind = IMAGE_EXT.has(ext) ? 'image' : video ? 'video' : audio ? 'audio' : null
  if (!kind) throw new Error('Formato sem vídeo ou áudio reconhecível')
  const duration = Number(info.format && info.format.duration) || 0

  let thumb = null
  if (kind === 'video' || kind === 'image') {
    fs.mkdirSync(thumbDir, { recursive: true })
    const thumbPath = path.join(thumbDir, crypto.createHash('sha1').update(filePath).digest('hex') + '.jpg')
    const seek = kind === 'video' ? String(Math.min(1, duration / 2)) : '0'
    try {
      await run(FFMPEG, ['-y', '-ss', seek, '-i', filePath, '-frames:v', '1', '-vf', 'scale=240:-2', thumbPath])
      thumb = mediaUrl(thumbPath)
    } catch {
      thumb = null
    }
  }

  return {
    path: filePath,
    url: mediaUrl(filePath),
    name: path.basename(filePath),
    kind,
    duration: kind === 'image' ? 0 : duration,
    width: video ? video.width : 0,
    height: video ? video.height : 0,
    hasAudio: Boolean(audio),
    thumb,
    codec: video ? video.codec_name : undefined,
    proxy: null,
  }
}

const proxyDir = path.join(os.tmpdir(), 'miszt-studio-proxies')
const proxyJobs = new Map()

/** Gera (ou reaproveita) uma versão 540p leve em H.264 para a prévia. */
function makeProxy(filePath) {
  if (proxyJobs.has(filePath)) return proxyJobs.get(filePath)
  fs.mkdirSync(proxyDir, { recursive: true })
  const stat = fs.statSync(filePath)
  const key = crypto.createHash('sha1').update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest('hex')
  const out = path.join(proxyDir, key + '.mp4')
  if (fs.existsSync(out)) return Promise.resolve(mediaUrl(out))
  const job = (async () => {
    const info = JSON.parse(await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', filePath]))
    const total = Number(info.format && info.format.duration) || 0
    const tmp = out + '.part.mp4'
    await new Promise((resolve, reject) => {
      const proc = spawn(
        FFMPEG,
        ['-y', '-hide_banner', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', tmp],
        { windowsHide: true },
      )
      proc.stderr.on('data', (chunk) => {
        const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(chunk.toString())
        if (m && total > 0 && mainWindow) {
          const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
          mainWindow.webContents.send('proxy:progress', filePath, Math.min(1, t / total))
        }
      })
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Falha ao gerar proxy'))))
    })
    fs.renameSync(tmp, out)
    return mediaUrl(out)
  })()
  proxyJobs.set(filePath, job)
  job.catch(() => {}).finally(() => proxyJobs.delete(filePath))
  return job
}

const autosavePath = () => path.join(app.getPath('userData'), 'autosave.edproj')

// Preferências gerais (ex.: pasta de downloads).
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const DEFAULT_SETTINGS = {
  downloadDir: null,
  recordDir: null,
  exportDir: null,
  autosaveSeconds: 20,
  previewQuality: 'full',
  proxyMode: 'auto',
  checkUpdates: true,
  shortcuts: {},
}
function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
function writeSettings(s) {
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
}

// Projetos recentes (mais novo primeiro).
const recentPath = () => path.join(app.getPath('userData'), 'recent.json')
function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentPath(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function writeRecent(list) {
  fs.writeFileSync(recentPath(), JSON.stringify(list.slice(0, 12), null, 2))
}
function addRecent(filePath) {
  let summary = {}
  try {
    const p = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const duration = (p.clips || []).reduce((m, c) => Math.max(m, c.start + c.duration), 0)
    summary = { width: p.width, height: p.height, duration, clips: (p.clips || []).length }
  } catch {
    // resumo é opcional
  }
  writeRecent([{ path: filePath, name: path.basename(filePath, path.extname(filePath)), openedAt: Date.now(), ...summary }, ...readRecent().filter((r) => r.path !== filePath)])
}

let mainWindow
let exportQueue = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0e0f13',
    title: 'Miszt Studio',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // Barra de título integrada: a toolbar do app ocupa o topo e o Windows desenha só os botões da janela.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#a9afbd', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // O microfone ao vivo e as exportações continuam com a janela minimizada.
      backgroundThrottling: false,
    },
  })
  // Links externos (ex.: textos das licenças Creative Commons) abrem no navegador, nunca dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(creativecommons\.org|www\.jamendo\.com|freesound\.org|ccmixter\.org|wikimedia\.org|commons\.wikimedia\.org|openverse\.org)\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Exportações na fila: pergunta antes de fechar.
  mainWindow.on('close', (e) => {
    if (!exportQueue || !exportQueue.active) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Continuar exportando', 'Sair e cancelar'],
      defaultId: 0,
      cancelId: 0,
      title: 'Exportação em andamento',
      message: 'Há exportações em andamento ou na fila.',
      detail: 'Se sair agora, elas serão canceladas.',
    })
    if (choice === 0) e.preventDefault()
    else for (const j of exportQueue.list()) exportQueue.cancel(j.id)
  })
  if (isDev) mainWindow.loadURL('http://localhost:5173')
  else mainWindow.loadURL('app://bundle/index.html')
}

app.whenReady().then(() => {
  protocol.handle('media', handleMedia)
  protocol.handle('app', handleApp)

  // Microfone para gravação de narração (só a nossa interface pede).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media' || permission === 'clipboard-read'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'clipboard-read')

  ipcMain.handle('recent:list', () =>
    readRecent().map((r) => ({ ...r, exists: fs.existsSync(r.path) })),
  )
  ipcMain.handle('recent:remove', (_e, filePath) => writeRecent(readRecent().filter((r) => r.path !== filePath)))
  ipcMain.handle('project:openPath', (_e, filePath) => {
    const json = fs.readFileSync(filePath, 'utf8')
    addRecent(filePath)
    return { filePath, json }
  })
  ipcMain.handle('shell:show', (_e, filePath) => shell.showItemInFolder(filePath))
  // Só abre o site oficial do VB-CABLE (cabo de áudio virtual usado no microfone ao vivo).
  ipcMain.handle('shell:vbcable', () => shell.openExternal('https://vb-audio.com/Cable/'))
  // Abre a tela de privacidade do microfone do Windows (o usuário decide lá).
  ipcMain.handle('shell:micSettings', () => shell.openExternal(process.platform === 'win32' ? 'ms-settings:privacy-microphone' : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'))

  ipcMain.handle('project:initial', () => {
    const filePath = projectFromArgs(process.argv)
    return filePath ? { filePath, json: fs.readFileSync(filePath, 'utf8') } : null
  })

  ipcMain.handle('media:import', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar mídia',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Mídia', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
        { name: 'Todos', extensions: ['*'] },
      ],
    })
    if (res.canceled) return []
    return probeMany(res.filePaths)
  })

  ipcMain.handle('media:probe', (_e, paths) => probeMany(paths))

  ipcMain.handle('project:save', async (_e, { json, filePath }) => {
    let target = filePath
    if (!target) {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Salvar projeto',
        defaultPath: 'projeto.edproj',
        filters: [{ name: 'Projeto', extensions: ['edproj'] }],
      })
      if (res.canceled) return null
      target = res.filePath
    }
    fs.writeFileSync(target, json, 'utf8')
    addRecent(target)
    return target
  })

  ipcMain.handle('project:open', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Abrir projeto',
      properties: ['openFile'],
      filters: [{ name: 'Projeto', extensions: ['edproj'] }],
    })
    if (res.canceled) return null
    const filePath = res.filePaths[0]
    addRecent(filePath)
    return { filePath, json: fs.readFileSync(filePath, 'utf8') }
  })

  exportQueue = new ExportQueue(FFMPEG, (jobs) => mainWindow && mainWindow.webContents.send('export:jobs', jobs))
  ipcMain.handle('export:start', async (_e, payload) => {
    const format = (payload.options && payload.options.format) || 'mp4'
    const FORMAT_NAMES = { mp4: 'Vídeo MP4', mov: 'Vídeo QuickTime', webm: 'Vídeo WebM', mp3: 'Áudio MP3', wav: 'Áudio WAV' }
    const base = ((payload.options && payload.options.fileName) || 'video').replace(/[\\/:*?"<>|]/g, '_')
    const st = readSettings()
    const dir = st.exportDir || st.lastExportDir
    const res = await dialog.showSaveDialog(mainWindow, {
      title: format === 'mp3' || format === 'wav' ? 'Exportar áudio' : 'Exportar vídeo',
      defaultPath: dir ? path.join(dir, `${base}.${format}`) : `${base}.${format}`,
      filters: [{ name: FORMAT_NAMES[format] || format, extensions: [format] }],
    })
    if (res.canceled || !res.filePath) return null
    // Lembra a última pasta usada (a preferência pode fixar outra).
    writeSettings({ ...readSettings(), lastExportDir: path.dirname(res.filePath) })
    return { id: exportQueue.add(payload, res.filePath), outPath: res.filePath }
  })
  ipcMain.handle('export:cancel', (_e, id) => exportQueue.cancel(id))
  ipcMain.handle('export:clear', (_e, id) => exportQueue.clear(id))
  ipcMain.handle('export:list', () => exportQueue.list())

  ipcMain.handle('media:proxy', (_e, filePath) => makeProxy(filePath))
  ipcMain.handle('audio:key', (_e, filePath, inPoint, duration) => detectKeyFile(FFMPEG, filePath, inPoint, duration))
  ipcMain.handle('media:probePaths', (_e, paths) => probeMany(paths.filter((p) => typeof p === 'string' && fs.existsSync(p))))

  // ---------- Bibliotecas de DJ (rekordbox XML, Traktor NML, Serato, Engine DJ) ----------
  ipcMain.handle('dj:detect', () => detectSources())
  ipcMain.handle('dj:load', async (_e, source, target) => {
    let file = target
    if (!file) {
      const found = detectSources()
      const pickers = {
        rekordbox: { title: 'Escolha o XML exportado pelo rekordbox (Arquivo → Exportar coleção em formato xml)', filters: [{ name: 'Coleção do rekordbox', extensions: ['xml'] }], properties: ['openFile'] },
        traktor: { title: 'Escolha o collection.nml do Traktor', defaultPath: found.traktor, filters: [{ name: 'Coleção do Traktor', extensions: ['nml'] }], properties: ['openFile'] },
        engine: { title: 'Escolha o m.db do Engine DJ (Engine Library/Database2)', defaultPath: found.engine, filters: [{ name: 'Banco do Engine DJ', extensions: ['db'] }], properties: ['openFile'] },
        serato: { title: 'Escolha a pasta das músicas analisadas no Serato', defaultPath: found.serato || app.getPath('music'), properties: ['openDirectory'] },
      }
      const res = await dialog.showOpenDialog(mainWindow, pickers[source])
      if (res.canceled || !res.filePaths[0]) return null
      file = res.filePaths[0]
    }
    return loadLibrary(source, file)
  })

  // ---------- Áudio de estúdio ----------
  const audioTools = new AudioTools(app.getPath('userData'), FFMPEG)
  const sendTools = (msg) => mainWindow && mainWindow.webContents.send('vst:progress', msg)
  const probeOne = async (file) => (await probeMany([file]))[0]
  ipcMain.handle('audio:clean', async (_e, filePath, inPoint, duration, level) => probeOne(await audioTools.clean(filePath, inPoint, duration, level)))
  ipcMain.handle('vst:status', () => audioTools.status())
  ipcMain.handle('vst:install', () => audioTools.install(sendTools))
  ipcMain.handle('vst:scan', () => audioTools.scan())
  ipcMain.handle('vst:editor', (_e, pluginPath, state) => audioTools.editor(pluginPath, state))
  ipcMain.handle('vst:apply', async (_e, filePath, inPoint, duration, pluginPath, state) => probeOne(await audioTools.apply(filePath, inPoint, duration, pluginPath, state)))

  /** Salva uma gravação do microfone (WebM/Opus do MediaRecorder) e converte para WAV. */
  ipcMain.handle('record:save', async (_e, data) => {
    const dir = readSettings().recordDir || path.join(downloader.outDir, 'Gravações')
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const webm = path.join(dir, `Gravação ${stamp}.webm`)
    const wav = webm.replace(/\.webm$/, '.wav')
    fs.writeFileSync(webm, Buffer.from(data))
    await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', webm, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s24le', wav])
    fs.rmSync(webm, { force: true })
    return probeOne(wav)
  })

  // ---------- Gravação de tela (vídeo, áudio do sistema e microfone em arquivos separados) ----------
  // A interface escolhe a fonte; o getDisplayMedia seguinte recebe essa fonte (e o áudio do sistema por loopback).
  let pendingCapture = null
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sel = pendingCapture
    pendingCapture = null
    const source = sel && (await desktopCapturer.getSources({ types: ['screen', 'window'] })).find((s) => s.id === sel.sourceId)
    if (!source) return callback({})
    callback(sel.systemAudio && process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source })
  })
  ipcMain.handle('screen:sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
    return sources
      .filter((s) => !mainWindow || s.id !== mainWindow.getMediaSourceId())
      .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }))
  })
  ipcMain.handle('screen:select', (_e, sourceId, systemAudio) => {
    pendingCapture = { sourceId, systemAudio }
  })
  ipcMain.handle('screen:hotkey', (_e, on) => {
    globalShortcut.unregister('CommandOrControl+Shift+F9')
    if (on) globalShortcut.register('CommandOrControl+Shift+F9', () => mainWindow && mainWindow.webContents.send('screen:stop'))
  })
  ipcMain.handle('screen:minimize', (_e, on) => {
    if (!mainWindow) return
    if (on) mainWindow.minimize()
    else {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // Os pedaços chegam enquanto grava e vão direto para o disco (gravações longas não ficam na memória).
  const screenJobs = new Map()
  ipcMain.handle('screen:begin', (_e, parts) => {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const dir = path.join(readSettings().recordDir || path.join(downloader.outDir, 'Gravações de tela'), `Tela ${stamp}`)
    fs.mkdirSync(dir, { recursive: true })
    const id = crypto.randomUUID()
    const files = {}
    for (const { key, mime } of parts) {
      const raw = path.join(dir, `.${key}.${/mp4/.test(mime) ? 'mp4' : 'webm'}`)
      files[key] = { raw, mime, stream: fs.createWriteStream(raw) }
    }
    screenJobs.set(id, { dir, files })
    return id
  })
  ipcMain.handle('screen:chunk', (_e, id, key, data) => {
    const f = screenJobs.get(id)?.files[key]
    if (!f) return
    return new Promise((resolve, reject) => f.stream.write(Buffer.from(data), (err) => (err ? reject(err) : resolve())))
  })
  const closeJob = (job) => Promise.all(Object.values(job.files).map((f) => new Promise((resolve) => f.stream.end(resolve))))
  ipcMain.handle('screen:discard', async (_e, id) => {
    const job = screenJobs.get(id)
    if (!job) return
    screenJobs.delete(id)
    await closeJob(job)
    fs.rmSync(job.dir, { recursive: true, force: true })
  })
  ipcMain.handle('screen:finish', async (_e, id) => {
    const job = screenJobs.get(id)
    if (!job) throw new Error('Gravação não encontrada')
    screenJobs.delete(id)
    await closeJob(job)
    const out = {}
    const names = { system: 'Áudio do sistema', mic: 'Microfone' }
    for (const [key, f] of Object.entries(job.files)) {
      if (!fs.existsSync(f.raw) || fs.statSync(f.raw).size === 0) continue
      let target
      if (key === 'video') {
        // H.264 vira MP4 sem recompressão (toca leve na prévia); VP8/VP9 ficam em WebM, só com a duração corrigida.
        const h264 = /avc1|h264/i.test(f.mime)
        target = path.join(job.dir, h264 ? 'Tela.mp4' : 'Tela.webm')
        await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', f.raw, '-map', '0:v:0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...(h264 ? ['-movflags', '+faststart'] : []), target])
      } else {
        target = path.join(job.dir, `${names[key] || key}.wav`)
        await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', f.raw, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s24le', target])
      }
      fs.rmSync(f.raw, { force: true })
      out[key] = await probeOne(target)
    }
    return { dir: job.dir, ...out }
  })

  // ---------- Remoção de fundo (máscaras calculadas pela IA na interface) ----------
  const bgJobs = new Map()
  ipcMain.handle('bg:prepare', async (_e, filePath, inPoint, duration) => {
    const info = JSON.parse(await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', filePath]))
    const st = info.streams[0]
    const [num, den] = String(st.r_frame_rate || '30/1').split('/').map(Number)
    const fps = Math.min(60, num / (den || 1)) || 30
    // Análise mais leve: 384 px e no máximo 20 quadros/s (a máscara é ampliada e repetida depois).
    const aFps = Math.min(fps, 20)
    const W = 384
    const H = Math.max(2, Math.round((W * st.height) / st.width / 2) * 2)
    const id = crypto.randomUUID()
    const dir = path.join(app.getPath('userData'), 'bgremove', id)
    fs.mkdirSync(dir, { recursive: true })
    const raw = path.join(dir, 'frames.rgb')
    await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', inPoint.toFixed(3), '-t', duration.toFixed(3), '-i', filePath, '-vf', `fps=${aFps},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
    const frames = Math.floor(fs.statSync(raw).size / (W * H * 3))
    const masks = path.join(dir, 'masks.gray')
    fs.writeFileSync(masks, Buffer.alloc(0))
    bgJobs.set(id, { dir, raw, masks, filePath, inPoint, duration, fps, aFps, W, H, srcW: st.width, srcH: st.height })
    return { id, url: mediaUrl(raw), width: W, height: H, frames, fps: aFps }
  })
  ipcMain.handle('bg:writeMasks', (_e, id, data) => {
    const job = bgJobs.get(id)
    if (job) fs.appendFileSync(job.masks, Buffer.from(data))
  })
  ipcMain.handle('bg:finish', async (_e, id, hasAudio) => {
    const job = bgJobs.get(id)
    if (!job) throw new Error('Tarefa não encontrada')
    const outDir = path.join(app.getPath('userData'), 'bgremoved')
    fs.mkdirSync(outDir, { recursive: true })
    const out = path.join(outDir, `${id}.webm`)
    const audio = hasAudio ? ['-map', '0:a:0?', '-c:a', 'libopus', '-b:a', '160k'] : ['-an']
    // Máscara em baixa resolução, ampliada e suavizada; vira o canal alfa do vídeo original (VP9 com transparência).
    await run(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', job.inPoint.toFixed(3), '-t', job.duration.toFixed(3), '-i', job.filePath,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${job.W}x${job.H}`, '-r', String(job.aFps), '-i', job.masks,
      '-filter_complex', `[0:v]fps=${job.fps},format=rgba[v];[1:v]fps=${job.fps},scale=${job.srcW}:${job.srcH}:flags=bicubic,gblur=sigma=1.2,format=gray[m];[v][m]alphamerge,format=yuva420p[out]`,
      '-map', '[out]', ...audio,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '28', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
      '-shortest', out,
    ])
    fs.rmSync(job.dir, { recursive: true, force: true })
    bgJobs.delete(id)
    const probed = (await probeMany([out]))[0]
    if (probed.ok) probed.media.alpha = true
    return probed
  })
  ipcMain.handle('bg:cancel', (_e, id) => {
    const job = bgJobs.get(id)
    if (job) fs.rmSync(job.dir, { recursive: true, force: true })
    bgJobs.delete(id)
  })

  /** Quadro parado (PNG) da mídia no instante `time` da fonte. */
  ipcMain.handle('media:frame', async (_e, filePath, time) => {
    const dir = path.join(app.getPath('userData'), 'frames')
    fs.mkdirSync(dir, { recursive: true })
    const out = path.join(dir, `${crypto.createHash('sha1').update(`${filePath}|${time.toFixed(3)}`).digest('hex').slice(0, 16)}.png`)
    if (!fs.existsSync(out)) await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', time.toFixed(3), '-i', filePath, '-frames:v', '1', out])
    return (await probeMany([out]))[0]
  })

  /**
   * Versão invertida do trecho [inPoint, inPoint+duration]. Inverte em blocos de 4 s
   * (o filtro reverse guarda o bloco inteiro na memória) e junta os blocos em ordem inversa.
   */
  ipcMain.handle('media:reverse', async (_e, filePath, inPoint, duration, hasAudio) => {
    const key = crypto.createHash('sha1').update(`${filePath}|${inPoint.toFixed(3)}|${duration.toFixed(3)}`).digest('hex').slice(0, 16)
    const dir = path.join(app.getPath('userData'), 'reversed')
    const out = path.join(dir, `${key}.mp4`)
    if (!fs.existsSync(out)) {
      const work = path.join(dir, key)
      fs.mkdirSync(work, { recursive: true })
      const CHUNK = 4
      const count = Math.max(1, Math.ceil(duration / CHUNK))
      const parts = []
      for (let i = 0; i < count; i++) {
        const start = inPoint + i * CHUNK
        const len = Math.min(CHUNK, inPoint + duration - start)
        const part = path.join(work, `p${String(i).padStart(4, '0')}.mp4`)
        const audio = hasAudio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : ['-an']
        await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', filePath, '-vf', 'reverse', ...audio, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', part])
        parts.push(part)
      }
      const list = path.join(work, 'list.txt')
      fs.writeFileSync(list, parts.reverse().map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      await run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out])
      fs.rmSync(work, { recursive: true, force: true })
    }
    return (await probeMany([out]))[0]
  })

  ipcMain.handle('lut:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher LUT',
      properties: ['openFile'],
      filters: [{ name: 'LUT 3D', extensions: ['cube'] }],
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('file:readText', (_e, filePath) => {
    if (path.extname(filePath).toLowerCase() !== '.cube') throw new Error('Somente arquivos .cube')
    return fs.readFileSync(filePath, 'utf8')
  })

  ipcMain.handle('audio:mixdown', (_e, project, sampleRate) => {
    const args = buildMixdownArgs(project, sampleRate)
    return new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG, args, { windowsHide: true })
      const chunks = []
      let err = ''
      proc.stdout.on('data', (c) => chunks.push(c))
      proc.stderr.on('data', (c) => (err += c.toString()))
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error('FFmpeg falhou ao mixar o áudio:\n' + err.slice(-1500)))
        const buf = Buffer.concat(chunks)
        resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      })
    })
  })

  ipcMain.handle('autosave:write', (_e, json) => {
    const file = autosavePath()
    if (json === null) fs.rmSync(file, { force: true })
    else fs.writeFileSync(file, json, 'utf8')
  })

  const settings = readSettings()
  const downloader = new Downloader(app.getPath('userData'), FFMPEG, settings.downloadDir || path.join(app.getPath('videos'), 'Miszt Studio'))
  ipcMain.handle('ytdlp:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolha onde salvar os downloads',
      defaultPath: downloader.outDir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return downloader.outDir
    downloader.outDir = res.filePaths[0]
    writeSettings({ ...readSettings(), downloadDir: downloader.outDir })
    return downloader.outDir
  })
  ipcMain.handle('settings:get', () => ({ ...readSettings(), downloadDir: downloader.outDir, version: app.getVersion(), packaged: app.isPackaged }))
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = { ...readSettings(), ...patch }
    writeSettings(next)
    if (patch.downloadDir) downloader.outDir = patch.downloadDir
    if ('checkUpdates' in patch) updater.setEnabled(!!patch.checkUpdates)
    return { ...next, downloadDir: downloader.outDir, version: app.getVersion(), packaged: app.isPackaged }
  })
  ipcMain.handle('settings:pickFolder', async (_e, title, current) => {
    const res = await dialog.showOpenDialog(mainWindow, { title, defaultPath: current || downloader.outDir, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  const updater = setupUpdater(() => mainWindow, readSettings().checkUpdates)
  ipcMain.handle('update:check', () => updater.check(true))
  ipcMain.handle('update:install', () => updater.install())

  const library = new Library(`MisztStudio/${app.getVersion()}`)
  ipcMain.handle('library:search', (_e, opts) => library.search(opts))
  ipcMain.handle('library:cancel', () => library.cancel())
  ipcMain.handle('library:download', async (_e, item) => {
    const file = await library.download(item, path.join(downloader.outDir, 'Biblioteca CC'), (p) => mainWindow && mainWindow.webContents.send('library:progress', { id: item.id, progress: p }))
    return probeOne(file)
  })
  const sendDl = (msg) => mainWindow && mainWindow.webContents.send('ytdlp:progress', msg)
  ipcMain.handle('ytdlp:status', () => downloader.status())
  ipcMain.handle('ytdlp:install', () => downloader.install(sendDl))
  ipcMain.handle('ytdlp:update', () => downloader.update())
  ipcMain.handle('ytdlp:info', (_e, url) => downloader.info(url))
  ipcMain.handle('ytdlp:search', (_e, query) => downloader.search(query))
  ipcMain.handle('ytdlp:cancel', () => downloader.cancel())
  ipcMain.handle('ytdlp:download', async (_e, url, preset) => {
    const file = await downloader.download(url, preset, sendDl)
    return (await probeMany([file]))[0]
  })

  const stems = new StemEngine(app.getPath('userData'), FFMPEG)
  const sendStems = (msg) => mainWindow && mainWindow.webContents.send('stems:progress', msg)
  ipcMain.handle('stems:status', () => stems.status())
  ipcMain.handle('stems:install', (_e, variant) => stems.install(variant, sendStems))
  ipcMain.handle('stems:cancel', () => stems.cancel())
  ipcMain.handle('stems:separate', async (_e, req) => {
    const result = await stems.separate(req, sendStems)
    const probed = await probeMany(result.map((s) => s.path))
    return result.map((s, i) => ({ name: s.name, probe: probed[i] }))
  })

  ipcMain.handle('autosave:read', () => {
    const file = autosavePath()
    if (!fs.existsSync(file)) return null
    return { json: fs.readFileSync(file, 'utf8'), savedAt: fs.statSync(file).mtimeMs }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

async function probeMany(paths) {
  const results = []
  for (const p of paths) {
    try {
      results.push({ ok: true, media: await probe(p) })
    } catch (err) {
      results.push({ ok: false, path: p, error: String(err.message || err) })
    }
  }
  return results
}

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
