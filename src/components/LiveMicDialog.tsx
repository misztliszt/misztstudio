import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Headphones, Mic, Power, Radio, Settings } from 'lucide-react'
import { defaultLive, type LiveReading, type LiveSettings, type LiveVoice } from '../live'
import { hzToMidi, keyName, midiToName } from '../music'
import { Segmented, Select, Slider, Toggle } from './controls'

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const STORE_KEY = 'miszt.live'

/** Preferências do modo ao vivo guardadas neste computador. */
export function loadLive(): LiveSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<LiveSettings>
      const d = defaultLive()
      return { ...d, ...s, tune: { ...d.tune, ...s.tune }, eq: { ...d.eq, ...s.eq } }
    }
  } catch {
    // sem armazenamento: usa o padrão
  }
  return defaultLive()
}
function saveLive(s: LiveSettings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    // opcional
  }
}

const VOICE_PRESETS: { name: string; eq: LiveSettings['eq']; comp: boolean; reverb: number }[] = [
  { name: 'Natural', eq: { low: 0, mid: 0, high: 1 }, comp: true, reverb: 0.06 },
  { name: 'Karaokê', eq: { low: -2, mid: 1, high: 3 }, comp: true, reverb: 0.22 },
  { name: 'Rádio', eq: { low: 3, mid: 2, high: 2 }, comp: true, reverb: 0 },
  { name: 'Seco', eq: { low: 0, mid: 0, high: 0 }, comp: false, reverb: 0 },
]

interface Props {
  live: LiveVoice
  onClose: () => void
}

