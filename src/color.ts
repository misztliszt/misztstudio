import type { ColorAdjust } from './types'

/*
 * Ajustes de cor com as mesmas fórmulas na prévia (filtro CSS do canvas) e na exportação
 * (lutrgb + colorchannelmixer do FFmpeg), seguindo a especificação de Filter Effects.
 */

export const COLOR_PRESETS: { name: string; color: Partial<ColorAdjust> }[] = [
  { name: 'Original', color: { brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0 } },
  { name: 'Vívido', color: { brightness: 0.03, contrast: 1.15, saturation: 1.45, hue: 0, sepia: 0 } },
  { name: 'Preto e branco', color: { brightness: 0, contrast: 1.2, saturation: 0, hue: 0, sepia: 0 } },
  { name: 'Sépia', color: { brightness: 0, contrast: 1.05, saturation: 1, hue: 0, sepia: 0.85 } },
  { name: 'Quente', color: { brightness: 0.02, contrast: 1.05, saturation: 1.15, hue: -8, sepia: 0.2 } },
  { name: 'Frio', color: { brightness: 0, contrast: 1.05, saturation: 0.95, hue: 12, sepia: 0 } },
  { name: 'Vintage', color: { brightness: 0.04, contrast: 0.85, saturation: 0.7, hue: -5, sepia: 0.35 } },
  { name: 'Cinema', color: { brightness: -0.05, contrast: 1.25, saturation: 0.85, hue: 0, sepia: 0.1 } },
]

export const isNeutral = (c: ColorAdjust) => c.brightness === 0 && c.contrast === 1 && c.saturation === 1 && c.hue === 0 && c.sepia === 0

export function cssFilter(c: ColorAdjust) {
  if (isNeutral(c)) return 'none'
  return `brightness(${1 + c.brightness}) contrast(${c.contrast}) saturate(${c.saturation}) hue-rotate(${c.hue}deg) sepia(${c.sepia})`
}

type M = number[] // 3x3 em ordem de linhas

const mul = (a: M, b: M): M => {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}

function saturateM(s: number): M {
  return [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]
}

function hueM(deg: number): M {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

function sepiaM(amount: number): M {
  const a = 1 - Math.min(1, amount)
  return [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a]
}

/** Matriz final (saturação → matiz → sépia) aplicada depois de brilho/contraste. */
export function colorMatrix(c: ColorAdjust): M {
  return mul(sepiaM(c.sepia), mul(hueM(c.hue), saturateM(c.saturation)))
}
