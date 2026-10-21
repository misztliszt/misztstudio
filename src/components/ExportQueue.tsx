import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, ChevronDown, ChevronUp, Film, FolderOpen, Loader2, X } from 'lucide-react'
import type { ExportJob } from '../types'
import { useFeedback } from '../ui/feedback'

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/** Fila de exportações no canto da janela: progresso, cancelar e abrir a pasta. */
export function ExportQueue() {
  const { toast } = useFeedback()
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [open, setOpen] = useState(true)
  const seen = useRef(new Map<string, ExportJob['state']>())

  useEffect(() => {
    void window.api.listExports().then(setJobs)
    return window.api.onExportJobs((list) => {
      setJobs(list)
      // Avisa uma vez quando cada trabalho termina.
      for (const j of list) {
        const before = seen.current.get(j.id)
        if (before !== j.state && (j.state === 'done' || j.state === 'error')) {
          if (j.state === 'done')
            toast.success(j.format === 'mp3' || j.format === 'wav' ? 'Áudio exportado' : 'Vídeo exportado', {
              detail: j.name,
              duration: 8000,
              action: { label: 'Mostrar na pasta', run: () => void window.api.showInFolder(j.outPath) },
            })
          else toast.error('A exportação falhou', { detail: `${j.name}: ${(j.error ?? '').slice(0, 300)}` })
        }
        seen.current.set(j.id, j.state)
      }
      if (list.some((j) => j.state === 'running' || j.state === 'queued')) setOpen(true)
    })
  }, [toast])

  if (!jobs.length) return null
  const active = jobs.filter((j) => j.state === 'running' || j.state === 'queued').length
  const running = jobs.find((j) => j.state === 'running')

  return (
    <div className="export-queue">
      <button className="eq-head" onClick={() => setOpen((o) => !o)}>
        {active ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
        <span>{active ? `Exportando${running ? ` · ${Math.round(running.progress * 100)}%` : ''}${active > 1 ? ` · ${active - 1} na fila` : ''}` : 'Exportações concluídas'}</span>
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {open && (
        <div className="eq-list">
          {jobs.map((j) => {
            const Icon = j.format === 'mp3' || j.format === 'wav' ? AudioLines : Film
            return (
              <div key={j.id} className={`eq-job ${j.state}`}>
                <Icon size={15} />
                <div className="eq-body">
                  <span className="ellipsis" title={j.outPath}>
                    {j.name}
                  </span>
                  {j.state === 'running' && (
                    <div className="progress small">
                      <div style={{ width: `${Math.round(j.progress * 100)}%` }} />
                    </div>
                  )}
                  <span className="dim">
                    {j.state === 'queued' && 'Na fila'}
                    {j.state === 'running' && (j.progress === 0 ? 'Preparando efeitos de áudio…' : `${Math.round(j.progress * 100)}% · ${elapsed(Date.now() - (j.startedAt ?? Date.now()))}`)}
                    {j.state === 'done' && `Pronto em ${elapsed((j.finishedAt ?? 0) - (j.startedAt ?? 0))}`}
                    {j.state === 'error' && 'Falhou'}
                    {j.state === 'canceled' && 'Cancelada'}
                  </span>
                </div>
                {j.state === 'done' && (
                  <button className="icon-btn small" data-tip="Mostrar na pasta" onClick={() => void window.api.showInFolder(j.outPath)}>
                    <FolderOpen size={14} />
                  </button>
                )}
                {j.state === 'running' || j.state === 'queued' ? (
                  <button className="icon-btn small" data-tip="Cancelar" onClick={() => void window.api.cancelExport(j.id)}>
                    <X size={14} />
                  </button>
                ) : (
                  <button className="icon-btn small" data-tip="Tirar da lista" onClick={() => void window.api.clearExports(j.id)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
