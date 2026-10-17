import type { Clip, Track } from './types'
import coreUrl from './dsp/autotune-core.js?url'
import workletUrl from './dsp/autotune.worklet.js?url'
import './dsp/reverb-ir.js'

declare global {
  // Definido por dsp/reverb-ir.js.
  var makeReverbIR: (sampleRate: number, decay: number) => Float32Array[]
}

/** Ganho do clipe no instante `local` (s desde o início do clipe): volume × envelope × fades. */
export function clipGainAt(clip: Clip, local: number) {
  let env = 1
  const keys = clip.volumeKeys
  if (keys.length) {
    if (local <= keys[0].t) env = keys[0].v
    else if (local >= keys[keys.length - 1].t) env = keys[keys.length - 1].v
    else {
      for (let i = 1; i < keys.length; i++) {
        if (local <= keys[i].t) {
          const a = keys[i - 1]
          const b = keys[i]
          env = a.v + ((b.v - a.v) * (local - a.t)) / Math.max(1e-6, b.t - a.t)
          break
        }
      }
    }
  }
  let fade = 1
  if (clip.fadeIn > 0 && local < clip.fadeIn) fade *= Math.max(0, local / clip.fadeIn)
  const rest = clip.duration - local
  if (clip.fadeOut > 0 && rest < clip.fadeOut) fade *= Math.max(0, rest / clip.fadeOut)
  return clip.volume * env * fade
}

export interface PitchReading {
  f0: number
  target: number
  ratio: number
}

interface TrackChain {
  input: GainNode
  tune: AudioWorkletNode | null
  low: BiquadFilterNode
  mid: BiquadFilterNode
  high: BiquadFilterNode
  comp: DynamicsCompressorNode
  pan: StereoPannerNode
  send: GainNode
  convolver: ConvolverNode
  decay: number
  /** Ganho do ducking (controlado pelo seguidor de envelope da trilha de voz). */
  duck: GainNode
  duckLevel: number
  out: GainNode
  analyser: AnalyserNode
  meterBuf: Float32Array
}

const dB = (v: number) => Math.pow(10, v / 20)

/** Grafo do Web Audio: elementos de mídia → clipe → cadeia de efeitos da trilha → master. */
export class AudioGraph {
  ctx: AudioContext | null = null
  private master!: GainNode
  private masterAnalyser!: AnalyserNode
  private masterBuf!: Float32Array
  private tracks = new Map<string, TrackChain>()
  private sources = new Map<HTMLMediaElement, { gain: GainNode; trackId: string }>()
  private workletReady = false
  private pendingTracks: Track[] = []
  pitchListener: ((trackId: string, r: PitchReading) => void) | null = null

  init() {
    if (this.ctx) return
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
    this.ctx = ctx
    this.master = ctx.createGain()
    this.masterAnalyser = ctx.createAnalyser()
    this.masterAnalyser.fftSize = 2048
    this.masterBuf = new Float32Array(this.masterAnalyser.fftSize)
    this.master.connect(this.masterAnalyser)
    this.masterAnalyser.connect(ctx.destination)
    void (async () => {
      try {
        await ctx.audioWorklet.addModule(coreUrl)
        await ctx.audioWorklet.addModule(workletUrl)
        this.workletReady = true
        // Recria as cadeias para inserir o nó de afinação.
        for (const [id, chain] of this.tracks) this.insertTune(id, chain)
        this.updateTracks(this.pendingTracks)
      } catch (err) {
        console.error('Falha ao carregar o AudioWorklet de afinação', err)
      }
    })()
  }

  resume() {
    this.init()
    if (this.ctx!.state !== 'running') void this.ctx!.resume()
  }

