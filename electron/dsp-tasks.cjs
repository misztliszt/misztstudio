// Tarefas de processamento de áudio pesadas da exportação (afinação e curva de ducking).
// Rodam numa thread à parte (worker_threads) para não congelar a janela nem o cancelamento da exportação.

const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { AutoTuneCore } = require('../src/dsp/autotune-core.js')

const SR = 48000
const DUCK_THRESHOLD = 0.01
const DUCK_ATTACK = 0.05
const DUCK_RELEASE = 0.4

/** Aplica afinação/transposição a um arquivo PCM f32le estéreo intercalado. */
function processPitch(rawIn, rawOut, fx) {
  const data = fs.readFileSync(rawIn)
  const pcm = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
  const frames = pcm.length >> 1
  const core = new AutoTuneCore(SR)
  core.setParams({ ...fx.autotune, transpose: fx.transpose })
  const BLOCK = 128
  const inL = new Float32Array(BLOCK)
  const inR = new Float32Array(BLOCK)
  const outL = new Float32Array(BLOCK)
  const outR = new Float32Array(BLOCK)
  const out = new Float32Array(pcm.length)
  for (let f = 0; f < frames; f += BLOCK) {
    const len = Math.min(BLOCK, frames - f)
    for (let i = 0; i < len; i++) {
      inL[i] = pcm[(f + i) * 2]
      inR[i] = pcm[(f + i) * 2 + 1]
    }
    if (len < BLOCK) {
      inL.fill(0, len)
      inR.fill(0, len)
    }
    core.process(inL, inR, outL, outR, BLOCK)
    for (let i = 0; i < len; i++) {
      out[(f + i) * 2] = outL[i]
      out[(f + i) * 2 + 1] = outR[i]
    }
  }
  fs.writeFileSync(rawOut, Buffer.from(out.buffer))
}

/**
 * Curva de ganho do ducking a partir da trilha de voz (PCM f32le estéreo):
 * RMS em blocos de 10 ms; acima de −40 dBFS abaixa `depth` dB, com ataque de 50 ms e
 * liberação de 400 ms. Igual ao seguidor de envelope da prévia (src/audio.ts).
 */
function writeDuckCurve(sourceRaw, outFile, depth) {
  const data = fs.readFileSync(sourceRaw)
  const pcm = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
  const frames = pcm.length >> 1
  const BLOCK = SR / 100
  const low = Math.pow(10, -Math.abs(depth) / 20)
  const out = new Float32Array(frames * 2)
  let cur = 1
  for (let b = 0; b * BLOCK < frames; b++) {
    const s = b * BLOCK
    const e = Math.min(frames, s + BLOCK)
    let sum = 0
    for (let f = s; f < e; f++) {
      const m = (pcm[f * 2] + pcm[f * 2 + 1]) * 0.5
      sum += m * m
    }
    const rms = Math.sqrt(sum / Math.max(1, e - s))
    const target = rms > DUCK_THRESHOLD ? low : 1
    const tc = target < cur ? DUCK_ATTACK : DUCK_RELEASE
    const next = cur + (target - cur) * (1 - Math.exp(-0.01 / tc))
    for (let f = s; f < e; f++) {
      const g = cur + ((next - cur) * (f - s)) / (e - s)
      out[f * 2] = g
      out[f * 2 + 1] = g
    }
    cur = next
  }
  fs.writeFileSync(outFile, Buffer.from(out.buffer))
}

const TASKS = { processPitch, writeDuckCurve }

/** Roda uma tarefa numa thread separada; se a thread não puder ser criada, roda aqui mesmo. */
function runDsp(task, ...args) {
  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = new Worker(path.join(__dirname, 'dsp-worker.cjs'), { workerData: { task, args } })
    } catch {
      return resolveInline()
    }
    let settled = false
    const finish = (fn, v) => {
      if (settled) return
      settled = true
      fn(v)
    }
    worker.once('message', (m) => (m.ok ? finish(resolve) : finish(reject, new Error(m.error))))
    worker.once('error', () => {
      // Sem thread disponível (ex.: caminho dentro do pacote): faz no processo principal, como antes.
      if (!settled) {
        settled = true
        resolveInline()
      }
    })
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(reject, new Error('O processamento de áudio parou de forma inesperada'))
    })
    function resolveInline() {
      try {
        TASKS[task](...args)
        resolve()
      } catch (err) {
        reject(err)
      }
    }
  })
}

module.exports = { processPitch, writeDuckCurve, runDsp, TASKS, SR }
