import type { ScaleName } from './types'

export const KEY_NAMES = ['Dó (C)', 'Dó♯ / Ré♭ (C♯/D♭)', 'Ré (D)', 'Ré♯ / Mi♭ (D♯/E♭)', 'Mi (E)', 'Fá (F)', 'Fá♯ / Sol♭ (F♯/G♭)', 'Sol (G)', 'Sol♯ / Lá♭ (G♯/A♭)', 'Lá (A)', 'Lá♯ / Si♭ (A♯/B♭)', 'Si (B)']
export const SHORT_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

export const SCALE_NAMES: Record<ScaleName, string> = {
  chromatic: 'Cromática (todas as notas)',
  major: 'Maior',
  minor: 'Menor natural',
  pentatonicMajor: 'Pentatônica maior',
  pentatonicMinor: 'Pentatônica menor',
  blues: 'Blues',
}

export type Mode = 'major' | 'minor'

/**
 * Semitons para levar uma música de um tom a outro pelo caminho mais curto (−6..+6).
 * Com modos diferentes compara as relativas maiores (Lá menor ≡ Dó maior).
 */
export function semitonesBetween(fromKey: number, fromMode: Mode, toKey: number, toMode: Mode) {
  const rel = (k: number, m: Mode) => (m === 'minor' ? (k + 3) % 12 : k)
  let d = (rel(toKey, toMode) - rel(fromKey, fromMode) + 12) % 12
  if (d > 6) d -= 12
  return d
}

export function midiToName(midi: number) {
  const n = Math.round(midi)
  return `${SHORT_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)
