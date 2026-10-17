/*
 * Núcleo da afinação automática, compartilhado entre o AudioWorklet (prévia em tempo real)
 * e o processo principal do Electron (exportação). Não usa imports para poder rodar nos dois.
 *
 * - Detecção de pitch: YIN sobre o sinal subamostrado (÷4), janela ~43 ms, salto ~11 ms.
 * - Alvo: nota mais próxima da escala escolhida.
 * - Correção: deslocador de pitch por linha de atraso com duas leituras em crossfade (Hann).
 */
;(function (root) {
  const SCALES = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonicMajor: [0, 2, 4, 7, 9],
    pentatonicMinor: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
  }

  const DS = 4
  const WIN = 512
  const HOP = 128
  const MIN_F0 = 70
  const MAX_F0 = 1000
  const YIN_THRESHOLD = 0.15
  const MIN_RMS = 0.008
  const BUF = 8192
  const MASK = BUF - 1

  function nearestNote(midi, key, scale) {
    const pcs = SCALES[scale] || SCALES.chromatic
    let best = Math.round(midi)
    let dist = Infinity
    for (let n = Math.round(midi) - 6; n <= Math.round(midi) + 6; n++) {
      const pc = (((n - key) % 12) + 12) % 12
      if (pcs.indexOf(pc) === -1) continue
      const d = Math.abs(n - midi)
      if (d < dist) {
        dist = d
        best = n
      }
    }
    return best
  }

  class Shifter {
    constructor(win) {
      this.buf = new Float32Array(BUF)
      this.w = 0
      this.p = 0.5
      this.win = win
    }
    read(delay) {
      const pos = this.w - delay
      const i = Math.floor(pos)
      const f = pos - i
      const a = this.buf[i & MASK]
      const b = this.buf[(i + 1) & MASK]
      return a + (b - a) * f
    }
    /** Grava `x`, avança a fase e devolve [molhado, seco atrasado]. */
    step(x, ratio, out) {
      this.buf[this.w & MASK] = x
      const W = this.win
      const diff = 1 - ratio
      if (Math.abs(diff) < 0.002) {
        // Sem correção: volta devagar para uma única leitura (evita filtro pente).
        this.p += (0.5 - this.p) * 0.0005
      } else {
        this.p += diff / W
      }
      this.p -= Math.floor(this.p)
      const p1 = this.p
      const p2 = (p1 + 0.5) % 1
      const s1 = Math.sin(Math.PI * p1)
      const s2 = Math.sin(Math.PI * p2)
      out[0] = this.read(p1 * W + 2) * s1 * s1 + this.read(p2 * W + 2) * s2 * s2
      out[1] = this.read(W / 2 + 2)
      this.w++
    }
  }

  class AutoTuneCore {
    constructor(sampleRate) {
      this.sr = sampleRate
      this.dsRate = sampleRate / DS
      this.tauMin = Math.max(2, Math.floor(this.dsRate / MAX_F0))
      this.tauMax = Math.min(WIN / 2, Math.ceil(this.dsRate / MIN_F0))
      this.det = new Float32Array(WIN)
      this.detPos = 0
      this.detCount = 0
      this.lin = new Float32Array(WIN)
      this.diff = new Float32Array(this.tauMax + 1)
      this.acc = 0
      this.accN = 0
      this.sinceHop = 0
      this.ratio = 1
      this.target = 1
      this.f0 = 0
      this.targetHz = 0
      this.voiced = false
      const win = Math.round(0.05 * sampleRate)
      this.left = new Shifter(win)
      this.right = new Shifter(win)
      this.tmp = new Float32Array(2)
      this.params = { enabled: false, key: 0, scale: 'chromatic', speed: 0.7, mix: 1, transpose: 0 }
    }

    setParams(p) {
      Object.assign(this.params, p)
    }

    detect() {
      const W = WIN
      for (let i = 0; i < W; i++) this.lin[i] = this.det[(this.detPos + i) % W]
      let energy = 0
      for (let i = 0; i < W; i++) energy += this.lin[i] * this.lin[i]
      if (Math.sqrt(energy / W) < MIN_RMS) return 0
      const n = W - this.tauMax
      const d = this.diff
      d[0] = 1
      let running = 0
      let found = -1
      for (let tau = 1; tau <= this.tauMax; tau++) {
        let s = 0
        for (let j = 0; j < n; j++) {
          const v = this.lin[j] - this.lin[j + tau]
          s += v * v
        }
        running += s
        d[tau] = running > 0 ? (s * tau) / running : 1
      }
      for (let tau = this.tauMin; tau < this.tauMax; tau++) {
        if (d[tau] < YIN_THRESHOLD) {
          while (tau + 1 < this.tauMax && d[tau + 1] < d[tau]) tau++
          found = tau
          break
        }
      }
      if (found < 0) return 0
      const a = d[found - 1]
      const b = d[found]
      const c = d[found + 1]
      const denom = a - 2 * b + c
      const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
      return this.dsRate / (found + Math.max(-1, Math.min(1, shift)))
    }

    hop() {
      const { key, scale, speed } = this.params
      const f0 = this.detect()
      this.f0 = f0
      this.voiced = f0 > 0
      if (this.voiced) {
        const midi = 69 + 12 * Math.log2(f0 / 440)
        const note = nearestNote(midi, key, scale)
        this.targetHz = 440 * Math.pow(2, (note - 69) / 12)
        this.target = Math.min(2, Math.max(0.5, this.targetHz / f0))
      } else {
        this.targetHz = 0
        this.target = 1
      }
      // speed 1 → correção instantânea; speed 0 → constante de tempo de ~200 ms.
      const hopTime = (HOP * DS) / this.sr
      const tc = 0.2 * Math.pow(0.02, Math.min(1, Math.max(0, speed)))
      const alpha = speed >= 0.99 ? 1 : 1 - Math.exp(-hopTime / tc)
      const lr = Math.log(this.ratio)
      this.ratio = Math.exp(lr + (Math.log(this.target) - lr) * alpha)
    }

    /** Processa `n` amostras. `inR`/`outR` podem ser null para mono. */
    process(inL, inR, outL, outR, n) {
      const { enabled } = this.params
      const transpose = this.params.transpose || 0
      if (!enabled && transpose === 0) {
        if (outL !== inL) outL.set(inL.subarray(0, n))
        if (outR && inR && outR !== inR) outR.set(inR.subarray(0, n))
        return
      }
      // A transposição sempre sai 100% processada; a mistura vale só para a afinação.
      const mix = enabled ? this.params.mix : 1
      const shift = Math.pow(2, transpose / 12)
      const tmp = this.tmp
      for (let i = 0; i < n; i++) {
        const l = inL[i]
        const r = inR ? inR[i] : l
        if (enabled) this.acc += (l + r) * 0.5
        if (enabled && ++this.accN === DS) {
          this.det[this.detPos] = this.acc / DS
          this.detPos = (this.detPos + 1) % WIN
          this.acc = 0
          this.accN = 0
          if (this.detCount < WIN) this.detCount++
          if (++this.sinceHop >= HOP && this.detCount === WIN) {
            this.sinceHop = 0
            this.hop()
          }
        }
        const ratio = (enabled ? this.ratio : 1) * shift
        this.left.step(l, ratio, tmp)
        outL[i] = tmp[1] + (tmp[0] - tmp[1]) * mix
        if (outR) {
          this.right.step(r, ratio, tmp)
          outR[i] = tmp[1] + (tmp[0] - tmp[1]) * mix
        }
      }
    }
  }

  const api = { AutoTuneCore, SCALES, nearestNote }
  if (typeof module === 'object' && module && module.exports) module.exports = api
  else root.AutoTune = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
