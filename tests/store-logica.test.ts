import { describe, expect, it } from 'vitest'
import type { Project } from '../src/types'
import { reduce } from '../src/store'
import { clip, emptyProject, media } from './helpers'

const base = (): Project => {
  const p = emptyProject()
  return { ...p, media: { a: media('a', 'video', 30), s: media('s', 'audio', 30) } }
}
const V = (p: Project) => p.tracks[0].id
const A = (p: Project) => p.tracks[1].id

describe('mover vários clipes juntos', () => {
  const setup = () => {
    const p = base()
    return { ...p, clips: [clip({ id: 'c1', mediaId: 'a', trackId: V(p), start: 2, duration: 2 }), clip({ id: 'c2', mediaId: 'a', trackId: V(p), start: 5, duration: 2 }), clip({ id: 'c3', mediaId: 'a', trackId: V(p), start: 10, duration: 2 })] }
  }
  it('mantém a distância entre os clipes selecionados', () => {
    const r = reduce(setup(), { type: 'moveClips', ids: ['c1', 'c2'], delta: 1 })
    expect(r.clips.map((c) => [c.id, c.start])).toEqual([['c1', 3], ['c2', 6], ['c3', 10]])
  })
  it('não passa do zero (o primeiro encosta no início)', () => {
    const r = reduce(setup(), { type: 'moveClips', ids: ['c1', 'c2'], delta: -10 })
    expect(r.clips.map((c) => c.start)).toEqual([0, 3, 10])
  })
  it('se um deles bater num clipe fora da seleção, nada se move', () => {
    const p = setup()
    expect(reduce(p, { type: 'moveClips', ids: ['c1', 'c2'], delta: 4 })).toBe(p)
  })
  it('clipes em trilhas diferentes andam juntos', () => {
    const p = base()
    const q = { ...p, clips: [clip({ id: 'v', mediaId: 'a', trackId: V(p), start: 1, duration: 2 }), clip({ id: 'au', mediaId: 's', trackId: A(p), start: 1, duration: 2 })] }
    const r = reduce(q, { type: 'moveClips', ids: ['v', 'au'], delta: 2 })
    expect(r.clips.map((c) => c.start)).toEqual([3, 3])
  })
})

describe('congelar quadro', () => {
  const setup = () => {
    const p = base()
    return { ...p, clips: [clip({ id: 'c1', mediaId: 'a', trackId: V(p), start: 0, duration: 4 })] }
  }
  const freeze = (at: number) => ({ type: 'freezeFrame' as const, clipId: 'c1', at, media: media('f', 'image', 0), duration: 2 })
  it('no meio do clipe divide e insere o quadro parado', () => {
    const r = reduce(setup(), freeze(2))
    expect(r.clips).toHaveLength(3)
    const sorted = [...r.clips].sort((a, b) => a.start - b.start)
    expect(sorted.map((c) => [c.start, c.duration])).toEqual([[0, 2], [2, 2], [4, 2]])
  })
  it('perto da borda não faz nada (não cria sobreposição)', () => {
    const p = setup()
    expect(reduce(p, freeze(0.05))).toBe(p)
    expect(reduce(p, freeze(3.95))).toBe(p)
  })
})

describe('rampa de velocidade', () => {
  it('os keyframes acompanham a mídia e continuam contínuos nas emendas', () => {
    const p = base()
    const c = clip({ id: 'c1', mediaId: 'a', trackId: V(p), start: 0, duration: 10, keyframes: { x: [{ t: 0, v: 0, ease: 'linear' }, { t: 10, v: 1, ease: 'linear' }] }, volumeKeys: [{ t: 0, v: 1 }, { t: 10, v: 0 }] })
    const r = reduce({ ...p, clips: [c] }, { type: 'speedRamp', clipId: 'c1', factors: [1, 2] })
    const [first, second] = [...r.clips].sort((a, b) => a.start - b.start)
    // Parte 1: mídia 0–5 s a 1× → 5 s; parte 2: mídia 5–10 s a 2× → 2,5 s.
    expect(first.duration).toBeCloseTo(5)
    expect(second.duration).toBeCloseTo(2.5)
    const x1 = first.keyframes.x!
    const x2 = second.keyframes.x!
    expect(x1[0]).toMatchObject({ t: 0, v: 0 })
    expect(x1[x1.length - 1].t).toBeCloseTo(5)
    expect(x1[x1.length - 1].v).toBeCloseTo(0.5)
    expect(x2[0].v).toBeCloseTo(0.5)
    expect(x2[x2.length - 1].t).toBeCloseTo(2.5)
    expect(x2[x2.length - 1].v).toBeCloseTo(1)
    // Volume: 1 → 0,5 na primeira parte; 0,5 → 0 na segunda.
    expect(first.volumeKeys[0].v).toBeCloseTo(1)
    expect(first.volumeKeys[first.volumeKeys.length - 1].v).toBeCloseTo(0.5)
    expect(second.volumeKeys[second.volumeKeys.length - 1].v).toBeCloseTo(0)
  })
  it('sem keyframes continua sem keyframes', () => {
    const p = base()
    const c = clip({ id: 'c1', mediaId: 'a', trackId: V(p), start: 0, duration: 10 })
    const r = reduce({ ...p, clips: [c] }, { type: 'speedRamp', clipId: 'c1', factors: [1, 2] })
    for (const part of r.clips) {
      expect(part.keyframes).toEqual({})
      expect(part.volumeKeys).toEqual([])
    }
  })
})

