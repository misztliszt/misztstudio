// Detecção do tom de uma música (ex.: "Fá menor · 4A").
// Compartilhado entre o processo principal (Electron/Node) e os testes.
//
// Método: espectro em janelas de ~0,37 s → cromagrama (energia de cada uma das 12 notas,
// somando todas as oitavas) → correlação com os perfis de tonalidade de Krumhansl-Kessler
// nas 24 tonalidades maiores e menores. A melhor correlação é o tom.

;(function (root) {
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

  /** FFT complexa in-place (radix 2). */
  function fft(re, im) {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len
      const wr = Math.cos(ang)
      const wi = Math.sin(ang)
      for (let i = 0; i < n; i += len) {
        let cr = 1
        let ci = 0
        for (let k = 0; k < len / 2; k++) {
          const a = i + k
          const b = a + len / 2
          const xr = re[b] * cr - im[b] * ci
          const xi = re[b] * ci + im[b] * cr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
          const t = cr * wr - ci * wi
          ci = cr * wi + ci * wr
          cr = t
        }
      }
    }
  }

  /** Energia de cada nota (0 = Dó … 11 = Si) somada na música toda. */
  function chromagram(samples, sampleRate) {
    const N = 8192
    const hop = 4096
    const win = new Float32Array(N)
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
    // Bins entre Lá1 (55 Hz) e ~5 kHz, cada um com sua nota e um peso pela distância ao centro da nota.
    const bins = []
    for (let b = 1; b < N / 2; b++) {
      const f = (b * sampleRate) / N
      if (f < 55 || f > 5000) continue
      const midi = 69 + 12 * Math.log2(f / 440)
      const near = Math.round(midi)
      const off = midi - near
      bins.push({ b, pc: ((near % 12) + 12) % 12, w: Math.exp(-(off * off) / (2 * 0.2 * 0.2)) })
    }
    const total = new Float64Array(12)
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    const frame = new Float64Array(12)
    for (let start = 0; start + N <= samples.length; start += hop) {
      let energy = 0
      for (let i = 0; i < N; i++) {
        const v = samples[start + i]
        energy += v * v
        re[i] = v * win[i]
        im[i] = 0
      }
      if (energy / N < 1e-6) continue // silêncio
      fft(re, im)
      frame.fill(0)
      for (const { b, pc, w } of bins) frame[pc] += Math.sqrt(Math.hypot(re[b], im[b])) * w
      let sum = 0
      for (let k = 0; k < 12; k++) sum += frame[k]
      if (sum <= 0) continue
      // Cada janela pesa pela raiz da energia: trechos altos contam mais, sem dominar tudo.
      const weight = Math.sqrt(energy / N)
      for (let k = 0; k < 12; k++) total[k] += (frame[k] / sum) * weight
    }
    return total
  }

  function correlation(a, b) {
    const n = a.length
    let ma = 0
    let mb = 0
    for (let i = 0; i < n; i++) {
      ma += a[i]
      mb += b[i]
    }
    ma /= n
    mb /= n
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb)
      da += (a[i] - ma) ** 2
      db += (b[i] - mb) ** 2
    }
    return da && db ? num / Math.sqrt(da * db) : 0
  }

  /** Número da roda Camelot (1–12) e letra (A = menor, B = maior). */
  function camelot(key, mode) {
    const major = mode === 'minor' ? (key + 3) % 12 : key
    return `${((major * 7 + 7) % 12) + 1}${mode === 'minor' ? 'A' : 'B'}`
  }

  /**
   * @param {Float32Array} samples áudio mono
   * @param {number} sampleRate
   * @returns {{ key: number, mode: 'major'|'minor', camelot: string, confidence: number, alternative: object | null, chroma: number[] } | null}
   */
  function detectKey(samples, sampleRate) {
    const chroma = chromagram(samples, sampleRate)
    if (chroma.every((v) => v === 0)) return null
    const scores = []
    for (let k = 0; k < 12; k++) {
      const rot = (profile) => profile.map((_, i) => profile[(i - k + 12) % 12])
      scores.push({ key: k, mode: 'major', r: correlation(chroma, rot(MAJOR)) })
      scores.push({ key: k, mode: 'minor', r: correlation(chroma, rot(MINOR)) })
    }
    scores.sort((a, b) => b.r - a.r)
    const best = scores[0]
    const second = scores[1]
    // Confiança: correlação do vencedor e distância para o segundo colocado (0–1).
    const confidence = Math.max(0, Math.min(1, best.r * 0.6 + (best.r - second.r) * 4))
    const sum = chroma.reduce((s, v) => s + v, 0)
    // Maior e relativa menor têm as mesmas notas: se a relativa ficou perto, ela vira a alternativa.
    const relKey = best.mode === 'minor' ? (best.key + 3) % 12 : (best.key + 9) % 12
    const relMode = best.mode === 'minor' ? 'major' : 'minor'
    const rel = scores.find((s) => s.key === relKey && s.mode === relMode)
    const alternative = rel && best.r - rel.r < 0.15 ? { key: rel.key, mode: rel.mode, camelot: camelot(rel.key, rel.mode) } : null
    return { key: best.key, mode: best.mode, camelot: camelot(best.key, best.mode), confidence, alternative, chroma: Array.from(chroma, (v) => v / sum), ranking: scores.slice(0, 4).map((s) => ({ camelot: camelot(s.key, s.mode), r: s.r })) }
  }

  /** Tons compatíveis para mixar (mesmo número, ±1 e a relativa). */
  function compatibleCamelot(code) {
    const n = Number(code.slice(0, -1))
    const l = code.slice(-1)
    const wrap = (x) => ((x - 1 + 12) % 12) + 1
    return [code, `${wrap(n + 1)}${l}`, `${wrap(n - 1)}${l}`, `${n}${l === 'A' ? 'B' : 'A'}`]
  }

  const api = { detectKey, camelot, compatibleCamelot, chromagram }
  if (typeof module === 'object' && module && module.exports) module.exports = api
  else root.KeyDetect = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
