import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { cleanFilter, CLEAN } = require('../electron/audiotools.cjs')

describe('limpeza de voz', () => {
  it('os níveis prontos geram as mesmas cadeias de antes', () => {
    expect(cleanFilter(CLEAN.light)).toBe('highpass=f=70,afftdn=nr=8.0:nf=-40:tn=1')
    expect(cleanFilter(CLEAN.strong)).toBe('highpass=f=90,afftdn=nr=24.0:nf=-30:tn=1,anlmdn=s=7.0:p=0.002:r=0.006,adeclick')
  })
  it('ajuste fino: desliga partes e limita os valores', () => {
    expect(cleanFilter({ reduction: 0, floor: -35, highpass: 0, deep: 0, declick: false })).toBe('anull')
    expect(cleanFilter({ reduction: 200, floor: -5, highpass: 120, deep: 50, declick: true })).toBe('highpass=f=120,afftdn=nr=97.0:nf=-20:tn=1,anlmdn=s=20.0:p=0.002:r=0.006,adeclick')
  })
})
