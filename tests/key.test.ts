import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { detectKey, camelot, compatibleCamelot } = require('../src/dsp/key-core.js')

const SR = 22050
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** Sequência de acordes (notas MIDI) com timbre de harmônicos, 2 s por acorde, repetida. */
function progression(chords: number[][], repeats = 3) {
  const per = SR * 2
  const out = new Float32Array(per * chords.length * repeats)
  chords.forEach((notes, ci) => {
    for (let r = 0; r < repeats; r++) {
      const off = (r * chords.length + ci) * per
      for (const n of notes)
        for (let h = 1; h <= 6; h++)
          for (let i = 0; i < per; i++) out[off + i] += (0.15 / h) * Math.sin((2 * Math.PI * hz(n) * h * i) / SR) * Math.min(1, i / 500, (per - i) / 500)
    }
  })
  return out
}

describe('detecção de tom', () => {
  it('Fá menor (i–VI–VII–i) → Fá menor, 4A', () => {
    // Fm, D♭, E♭, Fm (com o baixo uma oitava abaixo)
    const r = detectKey(progression([[41, 53, 56, 60], [37, 53, 56, 61], [39, 55, 58, 63], [41, 53, 56, 60]]), SR)
    expect(r).toMatchObject({ key: 5, mode: 'minor', camelot: '4A' })
  })
  it('Fá menor harmônica (i–iv–V–i) → Fá menor', () => {
    // Fm, B♭m, C (com Mi natural, a sensível), Fm
    const r = detectKey(progression([[41, 53, 56, 60], [46, 53, 58, 61], [48, 55, 60, 64], [41, 53, 56, 60]]), SR)
    expect(r).toMatchObject({ key: 5, mode: 'minor' })
  })
  it('acordes ambíguos (Fm–D♭–A♭–E♭) indicam a relativa como alternativa', () => {
    const r = detectKey(progression([[41, 53, 56, 60], [37, 53, 56, 61], [44, 56, 60, 63], [39, 55, 58, 63]]), SR)
    const both = [r.camelot, r.alternative?.camelot].sort()
    expect(both).toEqual(['4A', '4B'])
  })
  it('Dó maior (I–V–vi–IV) → Dó maior, 8B', () => {
    const r = detectKey(progression([[48, 60, 64, 67], [43, 59, 62, 67], [45, 57, 60, 64], [41, 57, 60, 65]]), SR)
    expect(r).toMatchObject({ key: 0, mode: 'major', camelot: '8B' })
  })
  it('Si maior (I–IV–V–I) → Si maior, 1B', () => {
    const r = detectKey(progression([[47, 59, 63, 66], [40, 59, 64, 68], [42, 58, 61, 66], [47, 59, 63, 66]]), SR)
    expect(r).toMatchObject({ key: 11, mode: 'major', camelot: '1B' })
  })
  it('silêncio não tem tom', () => expect(detectKey(new Float32Array(SR * 4), SR)).toBeNull())
  it('roda Camelot', () => {
    expect(camelot(9, 'minor')).toBe('8A')
    expect(camelot(7, 'major')).toBe('9B')
    expect(camelot(10, 'major')).toBe('6B')
    expect(compatibleCamelot('12A')).toEqual(['12A', '1A', '11A', '12B'])
  })
})
