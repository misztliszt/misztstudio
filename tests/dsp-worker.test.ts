import { afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { runDsp, processPitch } = require('../electron/dsp-tasks.cjs')
const SR = 48000

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-dsp-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function tone(seconds: number, freq: number) {
  const n = SR * seconds
  const pcm = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) pcm[i * 2] = pcm[i * 2 + 1] = 0.4 * Math.sin((2 * Math.PI * freq * i) / SR)
  return Buffer.from(pcm.buffer)
}
const fx = { autotune: { enabled: true, key: 0, scale: 'chromatic', speed: 1, mix: 1 }, transpose: 2 }

describe('processamento de áudio da exportação em outra thread', () => {
  it('dá o mesmo resultado que rodar no processo principal', async () => {
    const input = path.join(dir, 'in.raw')
    fs.writeFileSync(input, tone(2, 330))
    await runDsp('processPitch', input, path.join(dir, 'worker.raw'), fx)
    processPitch(input, path.join(dir, 'inline.raw'), fx)
    expect(fs.readFileSync(path.join(dir, 'worker.raw')).equals(fs.readFileSync(path.join(dir, 'inline.raw')))).toBe(true)
  })

  it('não bloqueia o processo principal enquanto processa', async () => {
    const input = path.join(dir, 'long.raw')
    fs.writeFileSync(input, tone(40, 220))
    let ticks = 0
    const timer = setInterval(() => ticks++, 20)
    const t0 = Date.now()
    await runDsp('processPitch', input, path.join(dir, 'long-out.raw'), fx)
    clearInterval(timer)
    const took = Date.now() - t0
    // Se o processamento rodasse aqui, o intervalo quase não dispararia durante a espera.
    expect(took).toBeGreaterThan(200)
    expect(ticks).toBeGreaterThan(took / 20 / 3)
  }, 60000)

  it('erro na tarefa vira uma rejeição com mensagem', async () => {
    await expect(runDsp('processPitch', path.join(dir, 'nao-existe.raw'), path.join(dir, 'x.raw'), fx)).rejects.toThrow(/ENOENT|no such file|não/i)
  })
})
