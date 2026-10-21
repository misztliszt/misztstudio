import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Library, Loader2, Pause, Play, Plus, Search, ShieldCheck } from 'lucide-react'
import type { LibraryItem, Media, MediaCredit, ProbeResult } from '../types'
import { formatTime } from '../format'
import { Segmented, Toggle } from './controls'

type Category = 'music' | 'sound_effect' | ''
const SUGGESTIONS: Record<Exclude<Category, ''> | 'all', string[]> = {
  music: ['lo-fi', 'piano', 'épico', 'ambiente', 'eletrônica', 'acústico', 'cinematic', 'jazz'],
  sound_effect: ['whoosh', 'aplausos', 'chuva', 'clique', 'explosão', 'notificação', 'passos', 'risada'],
  all: ['piano', 'whoosh', 'ambiente', 'aplausos'],
}

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const creditOf = (item: LibraryItem): MediaCredit => ({
  title: item.title,
  creator: item.creator,
  license: item.licenseName,
  licenseUrl: item.licenseUrl,
  source: item.source,
  landing: item.landing,
  attribution: item.attribution,
  needsCredit: item.needsCredit,
})

/** Texto de créditos para a descrição do vídeo. */
export function creditsText(media: Media[]) {
  const list = media.filter((m) => m.credit?.needsCredit)
  if (!list.length) return ''
  return [
    'Créditos de áudio:',
    ...list.map((m) => {
      const c = m.credit!
      return `• "${c.title}"${c.creator ? ` por ${c.creator}` : ''}, licença ${c.license}${c.licenseUrl ? ` (${c.licenseUrl})` : ''}${c.landing ? ` · ${c.landing}` : ''}`
    }),
  ].join('\n')
}

interface Props {
  media: Media[]
  onAdd: (result: ProbeResult, credit: MediaCredit) => void
  onClose: () => void
}

