import { afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { cleanupCaches } = require('../electron/cleanup.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-clean-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const DAY = 24 * 3600 * 1000

function make(p: string, ageDays: number, isDir = false) {
  fs.mkdirSync(isDir ? p : path.dirname(p), { recursive: true })
  if (!isDir) fs.writeFileSync(p, 'x')
  const t = new Date(Date.now() - ageDays * DAY)
  fs.utimesSync(p, t, t)
}

describe('limpeza de cache', () => {
  it('remove só o que nunca é usado por um projeto', () => {
    const userData = path.join(root, 'userData')
    const tmp = path.join(root, 'tmp')
    // apagáveis
    make(path.join(userData, 'bgremove', 'velho'), 3, true)
    make(path.join(userData, 'stems', 'incompleto'), 3, true)
    make(path.join(userData, 'processed-audio', 'x.parcial.wav'), 3)
    make(path.join(tmp, 'miszt-studio-proxies', 'a.mp4.part.mp4'), 3)
    make(path.join(tmp, 'miszt-studio-thumbs', 'antiga.jpg'), 90)
    // preservados
    make(path.join(userData, 'bgremove', 'recente'), 0, true)
    make(path.join(userData, 'stems', 'pronto', 'stems.json'), 90)
    make(path.join(userData, 'stems', 'pronto'), 90, true)
    make(path.join(userData, 'stems', 'incompleto-novo'), 0, true)
    make(path.join(userData, 'processed-audio', 'clean-1.wav'), 90)
    make(path.join(userData, 'reversed', 'r.mp4'), 90)
    make(path.join(userData, 'frames', 'f.png'), 90)
    make(path.join(userData, 'bgremoved', 'fundo.webm'), 90)
    make(path.join(tmp, 'miszt-studio-thumbs', 'nova.jpg'), 1)

    const removed: string[] = cleanupCaches({ userData, tmp })
    const gone = removed.map((p) => path.basename(p)).sort()
    expect(gone).toEqual(['a.mp4.part.mp4', 'antiga.jpg', 'incompleto', 'velho', 'x.parcial.wav'].sort())
    for (const keep of [['bgremove', 'recente'], ['stems', 'pronto', 'stems.json'], ['stems', 'incompleto-novo'], ['processed-audio', 'clean-1.wav'], ['reversed', 'r.mp4'], ['frames', 'f.png'], ['bgremoved', 'fundo.webm']]) {
      expect(fs.existsSync(path.join(userData, ...keep))).toBe(true)
    }
    expect(fs.existsSync(path.join(tmp, 'miszt-studio-thumbs', 'nova.jpg'))).toBe(true)
  })

  it('pastas que não existem não dão erro', () => {
    expect(() => cleanupCaches({ userData: path.join(root, 'nada'), tmp: path.join(root, 'nada2') })).not.toThrow()
  })
})
