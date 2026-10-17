import type { TextStyle } from './types'

export const FONTS = ['Segoe UI', 'Arial', 'Impact', 'Georgia', 'Verdana', 'Trebuchet MS', 'Consolas', 'Comic Sans MS', 'Times New Roman']

export const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: 'Título', style: { size: 130, bold: true, outline: true, background: null, color: '#ffffff', y: 0.45, x: 0.5, animation: 'fade', font: 'Segoe UI' } },
  { name: 'Legenda', style: { size: 60, bold: true, outline: false, background: 'rgba(0,0,0,0.65)', color: '#ffffff', y: 0.86, x: 0.5, animation: 'none', font: 'Segoe UI' } },
  { name: 'Lower third', style: { size: 54, bold: true, outline: false, background: '#22d3c5', color: '#04110f', y: 0.8, x: 0.28, animation: 'slide', font: 'Segoe UI' } },
  { name: 'Impacto', style: { size: 150, bold: false, outline: true, background: null, color: '#ffe14d', y: 0.5, x: 0.5, animation: 'slide', font: 'Impact' } },
  { name: 'Neon', style: { size: 110, bold: true, outline: true, background: null, color: '#ff4dff', y: 0.5, x: 0.5, animation: 'fade', font: 'Trebuchet MS' } },
]

/** Duração das animações de entrada e saída de texto (s). Igual na exportação. */
export const TEXT_ANIM = 0.4
/** Distância da animação "slide", em fração da altura do quadro. */
export const SLIDE_DISTANCE = 0.06

/**
 * Desenha o texto num canvas do tamanho do quadro. Com `local`/`duration` aplica a
 * animação (prévia); sem eles desenha o estado estático (usado para gerar o PNG da exportação).
 */
export function drawText(ctx: CanvasRenderingContext2D, style: TextStyle, W: number, H: number, local?: number, duration?: number) {
  const scale = H / 1080
  const px = Math.max(4, style.size * scale)
  const lines = style.content.split('\n')
  ctx.save()
  ctx.font = `${style.bold ? 700 : 400} ${px}px "${style.font}", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lineH = px * 1.2
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const height = lineH * lines.length
  const cx = style.x * W
  let cy = style.y * H

  if (local !== undefined && duration !== undefined && style.animation !== 'none') {
    const t = Math.max(0, Math.min(1, local / TEXT_ANIM, (duration - local) / TEXT_ANIM))
    ctx.globalAlpha *= t
    if (style.animation === 'slide') {
      const enter = Math.min(1, local / TEXT_ANIM)
      cy += (1 - enter) * SLIDE_DISTANCE * H
    }
  }

  if (style.background) {
    const padX = px * 0.4
    const padY = px * 0.2
    ctx.fillStyle = style.background
    const x = cx - width / 2 - padX
    const y = cy - height / 2 - padY
    const w = width + padX * 2
    const h = height + padY * 2
    const r = px * 0.2
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fill()
  }

  lines.forEach((line, i) => {
    const y = cy - height / 2 + lineH * (i + 0.5)
    if (style.outline) {
      ctx.lineJoin = 'round'
      ctx.lineWidth = px * 0.1
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(line, cx, y)
    }
    ctx.fillStyle = style.color
    ctx.fillText(line, cx, y)
  })
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
