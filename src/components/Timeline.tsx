import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Eye, EyeOff, Film, Magnet, Plus, Volume2, VolumeX, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { Action } from '../store'
import { mainTrackId, maxClipDuration, projectDuration } from '../store'
import { keyTimes } from '../anim'
import { useClockTime } from '../clock'
import { beatTimes } from '../beats'
import type { Clip, Project, Track } from '../types'
import { PEAKS_PER_SECOND, usePeaks } from '../waveform'
import { formatTime } from '../format'

const HEADER = 170
const EDGE = 7
const SNAP_PX = 8
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

interface Props {
  project: Project
  time: number
  zoom: number
  selection: string[]
  selectedTrack: string | null
  onSelectTrack: (id: string | null) => void
  playing: boolean
  dispatch: (a: Action, merge?: boolean) => void
  checkpoint: () => void
  onSeek: (t: number) => void
  onSelect: (ids: string[]) => void
  onZoom: (z: number) => void
  /** Menu de contexto num clipe, ou na trilha vazia (clip = null) no instante 	ime. */
  onContextMenu: (e: React.MouseEvent, clip: Clip | null, trackId: string, time: number) => void
}

export function Timeline({ project, time, zoom, selection, selectedTrack, onSelectTrack, playing, dispatch, checkpoint, onSeek, onSelect, onZoom, onContextMenu }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const mainId = mainTrackId(project)

  /** Seleção com retângulo a partir de um espaço vazio da trilha (Shift soma à seleção). */
  const startMarquee = (e: React.PointerEvent) => {
    const inner = innerRef.current
    if (!inner) return
    const base = selection
    const additive = e.shiftKey
    const origin = { x: e.clientX, y: e.clientY }
    let moved = false
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < 4) return
      moved = true
      const r = inner.getBoundingClientRect()
      const left = Math.min(origin.x, ev.clientX)
      const top = Math.min(origin.y, ev.clientY)
      const right = Math.max(origin.x, ev.clientX)
      const bottom = Math.max(origin.y, ev.clientY)
      setMarquee({ x: left - r.left, y: top - r.top, w: right - left, h: bottom - top })
      const hit: string[] = []
      inner.querySelectorAll<HTMLElement>('[data-clip]').forEach((el) => {
        const b = el.getBoundingClientRect()
        if (b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom) hit.push(el.dataset.clip!)
      })
      onSelect(additive ? [...new Set([...base, ...hit])] : hit)
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      setMarquee(null)
      if (!moved && !additive) onSelect([])
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }
  const duration = projectDuration(project)
  const contentWidth = Math.max(duration + 30, 60) * zoom


  // Ctrl + roda do mouse: zoom mantendo o ponto sob o cursor.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left - HEADER
      const t = (el.scrollLeft + px) / zoom
      const next = Math.min(400, Math.max(2, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      onZoom(next)
      requestAnimationFrame(() => (el.scrollLeft = t * next - px))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, onZoom])

  const step = TICK_STEPS.find((s) => s * zoom >= 70) ?? 600
  const ticks = useMemo(() => {
    const out: number[] = []
    for (let t = 0; t * zoom <= contentWidth; t += step) out.push(t)
    return out
  }, [step, zoom, contentWidth])

  const snapPoints = (ignore: string) => {
    const pts = [0, time, ...(project.markers ?? []).map((m) => m.t)]
    for (const c of project.clips) {
      if (c.id === ignore) continue
      pts.push(c.start, c.start + c.duration)
      // Ímã nas batidas das músicas analisadas.
      const grid = c.mediaId ? project.media[c.mediaId]?.beats : null
      if (grid) for (const b of clipBeats(c, grid)) pts.push(b)
    }
    return pts
  }
  const snap = (v: number, pts: number[]) => {
    let best = v
    let dist = SNAP_PX / zoom
    for (const p of pts) {
      const d = Math.abs(p - v)
      if (d < dist) {
        dist = d
        best = p
      }
    }
    return best
  }

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, (e.clientX - rect.left) / zoom))
  }

  const onRulerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromEvent(e)
  }

  const onClipDown = (e: React.PointerEvent<HTMLDivElement>, clip: Clip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const media = clip.mediaId ? project.media[clip.mediaId] : undefined
    const rect = e.currentTarget.getBoundingClientRect()
    const local = e.clientX - rect.left
    const mode = local < EDGE ? 'left' : local > rect.width - EDGE ? 'right' : 'move'
    const sel = e.shiftKey ? (selection.includes(clip.id) ? selection.filter((s) => s !== clip.id) : [...selection, clip.id]) : selection.includes(clip.id) ? selection : [clip.id]
    onSelect(sel)

    const startX = e.clientX
    const pts = snapPoints(clip.id)
    const kind = project.tracks.find((t) => t.id === clip.trackId)?.kind
    let moved = false
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 3) return
        moved = true
        checkpoint()
      }
      if (mode === 'move') {
        let start = clip.start + dx
        const s1 = snap(start, pts)
        const s2 = snap(start + clip.duration, pts) - clip.duration
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2
        const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-track]')
        const trackId = lane && lane.dataset.kind === kind ? lane.dataset.track! : clip.trackId
        dispatch({ type: 'updateClip', id: clip.id, patch: { start, trackId } }, true)
      } else if (mode === 'left') {
        let start = snap(clip.start + dx, pts)
        let delta = start - clip.start
        const free = !media || media.kind === 'image'
        if (!free) delta = Math.max(delta, -clip.in / (clip.speed || 1))
        delta = Math.min(delta, clip.duration - 0.1)
        delta = Math.max(delta, -clip.start)
        start = clip.start + delta
        const inPoint = free ? 0 : clip.in + delta * (clip.speed || 1)
        dispatch({ type: 'updateClip', id: clip.id, patch: { start, in: inPoint, duration: clip.duration - delta } }, true)
      } else {
        const end = snap(clip.start + clip.duration + dx, pts)
        const max = maxClipDuration(media, clip)
        dispatch({ type: 'updateClip', id: clip.id, patch: { duration: Math.min(max, Math.max(0.1, end - clip.start)) } }, true)
      }
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const onLaneDrop = (e: React.DragEvent<HTMLDivElement>, track: Track) => {
    const mediaId = e.dataTransfer.getData('application/x-media-id')
    if (!mediaId) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const start = snap(Math.max(0, (e.clientX - rect.left) / zoom), snapPoints(''))
    dispatch({ type: 'addClip', mediaId, trackId: track.id, start })
  }

  const videoCount = project.tracks.filter((t) => t.kind === 'video').length
  const audioCount = project.tracks.length - videoCount

  return (
    <div className="timeline" ref={scrollRef}>
      <div className="tl-inner" ref={innerRef} style={{ width: HEADER + contentWidth }}>
        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        <div className="tl-row tl-ruler-row">
          <div className="tl-head tl-corner">
            <LiveTimecode />
            <button
              className={`icon-btn magnet ${project.magnetic ? 'on' : ''}`}
              onClick={() => dispatch({ type: 'setMagnetic', on: !project.magnetic })}
              data-tip={project.magnetic ? 'Timeline magnética ligada: a trilha principal não deixa buracos' : 'Ligar timeline magnética'}
              data-tip-pos="right"
              aria-label="Timeline magnética"
            >
              <Magnet size={13} />
            </button>
            <div className="zoom-control" data-tip="Zoom · Ctrl + roda" data-tip-pos="right">
              <button className="icon-btn" onClick={() => onZoom(Math.max(2, zoom / 1.4))} aria-label="Diminuir zoom">
                <ZoomOut size={13} />
              </button>
              <button className="icon-btn" onClick={() => onZoom(Math.min(400, zoom * 1.4))} aria-label="Aumentar zoom">
                <ZoomIn size={13} />
              </button>
            </div>
          </div>
          <div className="tl-ruler" onPointerDown={onRulerDown} onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: t * zoom }}>
                <span>{formatTime(t, step < 1)}</span>
              </div>
            ))}
            {(project.markers ?? []).map((m) => (
              <button
                key={m.id}
                className="marker"
                style={{ left: m.t * zoom, ['--marker' as string]: m.color }}
                data-tip={`${m.label} · ${formatTime(m.t)}\nClique direito para remover`}
                data-tip-pos="right"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSeek(m.t)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  dispatch({ type: 'removeMarker', id: m.id })
                }}
              />
            ))}
          </div>
        </div>
        {(project.markers ?? []).map((m) => (
          <div key={m.id} className="marker-line" style={{ left: HEADER + m.t * zoom, ['--marker' as string]: m.color }} />
        ))}

        {project.tracks.map((track) => (
          <div key={track.id} className={`tl-row track-${track.kind}`}>
            <div className={`tl-head ${selectedTrack === track.id ? 'selected' : ''}`}>
              <div className="track-title">
                <span className={`track-badge ${track.kind}`}>{track.kind === 'video' ? <Film size={12} strokeWidth={2.2} /> : <AudioLines size={12} strokeWidth={2.2} />}</span>
                <button
                  className="track-name"
                  data-tip="Mixer, tom e efeitos"
                  data-tip-pos="right"
                  onClick={() => {
                    onSelect([])
                    onSelectTrack(track.id)
                  }}
                >
                  <span className="ellipsis">{track.name}</span>
                  {hasFx(track) && <span className="fx-dot">FX</span>}
                  {project.magnetic && track.id === mainId && (
                    <span className="main-dot" data-tip="Trilha principal (magnética)" data-tip-pos="right">
                      <Magnet size={9} />
                    </span>
                  )}
                </button>
                {(track.kind === 'video' ? videoCount : audioCount) > 1 && (
                  <button className="icon-btn track-remove" data-tip="Remover trilha" data-tip-pos="right" onClick={() => dispatch({ type: 'removeTrack', id: track.id })}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="track-controls">
                {track.kind === 'video' && (
                  <button
                    className={`track-toggle ${track.hidden ? 'off' : ''}`}
                    data-tip={track.hidden ? 'Mostrar trilha' : 'Ocultar trilha'}
                    data-tip-pos="right"
                    onClick={() => dispatch({ type: 'updateTrack', id: track.id, patch: { hidden: !track.hidden } })}
                  >
                    {track.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
                <button
                  className={`track-toggle ${track.muted ? 'off' : ''}`}
                  data-tip={track.muted ? 'Ativar som' : 'Silenciar'}
                  data-tip-pos="right"
                  onClick={() => dispatch({ type: 'updateTrack', id: track.id, patch: { muted: !track.muted } })}
                >
                  {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <input
                  type="range"
                  className="range mini"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={track.volume}
                  style={{ ['--from' as string]: '0%', ['--to' as string]: `${(track.volume / 1.5) * 100}%` }}
                  title={`Volume da trilha: ${Math.round(track.volume * 100)}%`}
                  onPointerDown={checkpoint}
                  onChange={(e) => dispatch({ type: 'updateTrack', id: track.id, patch: { volume: Number(e.target.value) } }, true)}
                />
              </div>
            </div>
            <div
              className="tl-lane"
              data-track={track.id}
              data-kind={track.kind}
              onPointerDown={(e) => {
                if (e.button === 0) startMarquee(e)
              }}
              onContextMenu={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                onContextMenu(e, null, track.id, Math.max(0, (e.clientX - r.left) / zoom))
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onLaneDrop(e, track)}
            >
              {project.clips
                .filter((c) => c.trackId === track.id)
                .map((clip) => (
                  <ClipView key={clip.id} clip={clip} project={project} zoom={zoom} selected={selection.includes(clip.id)} onPointerDown={onClipDown} onContextMenu={(e, c) => onContextMenu(e, c, track.id, time)} />
                ))}
            </div>
          </div>
        ))}

        <div className="tl-row tl-add-row">
          <div className="tl-head">
            <button className="btn small ghost" onClick={() => dispatch({ type: 'addTrack', kind: 'video' })}>
              <Plus size={13} /> Vídeo
            </button>
            <button className="btn small ghost" onClick={() => dispatch({ type: 'addTrack', kind: 'audio' })}>
              <Plus size={13} /> Áudio
            </button>
          </div>
        </div>

        <Playhead zoom={zoom} playing={playing} scrollRef={scrollRef} />
      </div>
    </div>
  )
}

/** Batidas do clipe em tempo de timeline. */
function clipBeats(clip: Clip, grid: { bpm: number; offset: number }) {
  const speed = clip.speed || 1
  return beatTimes(grid, clip.in, clip.in + clip.duration * speed).map((b) => clip.start + (b - clip.in) / speed)
}

function LiveTimecode() {
  return <span className="timecode">{formatTime(useClockTime())}</span>
}

/** Cursor da timeline: segue o relógio a cada quadro e rola a timeline durante a reprodução. */
function Playhead({ zoom, playing, scrollRef }: { zoom: number; playing: boolean; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const t = useClockTime()
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = t * zoom
    const visible = el.clientWidth - HEADER
    if (x < el.scrollLeft || x > el.scrollLeft + visible - 40) el.scrollLeft = Math.max(0, x - 40)
  }, [t, zoom, playing, scrollRef])
  return <div className="playhead" style={{ transform: `translateX(${HEADER + t * zoom}px)` }} />
}

function hasFx(t: Track) {
  const fx = t.fx
  return fx.autotune.enabled || fx.transpose !== 0 || fx.comp.enabled || fx.reverb.mix > 0 || fx.eq.low !== 0 || fx.eq.mid !== 0 || fx.eq.high !== 0 || fx.pan !== 0
}

function ClipView({
  clip,
  project,
  zoom,
  selected,
  onPointerDown,
  onContextMenu,
}: {
  clip: Clip
  project: Project
  zoom: number
  selected: boolean
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, c: Clip) => void
  onContextMenu: (e: React.MouseEvent, c: Clip) => void
}) {
  const media = clip.mediaId ? project.media[clip.mediaId] : undefined
  const peaks = usePeaks(media)
  const width = clip.duration * zoom
  const isVisual = media?.kind === 'video' || media?.kind === 'image'
  const kind = clip.text ? 'text' : (media?.kind ?? 'missing')
  const fadeL = Math.max(clip.fadeIn, clip.transitionIn.type !== 'none' ? clip.transitionIn.duration : 0) * zoom
  const fadeR = Math.max(clip.fadeOut, clip.transitionOut.type !== 'none' ? clip.transitionOut.duration : 0) * zoom
  return (
    <div
      className={`clip clip-${kind} ${selected ? 'selected' : ''}`}
      data-clip={clip.id}
      style={{ left: clip.start * zoom, width }}
      onPointerDown={(e) => onPointerDown(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
      title={clip.text ? clip.text.content : media?.name}
    >
      {isVisual && media?.thumb && <div className="clip-thumbs" style={{ backgroundImage: `url("${media.thumb}")` }} />}
      {peaks && !clip.audioDetached && <Wave peaks={peaks} inPoint={clip.in} duration={clip.duration * (clip.speed || 1)} width={width} compact={isVisual} />}
      {fadeL > 2 && <div className="clip-fade left" style={{ width: fadeL }} />}
      {fadeR > 2 && <div className="clip-fade right" style={{ width: fadeR }} />}
      {clip.volumeKeys.length > 0 && (
        <svg className="clip-env" viewBox={`0 0 ${Math.max(1, width)} 100`} preserveAspectRatio="none">
          <polyline
            points={[
              `0,${100 - (clip.volumeKeys[0].v / 2) * 100}`,
              ...clip.volumeKeys.map((k) => `${k.t * zoom},${100 - (k.v / 2) * 100}`),
              `${width},${100 - (clip.volumeKeys[clip.volumeKeys.length - 1].v / 2) * 100}`,
            ].join(' ')}
          />
        </svg>
      )}
      <span className="clip-label">
        {clip.text ? `T  ${clip.text.content}` : (media?.name ?? 'Mídia ausente')}
        {media?.proxy && <span className="proxy-tag">proxy</span>}
        {clip.speed !== 1 && <span className="proxy-tag">{Number(clip.speed.toFixed(2))}×</span>}
        {clip.audioDetached ? <span className="proxy-tag">áudio separado</span> : clip.volume !== 1 && ` · ${Math.round(clip.volume * 100)}%`}
      </span>
      {media?.beats &&
        clipBeats(clip, media.beats).map((t) => <span key={t} className="clip-beat" style={{ left: (t - clip.start) * zoom }} />)}
      {keyTimes(clip).map((t) => (
        <span key={t} className="clip-key" style={{ left: t * zoom }} />
      ))}
      <div className="clip-edge left" />
      <div className="clip-edge right" />
    </div>
  )
}

function Wave({ peaks, inPoint, duration, width, compact }: { peaks: Float32Array; inPoint: number; duration: number; width: number; compact: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = Math.max(1, Math.min(4000, Math.round(width)))
  const h = compact ? 18 : 48
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = compact ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.75)'
    const from = inPoint * PEAKS_PER_SECOND
    const span = duration * PEAKS_PER_SECOND
    for (let x = 0; x < w; x++) {
      const a = Math.floor(from + (x / w) * span)
      const b = Math.max(a + 1, Math.floor(from + ((x + 1) / w) * span))
      let max = 0
      for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i]
      const bar = Math.max(1, max * h)
      ctx.fillRect(x, (h - bar) / 2, 1, bar)
    }
  }, [peaks, inPoint, duration, w, h, compact])
  return <canvas ref={ref} className={`clip-wave ${compact ? 'compact' : ''}`} width={w} height={h} />
}
