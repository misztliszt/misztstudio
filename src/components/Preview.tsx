import { useEffect, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { PlaybackEngine } from '../engine'
import type { Action } from '../store'
import type { Clip, Project } from '../types'
import { formatTime } from '../format'
import { useClockTime } from '../clock'
import { selectionGeometry, TransformOverlay } from './TransformOverlay'

interface Props {
  engine: PlaybackEngine
  project: Project
  selected: Clip | undefined
  time: number
  duration: number
  playing: boolean
  onToggle: () => void
  onSeek: (t: number) => void
  onSelect: (ids: string[]) => void
  dispatch: (a: Action, merge?: boolean) => void
  checkpoint: () => void
}

export function Preview({ engine, project, selected, time, duration, playing, onToggle, onSeek, onSelect, dispatch, checkpoint }: Props) {
  const { width, height } = project
  const ref = useRef<HTMLCanvasElement>(null)
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 })
  // Tamanho em tela calculado aqui: o canvas pode ter menos pixels (qualidade da prévia) e mesmo assim ocupar o palco todo.
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    engine.attach(ref.current)
    return () => engine.attach(null)
  }, [engine])

  // Acompanha onde o canvas está desenhado dentro do palco, para posicionar as alças.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const update = () => {
      const stage = canvas.parentElement!
      const s = Math.min((stage.clientWidth - 40) / width, (stage.clientHeight - 40) / height)
      if (s > 0) setFit((f) => (f && Math.abs(f.width - width * s) < 0.5 && Math.abs(f.height - height * s) < 0.5 ? f : { width: width * s, height: height * s }))
      setRect({ left: canvas.offsetLeft, top: canvas.offsetTop, width: canvas.offsetWidth, height: canvas.offsetHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(canvas)
    ro.observe(canvas.parentElement!)
    return () => ro.disconnect()
  }, [width, height])

  /** Clique na prévia: seleciona o clipe visível sob o ponteiro (de cima para baixo); fora de clipes, reproduz/pausa. */
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * width
    const fy = ((e.clientY - r.top) / r.height) * height
    for (const track of project.tracks) {
      if (track.kind !== 'video' || track.hidden) continue
      const clip = project.clips.find((c) => c.trackId === track.id && time >= c.start && time < c.start + c.duration)
      if (!clip) continue
      const g = selectionGeometry(project, clip, time)
      if (!g) continue
      const a = (-g.rotation * Math.PI) / 180
      const dx = fx - g.cx
      const dy = fy - g.cy
      const lx = dx * Math.cos(a) - dy * Math.sin(a)
      const ly = dx * Math.sin(a) + dy * Math.cos(a)
      if (Math.abs(lx) <= g.w / 2 && Math.abs(ly) <= g.h / 2) {
        onSelect([clip.id])
        return
      }
    }
    if (selected) onSelect([])
    else onToggle()
  }

  // Timecode e barra seguem o relógio a cada quadro, sem re-renderizar o app inteiro.
  const live = useClockTime()
  const progress = duration > 0 ? Math.min(1, live / duration) : 0
  return (
    <section className="panel preview">
      <div className="preview-stage">
        <canvas ref={ref} className="preview-canvas" style={fit ?? { aspectRatio: `${width} / ${height}` }} onClick={onCanvasClick} onDoubleClick={onToggle} />
        {selected && !playing && rect.width > 0 && <TransformOverlay project={project} clip={selected} time={time} rect={rect} dispatch={dispatch} checkpoint={checkpoint} />}
      </div>
      <div
        className="scrubber"
        onPointerDown={(e) => {
          const el = e.currentTarget
          el.setPointerCapture(e.pointerId)
          const seekAt = (x: number) => {
            const r = el.getBoundingClientRect()
            onSeek(Math.max(0, Math.min(1, (x - r.left) / r.width)) * duration)
          }
          seekAt(e.clientX)
          const move = (ev: PointerEvent) => seekAt(ev.clientX)
          const up = () => {
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', up)
          }
          el.addEventListener('pointermove', move)
          el.addEventListener('pointerup', up)
        }}
      >
        <div className="scrubber-fill" style={{ width: `${progress * 100}%` }} />
        <div className="scrubber-knob" style={{ left: `${progress * 100}%` }} />
      </div>
      <div className="transport">
        <span className="timecode current">{formatTime(live)}</span>
        <div className="transport-buttons">
          <button className="transport-btn" onClick={() => onSeek(0)} data-tip="Início · Home" data-tip-pos="top" aria-label="Ir para o início">
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button className="transport-btn play" onClick={onToggle} data-tip="Reproduzir / pausar · Espaço" data-tip-pos="top" aria-label={playing ? 'Pausar' : 'Reproduzir'}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button className="transport-btn" onClick={() => onSeek(duration)} data-tip="Fim · End" data-tip-pos="top" aria-label="Ir para o fim">
            <SkipForward size={17} fill="currentColor" />
          </button>
        </div>
        <span className="timecode total">
          {formatTime(duration)} <span className="res-badge">{height >= 2160 ? '4K' : `${Math.min(width, height)}p`}</span>
        </span>
      </div>
    </section>
  )
}
