// Motor do modo DJ: dois decks (elementos de mídia → stems → EQ → filtro → fader → crossfader),
// master com medidor e gravação do set (áudio + registro do que cada deck tocou, para virar clipes).

import type { Clip, Media, MusicalKey } from './types'

export interface HotCue {
  time: number
  name: string
  color: string | null
}

export interface DeckTrack {
  media: Media
  bpm: number | null
  /** Primeira batida (s, na mídia). */
  offset: number
  key: MusicalKey | null
}

export const STEM_LABELS: Record<string, string> = { vocals: 'Voz', drums: 'Bateria', bass: 'Baixo', other: 'Outros', guitar: 'Guitarra', piano: 'Piano', no_vocals: 'Instrumental' }
export const CUE_COLORS = ['#e8433f', '#f28a2e', '#f2d23a', '#3fd07a', '#2fc6e8', '#4a7cf2', '#a35cf2', '#f25ca8']
export const LOOP_SIZES = [0.5, 1, 2, 4, 8, 16]

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Um trecho contínuo tocado por um deck durante a gravação do set. */
interface Segment {
  mediaId: string
  /** Início no set (s). */
  at: number
  /** Ponto da mídia no início. */
  in: number
  speed: number
  duration: number
}

export class Deck {
  readonly id: 'A' | 'B'
  readonly ctx: AudioContext
  track: DeckTrack | null = null
  stems: { name: string; gain: GainNode }[] = []
  private els: HTMLAudioElement[] = []
  private sources: MediaElementAudioSourceNode[] = []
  readonly input: GainNode
  readonly low: BiquadFilterNode
  readonly mid: BiquadFilterNode
  readonly high: BiquadFilterNode
  private readonly lp: BiquadFilterNode
  private readonly hp: BiquadFilterNode
  readonly fader: GainNode
  readonly xf: GainNode
  readonly analyser: AnalyserNode
  private buf = new Float32Array(512)
  rate = 1
  private bend = 1
  keylock = true
  cuePoint = 0
  loop: { start: number; end: number; beats: number } | null = null
  hotcues: (HotCue | null)[] = Array(8).fill(null)
  volume = 0.8
  filter = 0
  eq = { low: 0, mid: 0, high: 0 }
  /** Gravação: trecho atual e os anteriores. */
  segments: Segment[] = []
  private open: Segment | null = null
  gainLog: { t: number; v: number }[] = []
  private recordStart: number | null = null
  onChange: (() => void) | null = null