describe('colar e duplicar', () => {
  it('clipe cuja mídia foi removida não é colado', () => {
    const p = base()
    const c = clip({ id: 'c1', mediaId: 'a', trackId: V(p), start: 0, duration: 2 })
    const ghost = clip({ id: 'g', mediaId: 'sumiu', trackId: V(p), start: 4, duration: 2 })
    const r = reduce({ ...p, clips: [] }, { type: 'insertClips', clips: [c, ghost] })
    expect(r.clips.map((x) => x.id)).toEqual(['c1'])
  })
  it('clipe de texto não precisa de mídia', () => {
    const p = base()
    const t = { ...clip({ id: 't', trackId: V(p), start: 0, duration: 2 }), text: { content: 'oi' } as never }
    expect(reduce(p, { type: 'insertClips', clips: [t] }).clips).toHaveLength(1)
  })
})

describe('dividir texto com palavras (karaokê)', () => {
  it('na segunda metade os tempos das palavras andam junto', () => {
    const p = base()
    const t = {
      ...clip({ id: 't', trackId: V(p), start: 0, duration: 4 }),
      text: { content: 'um dois tres', words: [{ w: 'um', t0: 0, t1: 1 }, { w: 'dois', t0: 1.5, t1: 2.5 }, { w: 'tres', t0: 3, t1: 4 }] } as never,
    }
    const r = reduce({ ...p, clips: [t] }, { type: 'split', time: 2, ids: ['t'] })
    const [a, b] = [...r.clips].sort((x, y) => x.start - y.start)
    expect(a.text!.words!.map((w) => w.t0)).toEqual([0, 1.5, 3])
    expect(b.text!.words!.map((w) => w.t0)).toEqual([-2, -0.5, 1])
  })
})

describe('remover trilha', () => {
  it('desliga o ducking que usava a trilha removida como voz', () => {
    const p = base()
    const voz = p.tracks[1]
    const musica = { ...makeMusic(p), fx: { ...p.tracks[0].fx, duck: { enabled: true, source: voz.id, depth: 12 } } }
    const q = { ...p, tracks: [p.tracks[0], voz, musica] }
    const r = reduce(q, { type: 'removeTrack', id: voz.id })
    const m = r.tracks.find((t) => t.id === musica.id)!
    expect(m.fx.duck.enabled).toBe(false)
    expect(m.fx.duck.source).toBeNull()
  })
})

function makeMusic(p: Project) {
  return { ...p.tracks[1], id: 'musica', name: 'Música' }
}

describe('atalhos: AltGr no teclado ABNT2', () => {
  it('colchete com AltGr é "[" e não Ctrl+Alt+[', async () => {
    const { comboOf } = await import('../src/shortcuts')
    const altGr = (k: string) => ({ key: k, code: '', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true, getModifierState: (m: string) => m === 'AltGraph' })
    expect(comboOf(altGr('['))).toBe('[')
    expect(comboOf(altGr(']'))).toBe(']')
    // Ctrl+Alt de verdade (sem AltGr) continua sendo Ctrl+Alt+tecla
    expect(comboOf({ key: 's', code: 'KeyS', ctrlKey: true, metaKey: false, shiftKey: false, altKey: true, getModifierState: () => false })).toBe('Ctrl+Alt+S')
    expect(comboOf({ key: 's', code: 'KeyS', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe('Ctrl+S')
  })
})

describe('arrastar grupo (deslocamento desde o início do arrasto)', () => {
  it('com "from", repetir o movimento não acumula', () => {
    const p = base()
    const q = { ...p, clips: [clip({ id: 'c1', mediaId: 'a', trackId: V(p), start: 2, duration: 2 }), clip({ id: 'c2', mediaId: 'a', trackId: V(p), start: 6, duration: 2 })] }
    const from = { c1: 2, c2: 6 }
    const a = reduce(q, { type: 'moveClips', ids: ['c1', 'c2'], delta: 1, from })
    const b = reduce(a, { type: 'moveClips', ids: ['c1', 'c2'], delta: 1.5, from })
    expect(b.clips.map((c) => c.start)).toEqual([3.5, 7.5])
    const c = reduce(b, { type: 'moveClips', ids: ['c1', 'c2'], delta: -9, from })
    expect(c.clips.map((c) => c.start)).toEqual([0, 4])
  })
})
