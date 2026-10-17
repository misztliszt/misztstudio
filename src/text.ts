import type { TextStyle } from './types'

export const FONTS = ['Segoe UI', 'Arial', 'Impact', 'Georgia', 'Verdana', 'Trebuchet MS', 'Consolas', 'Comic Sans MS', 'Times New Roman']

export const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: 'Título', style: { size: 130, bold: true, outline: true, background: null, color: '#ffffff', y: 0.45, x: 0.5, animation: 'pop', font: 'Segoe UI' } },
  { name: 'Legenda', style: { size: 60, bold: true, outline: false, background: 'rgba(0,0,0,0.65)', color: '#ffffff', y: 0.86, x: 0.5, animation: 'none', font: 'Segoe UI' } },
  { name: 'Karaokê', style: { size: 72, bold: true, outline: true, background: null, color: '#ffffff', highlight: '#ffd84d', y: 0.82, x: 0.5, animation: 'karaoke', font: 'Segoe UI' } },
  { name: 'Lower third', style: { size: 54, bold: true, outline: false, background: '#22d3c5', color: '#04110f', y: 0.8, x: 0.28, animation: 'slide', font: 'Segoe UI' } },
  { name: 'Impacto', style: { size: 150, bold: false, outline: true, background: null, color: '#ffe14d', y: 0.5, x: 0.5, animation: 'bounce', font: 'Impact' } },
  { name: 'Máquina', style: { size: 80, bold: false, outline: false, background: 'rgba(0,0,0,0.7)', color: '#e8ffe8', y: 0.5, x: 0.5, animation: 'typewriter', font: 'Consolas' } },
  { name: 'Neon', style: { size: 110, bold: true, outline: true, background: null, color: '#ff4dff', y: 0.5, x: 0.5, animation: 'fade', font: 'Trebuchet MS' } },
]

export const TEXT_ANIMATIONS: { value: TextStyle['animation']; label: string }[] = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'fade', label: 'Aparecer' },
  { value: 'slide', label: 'Deslizar para cima' },
  { value: 'pop', label: 'Pop (salta)' },
  { value: 'bounce', label: 'Cair e quicar' },
  { value: 'typewriter', label: 'Máquina de escrever' },
  { value: 'wordByWord', label: 'Palavra por palavra' },
  { value: 'karaoke', label: 'Karaokê (destaca palavras)' },
]

/** Animações que a exportação renderiza quadro a quadro (as outras o FFmpeg anima sozinho). */
export const FRAME_ANIMATIONS = new Set<TextStyle['animation']>(['pop', 'bounce', 'typewriter', 'wordByWord', 'karaoke'])

/** Duração das animações de entrada e saída de texto (s). Igual na exportação. */
export const TEXT_ANIM = 0.4
/** Distância da animação "slide", em fração da altura do quadro. */
export const SLIDE_DISTANCE = 0.06

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const easeOutBack = (p: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}
const easeOutBounce = (p: number) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (p < 1 / d1) return n1 * p * p
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375
  return n1 * (p -= 2.625 / d1) * p + 0.984375
}

/** Instantes (s desde o início do clipe) em que cada palavra começa: dos tempos do Whisper ou distribuídos. */
function wordStarts(style: TextStyle, words: string[], duration: number) {
  if (style.words && style.words.length === words.length) return style.words.map((w) => w.t0)
  const span = duration * 0.85
  const total = words.reduce((s, w) => s + w.length + 1, 0) || 1
  let acc = 0
  return words.map((w) => {
    const t = (acc / total) * span
    acc += w.length + 1
    return t
  })
}

/**
 * Desenha o texto num canvas do tamanho do quadro. Com `local`/`duration` aplica a animação;
 * sem eles desenha o estado final (PNG estático da exportação).
 */
