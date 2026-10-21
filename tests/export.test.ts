import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExportOptions, Project } from '../src/types'
import { defaultText, reduce } from '../src/store'
import { clip, emptyProject, media } from './helpers'

const require = createRequire(import.meta.url)
const { prepareExport } = require('../electron/export.cjs')
const FFMPEG: string = require('ffmpeg-static')
const FFPROBE: string = require('ffprobe-static').path

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-test-'))
const file = (name: string) => path.join(dir, name)

function ffmpeg(args: string[]) {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status !== 0) {
    const tail = r.stderr.split(/\r?\n|\r/).filter((l) => l && !l.trim().startsWith('frame='))
    throw new Error(`ffmpeg saiu com ${r.status ?? r.signal}: ${tail.slice(-6).join(' / ')}`)
  }
  return r.stderr
}
function probe(f: string) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', f], { encoding: 'utf8' })
  return JSON.parse(r.stdout) as { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] }
}
/** Volume médio (dB) de um trecho. */
function meanDb(f: string, from: number, to: number) {
  const log = ffmpeg(['-ss', String(from), '-to', String(to), '-i', f, '-af', 'volumedetect', '-f', 'null', '-'])
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(log)![1])
}
function integratedLufs(f: string) {
  const log = ffmpeg(['-i', f, '-af', 'ebur128', '-f', 'null', '-'])
  const all = [...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)]
  return Number(all[all.length - 1][1])
}

async function exportProject(project: Project, out: string, options: Partial<ExportOptions> = {}, extra: Record<string, unknown> = {}) {
  const { args } = await prepareExport(
    { project, textImages: {}, colorMatrices: {}, ...extra, options: { format: 'mp4', codec: 'h264', resolution: 0, fps: 0, quality: 'small', normalize: false, fileName: 'x', ...options } },
    out,
    { workDir: file(`work-${path.basename(out)}`), runFfmpeg: async (a: string[]) => ffmpeg(a) },
  )
  ffmpeg(args)
  return probe(out)
}

/** Projeto 640×360 com um vídeo de 3 s (com tom de 440 Hz). */
function videoProject(): Project {
  const p = emptyProject()
  const m = { ...media('a', 'video', 3), path: file('a.mp4'), width: 640, height: 360 }
  return { ...p, width: 640, height: 360, fps: 30, media: { a: m }, clips: [clip({ id: 'c1', mediaId: 'a', trackId: p.tracks[0].id, start: 0, duration: 3 })] }
}

beforeAll(() => {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file('a.mp4')])
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=220:d=6', '-af', 'volume=0.5', '-ar', '48000', '-ac', '2', file('music.wav')])
  // "Voz": rajadas de ruído de 1 a 2 s e de 4 a 5 s.
  ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=6:a=0.3', '-af', "volume='between(t,1,2)+between(t,4,5)':eval=frame", '-ar', '48000', '-ac', '2', file('voice.wav')])
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('exportação', () => {
  it('MP4 com vídeo H.264 e áudio AAC na duração da timeline', async () => {
    const info = await exportProject(videoProject(), file('out.mp4'))
    expect(Number(info.format.duration)).toBeCloseTo(3, 0)
    expect(info.streams.find((s) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 640, height: 360 })
    expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(true)
  })

  it('velocidade 2× deixa o vídeo com metade da duração', async () => {
    const p = reduce(videoProject(), { type: 'setSpeed', id: 'c1', speed: 2 })
    const info = await exportProject(p, file('fast.mp4'))
    expect(Number(info.format.duration)).toBeCloseTo(1.5, 0)
  })

  it('efeitos, transições e keyframes exportam sem erro', async () => {
    const p = videoProject()
    const c = p.clips[0]
    p.clips[0] = {
      ...c,
      effects: { blur: 2, vignette: 0.5, grain: 0.3, shake: 0.5, mirror: true },
      transitionIn: { type: 'zoomIn', duration: 0.5 },
      transitionOut: { type: 'spin', duration: 0.5 },
      color: { ...c.color, brightness: 0.1, contrast: 1.2 },
      keyframes: { scale: [{ t: 0, v: 1, ease: 'ease' }, { t: 2, v: 1.5, ease: 'linear' }], rotation: [{ t: 0, v: 0, ease: 'linear' }, { t: 3, v: 20, ease: 'linear' }] },
    }
    const info = await exportProject(p, file('fx.mp4'))
    expect(Number(info.format.duration)).toBeCloseTo(3, 0)
  })

  it('giro + cor + espelho não derrubam o FFmpeg (regressão)', async () => {
    const p = videoProject()
    const c = p.clips[0]
    p.clips[0] = { ...c, transitionOut: { type: 'spin', duration: 0.5 }, color: { ...c.color, brightness: 0.1, contrast: 1.2 }, effects: { ...c.effects, mirror: true } }
    const info = await exportProject(p, file('spin-color.mp4'))
    expect(Number(info.format.duration)).toBeCloseTo(3, 0)
  })

  it.each([
    ['mp3', 'mp3'],
    ['wav', 'pcm_s24le'],
    ['webm', 'vp9'],
  ] as const)('formato %s', async (format, codec) => {
    const info = await exportProject(videoProject(), file(`out.${format}`), { format })
    expect(info.streams.map((s) => s.codec_name)).toContain(codec)
  })

  it('normaliza o volume para −14 LUFS', async () => {
    await exportProject(videoProject(), file('loud.wav'), { format: 'wav', normalize: true })
    expect(Math.abs(integratedLufs(file('loud.wav')) + 14)).toBeLessThan(1.5)
  })

  it('ducking abaixa a música enquanto há voz', async () => {
    const p = emptyProject()
    const music = { ...p.tracks[1], id: 'music', name: 'Música' }
    const voice = { ...p.tracks[1], id: 'voice', name: 'Voz' }
    music.fx = { ...music.fx, duck: { enabled: true, source: 'voice', depth: 12 } }
    voice.muted = true
    const proj: Project = {
      ...p,
      tracks: [p.tracks[0], music, voice],
      media: { m: { ...media('m', 'audio', 6), path: file('music.wav') }, v: { ...media('v', 'audio', 6), path: file('voice.wav') } },
      clips: [clip({ id: 'cm', mediaId: 'm', trackId: 'music', start: 0, duration: 6 }), clip({ id: 'cv', mediaId: 'v', trackId: 'voice', start: 0, duration: 6 })],
    }
    await exportProject(proj, file('duck.wav'), { format: 'wav' })
    const quiet = meanDb(file('duck.wav'), 1.3, 1.8)
    const normal = meanDb(file('duck.wav'), 2.8, 3.4)
    expect(normal - quiet).toBeGreaterThan(8)
  })

  it('texto vira uma camada por cima do vídeo', async () => {
    const p = videoProject()
    p.tracks = [{ ...p.tracks[0], id: 'tx', name: 'Texto' }, ...p.tracks]
    p.clips.push(clip({ id: 't1', mediaId: null, trackId: 'tx', start: 0.5, duration: 1, text: { ...defaultText(), content: 'Olá' } }))
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=640x360', '-frames:v', '1', file('txt.png')])
    const info = await exportProject(p, file('text.mp4'), {}, { textImages: { t1: fs.readFileSync(file('txt.png')).toString('base64') } })
    expect(Number(info.format.duration)).toBeCloseTo(3, 0)
    // No meio do texto o quadro fica branco (a imagem cobre tudo).
    const raw = spawnSync(FFMPEG, ['-ss', '1', '-i', file('text.mp4'), '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 20 })
    expect(raw.stdout[0]).toBeGreaterThan(230)
  })
})
