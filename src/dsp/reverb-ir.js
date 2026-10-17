/*
 * Resposta ao impulso sintética do reverb, gerada de forma determinística para que a
 * prévia (ConvolverNode) e a exportação (afir do FFmpeg) soem iguais.
 */
;(function (root) {
  function makeReverbIR(sampleRate, decay) {
    const length = Math.max(1, Math.round(sampleRate * Math.max(0.2, decay)))
    const channels = [new Float32Array(length), new Float32Array(length)]
    for (let ch = 0; ch < 2; ch++) {
      let seed = 12345 + ch * 977
      const data = channels[ch]
      let energy = 0
      for (let i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        const noise = seed / 4294967296 - 0.5
        // Queda de 60 dB ao longo de `decay` segundos, com um pré-atraso curto.
        const t = i / sampleRate
        const env = t < 0.012 ? 0 : Math.exp((-6.9 * t) / decay)
        data[i] = noise * env
        energy += data[i] * data[i]
      }
      const norm = energy > 0 ? 1 / Math.sqrt(energy) : 1
      for (let i = 0; i < length; i++) data[i] *= norm
    }
    return channels
  }

  if (typeof module === 'object' && module && module.exports) module.exports = { makeReverbIR }
  else root.makeReverbIR = makeReverbIR
})(typeof globalThis !== 'undefined' ? globalThis : this)
