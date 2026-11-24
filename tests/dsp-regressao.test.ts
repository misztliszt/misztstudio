import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { AutoTuneCore } = require('../src/dsp/autotune-core.js')
const SR = 48000
const BLOCK = 128

/** Roda o núcleo com um sinal dado por função (amostra → valor) e parâmetros que podem mudar no tempo. */
function run(seconds: number, signal: (i: number) => number, params: (i: number) => Record<string, unknown>) {
  const core = new AutoTuneCore(SR)
  const n = Math.floor(SR * seconds)
  const out = new Float32Array(n)
  const inL = new Float32Array(BLOCK)
  const outL = new Float32Array(BLOCK)
  for (let f = 0; f < n; f += BLOCK) {
    core.setParams(params(f))
    for (let i = 0; i < BLOCK; i++) inL[i] = signal(f + i)
    core.process(inL, null, outL, null, BLOCK)
    out.set(outL.subarray(0, Math.min(BLOCK, n - f)), f)
  }
  return out
}

/** Frequência instantânea (Hz) por período entre cruzamentos ascendentes do zero, com o instante em s. */
function instantFreqs(out: Float32Array) {
  const ups: number[] = []
  for (let i = 1; i < out.length; i++) if (out[i - 1] <= 0 && out[i] > 0) ups.push(i - 1 + -out[i - 1] / (out[i] - out[i - 1]))
  const res: { t: number; f: number }[] = []
  for (let k = 1; k < ups.length; k++) res.push({ t: ups[k] / SR, f: SR / (ups[k] - ups[k - 1]) })
  return res
}

const on = { enabled: true, key: 0, scale: 'chromatic', speed: 1, mix: 1, transpose: 0 }

describe('afinação: voz que volta ao tom certo', () => {
  it('depois de uma correção, a nota afinada não desafina por causa do deslocamento interno', () => {
    let phase = 0
    const out = run(1.2, (i) => {
      phase += (2 * Math.PI * (i < SR * 0.4 ? 452 : 440)) / SR
      return 0.5 * Math.sin(phase)
    }, () => on)
    const after = instantFreqs(out).filter((x) => x.t > 0.6)
    expect(after.length).toBeGreaterThan(100)
    const worst = Math.max(...after.map((x) => Math.abs(1200 * Math.log2(x.f / 440))))
    expect(worst).toBeLessThan(5) // cents (antes da correção do código passava de 100)
  })
})

describe('afinação: ligar e desligar', () => {
  it('ao religar não sai som antigo dos buffers', () => {
    // 0–0,2 s: tom ligado; 0,2–0,5 s: desligado com silêncio; depois religa com silêncio na entrada.
    const out = run(0.7, (i) => (i < SR * 0.2 ? 0.8 * Math.sin((2 * Math.PI * 300 * i) / SR) : 0), (i) => ({ ...on, enabled: i < SR * 0.2 || i >= SR * 0.5 }))
    const from = Math.floor(SR * 0.5)
    let peak = 0
    for (let i = from; i < from + Math.floor(SR * 0.04); i++) peak = Math.max(peak, Math.abs(out[i]))
    expect(peak).toBeLessThan(0.01)
  })

  it('desligado devolve o mesmo som', () => {
    const sig = (i: number) => 0.5 * Math.sin((2 * Math.PI * 523 * i) / SR)
    const out = run(0.1, sig, () => ({ ...on, enabled: false }))
    for (let i = 0; i < out.length; i += 97) expect(out[i]).toBeCloseTo(Math.fround(sig(i)), 5)
  })
})
