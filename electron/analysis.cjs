// Análises de áudio feitas no processo principal (decodificação pelo FFmpeg).

const { spawn } = require('node:child_process')
const { detectKey } = require('../src/dsp/key-core.js')

/** Decodifica um trecho como PCM mono float32. */
function decodeMono(ffmpeg, filePath, { inPoint = 0, duration = 0, sampleRate = 22050 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', ...(inPoint > 0 ? ['-ss', String(inPoint)] : []), '-i', filePath, ...(duration > 0 ? ['-t', String(duration)] : []), '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-']
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    const chunks = []
    let err = ''
    proc.stdout.on('data', (c) => chunks.push(c))
    proc.stderr.on('data', (c) => (err = (err + c).slice(-2000)))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `FFmpeg saiu com código ${code}`))
      const buf = Buffer.concat(chunks)
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)))
    })
  })
}

/** Tom da música (no máximo os primeiros 6 minutos do trecho, que bastam para estimar). */
async function detectKeyFile(ffmpeg, filePath, inPoint = 0, duration = 0) {
  const sampleRate = 22050
  const samples = await decodeMono(ffmpeg, filePath, { inPoint, duration: duration > 0 ? Math.min(duration, 360) : 360, sampleRate })
  const r = detectKey(samples, sampleRate)
  if (!r) return null
  return { key: r.key, mode: r.mode, camelot: r.camelot, confidence: Math.round(r.confidence * 100) / 100, alternative: r.alternative }
}

module.exports = { decodeMono, detectKeyFile }
