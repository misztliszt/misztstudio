/** Atalhos de teclado do editor. O usuário pode trocar cada um nas preferências. */

export type ShortcutId =
  | 'undo'
  | 'redo'
  | 'history'
  | 'save'
  | 'saveAs'
  | 'open'
  | 'import'
  | 'export'
  | 'preferences'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'selectAll'
  | 'play'
  | 'split'
  | 'text'
  | 'delete'
  | 'rippleDelete'
  | 'marker'
  | 'prevMarker'
  | 'nextMarker'
  | 'back5'
  | 'pause'
  | 'forwardPlay'
  | 'home'
  | 'end'
  | 'frameBack'
  | 'frameForward'
  | 'secondBack'
  | 'secondForward'
  | 'deselect'

export interface ShortcutDef {
  id: ShortcutId
  label: string
  group: 'Arquivo' | 'Edição' | 'Reprodução'
  /** Combinações padrão (a primeira é a mostrada nas dicas). */
  keys: string[]
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'save', label: 'Salvar', group: 'Arquivo', keys: ['Ctrl+S'] },
  { id: 'saveAs', label: 'Salvar como', group: 'Arquivo', keys: ['Ctrl+Shift+S'] },
  { id: 'open', label: 'Abrir projeto', group: 'Arquivo', keys: ['Ctrl+O'] },
  { id: 'import', label: 'Importar mídia', group: 'Arquivo', keys: ['Ctrl+I'] },
  { id: 'export', label: 'Exportar', group: 'Arquivo', keys: ['Ctrl+E'] },
  { id: 'preferences', label: 'Preferências', group: 'Arquivo', keys: ['Ctrl+,'] },
  { id: 'undo', label: 'Desfazer', group: 'Edição', keys: ['Ctrl+Z'] },
  { id: 'redo', label: 'Refazer', group: 'Edição', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'history', label: 'Histórico de ações', group: 'Edição', keys: ['Ctrl+H'] },
  { id: 'copy', label: 'Copiar', group: 'Edição', keys: ['Ctrl+C'] },
  { id: 'cut', label: 'Recortar', group: 'Edição', keys: ['Ctrl+X'] },
  { id: 'paste', label: 'Colar', group: 'Edição', keys: ['Ctrl+V'] },
  { id: 'duplicate', label: 'Duplicar', group: 'Edição', keys: ['Ctrl+D'] },
  { id: 'selectAll', label: 'Selecionar tudo', group: 'Edição', keys: ['Ctrl+A'] },
  { id: 'split', label: 'Dividir no cursor', group: 'Edição', keys: ['S'] },
  { id: 'text', label: 'Novo texto', group: 'Edição', keys: ['T'] },
  { id: 'delete', label: 'Excluir seleção', group: 'Edição', keys: ['Delete', 'Backspace'] },
  { id: 'rippleDelete', label: 'Excluir fechando o buraco', group: 'Edição', keys: ['Shift+Delete', 'Shift+Backspace'] },
  { id: 'marker', label: 'Marcador no cursor', group: 'Edição', keys: ['M'] },
  { id: 'deselect', label: 'Limpar seleção', group: 'Edição', keys: ['Escape'] },
  { id: 'play', label: 'Reproduzir / pausar', group: 'Reprodução', keys: ['Space'] },
  { id: 'back5', label: 'Voltar 5 s', group: 'Reprodução', keys: ['J'] },
  { id: 'pause', label: 'Pausar', group: 'Reprodução', keys: ['K'] },
  { id: 'forwardPlay', label: 'Tocar', group: 'Reprodução', keys: ['L'] },
  { id: 'prevMarker', label: 'Marcador anterior', group: 'Reprodução', keys: ['['] },
  { id: 'nextMarker', label: 'Próximo marcador', group: 'Reprodução', keys: [']'] },
  { id: 'home', label: 'Início', group: 'Reprodução', keys: ['Home'] },
  { id: 'end', label: 'Fim', group: 'Reprodução', keys: ['End'] },
  { id: 'frameBack', label: 'Quadro anterior', group: 'Reprodução', keys: ['ArrowLeft'] },
  { id: 'frameForward', label: 'Próximo quadro', group: 'Reprodução', keys: ['ArrowRight'] },
  { id: 'secondBack', label: 'Voltar 1 s', group: 'Reprodução', keys: ['Shift+ArrowLeft'] },
  { id: 'secondForward', label: 'Avançar 1 s', group: 'Reprodução', keys: ['Shift+ArrowRight'] },
]

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** Combinação normalizada de uma tecla pressionada (ex.: "Ctrl+Shift+S"), ou null só com modificadores. */
export function comboOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
  if (MODIFIERS.has(e.key)) return null
  let key = e.code === 'Space' ? 'Space' : e.key
  if (key.length === 1) key = key.toUpperCase()
  // Com Shift, letras e símbolos mudam (ex.: "{"); usa a tecla física para letras.
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  const parts = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/** Combinações em uso (padrão + personalizadas). */
export function keysFor(id: ShortcutId, overrides: Record<string, string> = {}) {
  return overrides[id] ? [overrides[id]] : SHORTCUTS.find((s) => s.id === id)!.keys
}

/** Mapa combinação → ação, já com as personalizações. */
export function buildKeymap(overrides: Record<string, string> = {}) {
  const map = new Map<string, ShortcutId>()
  for (const s of SHORTCUTS) for (const k of keysFor(s.id, overrides)) if (!map.has(k)) map.set(k, s.id)
  return map
}

const PRETTY: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Del', Backspace: '⌫', Escape: 'Esc', Space: 'Espaço' }

/** Texto para mostrar ao usuário (ex.: "Shift+←"). */
export const prettyCombo = (combo: string) =>
  combo
    .split('+')
    .map((p) => PRETTY[p] ?? p)
    .join('+')

export const shortcutLabel = (id: ShortcutId, overrides?: Record<string, string>) => prettyCombo(keysFor(id, overrides)[0])
