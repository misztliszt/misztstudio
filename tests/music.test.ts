import { describe, expect, it } from 'vitest'
import { hzToMidi, midiToName, semitonesBetween } from '../src/music'

describe('tons', () => {
  it('Si maior → Dó maior sobe 1 semitom', () => expect(semitonesBetween(11, 'major', 0, 'major')).toBe(1))
  it('Dó maior → Si♭ maior desce 2 semitons', () => expect(semitonesBetween(0, 'major', 10, 'major')).toBe(-2))
  it('Lá menor ≡ Dó maior (relativas)', () => expect(semitonesBetween(9, 'minor', 0, 'major')).toBe(0))
  it('caminho mais curto fica entre −6 e +6', () => {
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) expect(Math.abs(semitonesBetween(a, 'major', b, 'major'))).toBeLessThanOrEqual(6)
  })
  it('nomes de nota', () => {
    expect(midiToName(69)).toBe('A4')
    expect(midiToName(60)).toBe('C4')
    expect(hzToMidi(440)).toBeCloseTo(69)
  })
})