  constructor(id: 'A' | 'B', ctx: AudioContext, out: AudioNode) {
    this.id = id
    this.ctx = ctx
    this.input = ctx.createGain()
    this.low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 120 })
    this.mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.7 })
    this.high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000 })
    this.lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 22000, Q: 0.9 })
    this.hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: 0.9 })
    this.fader = ctx.createGain()
    this.xf = ctx.createGain()
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.input.connect(this.low).connect(this.mid).connect(this.high).connect(this.lp).connect(this.hp).connect(this.fader).connect(this.xf)
    this.fader.connect(this.analyser)
    this.xf.connect(out)
    this.setVolume(this.volume)
  }

  get loaded() {
    return !!this.track && this.els.length > 0
  }
  get playing() {
    return this.els.length > 0 && !this.els[0].paused
  }
  get time() {
    return this.els[0]?.currentTime ?? 0
  }
  get duration() {
    const d = this.els[0]?.duration
    return Number.isFinite(d) ? d : (this.track?.media.duration ?? 0)
  }
  /** BPM tocando agora (com o ajuste de andamento). */
  get bpm() {
    return this.track?.bpm ? this.track.bpm * this.rate * this.bend : null
  }
  /** Duração de uma batida no tempo da mídia (s). */
  get beatLen() {
    return this.track?.bpm ? 60 / this.track.bpm : 0
  }
  /** Semitons de diferença quando a trava de tom está desligada. */
  get pitchShift() {
    return this.keylock ? 0 : 12 * Math.log2(this.rate)
  }

  /** Carrega uma faixa: um arquivo ou vários stems tocando juntos. */
  async load(track: DeckTrack, parts: { url: string; name: string }[], cues: HotCue[] = []) {
    this.closeSegment()
    this.unload()
    this.track = track
    this.cuePoint = 0
    this.loop = null
    this.hotcues = Array.from({ length: 8 }, (_, i) => cues[i] ?? null)
    this.stems = []
    for (const p of parts) {
      const el = new Audio()
      el.src = p.url
      el.preload = 'auto'
      el.preservesPitch = this.keylock
      el.playbackRate = this.rate * this.bend
      const src = this.ctx.createMediaElementSource(el)
      const gain = this.ctx.createGain()
      src.connect(gain).connect(this.input)
      this.els.push(el)
      this.sources.push(src)
      if (parts.length > 1) this.stems.push({ name: p.name, gain })
    }
    this.els[0].addEventListener('ended', () => {
      this.closeSegment()
      this.onChange?.()
    })
    await new Promise<void>((resolve) => {
      const el = this.els[0]
      if (el.readyState >= 1) return resolve()
      el.addEventListener('loadedmetadata', () => resolve(), { once: true })
      el.addEventListener('error', () => resolve(), { once: true })
    })
    this.onChange?.()
  }

  unload() {
    for (const el of this.els) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    for (const s of this.sources) s.disconnect()
    this.els = []
    this.sources = []
    this.stems = []
  }

  play() {
    if (!this.loaded) return
    void this.ctx.resume()
    const t = this.time
    for (const el of this.els) {
      if (Math.abs(el.currentTime - t) > 0.01) el.currentTime = t
      void el.play()
    }
    this.openSegment()
    this.onChange?.()
  }

  pause() {
    for (const el of this.els) el.pause()
    this.closeSegment()
    this.onChange?.()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(t: number) {
    if (!this.loaded) return
    const target = clamp(t, 0, Math.max(0, this.duration - 0.05))
    const wasOpen = !!this.open
    this.closeSegment()
    for (const el of this.els) el.currentTime = target
    if (wasOpen && this.playing) this.openSegment(target)
    this.onChange?.()
  }

  /** CUE no estilo CDJ: parado marca o ponto; tocando volta ao ponto e para. */
  cue() {
    if (!this.loaded) return
    if (this.playing) {
      this.pause()
      this.seek(this.cuePoint)
    } else {
      this.cuePoint = this.snap(this.time)
      this.seek(this.cuePoint)
    }
  }

  /** Aproxima um instante da batida mais próxima (se houver grade). */
  snap(t: number) {
    const bl = this.beatLen
    if (!bl || !this.track) return t
    const off = this.track.offset
    return off + Math.round((t - off) / bl) * bl
  }

  hotcue(i: number) {
    if (!this.loaded) return
    const c = this.hotcues[i]
    if (c) {
      this.seek(c.time)
      if (!this.playing) this.play()
    } else {
      this.hotcues[i] = { time: this.playing ? this.time : this.snap(this.time), name: '', color: CUE_COLORS[i] }
      this.onChange?.()
    }
  }

  clearHotcue(i: number) {
    this.hotcues[i] = null
    this.onChange?.()
  }

  /** Loop automático de N batidas a partir da batida atual (ou sai do loop). */
  setLoop(beats: number | null) {
    if (beats === null || !this.beatLen) {
      this.loop = null
    } else {
      const start = this.loop ? this.loop.start : this.snap(this.time - this.beatLen * 0.25)
      this.loop = { start, end: start + beats * this.beatLen, beats }
    }
    this.onChange?.()
  }

  setRate(rate: number) {
    const r = clamp(rate, 0.5, 1.5)
    if (Math.abs(r - this.rate) < 1e-4) return
    // Mudança de andamento vira outro trecho na gravação (só se for perceptível).
    if (this.open && Math.abs(r - this.open.speed) > 0.003) {
      this.closeSegment()
      this.rate = r
      this.applyRate()
      this.openSegment()
    } else {
      this.rate = r
      this.applyRate()
    }
    this.onChange?.()
  }

  /** Empurrão de andamento enquanto o botão está pressionado (acertar a fase de ouvido). */
  setBend(on: -1 | 0 | 1) {
    this.bend = on === 0 ? 1 : 1 + on * 0.04
    this.applyRate()
  }

  setKeylock(on: boolean) {
    this.keylock = on
    for (const el of this.els) el.preservesPitch = on
    this.onChange?.()
  }

  private applyRate() {
    for (const el of this.els) el.playbackRate = this.rate * this.bend
  }

  setVolume(v: number) {
    this.volume = v
    // Curva de fader de mixer: mais resolução no topo.
    this.fader.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.01)
  }

  setEq(band: 'low' | 'mid' | 'high', db: number) {
    this.eq = { ...this.eq, [band]: db }
    // No mínimo do knob a banda é cortada (kill).
    this[band].gain.setTargetAtTime(db <= -24 ? -40 : db, this.ctx.currentTime, 0.01)
  }

  /** Filtro de um knob: esquerda = passa-baixa, direita = passa-alta, centro = desligado. */
  setFilter(v: number) {
    this.filter = v
    const now = this.ctx.currentTime
    const lp = v < -0.02 ? 20000 * Math.pow(150 / 20000, -v) : 22000
    const hp = v > 0.02 ? 20 * Math.pow(6000 / 20, v) : 10
    this.lp.frequency.setTargetAtTime(lp, now, 0.02)
    this.hp.frequency.setTargetAtTime(hp, now, 0.02)
  }

  setStem(i: number, v: number) {
    const s = this.stems[i]
    if (s) s.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  /** Iguala o BPM ao do outro deck e alinha as batidas. */
  sync(master: Deck) {
    if (!this.track?.bpm || !master.bpm) return false
    let rate = master.bpm / this.track.bpm
    // Meio/dobro do andamento quando fica mais perto (ex.: 70 contra 140 BPM).
    if (rate > 1.4) rate /= 2
    else if (rate < 0.7) rate *= 2
    this.setRate(rate)
    if (master.playing && master.track && master.beatLen) {
      const phaseMaster = (((master.time - master.track.offset) / master.beatLen) % 1 + 1) % 1
      const phaseMe = (((this.time - this.track.offset) / this.beatLen) % 1 + 1) % 1
      let d = phaseMaster - phaseMe
      if (d > 0.5) d -= 1
      if (d < -0.5) d += 1
      this.seek(this.time + d * this.beatLen)
    }
    return true
  }

  /** Chamado a cada quadro: loop, sincronia dos stems e registro de volume. */
  tick() {
    if (!this.loaded) return
    const t = this.time
    if (this.loop && this.playing && t >= this.loop.end) this.seek(this.loop.start + (t - this.loop.end))
    // Stems: corrige a deriva entre os elementos.
    if (this.els.length > 1 && this.playing) for (let i = 1; i < this.els.length; i++) if (Math.abs(this.els[i].currentTime - t) > 0.04) this.els[i].currentTime = t
    if (this.recordStart !== null) {
      const now = this.ctx.currentTime - this.recordStart
      const last = this.gainLog[this.gainLog.length - 1]
      const v = this.volume * this.volume * this.xf.gain.value
      if (!last || (now - last.t > 0.1 && Math.abs(last.v - v) > 0.01)) this.gainLog.push({ t: now, v })
    }
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.buf)
    let p = 0
    for (const v of this.buf) p = Math.max(p, Math.abs(v))
    return p
  }

  // ---------- Gravação ----------

  startRecording(at: number) {
    this.recordStart = at
    this.segments = []
    this.gainLog = [{ t: 0, v: this.volume * this.volume * this.xf.gain.value }]
    this.open = null
    if (this.playing) this.openSegment()
  }

  stopRecording() {
    this.closeSegment()
    this.recordStart = null
    return { segments: this.segments, gainLog: this.gainLog }
  }

  private openSegment(at = this.time) {
    if (this.recordStart === null || !this.track || this.open) return
    this.open = { mediaId: this.track.media.id, at: this.ctx.currentTime - this.recordStart, in: at, speed: this.rate, duration: 0 }
  }

  private closeSegment() {
    if (!this.open || this.recordStart === null) {
      this.open = null
      return
    }
    const seg = this.open
    seg.duration = this.ctx.currentTime - this.recordStart - seg.at
    if (seg.duration > 0.05) this.segments.push(seg)
    this.open = null
  }

  dispose() {
    this.unload()
    this.xf.disconnect()
  }
}

