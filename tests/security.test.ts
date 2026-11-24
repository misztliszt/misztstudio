import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { isLocalPath, MediaAllowlist, isTrustedUrl, corsOrigin, sanitizeSettingsPatch, hasProjectExt } = require('../electron/security.cjs')
const { assertHttpUrl } = require('../electron/downloader.cjs')
const { assertPublicHttps } = require('../electron/library.cjs')
const { AudioTools } = require('../electron/audiotools.cjs')

const abs = (p: string) => path.resolve(p)

describe('caminhos locais', () => {
  it('aceita caminhos absolutos e recusa URLs, protocolos do FFmpeg e valores estranhos', () => {
    expect(isLocalPath(abs('video.mp4'))).toBe(true)
    for (const bad of ['http://x/a.mp4', 'https://x', 'file:///etc/passwd', 'concat:a|b', 'subfile,,start,0:x', 'data:text/plain,a', '', 'relativo.mp4', '-i', 'a\0b', 42, null, undefined]) {
      expect(isLocalPath(bad as never)).toBe(false)
    }
  })
})

describe('mídias liberadas para o media://', () => {
  it('só serve o que foi liberado', () => {
    const a = new MediaAllowlist()
    expect(a.has(abs('x.mp4'))).toBe(false)
    a.add(abs('x.mp4'))
    expect(a.has(abs('x.mp4'))).toBe(true)
    expect(a.has(abs('y.mp4'))).toBe(false)
    expect(a.has(abs('..' + path.sep + 'x.mp4'))).toBe(false)
  })

  it('liberar um projeto libera caminho, proxy, miniatura e url das mídias', () => {
    const a = new MediaAllowlist()
    const enc = (p: string) => 'media://local/' + encodeURIComponent(p)
    const json = JSON.stringify({ media: { m1: { path: abs('a.mp4'), url: enc(abs('a.mp4')), thumb: enc(abs('t.png')), proxy: enc(abs('p.mp4')) }, m2: null, m3: 'lixo' } })
    a.addFromProject(json)
    for (const f of ['a.mp4', 't.png', 'p.mp4']) expect(a.has(abs(f))).toBe(true)
    expect(a.has(abs('outro.txt'))).toBe(false)
  })

  it('projeto inválido não libera nada nem lança', () => {
    const a = new MediaAllowlist()
    expect(() => a.addFromProject('{ quebrado')).not.toThrow()
    expect(() => a.addFromProject('null')).not.toThrow()
    expect(() => a.addFromProject(JSON.stringify({ media: [1, 2] }))).not.toThrow()
  })
})

describe('origem da interface', () => {
  it('só a interface empacotada (e o Vite em desenvolvimento) é confiável', () => {
    expect(isTrustedUrl('app://bundle/index.html', false)).toBe(true)
    expect(isTrustedUrl('http://localhost:5173/', false)).toBe(false)
    expect(isTrustedUrl('http://localhost:5173/', true)).toBe(true)
    expect(isTrustedUrl('https://evil.example/', true)).toBe(false)
    expect(isTrustedUrl('app://bundle.evil.com/', false)).toBe(false)
    expect(isTrustedUrl(undefined as never, false)).toBe(false)
  })

  it('CORS do media:// só para a própria interface', () => {
    expect(corsOrigin('app://bundle', false)).toBe('app://bundle')
    expect(corsOrigin('https://evil.example', false)).toBeNull()
    expect(corsOrigin(null, false)).toBeNull()
    expect(corsOrigin('http://localhost:5173', false)).toBeNull()
    expect(corsOrigin('http://localhost:5173', true)).toBe('http://localhost:5173')
  })
})

describe('preferências vindas da interface', () => {
  const isDir = (d: string) => d === abs('existe')
  it('aceita valores válidos e ignora chaves desconhecidas', () => {
    const out = sanitizeSettingsPatch({ autosaveSeconds: 30, proxyMode: 'always', checkUpdates: false, downloadDir: abs('existe'), perigosa: 'x', __proto__: { x: 1 } }, isDir)
    expect(out).toEqual({ autosaveSeconds: 30, proxyMode: 'always', checkUpdates: false, downloadDir: abs('existe') })
  })
  it('recusa valores fora do domínio', () => {
    for (const p of [{ autosaveSeconds: 1 }, { autosaveSeconds: 'x' }, { proxyMode: 'sempre' }, { previewQuality: 1 }, { downloadDir: abs('nao-existe') }, { downloadDir: 'http://x' }, { shortcuts: [] }, null, 'texto']) {
      expect(() => sanitizeSettingsPatch(p as never, isDir)).toThrow()
    }
  })
  it('pasta nula limpa a preferência e atalhos inválidos são filtrados', () => {
    expect(sanitizeSettingsPatch({ exportDir: null }, isDir)).toEqual({ exportDir: null })
    expect(sanitizeSettingsPatch({ shortcuts: { play: 'Space', 'x y': 'A', cut: 5 } }, isDir)).toEqual({ shortcuts: { play: 'Space' } })
  })
  it('só .edproj é um projeto', () => {
    expect(hasProjectExt('a.edproj')).toBe(true)
    expect(hasProjectExt('a.EDPROJ')).toBe(true)
    expect(hasProjectExt('a.bat')).toBe(false)
    expect(hasProjectExt(3 as never)).toBe(false)
  })
})

describe('yt-dlp: endereços', () => {
  it('só http(s); nada que pareça opção', () => {
    expect(assertHttpUrl('https://www.youtube.com/watch?v=abc')).toContain('youtube.com')
    for (const bad of ['--exec=calc', '-o x', 'file:///c:/x', 'javascript:alert(1)', 'ftp://x/y', '', 'https://' + 'a'.repeat(3000) + '.com']) {
      expect(() => assertHttpUrl(bad)).toThrow()
    }
  })
})

describe('biblioteca CC: endereços de download', () => {
  it('só https público', () => {
    expect(() => assertPublicHttps('https://cdn.freesound.org/a.mp3')).not.toThrow()
    for (const bad of ['http://cdn.freesound.org/a.mp3', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://intranet/a', 'https://x.local/a', 'file:///c:/a', 'lixo']) {
      expect(() => assertPublicHttps(bad)).toThrow()
    }
  })
})

describe('plugins VST3', () => {
  it('só carrega plugins encontrados pela busca', () => {
    const t = new AudioTools(path.join(process.env.TEMP || '.', 'miszt-vst-teste'), 'ffmpeg')
    expect(() => t.editor(abs('malicioso.dll'), '')).toThrow(/não encontrado/)
    t.known = new Set([abs('ok.vst3').toLowerCase()])
    expect(() => t.assertPlugin(abs('ok.vst3'))).not.toThrow()
    expect(() => t.assertPlugin(abs('outro.vst3'))).toThrow()
  })
})
