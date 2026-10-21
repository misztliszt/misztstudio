import { useRef } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  /** Valor do duplo clique (ex.: 0 dB). */
  center?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  size?: number
  /** Arco a partir do centro (EQ, filtro) em vez de a partir do mínimo. */
  bipolar?: boolean
}

/** Knob giratório: arraste para cima/baixo; duplo clique volta ao centro; roda do mouse ajusta fino. */
export function Knob({ label, value, min, max, center, onChange, format, size = 44, bipolar = false }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  // Bipolar: o centro (ex.: 0 dB) fica no topo, mesmo com faixas assimétricas (−26 a +6 dB).
  const mid = center ?? (min + max) / 2
  const angle = bipolar ? (value < mid ? -135 + ((value - min) / (mid - min)) * 135 : ((value - mid) / (max - mid)) * 135) : -135 + ((value - min) / (max - min)) * 270
  const r = size / 2 - 4
  const c = size / 2
  const arc = (from: number, to: number) => {
    const p = (a: number) => [c + r * Math.sin((a * Math.PI) / 180), c - r * Math.cos((a * Math.PI) / 180)]
    const [x1, y1] = p(from)
    const [x2, y2] = p(to)
    return `M ${x1} ${y1} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} ${to > from ? 1 : 0} ${x2} ${y2}`
  }
  const zero = bipolar ? 0 : -135
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  const toAngle = (v: number) => (bipolar ? (v < mid ? -135 + ((v - min) / (mid - min)) * 135 : ((v - mid) / (max - mid)) * 135) : -135 + ((v - min) / (max - min)) * 270)
  const fromAngle = (a: number) => {
    const x = Math.min(135, Math.max(-135, a))
    if (!bipolar) return min + ((x + 135) / 270) * (max - min)
    return x < 0 ? min + ((x + 135) / 135) * (mid - min) : mid + (x / 135) * (max - mid)
  }

  return (
    <div className="knob" title={`${label}: ${format ? format(value) : value.toFixed(1)}`}>
      <svg
        width={size}
        height={size}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, v: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          // Arrasto em ângulo: cada lado do centro tem a sua escala.
          const startAngle = toAngle(drag.current.v)
          set(fromAngle(startAngle + ((drag.current.y - e.clientY) / (e.shiftKey ? 600 : 150)) * 270))
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => set(mid)}
        onWheel={(e) => set(fromAngle(angle - Math.sign(e.deltaY) * 5.4))}
      >
        <path d={arc(-135, 135)} className="knob-track" />
        {Math.abs(angle - zero) > 0.5 && <path d={arc(Math.min(zero, angle), Math.max(zero, angle))} className="knob-value" />}
        <circle cx={c} cy={c} r={r - 6} className="knob-cap" />
        <line x1={c} y1={c} x2={c + (r - 9) * Math.sin((angle * Math.PI) / 180)} y2={c - (r - 9) * Math.cos((angle * Math.PI) / 180)} className="knob-pointer" />
      </svg>
      <span>{label}</span>
    </div>
  )
}
