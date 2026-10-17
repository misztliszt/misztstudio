import { useRef, useState, type ComponentType, type ReactNode } from 'react'
import { ChevronDown, type LucideProps } from 'lucide-react'

type Icon = ComponentType<LucideProps>

/**
 * Controle deslizante próprio: trilho com preenchimento (a partir do centro quando `bipolar`),
 * valor clicável para digitar e duplo clique para zerar. `onStart` antes de arrastar
 * mantém um único passo no desfazer.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (v) => v.toFixed(2),
  onChange,
  onStart,
  onReset,
  bipolar = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  onStart?: () => void
  onReset?: () => void
  bipolar?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const pos = ((value - min) / (max - min)) * 100
  const zero = bipolar ? ((0 - min) / (max - min)) * 100 : 0
  const from = Math.min(pos, zero)
  const to = Math.max(pos, zero)
  return (
    <div className="slider">
      <div className="slider-head">
        <label>{label}</label>
        {editing ? (
          <input
            className="slider-edit"
            autoFocus
            type="number"
            step={step}
            defaultValue={Number(value.toFixed(4))}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) {
                onStart?.()
                onChange(Math.min(max, Math.max(min, v)))
              }
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button className="slider-value" onClick={() => setEditing(true)} onDoubleClick={onReset} title={onReset ? 'Clique para digitar · duplo clique para zerar' : 'Clique para digitar'}>
            {format(value)}
          </button>
        )}
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--from' as string]: `${from}%`, ['--to' as string]: `${to}%` }}
        onPointerDown={onStart}
        onDoubleClick={onReset}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/** Campo numérico em que se arrasta o rótulo para mudar o valor (como em editores profissionais). */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 0.1,
  suffix,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const drag = useRef<{ x: number; start: number } | null>(null)
  const clamp = (v: number) => {
    let r = v
    if (min !== undefined) r = Math.max(min, r)
    if (max !== undefined && Number.isFinite(max)) r = Math.min(max, r)
    return r
  }
  const shown = draft ?? value
  return (
    <div className="number-field">
      <label
        className="scrub"
        title="Arraste para ajustar"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, start: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const delta = ((e.clientX - drag.current.x) / 4) * step * (e.shiftKey ? 10 : 1)
          setDraft(clamp(drag.current.start + delta))
        }}
        onPointerUp={() => {
          if (draft !== null && Math.abs(draft - value) > 1e-6) onCommit(draft)
          drag.current = null
          setDraft(null)
        }}
      >
        {label}
      </label>
      <div className="number-input">
        {draft !== null ? (
          <input type="number" readOnly value={Number(shown.toFixed(2))} />
        ) : (
          <input
            key={value}
            type="number"
            step={step}
            defaultValue={Number(value.toFixed(2))}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && Math.abs(clamp(v) - value) > 1e-4) onCommit(clamp(v))
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        )}
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </div>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className={`select ${disabled ? 'disabled' : ''}`}>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value)
          if (opt) onChange(opt.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="select-chevron" />
    </div>
  )
}

export function Section({ title, children, right, icon: IconC }: { title: string; children: ReactNode; right?: ReactNode; icon?: Icon }) {
  return (
    <div className="section">
      <div className="section-head">
        <h3>
          {IconC && <IconC size={13} strokeWidth={2.2} />}
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  )
}

/** Botão de ícone com dica (tooltip) e atalho opcional. */
export function IconButton({
  icon: IconC,
  label,
  shortcut,
  onClick,
  disabled,
  active,
  variant,
  tipPos = 'bottom',
  size = 17,
  showLabel = false,
}: {
  icon: Icon
  label: string
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  variant?: 'primary' | 'ghost'
  tipPos?: 'bottom' | 'top' | 'right'
  size?: number
  showLabel?: boolean
}) {
  return (
    <button
      className={`icon-button ${variant ?? ''} ${active ? 'active' : ''} ${showLabel ? 'with-label' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-tip={showLabel ? undefined : shortcut ? `${label}  ·  ${shortcut}` : label}
      data-tip-pos={tipPos}
    >
      <IconC size={size} strokeWidth={1.9} />
      {showLabel && <span>{label}</span>}
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: Icon }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <o.icon size={14} strokeWidth={2} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
