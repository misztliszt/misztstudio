import { describe, expect, it } from 'vitest'
import { parseProjectJson } from '../src/projectFile'
import { clip, emptyProject, media } from './helpers'

const base = () => {
  const p = emptyProject()
  return { ...p, media: { a: media('a') }, clips: [clip({ id: 'c1', mediaId: 'a', trackId: p.tracks[0].id, start: 0, duration: 2 })] }
}
const parse = (v: unknown) => parseProjectJson(typeof v === 'string' ? v : JSON.stringify(v))

describe('abrir projeto (.edproj)', () => {
  it('projeto válido abre sem descartar nada', () => {
    const { project, dropped } = parse(base())
    expect(dropped).toBe(0)
    expect(project.clips).toHaveLength(1)
  })

  it('texto que não é JSON dá uma mensagem em português', () => {
    expect(() => parse('{ quebrado')).toThrow(/corrompido/)
    expect(() => parse('42')).toThrow(/não é um projeto/)
    expect(() => parse('null')).toThrow(/não é um projeto/)
  })

  it('arquivo de versão futura recebe mensagem específica', () => {
    expect(() => parse({ ...base(), version: 2 })).toThrow(/versão mais nova/)
  })

  it('sem trilhas ou com trilha inválida não abre (e não derruba o app)', () => {
    expect(() => parse({ ...base(), tracks: [] })).toThrow(/trilhas/)
    expect(() => parse({ ...base(), tracks: [{ id: 1 }] })).toThrow(/inválidas/)
    const { clips: _c, media: _m, ...semClipsNemMidia } = base()
    const r = parse(semClipsNemMidia)
    expect(r.project.clips).toEqual([])
    expect(r.project.media).toEqual({})
  })

  it('descarta clipes quebrados e conta quantos', () => {
    const p = base()
    const ruins = [
      { ...p.clips[0], id: 'x1', trackId: 'nao-existe' },
      { ...p.clips[0], id: 'x2', mediaId: 'sumiu' },
      { ...p.clips[0], id: 'x3', start: -1 },
      { ...p.clips[0], id: 'x4', duration: 0 },
      { ...p.clips[0], id: 'x5', duration: null },
      'lixo',
    ]
    const r = parse({ ...p, clips: [...p.clips, ...ruins] })
    expect(r.project.clips.map((c) => c.id)).toEqual(['c1'])
    expect(r.dropped).toBe(6)
  })

  it('velocidade inválida e corte negativo são corrigidos', () => {
    const p = base()
    const r = parse({ ...p, clips: [{ ...p.clips[0], speed: -2, in: -5 }] })
    expect(r.project.clips[0].speed).toBe(1)
    expect(r.project.clips[0].in).toBe(0)
  })

  it('largura, altura e fps absurdos voltam ao padrão', () => {
    const r = parse({ ...base(), width: 'x', height: -3, fps: 0 })
    expect([r.project.width, r.project.height, r.project.fps]).toEqual([1920, 1080, 30])
  })

  it('ducking apontando para trilha removida é desligado', () => {
    const p = base()
    const tracks = p.tracks.map((t, i) => (i === 1 ? { ...t, fx: { ...t.fx, duck: { enabled: true, source: 'fantasma', depth: 12 } } } : t))
    const r = parse({ ...p, tracks })
    expect(r.project.tracks[1].fx.duck.enabled).toBe(false)
    expect(r.project.tracks[1].fx.duck.source).toBeNull()
  })

  it('projeto salvo por versão antiga ganha os campos novos', () => {
    const p = base()
    const antigo = { ...p, tracks: p.tracks.map(({ fx: _fx, ...t }) => t), clips: p.clips.map(({ effects: _e, color: _c, ...c }) => c) }
    const r = parse(antigo)
    expect(r.project.tracks[0].fx.eq).toBeDefined()
    expect(r.project.clips[0].effects).toBeDefined()
    expect(r.project.clips[0].color).toBeDefined()
  })
})
