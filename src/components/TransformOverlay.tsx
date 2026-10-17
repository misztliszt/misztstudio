import { useState } from 'react'
import { clipLayout, isVisualClip, setPropPatch, valueAt } from '../anim'
import type { Action } from '../store'
import type { Clip, Project, TextStyle } from '../types'

const SNAP_PX = 8

interface Props {
  project: Project
  clip: Clip
  time: number
  /** Retângulo do canvas dentro do palco (px de tela). */
  rect: { left: number; top: number; width: number; height: number }
  dispatch: (a: Action, merge?: boolean) => void
  checkpoint: () => void
}

let measureCtx: CanvasRenderingContext2D | null = null
/** Caixa do texto em px do quadro (mesmas medidas de drawText). */
export function textBox(style: TextStyle, H: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const px = Math.max(4, style.size * (H / 1080))
  measureCtx!.font = `${style.bold ? 700 : 400} ${px}px "${style.font}", sans-serif`
  const lines = style.content.split('\n')
  const w = Math.max(...lines.map((l) => measureCtx!.measureText(l).width)) + (style.background ? px * 0.8 : 0)
  const h = px * 1.2 * lines.length + (style.background ? px * 0.4 : 0)
  return { w, h }
}

/** Geometria (em px do quadro) do clipe selecionado, ou null se não estiver visível agora. */
export function selectionGeometry(project: Project, clip: Clip, time: number) {
  const local = time - clip.start
  if (local < 0 || local >= clip.duration) return null
  const W = project.width
  const H = project.height
  if (clip.text) {
    const b = textBox(clip.text, H)
    return { cx: clip.text.x * W, cy: clip.text.y * H, w: b.w, h: b.h, rotation: 0, isText: true }
  }
  const media = clip.mediaId ? project.media[clip.mediaId] : undefined
  if (!media || !isVisualClip(clip, media.kind) || !media.width) return null
  const g = clipLayout(clip, media.width, media.height, W, H, local)
  return { cx: g.cx, cy: g.cy, w: g.w, h: g.h, rotation: g.rotation, isText: false }
}

/** Caixa com alças sobre a prévia: arrastar move, cantos escalam, alça de cima gira. */
export function TransformOverlay({ project, clip, time, rect, dispatch, checkpoint }: Props) {
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const g = selectionGeometry(project, clip, time)
  if (!g) return null
  const W = project.width
  const H = project.height
  const k = rect.width / W
  const local = time - clip.start

  const begin = (e: React.PointerEvent, mode: 'move' | 'scale' | 'rotate') => {
    e.stopPropagation()
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const stage = target.closest('.preview-stage')!.getBoundingClientRect()
    const centerScreen = { x: stage.left + rect.left + g.cx * k, y: stage.top + rect.top + g.cy * k }
    const start = { x: e.clientX, y: e.clientY }
    const x0 = clip.text ? clip.text.x : valueAt(clip, 'x', local)
    const y0 = clip.text ? clip.text.y : valueAt(clip, 'y', local)
    const s0 = valueAt(clip, 'scale', local)
    const r0 = valueAt(clip, 'rotation', local)
    const d0 = Math.hypot(start.x - centerScreen.x, start.y - centerScreen.y) || 1
    const a0 = Math.atan2(start.y - centerScreen.y, start.x - centerScreen.x)
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 2) return
        moved = true
        checkpoint()
      }
      if (mode === 'move') {
        let nx = x0 + (ev.clientX - start.x) / k / W
        let ny = y0 + (ev.clientY - start.y) / k / H
        // Ímã no centro do quadro.
        const centerX = clip.text ? 0.5 : 0
        const centerY = clip.text ? 0.5 : 0
        const snapV = !ev.altKey && Math.abs(nx - centerX) * W * k < SNAP_PX
        const snapH = !ev.altKey && Math.abs(ny - centerY) * H * k < SNAP_PX
        if (snapV) nx = centerX
        if (snapH) ny = centerY
        setGuides({ v: snapV, h: snapH })
        if (clip.text) dispatch({ type: 'updateClip', id: clip.id, patch: { text: { ...clip.text, x: nx, y: ny } } }, true)
        else {
          const withX = { ...clip, ...setPropPatch(clip, 'x', nx, local) }
          dispatch({ type: 'updateClip', id: clip.id, patch: { ...setPropPatch(clip, 'x', nx, local), ...setPropPatch(withX, 'y', ny, local) } }, true)
        }
      } else if (mode === 'scale') {
        const d = Math.hypot(ev.clientX - centerScreen.x, ev.clientY - centerScreen.y)
        const s = Math.max(0.05, Math.min(10, s0 * (d / d0)))
        dispatch({ type: 'updateClip', id: clip.id, patch: setPropPatch(clip, 'scale', Math.round(s * 1000) / 1000, local) }, true)
      } else {
        const a = Math.atan2(ev.clientY - centerScreen.y, ev.clientX - centerScreen.x)
        let r = r0 + ((a - a0) * 180) / Math.PI
        if (ev.shiftKey) r = Math.round(r / 15) * 15
        r = Math.round(r * 10) / 10
        dispatch({ type: 'updateClip', id: clip.id, patch: setPropPatch(clip, 'rotation', r, local) }, true)
      }
    }
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      setGuides({ v: false, h: false })
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  const box = {
    left: rect.left + g.cx * k,
    top: rect.top + g.cy * k,
    width: Math.max(8, g.w * k),
    height: Math.max(8, g.h * k),
    transform: `translate(-50%, -50%) rotate(${g.rotation}deg)`,
  }

  return (
    <>
      {guides.v && <div className="snap-guide v" style={{ left: rect.left + (clip.text ? 0.5 : 0.5) * rect.width, top: rect.top, height: rect.height }} />}
      {guides.h && <div className="snap-guide h" style={{ top: rect.top + 0.5 * rect.height, left: rect.left, width: rect.width }} />}
      <div className={`transform-box ${g.isText ? 'text' : ''}`} style={box} onPointerDown={(e) => begin(e, 'move')}>
        {!g.isText && (
          <>
            {['nw', 'ne', 'sw', 'se'].map((c) => (
              <span key={c} className={`handle ${c}`} onPointerDown={(e) => begin(e, 'scale')} />
            ))}
            <span className="rotate-stem" />
            <span className="handle rotate" onPointerDown={(e) => begin(e, 'rotate')} title="Girar (Shift: de 15 em 15°)" />
          </>
        )}
      </div>
    </>
  )
}
