import { describe, expect, it } from 'vitest'
import { interpolate, removeKey, upsertKey } from '../src/anim'

describe('keyframes', () => {
  const keys = [
    { t: 0, v: 0, ease: 'linear' as const },
    { t: 2, v: 10, ease: 'linear' as const },
  ]
  it('linear no meio', () => expect(interpolate(keys, 1)).toBeCloseTo(5))
  it('antes e depois dos pontos ficam presos', () => {
    expect(interpolate(keys, -1)).toBe(0)
    expect(interpolate(keys, 5)).toBe(10)
  })
  it('segurar não interpola', () => expect(interpolate([{ t: 0, v: 0, ease: 'hold' }, { t: 2, v: 10, ease: 'linear' }], 1.9)).toBe(0))
  it('suave é simétrica no meio', () => expect(interpolate([{ t: 0, v: 0, ease: 'ease' }, { t: 2, v: 10, ease: 'ease' }], 1)).toBeCloseTo(5))
  it('upsert substitui no mesmo instante e mantém a ordem', () => {
    const k = upsertKey(upsertKey(upsertKey([], 2, 1), 0, 0), 2, 5)
    expect(k.map((x) => [x.t, x.v])).toEqual([
      [0, 0],
      [2, 5],
    ])
    expect(removeKey(k, 0)).toHaveLength(1)
  })
})
