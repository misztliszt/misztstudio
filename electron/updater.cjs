// Atualização automática pelas Releases do GitHub (electron-updater).
// Só funciona no app instalado; em desenvolvimento informa "indisponível".

const { app } = require('electron')

/**
 * @param {() => Electron.BrowserWindow | null} getWindow
 * @param {boolean} enabled verificar sozinho ao abrir (preferência)
 */
function setupUpdater(getWindow, enabled) {
  let status = { state: app.isPackaged ? 'idle' : 'unavailable', version: null, progress: 0, error: null }
  // Mensagens do electron-updater em português e sem detalhes técnicos.
  const friendly = (err) => {
    const msg = String((err && err.message) || err)
    if (/\b404\b/.test(msg)) return 'nenhuma versão publicada foi encontrada no GitHub (o repositório precisa ser público e ter uma Release).'
    if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::/i.test(msg)) return 'sem conexão com o GitHub.'
    return msg.split('\n')[0]
  }
  const send = (patch) => {
    status = { ...status, ...patch }
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update:status', status)
  }

  if (!app.isPackaged) {
    return { check: async () => status, install: () => {}, setEnabled: () => {} }
  }

  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send({ state: 'checking', error: null }))
  autoUpdater.on('update-available', (info) => send({ state: 'downloading', version: info.version, progress: 0 }))
  autoUpdater.on('update-not-available', () => send({ state: 'latest' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', progress: p.percent / 100 }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version, progress: 1 }))
  autoUpdater.on('error', (err) => send({ state: 'error', error: friendly(err) }))

  const check = async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      send({ state: 'error', error: friendly(err) })
    }
    return status
  }
  // Verifica alguns segundos depois de abrir (sem atrasar a introdução) e depois a cada 6 horas.
  let timer = null
  const setEnabled = (on) => {
    if (timer) clearInterval(timer)
    timer = null
    if (!on) return
    setTimeout(check, 15000)
    timer = setInterval(check, 6 * 3600 * 1000)
  }
  setEnabled(enabled)

  return {
    check,
    install: () => autoUpdater.quitAndInstall(false, true),
    setEnabled,
  }
}

module.exports = { setupUpdater }
