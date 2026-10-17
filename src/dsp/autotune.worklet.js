/* global AutoTune, registerProcessor, sampleRate, currentTime */
// Carregado depois de autotune-core.js, que define `AutoTune` no escopo global do worklet.

class AutoTuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.core = new AutoTune.AutoTuneCore(sampleRate)
    this.lastReport = 0
    this.port.onmessage = (e) => this.core.setParams(e.data)
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0)
      return true
    }
    const inL = input[0]
    const inR = input[1] || null
    const outL = output[0]
    const outR = output[1] || null
    this.core.process(inL, inR, outL, outR, inL.length)
    if (outR && !inR) outR.set(outL)

    if (this.core.params.enabled && currentTime - this.lastReport > 0.03) {
      this.lastReport = currentTime
      this.port.postMessage({ f0: this.core.f0, target: this.core.targetHz, ratio: this.core.ratio })
    }
    return true
  }
}

registerProcessor('autotune', AutoTuneProcessor)
