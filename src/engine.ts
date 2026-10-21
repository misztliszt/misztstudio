import { AudioGraph, clipGainAt } from './audio'
import { clipLayout } from './anim'
import { grainPattern, shakeOffset, transitionState } from './fx'
import { cssFilter } from './color'
import { LutRenderer, parseCube, type Lut } from './lut'
import { drawText } from './text'
import type { Clip, Project } from './types'

type MediaEl = HTMLVideoElement | HTMLAudioElement

/** Tolerância antes de reposicionar um elemento que está tocando (s). */
const PLAY_DRIFT = 0.25
/** Clipes que começam em breve são pré-carregados na posição certa (s). */
const PRELOAD = 1.5

/**
 * Mantém um <video>/<audio> por clipe sincronizado com o cursor da timeline,
 * passa o áudio pelo mixer (AudioGraph) e compõe as trilhas de vídeo num canvas.
 */
export class PlaybackEngine {
  readonly audio = new AudioGraph()
  private canvas: HTMLCanvasElement | null = null
  private project: Project | null = null
  private elements = new Map<string, { el: MediaEl; src: string }>()
  private images = new Map<string, HTMLImageElement>()
  private luts = new Map<string, Lut | 'loading' | 'error'>()
  private lutRenderer: LutRenderer | null = null
  private time = 0
  private playing = false
  /** Fração da resolução do projeto usada na prévia (1, 0,5 ou 0,25). */
  private quality = 1

  setQuality(q: number) {
    if (q === this.quality) return
    this.quality = q
    this.draw()
  }

