import { useState } from 'react'
import { CAPTION_LANGUAGES, CAPTION_MODELS, toCaptionItems, transcribe, type CaptionItem } from '../captions'
import { TEXT_PRESETS } from '../text'
import type { Project, TextStyle } from '../types'

export function CaptionsDialog({ project, total, onDone, onClose }: { project: Project; total: number; onDone: (items: CaptionItem[], style: Partial<TextStyle>) => void; onClose: () => void }) {
  const [model, setModel] = useState(CAPTION_MODELS[0].id)
  const [language, setLanguage] = useState('portuguese')
  const [preset, setPreset] = useState('Legenda')
  const [status, setStatus] = useState<string | null>(null)
  const [download, setDownload] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const busy = status !== null && !error

  const start = async () => {
    setError(null)
    setStatus('Preparando…')
    try {
      const chunks = await transcribe(project, model, language, (m) => {
        if (m.type === 'status') setStatus(m.text)
        else if (m.type === 'progress') setDownload((d) => ({ ...d, [m.file]: m.progress }))
      })
      const items = toCaptionItems(chunks, total)
      if (!items.length) throw new Error('Nenhuma fala foi reconhecida.')
      onDone(items, TEXT_PRESETS.find((p) => p.name === preset)?.style ?? {})
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  const files = Object.entries(download).filter(([, v]) => v < 100)
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <h2>Legendas automáticas</h2>
        <p className="hint left">O áudio da timeline é transcrito no seu computador com o Whisper. Na primeira vez o modelo é baixado do Hugging Face e fica guardado.</p>
        <div className="form-grid">
          <label>Modelo</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
            {CAPTION_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <label>Idioma</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
            {CAPTION_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <label>Estilo</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} disabled={busy}>
            {TEXT_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {status && !error && (
          <div className="caption-status">
            <p>{status}</p>
            {files.map(([f, v]) => (
              <div key={f} className="download">
                <span className="ellipsis">{f}</span>
                <div className="progress">
                  <div style={{ width: `${v}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Fechar
          </button>
          <button className="btn primary" onClick={start} disabled={busy}>
            Gerar legendas
          </button>
        </div>
      </div>
    </div>
  )
}