export function LibraryDialog({ media, onAdd, onClose }: Props) {
  const [tab, setTab] = useState<'search' | 'credits'>('search')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<Category>('music')
  const [commercial, setCommercial] = useState(true)
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<Record<string, number>>({})
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => window.api.onLibraryProgress(({ id, progress }) => setDownloading((d) => (id in d ? { ...d, [id]: progress } : d))), [])
  useEffect(
    () => () => {
      audio.current?.pause()
    },
    [],
  )

  const search = async (query = q, nextPage = 1) => {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.librarySearch({ q: query.trim(), category, commercial, page: nextPage })
      setItems((cur) => (nextPage > 1 && cur ? [...cur, ...r.items] : r.items))
      setPage(nextPage)
      setPages(r.pages)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  // Refaz a busca ao trocar de categoria ou de filtro de licença.
  useEffect(() => {
    if (q.trim()) void search(q, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, commercial])

  const toggle = (item: LibraryItem) => {
    if (playing === item.id) {
      audio.current?.pause()
      setPlaying(null)
      return
    }
    audio.current?.pause()
    const el = new Audio(item.url)
    el.volume = 0.8
    el.onended = () => setPlaying(null)
    el.onerror = () => {
      setPlaying(null)
      setError('Não foi possível tocar a prévia deste som.')
    }
    void el.play()
    audio.current = el
    setPlaying(item.id)
  }

  const add = async (item: LibraryItem) => {
    setDownloading((d) => ({ ...d, [item.id]: 0 }))
    setError(null)
    try {
      const r = await window.api.libraryDownload(item)
      onAdd(r, creditOf(item))
      if (r.ok) setAdded((s) => new Set(s).add(item.id))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setDownloading((d) => {
        const next = { ...d }
        delete next[item.id]
        return next
      })
    }
  }

  const credited = media.filter((m) => m.credit)
  const text = creditsText(media)

  return (
    <div className="modal-backdrop">
      <div className="modal library-dialog">
        <div className="export-head">
          <span className="export-icon">
            <Library size={20} />
          </span>
          <div>
            <h2>Biblioteca livre</h2>
            <span className="dim">Músicas e efeitos sonoros Creative Commons, pelo Openverse</span>
          </div>
          <div className="library-tabs">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'search', label: 'Buscar' },
                { value: 'credits', label: `Créditos${credited.length ? ` (${credited.length})` : ''}` },
              ]}
            />
          </div>
        </div>

        {tab === 'search' && (
          <>
            <div className="link-row">
              <div className="search grow">
                <Search size={14} />
                <input autoFocus placeholder="Ex.: piano calmo, whoosh, chuva…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} />
              </div>
              <button className="btn" onClick={() => void search()} disabled={busy || !q.trim()}>
                {busy && page === 1 ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            <div className="library-filters">
              <Segmented
                value={category || 'all'}
                onChange={(v) => setCategory(v === 'all' ? '' : (v as Category))}
                options={[
                  { value: 'music', label: 'Músicas' },
                  { value: 'sound_effect', label: 'Efeitos sonoros' },
                  { value: 'all', label: 'Tudo' },
                ]}
              />
              <Toggle checked={commercial} onChange={setCommercial} label="Pode usar em vídeo monetizado" />
            </div>
            {!items && (
              <div className="chip-row library-suggest">
                {SUGGESTIONS[category || 'all'].map((s) => (
                  <button
                    key={s}
                    className="chip"
                    onClick={() => {
                      setQ(s)
                      void search(s)
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {items && (
              <div className="library-list">
                {!items.length && <p className="dim">Nada encontrado. Tente outras palavras (em inglês costuma ter mais resultados).</p>}
                {items.map((it) => {
                  const dl = downloading[it.id]
                  return (
                    <div key={it.id} className={`library-item ${playing === it.id ? 'playing' : ''}`}>
                      <button className="lib-play" onClick={() => toggle(it)} aria-label={playing === it.id ? 'Pausar' : 'Ouvir'}>
                        {playing === it.id ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
                      </button>
                      <div className="lib-meta">
                        <strong className="ellipsis" title={it.title}>
                          {it.title}
                        </strong>
                        <span className="ellipsis">{[it.creator, it.duration ? formatTime(it.duration, false) : null, it.genres.slice(0, 2).join(', ') || null, it.source].filter(Boolean).join(' · ')}</span>
                      </div>
                      <a className={`lic lic-${it.license}`} href={it.licenseUrl ?? undefined} target="_blank" rel="noreferrer" title={it.shareAlike ? 'Compartilhar igual: obras derivadas usam a mesma licença' : it.needsCredit ? 'Exige crédito ao autor' : 'Sem exigência de crédito'}>
                        {it.licenseName}
                      </a>
                      {added.has(it.id) ? (
                        <span className="lib-added">
                          <Check size={14} /> Adicionado
                        </span>
                      ) : dl !== undefined ? (
                        <span className="lib-added">
                          <Loader2 size={14} className="spin" /> {Math.round(dl * 100)}%
                        </span>
                      ) : (
                        <button className="btn small" onClick={() => void add(it)}>
                          <Plus size={14} /> Adicionar
                        </button>
                      )}
                    </div>
                  )
                })}
                {page < pages && (
                  <button className="btn ghost small library-more" onClick={() => void search(q, page + 1)} disabled={busy}>
                    {busy ? 'Carregando…' : 'Carregar mais'}
                  </button>
                )}
              </div>
            )}
            <p className="rights-note">
              <ShieldCheck size={14} /> Licenças CC BY e CC BY-SA exigem crédito ao autor: o app guarda os créditos de tudo o que você adicionar (aba Créditos).
            </p>
          </>
        )}

        {tab === 'credits' && (
          <div className="credits-box">
            {!credited.length && <p className="dim">Nenhuma mídia da biblioteca neste projeto ainda.</p>}
            {!!credited.length && (
              <>
                <textarea readOnly value={text || 'Todas as mídias da biblioteca deste projeto são CC0 ou domínio público: não precisam de crédito.'} />
                <button
                  className="btn"
                  disabled={!text}
                  onClick={() => {
                    void navigator.clipboard.writeText(text)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar para a descrição do vídeo'}
                </button>
              </>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
