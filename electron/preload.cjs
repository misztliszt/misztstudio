const { contextBridge, ipcRenderer, webUtils } = require('electron')

const subscribe = (channel, cb) => {
  const listener = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', {
  importMedia: () => ipcRenderer.invoke('media:import'),
  probeFiles: (files) => ipcRenderer.invoke('media:probe', files.map((f) => webUtils.getPathForFile(f))),
  saveProject: (json, filePath) => ipcRenderer.invoke('project:save', { json, filePath }),
  openProject: () => ipcRenderer.invoke('project:open'),
  initialProject: () => ipcRenderer.invoke('project:initial'),
  openProjectPath: (path) => ipcRenderer.invoke('project:openPath', path),
  recentProjects: () => ipcRenderer.invoke('recent:list'),
  removeRecent: (path) => ipcRenderer.invoke('recent:remove', path),
  showInFolder: (path) => ipcRenderer.invoke('shell:show', path),
  platform: process.platform,
  exportVideo: (payload) => ipcRenderer.invoke('export:start', payload),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb) => subscribe('export:progress', cb),
  makeProxy: (path) => ipcRenderer.invoke('media:proxy', path),
  extractFrame: (path, time) => ipcRenderer.invoke('media:frame', path, time),
  reverseMedia: (path, inPoint, duration, hasAudio) => ipcRenderer.invoke('media:reverse', path, inPoint, duration, hasAudio),
  onProxyProgress: (cb) => subscribe('proxy:progress', cb),
  pickLut: () => ipcRenderer.invoke('lut:pick'),
  readText: (path) => ipcRenderer.invoke('file:readText', path),
  mixdown: (project, sampleRate) => ipcRenderer.invoke('audio:mixdown', project, sampleRate),
  autosave: (json) => ipcRenderer.invoke('autosave:write', json),
  readAutosave: () => ipcRenderer.invoke('autosave:read'),
  ytdlpStatus: () => ipcRenderer.invoke('ytdlp:status'),
  ytdlpInstall: () => ipcRenderer.invoke('ytdlp:install'),
  ytdlpUpdate: () => ipcRenderer.invoke('ytdlp:update'),
  ytdlpInfo: (url) => ipcRenderer.invoke('ytdlp:info', url),
  ytdlpDownload: (url, preset) => ipcRenderer.invoke('ytdlp:download', url, preset),
  ytdlpCancel: () => ipcRenderer.invoke('ytdlp:cancel'),
  ytdlpPickFolder: () => ipcRenderer.invoke('ytdlp:pickFolder'),
  onYtdlpProgress: (cb) => subscribe('ytdlp:progress', cb),
  stemsStatus: () => ipcRenderer.invoke('stems:status'),
  installStems: (variant) => ipcRenderer.invoke('stems:install', variant),
  separateStems: (req) => ipcRenderer.invoke('stems:separate', req),
  cancelStems: () => ipcRenderer.invoke('stems:cancel'),
  onStemsProgress: (cb) => subscribe('stems:progress', cb),
})
