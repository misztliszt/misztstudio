import { useState } from 'react'
import { Film, Image as ImageIcon, Link2, Music, Plus, Search, Trash2, Upload, Zap } from 'lucide-react'
import type { Media } from '../types'
import { formatTime } from '../format'

interface Props {
  media: Media[]
  proxyProgress: Record<string, number>
  onImport: () => void
  onAdd: (mediaId: string) => void
  onRemove: (mediaId: string) => void
  onProxy: (mediaId: string) => void
  onContextMenu: (e: React.MouseEvent, media: Media) => void
  onImportLink: () => void
}

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon }
type Filter = 'all' | 'video' | 'audio' | 'image'

export function MediaBin({ media, proxyProgress, onImport, onAdd, onRemove, onProxy, onContextMenu, onImportLink }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const visible = media.filter((m) => (filter === 'all' || m.kind === filter) && m.name.toLowerCase().includes(query.toLowerCase()))
  const counts = { all: media.length, video: 0, audio: 0, image: 0 }
  for (const m of media) counts[m.kind]++

  return (
    <section className="panel media-bin">
      <header className="panel-header">
        <h2>Mídia</h2>
        <div className="bin-actions">
          <button className="btn small" onClick={onImportLink} data-tip="Baixar de um link (YouTube…)" data-tip-pos="bottom">
            <Link2 size={14} strokeWidth={2.2} /> Link
          </button>
          <button className="btn primary small" onClick={onImport} data-tip="Ctrl+I" data-tip-pos="bottom">
            <Upload size={14} strokeWidth={2.2} /> Importar
          </button>
        </div>
      </header>
      {media.length === 0 ? (
        <button className="dropzone" onClick={onImport}>
          <span className="dropzone-icon">
            <Upload size={22} />
          </span>
          <strong>Arraste seus arquivos para cá</strong>
          <span>ou clique para escolher vídeos, músicas e imagens</span>
          <span
            className="dropzone-link"
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onImportLink()
            }}
          >
            <Link2 size={13} /> ou importe de um link do YouTube
          </span>
        </button>
      ) : (
        <>
          <div className="bin-tools">
            <div className="search">
              <Search size={14} />
              <input placeholder="Buscar mídia" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="filter-chips">
              {(['all', 'video', 'audio', 'image'] as Filter[]).map((f) =>
                f === 'all' || counts[f] > 0 ? (
                  <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                    {{ all: 'Tudo', video: 'Vídeos', audio: 'Áudios', image: 'Imagens' }[f]} <span className="count">{counts[f]}</span>
                  </button>
                ) : null,
              )}
            </div>
          </div>
          <div className="media-grid">
            {visible.map((m) => {
              const progress = proxyProgress[m.path]
              const Icon = KIND_ICON[m.kind]
              return (
                <div
                  key={m.id}
                  className={`media-card ${m.kind}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-media-id', m.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDoubleClick={() => onAdd(m.id)}
                  onContextMenu={(e) => onContextMenu(e, m)}
                  title={`${m.path}${m.codec ? `\nCodec: ${m.codec}` : ''}${m.width ? ` · ${m.width}×${m.height}` : ''}\nDuplo clique: adicionar no cursor`}
                >
                  <div className="media-thumb" style={m.thumb ? { backgroundImage: `url("${m.thumb}")` } : undefined}>
                    {!m.thumb && (
                      <span className="media-icon">
                        <Icon size={24} strokeWidth={1.6} />
                      </span>
                    )}
                    <span className="media-kind">
                      <Icon size={11} strokeWidth={2.4} />
                    </span>
                    {m.kind !== 'image' && <span className="media-meta">{formatTime(m.duration, false)}</span>}
                    {m.kind === 'video' &&
                      (progress !== undefined ? (
                        <span className="media-proxy busy">
                          <span className="mini-progress">
                            <span style={{ width: `${Math.round(progress * 100)}%` }} />
                          </span>
                          proxy
                        </span>
                      ) : m.proxy ? (
                        <span className="media-proxy ready" data-tip="Prévia usando proxy leve" data-tip-pos="top">
                          <Zap size={10} fill="currentColor" /> proxy
                        </span>
                      ) : (
                        <button
                          className="media-proxy action"
                          data-tip="Gera uma cópia leve (540p) só para a prévia"
                          data-tip-pos="top"
                          onClick={(e) => {
                            e.stopPropagation()
                            onProxy(m.id)
                          }}
                        >
                          <Zap size={10} /> gerar proxy
                        </button>
                      ))}
                    <div className="media-actions">
                      <button
                        className="media-action"
                        aria-label="Remover do projeto"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemove(m.id)
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                      <button className="media-action add" aria-label="Adicionar no cursor" onClick={() => onAdd(m.id)}>
                        <Plus size={15} strokeWidth={2.4} />
                      </button>
                    </div>
                  </div>
                  <div className="media-name">{m.name}</div>
                </div>
              )
            })}
            {visible.length === 0 && <p className="hint bin-empty">Nada encontrado.</p>}
          </div>
        </>
      )}
    </section>
  )
}
