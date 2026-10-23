import { useEffect, useRef, useState } from 'react'
import { AudioWaveform, Headphones, Loader2, Square } from 'lucide-react'
import type { CleanOptions, Clip, Media } from '../types'
import { Segmented, Slider, Toggle } from './controls'

export const CLEAN_PRESETS: Record<'light' | 'medium' | 'strong', CleanOptions> = {
  light: { reduction: 8, floor: -40, highpass: 70, deep: 0, declick: false },
  medium: { reduction: 14, floor: -35, highpass: 80, deep: 0, declick: true },
  strong: { reduction: 24, floor: -30, highpass: 90, deep: 7, declick: true },
}

const STORE_KEY = 'miszt.clean'
const PREVIEW_SECONDS = 8

function loadOpts(): CleanOptions {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return { ...CLEAN_PRESETS.medium, ...(JSON.parse(raw) as Partial<CleanOptions>) }
  } catch {
    // sem armazenamento
  }
  return CLEAN_PRESETS.medium
}

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  clip: Clip
  media: Media
  /** Instante da timeline (para escolher o trecho da prévia). */
  time: number
  onApply: (opts: CleanOptions) => void
  onClose: () => void
}

/** Limpeza de voz com ajuste fino e prévia antes/depois de um trecho de 8 s. */
export function CleanDialog({ clip, media, time, onApply, onClose }: Props) {
  const [o, setO] = useState<CleanOptions>(loadOpts)
  const [preview, setPreview] = useState<{ url: string; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<'original' | 'clean' | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  // Trecho da prévia: a partir do cursor se ele estiver no clipe, senão o começo.
  const speed = clip.speed || 1
  const local = time >= clip.start && time < clip.start + clip.duration ? time - clip.start : 0
  const segStart = clip.in + local * speed
  const segLen = Math.min(PREVIEW_SECONDS, clip.duration * speed - local * speed)
  const optsKey = JSON.stringify(o)

  const set = (patch: Partial<CleanOptions>) => {
    const next = { ...o, ...patch }
    setO(next)
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next))
    } catch {
      // opcional
    }
  }

  const stop = () => {
    audio.current?.pause()
    audio.current = null
    setPlaying(null)
  }
  useEffect(() => stop, [])

  const play = async (which: 'original' | 'clean') => {
    stop()
    setError(null)
    let url = media.url
    let start = segStart
    if (which === 'clean') {
      let p = preview
      if (!p || p.key !== optsKey) {
        setBusy(true)
        try {
          const r = await window.api.cleanAudio(media.path, segStart, segLen, o)
          if (!r.ok) throw new Error(r.error)
          p = { url: r.media.url, key: optsKey }
          setPreview(p)
        } catch (err) {
          setError(errorText(err))
          return
        } finally {
          setBusy(false)
        }
      }
      url = p.url
      start = 0
    }
    const el = new Audio(url)
    el.currentTime = start
    const end = start + segLen
    el.ontimeupdate = () => el.currentTime >= end && stop()
    el.onended = stop
    void el.play()
    audio.current = el
    setPlaying(which)
  }

  const presetOf = (Object.keys(CLEAN_PRESETS) as (keyof typeof CLEAN_PRESETS)[]).find((k) => JSON.stringify(CLEAN_PRESETS[k]) === optsKey) ?? 'custom'

  return (
    <div className="modal-backdrop">
      <div className="modal record-dialog clean-dialog">
        <div className="export-head">
          <span className="export-icon">
            <AudioWaveform size={20} />
          </span>
          <div>
            <h2>Limpar voz</h2>
            <span className="dim">Remove chiado, zumbido, ventilador e ruído de fundo</span>
          </div>
        </div>

        <Segmented
          value={presetOf}
          onChange={(v) => v !== 'custom' && set(CLEAN_PRESETS[v as keyof typeof CLEAN_PRESETS])}
          options={[
            { value: 'light', label: 'Leve' },
            { value: 'medium', label: 'Média' },
            { value: 'strong', label: 'Forte' },
            { value: 'custom', label: 'Personalizada' },
          ]}
        />

        <div className="clean-sliders">
          <Slider label="Redução do ruído" value={o.reduction} min={0} max={40} step={0.5} format={(v) => `${v.toFixed(1)} dB`} onChange={(v) => set({ reduction: v })} onReset={() => set({ reduction: 14 })} />
          <p className="hint left">Quanto o ruído é abaixado. Valores altos podem deixar a voz “metálica”.</p>
          <Slider label="Nível do ruído de fundo" value={o.floor} min={-80} max={-20} step={1} format={(v) => `${Math.round(v)} dB`} onChange={(v) => set({ floor: v })} onReset={() => set({ floor: -35 })} />
          <p className="hint left">Suba se o ruído for alto (rua, ventilador); desça para gravações quase limpas.</p>
          <Slider label="Cortar graves (zumbido, vento)" value={o.highpass} min={0} max={200} step={5} format={(v) => (v === 0 ? 'desligado' : `${Math.round(v)} Hz`)} onChange={(v) => set({ highpass: v })} onReset={() => set({ highpass: 80 })} />
          <Slider label="Redução extra (ruídos que mudam)" value={o.deep} min={0} max={15} step={0.5} format={(v) => (v === 0 ? 'desligada' : v.toFixed(1))} onChange={(v) => set({ deep: v })} onReset={() => set({ deep: 0 })} />
          <Toggle checked={o.declick} onChange={(v) => set({ declick: v })} label="Remover estalos e cliques" />
        </div>

        <div className="clean-preview">
          <Headphones size={15} />
          <span className="dim">Prévia de {Math.max(1, Math.round(segLen))} s{local > 0 ? ' a partir do cursor' : ''}</span>
          <button className={`btn small ${playing === 'original' ? 'active' : ''}`} onClick={() => (playing === 'original' ? stop() : void play('original'))} disabled={busy}>
            {playing === 'original' ? <Square size={12} fill="currentColor" /> : null} Original
          </button>
          <button className={`btn small ${playing === 'clean' ? 'active' : ''}`} onClick={() => (playing === 'clean' ? stop() : void play('clean'))} disabled={busy}>
            {busy ? <Loader2 size={12} className="spin" /> : playing === 'clean' ? <Square size={12} fill="currentColor" /> : null} Limpo
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={() => {
              stop()
              onApply(o)
            }}
          >
            Aplicar no clipe
          </button>
        </div>
      </div>
    </div>
  )
}
