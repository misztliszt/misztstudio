import { useEffect, useState } from 'react'
import { AudioLines, Download, Film, FolderOpen, Link2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import type { LinkInfo, ProbeResult } from '../types'
import { formatTime } from '../format'

type Preset = 'best' | 'hd720' | 'max' | 'audio'
const PRESETS: { id: Preset; label: string; detail: string; icon: typeof Film }[] = [
  { id: 'best', label: 'Vídeo 1080p', detail: 'H.264, roda leve na prévia', icon: Film },
  { id: 'hd720', label: 'Vídeo 720p', detail: 'Arquivo menor', icon: Film },
  { id: 'max', label: 'Máxima qualidade', detail: '4K se houver (pode precisar de proxy)', icon: Sparkles },
  { id: 'audio', label: 'Só o áudio', detail: 'M4A, para trilhas e músicas', icon: AudioLines },
]

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  onDone: (result: ProbeResult) => void
  onClose: () => void
}

export function LinkImportDialog({ onDone, onClose }: Props) {
  const [status, setStatus] = useState<{ installed: boolean; version: string | null; outDir: string } | null>(null)
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [preset, setPreset] = useState<Preset>('best')
  const [busy, setBusy] = useState<'install' | 'info' | 'download' | 'update' | null>(null)
  const [progress, setProgress] = useState<{ stage: string; part?: number; progress?: number; speed?: string | null; eta?: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void window.api.ytdlpStatus().then(setStatus)
    return window.api.onYtdlpProgress(setProgress)
  }, [])

  // Cola automaticamente um link da área de transferência ao abrir.
  useEffect(() => {
    navigator.clipboard
      ?.readText()
      .then((t) => /^https?:\/\/\S+$/.test(t.trim()) && setUrl((u) => u || t.trim()))
      .catch(() => {})
  }, [])

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>) => {
    setError(null)
    setBusy(kind)
    setProgress(null)
    try {
      return await fn()
    } catch (err) {
      const msg = errorText(err)
      if (!/abort|killed|null/i.test(msg)) setError(msg)
      return undefined
    } finally {
      setBusy(null)
    }
  }

  const install = () => run('install', async () => setStatus(await window.api.ytdlpInstall()))
  const pickFolder = async () => {
    const outDir = await window.api.ytdlpPickFolder()
    setStatus((s) => (s ? { ...s, outDir } : s))
  }
  const update = () =>
    run('update', async () => {
      const r = await window.api.ytdlpUpdate()
      setStatus((s) => (s ? { ...s, version: r.version } : s))
      setNote(r.message)
    })
  const lookup = () => {
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) {
      setError('Cole um link que comece com http:// ou https://')
      return
    }
    setInfo(null)
    void run('info', async () => setInfo(await window.api.ytdlpInfo(u)))
  }
  const download = () =>
    run('download', async () => {
      const result = await window.api.ytdlpDownload(info?.webpage ?? url.trim(), preset)
      onDone(result)
    })

  const pct = progress?.progress !== undefined ? Math.round(progress.progress * 100) : null
  const stageText =
    progress?.stage === 'install'
      ? 'Baixando o yt-dlp…'
      : progress?.stage === 'processing'
        ? 'Juntando vídeo e áudio…'
        : progress?.stage === 'download'
          ? `${preset === 'audio' ? 'Baixando o áudio' : progress.part === 2 ? 'Baixando o áudio' : 'Baixando o vídeo'}${progress.speed ? ` · ${progress.speed}` : ''}${progress.eta ? ` · faltam ${progress.eta}` : ''}`
          : 'Preparando…'

  return (
    <div className="modal-backdrop">
      <div className="modal link-dialog">
        <div className="export-head">
          <span className="export-icon">
            <Link2 size={20} />
          </span>
          <div>
            <h2>Importar de um link</h2>
            <span className="dim">YouTube e centenas de outros sites, via yt-dlp</span>
          </div>
        </div>

        {!status && <p className="dim">Verificando…</p>}

        {status && !status.installed && (
          <div className="install-box">
            <p>
              Esta função usa o <strong>yt-dlp</strong>, um programa de código aberto. Ele é baixado uma vez do GitHub oficial (~18 MB) e fica na pasta do app.
            </p>
            {busy === 'install' && pct !== null && (
              <div className="progress">
                <div style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}

        {status?.installed && (
          <>
            <div className="link-row">
              <div className="search grow">
                <Link2 size={14} />
                <input
                  autoFocus
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={url}
                  disabled={!!busy}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    setInfo(null)
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && lookup()}
                />
              </div>
              <button className="btn" onClick={lookup} disabled={!!busy || !url.trim()}>
                {busy === 'info' ? 'Buscando…' : 'Buscar'}
              </button>
            </div>

            {info && (
              <div className="link-info">
                {info.thumbnail ? <img src={info.thumbnail} alt="" /> : <div className="link-thumb-empty" />}
                <div>
                  <strong>{info.title}</strong>
                  <span>
                    {[info.uploader, info.duration ? formatTime(info.duration, false) : null, info.maxHeight ? `até ${info.maxHeight}p` : null, info.extractor].filter(Boolean).join(' · ')}
                  </span>
                  {info.license && <span className="license">Licença: {info.license}</span>}
                </div>
              </div>
            )}

            {info && (
              <div className="radio-list compact">
                {PRESETS.map((p) => (
                  <label key={p.id}>
                    <input type="radio" name="dl-preset" checked={preset === p.id} disabled={!!busy} onChange={() => setPreset(p.id)} />
                    <span>
                      <strong>{p.label}</strong> <span className="dim">· {p.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {busy === 'download' && (
              <div className="caption-status">
                <p>{stageText}</p>
                {pct !== null && progress?.stage === 'download' && (
                  <div className="progress">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )}

            <div className="save-row">
              <span className="save-label">Salvar em</span>
              <button className="folder-chip" onClick={pickFolder} disabled={!!busy} title={status.outDir}>
                <FolderOpen size={14} />
                <span className="ellipsis">{status.outDir}</span>
              </button>
              <button className="btn small" onClick={pickFolder} disabled={!!busy}>
                Alterar…
              </button>
            </div>

            <p className="rights-note">
              <ShieldCheck size={14} /> Baixe só vídeos seus, com licença livre (ex.: Creative Commons) ou com permissão do autor.
            </p>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {note && !error && <p className="hint left">{note}</p>}

        <div className="modal-actions spread">
          {status?.installed ? (
            <button className="btn ghost small" onClick={update} disabled={!!busy} data-tip={status.version ? `Versão ${status.version}` : undefined} data-tip-pos="top">
              <RefreshCw size={13} /> {busy === 'update' ? 'Atualizando…' : 'Atualizar yt-dlp'}
            </button>
          ) : (
            <span />
          )}
          <div className="modal-actions-right">
            {busy === 'download' || busy === 'install' ? (
              <button className="btn" onClick={() => window.api.ytdlpCancel()}>
                Cancelar
              </button>
            ) : (
              <button className="btn" onClick={onClose} disabled={!!busy}>
                Fechar
              </button>
            )}
            {status && !status.installed && (
              <button className="btn primary" onClick={install} disabled={!!busy}>
                <Download size={15} /> Instalar yt-dlp
              </button>
            )}
            {status?.installed && (
              <button className="btn primary" onClick={download} disabled={!!busy || !info}>
                <Download size={15} /> Baixar e importar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
