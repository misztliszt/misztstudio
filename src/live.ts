// Microfone ao vivo: voz → afinação → EQ → compressor → reverb → saída escolhida
// (ex.: "CABLE Input" do VB-CABLE, que jogos como o VRChat usam como microfone).

import coreUrl from './dsp/autotune-core.js?url'
import workletUrl from './dsp/autotune.worklet.js?url'
import './dsp/reverb-ir.js'
import type { ScaleName } from './types'

export interface LiveSettings {
  input: string
  output: string
  monitor: boolean
  monitorOutput: string
  noiseSuppression: boolean
  tune: { enabled: boolean; key: number; scale: ScaleName; speed: number; mix: number; transpose: number }
  eq: { low: number; mid: number; high: number }
  comp: boolean
  reverb: number
  gain: number
}

export const defaultLive = (): LiveSettings => ({
  input: 'default',
  output: 'default',
  monitor: false,
  monitorOutput: 'default',
  noiseSuppression: false,
  tune: { enabled: true, key: 0, scale: 'major', speed: 0.55, mix: 0.8, transpose: 0 },
  eq: { low: -2, mid: 0, high: 2 },
  comp: true,
  reverb: 0.12,
  gain: 1,
})

export interface LiveReading {
  f0: number
  target: number
}

export class LiveVoice {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private nodes: {
    src: MediaStreamAudioSourceNode
    hp: BiquadFilterNode
    tune: AudioWorkletNode
    low: BiquadFilterNode
    mid: BiquadFilterNode
    high: BiquadFilterNode
    comp: DynamicsCompressorNode
    send: GainNode
    convolver: ConvolverNode
    out: GainNode
    analyser: AnalyserNode
    inAnalyser: AnalyserNode
    monitorDest: MediaStreamAudioDestinationNode
  } | null = null
  private monitorEl: HTMLAudioElement | null = null
  private buf = new Float32Array(1024)
  private current: LiveSettings | null = null
  onReading: ((r: LiveReading) => void) | null = null
  private listeners = new Set<() => void>()

  /** Avisa quando liga ou desliga; devolve a função para cancelar. */
  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    for (const fn of this.listeners) fn()
  }

  get running() {
    return !!this.ctx
  }

  /** Atraso estimado (ms): buffers de entrada/saída + janela do pitch shifter. */
  get latencyMs() {
    if (!this.ctx) return 0
    return Math.round(((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000 + 128 / 48 + 25)
  }

  async start(s: LiveSettings) {
    await this.stop()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: s.input === 'default' ? undefined : { exact: s.input },
        echoCancellation: false,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: false,
        channelCount: 1,
      },
    })
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
    try {
      await ctx.audioWorklet.addModule(coreUrl)
      await ctx.audioWorklet.addModule(workletUrl)
      if (s.output !== 'default') await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(s.output)
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      throw err
    }
    const src = ctx.createMediaStreamSource(stream)
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 80, Q: 0.7 })
    const tune = new AudioWorkletNode(ctx, 'autotune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 150 })
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2500, Q: 0.8 })
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000 })
    const comp = new DynamicsCompressorNode(ctx, { attack: 0.005, release: 0.12, knee: 8 })
    const send = ctx.createGain()
    const convolver = new ConvolverNode(ctx, { disableNormalization: true })
    const [l, r] = globalThis.makeReverbIR(ctx.sampleRate, 1.6)
    const ir = ctx.createBuffer(2, l.length, ctx.sampleRate)
    ir.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
    ir.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
    convolver.buffer = ir
    const out = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    const inAnalyser = ctx.createAnalyser()
    inAnalyser.fftSize = 1024
    const monitorDest = ctx.createMediaStreamDestination()

    src.connect(inAnalyser)
    src.connect(hp).connect(tune).connect(low).connect(mid).connect(high).connect(comp)
    comp.connect(out)
    comp.connect(send).connect(convolver).connect(out)
    out.connect(analyser)
    out.connect(ctx.destination)
    out.connect(monitorDest)
    tune.port.onmessage = (e) => this.onReading?.(e.data as LiveReading)

    this.ctx = ctx
    this.stream = stream
    this.nodes = { src, hp, tune, low, mid, high, comp, send, convolver, out, analyser, inAnalyser, monitorDest }
    this.current = s
    this.apply(s)
    await this.setMonitor(s.monitor, s.monitorOutput)
    // Se o microfone for desconectado, desliga.
    stream.getAudioTracks()[0]?.addEventListener('ended', () => void this.stop())
    this.emit()
  }

  /** Ajustes que não exigem reiniciar (afinação, EQ, compressor, reverb, ganho). */
  apply(s: LiveSettings) {
    this.current = s
    const n = this.nodes
    const ctx = this.ctx
    if (!n || !ctx) return
    const now = ctx.currentTime
    n.tune.port.postMessage({ ...s.tune })
    n.low.gain.setTargetAtTime(s.eq.low, now, 0.02)
    n.mid.gain.setTargetAtTime(s.eq.mid, now, 0.02)
    n.high.gain.setTargetAtTime(s.eq.high, now, 0.02)
    n.comp.threshold.setTargetAtTime(s.comp ? -22 : 0, now, 0.02)
    n.comp.ratio.setTargetAtTime(s.comp ? 4 : 1, now, 0.02)
    n.send.gain.setTargetAtTime(s.reverb, now, 0.02)
    n.out.gain.setTargetAtTime(s.gain, now, 0.02)
  }

  /** Retorno nos fones: a voz processada também toca no dispositivo escolhido. */
  async setMonitor(on: boolean, device: string) {
    if (this.monitorEl) {
      this.monitorEl.pause()
      this.monitorEl.srcObject = null
      this.monitorEl = null
    }
    if (!on || !this.nodes) return
    const el = new Audio()
    el.srcObject = this.nodes.monitorDest.stream
    if (device !== 'default') await (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(device)
    await el.play()
    this.monitorEl = el
  }

  /** Picos de entrada (microfone cru) e saída (voz processada), 0–1. */
  levels() {
    const n = this.nodes
    if (!n) return { input: 0, output: 0 }
    const peak = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.buf)
      let p = 0
      for (const v of this.buf) p = Math.max(p, Math.abs(v))
      return p
    }
    return { input: peak(n.inAnalyser), output: peak(n.analyser) }
  }

  async stop() {
    if (this.monitorEl) {
      this.monitorEl.pause()
      this.monitorEl.srcObject = null
      this.monitorEl = null
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.nodes = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx) await ctx.close()
    this.emit()
  }

  get settings() {
    return this.current
  }
}
