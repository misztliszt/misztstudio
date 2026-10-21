import { useEffect, useMemo, useState } from 'react'
import { Download, FolderOpen, Keyboard, RefreshCw, RotateCcw, Settings2, SlidersHorizontal } from 'lucide-react'
import type { AppSettings, UpdateStatus } from '../types'
import { buildKeymap, comboOf, keysFor, prettyCombo, SHORTCUTS, type ShortcutId } from '../shortcuts'
import { Segmented, Toggle } from './controls'

type Tab = 'general' | 'shortcuts' | 'updates'

interface Props {
  settings: AppSettings
  update: UpdateStatus | null
  onChange: (patch: Partial<AppSettings>) => void
  onClose: () => void
}

export function PreferencesDialog({ settings, update, onChange, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.shortcut-capture') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal prefs-dialog">
        <nav className="prefs-nav">
          <h2>Preferências</h2>
          <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
            <SlidersHorizontal size={15} /> Geral
          </button>
          <button className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}>
            <Keyboard size={15} /> Atalhos
          </button>
          <button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>
            <Download size={15} /> Atualizações
          </button>
          <span className="prefs-version">Miszt Studio {settings.version}</span>
        </nav>
        <div className="prefs-body">
          {tab === 'general' && <General settings={settings} onChange={onChange} />}
          {tab === 'shortcuts' && <Shortcuts settings={settings} onChange={onChange} />}
          {tab === 'updates' && <Updates settings={settings} update={update} onChange={onChange} />}
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Pronto
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FolderRow({ label, hint, value, fallback, onPick, onReset }: { label: string; hint: string; value: string | null; fallback: string; onPick: () => void; onReset?: () => void }) {
  return (
    <div className="prefs-row">
      <div className="prefs-label">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="prefs-folder">
        <button className="folder-chip" onClick={onPick} title={value ?? fallback}>
          <FolderOpen size={14} />
          <span className="ellipsis">{value ?? fallback}</span>
        </button>
        {onReset && value && (
          <button className="icon-btn" data-tip="Voltar ao padrão" onClick={onReset}>
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function General({ settings, onChange }: { settings: AppSettings; onChange: Props['onChange'] }) {
  const pick = async (key: 'downloadDir' | 'recordDir' | 'exportDir', title: string) => {
    const dir = await window.api.pickFolder(title, settings[key] ?? settings.downloadDir)
    if (dir) onChange({ [key]: dir })
  }
  return (
    <>
      <h3>Pastas</h3>
      <FolderRow label="Downloads" hint="Vídeos e músicas baixados (YouTube, biblioteca)" value={settings.downloadDir} fallback="" onPick={() => pick('downloadDir', 'Pasta dos downloads')} />
      <FolderRow
        label="Gravações"
        hint="Microfone e gravações de tela"
        value={settings.recordDir}
        fallback="Dentro da pasta de downloads"
        onPick={() => pick('recordDir', 'Pasta das gravações')}
        onReset={() => onChange({ recordDir: null })}
      />
      <FolderRow
        label="Exportação"
        hint="Onde o diálogo de exportar abre"
        value={settings.exportDir}
        fallback="A última pasta usada"
        onPick={() => pick('exportDir', 'Pasta das exportações')}
        onReset={() => onChange({ exportDir: null })}
      />

      <h3>Edição</h3>
      <div className="prefs-row">
        <div className="prefs-label">
          <strong>Qualidade da prévia</strong>
          <span>Menos pixels deixam a reprodução mais leve. A exportação não muda.</span>
        </div>
        <Segmented
          value={settings.previewQuality}
          onChange={(v) => onChange({ previewQuality: v })}
          options={[
            { value: 'full', label: 'Total' },
            { value: 'half', label: 'Metade' },
            { value: 'quarter', label: '1/4' },
          ]}
        />
      </div>
      <div className="prefs-row">
        <div className="prefs-label">
          <strong>Proxies</strong>
          <span>Cópias leves para vídeos pesados (4K, HEVC, ProRes)</span>
        </div>
        <Segmented
          value={settings.proxyMode}
          onChange={(v) => onChange({ proxyMode: v })}
          options={[
            { value: 'auto', label: 'Automático' },
            { value: 'always', label: 'Sempre' },
            { value: 'never', label: 'Nunca' },
          ]}
        />
      </div>
      <div className="prefs-row">
        <div className="prefs-label">
          <strong>Salvamento automático</strong>
          <span>Cópia de recuperação do projeto aberto</span>
        </div>
        <Segmented
          value={String(settings.autosaveSeconds)}
          onChange={(v) => onChange({ autosaveSeconds: Number(v) })}
          options={[
            { value: '10', label: '10 s' },
            { value: '20', label: '20 s' },
            { value: '60', label: '1 min' },
            { value: '300', label: '5 min' },
          ]}
        />
      </div>
    </>
  )
}

function Shortcuts({ settings, onChange }: { settings: AppSettings; onChange: Props['onChange'] }) {
  const [capturing, setCapturing] = useState<ShortcutId | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const overrides = settings.shortcuts ?? {}
  const keymap = useMemo(() => buildKeymap(overrides), [overrides])

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      const combo = comboOf(e)
      if (!combo) return
      const owner = keymap.get(combo)
      if (owner && owner !== capturing) {
        setConflict(`${prettyCombo(combo)} já é usado por “${SHORTCUTS.find((s) => s.id === owner)!.label}”. Troque aquele atalho primeiro.`)
        return
      }
      setConflict(null)
      const next = { ...overrides }
      if (SHORTCUTS.find((s) => s.id === capturing)!.keys[0] === combo) delete next[capturing]
      else next[capturing] = combo
      onChange({ shortcuts: next })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, keymap, overrides, onChange])

  const groups = ['Arquivo', 'Edição', 'Reprodução'] as const
  return (
    <>
      <div className="prefs-shortcuts-head">
        <h3>Atalhos de teclado</h3>
        <button className="btn ghost small" onClick={() => onChange({ shortcuts: {} })} disabled={!Object.keys(overrides).length}>
          <RotateCcw size={13} /> Restaurar padrões
        </button>
      </div>
      {conflict && <p className="error">{conflict}</p>}
      {groups.map((g) => (
        <div key={g} className="shortcut-group">
          <span className="shortcut-group-name">{g}</span>
          {SHORTCUTS.filter((s) => s.group === g).map((s) => {
            const custom = !!overrides[s.id]
            return (
              <div key={s.id} className="shortcut-row">
                <span>{s.label}</span>
                <button className={`kbd-btn ${capturing === s.id ? 'shortcut-capture' : ''} ${custom ? 'custom' : ''}`} onClick={() => setCapturing(capturing === s.id ? null : s.id)}>
                  {capturing === s.id ? 'Pressione as teclas…' : keysFor(s.id, overrides).map(prettyCombo).join('  ou  ')}
                </button>
                {custom ? (
                  <button
                    className="icon-btn"
                    data-tip="Voltar ao padrão"
                    onClick={() => {
                      const next = { ...overrides }
                      delete next[s.id]
                      onChange({ shortcuts: next })
                    }}
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : (
                  <span className="icon-btn-space" />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

function Updates({ settings, update, onChange }: { settings: AppSettings; update: UpdateStatus | null; onChange: Props['onChange'] }) {
  const [checking, setChecking] = useState(false)
  const st = update?.state ?? (settings.packaged ? 'idle' : 'unavailable')
  const text: Record<UpdateStatus['state'], string> = {
    unavailable: 'Atualizações só funcionam no app instalado (não no modo de desenvolvimento).',
    idle: 'Ainda não verificado nesta sessão.',
    checking: 'Procurando versões novas…',
    latest: 'Você está na versão mais recente.',
    downloading: `Baixando a versão ${update?.version ?? ''}… ${Math.round((update?.progress ?? 0) * 100)}%`,
    ready: `A versão ${update?.version ?? ''} está pronta. Reinicie para instalar.`,
    error: `Não foi possível verificar: ${update?.error ?? ''}`,
  }
  return (
    <>
      <h3>Atualizações</h3>
      <div className="prefs-row">
        <div className="prefs-label">
          <strong>Verificar automaticamente</strong>
          <span>Ao abrir o app e a cada 6 horas, pelas Releases do GitHub</span>
        </div>
        <Toggle checked={settings.checkUpdates} onChange={(v) => onChange({ checkUpdates: v })} />
      </div>
      <div className="update-box">
        <Settings2 size={18} />
        <div>
          <strong>Miszt Studio {settings.version}</strong>
          <span>{text[st]}</span>
          {st === 'downloading' && (
            <div className="progress small">
              <div style={{ width: `${Math.round((update?.progress ?? 0) * 100)}%` }} />
            </div>
          )}
        </div>
        {st === 'ready' ? (
          <button className="btn primary" onClick={() => void window.api.installUpdate()}>
            Reiniciar e atualizar
          </button>
        ) : (
          <button
            className="btn"
            disabled={!settings.packaged || checking || st === 'checking' || st === 'downloading'}
            onClick={async () => {
              setChecking(true)
              await window.api.checkUpdate()
              setChecking(false)
            }}
          >
            <RefreshCw size={14} /> Verificar agora
          </button>
        )}
      </div>
    </>
  )
}
