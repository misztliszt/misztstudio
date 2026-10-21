// Fila de exportação em segundo plano: uma exportação por vez, as outras esperam.
// Cada trabalho recebe uma cópia do projeto no momento em que foi pedido, então a edição continua livre.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { prepareExport } = require('./export.cjs')

class ExportQueue {
  /**
   * @param {string} ffmpeg caminho do FFmpeg
   * @param {(jobs: object[]) => void} onChange chamado a cada mudança (estado ou progresso)
   */
  constructor(ffmpeg, onChange) {
    this.ffmpeg = ffmpeg
    this.onChange = onChange
    this.jobs = []
    this.proc = null
    this.busy = false
  }

  list() {
    return this.jobs.map(({ payload, ...job }) => job)
  }

  emit() {
    this.onChange(this.list())
  }

  get active() {
    return this.jobs.some((j) => j.state === 'queued' || j.state === 'running')
  }

  add(payload, outPath) {
    const job = {
      id: crypto.randomUUID(),
      name: path.basename(outPath),
      outPath,
      format: (payload.options && payload.options.format) || 'mp4',
      state: 'queued',
      progress: 0,
      error: null,
      addedAt: Date.now(),
      payload,
    }
    this.jobs.push(job)
    this.emit()
    void this.next()
    return job.id
  }

  cancel(id) {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return
    if (job.state === 'queued') job.state = 'canceled'
    else if (job.state === 'running') {
      job.cancel = true
      if (this.proc) this.proc.kill()
    }
    this.emit()
  }

  /** Tira da lista os trabalhos que já terminaram (ou um específico). */
  clear(id) {
    this.jobs = this.jobs.filter((j) => (id ? j.id !== id : j.state === 'queued' || j.state === 'running'))
    this.emit()
  }

  async next() {
    if (this.busy) return
    const job = this.jobs.find((j) => j.state === 'queued')
    if (!job) return
    this.busy = true
    job.state = 'running'
    job.startedAt = Date.now()
    this.emit()
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miszt-studio-export-'))
    try {
      const { args, total } = await prepareExport(job.payload, job.outPath, { workDir, runFfmpeg: (a) => this.run(job, a, 0) })
      await this.run(job, args, total)
      job.state = 'done'
      job.progress = 1
    } catch (err) {
      fs.rmSync(job.outPath, { force: true })
      if (job.cancel) job.state = 'canceled'
      else {
        job.state = 'error'
        job.error = String(err.message || err).slice(-1500)
      }
    } finally {
      job.finishedAt = Date.now()
      job.payload = null
      fs.rmSync(workDir, { recursive: true, force: true })
      this.busy = false
      this.emit()
      void this.next()
    }
  }

  run(job, args, total) {
    if (job.cancel) return Promise.reject(new Error('Exportação cancelada'))
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpeg, args, { windowsHide: true })
      this.proc = proc
      let log = ''
      let lastEmit = 0
      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        log = (log + text).slice(-8000)
        const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(text)
        if (m && total > 0) {
          job.progress = Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / total)
          const now = Date.now()
          if (now - lastEmit > 250) {
            lastEmit = now
            this.emit()
          }
        }
      })
      proc.on('error', (err) => {
        this.proc = null
        reject(err)
      })
      proc.on('close', (code) => {
        this.proc = null
        if (code === 0) resolve()
        else reject(new Error(job.cancel || code === null ? 'Exportação cancelada' : 'FFmpeg falhou:\n' + log.slice(-2000)))
      })
    })
  }
}

module.exports = { ExportQueue }
