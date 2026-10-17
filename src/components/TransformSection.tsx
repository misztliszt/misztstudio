import { ChevronLeft, ChevronRight, Diamond, Gauge, Move, RotateCcw, Scaling, Crop } from 'lucide-react'
import { keyAt, removeKey, setPropPatch, upsertKey, valueAt } from '../anim'
import type { Action } from '../store'
import type { AnimProp, Clip, Ease } from '../types'
import { defaultTransform } from '../anim'
import { Section, Select, Slider } from './controls'

interface Props {
  clip: Clip
  time: number
  dispatch: (a: Action, merge?: boolean) => void
  checkpoint: () => void
  onSeek: (t: number) => void
}

const PROPS: { prop: AnimProp; label: string; min: number; max: number; step: number; format: (v: number) => string; bipolar?: boolean; reset: number }[] = [
  { prop: 'x', label: 'Posição X', min: -1, max: 1, step: 0.001, format: (v) => `${Math.round(v * 100)}%`, bipolar: true, reset: 0 },
  { prop: 'y', label: 'Posição Y', min: -1, max: 1, step: 0.001, format: (v) => `${Math.round(v * 100)}%`, bipolar: true, reset: 0 },
  { prop: 'scale', label: 'Escala', min: 0.05, max: 4, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, reset: 1 },
  { prop: 'rotation', label: 'Rotação', min: -180, max: 180, step: 0.5, format: (v) => `${v.toFixed(1)}°`, bipolar: true, reset: 0 },
  { prop: 'opacity', label: 'Opacidade', min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%`, reset: 1 },
]

const EASES: { value: Ease; label: string }[] = [
  { value: 'ease', label: 'Suave' },
  { value: 'linear', label: 'Linear' },
  { value: 'hold', label: 'Segurar' },
]

export function TransformSection({ clip, time, dispatch, checkpoint, onSeek }: Props) {
  const local = Math.max(0, Math.min(clip.duration, time - clip.start))
  const inside = time >= clip.start && time <= clip.start + clip.duration
  const set = (patch: Partial<Clip>, merge = false) => dispatch({ type: 'updateClip', id: clip.id, patch }, merge)
  const animated = PROPS.some((p) => clip.keyframes[p.prop]?.length)

  // Keyframes de qualquer propriedade, para navegar entre eles.
  const allTimes = [...new Set(PROPS.flatMap((p) => (clip.keyframes[p.prop] ?? []).map((k) => k.t)))].sort((a, b) => a - b)
  const prevKey = [...allTimes].reverse().find((t) => t < local - 1e-3)
  const nextKey = allTimes.find((t) => t > local + 1e-3)
  const easeHere = PROPS.map((p) => keyAt(clip, p.prop, local)).find(Boolean)?.ease

  const toggleKey = (prop: AnimProp) => {
    const keys = clip.keyframes[prop]
    const here = keyAt(clip, prop, local)
    const next = here ? removeKey(keys, here.t) : upsertKey(keys, local, valueAt(clip, prop, local))
    const keyframes = { ...clip.keyframes, [prop]: next }
    // Ao remover o último keyframe, o valor animado vira o valor fixo.
    if (!next.length) set({ keyframes, transform: { ...clip.transform, [prop]: valueAt(clip, prop, local) } })
    else set({ keyframes })
  }

  const setEase = (ease: Ease) => {
    const keyframes = { ...clip.keyframes }
    for (const p of PROPS) {
      const keys = keyframes[p.prop]
      if (keys) keyframes[p.prop] = keys.map((k) => (Math.abs(k.t - local) < 1 / 120 ? { ...k, ease } : k))
    }
    set({ keyframes })
  }

  const reset = () => set({ transform: { ...defaultTransform(), crop: clip.transform.crop }, keyframes: {} })

  return (
    <>
      <Section
        title="Transformar"
        icon={Move}
        right={
          <div className="key-nav">
            <button className="icon-btn" disabled={prevKey === undefined} onClick={() => prevKey !== undefined && onSeek(clip.start + prevKey)} data-tip="Keyframe anterior" data-tip-pos="left">
              <ChevronLeft size={14} />
            </button>
            <button className="icon-btn" disabled={nextKey === undefined} onClick={() => nextKey !== undefined && onSeek(clip.start + nextKey)} data-tip="Próximo keyframe" data-tip-pos="left">
              <ChevronRight size={14} />
            </button>
            <button className="icon-btn" onClick={reset} data-tip="Restaurar" data-tip-pos="left">
              <RotateCcw size={13} />
            </button>
          </div>
        }
      >
        {!inside && animated && <p className="hint">Mova o cursor para dentro do clipe para editar os keyframes.</p>}
        {PROPS.map((p) => {
          const keys = clip.keyframes[p.prop]
          const has = !!keys?.length
          const here = keyAt(clip, p.prop, local)
          return (
            <div key={p.prop} className="keyed-slider">
              <Slider
                label={p.label}
                bipolar={p.bipolar}
                value={valueAt(clip, p.prop, local)}
                min={p.min}
                max={p.max}
                step={p.step}
                format={p.format}
                onStart={checkpoint}
                onChange={(v) => set(setPropPatch(clip, p.prop, v, local), true)}
                onReset={() => set(setPropPatch(clip, p.prop, p.reset, local))}
              />
              <button
                className={`key-btn ${here ? 'on' : has ? 'has' : ''}`}
                onClick={() => toggleKey(p.prop)}
                disabled={!inside}
                data-tip={here ? 'Remover keyframe' : 'Adicionar keyframe no cursor'}
                data-tip-pos="left"
                aria-label="Keyframe"
              >
                <Diamond size={12} strokeWidth={2.4} />
              </button>
            </div>
          )
        })}
        {easeHere && (
          <div className="field">
            <label>Curva a partir deste keyframe</label>
            <Select value={easeHere} options={EASES} onChange={setEase} />
          </div>
        )}
        <p className="hint">Arraste o clipe na prévia para mover; use os cantos para escalar e a alça de cima para girar.</p>
      </Section>

      <Section title="Corte" icon={Crop} right={<button className="icon-btn" onClick={() => set({ transform: { ...clip.transform, crop: { left: 0, top: 0, right: 0, bottom: 0 } } })} data-tip="Sem corte" data-tip-pos="left"><RotateCcw size={13} /></button>}>
        <div className="field-grid">
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <Slider
              key={side}
              label={{ left: 'Esquerda', right: 'Direita', top: 'Cima', bottom: 'Baixo' }[side]}
              value={clip.transform.crop[side]}
              min={0}
              max={0.45}
              step={0.005}
              format={(v) => `${Math.round(v * 100)}%`}
              onStart={checkpoint}
              onChange={(v) => set({ transform: { ...clip.transform, crop: { ...clip.transform.crop, [side]: v } } }, true)}
              onReset={() => set({ transform: { ...clip.transform, crop: { ...clip.transform.crop, [side]: 0 } } })}
            />
          ))}
        </div>
      </Section>
    </>
  )
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]

export function SpeedSection({ clip, dispatch, checkpoint }: Pick<Props, 'clip' | 'dispatch' | 'checkpoint'>) {
  const speed = clip.speed || 1
  return (
    <Section title="Velocidade" icon={Gauge}>
      <div className="speed-chips">
        {SPEEDS.map((s) => (
          <button key={s} className={`chip ${Math.abs(s - speed) < 1e-3 ? 'active' : ''}`} onClick={() => dispatch({ type: 'setSpeed', id: clip.id, speed: s })}>
            {s}×
          </button>
        ))}
      </div>
      <Slider
        label="Velocidade"
        value={speed}
        min={0.25}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onStart={checkpoint}
        onChange={(v) => dispatch({ type: 'setSpeed', id: clip.id, speed: v }, true)}
        onReset={() => dispatch({ type: 'setSpeed', id: clip.id, speed: 1 })}
      />
      <p className="hint">
        <Scaling size={11} style={{ verticalAlign: -1 }} /> A duração na timeline muda junto; o tom da voz é preservado.
      </p>
    </Section>
  )
}
