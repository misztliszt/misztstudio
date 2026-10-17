import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

/*
 * Avisos (toasts) e diálogos próprios, no lugar de alert/confirm do navegador.
 *   const { toast, confirm, alert } = useFeedback()
 *   toast.success('Vídeo exportado', { action: { label: 'Mostrar', run } })
 *   if (await confirm({ title: 'Descartar alterações?', danger: true })) …
 */

type Tone = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  tone: Tone
  title: string
  detail?: string
  action?: { label: string; run: () => void }
  duration: number
}

type ToastOptions = Partial<Pick<ToastItem, 'detail' | 'action' | 'duration'>>

interface DialogOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface DialogState extends DialogOptions {
  kind: 'confirm' | 'alert'
  resolve: (v: boolean) => void
}

interface Feedback {
  toast: Record<Tone, (title: string, opts?: ToastOptions) => void>
  confirm: (opts: DialogOptions) => Promise<boolean>
  alert: (opts: DialogOptions) => Promise<void>
}

const Ctx = createContext<Feedback | null>(null)

export function useFeedback() {
  const f = useContext(Ctx)
  if (!f) throw new Error('useFeedback fora do FeedbackProvider')
  return f
}

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const push = useCallback(
    (tone: Tone) =>
      (title: string, opts: ToastOptions = {}) => {
        const id = nextId.current++
        const duration = opts.duration ?? (tone === 'error' ? 8000 : 4000)
        setToasts((t) => [...t.slice(-3), { id, tone, title, ...opts, duration }])
      },
    [],
  )

  const value = useMemo<Feedback>(
    () => ({
      toast: { success: push('success'), error: push('error'), info: push('info'), warning: push('warning') },
      confirm: (opts) => new Promise((resolve) => setDialog({ ...opts, kind: 'confirm', resolve })),
      alert: (opts) => new Promise((resolve) => setDialog({ ...opts, kind: 'alert', resolve: () => resolve() })),
    }),
    [push],
  )

  const close = (result: boolean) => {
    dialog?.resolve(result)
    setDialog(null)
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
      {dialog && <Dialog state={dialog} onClose={close} />}
    </Ctx.Provider>
  )
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const Icon = ICON[item.tone]
  useEffect(() => {
    if (item.duration <= 0) return
    const t = setTimeout(() => setLeaving(true), item.duration)
    return () => clearTimeout(t)
  }, [item.duration])
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(onClose, 180)
    return () => clearTimeout(t)
  }, [leaving, onClose])
  return (
    <div className={`toast ${item.tone} ${leaving ? 'leaving' : ''}`}>
      <Icon size={18} className="toast-icon" />
      <div className="toast-body">
        <strong>{item.title}</strong>
        {item.detail && <span>{item.detail}</span>}
      </div>
      {item.action && (
        <button
          className="toast-action"
          onClick={() => {
            item.action!.run()
            setLeaving(true)
          }}
        >
          {item.action.label}
        </button>
      )}
      <button className="toast-close" onClick={() => setLeaving(true)} aria-label="Fechar">
        <X size={14} />
      </button>
    </div>
  )
}

function Dialog({ state, onClose }: { state: DialogState; onClose: (v: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={() => state.kind === 'confirm' && onClose(false)}>
      <div className="modal dialog" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`dialog-icon ${state.danger ? 'danger' : ''}`}>{state.danger ? <AlertTriangle size={20} /> : <Info size={20} />}</div>
        <div className="dialog-content">
          <h2>{state.title}</h2>
          {state.message && <div className="dialog-message">{state.message}</div>}
        </div>
        <div className="modal-actions">
          {state.kind === 'confirm' && (
            <button className="btn" onClick={() => onClose(false)}>
              {state.cancelLabel ?? 'Cancelar'}
            </button>
          )}
          <button ref={confirmRef} className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => onClose(true)}>
            {state.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
