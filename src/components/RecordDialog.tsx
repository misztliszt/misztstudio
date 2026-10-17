import { useEffect, useRef, useState } from 'react'
import { Mic, Settings, Square } from 'lucide-react'
import type { ProbeResult } from '../types'
import { formatTime } from '../format'
import { Select, Toggle } from './controls'

interface Props {
  /** Instante da timeline onde a gravação começa. */
  at: number
  /** Toca a timeline junto (para gravar narração por cima do vídeo). */
  onPlay: (playing: boolean) => void
  onDone: (result: ProbeResult, at: number) => void
  onClose: () => void
}

/** Grava o microfone com contagem regressiva, tocando a timeline junto se desejado. */
export function RecordDialog({ at, onPlay, onDone, onClose }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [device, setDevice] = useState('default')
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<'idle' | 'count' | 'rec' | 'saving'>('idle')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [withTimeline, setWithTimeline] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  // Abre o microfone escolhido e mostra o nível de entrada.
  useEffect(() => {
    let alive = true
    let raf = 0
    let ctx: AudioContext | null = null
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: device === 'default' ? undefined : { exact: device }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
        setDevices(list)
        ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        ctx.createMediaStreamSource(s).connect(an)
        const buf = new Float32Array(an.fftSize)
        const tick = () => {
          an.getFloatTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v))
          setLevel((l) => Math.max(peak, l * 0.9))
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'O Windows está bloqueando o microfone para programas da área de trabalho. Em Configurações → Privacidade → Microfone, ative "Permitir que aplicativos da área de trabalho acessem o microfone" e abra esta janela de novo.'
            : name === 'NotFoundError'
              ? 'Nenhum microfone encontrado.'
              : 'Não foi possível acessar o microfone.',
        )
        setBlocked(name === 'NotAllowedError')
        console.error(err)
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      void ctx?.close()
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [device])

  useEffect(() => {
    if (state !== 'rec') return
    const t0 = performance.now()
    const id = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100)
    return () => clearInterval(id)
  }, [state])

  const start = () => {
    if (!stream.current) return
    setState('count')
    setCount(3)
    let n = 3
    const id = setInterval(() => {
      n--
      if (n > 0) setCount(n)
      else {
        clearInterval(id)
        chunks.current = []
        const rec = new MediaRecorder(stream.current!, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 })
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
        rec.start(250)
        recorder.current = rec
        if (withTimeline) onPlay(true)
        setState('rec')
      }
    }, 1000)
  }

  const stop = () => {
    const rec = recorder.current
    if (!rec) return
    onPlay(false)
    setState('saving')
    rec.onstop = async () => {
      try {
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        const result = await window.api.saveRecording(await blob.arrayBuffer())
        onDone(result, at)
      } catch (err) {
        setError(String(err))
        setState('idle')
      }
    }
    rec.stop()
  }

  const meter = Math.min(1, level)
  return (
    <div className="modal-backdrop">
      <div className="modal record-dialog">
        <div className="export-head">
          <span className={`export-icon ${state === 'rec' ? 'recording' : ''}`}>
            <Mic size={20} />
          </span>
          <div>
            <h2>Gravar áudio</h2>
            <span className="dim">Começa em {formatTime(at)} na timeline</span>
          </div>
        </div>
        <div className="field column">
          <label>Microfone</label>
          <Select value={device} disabled={state !== 'idle'} options={[{ value: 'default', label: 'Padrão do Windows' }, ...devices.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Microfone' }))]} onChange={setDevice} />
        </div>
        <div className="input-meter">
          <div className={meter > 0.95 ? 'clip' : ''} style={{ width: `${Math.round(meter * 100)}%` }} />
        </div>
        <div className="toggle-row" style={{ marginTop: 12 }}>
          <Toggle checked={withTimeline} onChange={setWithTimeline} label="Tocar a timeline enquanto grava (use fones)" />
        </div>
        <div className="record-center">
          {state === 'count' && <span className="countdown">{count}</span>}
          {state === 'rec' && (
            <span className="rec-time">
              <span className="rec-dot" /> {formatTime(elapsed)}
            </span>
          )}
          {state === 'saving' && <span className="dim">Salvando…</span>}
        </div>
        {error && <p className="error">{error}</p>}
        {blocked && (
          <button className="btn action-row" onClick={() => window.api.openMicSettings()}>
            <Settings size={15} /> Abrir as configurações de microfone do Windows
          </button>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={state === 'rec' || state === 'saving'}>
            Fechar
          </button>
          {state === 'rec' ? (
            <button className="btn danger" onClick={stop}>
              <Square size={14} fill="currentColor" /> Parar
            </button>
          ) : (
            <button className="btn primary" onClick={start} disabled={state !== 'idle' || !!error}>
              <Mic size={15} /> Gravar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
