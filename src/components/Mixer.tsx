import { useEffect, useRef } from 'react'
import type { Action } from '../store'
import type { PlaybackEngine } from '../engine'
import type { Project, Track } from '../types'
import { SHORT_NAMES } from '../music'
import { SlidersHorizontal, Volume2, VolumeX } from 'lucide-react'

const MIN_DB = -60
const MAX_DB = 20 * Math.log10(1.5)
const TICKS = [3, 0, -6, -12, -24, -48]
const toPos = (v: number) => (v <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(v) - MIN_DB) / (MAX_DB - MIN_DB))))
const fromPos = (p: number) => (p <= 0.002 ? 0 : Math.min(1.5, Math.pow(10, (MIN_DB + p * (MAX_DB - MIN_DB)) / 20)))

/** Fader vertical em escala de dB, com marcas de referência. Duplo clique volta a 0 dB. */
function Fader({ value, onChange, onStart, onReset }: { value: number; onChange: (v: number) => void; onStart: () => void; onReset: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = (clientY: number) => {
    const r = ref.current!.getBoundingClientRect()
    onChange(fromPos(1 - (clientY - r.top) / r.height))
  }
  return (
    <div
      className="fader"
      ref={ref}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onStart()
        set(e.clientY)
      }}
      onPointerMove={(e) => e.buttons === 1 && set(e.clientY)}
    >
      {TICKS.map((db) => (
        <span key={db} className="fader-tick" style={{ bottom: `${toPos(Math.pow(10, db / 20)) * 100}%` }}>
          {db > 0 ? `+${db}` : db}
        </span>
      ))}
      <div className="fader-rail" />
      <div className="fader-cap" style={{ bottom: `${toPos(value) * 100}%` }} />
    </div>
  )
}

interface Props {
  project: Project
  engine: PlaybackEngine
  selectedTrack: string | null
  onSelectTrack: (id: string) => void
  dispatch: (a: Action, merge?: boolean) => void
  checkpoint: () => void
}

/** Converte pico linear em altura do medidor (escala de −60 a +6 dB). */
const meterHeight = (peak: number) => {
  if (peak <= 0) return 0
  const db = 20 * Math.log10(peak)
  return Math.max(0, Math.min(1, (db + 60) / 66))
}

export function Mixer({ project, engine, selectedTrack, onSelectTrack, dispatch, checkpoint }: Props) {
  const meters = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    let raf = 0
    const held = new Map<string, number>()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const { master, tracks } = engine.audio.levels()
      const all: Record<string, number> = { ...tracks, master }
      for (const [id, el] of meters.current) {
        // Queda suave do medidor.
        const v = Math.max(meterHeight(all[id] ?? 0), (held.get(id) ?? 0) - 0.015)
        held.set(id, v)
        el.style.height = `${v * 100}%`
        el.classList.toggle('clip', (all[id] ?? 0) >= 1)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  const bind = (id: string) => (el: HTMLDivElement | null) => {
    if (el) meters.current.set(id, el)
    else meters.current.delete(id)
  }

  return (
    <div className="mixer">
      {project.tracks.map((t) => (
        <Strip key={t.id} track={t} selected={selectedTrack === t.id} meterRef={bind(t.id)} onSelect={() => onSelectTrack(t.id)} dispatch={dispatch} checkpoint={checkpoint} />
      ))}
      <div className="strip master">
        <div className="strip-name">Master</div>
        <div className="strip-body">
          <div className="meter">
            <div className="meter-fill" ref={bind('master')} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Strip({ track, selected, meterRef, onSelect, dispatch, checkpoint }: { track: Track; selected: boolean; meterRef: (el: HTMLDivElement | null) => void; onSelect: () => void; dispatch: Props['dispatch']; checkpoint: () => void }) {
  const fx = track.fx
  const badges: string[] = []
  if (fx.autotune.enabled) badges.push(`Afin. ${SHORT_NAMES[fx.autotune.key]}`)
  if (fx.transpose) badges.push(`${fx.transpose > 0 ? '+' : ''}${fx.transpose} st`)
  if (fx.eq.low || fx.eq.mid || fx.eq.high) badges.push('EQ')
  if (fx.comp.enabled) badges.push('Comp')
  if (fx.reverb.mix > 0) badges.push('Rev')
  if (fx.duck?.enabled) badges.push('Duck')
  return (
    <div className={`strip ${selected ? 'selected' : ''} ${track.kind}`}>
      <button className="strip-name" onClick={onSelect} title="Abrir efeitos da trilha">
        {track.name}
      </button>
      <div className="badges">
        {badges.map((b) => (
          <span key={b} className="badge">
            {b}
          </span>
        ))}
        <button className="badge add" onClick={onSelect}>
          <SlidersHorizontal size={10} /> FX
        </button>
      </div>
      <div className="pan-row" data-tip={Math.abs(fx.pan) < 0.01 ? 'Pan: centro' : `Pan: ${fx.pan < 0 ? 'E' : 'D'} ${Math.round(Math.abs(fx.pan) * 100)}`} data-tip-pos="top">
        <span>E</span>
        <input
          className="range mini"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={fx.pan}
          style={{ ['--from' as string]: `${Math.min(50, (fx.pan + 1) * 50)}%`, ['--to' as string]: `${Math.max(50, (fx.pan + 1) * 50)}%` }}
          onPointerDown={checkpoint}
          onDoubleClick={() => dispatch({ type: 'updateTrack', id: track.id, patch: { fx: { ...fx, pan: 0 } } })}
          onChange={(e) => dispatch({ type: 'updateTrack', id: track.id, patch: { fx: { ...fx, pan: Number(e.target.value) } } }, true)}
        />
        <span>D</span>
      </div>
      <div className="strip-body">
        <Fader value={track.volume} onStart={checkpoint} onChange={(v) => dispatch({ type: 'updateTrack', id: track.id, patch: { volume: v } }, true)} onReset={() => dispatch({ type: 'updateTrack', id: track.id, patch: { volume: 1 } })} />
        <div className="meter">
          <div className="meter-fill" ref={meterRef} />
        </div>
      </div>
      <div className="strip-value">{track.volume === 0 ? '−∞' : `${(20 * Math.log10(track.volume)).toFixed(1)} dB`}</div>
      <button
        className={`track-toggle ${track.muted ? 'off' : ''}`}
        data-tip={track.muted ? 'Ativar som' : 'Silenciar'}
        data-tip-pos="top"
        onClick={() => dispatch({ type: 'updateTrack', id: track.id, patch: { muted: !track.muted } })}
      >
        {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  )
}
