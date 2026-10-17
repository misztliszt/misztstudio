import { useEffect, useState } from 'react'
import { ArrowRight, Clock3, FileWarning, Play, FolderOpen, History, Mic2, Music4, Plus, RectangleHorizontal, RectangleVertical, Square, Trash2 } from 'lucide-react'
import { TEMPLATES, type Template } from '../store'
import type { RecentProject } from '../types'
import { formatTime } from '../format'
import logoUrl from '../../build/icon.png'

const TEMPLATE_ICON: Record<string, typeof Square> = {
  youtube: RectangleHorizontal,
  vertical: RectangleVertical,
  square: Square,
  podcast: Mic2,
  music: Music4,
}

function timeAgo(ms: number) {
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return 'agora mesmo'
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} dia${diff >= 172800 ? 's' : ''}`
  return new Date(ms).toLocaleDateString('pt-BR')
}

interface Props {
  /** Projeto aberto no editor (quando se volta à tela inicial pelo botão Início). */
  current: { name: string; dirty: boolean } | null
  onResume: () => void
  recovery: { savedAt: number } | null
  onTemplate: (t: Template) => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onRecover: () => void
  onDiscardRecovery: () => void
}

export function Welcome({ current, onResume, recovery, onTemplate, onOpen, onOpenRecent, onRecover, onDiscardRecovery }: Props) {
  const [recent, setRecent] = useState<RecentProject[] | null>(null)
  useEffect(() => {
    void window.api.recentProjects().then(setRecent)
  }, [])

  const remove = async (path: string) => {
    await window.api.removeRecent(path)
    setRecent((r) => r?.filter((x) => x.path !== path) ?? null)
  }

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <header className="welcome-hero">
          <img src={logoUrl} alt="" className="welcome-logo" />
          <div>
            <h1>Miszt Studio</h1>
            <p>Edição de vídeo com áudio de estúdio.</p>
          </div>
        </header>

        {current && (
          <button className="resume-card" onClick={onResume}>
            <span className="template-icon">
              <Play size={20} fill="currentColor" />
            </span>
            <div>
              <strong>Continuar editando “{current.name}”</strong>
              <span>{current.dirty ? 'Há alterações não salvas.' : 'Tudo salvo.'}</span>
            </div>
            <ArrowRight size={18} />
          </button>
        )}

        {recovery && (
          <div className="recovery-card">
            <History size={20} />
            <div>
              <strong>Projeto não salvo encontrado</strong>
              <span>Salvo automaticamente {timeAgo(recovery.savedAt)}.</span>
            </div>
            <button className="btn" onClick={onDiscardRecovery}>
              Descartar
            </button>
            <button className="btn primary" onClick={onRecover}>
              Recuperar
            </button>
          </div>
        )}

        <section>
          <div className="welcome-section-head">
            <h2>Novo projeto</h2>
          </div>
          <div className="welcome-templates">
            {TEMPLATES.map((t, i) => {
              const Icon = TEMPLATE_ICON[t.id] ?? Plus
              return (
                <button key={t.id} className={`welcome-template ${i === 0 ? 'featured' : ''}`} onClick={() => onTemplate(t)}>
                  <span className="template-icon">
                    <Icon size={22} strokeWidth={1.7} />
                  </span>
                  <strong>{t.name}</strong>
                  <span>{t.description}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <div className="welcome-section-head">
            <h2>Recentes</h2>
            <button className="btn" onClick={onOpen}>
              <FolderOpen size={15} /> Abrir projeto…
            </button>
          </div>
          {recent === null ? null : recent.length === 0 ? (
            <div className="welcome-empty">
              <Clock3 size={18} />
              <span>Os projetos que você salvar ou abrir aparecem aqui.</span>
            </div>
          ) : (
            <ul className="recent-list">
              {recent.map((r) => (
                <li key={r.path} className={r.exists ? '' : 'missing'}>
                  <button className="recent-main" disabled={!r.exists} onClick={() => onOpenRecent(r.path)} title={r.path}>
                    <span className="recent-thumb" style={r.width && r.height ? { aspectRatio: `${r.width} / ${r.height}` } : undefined}>
                      {!r.exists && <FileWarning size={14} />}
                    </span>
                    <span className="recent-text">
                      <strong>{r.name}</strong>
                      <span className="ellipsis">{r.exists ? r.path : 'Arquivo não encontrado'}</span>
                    </span>
                    <span className="recent-meta">
                      {r.duration ? formatTime(r.duration, false) : '—'}
                      <span>{timeAgo(r.openedAt)}</span>
                    </span>
                  </button>
                  <button className="icon-btn recent-remove" onClick={() => remove(r.path)} data-tip="Remover da lista" data-tip-pos="left">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="welcome-footer">
          <span>
            Miszt Studio · desenvolvido por <strong>Miszt</strong>
          </span>
        </footer>
      </div>
    </div>
  )
}
