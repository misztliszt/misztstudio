/* global registerProcessor, sampleRate, AudioWorkletProcessor */
// Noise gate (portão de ruído): fecha o som quando a voz fica abaixo do limiar,
// para não passar teclado, respiração ou ruído de fundo entre as frases.
// O mesmo código roda no AudioWorklet do microfone ao vivo e nos testes (Node).

class GateCore {
  constructor(rate) {
    this.rate = rate
    this.env = 0
    this.gain = 0
    this.hold = 0
    this.params = { enabled: false, threshold: -45, range: -60, attack: 0.003, hold: 0.12, release: 0.18 }
  }

  setParams(p) {
    Object.assign(this.params, p)
  }

  /** Processa um bloco mono ou estéreo no lugar. Devolve o ganho atual (0–1). */
  process(channels, n) {
    const p = this.params
    if (!p.enabled) {
      this.gain = 1
      return 1
    }
    const thr = Math.pow(10, p.threshold / 20)
    // Histerese: fecha 4 dB abaixo do limiar de abertura (evita "tremer" na borda).
    const thrClose = thr * 0.63
    const floor = Math.pow(10, p.range / 20)
    const envCoef = Math.exp(-1 / (0.005 * this.rate))
    const att = 1 - Math.exp(-1 / (Math.max(0.0005, p.attack) * this.rate))
    // Fechamento em escala de dB: cai 60 dB no tempo de release (soa natural e fecha de verdade).
    const rel = Math.pow(10, -60 / (20 * Math.max(0.01, p.release) * this.rate))
    const holdSamples = p.hold * this.rate
    for (let i = 0; i < n; i++) {
      let peak = 0
      for (const ch of channels) {
        const v = Math.abs(ch[i])
        if (v > peak) peak = v
      }
      this.env = Math.max(peak, this.env * envCoef)
      let target
      if (this.env >= thr) {
        target = 1
        this.hold = holdSamples
      } else if (this.hold > 0 || this.env >= thrClose) {
        target = this.gain > 0.5 ? 1 : floor
        this.hold--
      } else target = floor
      if (target > this.gain) this.gain += (target - this.gain) * att
      else this.gain = Math.max(target, this.gain * rel)
      for (const ch of channels) ch[i] *= this.gain
    }
    return this.gain
  }
}

if (typeof registerProcessor === 'function') {
  class GateProcessor extends AudioWorkletProcessor {
    constructor() {
      super()
      this.core = new GateCore(sampleRate)
      this.port.onmessage = (e) => this.core.setParams(e.data)
      this.frames = 0
    }

    process(inputs, outputs) {
      const input = inputs[0]
      const output = outputs[0]
      if (!input || !input.length) {
        for (const ch of output) ch.fill(0)
        return true
      }
      for (let c = 0; c < output.length; c++) output[c].set(input[Math.min(c, input.length - 1)])
      const gain = this.core.process(output, output[0].length)
      // Informa a interface (luz do gate) umas 20 vezes por segundo.
      this.frames += output[0].length
      if (this.frames > sampleRate / 20) {
        this.frames = 0
        this.port.postMessage({ open: gain > 0.5 })
      }
      return true
    }
  }
  registerProcessor('noise-gate', GateProcessor)
}

if (typeof module === 'object' && module && module.exports) module.exports = { GateCore }
