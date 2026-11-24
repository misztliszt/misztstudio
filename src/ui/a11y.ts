/*
 * Acessibilidade aplicada a toda a interface, num só lugar.
 *
 * Os diálogos do app são `<div class="modal-backdrop"><div class="modal">…`. Em vez de repetir atributos em cada
 * um, este módulo observa a página e, para cada diálogo que aparece:
 *   - marca role="dialog" + aria-modal e liga o título (h2) como nome;
 *   - leva o foco para dentro e o devolve ao fechar;
 *   - prende o Tab dentro do diálogo e fecha com Esc (clicando em "Fechar"/"Cancelar", se não estiver ocupado).
 * Também dá nome acessível a botões só de ícone (a partir da dica `data-tip`) e a campos cujo rótulo é o
 * elemento irmão anterior, e marca o menu de contexto.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)

/** Texto do rótulo de um campo: `<label for>`, rótulo que o envolve, ou o `<label>`/título logo antes dele. */
function labelFor(el: HTMLElement): string {
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return ''
  if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return ''
  if (el.closest('label')) return ''
  const wrapper = el.closest('.select, .number-input, .slider') ?? el
  let prev = wrapper.previousElementSibling
  while (prev && prev.tagName !== 'LABEL' && !prev.matches('.field-label, .label, h4, .slider-head') && prev.previousElementSibling && prev.textContent === '') prev = prev.previousElementSibling
  if (prev && (prev.tagName === 'LABEL' || prev.matches('.field-label, .label, h4'))) return (prev.textContent ?? '').trim()
  const own = wrapper.parentElement?.querySelector(':scope > label')
  return own ? (own.textContent ?? '').trim() : ''
}

function enhance(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => {
    if (el.matches('button, [role="button"], a') && !el.getAttribute('aria-label') && !(el.textContent ?? '').trim()) el.setAttribute('aria-label', el.dataset.tip!.split('  ·  ')[0])
  })
  root.querySelectorAll<HTMLElement>('select, input[type="range"], input[type="number"], input[type="text"], input[type="search"]').forEach((el) => {
    const name = labelFor(el)
    if (name) el.setAttribute('aria-label', name)
  })
  root.querySelectorAll<HTMLElement>('.context-menu:not([role])').forEach((el) => {
    el.setAttribute('role', 'menu')
    el.querySelectorAll('.menu-item').forEach((i) => i.setAttribute('role', 'menuitem'))
  })
}

interface Tracked {
  opener: HTMLElement | null
}
const tracked = new WeakMap<HTMLElement, Tracked>()
let nextId = 1

function openDialog(modal: HTMLElement) {
  if (tracked.has(modal)) return
  tracked.set(modal, { opener: document.activeElement instanceof HTMLElement ? document.activeElement : null })
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  const title = modal.querySelector<HTMLElement>('h1, h2, h3')
  if (title) {
    if (!title.id) title.id = `dlg-title-${nextId++}`
    modal.setAttribute('aria-labelledby', title.id)
  }
  // Foco para dentro (se o diálogo já não focou algo): o primeiro campo ou botão.
  if (!modal.contains(document.activeElement)) {
    const first = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible)
    ;(first ?? modal).focus?.({ preventScroll: true })
  }
  if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1')
}

function closeDialog(modal: HTMLElement) {
  const t = tracked.get(modal)
  if (!t) return
  tracked.delete(modal)
  // Devolve o foco a quem abriu o diálogo (se ainda existe na página).
  if (t.opener && document.contains(t.opener)) t.opener.focus?.({ preventScroll: true })
}

/** O diálogo que está por cima (o último aberto). */
const topModal = () => {
  const all = [...document.querySelectorAll<HTMLElement>('.modal-backdrop .modal')]
  return all[all.length - 1] ?? null
}

function onKeyDown(e: KeyboardEvent) {
  // Quem já tratou a tecla (ex.: gravar um atalho nas Preferências) tem a vez.
  if (e.defaultPrevented) return
  const modal = topModal()
  if (!modal) return
  if (e.key === 'Escape') {
    // Fecha pelo botão do próprio diálogo, para passar pelas mesmas regras dele (ex.: "Fechar" desabilitado em gravação).
    const closer = [...modal.querySelectorAll<HTMLButtonElement>('button')].find((b) => !b.disabled && /^(fechar|cancelar|agora não)$/i.test((b.textContent ?? '').trim()))
    if (closer) {
      e.preventDefault()
      e.stopPropagation()
      closer.click()
    }
    return
  }
  if (e.key === 'Tab') {
    const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (!modal.contains(active)) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

let installed = false

/** Liga tudo uma vez (chamado na abertura do app). */
export function installA11y() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const seen = new Set<HTMLElement>()
  const scan = () => {
    document.querySelectorAll<HTMLElement>('.modal-backdrop .modal').forEach((m) => {
      seen.add(m)
      openDialog(m)
    })
    for (const m of [...seen]) {
      if (!document.contains(m)) {
        seen.delete(m)
        closeDialog(m)
      }
    }
    enhance(document)
  }
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      scan()
    })
  }).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('keydown', onKeyDown)
  scan()
}
