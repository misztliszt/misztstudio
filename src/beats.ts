import { PEAKS_PER_SECOND } from './waveform'

export interface BeatGrid {
  bpm: number
  /** Instante (s, na mídia) da primeira batida. */
  offset: number
}

/**
 * Estima o andamento e a fase das batidas a partir do envelope de picos (100 por segundo):
 * força de ataque (subida de energia) → autocorrelação entre 60 e 180 BPM, com leve
 * preferência por ~120 BPM → fase que melhor coincide com os ataques.
 */
export function detectBeats(peaks: Float32Array): BeatGrid | null {
  const n = peaks.length
  if (n < PEAKS_PER_SECOND * 4) return null

  // Força de ataque: diferença positiva do envelope em escala logarítmica, sem a média local.
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) env[i] = Math.log1p(peaks[i] * 100)
  const onset = new Float32Array(n)
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1])
  const win = 20
  const flux = new Float32Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += onset[i]
    if (i >= win) acc -= onset[i - win]
    flux[i] = Math.max(0, onset[i] - acc / Math.min(win, i + 1))
  }

  const minLag = Math.round((60 / 180) * PEAKS_PER_SECOND)
  const maxLag = Math.round((60 / 60) * PEAKS_PER_SECOND)
  let bestLag = 0
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag]
    s /= n - lag
    const bpm = (60 * PEAKS_PER_SECOND) / lag
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2))
    if (s * prior > bestScore) {
      bestScore = s * prior
      bestLag = lag
    }
  }
  if (!bestLag || bestScore <= 0) return null

  // Refina o período com interpolação parabólica da autocorrelação.
  const ac = (lag: number) => {
    let s = 0
    for (let i = lag; i < n; i++) s += flux[i] * flux[i - lag]
    return s / (n - lag)
  }
  const a = ac(bestLag - 1)
  const b = ac(bestLag)
  const c = ac(bestLag + 1)
  const denom = a - 2 * b + c
  const period = bestLag + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0)

  let bestPhase = 0
  let phaseScore = -Infinity
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0
    for (let t = ph; t < n; t += period) s += flux[Math.round(t)] ?? 0
    if (s > phaseScore) {
      phaseScore = s
      bestPhase = ph
    }
  }
  return { bpm: Math.round(((60 * PEAKS_PER_SECOND) / period) * 10) / 10, offset: bestPhase / PEAKS_PER_SECOND }
}

/** Instantes das batidas (s, na mídia) dentro de [from, to]. */
export function beatTimes(grid: BeatGrid, from: number, to: number) {
  const step = 60 / grid.bpm
  const out: number[] = []
  let k = Math.ceil((from - grid.offset) / step)
  for (let t = grid.offset + k * step; t <= to; k++, t = grid.offset + k * step) out.push(t)
  return out
}