export class DjMixer {
  readonly ctx: AudioContext
  readonly decks: [Deck, Deck]
  readonly master: GainNode
  private readonly analyser: AnalyserNode
  private readonly dest: MediaStreamAudioDestinationNode
  private buf = new Float32Array(1024)
  crossfader = 0
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  recordingSince: number | null = null
  private raf = 0

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
    this.master = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.dest = this.ctx.createMediaStreamDestination()
    this.master.connect(this.analyser)
    this.master.connect(this.ctx.destination)
    this.master.connect(this.dest)
    this.decks = [new Deck('A', this.ctx, this.master), new Deck('B', this.ctx, this.master)]
    this.setCrossfader(0)
    const loop = () => {
      for (const d of this.decks) d.tick()
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  /** Crossfader de potência constante (-1 = só A, 1 = só B). */
  setCrossfader(x: number) {
    this.crossfader = clamp(x, -1, 1)
    const p = ((this.crossfader + 1) / 2) * (Math.PI / 2)
    const now = this.ctx.currentTime
    // No centro os dois ficam em volume total; nas pontas, só um.
    this.decks[0].xf.gain.setTargetAtTime(Math.min(1, Math.cos(p) * Math.SQRT2), now, 0.01)
    this.decks[1].xf.gain.setTargetAtTime(Math.min(1, Math.sin(p) * Math.SQRT2), now, 0.01)
  }

  setMaster(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.buf)
    let p = 0
    for (const v of this.buf) p = Math.max(p, Math.abs(v))
    return p
  }