export function drawText(ctx: CanvasRenderingContext2D, style: TextStyle, W: number, H: number, local?: number, duration?: number) {
  const scaleRef = H / 1080
  const px = Math.max(4, style.size * scaleRef)
  const lines = style.content.split('\n')
  const animated = local !== undefined && duration !== undefined
  const t = local ?? 1e9
  const dur = duration ?? 1e9
  ctx.save()
  ctx.font = `${style.bold ? 700 : 400} ${px}px "${style.font}", sans-serif`
  ctx.textBaseline = 'middle'
  const lineH = px * 1.2
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const height = lineH * lines.length
  const cx = style.x * W
  let cy = style.y * H
  let scale = 1

  if (animated && style.animation !== 'none') {
    const outFade = clamp01((dur - t) / TEXT_ANIM)
    switch (style.animation) {
      case 'fade':
        ctx.globalAlpha *= Math.min(clamp01(t / TEXT_ANIM), outFade)
        break
      case 'slide':
        ctx.globalAlpha *= Math.min(clamp01(t / TEXT_ANIM), outFade)
        cy += (1 - clamp01(t / TEXT_ANIM)) * SLIDE_DISTANCE * H
        break
      case 'pop': {
        const p = clamp01(t / 0.35)
        scale = p < 1 ? Math.max(0.01, easeOutBack(p)) : 1
        ctx.globalAlpha *= Math.min(clamp01(t / 0.12), outFade)
        break
      }
      case 'bounce': {
        const p = clamp01(t / 0.7)
        cy -= (1 - easeOutBounce(p)) * 0.3 * H
        ctx.globalAlpha *= Math.min(clamp01(t / 0.08), outFade)
        break
      }
      default:
        ctx.globalAlpha *= outFade
    }
  }

  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  if (style.background) {
    const padX = px * 0.4
    const padY = px * 0.2
    ctx.fillStyle = style.background
    ctx.beginPath()
    ctx.roundRect(-width / 2 - padX, -height / 2 - padY, width + padX * 2, height + padY * 2, px * 0.2)
    ctx.fill()
  }

  const paint = (text: string, x: number, y: number, color: string) => {
    if (style.outline) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = px * 0.1
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(text, x, y)
    }
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
  }

  const perWord = animated && (style.animation === 'wordByWord' || style.animation === 'karaoke')
  if (animated && style.animation === 'typewriter') {
    // Revela letra a letra (layout fixo: cada linha alinhada como se estivesse completa).
    const total = lines.reduce((s, l) => s + l.length, 0)
    const shown = Math.floor(total * clamp01(t / Math.max(0.2, Math.min(dur * 0.7, total * 0.06))))
    let left = shown
    ctx.textAlign = 'left'
    lines.forEach((line, i) => {
      const y = -height / 2 + lineH * (i + 0.5)
      const part = line.slice(0, Math.max(0, left))
      left -= line.length
      if (part) paint(part, -ctx.measureText(line).width / 2, y, style.color)
    })
    const caretOn = Math.floor(t * 2) % 2 === 0 && shown < total
    if (caretOn) {
      ctx.fillStyle = style.color
      ctx.fillRect(width / 2 + px * 0.05, -px * 0.45, px * 0.08, px * 0.9)
    }
  } else if (perWord) {
    const allWords = lines.flatMap((l) => l.split(/\s+/).filter(Boolean))
    const starts = wordStarts(style, allWords, dur)
    const space = ctx.measureText(' ').width
    ctx.textAlign = 'left'
    let k = 0
    lines.forEach((line, i) => {
      const y = -height / 2 + lineH * (i + 0.5)
      let x = -ctx.measureText(line).width / 2
      for (const w of line.split(/\s+/).filter(Boolean)) {
        const active = t >= starts[k]
        if (style.animation === 'karaoke') paint(w, x, y, active ? (style.highlight ?? '#ffd84d') : style.color)
        else if (active) {
          ctx.save()
          ctx.globalAlpha *= clamp01((t - starts[k]) / 0.12)
          paint(w, x, y, style.color)
          ctx.restore()
        }
        x += ctx.measureText(w).width + space
        k++
      }
    })
  } else {
    ctx.textAlign = 'center'
    lines.forEach((line, i) => paint(line, 0, -height / 2 + lineH * (i + 0.5), style.color))
  }
  ctx.restore()
}

/** PNG transparente (base64, sem prefixo) com o texto no estado final. */
export function renderTextPng(style: TextStyle, W: number, H: number) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  drawText(canvas.getContext('2d')!, style, W, H)
  return canvas.toDataURL('image/png').split(',')[1]
}

/**
 * Sequência de quadros da animação para a exportação: amostra em `fps` e junta quadros
 * idênticos seguidos (karaokê e palavra a palavra viram poucas imagens).
 */
export function renderTextSequence(style: TextStyle, W: number, H: number, duration: number, fps: number) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const frames: { png: string; duration: number }[] = []
  const count = Math.max(1, Math.round(duration * fps))
  let last = ''
  for (let f = 0; f < count; f++) {
    ctx.clearRect(0, 0, W, H)
    drawText(ctx, style, W, H, f / fps, duration)
    const png = canvas.toDataURL('image/png').split(',')[1]
    if (png === last) frames[frames.length - 1].duration += 1 / fps
    else frames.push({ png, duration: 1 / fps })
    last = png
  }
  return frames
}