export function LiveMicDialog({ live, onClose }: Props) {
  const [s, setS] = useState<LiveSettings>(() => live.settings ?? loadLive())
  const [running, setRunning] = useState(live.running)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const [levels, setLevels] = useState({ input: 0, output: 0 })
  const [reading, setReading] = useState<LiveReading | null>(null)
  const raf = useRef(0)

  const cable = outputs.find((d) => /cable input/i.test(d.label))

  // Lista os dispositivos (os nomes só aparecem depois de liberar o microfone uma vez).
  useEffect(() => {
    const list = async () => {
      try {
        let devs = await navigator.mediaDevices.enumerateDevices()
        if (!devs.some((d) => d.label)) {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
          tmp.getTracks().forEach((t) => t.stop())
          devs = await navigator.mediaDevices.enumerateDevices()
        }
        setInputs(devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))
        setOutputs(devs.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setBlocked(true)
          setError('O Windows está bloqueando o microfone para programas da área de trabalho. Ative em Configurações → Privacidade → Microfone.')
        }
      }
    }
    void list()
    navigator.mediaDevices.addEventListener('devicechange', list)
    return () => navigator.mediaDevices.removeEventListener('devicechange', list)
  }, [])

  // Sugere o VB-CABLE como saída na primeira vez.
  useEffect(() => {
    if (cable && s.output === 'default' && !running) setS((cur) => ({ ...cur, output: cable.deviceId }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cable?.deviceId])

  useEffect(() => {
    live.onReading = setReading
    const off = live.subscribe(() => setRunning(live.running))
    const tick = () => {
      setLevels((l) => {
        const v = live.levels()
        return { input: Math.max(v.input, l.input * 0.88), output: Math.max(v.output, l.output * 0.88) }
      })
      raf.current = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf.current)
      live.onReading = null
      off()
    }
  }, [live])

  // Ajustes ao vivo (sem reiniciar) e memória das escolhas.
  const update = (patch: Partial<LiveSettings>) => {
    setS((cur) => {
      const next = { ...cur, ...patch }
      saveLive(next)
      if (live.running) live.apply(next)
      return next
    })
  }
  const tune = (patch: Partial<LiveSettings['tune']>) => update({ tune: { ...s.tune, ...patch } })

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await live.start(s)
      saveLive(s)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'O Windows está bloqueando o microfone para programas da área de trabalho. Ative em Configurações → Privacidade → Microfone.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'Microfone não encontrado. Escolha outro na lista.'
            : `Não foi possível ligar: ${err instanceof Error ? err.message : String(err)}`,
      )
      setBlocked(name === 'NotAllowedError')
    } finally {
      setBusy(false)
      setRunning(live.running)
    }
  }
  // Trocar de dispositivo exige religar.
  const changeDevice = (patch: Partial<LiveSettings>) => {
    const next = { ...s, ...patch }
    setS(next)
    saveLive(next)
    if (live.running) void live.start(next).catch((err) => setError(String(err instanceof Error ? err.message : err)))
  }

  const note = reading && reading.f0 > 0 ? midiToName(hzToMidi(reading.f0)) : '—'
  const target = reading && reading.target > 0 ? midiToName(hzToMidi(reading.target)) : '—'
  const cents = reading && reading.f0 > 0 && reading.target > 0 ? Math.round(1200 * Math.log2(reading.f0 / reading.target)) : null
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const outName = s.output === 'default' ? 'saída padrão do Windows' : (outputs.find((d) => d.deviceId === s.output)?.label ?? 'saída escolhida')

  return (
    <div className="modal-backdrop">
      <div className="modal live-dialog">
        <div className="export-head">
          <span className={`export-icon ${running ? 'recording' : ''}`}>
            <Radio size={20} />
          </span>
          <div>
            <h2>Microfone ao vivo</h2>
            <span className="dim">Sua voz com afinação e efeitos em tempo real, para jogos (VRChat), chamadas e lives</span>
          </div>
        </div>

        <div className="live-grid">
          <div className="live-col">
            <h3>Dispositivos</h3>
            <div className="field column">
              <label>
                <Mic size={13} /> Microfone
              </label>
              <Select value={s.input} options={[{ value: 'default', label: 'Padrão do Windows' }, ...inputs.map((d) => ({ value: d.deviceId, label: d.label || 'Microfone' }))]} onChange={(v) => changeDevice({ input: v })} />
              <div className="input-meter">
                <div className={levels.input > 0.95 ? 'clip' : ''} style={{ width: `${Math.round(Math.min(1, levels.input) * 100)}%` }} />
              </div>
            </div>
            <div className="field column">
              <label>
                <Radio size={13} /> Enviar a voz para
              </label>
              <Select value={s.output} options={[{ value: 'default', label: 'Saída padrão do Windows' }, ...outputs.map((d) => ({ value: d.deviceId, label: d.label || 'Saída' }))]} onChange={(v) => changeDevice({ output: v })} />
              <div className="input-meter">
                <div className={levels.output > 0.95 ? 'clip' : ''} style={{ width: `${Math.round(Math.min(1, levels.output) * 100)}%` }} />
              </div>
            </div>
            {cable ? (
              <p className="hint left live-hint">
                No VRChat (ou Discord), escolha <strong>CABLE Output</strong> como microfone. Mande a voz para <strong>CABLE Input</strong> aqui.
              </p>
            ) : (
              <div className="live-warn">
                <AlertTriangle size={15} />
                <div>
                  <strong>VB-CABLE não encontrado</strong>
                  <span>Instale o cabo de áudio virtual gratuito para que o jogo receba a voz processada.</span>
                  <button className="btn small" onClick={() => void window.api.openVbCable()}>
                    <ExternalLink size={13} /> Abrir o site do VB-CABLE
                  </button>
                </div>
              </div>
            )}
            <Toggle
              checked={s.monitor}
              onChange={(v) => {
                update({ monitor: v })
                if (live.running) void live.setMonitor(v, s.monitorOutput)
              }}
              label="Ouvir minha voz processada (retorno)"
            />
            {s.monitor && (
              <Select
                value={s.monitorOutput}
                options={[{ value: 'default', label: 'Saída padrão (fones)' }, ...outputs.filter((d) => d.deviceId !== s.output).map((d) => ({ value: d.deviceId, label: d.label || 'Saída' }))]}
                onChange={(v) => {
                  update({ monitorOutput: v })
                  if (live.running) void live.setMonitor(true, v)
                }}
              />
            )}
            <Toggle checked={s.noiseSuppression} onChange={(v) => changeDevice({ noiseSuppression: v })} label="Redução de ruído do microfone" />
          </div>

          <div className="live-col">
            <div className="live-tune-head">
              <h3>Afinação</h3>
              <Toggle checked={s.tune.enabled} onChange={(v) => tune({ enabled: v })} />
            </div>
            <div className="live-pitch">
              <div>
                <span className="dim">Você</span>
                <strong>{note}</strong>
              </div>
              <div className={`live-cents ${cents === null ? '' : Math.abs(cents) < 15 ? 'good' : 'off'}`}>{cents === null ? '' : `${cents > 0 ? '+' : ''}${cents}¢`}</div>
              <div>
                <span className="dim">Nota certa</span>
                <strong>{target}</strong>
              </div>
            </div>
            <label className="live-label">Tom da música · {s.tune.scale === 'chromatic' ? 'cromática (todas as notas)' : keyName(s.tune.key, s.tune.scale === 'minor' ? 'minor' : 'major')}</label>
            <div className="key-grid">
              {NOTES.map((n, i) => (
                <button key={n} className={s.tune.key === i && s.tune.scale !== 'chromatic' ? 'active' : ''} onClick={() => tune({ key: i, scale: s.tune.scale === 'chromatic' ? 'major' : s.tune.scale })}>
                  {n}
                </button>
              ))}
            </div>
            <Segmented
              value={s.tune.scale === 'minor' ? 'minor' : s.tune.scale === 'chromatic' ? 'chromatic' : 'major'}
              onChange={(v) => tune({ scale: v })}
              options={[
                { value: 'major', label: 'Maior' },
                { value: 'minor', label: 'Menor' },
                { value: 'chromatic', label: 'Cromática' },
              ]}
            />
            <Slider label="Velocidade da correção" value={s.tune.speed} min={0} max={1} format={pct} onChange={(v) => tune({ speed: v })} onReset={() => tune({ speed: 0.55 })} />
            <Slider label="Intensidade" value={s.tune.mix} min={0} max={1} format={pct} onChange={(v) => tune({ mix: v })} onReset={() => tune({ mix: 0.8 })} />
            <Slider label="Transpor" value={s.tune.transpose} min={-12} max={12} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v) => tune({ transpose: Math.round(v) })} onReset={() => tune({ transpose: 0 })} />

            <h3>Voz</h3>
            <div className="chip-row">
              {VOICE_PRESETS.map((p) => (
                <button key={p.name} className="chip" onClick={() => update({ eq: p.eq, comp: p.comp, reverb: p.reverb })}>
                  {p.name}
                </button>
              ))}
            </div>
            <Slider label="Graves" value={s.eq.low} min={-12} max={12} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => update({ eq: { ...s.eq, low: v } })} onReset={() => update({ eq: { ...s.eq, low: 0 } })} />
            <Slider label="Presença" value={s.eq.mid} min={-12} max={12} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => update({ eq: { ...s.eq, mid: v } })} onReset={() => update({ eq: { ...s.eq, mid: 0 } })} />
            <Slider label="Brilho" value={s.eq.high} min={-12} max={12} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => update({ eq: { ...s.eq, high: v } })} onReset={() => update({ eq: { ...s.eq, high: 0 } })} />
            <Slider label="Reverb" value={s.reverb} min={0} max={0.6} format={(v) => pct(v / 0.6)} onChange={(v) => update({ reverb: v })} onReset={() => update({ reverb: 0.12 })} />
            <Slider label="Volume de saída" value={s.gain} min={0} max={2} format={pct} onChange={(v) => update({ gain: v })} onReset={() => update({ gain: 1 })} />
            <Toggle checked={s.comp} onChange={(v) => update({ comp: v })} label="Compressor (volume mais constante)" />
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {blocked && (
          <button className="btn action-row" onClick={() => window.api.openMicSettings()}>
            <Settings size={15} /> Abrir as configurações de microfone do Windows
          </button>
        )}

        <div className="modal-actions spread">
          <span className="dim live-status">
            {running ? (
              <>
                <span className="rec-dot" /> Ao vivo para {outName} · atraso ≈ {live.latencyMs} ms
              </>
            ) : (
              <>
                <Headphones size={14} /> Use fones para o som do jogo não voltar pelo microfone
              </>
            )}
          </span>
          <div className="modal-actions-right">
            <button className="btn" onClick={onClose}>
              {running ? 'Minimizar' : 'Fechar'}
            </button>
            {running ? (
              <button className="btn danger" onClick={() => void live.stop()}>
                <Power size={15} /> Desligar
              </button>
            ) : (
              <button className="btn primary" onClick={() => void start()} disabled={busy}>
                <Power size={15} /> {busy ? 'Ligando…' : 'Ligar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
