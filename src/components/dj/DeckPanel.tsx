import { useEffect, useReducer, useRef, useState } from 'react'
import { Lock, LockOpen, Minus, Pause, Play, Plus, Repeat, RotateCcw, Split } from 'lucide-react'
import { CUE_COLORS, LOOP_SIZES, STEM_LABELS, type Deck } from '../../dj'
import { getPeaks, PEAKS_PER_SECOND } from '../../waveform'
import { formatTime } from '../../format'
import { keyName } from '../../music'
import { compatible, shiftCamelot } from './harmonic'
import { Knob } from './Knob'

interface Props {
  deck: Deck
  other: Deck
  onSeparate: (deck: Deck) => void
  separating: string | null
  /** Faixa arrastada da lista para o deck. */
  onDropRow: (deck: Deck, rowId: string) => void
}

const RANGES = [8, 16, 50]

export function DeckPanel({ deck, other, onSeparate, separating, onDropRow }: Props) {
  const [over, setOver] = useState(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [range, setRange] = useState(8)
  const [stemLevels, setStemLevels] = useState<number[]>([])
  const overview = useRef<HTMLCanvasElement>(null)
  const zoom = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const remainRef = useRef<HTMLSpanElement>(null)
  const peaks = useRef<Float32Array | null>(null)
  const track = deck.track

  useEffect(() => {
    const prev = deck.onChange
    deck.onChange = () => {
      prev?.()
      rerender()
    }
    return () => {
      deck.onChange = prev
    }
  }, [deck])

  useEffect(() => {
    peaks.current = null
    setStemLevels(deck.stems.map(() => 1))
    if (!track) return
    let alive = true
    void getPeaks(track.media).then((p) => {
      if (alive) peaks.current = p
    })
    return () => {
      alive = false
    }
    // Recarrega quando muda a mídia ou a quantidade de stems.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.media.id, deck.stems.length])

  // Desenho contínuo das duas formas de onda.
  useEffect(() => {
    let raf = 0
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2bd3c0'
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const t = deck.time
      const dur = deck.duration || 1
      if (timeRef.current) timeRef.current.textContent = track ? formatTime(t, false) : ''
      if (remainRef.current) remainRef.current.textContent = track ? `-${formatTime(Math.max(0, dur - t), false)}` : ''
      const p = peaks.current
      for (const [canvas, isZoom] of [
        [overview.current, false],
        [zoom.current, true],
      ] as const) {
        if (!canvas) continue
        const W = canvas.clientWidth * devicePixelRatio
        const H = canvas.clientHeight * devicePixelRatio
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W
          canvas.height = H
        }
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, W, H)
        if (!p || !track) continue
        // Janela visível em segundos da mídia.
        const span = isZoom ? 6 * (deck.rate || 1) : dur
        const from = isZoom ? t - span / 2 : 0
        const toX = (sec: number) => ((sec - from) / span) * W
        if (deck.loop) {
          ctx.fillStyle = 'rgba(43, 211, 192, 0.14)'
          ctx.fillRect(toX(deck.loop.start), 0, toX(deck.loop.end) - toX(deck.loop.start), H)
        }
        const mid = H / 2
        for (let x = 0; x < W; x++) {
          const s0 = from + (x / W) * span
          const s1 = from + ((x + 1) / W) * span
          if (s1 < 0 || s0 > dur) continue
          const i0 = Math.max(0, Math.floor(s0 * PEAKS_PER_SECOND))
          const i1 = Math.min(p.length, Math.max(i0 + 1, Math.ceil(s1 * PEAKS_PER_SECOND)))
          let m = 0
          for (let i = i0; i < i1; i++) if (p[i] > m) m = p[i]
          const h = Math.max(1, m * mid * 0.95)
          ctx.fillStyle = s0 < t ? (isZoom ? '#5f6b7d' : '#4b5566') : accent
          ctx.fillRect(x, mid - h, 1, h * 2)
        }
        // Grade de batidas no zoom (compasso mais forte).
        if (isZoom && deck.beatLen) {
          const bl = deck.beatLen
          const first = Math.ceil((from - track.offset) / bl)
          for (let b = first; track.offset + b * bl < from + span; b++) {
            const x = toX(track.offset + b * bl)
            ctx.fillStyle = b % 4 === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)'
            ctx.fillRect(x, 0, b % 4 === 0 ? 2 : 1, H)
          }
        }
        deck.hotcues.forEach((c, i) => {
          if (!c) return
          const x = toX(c.time)
          ctx.fillStyle = c.color ?? CUE_COLORS[i]
          ctx.fillRect(x - 1, 0, 2, H)
          ctx.beginPath()
          ctx.moveTo(x - 5, 0)
          ctx.lineTo(x + 5, 0)
          ctx.lineTo(x, 7)
          ctx.fill()
        })
        // Cursor: no centro do zoom; na posição atual da visão geral.
        ctx.fillStyle = '#ff4d4d'
        ctx.fillRect(isZoom ? W / 2 - 1 : toX(t) - 1, 0, 2, H)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [deck, track])

  const seekFromOverview = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    deck.seek(((e.clientX - r.left) / r.width) * deck.duration)
  }

  const pct = (deck.rate - 1) * 100
  const k = track?.key
  const shifted = k ? shiftCamelot(k, deck.pitchShift) : null
  const otherKey = other.track?.key ? shiftCamelot(other.track.key, other.pitchShift) : null
  const match = shifted && otherKey ? compatible(shifted.camelot, otherKey.camelot) : null

  return (
    <div
      className={`deck deck-${deck.id.toLowerCase()} ${deck.playing ? 'is-playing' : ''} ${over ? 'drop' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/miszt-dj')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const id = e.dataTransfer.getData('text/miszt-dj')
        if (id) onDropRow(deck, id)
      }}
    >
      <div className="deck-head">
        <span className="deck-letter">{deck.id}</span>
        <div className="deck-title">
          <strong className="ellipsis">{track ? track.media.name.replace(/\.[^.]+$/, '') : 'Arraste uma faixa ou use os botões A / B na lista'}</strong>
          <span className="ellipsis">{track ? [track.key ? keyName(shifted!.key, shifted!.mode) : 'Tom ?', formatTime(deck.duration, false)].join(' · ') : ''}</span>
        </div>
        {shifted && (
          <span className={`camelot ${match === true ? 'good' : match === false ? 'bad' : ''}`} data-tip={match === null ? 'Tom da faixa' : match ? 'Combina com o outro deck' : 'Tom não combina com o outro deck'} data-tip-pos="bottom">
            {shifted.camelot}
          </span>
        )}
        <div className="deck-bpm">
          <strong>{deck.bpm ? deck.bpm.toFixed(1) : '—'}</strong>
          <span>{track?.bpm ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : 'BPM'}</span>
        </div>
      </div>

      <canvas ref={zoom} className="deck-zoom" onWheel={(e) => deck.seek(deck.time + Math.sign(e.deltaY) * (deck.beatLen || 0.25))} />
      <canvas ref={overview} className="deck-overview" onPointerDown={seekFromOverview} />
      <div className="deck-times">
        <span ref={timeRef}>0:00</span>
        <span ref={remainRef}>-0:00</span>
      </div>

      <div className="deck-transport">
        <button className="deck-btn cue" onClick={() => deck.cue()} disabled={!track} data-tip="Parado: marca o ponto · Tocando: volta e para">
          CUE
        </button>
        <button className={`deck-btn play ${deck.playing ? 'on' : ''}`} onClick={() => deck.toggle()} disabled={!track}>
          {deck.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className="deck-btn" onClick={() => deck.sync(other)} disabled={!track?.bpm || !other.bpm} data-tip="Igualar o BPM e alinhar as batidas com o outro deck">
          SYNC
        </button>
        <button className={`deck-btn icon ${deck.keylock ? 'on' : ''}`} onClick={() => deck.setKeylock(!deck.keylock)} data-tip={deck.keylock ? 'Trava de tom ligada: o tom não muda com o andamento' : 'Trava de tom desligada: acelerar sobe o tom'}>
          {deck.keylock ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
        <div className="deck-nudge">
          <button className="deck-btn icon" onPointerDown={() => deck.setBend(-1)} onPointerUp={() => deck.setBend(0)} onPointerLeave={() => deck.setBend(0)} data-tip="Segurar: atrasa um pouco">
            <Minus size={15} />
          </button>
          <button className="deck-btn icon" onPointerDown={() => deck.setBend(1)} onPointerUp={() => deck.setBend(0)} onPointerLeave={() => deck.setBend(0)} data-tip="Segurar: adianta um pouco">
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="deck-tempo">
        <input type="range" min={-range} max={range} step={0.05} value={Math.max(-range, Math.min(range, pct))} onChange={(e) => deck.setRate(1 + Number(e.target.value) / 100)} />
        <button className="chip" onClick={() => setRange(RANGES[(RANGES.indexOf(range) + 1) % RANGES.length])} data-tip="Faixa do andamento">
          ±{range}%
        </button>
        <button className="icon-btn" onClick={() => deck.setRate(1)} data-tip="Andamento original">
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="deck-pads">
        {deck.hotcues.map((c, i) => (
          <button
            key={i}
            className={`pad ${c ? 'set' : ''}`}
            style={c ? { ['--pad' as string]: c.color ?? CUE_COLORS[i] } : undefined}
            onClick={() => deck.hotcue(i)}
            onContextMenu={(e) => {
              e.preventDefault()
              deck.clearHotcue(i)
            }}
            disabled={!track}
            title={c ? `${c.name || `Hot cue ${i + 1}`} · ${formatTime(c.time, false)} (botão direito apaga)` : `Marcar hot cue ${i + 1}`}
          >
            {c?.name ? c.name.slice(0, 8) : i + 1}
          </button>
        ))}
      </div>

      <div className="deck-loops">
        <Repeat size={14} />
        {LOOP_SIZES.map((b) => (
          <button key={b} className={`chip ${deck.loop?.beats === b ? 'active' : ''}`} onClick={() => deck.setLoop(deck.loop?.beats === b ? null : b)} disabled={!track?.bpm}>
            {b === 0.5 ? '½' : b}
          </button>
        ))}
        {deck.loop && (
          <button className="chip" onClick={() => deck.setLoop(null)}>
            Sair
          </button>
        )}
      </div>

      <div className="deck-stems">
        {deck.stems.length ? (
          deck.stems.map((s, i) => (
            <Knob
              key={s.name}
              label={STEM_LABELS[s.name] ?? s.name}
              value={stemLevels[i] ?? 1}
              min={0}
              max={1}
              center={1}
              size={38}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => {
                deck.setStem(i, v)
                setStemLevels((l) => l.map((x, j) => (j === i ? v : x)))
              }}
            />
          ))
        ) : (
          <button className="btn small" onClick={() => onSeparate(deck)} disabled={!track || !!separating}>
            <Split size={14} /> {separating ?? 'Separar stems (voz, bateria, baixo…)'}
          </button>
        )}
      </div>
    </div>
  )
}
