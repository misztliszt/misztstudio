import { afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { AudioTools } = require('../electron/audiotools.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-cache-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const tools = () => new AudioTools(dir, 'ffmpeg')

describe('cache de áudio processado', () => {
  it('uma geração que falha não deixa arquivo parcial no lugar do resultado', async () => {
    const out = path.join(dir, 'falha.wav')
    await expect(
      tools().once(out, async (tmp: string) => {
        fs.writeFileSync(tmp, 'pela metade')
        throw new Error('ffmpeg morreu')
      }),
    ).rejects.toThrow('ffmpeg morreu')
    expect(fs.existsSync(out)).toBe(false)
    expect(fs.readdirSync(dir).filter((f) => f.includes('parcial'))).toHaveLength(0)
  })

  it('duas chamadas iguais ao mesmo tempo geram uma vez só', async () => {
    const t = tools()
    const out = path.join(dir, 'unico.wav')
    let calls = 0
    const make = async (tmp: string) => {
      calls++
      await new Promise((r) => setTimeout(r, 50))
      fs.writeFileSync(tmp, 'ok')
    }
    const [a, b] = await Promise.all([t.once(out, make), t.once(out, make)])
    expect(a).toBe(out)
    expect(b).toBe(out)
    expect(calls).toBe(1)
    // Depois de pronto, não gera de novo.
    await t.once(out, make)
    expect(calls).toBe(1)
    expect(fs.readFileSync(out, 'utf8')).toBe('ok')
  })
})
