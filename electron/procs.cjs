// Processos filhos (FFmpeg, yt-dlp, Python…): todos ficam registrados para serem encerrados junto com o programa
// e para o "Cancelar" matar também os processos netos (no Windows, kill() só mata o processo direto).

const { spawn: nodeSpawn, spawnSync } = require('node:child_process')

const live = new Set()

/** Igual ao spawn do Node, mas registra o processo até ele terminar. */
function spawn(bin, args, opts) {
  const proc = nodeSpawn(bin, args, opts)
  track(proc)
  return proc
}

/** Registra um processo já criado (ex.: o devolvido por execFile). */
function track(proc) {
  live.add(proc)
  const done = () => live.delete(proc)
  proc.once('close', done)
  proc.once('error', done)
  return proc
}

/** Encerra o processo e seus filhos. Sem `sync`, não bloqueia. */
function killTree(proc, { sync = false } = {}) {
  if (!proc || proc.exitCode !== null) return
  try {
    if (process.platform === 'win32' && proc.pid) {
      const args = ['/pid', String(proc.pid), '/T', '/F']
      if (sync) spawnSync('taskkill', args, { windowsHide: true })
      else nodeSpawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => proc.kill())
    } else proc.kill('SIGKILL')
  } catch {
    try {
      proc.kill()
    } catch {
      // já terminou
    }
  }
}

/** Ao sair do programa: nada de FFmpeg, yt-dlp ou Python órfão consumindo CPU, GPU e disco. */
function killAll() {
  for (const proc of live) killTree(proc, { sync: true })
  live.clear()
}

/**
 * Entrega a saída de um processo linha a linha, sem quebrar caracteres acentuados nem linhas
 * que chegam em pedaços. Devolve uma função para esvaziar o que sobrou ao terminar.
 */
function lineFeeder(onLine) {
  const rest = { out: '', err: '' }
  return {
    push(stream, text) {
      const parts = (rest[stream] + text).split(/\r\n|\r|\n/)
      rest[stream] = parts.pop()
      for (const line of parts) if (line.trim()) onLine(line, stream)
    },
    flush() {
      for (const stream of ['out', 'err']) {
        if (rest[stream].trim()) onLine(rest[stream], stream)
        rest[stream] = ''
      }
    },
  }
}

module.exports = { spawn, track, killTree, killAll, lineFeeder, liveCount: () => live.size }