  get recording() {
    return this.recorder !== null
  }

  startRecording() {
    void this.ctx.resume()
    this.chunks = []
    const rec = new MediaRecorder(this.dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 320000 })
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    rec.start(1000)
    this.recorder = rec
    const at = this.ctx.currentTime
    this.recordingSince = performance.now()
    for (const d of this.decks) d.startRecording(at)
  }

  /** Para a gravação: devolve o áudio (WebM) e o que cada deck tocou. */
  async stopRecording() {
    const rec = this.recorder
    if (!rec) return null
    const decks = this.decks.map((d) => ({ id: d.id, ...d.stopRecording() }))
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      rec.stop()
    })
    this.recorder = null
    const duration = (performance.now() - (this.recordingSince ?? performance.now())) / 1000
    this.recordingSince = null
    return { audio: new Blob(this.chunks, { type: 'audio/webm' }), decks, duration }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    for (const d of this.decks) d.dispose()
    void this.ctx.close()
  }
}

/** Converte o que um deck tocou em clipes da timeline (com a automação de volume do fader/crossfader). */
export function segmentsToClips(segments: Segment[], gainLog: { t: number; v: number }[], start: number): Pick<Clip, 'mediaId' | 'start' | 'in' | 'duration' | 'speed' | 'volume' | 'volumeKeys'>[] {
  const gainAt = (t: number) => {
    let v = gainLog[0]?.v ?? 1
    for (const g of gainLog) {
      if (g.t > t) break
      v = g.v
    }
    return v
  }
  return segments.map((s) => {
    const keys = [{ t: 0, v: gainAt(s.at) }, ...gainLog.filter((g) => g.t > s.at && g.t < s.at + s.duration).map((g) => ({ t: g.t - s.at, v: g.v }))]
    const max = Math.max(...keys.map((k) => k.v), 0.001)
    // O volume do clipe é o pico; os pontos guardam a variação relativa (0–1).
    return {
      mediaId: s.mediaId,
      start: start + s.at,
      in: s.in,
      duration: s.duration,
      speed: Math.round(s.speed * 1000) / 1000,
      volume: Math.min(2, max),
      volumeKeys: keys.length > 1 ? keys.map((k) => ({ t: k.t, v: k.v / max })) : [],
    }
  })
}
