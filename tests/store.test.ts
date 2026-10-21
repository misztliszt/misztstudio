import { describe, expect, it } from 'vitest'
import { historyReducer, mainTrackId, reduce, type History } from '../src/store'
import type { Project } from '../src/types'
import { clip, emptyProject, media } from './helpers'

function withClips(...specs: [string, number, number][]): Project {
  const p = emptyProject()
  const v = p.tracks[0].id
  return { ...p, media: { m: media('m', 'video', 60) }, clips: specs.map(([id, start, duration]) => clip({ id, mediaId: 'm', trackId: v, start, duration })) }
}
const byId = (p: Project, id: string) => p.clips.find((c) => c.id === id)!

describe('dividir', () => {
  it('corta no cursor e ajusta o ponto de entrada da segunda metade', () => {
    const p = reduce(withClips(['a', 2, 6]), { type: 'split', time: 5, ids: ['a'] })
    expect(p.clips).toHaveLength(2)
    const [first, second] = [...p.clips].sort((x, y) => x.start - y.start)
    expect(first.duration).toBeCloseTo(3)
    expect(second.start).toBeCloseTo(5)
    expect(second.in).toBeCloseTo(3)
    expect(second.duration).toBeCloseTo(3)
  })
  it('respeita a velocidade ao calcular o ponto de entrada', () => {
    let p = withClips(['a', 0, 4])
    p = { ...p, clips: [{ ...p.clips[0], speed: 2 }] }
    const second = reduce(p, { type: 'split', time: 1, ids: ['a'] }).clips.find((c) => c.id !== 'a')!
    expect(second.in).toBeCloseTo(2)
  })
  it('desloca os keyframes da segunda metade', () => {
    let p = withClips(['a', 0, 4])
    p = { ...p, clips: [{ ...p.clips[0], keyframes: { x: [{ t: 3, v: 100, ease: 'linear' }] } }] }
    const second = reduce(p, { type: 'split', time: 1, ids: ['a'] }).clips.find((c) => c.id !== 'a')!
    expect(second.keyframes.x![0].t).toBeCloseTo(2)
  })
})

describe('excluir fechando o buraco (ripple)', () => {
  it('puxa os clipes seguintes para a esquerda', () => {
    const p = reduce(withClips(['a', 0, 2], ['b', 2, 3], ['c', 5, 1]), { type: 'rippleDelete', ids: ['b'] })
    expect(p.clips.map((c) => c.id)).toEqual(['a', 'c'])
    expect(byId(p, 'c').start).toBeCloseTo(2)
  })
})

describe('timeline magnética', () => {
  it('cola os clipes da trilha principal a partir do zero', () => {
    const p = reduce(withClips(['a', 1, 2], ['b', 6, 2]), { type: 'setMagnetic', on: true })
    expect(byId(p, 'a').start).toBe(0)
    expect(byId(p, 'b').start).toBeCloseTo(2)
  })
  it('a trilha principal é a de vídeo mais embaixo', () => {
    const p = reduce(emptyProject(), { type: 'addTrack', kind: 'video' })
    const videos = p.tracks.filter((t) => t.kind === 'video')
    expect(videos).toHaveLength(2)
    expect(mainTrackId(p)).toBe(videos[1].id)
  })
})

describe('velocidade', () => {
  it('2× deixa o clipe com metade da duração', () => {
    const p = reduce(withClips(['a', 0, 4]), { type: 'setSpeed', id: 'a', speed: 2 })
    expect(byId(p, 'a').duration).toBeCloseTo(2)
  })
  it('limita entre 0,25× e 4×', () => {
    expect(byId(reduce(withClips(['a', 0, 4]), { type: 'setSpeed', id: 'a', speed: 10 }), 'a').speed).toBe(4)
    expect(byId(reduce(withClips(['a', 0, 4]), { type: 'setSpeed', id: 'a', speed: 0.01 }), 'a').speed).toBe(0.25)
  })
  it('não invade o clipe seguinte ao desacelerar', () => {
    const p = reduce(withClips(['a', 0, 4], ['b', 5, 2]), { type: 'setSpeed', id: 'a', speed: 0.5 })
    expect(byId(p, 'a').duration).toBeCloseTo(5)
  })
  it('rampa divide o trecho e preserva a mídia usada', () => {
    const p = reduce(withClips(['a', 0, 4]), { type: 'speedRamp', clipId: 'a', factors: [2, 0.5] })
    expect(p.clips).toHaveLength(2)
    const src = p.clips.reduce((s, c) => s + c.duration * (c.speed || 1), 0)
    expect(src).toBeCloseTo(4)
  })
})

describe('sobreposição', () => {
  it('mover um clipe por cima de outro na mesma trilha é recusado', () => {
    const p = withClips(['a', 0, 2], ['b', 3, 2])
    expect(reduce(p, { type: 'updateClip', id: 'b', patch: { start: 1 } })).toBe(p)
  })
})

describe('gravação de tela', () => {
  it('vídeo numa trilha livre e cada áudio na sua própria trilha', () => {
    const p = reduce(emptyProject(), { type: 'addRecording', start: 3, video: media('v', 'video', 5), audio: [{ label: 'Áudio do sistema', media: media('s', 'audio', 5) }, { label: 'Microfone', media: media('mic', 'audio', 5) }] })
    expect(p.clips).toHaveLength(3)
    expect(p.clips.every((c) => c.start === 3)).toBe(true)
    expect(new Set(p.clips.map((c) => c.trackId)).size).toBe(3)
    expect(p.tracks.map((t) => t.name)).toContain('Microfone')
  })
})

describe('histórico', () => {
  it('desfazer e refazer', () => {
    const start = withClips(['a', 0, 4])
    let h: History = { past: [], present: start, future: [] }
    h = historyReducer(h, { type: 'do', action: { type: 'split', time: 2, ids: ['a'] } })
    expect(h.present.clips).toHaveLength(2)
    h = historyReducer(h, { type: 'undo' })
    expect(h.present).toBe(start)
    h = historyReducer(h, { type: 'redo' })
    expect(h.present.clips).toHaveLength(2)
  })
  it('ação recusada não cria entrada', () => {
    const p = withClips(['a', 0, 2], ['b', 3, 2])
    const h: History = { past: [], present: p, future: [] }
    expect(historyReducer(h, { type: 'do', action: { type: 'updateClip', id: 'b', patch: { start: 1 } } })).toBe(h)
  })
})
