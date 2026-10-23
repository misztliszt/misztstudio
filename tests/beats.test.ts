import { describe, expect, it } from 'vitest'
import { detectBeats } from '../src/beats'

/** Envoltória de picos (100 por segundo) de um bumbo a cada batida, com um tom de fundo. */
function kicks(bpm: number, seconds = 60, offset = 0.2) {
  const n = seconds * 100
  const peaks = new Float32Array(n)
  const beat = 60 / bpm
  for (let i = 0; i < n; i++) {
    const t = i / 100
    const since = (((t - offset) % beat) + beat) % beat
    peaks[i] = 0.25 + 0.7 * Math.exp(-since * 22) * (t >= offset ? 1 : 0)
  }
  return peaks
}

describe('detecção de batidas', () => {
  it.each([128, 124, 100, 87.5, 140, 174 / 2])('%s BPM com precisão de 0,1', (bpm) => {
    const g = detectBeats(kicks(bpm))
    expect(g).not.toBeNull()
    expect(Math.abs(g!.bpm - bpm)).toBeLessThan(0.1)
  })
  it('acha a fase da primeira batida', () => {
    const g = detectBeats(kicks(120, 60, 0.3))!
    const beat = 60 / g.bpm
    const err = Math.abs((((g.offset - 0.3) % beat) + beat) % beat)
    expect(Math.min(err, beat - err)).toBeLessThan(0.02)
  })
})
