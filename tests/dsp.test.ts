import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { AutoTuneCore } = require('../src/dsp/autotune-core.js')

const SR = 48000

/** Passa um seno pelo núcleo de afinação (blocos de 128, como no AudioWorklet). */
function run(hz: number, params: Record<string, unknown>, seconds = 2) {
  const core = new AutoTuneCore(SR)
  core.setParams(params)
  const n = Math.floor(SR * seconds)
  const out = new Float32Array(n)
  const inL = new Float32Array(128)
  const inR = new Float32Array(128)
  const oL = new Float32Array(128)
  const oR = new Float32Array(128)
  for (let f = 0; f < n; f += 128) {
    for (let i = 0; i < 128; i++) inL[i] = inR[i] = 0.5 * Math.sin((2 * Math.PI * hz * (f + i)) / SR)
    core.process(inL, inR, oL, oR, 128)
    out.set(oL.subarray(0, Math.min(128, n - f)), f)
  }
  return out
}

/** Frequência dominante no último meio segundo (varredura de DFT: grossa e depois fina). */
function pitchOf(x: Float32Array) {
  const seg = x.subarray(x.length - SR / 2)
  const power = (hz: number) => {
    let re = 0
    let im = 0
    for (let i = 0; i < seg.length; i += 2) {
      const w = (2 * Math.PI * hz * i) / SR
      re += seg[i] * Math.cos(w)
      im += seg[i] * Math.sin(w)
    }
    return re * re + im * im
  }
  const scan = (from: number, to: number, step: number) => {
    let best = from
    let bestP = -1
    for (let hz = from; hz <= to; hz += step) {
      const p = power(hz)
      if (p > bestP) [best, bestP] = [hz, p]
    }
    return best
  }
  const coarse = scan(80, 1000, 1)
  return scan(coarse - 1, coarse + 1, 0.02)
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

describe('afinação automática', () => {
  it('puxa 452 Hz (meio desafinado) para Lá 440 Hz', () => {
    const f = pitchOf(run(452, { enabled: true, key: 0, scale: 'chromatic', speed: 1, mix: 1 }))
    expect(Math.abs(cents(f, 440))).toBeLessThan(5)
  })
  it('na escala de Dó maior, Lá♯ vira Lá ou Si', () => {
    const f = pitchOf(run(466.16, { enabled: true, key: 0, scale: 'major', speed: 1, mix: 1 }))
    const near = Math.min(Math.abs(cents(f, 440)), Math.abs(cents(f, 493.88)))
    expect(near).toBeLessThan(5)
  })
  it('desligada deixa o som igual', () => {
    const f = pitchOf(run(452, { enabled: false }))
    expect(Math.abs(cents(f, 452))).toBeLessThan(3)
  })
})

describe('transposição', () => {
  it('+2 semitons: 440 → 493,9 Hz', () => {
    const f = pitchOf(run(440, { enabled: false, transpose: 2 }))
    expect(Math.abs(cents(f, 493.88))).toBeLessThan(5)
  })
  it('−12 semitons: 440 → 220 Hz', () => {
    const f = pitchOf(run(440, { enabled: false, transpose: -12 }))
    expect(Math.abs(cents(f, 220))).toBeLessThan(5)
  })
})
