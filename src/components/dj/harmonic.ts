import type { MusicalKey } from '../../types'

/** Código Camelot (mesma fórmula de src/dsp/key-core.js). */
export function camelotOf(key: number, mode: 'major' | 'minor') {
  const major = mode === 'minor' ? (key + 3) % 12 : key
  return `${((major * 7 + 7) % 12) + 1}${mode === 'minor' ? 'A' : 'B'}`
}

/** Tom depois de mudar o andamento sem trava de tom (arredondado ao semitom). */
export function shiftCamelot(k: Pick<MusicalKey, 'key' | 'mode'>, semitones: number) {
  const key = (((k.key + Math.round(semitones)) % 12) + 12) % 12
  return { key, mode: k.mode, camelot: camelotOf(key, k.mode) }
}

/** Mixagem harmônica: mesmo número, vizinhos (±1) e a relativa (A↔B). */
export function compatible(a: string, b: string) {
  const na = Number(a.slice(0, -1))
  const nb = Number(b.slice(0, -1))
  const la = a.slice(-1)
  const lb = b.slice(-1)
  if (na === nb) return true
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
  return la === lb && d === 1
}
