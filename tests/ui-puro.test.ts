import { describe, expect, it } from 'vitest'
import { formatTime } from '../src/format'
import { camelotOf, compatible, shiftCamelot } from '../src/components/dj/harmonic'
import { segmentsToClips } from '../src/dj'

describe('formatTime', () => {
  it('mostra o décimo certo mesmo com erro de ponto flutuante', () => {
    expect(formatTime(2.3)).toBe('00:02.3') // 2,3 % 1 = 0,2999… e mostrava ".2"
    expect(formatTime(0.1 + 0.2)).toBe('00:00.3')
    expect(formatTime(61.7)).toBe('01:01.7')
    expect(formatTime(59.99)).toBe('00:59.9')
  })
  it('sem fração, e com valores estranhos', () => {
    expect(formatTime(125.9, false)).toBe('02:05')
    expect(formatTime(-5)).toBe('00:00.0')
    expect(formatTime(NaN)).toBe('00:00.0')
    expect(formatTime(Infinity)).toBe('00:00.0')
  })
})

describe('mixagem harmônica (Camelot)', () => {
  it('códigos conhecidos', () => {
    expect(camelotOf(0, 'major')).toBe('8B') // Dó maior
    expect(camelotOf(9, 'minor')).toBe('8A') // Lá menor
    expect(camelotOf(5, 'minor')).toBe('4A') // Fá menor
  })
  it('compatíveis: mesmo número, vizinhos e relativa; incompatíveis: o resto', () => {
    expect(compatible('8A', '8B')).toBe(true)
    expect(compatible('8A', '9A')).toBe(true)
    expect(compatible('12A', '1A')).toBe(true) // dá a volta na roda
    expect(compatible('8A', '10A')).toBe(false)
    expect(compatible('8A', '9B')).toBe(false)
  })
  it('subir um tom sem trava de tom muda o código', () => {
    expect(shiftCamelot({ key: 0, mode: 'major' }, 2).camelot).toBe('10B') // Ré maior
    expect(shiftCamelot({ key: 0, mode: 'major' }, -1).key).toBe(11)
  })
})

describe('set de DJ → clipes', () => {
  it('o volume do clipe é o pico e a automação é relativa', () => {
    const [c] = segmentsToClips([{ mediaId: 'm', at: 2, in: 10, speed: 1.0004, duration: 8 }], [{ t: 0, v: 1 }, { t: 4, v: 0.5 }, { t: 12, v: 0.25 }], 100)
    expect(c.start).toBe(102)
    expect(c.in).toBe(10)
    expect(c.speed).toBe(1)
    expect(c.volume).toBe(1)
    // gainLog em t=4 cai dentro do segmento [2, 10]: instante 2 s do clipe, valor 0,5
    expect(c.volumeKeys).toEqual([{ t: 0, v: 1 }, { t: 2, v: 0.5 }])
  })
  it('sem registro de volume, o clipe fica em volume 1 e sem automação', () => {
    const [c] = segmentsToClips([{ mediaId: 'm', at: 0, in: 0, speed: 1, duration: 5 }], [], 0)
    expect(c.volume).toBe(1)
    expect(c.volumeKeys).toEqual([])
  })
})
