import { useEffect, useRef } from 'react'
import { History as HistoryIcon, X } from 'lucide-react'
import { historyEntries, type History } from '../store'

const ago = (at: number, now: number) => {
  const s = Math.round((now - at) / 1000)
  if (s < 10) return 'agora'
  if (s < 60) return `há ${s} s`
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

interface Props {
  history: History
  onJump: (index: number) => void
  onClose: () => void
}

/** Lista de ações do projeto: um clique volta (ou avança) para qualquer ponto. */
export function HistoryPanel({ history, onJump, onClose }: Props) {
  const { entries, current } = historyEntries(history)
  const list = useRef<HTMLDivElement>(null)
  const now = Date.now()

  // Mantém o passo atual visível.
  useEffect(() => {
    list.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="history-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="history-head">
        <HistoryIcon size={15} />
        <strong>Histórico</strong>
        <span className="dim">{entries.length - 1} ações</span>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          <X size={14} />
        </button>
      </div>
      <div className="history-list" ref={list}>
        {entries.map((e, i) => (
          <button key={i} className={`history-item ${i === current ? 'current' : ''} ${i > current ? 'future' : ''}`} onClick={() => onJump(i)}>
            <span className="history-dot" />
            <span className="ellipsis">{e.label || 'Edição'}</span>
            <span className="dim">{ago(e.at, now)}</span>
          </button>
        ))}
      </div>
      <p className="history-hint">Clique numa ação para voltar até ela. As ações em cinza podem ser refeitas.</p>
    </div>
  )
}