  constructor() {
    this.audio.init()
  }

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas
    this.draw()
  }

  setProject(project: Project) {
    this.project = project
    const alive = new Set(project.clips.map((c) => c.id))
    for (const [id, entry] of this.elements) {
      if (!alive.has(id)) this.dropElement(id, entry.el)
    }
    this.audio.updateTracks(project.tracks)
    this.sync()
  }

  update(time: number, playing: boolean) {
    if (playing && !this.playing) this.audio.resume()
    this.time = time
    this.playing = playing
    this.sync()
  }

  dispose() {
    for (const [id, entry] of this.elements) this.dropElement(id, entry.el)
  }

  private dropElement(id: string, el: MediaEl) {
    el.pause()
    this.audio.release(el)
    el.removeAttribute('src')
    el.load()
    this.elements.delete(id)
  }

  private element(clip: Clip): MediaEl | null {
    const media = clip.mediaId ? this.project!.media[clip.mediaId] : undefined
    if (!media || media.kind === 'image') return null
    // A prévia usa o proxy quando existe; a exportação sempre usa o original.
    const src = media.kind === 'video' && media.proxy ? media.proxy : media.url
    let entry = this.elements.get(clip.id)
    if (entry && entry.src !== src) {
      this.dropElement(clip.id, entry.el)
      entry = undefined
    }
    if (!entry) {
      const el = document.createElement(media.kind === 'video' ? 'video' : 'audio')
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      if (el instanceof HTMLVideoElement) el.playsInline = true
      el.src = src
      el.addEventListener('seeked', () => this.draw())
      el.addEventListener('loadeddata', () => this.draw())
      entry = { el, src }
      this.elements.set(clip.id, entry)
    }
    return entry.el
  }

  private image(mediaId: string): HTMLImageElement | null {
    const media = this.project?.media[mediaId]
    if (!media) return null
    let img = this.images.get(mediaId)
    if (!img) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = media.url
      img.onload = () => this.draw()
      this.images.set(mediaId, img)
    }
    return img
  }

  private lut(path: string): Lut | null {
    const cached = this.luts.get(path)
    if (cached === undefined) {
      this.luts.set(path, 'loading')
      window.api
        .readText(path)
        .then((text) => {
          this.luts.set(path, parseCube(text))
          this.draw()
        })
        .catch((err) => {
          console.error('LUT', err)
          this.luts.set(path, 'error')
        })
      return null
    }
    return typeof cached === 'object' ? cached : null
  }

  private sync() {
    const p = this.project
    if (!p) return
    const t = this.time
    const tracks = new Map(p.tracks.map((tr) => [tr.id, tr]))

    for (const clip of p.clips) {
      const track = tracks.get(clip.trackId)
      if (!track || !clip.mediaId) continue
      const end = clip.start + clip.duration
      const active = t >= clip.start && t < end
      const upcoming = !active && clip.start > t && clip.start - t < PRELOAD
      if (!active && !upcoming && !this.elements.has(clip.id)) continue
      const el = this.element(clip)
      if (!el) continue

      this.audio.connect(el, track.id)
      const gain = clipGainAt(clip, Math.max(0, t - clip.start))
      this.audio.setGain(el, gain)
      // Sem o grafo de áudio (ainda), o volume vai direto no elemento.
      if (!this.audio.ctx) el.volume = Math.min(1, gain * (track.muted ? 0 : track.volume))

      const speed = clip.speed || 1
      if (el.playbackRate !== speed) el.playbackRate = speed
      if (active) {
        const target = clip.in + (t - clip.start) * speed
        if (this.playing) {
          if (el.paused) {
            el.currentTime = target
            void el.play().catch(() => {})
          } else if (Math.abs(el.currentTime - target) > PLAY_DRIFT) {
            el.currentTime = target
          }
        } else {
          if (!el.paused) el.pause()
          if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target
        }
      } else {
        if (!el.paused) el.pause()
        if (upcoming && Math.abs(el.currentTime - clip.in) > 0.05) el.currentTime = clip.in
      }
    }
    this.draw()
  }

  draw() {
    const canvas = this.canvas
    const p = this.project
    if (!canvas || !p) return
    // Qualidade da prévia: o canvas pode ter menos pixels; as contas continuam no tamanho do projeto.
    const q = this.quality
    const cw = Math.max(2, Math.round(p.width * q))
    const ch = Math.max(2, Math.round(p.height * q))
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(q, 0, 0, q, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, p.width, p.height)
    const t = this.time

    // Trilhas de baixo para cima: a primeira trilha da lista fica por cima.
    const videoTracks = p.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse()
    for (const track of videoTracks) {
      const clip = p.clips.find((c) => c.trackId === track.id && t >= c.start && t < c.start + c.duration)
      if (!clip) continue
      const local = t - clip.start

      if (clip.text) {
        drawText(ctx, clip.text, p.width, p.height, local, clip.duration)
        continue
      }

      const media = clip.mediaId ? p.media[clip.mediaId] : undefined
      if (!media) continue
      let source: CanvasImageSource | null = null
      let sw = 0
      let sh = 0
      if (media.kind === 'image') {
        const img = this.image(media.id)
        if (img && img.complete && img.naturalWidth) {
          source = img
          sw = img.naturalWidth
          sh = img.naturalHeight
        }
      } else if (media.kind === 'video') {
        const el = this.elements.get(clip.id)?.el as HTMLVideoElement | undefined
        if (el && el.readyState >= 2 && el.videoWidth) {
          source = el
          sw = el.videoWidth
          sh = el.videoHeight
        }
      }
      if (!source) continue

      if (clip.color.lut) {
        const lut = this.lut(clip.color.lut)
        if (lut) {
          this.lutRenderer ??= new LutRenderer()
          const out = this.lutRenderer.apply(source as TexImageSource, sw, sh, lut)
          if (out) source = out
        }
      }

      // A saída da LUT pode ter outra resolução; o corte é em fração, então usamos as dimensões reais da fonte.
      const srcW = source instanceof HTMLCanvasElement ? source.width : sw
      const srcH = source instanceof HTMLCanvasElement ? source.height : sh
      const W = p.width
      const H = p.height
      const g = clipLayout(clip, sw, sh, W, H, local)
      if (g.opacity <= 0 || g.w < 1 || g.h < 1) continue
      const tr = transitionState(clip, local, W, H)
      const fx = clip.effects
      const shake = shakeOffset(fx?.shake ?? 0, local, W, H)
      const w = g.w * tr.scale
      const h = g.h * tr.scale
      ctx.save()
      ctx.translate(g.cx + tr.dx + shake.dx, g.cy + tr.dy + shake.dy)
      ctx.rotate(((g.rotation + tr.rotation) * Math.PI) / 180)
      if (fx?.mirror) ctx.scale(-1, 1)
      ctx.globalAlpha = tr.alpha * g.opacity
      const blur = fx?.blur ? ` blur(${(fx.blur * H * q) / 1080}px)` : ''
      const css = cssFilter(clip.color)
      ctx.filter = css === 'none' && !blur ? 'none' : `${css === 'none' ? '' : css}${blur}`.trim()
      ctx.drawImage(
        source,
        g.crop.left * srcW,
        g.crop.top * srcH,
        srcW * (1 - g.crop.left - g.crop.right),
        srcH * (1 - g.crop.top - g.crop.bottom),
        -w / 2,
        -h / 2,
        w,
        h,
      )
      ctx.filter = 'none'
      // Vinheta: escurece as bordas da camada.
      if (fx?.vignette) {
        const grad = ctx.createRadialGradient(0, 0, Math.min(w, h) * 0.25, 0, 0, Math.hypot(w, h) / 2)
        grad.addColorStop(0, 'rgba(0,0,0,0)')
        grad.addColorStop(1, `rgba(0,0,0,${0.85 * fx.vignette})`)
        ctx.fillStyle = grad
        ctx.fillRect(-w / 2, -h / 2, w, h)
      }
      // Granulado: textura de ruído que muda de posição a cada quadro.
      if (fx?.grain) {
        const pattern = ctx.createPattern(grainPattern(), 'repeat')
        if (pattern) {
          const frame = Math.floor(local * 30)
          pattern.setTransform(new DOMMatrix().translate((frame * 73) % 256, (frame * 151) % 256))
          ctx.globalAlpha = tr.alpha * g.opacity * 0.35 * fx.grain
          ctx.globalCompositeOperation = 'overlay'
          ctx.fillStyle = pattern
          ctx.fillRect(-w / 2, -h / 2, w, h)
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = tr.alpha * g.opacity
        }
      }
      if (tr.dark > 0) {
        ctx.fillStyle = `rgba(0,0,0,${tr.dark})`
        ctx.fillRect(-w / 2, -h / 2, w, h)
      }
      if (tr.white > 0) {
        ctx.fillStyle = `rgba(255,255,255,${tr.white})`
        ctx.fillRect(-w / 2, -h / 2, w, h)
      }
      ctx.restore()
    }
  }
}
