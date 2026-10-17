import { useEffect, useRef, useState } from 'react'
import { Eraser, Sparkles } from 'lucide-react'
import type { BgWorkerIn, BgWorkerOut } from '../bgremove.worker'
import type { Clip, Media, ProbeResult } from '../types'
import { formatTime } from '../format'

interface Props {
  clip: Clip
  media: Media
  onDone: (result: ProbeResult) => void
  onClose: () => void
}

const BATCH = 24

/**
 * Remove o fundo do trecho usado do clipe: o processo principal extrai quadros pequenos,
 * o worker calcula a máscara de cada um (MODNet) e o FFmpeg gera um WebM com transparência.
 */
export function BgRemoveDialog({ clip, media, onDone, onClose }: Props) {
  const [stage, setStage] = useState<'idle' | 'running' | 'error'>('idle')
  const [text, setText] = useState('')
  const [progress, setProgress] = useState(0)
  const [download, setDownload] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<() => void>(() => {})
  const srcDuration = clip.duration * (clip.speed || 1)

  useEffect(() => () => cancelRef.current(), [])

  const start = async () => {
    setStage('running')
    setError(null)
    let canceled = false
    let jobId: string | null = null
    const worker = new Worker(new URL('../bgremove.worker.ts', import.meta.url), { type: 'module' })
    cancelRef.current = () => {
      canceled = true
      worker.terminate()
      if (jobId) void window.api.bgCancel(jobId)
    }
    const pending = new Map<number, (m: Uint8Array) => void>()
    let readyResolve: () => void = () => {}
    let fail: (err: Error) => void = () => {}
    const ready = new Promise<void>((res, rej) => {
      readyResolve = res
      fail = rej
    })
    worker.onmessage = (e: MessageEvent<BgWorkerOut>) => {
      const m = e.data
      if (m.type === 'status') setText(m.text)
      else if (m.type === 'progress') setDownload((d) => ({ ...d, [m.file]: m.progress }))
      else if (m.type === 'ready') readyResolve()
      else if (m.type === 'mask') pending.get(m.index)?.(m.mask)
      else if (m.type === 'error') fail(new Error(m.message))
    }
    try {
      setText('Preparando os quadros…')
      const [job] = await Promise.all([window.api.bgPrepare(media.path, clip.in, srcDuration), (worker.postMessage({ type: 'load' } satisfies BgWorkerIn), ready)])
      jobId = job.id
      const frameBytes = job.width * job.height * 3
      const startedAt = performance.now()
      let batch: Uint8Array[] = []
      for (let i = 0; i < job.frames; i++) {
        if (canceled) return
        const res = await fetch(job.url, { headers: { Range: `bytes=${i * frameBytes}-${(i + 1) * frameBytes - 1}` } })
        const rgb = new Uint8Array(await res.arrayBuffer())
        const mask = await new Promise<Uint8Array>((resolve, reject) => {
          pending.set(i, resolve)
          fail = reject
          worker.postMessage({ type: 'frame', index: i, rgb, width: job.width, height: job.height } satisfies BgWorkerIn, [rgb.buffer])
        })
        pending.delete(i)
        batch.push(mask)
        if (batch.length === BATCH || i === job.frames - 1) {
          const joined = new Uint8Array(batch.reduce((s, b) => s + b.length, 0))
          let o = 0
          for (const b of batch) {
            joined.set(b, o)
            o += b.length
          }
          await window.api.bgWriteMasks(job.id, joined.buffer)
          batch = []
        }
        const done = i + 1
        const elapsed = (performance.now() - startedAt) / 1000
        const eta = (elapsed / done) * (job.frames - done)
        setProgress(done / job.frames)
        setText(`Recortando quadro ${done} de ${job.frames} · faltam ~${formatTime(eta, false)}`)
      }
      setText('Gerando o vídeo com transparência…')
      worker.terminate()
      const result = await window.api.bgFinish(job.id, media.hasAudio && !clip.audioDetached)
      if (!canceled) onDone(result)
    } catch (err) {
      worker.terminate()
      if (!canceled) {
        setStage('error')
        setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }
  }

  const files = Object.entries(download).filter(([, v]) => v < 100)
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <div className="export-head">
          <span className="export-icon">
            <Eraser size={20} />
          </span>
          <div>
            <h2>Remover fundo com IA</h2>
            <span className="dim">
              {media.name} · {formatTime(srcDuration, false)}
            </span>
          </div>
        </div>
        <p className="hint left">
          Uma IA (MODNet) recorta a pessoa ou o objeto principal de cada quadro, no seu computador. Funciona melhor com uma pessoa em destaque. Na primeira vez o modelo (~25 MB) é baixado do Hugging Face.
        </p>
        {stage !== 'idle' && (
          <div className="caption-status">
            <p>{text}</p>
            {files.map(([f, v]) => (
              <div key={f} className="download">
                <span className="ellipsis">{f}</span>
                <div className="progress">
                  <div style={{ width: `${v}%` }} />
                </div>
              </div>
            ))}
            {progress > 0 && (
              <div className="progress">
                <div style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => {
              cancelRef.current()
              onClose()
            }}
          >
            {stage === 'running' ? 'Cancelar' : 'Fechar'}
          </button>
          {stage !== 'running' && (
            <button className="btn primary" onClick={start}>
              <Sparkles size={15} /> {stage === 'error' ? 'Tentar de novo' : 'Remover fundo'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
