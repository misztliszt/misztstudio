import { useMemo, useState } from 'react'
import { AudioLines, Film, Gauge, Music, Smartphone, Sparkles, Upload, Youtube, Zap } from 'lucide-react'
import type { ExportFormat, ExportOptions, Project } from '../types'
import { formatTime } from '../format'
import { Select, Toggle } from './controls'

interface Preset {
  id: string
  name: string
  detail: string
  icon: typeof Film
  options: Partial<ExportOptions>
}

const PRESETS: Preset[] = [
  { id: 'youtube', name: 'YouTube 1080p', detail: 'H.264 · volume −14 LUFS', icon: Youtube, options: { format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high', normalize: true } },
  { id: 'youtube4k', name: 'YouTube 4K', detail: 'H.265 · 2160p', icon: Sparkles, options: { format: 'mp4', codec: 'h265', resolution: 2160, quality: 'high', normalize: true } },
  { id: 'social', name: 'Reels / TikTok', detail: '1080p · leve para upload', icon: Smartphone, options: { format: 'mp4', codec: 'h264', resolution: 1080, quality: 'medium', normalize: true } },
  { id: 'master', name: 'Arquivo mestre', detail: 'Qualidade máxima', icon: Film, options: { format: 'mov', codec: 'h264', resolution: 0, quality: 'max', normalize: false } },
  { id: 'draft', name: 'Rascunho rápido', detail: '720p · para revisar', icon: Zap, options: { format: 'mp4', codec: 'h264', resolution: 720, quality: 'small', normalize: false } },
  { id: 'mp3', name: 'Só áudio (MP3)', detail: '320 kbps', icon: Music, options: { format: 'mp3', normalize: true } },
  { id: 'wav', name: 'Só áudio (WAV)', detail: '24 bits sem perdas', icon: AudioLines, options: { format: 'wav', normalize: false } },
]

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 (recomendado)' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'mp3', label: 'MP3 (só áudio)' },
  { value: 'wav', label: 'WAV (só áudio)' },
]

/** Bitrate de vídeo estimado (Mbps) para 1080p30 em cada qualidade; escala com pixels e fps. */
const MBPS_1080 = { max: 22, high: 10, medium: 6, small: 3 }

export function ExportDialog({ project, duration, name, onExport, onClose }: { project: Project; duration: number; name: string; onExport: (o: ExportOptions) => void; onClose: () => void }) {
  const [preset, setPreset] = useState('youtube')
  const [opts, setOpts] = useState<ExportOptions>({ format: 'mp4', codec: 'h264', resolution: 1080, fps: 0, quality: 'high', normalize: true, fileName: name, ...PRESETS[0].options })
  const set = (patch: Partial<ExportOptions>) => {
    setOpts((o) => ({ ...o, ...patch }))
    setPreset('custom')
  }
  const audioOnly = opts.format === 'mp3' || opts.format === 'wav'
  const shortSide = Math.min(project.width, project.height)
  const outShort = opts.resolution || shortSide
  const outW = Math.round((project.width / shortSide) * outShort)
  const outH = Math.round((project.height / shortSide) * outShort)
  const fps = opts.fps || project.fps

  const sizeMb = useMemo(() => {
    let mbps: number
    if (opts.format === 'wav') mbps = 48000 * 24 * 2 / 1e6
    else if (opts.format === 'mp3') mbps = 0.32
    else {
      const pixels = (outW * outH) / (1920 * 1080)
      mbps = MBPS_1080[opts.quality] * Math.pow(pixels, 0.75) * Math.sqrt(fps / 30) * (opts.codec === 'h265' || opts.format === 'webm' ? 0.6 : 1) + 0.25
    }
    return (mbps * duration) / 8
  }, [opts, outW, outH, fps, duration])

  const resOptions = [
    { value: 0, label: `Do projeto (${project.width}×${project.height})` },
    ...[2160, 1440, 1080, 720, 480].filter((r) => r !== shortSide).map((r) => ({ value: r, label: `${r}p` })),
  ]

  return (
    <div className="modal-backdrop">
      <div className="modal export-dialog">
        <div className="export-head">
          <span className="export-icon">
            <Upload size={20} />
          </span>
          <div>
            <h2>Exportar</h2>
            <span className="dim">
              {formatTime(duration, false)} · {project.clips.length} clipes
            </span>
          </div>
        </div>

        <div className="export-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`export-preset ${preset === p.id ? 'active' : ''}`}
              onClick={() => {
                setOpts((o) => ({ ...o, fps: 0, ...p.options }))
                setPreset(p.id)
              }}
            >
              <p.icon size={18} strokeWidth={1.8} />
              <strong>{p.name}</strong>
              <span>{p.detail}</span>
            </button>
          ))}
        </div>

        <div className="export-grid">
          <label>Nome do arquivo</label>
          <div className="number-input">
            <input value={opts.fileName} onChange={(e) => setOpts((o) => ({ ...o, fileName: e.target.value }))} />
            <span className="suffix">.{opts.format}</span>
          </div>
          <label>Formato</label>
          <Select value={opts.format} options={FORMATS} onChange={(format) => set({ format })} />
          {!audioOnly && (
            <>
              <label>Resolução</label>
              <Select value={opts.resolution === shortSide ? 0 : opts.resolution} options={resOptions} onChange={(resolution) => set({ resolution })} />
              <label>Quadros por segundo</label>
              <Select value={opts.fps} options={[{ value: 0, label: `Do projeto (${project.fps})` }, ...[24, 25, 30, 50, 60].filter((f) => f !== project.fps).map((f) => ({ value: f, label: `${f} fps` }))]} onChange={(f) => set({ fps: f })} />
              {opts.format !== 'webm' && (
                <>
                  <label>Codec</label>
                  <Select
                    value={opts.codec}
                    options={[
                      { value: 'h264', label: 'H.264 (compatível com tudo)' },
                      { value: 'h265', label: 'H.265 / HEVC (arquivos menores)' },
                    ]}
                    onChange={(codec) => set({ codec })}
                  />
                </>
              )}
              <label>Qualidade</label>
              <Select
                value={opts.quality}
                options={[
                  { value: 'max', label: 'Máxima' },
                  { value: 'high', label: 'Alta' },
                  { value: 'medium', label: 'Média' },
                  { value: 'small', label: 'Arquivo pequeno' },
                ]}
                onChange={(quality) => set({ quality })}
              />
            </>
          )}
          <label>Volume</label>
          <div className="export-toggle">
            <Toggle checked={opts.normalize} onChange={(normalize) => set({ normalize })} label="Normalizar para −14 LUFS" />
          </div>
        </div>

        <div className="export-summary">
          <Gauge size={15} />
          <span>
            {audioOnly ? 'Áudio' : `${outW}×${outH} · ${fps} fps`} · tamanho estimado <strong>≈ {sizeMb < 1 ? `${Math.max(0.1, sizeMb).toFixed(1)} MB` : sizeMb > 1024 ? `${(sizeMb / 1024).toFixed(1)} GB` : `${Math.round(sizeMb)} MB`}</strong>
          </span>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => onExport({ ...opts, fileName: opts.fileName.trim() || 'video' })}>
            <Upload size={15} /> Exportar
          </button>
        </div>
      </div>
    </div>
  )
}
