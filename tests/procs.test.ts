import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { spawn, killTree, killAll, lineFeeder, liveCount } = require('../electron/procs.cjs')

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('linhas de saída de processos', () => {
  it('junta pedaços e separa por \n, \r\n e \r (barras de progresso)', () => {
    const got: string[] = []
    const f = lineFeeder((line: string, stream: string) => got.push(`${stream}:${line}`))
    f.push('out', 'abc')
    f.push('out', 'def\nghi\r\njk')
    f.push('out', 'l\r10%\r20%')
    f.flush()
    expect(got).toEqual(['out:abcdef', 'out:ghi', 'out:jkl', 'out:10%', 'out:20%'])
  })
  it('ignora linhas em branco e mantém as saídas separadas', () => {
    const got: string[] = []
    const f = lineFeeder((line: string, stream: string) => got.push(`${stream}:${line}`))
    f.push('out', 'um\n\n  \n')
    f.push('err', 'erro\n')
    f.flush()
    expect(got).toEqual(['out:um', 'err:erro'])
  })
})

describe('processos filhos', () => {
  it('killTree encerra também o processo neto', async () => {
    // O pai abre um neto que dorme e imprime o pid dele.
    const parent = spawn(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000)"], { windowsHide: true })
    let out = ''
    parent.stdout.on('data', (d: Buffer) => (out += d))
    for (let i = 0; i < 50 && !/\d+\n/.test(out); i++) await sleep(100)
    const grandchild = Number(out.trim())
    expect(grandchild).toBeGreaterThan(0)
    expect(alive(grandchild)).toBe(true)
    killTree(parent, { sync: true })
    await sleep(500)
    expect(alive(parent.pid)).toBe(false)
    expect(alive(grandchild)).toBe(false)
  }, 20000)

  it('killAll encerra tudo que está registrado', async () => {
    const p = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { windowsHide: true })
    expect(liveCount()).toBeGreaterThan(0)
    killAll()
    await sleep(500)
    expect(alive(p.pid)).toBe(false)
    expect(liveCount()).toBe(0)
  }, 20000)
})
