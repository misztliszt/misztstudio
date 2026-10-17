// Rasteriza build/icon.svg em build/icon.png (512×512) usando o Chromium do próprio Electron.
// Uso: npm run icon   (equivale a: electron scripts/make-icon.cjs)
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 512
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.writeFileSync(out, image.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG())
  console.log('ícone gerado:', out, image.getSize())
  app.quit()
})
