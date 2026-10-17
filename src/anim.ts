import type { AnimProp, Clip, Ease, Keyframe, Transform } from './types'

export const ANIM_PROPS: AnimProp[] = ['x', 'y', 'scale', 'rotation', 'opacity']

export const defaultTransform = (): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } })

/** Curvas: as mesmas fórmulas são usadas na exportação (electron/export.cjs). */
export function easeProgress(p: number, ease: Ease) {
  if (ease === 'hold') return 0
  if (ease === 'ease') return p * p * (3 - 2 * p)
  return p
}

export function interpolate(keys: Keyframe[], t: number) {
  if (t <= keys[0].t) return keys[0].v
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.v
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1]
      const b = keys[i]
      const p = (t - a.t) / Math.max(1e-6, b.t - a.t)
      return a.v + (b.v - a.v) * easeProgress(p, a.ease)
    }
  }
  return last.v
}

/** Valor animado da propriedade no instante `local` (s desde o início do clipe). */
export function valueAt(clip: Clip, prop: AnimProp, local: number) {
  const keys = clip.keyframes[prop]
  return keys && keys.length ? interpolate(keys, local) : clip.transform[prop]
}

export function transformAt(clip: Clip, local: number) {
  return {
    x: valueAt(clip, 'x', local),
    y: valueAt(clip, 'y', local),
    scale: valueAt(clip, 'scale', local),
    rotation: valueAt(clip, 'rotation', local),
    opacity: valueAt(clip, 'opacity', local),
  }
}

const KEY_EPS = 1 / 120

/** Keyframe da propriedade que está no instante `local`, se houver. */
export function keyAt(clip: Clip, prop: AnimProp, local: number) {
  return clip.keyframes[prop]?.find((k) => Math.abs(k.t - local) < KEY_EPS)
}

/** Insere ou atualiza um keyframe (mantendo a ordem). */
export function upsertKey(keys: Keyframe[] | undefined, t: number, v: number, ease: Ease = 'ease'): Keyframe[] {
  const list = (keys ?? []).filter((k) => Math.abs(k.t - t) >= KEY_EPS)
  const prev = keys?.find((k) => Math.abs(k.t - t) < KEY_EPS)
  return [...list, { t, v, ease: prev?.ease ?? ease }].sort((a, b) => a.t - b.t)
}

export function removeKey(keys: Keyframe[] | undefined, t: number) {
  return (keys ?? []).filter((k) => Math.abs(k.t - t) >= KEY_EPS)
}

/**
 * Patch para mudar uma propriedade: com keyframes, grava um keyframe no cursor
 * (auto-key); sem keyframes, muda o valor fixo.
 */
export function setPropPatch(clip: Clip, prop: AnimProp, value: number, local: number): Partial<Clip> {
  const keys = clip.keyframes[prop]
  if (keys && keys.length) {
    const t = Math.max(0, Math.min(clip.duration, local))
    return { keyframes: { ...clip.keyframes, [prop]: upsertKey(keys, t, value) } }
  }
  return { transform: { ...clip.transform, [prop]: value } }
}

/** Todos os instantes com keyframe (para marcar no clipe da timeline). */
export function keyTimes(clip: Clip) {
  const set = new Set<number>()
  for (const p of ANIM_PROPS) for (const k of clip.keyframes[p] ?? []) set.add(Math.round(k.t * 1000) / 1000)
  return [...set].sort((a, b) => a - b)
}

/**
 * Geometria do clipe no quadro: centro, tamanho já com escala, rotação e opacidade.
 * `sw`/`sh` são as dimensões da mídia original.
 */
export function clipLayout(clip: Clip, sw: number, sh: number, W: number, H: number, local: number) {
  const c = clip.transform.crop
  const cw = Math.max(1, sw * (1 - c.left - c.right))
  const ch = Math.max(1, sh * (1 - c.top - c.bottom))
  const fit = Math.min(W / cw, H / ch)
  const t = transformAt(clip, local)
  return { cx: W / 2 + t.x * W, cy: H / 2 + t.y * H, w: cw * fit * t.scale, h: ch * fit * t.scale, rotation: t.rotation, opacity: t.opacity, crop: c }
}

export const isVisualClip = (clip: Clip, kind: string | undefined) => !clip.text && (kind === 'video' || kind === 'image')
