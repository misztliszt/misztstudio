import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { ChevronRight, type LucideProps } from 'lucide-react'

export type MenuItem =
  | { separator: true }
  | {
      label: string
      icon?: ComponentType<LucideProps>
      shortcut?: string
      onClick?: () => void
      disabled?: boolean
      danger?: boolean
      checked?: boolean
      submenu?: MenuItem[]
    }

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/** Menu de contexto flutuante; fecha ao clicar fora, Esc ou rolar. */
export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  return <MenuPanel items={state.items} x={state.x} y={state.y} onClose={onClose} />
}

function MenuPanel({ items, x, y, onClose, alignRightOf }: { items: MenuItem[]; x: number; y: number; onClose: () => void; alignRightOf?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [open, setOpen] = useState<{ index: number; x: number; y: number; left: number } | null>(null)

  // Mantém o menu dentro da janela.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + r.width > window.innerWidth - 8) left = alignRightOf !== undefined ? alignRightOf - r.width : window.innerWidth - r.width - 8
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ left, top })
  }, [x, y, alignRightOf])

  return (
    <div ref={ref} className="context-menu" style={pos} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        'separator' in item ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={`menu-item ${item.danger ? 'danger' : ''} ${open?.index === i ? 'open' : ''}`}
            disabled={item.disabled}
            onMouseEnter={(e) => {
              if (item.submenu) {
                const r = e.currentTarget.getBoundingClientRect()
                setOpen({ index: i, x: r.right - 2, y: r.top - 5, left: r.left })
              } else setOpen(null)
            }}
            onClick={() => {
              if (item.submenu) return
              item.onClick?.()
              onClose()
            }}
          >
            <span className="menu-icon">{item.checked ? <span className="menu-check">✓</span> : item.icon ? <item.icon size={14} strokeWidth={2} /> : null}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
            {item.submenu && <ChevronRight size={13} className="menu-arrow" />}
          </button>
        ),
      )}
      {open && (() => {
        const item = items[open.index]
        return 'submenu' in item && item.submenu ? <MenuPanel items={item.submenu} x={open.x} y={open.y} alignRightOf={open.left} onClose={onClose} /> : null
      })()}
    </div>
  )
}
