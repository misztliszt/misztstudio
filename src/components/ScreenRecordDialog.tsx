import { useEffect, useRef, useState } from 'react'
import { AppWindow, Monitor, MonitorPlay, RefreshCw, Settings, Square } from 'lucide-react'
import type { CaptureSource, ProbeResult } from '../types'
import { formatTime } from '../format'
import { Segmented, Select, Toggle } from './controls'

type Part = 'video' | 'system' | 'mic'
export type ScreenRecording = { dir: string; video?: ProbeResult; system?: ProbeResult; mic?: ProbeResult }

interface Props {
  /** Instante da timeline onde a gravação entra. */
  at: number
  onDone: (result: ScreenRecording, at: number) => void
  onClose: () => void
}

const STOP_KEY = 'Ctrl+Shift+F9'

/** H.264 primeiro (vira MP4 sem recompressão e toca leve na prévia); VP9/VP8 se não houver. */
const videoMime = () => ['video/mp4;codecs=avc1.640028', 'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'

const micError = (err: unknown) => {
  const name = err instanceof DOMException ? err.name : ''
  return name === 'NotAllowedError'
    ? 'O Windows está bloqueando o microfone para programas da área de trabalho. Ative em Configurações → Privacidade → Microfone, ou grave sem o microfone.'
    : name === 'NotFoundError'
      ? 'Nenhum microfone encontrado.'
      : 'Não foi possível acessar o microfone.'
}

/** Grava a tela (ou uma janela), o áudio do sistema e o microfone em arquivos separados, como no OBS. */
export function ScreenRecordDialog({ at, onDone, onClose }: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [kind, setKind] = useState<'screen' | 'window'>('screen')
  const [source, setSource] = useState<string | null>(null)
  const [systemAudio, setSystemAudio] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [device, setDevice] = useState('default')
  const [fps, setFps] = useState<'30' | '60'>('30')
  const [minimize, setMinimize] = useState(true)
  const [level, setLevel] = useState(0)
  const [state, setState] = useState<'idle' | 'count' | 'rec' | 'saving'>('idle')
  const [count, setCount] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [micBlocked, setMicBlocked] = useState(false)
  const mic = useRef<MediaStream | null>(null)
  const display = useRef<MediaStream | null>(null)
  const recorders = useRef<MediaRecorder[]>([])
  const job = useRef<string | null>(null)
  const stopRef = useRef<() => void>(() => {})

  const loadSources = () =>
    window.api.screenSources().then((list) => {
      setSources(list)
      setSource((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list.find((s) => s.kind === 'screen')?.id ?? list[0]?.id ?? null)))
    })
  useEffect(() => {
    void loadSources()
  }, [])

  // Microfone escolhido + medidor de nível.
  useEffect(() => {
    if (!micOn) return
    let alive = true
    let raf = 0
    let ctx: AudioContext | null = null
    setError(null)
    setMicBlocked(false)
    void (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: device === 'default' ? undefined : { exact: device }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        mic.current = s
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'))
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
        setError(micError(err))
        setMicBlocked(err instanceof DOMException && err.name === 'NotAllowedError')
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      void ctx?.close()
      mic.current?.getTracks().forEach((t) => t.stop())
      mic.current = null
      setLevel(0)
    }
  }, [device, micOn])

  useEffect(() => {
    if (state !== 'rec') return
    const t0 = performance.now()
    const id = setInterval(() => setElapsed((performance.now() - t0) / 1000), 200)
    return () => clearInterval(id)
  }, [state])

  // Atalho global para parar com o app minimizado.
  useEffect(() => window.api.onScreenStop(() => stopRef.current()), [])
  useEffect(
    () => () => {
      // Fechou no meio (ou desmontou): solta tudo e apaga os pedaços.
      recorders.current.forEach((r) => r.state !== 'inactive' && r.stop())
      display.current?.getTracks().forEach((t) => t.stop())
      void window.api.screenHotkey(false)
      if (job.current) void window.api.screenDiscard(job.current)
    },
    [],
  )

  const start = async () => {
    if (!source) return
    setError(null)
    let stream: MediaStream
    try {
      await window.api.screenSelect(source, systemAudio)
      const rate = Number(fps)
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: rate, max: rate } }, audio: systemAudio })
    } catch (err) {
      setError(`Não foi possível capturar a tela: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    display.current = stream
    const vMime = videoMime()
    const aMime = 'audio/webm;codecs=opus'
    const tracks: { key: Part; stream: MediaStream; mime: string; bits: number }[] = [{ key: 'video', stream: new MediaStream(stream.getVideoTracks()), mime: vMime, bits: fps === '60' ? 16_000_000 : 10_000_000 }]
    if (stream.getAudioTracks().length) tracks.push({ key: 'system', stream: new MediaStream(stream.getAudioTracks()), mime: aMime, bits: 256_000 })
    if (micOn && mic.current) tracks.push({ key: 'mic', stream: mic.current, mime: aMime, bits: 256_000 })
    const id = await window.api.screenBegin(tracks.map((t) => ({ key: t.key, mime: t.mime })))
    job.current = id

    setState('count')
    setCount(3)
    for (let n = 3; n > 0; n--) {
      setCount(n)
      await new Promise((r) => setTimeout(r, 1000))
    }
    // Cada fonte num gravador próprio; os pedaços vão em ordem para o disco.
    const writes: Promise<void>[] = []
    recorders.current = tracks.map((t) => {
      const rec = new MediaRecorder(t.stream, t.key === 'video' ? { mimeType: t.mime, videoBitsPerSecond: t.bits } : { mimeType: t.mime, audioBitsPerSecond: t.bits })
      let chain = Promise.resolve()
      rec.ondataavailable = (e) => {
        if (!e.data.size) return
        chain = chain.then(async () => window.api.screenChunk(id, t.key, await e.data.arrayBuffer()))
        writes.push(chain)
      }
      return rec
    })
    recorders.current.forEach((r) => r.start(1000))
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopRef.current())
    await window.api.screenHotkey(true)
    if (minimize) await window.api.screenMinimize(true)
    setState('rec')

    stopRef.current = async () => {
      stopRef.current = () => {}
      setState('saving')
      await window.api.screenHotkey(false)
      await window.api.screenMinimize(false)
      await Promise.all(recorders.current.map((r) => (r.state === 'inactive' ? null : new Promise((res) => ((r.onstop = res), r.stop())))))
      recorders.current = []
      stream.getTracks().forEach((t) => t.stop())
      display.current = null
      try {
        await Promise.all(writes)
        const result = await window.api.screenFinish(id)
        job.current = null
        onDone(result, at)
      } catch (err) {
        setError(String(err instanceof Error ? err.message : err))
        setState('idle')
      }
    }
  }

  const list = (sources ?? []).filter((s) => s.kind === kind)
  const meter = Math.min(1, level)
  const busy = state !== 'idle'
  return (
    <div className="modal-backdrop">
      <div className="modal screen-dialog">
        <div className="export-head">
          <span className={`export-icon ${state === 'rec' ? 'recording' : ''}`}>
            <MonitorPlay size={20} />
          </span>
          <div>
            <h2>Gravar tela</h2>
            <span className="dim">Vídeo, áudio do sistema e microfone em trilhas separadas · entra em {formatTime(at)}</span>
          </div>
        </div>

        {state === 'idle' && (
          <>
            <div className="screen-tabs">
              <Segmented
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'screen', label: 'Tela', icon: Monitor },
                  { value: 'window', label: 'Janela', icon: AppWindow },
                ]}
              />
              <button className="btn ghost small" onClick={() => void loadSources()}>
                <RefreshCw size={13} /> Atualizar
              </button>
            </div>
            <div className="source-grid">
              {!sources && <p className="dim">Procurando telas e janelas…</p>}
              {sources && !list.length && <p className="dim">Nenhuma {kind === 'screen' ? 'tela' : 'janela'} encontrada.</p>}
              {list.map((s) => (
                <button key={s.id} className={`source-card ${source === s.id ? 'active' : ''}`} onClick={() => setSource(s.id)} title={s.name}>
                  {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <span className="source-empty" />}
                  <span className="ellipsis">{s.name}</span>
                </button>
              ))}
            </div>

            <div className="screen-options">
              <Toggle checked={systemAudio} onChange={setSystemAudio} label="Áudio do sistema (jogo, música, navegador)" />
              <Toggle checked={micOn} onChange={setMicOn} label="Microfone" />
              {micOn && (
                <>
                  <Select value={device} options={[{ value: 'default', label: 'Padrão do Windows' }, ...devices.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label || 'Microfone' }))]} onChange={setDevice} />
                  <div className="input-meter">
                    <div className={meter > 0.95 ? 'clip' : ''} style={{ width: `${Math.round(meter * 100)}%` }} />
                  </div>
                </>
              )}
              <div className="screen-row">
                <span className="dim">Quadros por segundo</span>
                <Segmented
                  value={fps}
                  onChange={setFps}
                  options={[
                    { value: '30', label: '30' },
                    { value: '60', label: '60' },
                  ]}
                />
              </div>
              <Toggle checked={minimize} onChange={setMinimize} label={`Minimizar o Miszt Studio enquanto grava (pare com ${STOP_KEY})`} />
            </div>
          </>
        )}

        {busy && (
          <div className="record-center tall">
            {state === 'count' && <span className="countdown">{count}</span>}
            {state === 'rec' && (
              <>
                <span className="rec-time">
                  <span className="rec-dot" /> {formatTime(elapsed)}
                </span>
                <span className="dim">Pare aqui ou com {STOP_KEY}, de qualquer programa</span>
              </>
            )}
            {state === 'saving' && <span className="dim">Salvando os arquivos…</span>}
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {micBlocked && state === 'idle' && (
          <button className="btn action-row" onClick={() => window.api.openMicSettings()}>
            <Settings size={15} /> Abrir as configurações de microfone do Windows
          </button>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={state === 'rec' || state === 'saving'}>
            Fechar
          </button>
          {state === 'rec' ? (
            <button className="btn danger" onClick={() => stopRef.current()}>
              <Square size={14} fill="currentColor" /> Parar
            </button>
          ) : (
            <button className="btn primary" onClick={() => void start()} disabled={busy || !source}>
              <MonitorPlay size={15} /> Gravar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
