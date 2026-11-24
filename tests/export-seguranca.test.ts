import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExportJob, Project } from '../src/types'
import { clip, emptyProject, media } from './helpers'

const require = createRequire(import.meta.url)
const { prepareExport, atempoChain, filterArgs } = require('../electron/export.cjs')
const { ExportQueue } = require('../electron/exportqueue.cjs')
const FFMPEG: string = require('ffmpeg-static')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-seg-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function ffmpeg(args: string[]) {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`ffmpeg saiu com ${r.status}: ${r.stderr.slice(-400)}`)
}

beforeAll(() => {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'a.mp4')])
})

function base(): Project {
  const p = emptyProject()
  return { ...p, width: 320, height: 180, fps: 30, media: { a: { ...media('a', 'video', 3), path: path.join(dir, 'a.mp4'), width: 320, height: 180 } }, clips: [clip({ id: 'c1', mediaId: 'a', trackId: p.tracks[0].id, start: 0, duration: 2 })] }
}
const options = { format: 'mp4', codec: 'h264', resolution: 0, fps: 0, quality: 'small', normalize: false, fileName: 'x' }

describe('velocidade inválida não trava a exportação', () => {
  it('velocidade negativa, zero, infinita ou NaN vira uma cadeia finita', () => {
    for (const s of [-1, 0, Infinity, -Infinity, NaN, 1e308]) {
      const chain = atempoChain(s)
      expect(Array.isArray(chain)).toBe(true)
      expect(chain.length).toBeLessThan(20)
    }
  })

  it('velocidades normais continuam com a mesma cadeia', () => {
    expect(atempoChain(1)).toEqual([])
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2.0000'])
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5000'])
  })
})

describe('projeto com valores estranhos', () => {
  it('largura, altura e fps não numéricos não entram no filtro', async () => {
    const p = base()
    const hostile = { ...p, width: '320,movie=C\\x' as unknown as number, height: '180' as unknown as number, fps: 'abc' as unknown as number }
    const { args } = await prepareExport({ project: hostile, textImages: {}, colorMatrices: {}, options }, path.join(dir, 'h.mp4'), { workDir: path.join(dir, 'work-h'), runFfmpeg: async () => {} })
    const graph = args[args.indexOf('-filter_complex') + 1] as string
    expect(graph).not.toContain('movie=')
    expect(graph).toContain('s=1920x180')
  })

  it('id de clipe com barras não escapa da pasta de trabalho', async () => {
    const p = base()
    const text = { ...clip({ id: '..\\..\\fora', trackId: p.tracks[0].id, start: 0, duration: 1 }), mediaId: undefined, text: { content: 'oi', font: 'Inter', size: 40, color: '#fff', weight: 700, bg: '', align: 'center', animation: 'none' } }
    const proj = { ...p, clips: [text as never] }
    const work = path.join(dir, 'work-id')
    await prepareExport({ project: proj, textImages: { [text.id]: 'AAAA' }, colorMatrices: {}, options }, path.join(dir, 'i.mp4'), { workDir: work, runFfmpeg: async () => {} })
    expect(fs.readdirSync(work).some((f) => f.startsWith('text_'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'fora.png'))).toBe(false)
  })
})

describe('grafo de filtros grande', () => {
  it('filterArgs usa arquivo quando o grafo passa do limite da linha de comando', () => {
    const work = path.join(dir, 'work-fa')
    const small = filterArgs(['a', 'b'], work, 'x')
    expect(small).toEqual(['-filter_complex', 'a;b'])
    const big = filterArgs(Array.from({ length: 2000 }, (_, i) => `f${i}`), work, 'x')
    expect(big[0]).toBe('-filter_complex_script')
    expect(fs.readFileSync(big[1], 'utf8').startsWith('f0;f1')).toBe(true)
  })

  it('exporta de verdade uma timeline com dezenas de clipes', async () => {
    const p = base()
    const clips = Array.from({ length: 45 }, (_, i) => clip({ id: `k${i}`, mediaId: 'a', trackId: p.tracks[0].id, start: i * 0.2, duration: 0.2, in: 0 }))
    const proj = { ...p, clips }
    const out = path.join(dir, 'longo.mp4')
    const { args } = await prepareExport({ project: proj, textImages: {}, colorMatrices: {}, options }, out, { workDir: path.join(dir, 'work-long'), runFfmpeg: async (a: string[]) => ffmpeg(a) })
    expect(args).toContain('-filter_complex_script')
    ffmpeg(args)
    expect(fs.statSync(out).size).toBeGreaterThan(1000)
  }, 120000)
})

describe('fila: arquivo de destino existente', () => {
  it('uma exportação que falha não apaga o arquivo que já existia', async () => {
    const out = path.join(dir, 'existente.mp4')
    fs.writeFileSync(out, 'conteudo antigo')
    let resolveDone: () => void
    const done = new Promise<void>((r) => (resolveDone = r))
    const q = new ExportQueue(FFMPEG, (jobs: ExportJob[]) => jobs.every((j) => j.state === 'error' || j.state === 'done' || j.state === 'canceled') && resolveDone())
    const empty = { ...base(), clips: [] }
    q.add({ project: empty, textImages: {}, colorMatrices: {}, options }, out)
    await done
    expect(q.list()[0].state).toBe('error')
    expect(fs.readFileSync(out, 'utf8')).toBe('conteudo antigo')
    expect(fs.readdirSync(dir).filter((f) => f.includes('.parcial'))).toHaveLength(0)
  })

  it('exportação concluída troca o arquivo e não deixa o provisório', async () => {
    const out = path.join(dir, 'novo.mp4')
    let resolveDone: () => void
    const done = new Promise<void>((r) => (resolveDone = r))
    const q = new ExportQueue(FFMPEG, (jobs: ExportJob[]) => jobs.every((j) => j.state === 'error' || j.state === 'done' || j.state === 'canceled') && resolveDone())
    q.add({ project: base(), textImages: {}, colorMatrices: {}, options }, out)
    await done
    expect(q.list()[0].state).toBe('done')
    expect(fs.statSync(out).size).toBeGreaterThan(1000)
    expect(fs.readdirSync(dir).filter((f) => f.includes('.parcial'))).toHaveLength(0)
  }, 60000)
})
