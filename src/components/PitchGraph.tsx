import { useEffect, useRef } from 'react'
import type { PlaybackEngine } from '../engine'
import { hzToMidi, midiToName } from '../music'

const WINDOW = 6 // segundos visíveis

/** Gráfico rolante do pitch detectado (azul) e da nota alvo (verde) de uma trilha. */
export function PitchGraph({ engine, trackId }: { engine: PlaybackEngine; trackId: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const readings = useRef<{ at: number; f0: number; target: number }[]>([])

  useEffect(() => {
    readings.current = []
    const prev = engine.audio.pitchListener
    engine.audio.pitchListener = (id, r) => {
      prev?.(id, r)
      if (id !== trackId) return
      const now = performance.now() / 1000
      readings.current.push({ at: now, f0: r.f0, target: r.target })
      while (readings.current.length && readings.current[0].at < now - WINDOW) readings.current.shift()
    }
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = ref.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      const data = readings.current
      const voiced = data.filter((d) => d.f0 > 0)
      const mids = voiced.map((d) => hzToMidi(d.f0))
      const center = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : 60
      const lo = Math.round(center) - 7
      const hi = lo + 14
      const y = (m: number) => h - ((m - lo) / (hi - lo)) * h
      ctx.font = '10px Segoe UI'
      for (let m = lo; m <= hi; m++) {
        ctx.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'
        ctx.fillRect(0, y(m), w, 1)
        if (m % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.fillText(midiToName(m), 2, y(m) - 2)
        }
      }
      const now = performance.now() / 1000
      const x = (at: number) => w - ((now - at) / WINDOW) * w
      const line = (key: 'f0' | 'target', color: string) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        let pen = false
        for (const d of data) {
          if (d[key] <= 0) {
            pen = false
            continue
          }
          const px = x(d.at)
          const py = y(hzToMidi(d[key]))
          if (pen) ctx.lineTo(px, py)
          else ctx.moveTo(px, py)
          pen = true
        }
        ctx.stroke()
      }
      line('target', '#2fbf71')
      line('f0', '#5b9bff')
      if (!voiced.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.fillText('Reproduza a timeline para ver o pitch', 30, h / 2)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      engine.audio.pitchListener = prev
    }
  }, [engine, trackId])

  return (
    <div className="pitch-graph">
      <canvas ref={ref} width={236} height={120} />
      <div className="legend">
        <span className="dot blue" /> detectado <span className="dot green" /> corrigido
      </div>
    </div>
  )
}
