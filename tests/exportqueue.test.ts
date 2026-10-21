import { afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExportJob, Project } from '../src/types'
import { clip, emptyProject, media } from './helpers'

const require = createRequire(import.meta.url)
const { ExportQueue } = require('../electron/exportqueue.cjs')
const FFMPEG: string = require('ffmpeg-static')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-queue-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'a.mp4')])

function project(): Project {
  const p = emptyProject()
  return { ...p, width: 320, height: 180, fps: 30, media: { a: { ...media('a', 'video', 2), path: path.join(dir, 'a.mp4'), width: 320, height: 180 } }, clips: [clip({ id: 'c', mediaId: 'a', trackId: p.tracks[0].id, start: 0, duration: 2 })] }
}
const payload = () => ({ project: project(), textImages: {}, colorMatrices: {}, options: { format: 'mp4', codec: 'h264', resolution: 0, fps: 0, quality: 'small', normalize: false, fileName: 'x' } })

describe('fila de exportação', () => {
  it('exporta uma por vez, na ordem, e permite cancelar a que está esperando', async () => {
    const snapshots: ExportJob[][] = []
    let resolveDone: () => void
    const done = new Promise<void>((r) => (resolveDone = r))
    const q = new ExportQueue(FFMPEG, (jobs: ExportJob[]) => {
      snapshots.push(jobs)
      if (jobs.every((j) => j.state !== 'queued' && j.state !== 'running')) resolveDone()
    })
    const a = q.add(payload(), path.join(dir, 'a-out.mp4'))
    const b = q.add(payload(), path.join(dir, 'b-out.mp4'))
    const c = q.add(payload(), path.join(dir, 'c-out.mp4'))
    // Enquanto a primeira roda, as outras esperam.
    expect(q.list().filter((j: ExportJob) => j.state === 'running')).toHaveLength(1)
    q.cancel(b)
    await done
    const final = Object.fromEntries(q.list().map((j: ExportJob) => [j.id, j.state]))
    expect(final[a]).toBe('done')
    expect(final[b]).toBe('canceled')
    expect(final[c]).toBe('done')
    expect(fs.existsSync(path.join(dir, 'a-out.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'b-out.mp4'))).toBe(false)
    // Nunca houve duas exportações rodando ao mesmo tempo.
    expect(snapshots.every((s) => s.filter((j) => j.state === 'running').length <= 1)).toBe(true)
    q.clear()
    expect(q.list()).toHaveLength(0)
  })

  it('cancelar a exportação em andamento apaga o arquivo incompleto', async () => {
    let resolveDone: () => void
    const done = new Promise<void>((r) => (resolveDone = r))
    const q = new ExportQueue(FFMPEG, (jobs: ExportJob[]) => jobs.every((j) => j.state === 'canceled' || j.state === 'done' || j.state === 'error') && resolveDone())
    const id = q.add(payload(), path.join(dir, 'cancel.mp4'))
    setTimeout(() => q.cancel(id), 50)
    await done
    expect(q.list()[0].state).toBe('canceled')
    expect(fs.existsSync(path.join(dir, 'cancel.mp4'))).toBe(false)
  })
})