  private impulse(decay: number) {
    const ctx = this.ctx!
    const [l, r] = globalThis.makeReverbIR(ctx.sampleRate, decay)
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate)
    buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
    return buf
  }

  private createChain(track: Track): TrackChain {
    const ctx = this.ctx!
    const input = ctx.createGain()
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 100 })
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.7 })
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000 })
    const comp = new DynamicsCompressorNode(ctx, { attack: 0.01, release: 0.1, knee: 6 })
    const pan = new StereoPannerNode(ctx)
    const send = ctx.createGain()
    const convolver = new ConvolverNode(ctx, { disableNormalization: true })
    const out = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    input.connect(low)
    low.connect(mid).connect(high).connect(comp).connect(pan)
    const duck = ctx.createGain()
    pan.connect(duck)
    pan.connect(send).connect(convolver).connect(duck)
    duck.connect(out)
    out.connect(analyser)
    analyser.connect(this.master)
    const chain: TrackChain = { input, tune: null, low, mid, high, comp, pan, send, convolver, decay: -1, duck, duckLevel: 1, out, analyser, meterBuf: new Float32Array(analyser.fftSize) }
    if (this.workletReady) this.insertTune(track.id, chain)
    return chain
  }

  private insertTune(trackId: string, chain: TrackChain) {
    if (chain.tune || !this.ctx) return
    const tune = new AudioWorkletNode(this.ctx, 'autotune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    tune.port.onmessage = (e) => this.pitchListener?.(trackId, e.data as PitchReading)
    chain.input.disconnect()
    chain.input.connect(tune).connect(chain.low)
    chain.tune = tune
  }

  /** Aplica volume, mudo e efeitos de todas as trilhas. */
  updateTracks(tracks: Track[]) {
    this.pendingTracks = tracks
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const alive = new Set(tracks.map((t) => t.id))
    for (const [id, chain] of this.tracks) {
      if (!alive.has(id)) {
        chain.out.disconnect()
        this.tracks.delete(id)
      }
    }
    for (const t of tracks) {
      let chain = this.tracks.get(t.id)
      if (!chain) {
        chain = this.createChain(t)
        this.tracks.set(t.id, chain)
      }
      const fx = t.fx
      chain.low.gain.setTargetAtTime(fx.eq.low, now, 0.02)
      chain.mid.gain.setTargetAtTime(fx.eq.mid, now, 0.02)
      chain.high.gain.setTargetAtTime(fx.eq.high, now, 0.02)
      chain.comp.threshold.setTargetAtTime(fx.comp.enabled ? fx.comp.threshold : 0, now, 0.02)
      chain.comp.ratio.setTargetAtTime(fx.comp.enabled ? fx.comp.ratio : 1, now, 0.02)
      chain.pan.pan.setTargetAtTime(fx.pan, now, 0.02)
      chain.send.gain.setTargetAtTime(fx.reverb.mix, now, 0.02)
      if (fx.reverb.mix > 0 && chain.decay !== fx.reverb.decay) {
        chain.convolver.buffer = this.impulse(fx.reverb.decay)
        chain.decay = fx.reverb.decay
      }
      chain.out.gain.setTargetAtTime(t.muted ? 0 : t.volume, now, 0.02)
      chain.tune?.port.postMessage({ ...fx.autotune, transpose: fx.transpose })
    }
    this.ducks = tracks.filter((t) => t.fx.duck?.enabled && t.fx.duck.source && t.fx.duck.source !== t.id).map((t) => ({ target: t.id, source: t.fx.duck.source!, depth: t.fx.duck.depth }))
    for (const [id, chain] of this.tracks) {
      if (!this.ducks.some((d) => d.target === id) && chain.duckLevel !== 1) {
        chain.duckLevel = 1
        chain.duck.gain.setTargetAtTime(1, now, 0.05)
      }
    }
    if (this.ducks.length && !this.duckTimer) this.duckTimer = window.setInterval(() => this.followDucks(), 10)
    if (!this.ducks.length && this.duckTimer) {
      clearInterval(this.duckTimer)
      this.duckTimer = 0
    }
  }

  private ducks: { target: string; source: string; depth: number }[] = []
  private duckTimer = 0
  private duckBuf = new Float32Array(480)
  private lastDuck = 0

  /**
   * Seguidor de envelope do ducking: RMS da trilha de voz; acima de −40 dBFS abaixa a trilha alvo
   * `depth` dB, com ataque de 50 ms e liberação de 400 ms (igual a writeDuckCurve na exportação).
   */
  private followDucks() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const dt = this.lastDuck ? Math.min(0.1, now - this.lastDuck) : 0.01
    this.lastDuck = now
    for (const d of this.ducks) {
      const src = this.tracks.get(d.source)
      const dst = this.tracks.get(d.target)
      if (!src || !dst) continue
      src.analyser.getFloatTimeDomainData(this.duckBuf as Float32Array<ArrayBuffer>)
      let sum = 0
      for (let i = 0; i < this.duckBuf.length; i++) sum += this.duckBuf[i] * this.duckBuf[i]
      const rms = Math.sqrt(sum / this.duckBuf.length)
      const target = rms > 0.01 ? Math.pow(10, -Math.abs(d.depth) / 20) : 1
      const tc = target < dst.duckLevel ? 0.05 : 0.4
      dst.duckLevel += (target - dst.duckLevel) * (1 - Math.exp(-dt / tc))
      dst.duck.gain.setTargetAtTime(dst.duckLevel, now, 0.01)
    }
  }

  /** Liga um elemento de mídia à trilha (uma única vez por elemento). */
  connect(el: HTMLMediaElement, trackId: string) {
    if (!this.ctx) return
    let entry = this.sources.get(el)
    if (!entry) {
      const src = this.ctx.createMediaElementSource(el)
      const gain = this.ctx.createGain()
      src.connect(gain)
      entry = { gain, trackId: '' }
      this.sources.set(el, entry)
    }
    if (entry.trackId !== trackId) {
      const chain = this.tracks.get(trackId)
      if (!chain) return
      entry.gain.disconnect()
      entry.gain.connect(chain.input)
      entry.trackId = trackId
    }
  }

  setGain(el: HTMLMediaElement, value: number) {
    const entry = this.sources.get(el)
    if (entry && this.ctx) entry.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015)
  }

  release(el: HTMLMediaElement) {
    const entry = this.sources.get(el)
    if (entry) {
      entry.gain.disconnect()
      this.sources.delete(el)
    }
  }

  /** Pico (0..1+) de cada trilha e do master desde a última leitura. */
  levels(): { master: number; tracks: Record<string, number> } {
    const peak = (an: AnalyserNode, buf: Float32Array) => {
      an.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>)
      let m = 0
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i])
        if (v > m) m = v
      }
      return m
    }
    const tracks: Record<string, number> = {}
    if (!this.ctx) return { master: 0, tracks }
    for (const [id, c] of this.tracks) tracks[id] = peak(c.analyser, c.meterBuf)
    return { master: peak(this.masterAnalyser, this.masterBuf), tracks }
  }
}

export { dB }
