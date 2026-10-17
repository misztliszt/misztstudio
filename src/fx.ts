import type { Clip, TransitionType } from './types'

/*
 * Transições e efeitos com as MESMAS fórmulas usadas na exportação (electron/export.cjs):
 * - movimento (zoom, deslizar, girar) usa curva suave: e(p) = p²(3 − 2p);
 * - opacidade e flash/preto mudam de forma linear (como o filtro fade do FFmpeg).
 */

export const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'dissolve', label: 'Dissolver' },
  { value: 'black', label: 'Do / para preto' },
  { value: 'flash', label: 'Flash branco' },
  { value: 'zoomIn', label: 'Zoom (aproximar)' },
  { value: 'zoomOut', label: 'Zoom (afastar)' },
  { value: 'slideLeft', label: 'Deslizar ←' },
  { value: 'slideRight', label: 'Deslizar →' },
  { value: 'slideUp', label: 'Deslizar ↑' },
  { value: 'slideDown', label: 'Deslizar ↓' },
  { value: 'spin', label: 'Girar' },
]

const ease = (p: number) => p * p * (3 - 2 * p)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export interface TransitionState {
  alpha: number
  dark: number
  white: number
  dx: number
  dy: number
  scale: number
  rotation: number
}

/** Estado das transições de entrada/saída no instante `local` (s desde o início do clipe). */
export function transitionState(clip: Clip, local: number, W: number, H: number): TransitionState {
  const s: TransitionState = { alpha: 1, dark: 0, white: 0, dx: 0, dy: 0, scale: 1, rotation: 0 }
  const apply = (type: TransitionType, k: number, out: boolean) => {
    const e = 1 - ease(k) // 1 no começo da entrada (ou no fim da saída), 0 quando a transição termina
    const dir = out ? -1 : 1
    switch (type) {
      case 'dissolve':
        s.alpha *= k
        break
      case 'black':
        s.dark = Math.max(s.dark, 1 - k)
        break
      case 'flash':
        s.white = Math.max(s.white, 1 - k)
        break
      case 'zoomIn':
        s.scale *= 1 + 0.3 * e
        s.alpha *= k
        break
      case 'zoomOut':
        s.scale *= 1 - 0.25 * e
        s.alpha *= k
        break
      case 'slideLeft':
        s.dx += dir * e * W
        break
      case 'slideRight':
        s.dx -= dir * e * W
        break
      case 'slideUp':
        s.dy += dir * e * H
        break
      case 'slideDown':
        s.dy -= dir * e * H
        break
      case 'spin':
        s.rotation += dir * -120 * e
        s.scale *= 1 - 0.4 * e
        s.alpha *= k
        break
    }
  }
  const ti = clip.transitionIn
  if (ti.type !== 'none' && ti.duration > 0 && local < ti.duration) apply(ti.type, clamp01(local / ti.duration), false)
  const to = clip.transitionOut
  const rest = clip.duration - local
  if (to.type !== 'none' && to.duration > 0 && rest < to.duration) apply(to.type, clamp01(rest / to.duration), true)
  return s
}

/** Tremor de câmera determinístico (px), a partir do tempo local. */
export function shakeOffset(amount: number, t: number, W: number, H: number) {
  if (amount <= 0) return { dx: 0, dy: 0 }
  return {
    dx: amount * W * 0.012 * (Math.sin(t * 29.1) + 0.6 * Math.sin(t * 47.7 + 1.3)),
    dy: amount * H * 0.012 * (Math.sin(t * 33.7 + 0.7) + 0.6 * Math.sin(t * 53.1 + 2.1)),
  }
}

let grainTile: HTMLCanvasElement | null = null
/** Textura de granulado (gerada uma vez). */
export function grainPattern() {
  if (!grainTile) {
    grainTile = document.createElement('canvas')
    grainTile.width = grainTile.height = 256
    const ctx = grainTile.getContext('2d')!
    const img = ctx.createImageData(256, 256)
    let seed = 1234
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647
      const v = seed % 256
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }
  return grainTile
}
