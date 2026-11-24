import { afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { writeFileAtomic } = require('../electron/fsutil.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-fs-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('gravação atômica', () => {
  it('cria e substitui o arquivo sem deixar provisórios', () => {
    const f = path.join(dir, 'a.edproj')
    writeFileAtomic(f, 'um')
    writeFileAtomic(f, 'dois')
    expect(fs.readFileSync(f, 'utf8')).toBe('dois')
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toHaveLength(0)
  })

  it('guarda a versão anterior em .bak quando pedido', () => {
    const f = path.join(dir, 'b.edproj')
    writeFileAtomic(f, 'v1', { backup: true })
    expect(fs.existsSync(f + '.bak')).toBe(false)
    writeFileAtomic(f, 'v2', { backup: true })
    expect(fs.readFileSync(f + '.bak', 'utf8')).toBe('v1')
    expect(fs.readFileSync(f, 'utf8')).toBe('v2')
  })

  it('falha sem tocar no original e sem deixar lixo', () => {
    const f = path.join(dir, 'c.edproj')
    writeFileAtomic(f, 'intacto')
    // Gravar um destino dentro de uma pasta que não existe falha cedo; o original não muda.
    expect(() => writeFileAtomic(path.join(dir, 'nao-existe', 'x.edproj'), 'x')).toThrow()
    expect(fs.readFileSync(f, 'utf8')).toBe('intacto')
    // Dado inválido (não é string nem buffer) falha no meio e o original continua igual.
    expect(() => writeFileAtomic(f, { nao: 'serve' } as never)).toThrow()
    expect(fs.readFileSync(f, 'utf8')).toBe('intacto')
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toHaveLength(0)
  })
})
