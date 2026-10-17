import { useEffect, useState } from 'react'
import { uid } from '../store'
import type { Clip, Media, StemsProgress, StemsStatus } from '../types'
import { formatTime } from '../format'

export const STEM_LABELS: Record<string, string> = {
  vocals: 'Voz',
  no_vocals: 'Acompanhamento',
  drums: 'Bateria',
  bass: 'Baixo',
  other: 'Outros',
  guitar: 'Guitarra',
  piano: 'Piano',
}

const MODES = [
  { id: '2', label: 'Voz + acompanhamento', detail: '2 faixas', model: 'htdemucs', twoStems: true },
  { id: '4', label: 'Voz, bateria, baixo e outros', detail: '4 faixas', model: 'htdemucs', twoStems: false },
  { id: '6', label: 'Voz, bateria, baixo, guitarra, piano e outros', detail: '6 faixas', model: 'htdemucs_6s', twoStems: false },
  { id: '4hq', label: 'Alta qualidade: voz, bateria, baixo e outros', detail: '4 faixas · ~4× mais lento', model: 'htdemucs_ft', twoStems: false },
]

interface Props {
  clip: Clip
  media: Media
  onDone: (items: { label: string; media: Media }[], muteOriginal: boolean) => void
  onClose: () => void
}

export function StemsDialog({ clip, media, onDone, onClose }: Props) {
  const [status, setStatus] = useState<StemsStatus | null>(null)
  const [mode, setMode] = useState('4')
  const [muteOriginal, setMuteOriginal] = useState(true)
  const [variant, setVariant] = useState<'cuda' | 'cpu'>('cpu')
  const [busy, setBusy] = useState<'install' | 'separate' | null>(null)
  const [progress, setProgress] = useState<StemsProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.stemsStatus().then((s) => {
      setStatus(s)
      setVariant(s.gpu ? 'cuda' : 'cpu')
    })
    return window.api.onStemsProgress((m) => setProgress((prev) => ({ ...prev, ...m })))
  }, [])

  const install = async () => {
    setError(null)
    setBusy('install')
    setProgress(null)
    try {
      await window.api.installStems(variant)
      setStatus(await window.api.stemsStatus())
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setBusy(null)
    }
  }

  const separate = async () => {
    const m = MODES.find((x) => x.id === mode)!
    setError(null)
    setBusy('separate')
    setProgress({ stage: 'starting', text: 'Iniciando…' })
    try {
      const result = await window.api.separateStems({ filePath: media.path, inPoint: clip.in, duration: clip.duration, model: m.model, twoStems: m.twoStems })
      const items = result.map((r) => {
        if (!r.probe.ok) throw new Error(r.probe.error)
        const label = STEM_LABELS[r.name] ?? r.name
        return { label, media: { ...r.probe.media, id: uid(), name: `${label} — ${media.name}` } }
      })
      onDone(items, muteOriginal)
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err)
      setError(msg.includes('Cancelado') ? null : msg)
    } finally {
      setBusy(null)
    }
  }

  const pct = progress?.progress !== undefined ? Math.round(progress.progress * 100) : null
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <h2>Separar voz e instrumentos</h2>
        <p className="hint left">
          <strong>{media.name}</strong> · trecho de {formatTime(clip.in)} a {formatTime(clip.in + clip.duration)} ({formatTime(clip.duration, false)})
        </p>

        {!status && <p>Verificando o motor de separação…</p>}

        {status && !status.installed && (
          <div className="install-box">
            <p>
              A separação usa o <strong>Demucs</strong>, uma IA de código aberto que roda no seu computador. Ela precisa ser instalada uma vez.
            </p>
            {!status.python ? (
              <p className="error">Python 3.9+ não encontrado. Instale em python.org, marque “Add to PATH” e abra o app de novo.</p>
            ) : (
              <>
                <div className="radio-list">
                  <label className={status.gpu ? '' : 'disabled'}>
                    <input type="radio" checked={variant === 'cuda'} disabled={!status.gpu || !!busy} onChange={() => setVariant('cuda')} />
                    <span>
                      <strong>GPU NVIDIA</strong> — bem mais rápido · download ~2,5 GB{!status.gpu && ' (nenhuma GPU NVIDIA encontrada)'}
                    </span>
                  </label>
                  <label>
                    <input type="radio" checked={variant === 'cpu'} disabled={!!busy} onChange={() => setVariant('cpu')} />
                    <span>
                      <strong>Somente CPU</strong> — download ~300 MB · mais lento
                    </span>
                  </label>
                </div>
                <p className="hint left">
                  Python {status.python} · instalado em {status.dir}
                </p>
              </>
            )}
            {busy === 'install' && progress && (
              <div className="caption-status">
                <p>
                  {progress.step && `${progress.step}/${progress.total} · `}
                  {progress.stage}
                </p>
                <p className="log ellipsis">{progress.line}</p>
              </div>
            )}
          </div>
        )}

        {status?.installed && (
          <>
            <div className="radio-list">
              {MODES.map((m) => (
                <label key={m.id}>
                  <input type="radio" name="mode" checked={mode === m.id} disabled={!!busy} onChange={() => setMode(m.id)} />
                  <span>
                    <strong>{m.label}</strong> <span className="dim">· {m.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={muteOriginal} disabled={!!busy} onChange={(e) => setMuteOriginal(e.target.checked)} />
              Silenciar o áudio original do clipe
            </label>
            <p className="hint left">
              Motor: {status.device === 'cuda' ? 'GPU NVIDIA' : 'CPU'}.{' '}
              {status.device === 'cuda' ? 'Leva poucos segundos por minuto de música.' : 'Pode levar de 1 a 3 minutos por minuto de música.'} Na primeira vez em cada modo o modelo (~80–300 MB) é baixado.
            </p>
            {busy === 'separate' && progress && (
              <div className="caption-status">
                <p>{progress.stage === 'progress' ? (progress.download ? 'Baixando o modelo…' : 'Separando…') : progress.text}</p>
                {pct !== null && (
                  <div className="progress">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          {busy ? (
            <button className="btn" onClick={() => window.api.cancelStems()}>
              Cancelar
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Fechar
            </button>
          )}
          {status && !status.installed && status.python && (
            <button className="btn primary" onClick={install} disabled={!!busy}>
              Instalar motor
            </button>
          )}
          {status?.installed && (
            <button className="btn primary" onClick={separate} disabled={!!busy}>
              Separar faixas
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
