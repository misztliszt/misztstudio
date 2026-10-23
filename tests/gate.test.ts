import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { GateCore } = require('../src/dsp/gate.worklet.js')

const SR = 48000
const db = (x: Float32Array, from: number, to: number) => {
  let s = 0
  for (let i = Math.round(from); i < Math.round(to); i++) s += x[i] * x[i]
  return 10 * Math.log10(s / (to - from) + 1e-20)
}

/** 1 s de ruído baixo (−60 dB), 1 s de "voz" (seno a −20 dB) e 1 s de ruído de novo. */
function signal() {
  const x = new Float32Array(SR * 3)
  let seed = 1
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * 0.001
  for (let i = 0; i < x.length; i++) x[i] = noise() + (i >= SR && i < 2 * SR ? 0.1 * Math.sin((2 * Math.PI * 220 * i) / SR) : 0)
  return x
}

function run(params: Record<string, unknown>) {
  const core = new GateCore(SR)
  core.setParams(params)
  const x = signal()
  for (let f = 0; f < x.length; f += 128) core.process([x.subarray(f, f + 128)], Math.min(128, x.length - f))
  return x
}

describe('noise gate', () => {
  it('corta o ruído entre as frases e deixa a voz passar', () => {
    const before = signal()
    const out = run({ enabled: true, threshold: -40, range: -60 })
    // Ruído depois que o gate fecha (meio do último segundo): ~60 dB mais baixo.
    expect(db(before, 2.5 * SR, 3 * SR) - db(out, 2.5 * SR, 3 * SR)).toBeGreaterThan(50)
    // Voz praticamente intacta.
    expect(Math.abs(db(before, 1.1 * SR, 1.9 * SR) - db(out, 1.1 * SR, 1.9 * SR))).toBeLessThan(0.5)
  })
  it('respeita o quanto abaixar quando fecha', () => {
    const before = signal()
    const out = run({ enabled: true, threshold: -40, range: -12 })
    expect(db(before, 2.5 * SR, 3 * SR) - db(out, 2.5 * SR, 3 * SR)).toBeCloseTo(12, 0)
  })
  it('desligado não muda nada', () => {
    const before = signal()
    const out = run({ enabled: false })
    expect(db(out, 0, out.length)).toBeCloseTo(db(before, 0, before.length), 5)
  })
})
