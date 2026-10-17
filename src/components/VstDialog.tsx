import { useEffect, useState } from 'react'
import { Plug, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { Clip, Media, ProbeResult } from '../types'
import { Select } from './controls'

const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

interface Props {
  clip: Clip
  media: Media
  onDone: (result: ProbeResult, pluginName: string) => void
  onClose: () => void
}

/** Processa o áudio do clipe por um plugin VST3 instalado no computador (via pedalboard). */
export function VstDialog({ clip, media, onDone, onClose }: Props) {
  const [status, setStatus] = useState<{ installed: boolean; python: string | null } | null>(null)
  const [plugins, setPlugins] = useState<{ name: string; path: string; vendor: string }[]>([])
  const [plugin, setPlugin] = useState('')
  const [state, setState] = useState<string | null>(null)
  const [busy, setBusy] = useState<'install' | 'editor' | 'apply' | null>(null)
  const [line, setLine] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.vstStatus().then(setStatus)
    void window.api.vstScan().then((list) => {
      setPlugins(list)
      setPlugin((p) => p || list[0]?.path || '')
    })
    return window.api.onVstProgress((m) => setLine(`${m.stage}${m.line ? ` · ${m.line}` : ''}`))
  }, [])

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const name = plugins.find((p) => p.path === plugin)?.name ?? 'Plugin'
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <div className="export-head">
          <span className="export-icon">
            <Plug size={20} />
          </span>
          <div>
            <h2>Plugin VST3</h2>
            <span className="dim">Processa o áudio de “{media.name}” por um plugin instalado</span>
          </div>
        </div>

        {status && !status.installed && (
          <div className="install-box">
            <p>
              Para usar plugins VST3 o app instala uma vez o <strong>pedalboard</strong> (código aberto, ~40 MB) num Python próprio, sem mexer no seu.
            </p>
            {!status.python && <p className="error">Python 3.9+ não encontrado. Instale em python.org e abra o app de novo.</p>}
            {busy === 'install' && <p className="log ellipsis">{line}</p>}
          </div>
        )}

        {status?.installed && (
          <>
            {plugins.length === 0 ? (
              <p className="hint left">Nenhum plugin VST3 encontrado em Arquivos de Programas\Arquivos Comuns\VST3.</p>
            ) : (
              <div className="stack">
                <div className="field column">
                  <label>Plugin</label>
                  <Select
                    value={plugin}
                    options={plugins.map((p) => ({ value: p.path, label: `${p.name} · ${p.vendor}` }))}
                    onChange={(v) => {
                      setPlugin(v)
                      setState(null)
                    }}
                  />
                </div>
                <button
                  className="btn action-row"
                  disabled={!!busy || !plugin}
                  onClick={() =>
                    run('editor', async () => {
                      const r = await window.api.vstEditor(plugin, state)
                      setState(r.state)
                    })
                  }
                >
                  <SlidersHorizontal size={15} /> {busy === 'editor' ? 'Interface aberta: ajuste e feche a janela do plugin…' : state ? 'Reabrir a interface do plugin' : 'Abrir a interface do plugin'}
                </button>
                <p className="hint left">
                  {state ? `Ajustes de ${name} guardados. ` : 'Sem ajustes: o plugin usa o preset padrão. '}O resultado vira um novo arquivo de áudio; Ctrl+Z volta ao original.
                </p>
              </div>
            )}
            {busy === 'apply' && <p className="hint left">Processando pelo {name}…</p>}
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy === 'apply'}>
            Fechar
          </button>
          {status && !status.installed && status.python && (
            <button className="btn primary" disabled={!!busy} onClick={() => run('install', async () => setStatus(await window.api.vstInstall()))}>
              Instalar suporte a VST3
            </button>
          )}
          {status?.installed && plugins.length > 0 && (
            <button
              className="btn primary"
              disabled={!!busy || !plugin}
              onClick={() =>
                run('apply', async () => {
                  const r = await window.api.vstApply(media.path, clip.in, clip.duration * (clip.speed || 1), plugin, state)
                  onDone(r, name)
                })
              }
            >
              <Sparkles size={15} /> Aplicar ao clipe
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
