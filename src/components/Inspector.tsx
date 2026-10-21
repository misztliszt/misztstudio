import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  AudioLines,
  AudioWaveform,
  Plug,
  Drum,
  Eraser,
  Rewind,
  Snowflake,
  Clock,
  Film,
  Gauge,
  Keyboard,
  Layers,
  Mic2,
  Music2,
  Palette,
  Plus,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Split,
  Type,
  Wand2,
  Waves,
  X,
} from 'lucide-react'
import type { Action } from '../store'
import { defaultColor, defaultEffects, maxClipDuration } from '../store'
import { TRANSITION_OPTIONS } from '../fx'
import { SpeedSection, TransformSection } from './TransformSection'
import type { Clip, ColorAdjust, Media, Project, ScaleName, TextStyle, Track, TrackFx, Transition, TransitionType, VideoEffects } from '../types'
import type { PlaybackEngine } from '../engine'
import { clipGainAt } from '../audio'
import { COLOR_PRESETS } from '../color'
import { FONTS, TEXT_ANIMATIONS, TEXT_PRESETS } from '../text'
import { KEY_NAMES, SCALE_NAMES, keyName, semitonesBetween, type Mode } from '../music'
import { formatTime } from '../format'
import { NumberField, Section, Segmented, Select, Slider, Toggle } from './controls'
import { PitchGraph } from './PitchGraph'

interface Props {
  project: Project
  selection: string[]
  selectedTrack: string | null
  time: number
  engine: PlaybackEngine
  dispatch: (a: Action, merge?: boolean) => void
  checkpoint: () => void
  onSeparate: (clipId: string) => void
  onSeek: (t: number) => void
  onDetectBeats: (mediaId: string) => void
  onVideoTool: (tool: 'freeze' | 'reverse' | 'bg', clip: Clip) => void
  onAudioTool: (tool: 'light' | 'medium' | 'strong' | 'vst', clip: Clip) => void
}

const RESOLUTIONS = [
  { label: '1920 × 1080 · 16:9', w: 1920, h: 1080 },
  { label: '1080 × 1920 · 9:16 vertical', w: 1080, h: 1920 },
  { label: '1080 × 1080 · 1:1', w: 1080, h: 1080 },
  { label: '1280 × 720 · 16:9', w: 1280, h: 720 },
  { label: '3840 × 2160 · 4K', w: 3840, h: 2160 },
]
const FPS = [24, 25, 30, 50, 60]
const pct = (v: number) => `${Math.round(v * 100)}%`
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`
const sec = (v: number) => `${v.toFixed(2)} s`
const KEY_OPTIONS = KEY_NAMES.map((k, i) => ({ value: i, label: k }))

export function Inspector(props: Props) {
  const { project, selection, selectedTrack } = props
  const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined
  const track = !clip && selectedTrack ? project.tracks.find((t) => t.id === selectedTrack) : undefined
  return (
    <section className="panel inspector">
      {clip ? <ClipInspector key={clip.id} {...props} clip={clip} /> : track ? <TrackInspector key={track.id} {...props} track={track} /> : <ProjectInspector {...props} />}
    </section>
  )
}

type ClipTab = 'text' | 'video' | 'color' | 'audio'

function ClipInspector({ project, clip, time, dispatch, checkpoint, onSeparate, onSeek, onDetectBeats, onVideoTool, onAudioTool }: Props & { clip: Clip }) {
  const media = clip.mediaId ? project.media[clip.mediaId] : undefined
  const set = (patch: Partial<Clip>, merge = false) => dispatch({ type: 'updateClip', id: clip.id, patch }, merge)
  const max = maxClipDuration(media, clip)
  const visual = !!media && media.kind !== 'audio'
  const hasSound = !!media && media.kind !== 'image' && media.hasAudio
  const tabs: { value: ClipTab; label: string; icon: typeof Type }[] = []
  if (clip.text) tabs.push({ value: 'text', label: 'Texto', icon: Type })
  if (visual) tabs.push({ value: 'video', label: 'Vídeo', icon: Film }, { value: 'color', label: 'Cor', icon: Palette })
  if (hasSound) tabs.push({ value: 'audio', label: 'Áudio', icon: AudioLines })
  const [tab, setTab] = useState<ClipTab>(tabs[0]?.value ?? 'video')
  const current = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value

  const kindLabel = clip.text ? 'Texto' : media?.kind === 'video' ? 'Vídeo' : media?.kind === 'audio' ? 'Áudio' : 'Imagem'
  return (
    <>
      <header className="panel-header inspector-head">
        <div className="inspector-title">
          <span className={`kind-dot ${clip.text ? 'text' : (media?.kind ?? '')}`} />
          <div>
            <h2>{clip.text ? clip.text.content.split('\n')[0] || 'Texto' : media?.name}</h2>
            <span className="dim">
              {kindLabel} · {formatTime(clip.duration)}
            </span>
          </div>
        </div>
      </header>
      {tabs.length > 1 && (
        <div className="inspector-tabs">
          <Segmented value={current ?? 'video'} options={tabs} onChange={setTab} />
        </div>
      )}
      <div className="inspector-body">
        <Section title="Tempo" icon={Clock}>
          <div className="field-grid">
            <NumberField label="Início" value={clip.start} min={0} suffix="s" onCommit={(v) => set({ start: v })} />
            <NumberField label="Duração" value={clip.duration} min={0.1} max={max} suffix="s" onCommit={(v) => set({ duration: v })} />
          </div>
          {media && media.kind !== 'image' && (
            <div className="field">
              <label>Corte inicial na mídia</label>
              <span className="value mono">{formatTime(clip.in)}</span>
            </div>
          )}
        </Section>

        {current === 'text' && clip.text && <TextSection text={clip.text} onChange={(t, merge) => set({ text: { ...clip.text!, ...t } }, merge)} checkpoint={checkpoint} />}

        {current === 'video' && visual && <TransformSection clip={clip} time={time} dispatch={dispatch} checkpoint={checkpoint} onSeek={onSeek} />}

        {current === 'video' && media?.kind === 'video' && <SpeedSection clip={clip} dispatch={dispatch} checkpoint={checkpoint} />}

        {current === 'video' && media?.kind === 'video' && (
          <Section title="Ferramentas de vídeo" icon={Wand2}>
            <button className="btn action-row accent" onClick={() => onVideoTool('bg', clip)}>
              <Eraser size={15} /> {media.alpha ? 'Fundo já removido · refazer' : 'Remover fundo com IA…'}
            </button>
            <button className="btn action-row" onClick={() => onVideoTool('freeze', clip)}>
              <Snowflake size={15} /> Congelar quadro no cursor
            </button>
            <button className="btn action-row" onClick={() => onVideoTool('reverse', clip)}>
              <Rewind size={15} /> Inverter (reverso)
            </button>
          </Section>
        )}

        {current === 'video' && visual && (
          <Section title="Transições" icon={Layers}>
            <TransitionRow label="Entrada" value={clip.transitionIn} max={clip.duration} onChange={(t) => set({ transitionIn: t })} />
            <TransitionRow label="Saída" value={clip.transitionOut} max={clip.duration} onChange={(t) => set({ transitionOut: t })} />
          </Section>
        )}

        {current === 'video' && media?.kind === 'video' && (
          <Section title="Som do vídeo" icon={AudioLines}>
            {clip.audioDetached ? (
              <p className="hint">O som deste vídeo foi separado para uma trilha de áudio.</p>
            ) : hasSound ? (
              <button className="btn action-row" onClick={() => dispatch({ type: 'detachAudio', clipId: clip.id })}>
                <Split size={15} /> Separar áudio do vídeo
              </button>
            ) : (
              <p className="hint">Este vídeo não tem som.</p>
            )}
          </Section>
        )}

        {current === 'video' && visual && <EffectsSection effects={clip.effects ?? defaultEffects()} onChange={(e, merge) => set({ effects: { ...(clip.effects ?? defaultEffects()), ...e } }, merge)} checkpoint={checkpoint} />}

        {current === 'color' && visual && <ColorSection color={clip.color} onChange={(c, merge) => set({ color: { ...clip.color, ...c } }, merge)} checkpoint={checkpoint} />}

        {current === 'audio' && hasSound && (
          <>
            {clip.audioDetached ? (
              <Section title="Áudio" icon={AudioLines}>
                <p className="hint">O som deste vídeo foi separado para uma trilha de áudio. Edite-o no clipe de áudio correspondente.</p>
              </Section>
            ) : (
              <>
                <Section title="Ferramentas" icon={Wand2}>
                  {media?.kind === 'video' && (
                    <button className="btn action-row" onClick={() => dispatch({ type: 'detachAudio', clipId: clip.id })}>
                      <Split size={15} /> Separar áudio do vídeo
                    </button>
                  )}
                  <button className="btn action-row accent" onClick={() => onSeparate(clip.id)}>
                    <Sparkles size={15} /> Separar voz e instrumentos…
                  </button>
                  <div className="clean-row">
                    <span>
                      <AudioWaveform size={15} /> Limpar voz
                    </span>
                    <div className="segmented small">
                      {(
                        [
                          ['light', 'Leve'],
                          ['medium', 'Média'],
                          ['strong', 'Forte'],
                        ] as const
                      ).map(([lvl, label]) => (
                        <button key={lvl} onClick={() => onAudioTool(lvl, clip)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="btn action-row" onClick={() => onAudioTool('vst', clip)}>
                    <Plug size={15} /> Plugin VST3…
                  </button>
                  <button className="btn action-row" onClick={() => media && onDetectBeats(media.id)}>
                    <Drum size={15} /> {media?.beats ? `Batidas: ${media.beats.bpm} BPM · detectar de novo` : 'Detectar batidas (ímã na timeline)'}
                  </button>
                </Section>
                {media && <KeySection project={project} clip={clip} media={media} dispatch={dispatch} />}
                <Section title="Volume" icon={Gauge}>
                  <Slider label="Volume" value={clip.volume} min={0} max={2} format={pct} onStart={checkpoint} onChange={(v) => set({ volume: v }, true)} onReset={() => set({ volume: 1 })} />
                  <div className="field-grid">
                    <Slider label="Fade in" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration)} format={sec} onStart={checkpoint} onChange={(v) => set({ fadeIn: v }, true)} onReset={() => set({ fadeIn: 0 })} />
                    <Slider label="Fade out" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration)} format={sec} onStart={checkpoint} onChange={(v) => set({ fadeOut: v }, true)} onReset={() => set({ fadeOut: 0 })} />
                  </div>
                </Section>
                <VolumeKeys clip={clip} time={time} set={set} checkpoint={checkpoint} />
                {media?.kind === 'audio' && <SpeedSection clip={clip} dispatch={dispatch} checkpoint={checkpoint} />}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

function VolumeKeys({ clip, time, set, checkpoint }: { clip: Clip; time: number; set: (p: Partial<Clip>, merge?: boolean) => void; checkpoint: () => void }) {
  const local = time - clip.start
  const inside = local >= 0 && local <= clip.duration
  const keys = clip.volumeKeys
  const add = () => {
    const current = clipGainAt({ ...clip, volume: 1, fadeIn: 0, fadeOut: 0 }, local)
    const next = [...keys.filter((k) => Math.abs(k.t - local) > 0.01), { t: local, v: current }].sort((a, b) => a.t - b.t)
    set({ volumeKeys: next })
  }
  return (
    <Section
      title="Automação de volume"
      icon={Waves}
      right={
        <button className="btn small" disabled={!inside} onClick={add} data-tip="Adiciona um ponto na posição do cursor" data-tip-pos="left">
          <Plus size={13} /> Ponto
        </button>
      }
    >
      {keys.length === 0 && <p className="hint">Posicione o cursor sobre o clipe e adicione pontos para desenhar o envelope.</p>}
      {keys.map((k, i) => (
        <div key={i} className="key-row">
          <span className="value mono">{formatTime(k.t)}</span>
          <input
            type="range"
            className="range"
            min={0}
            max={2}
            step={0.01}
            value={k.v}
            style={{ ['--from' as string]: '0%', ['--to' as string]: `${(k.v / 2) * 100}%` }}
            onPointerDown={checkpoint}
            onChange={(e) => set({ volumeKeys: keys.map((x, j) => (j === i ? { ...x, v: Number(e.target.value) } : x)) }, true)}
          />
          <span className="value mono">{pct(k.v)}</span>
          <button className="icon-btn" onClick={() => set({ volumeKeys: keys.filter((_, j) => j !== i) })} aria-label="Remover ponto">
            <X size={13} />
          </button>
        </div>
      ))}
    </Section>
  )
}

const TRANSITIONS: { value: TransitionType; label: string }[] = TRANSITION_OPTIONS

function EffectsSection({ effects, onChange, checkpoint }: { effects: VideoEffects; onChange: (e: Partial<VideoEffects>, merge?: boolean) => void; checkpoint: () => void }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <Section title="Efeitos" icon={Wand2} right={<button className="btn small ghost" onClick={() => onChange({ blur: 0, vignette: 0, grain: 0, shake: 0, mirror: false })} data-tip="Remover efeitos" data-tip-pos="left"><RotateCcw size={13} /></button>}>
      <Slider label="Desfoque" value={effects.blur} min={0} max={40} step={0.5} format={(v) => `${v.toFixed(1)} px`} onStart={checkpoint} onChange={(v) => onChange({ blur: v }, true)} onReset={() => onChange({ blur: 0 })} />
      <Slider label="Vinheta" value={effects.vignette} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ vignette: v }, true)} onReset={() => onChange({ vignette: 0 })} />
      <Slider label="Granulado" value={effects.grain} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ grain: v }, true)} onReset={() => onChange({ grain: 0 })} />
      <Slider label="Tremor de câmera" value={effects.shake} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ shake: v }, true)} onReset={() => onChange({ shake: 0 })} />
      <div className="toggle-row">
        <Toggle checked={effects.mirror} onChange={(v) => onChange({ mirror: v })} label="Espelhar" />
      </div>
    </Section>
  )
}

function TransitionRow({ label, value, max, onChange }: { label: string; value: Transition; max: number; onChange: (t: Transition) => void }) {
  return (
    <div className="transition-row">
      <label>{label}</label>
      <Select value={value.type} options={TRANSITIONS} onChange={(type) => onChange({ ...value, type })} />
      <div className={`number-input compact ${value.type === 'none' ? 'disabled' : ''}`}>
        <input
          type="number"
          min={0.1}
          max={max}
          step={0.1}
          value={value.duration}
          disabled={value.type === 'none'}
          onChange={(e) => onChange({ ...value, duration: Math.min(max, Math.max(0.1, Number(e.target.value) || 0.1)) })}
        />
        <span className="suffix">s</span>
      </div>
    </div>
  )
}

function ColorSection({ color, onChange, checkpoint }: { color: ColorAdjust; onChange: (c: Partial<ColorAdjust>, merge?: boolean) => void; checkpoint: () => void }) {
  return (
    <>
      <Section title="Filtros" icon={Sparkles} right={<button className="btn small ghost" onClick={() => onChange(defaultColor())} data-tip="Restaurar cor original" data-tip-pos="left"><RotateCcw size={13} /></button>}>
        <div className="preset-grid">
          {COLOR_PRESETS.map((p) => {
            const c = { ...defaultColor(), ...p.color }
            const active = c.brightness === color.brightness && c.contrast === color.contrast && c.saturation === color.saturation && c.hue === color.hue && c.sepia === color.sepia
            return (
              <button key={p.name} className={`preset-swatch ${active ? 'active' : ''}`} onClick={() => onChange(p.color)}>
                <span
                  className="swatch"
                  style={{ filter: `brightness(${1 + c.brightness}) contrast(${c.contrast}) saturate(${c.saturation}) hue-rotate(${c.hue}deg) sepia(${c.sepia})` }}
                />
                {p.name}
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="Ajustes" icon={SlidersHorizontal}>
        <Slider label="Brilho" bipolar value={color.brightness} min={-1} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ brightness: v }, true)} onReset={() => onChange({ brightness: 0 })} />
        <Slider label="Contraste" value={color.contrast} min={0} max={2} format={pct} onStart={checkpoint} onChange={(v) => onChange({ contrast: v }, true)} onReset={() => onChange({ contrast: 1 })} />
        <Slider label="Saturação" value={color.saturation} min={0} max={3} format={pct} onStart={checkpoint} onChange={(v) => onChange({ saturation: v }, true)} onReset={() => onChange({ saturation: 1 })} />
        <Slider label="Matiz" bipolar value={color.hue} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onStart={checkpoint} onChange={(v) => onChange({ hue: v }, true)} onReset={() => onChange({ hue: 0 })} />
        <Slider label="Sépia" value={color.sepia} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ sepia: v }, true)} onReset={() => onChange({ sepia: 0 })} />
      </Section>
      <Section title="LUT" icon={Palette}>
        {color.lut ? (
          <div className="file-chip">
            <Palette size={14} />
            <span className="ellipsis" title={color.lut}>
              {color.lut.split(/[\\/]/).pop()}
            </span>
            <button className="icon-btn" onClick={() => onChange({ lut: null })} aria-label="Remover LUT">
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            className="btn action-row"
            onClick={async () => {
              const lut = await window.api.pickLut()
              if (lut) onChange({ lut })
            }}
          >
            <Plus size={15} /> Carregar arquivo .cube
          </button>
        )}
      </Section>
    </>
  )
}

const FONT_OPTIONS = FONTS.map((f) => ({ value: f, label: f }))
const ANIMATIONS: { value: TextStyle['animation']; label: string }[] = TEXT_ANIMATIONS

function TextSection({ text, onChange, checkpoint }: { text: TextStyle; onChange: (t: Partial<TextStyle>, merge?: boolean) => void; checkpoint: () => void }) {
  return (
    <>
      <Section title="Conteúdo" icon={Type}>
        <textarea value={text.content} rows={3} onFocus={checkpoint} onChange={(e) => onChange({ content: e.target.value }, true)} />
        <div className="preset-row">
          {TEXT_PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => onChange(p.style)}>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Estilo" icon={Palette}>
        <div className="field">
          <label>Fonte</label>
          <Select value={text.font} options={FONT_OPTIONS} onChange={(font) => onChange({ font })} />
        </div>
        <Slider label="Tamanho" value={text.size} min={16} max={300} step={1} format={(v) => `${v.toFixed(0)} px`} onStart={checkpoint} onChange={(v) => onChange({ size: v }, true)} />
        <div className="field">
          <label>Cor</label>
          <input type="color" className="color-input" value={text.color} onChange={(e) => onChange({ color: e.target.value }, true)} onPointerDown={checkpoint} />
        </div>
        <div className="toggle-row">
          <Toggle checked={text.bold} onChange={(v) => onChange({ bold: v })} label="Negrito" />
          <Toggle checked={text.outline} onChange={(v) => onChange({ outline: v })} label="Contorno" />
          <Toggle checked={text.background !== null} onChange={(v) => onChange({ background: v ? 'rgba(0,0,0,0.65)' : null })} label="Fundo" />
          {text.background !== null && (
            <input type="color" className="color-input" value={text.background.startsWith('#') ? text.background : '#000000'} onChange={(e) => onChange({ background: e.target.value }, true)} onPointerDown={checkpoint} />
          )}
        </div>
      </Section>
      <Section title="Posição e animação" icon={Sparkles}>
        <div className="field-grid">
          <Slider label="Horizontal" value={text.x} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ x: v }, true)} onReset={() => onChange({ x: 0.5 })} />
          <Slider label="Vertical" value={text.y} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => onChange({ y: v }, true)} onReset={() => onChange({ y: 0.5 })} />
        </div>
        <div className="field">
          <label>Animação</label>
          <Select value={text.animation} options={ANIMATIONS} onChange={(animation) => onChange({ animation })} />
        </div>
        {text.animation === 'karaoke' && (
          <div className="field">
            <label>Cor do destaque</label>
            <input type="color" className="color-input" value={text.highlight ?? '#ffd84d'} onChange={(e) => onChange({ highlight: e.target.value }, true)} onPointerDown={checkpoint} />
          </div>
        )}
        {text.words?.length ? <p className="hint">Tempos de {text.words.length} palavras vindos da transcrição.</p> : null}
      </Section>
    </>
  )
}

type TrackTab = 'mix' | 'pitch' | 'fx'

function TrackInspector({ project, track, engine, dispatch, checkpoint }: Props & { track: Track }) {
  const fx = track.fx
  const setFx = (patch: Partial<TrackFx>, merge = false) => dispatch({ type: 'updateTrack', id: track.id, patch: { fx: { ...fx, ...patch } } }, merge)
  const at = fx.autotune
  const setAt = (patch: Partial<TrackFx['autotune']>, merge = false) => setFx({ autotune: { ...at, ...patch } }, merge)
  const [tab, setTab] = useState<TrackTab>('mix')
  const [from, setFrom] = useState({ key: 11, mode: 'major' as Mode })
  const [to, setTo] = useState({ key: 0, mode: 'major' as Mode })
  const [name, setName] = useState(track.name)
  useEffect(() => setName(track.name), [track.name])
  const suggested = semitonesBetween(from.key, from.mode, to.key, to.mode)
  const modes = [
    { value: 'major' as Mode, label: 'maior' },
    { value: 'minor' as Mode, label: 'menor' },
  ]

  return (
    <>
      <header className="panel-header inspector-head">
        <div className="inspector-title">
          <span className={`kind-dot ${track.kind}`} />
          <div className="grow">
            <input
              className="title-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== track.name && dispatch({ type: 'updateTrack', id: track.id, patch: { name: name.trim() } })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span className="dim">Trilha de {track.kind === 'video' ? 'vídeo' : 'áudio'}</span>
          </div>
        </div>
      </header>
      <div className="inspector-tabs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mix', label: 'Mixer', icon: SlidersHorizontal },
            { value: 'pitch', label: 'Tom', icon: Music2 },
            { value: 'fx', label: 'Efeitos', icon: Waves },
          ]}
        />
      </div>
      <div className="inspector-body">
        {tab === 'mix' && (
          <Section title="Mixer" icon={SlidersHorizontal}>
            <Slider label="Volume" value={track.volume} min={0} max={1.5} format={(v) => (v === 0 ? '−∞ dB' : db(20 * Math.log10(v)))} onStart={checkpoint} onChange={(v) => dispatch({ type: 'updateTrack', id: track.id, patch: { volume: v } }, true)} onReset={() => dispatch({ type: 'updateTrack', id: track.id, patch: { volume: 1 } })} />
            <Slider
              label="Pan"
              bipolar
              value={fx.pan}
              min={-1}
              max={1}
              format={(v) => (Math.abs(v) < 0.01 ? 'Centro' : v < 0 ? `E ${Math.round(-v * 100)}` : `D ${Math.round(v * 100)}`)}
              onStart={checkpoint}
              onChange={(v) => setFx({ pan: v }, true)}
              onReset={() => setFx({ pan: 0 })}
            />
          </Section>
        )}

        {tab === 'pitch' && (
          <>
            <Section title="Mudar o tom" icon={Music2}>
              <Slider
                label="Semitons"
                bipolar
                value={fx.transpose}
                min={-12}
                max={12}
                step={1}
                format={(v) => (v === 0 ? 'Original' : `${v > 0 ? '+' : ''}${v} st`)}
                onStart={checkpoint}
                onChange={(v) => setFx({ transpose: v }, true)}
                onReset={() => setFx({ transpose: 0 })}
              />
              <div className="key-helper">
                <div className="key-pick">
                  <label>De</label>
                  <Select value={from.key} options={KEY_OPTIONS} onChange={(key) => setFrom({ ...from, key })} />
                  <Select value={from.mode} options={modes} onChange={(mode) => setFrom({ ...from, mode })} />
                </div>
                <div className="key-pick">
                  <label>Para</label>
                  <Select value={to.key} options={KEY_OPTIONS} onChange={(key) => setTo({ ...to, key })} />
                  <Select value={to.mode} options={modes} onChange={(mode) => setTo({ ...to, mode })} />
                </div>
                <button className="btn primary" onClick={() => setFx({ transpose: suggested })}>
                  Aplicar {suggested > 0 ? '+' : ''}
                  {suggested} semitons
                </button>
                {from.mode !== to.mode && <p className="hint">Maior ↔ menor: transpõe até a relativa (ex.: Lá menor = Dó maior); as notas da escala não mudam.</p>}
              </div>
            </Section>

            <Section title="Afinação automática" icon={Mic2} right={<Toggle checked={at.enabled} onChange={(v) => setAt({ enabled: v })} />}>
              <div className={at.enabled ? 'stack' : 'stack disabled-block'}>
                <div className="field-grid">
                  <div className="field column">
                    <label>Tom</label>
                    <Select value={at.key} options={KEY_OPTIONS} onChange={(key) => setAt({ key })} />
                  </div>
                  <div className="field column">
                    <label>Escala</label>
                    <Select value={at.scale} options={Object.entries(SCALE_NAMES).map(([value, label]) => ({ value: value as ScaleName, label }))} onChange={(scale) => setAt({ scale })} />
                  </div>
                </div>
                <Slider label="Velocidade de correção" value={at.speed} min={0} max={1} format={(v) => (v >= 0.99 ? 'Robô' : pct(v))} onStart={checkpoint} onChange={(v) => setAt({ speed: v }, true)} />
                <Slider label="Mistura" value={at.mix} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => setAt({ mix: v }, true)} />
                {at.enabled && <PitchGraph engine={engine} trackId={track.id} />}
              </div>
            </Section>
          </>
        )}

        {tab === 'fx' && (
          <>
            <Section title="Equalizador" icon={SlidersHorizontal}>
              <EqCurve low={fx.eq.low} mid={fx.eq.mid} high={fx.eq.high} />
              <Slider label="Graves · 100 Hz" bipolar value={fx.eq.low} min={-15} max={15} step={0.5} format={db} onStart={checkpoint} onChange={(v) => setFx({ eq: { ...fx.eq, low: v } }, true)} onReset={() => setFx({ eq: { ...fx.eq, low: 0 } })} />
              <Slider label="Médios · 1 kHz" bipolar value={fx.eq.mid} min={-15} max={15} step={0.5} format={db} onStart={checkpoint} onChange={(v) => setFx({ eq: { ...fx.eq, mid: v } }, true)} onReset={() => setFx({ eq: { ...fx.eq, mid: 0 } })} />
              <Slider label="Agudos · 8 kHz" bipolar value={fx.eq.high} min={-15} max={15} step={0.5} format={db} onStart={checkpoint} onChange={(v) => setFx({ eq: { ...fx.eq, high: v } }, true)} onReset={() => setFx({ eq: { ...fx.eq, high: 0 } })} />
            </Section>
            <Section title="Compressor" icon={Gauge} right={<Toggle checked={fx.comp.enabled} onChange={(v) => setFx({ comp: { ...fx.comp, enabled: v } })} />}>
              <div className={fx.comp.enabled ? 'stack' : 'stack disabled-block'}>
                <Slider label="Limiar" value={fx.comp.threshold} min={-60} max={0} step={1} format={(v) => `${v} dB`} onStart={checkpoint} onChange={(v) => setFx({ comp: { ...fx.comp, threshold: v } }, true)} />
                <Slider label="Razão" value={fx.comp.ratio} min={1} max={20} step={0.5} format={(v) => `${v}:1`} onStart={checkpoint} onChange={(v) => setFx({ comp: { ...fx.comp, ratio: v } }, true)} />
              </div>
            </Section>
            <Section title="Ducking" icon={ArrowDownToLine} right={<Toggle checked={fx.duck.enabled} onChange={(v) => setFx({ duck: { ...fx.duck, enabled: v, source: fx.duck.source ?? project.tracks.find((t) => t.id !== track.id && /voz|voice|narra/i.test(t.name))?.id ?? project.tracks.find((t) => t.id !== track.id)?.id ?? null } })} />}>
              <p className="hint">Abaixa esta trilha automaticamente enquanto outra trilha (a voz) tem som. Ideal para música de fundo.</p>
              <div className={fx.duck.enabled ? 'stack' : 'stack disabled-block'}>
                <div className="field">
                  <label>Quando houver som em</label>
                  <Select
                    value={fx.duck.source ?? ''}
                    options={[{ value: '', label: 'Escolha a trilha' }, ...project.tracks.filter((t) => t.id !== track.id).map((t) => ({ value: t.id, label: t.name }))]}
                    onChange={(source) => setFx({ duck: { ...fx.duck, source: source || null } })}
                  />
                </div>
                <Slider label="Quanto abaixar" value={fx.duck.depth} min={3} max={30} step={1} format={(v) => `−${v} dB`} onStart={checkpoint} onChange={(v) => setFx({ duck: { ...fx.duck, depth: v } }, true)} />
              </div>
            </Section>
            <Section title="Reverb" icon={Waves}>
              <Slider label="Quantidade" value={fx.reverb.mix} min={0} max={1} format={pct} onStart={checkpoint} onChange={(v) => setFx({ reverb: { ...fx.reverb, mix: v } }, true)} onReset={() => setFx({ reverb: { ...fx.reverb, mix: 0 } })} />
              <Slider label="Duração" value={fx.reverb.decay} min={0.3} max={6} step={0.1} format={sec} onStart={checkpoint} onChange={(v) => setFx({ reverb: { ...fx.reverb, decay: v } }, true)} />
            </Section>
          </>
        )}
      </div>
    </>
  )
}

/** Curva aproximada do EQ de 3 bandas (só visual). */
function EqCurve({ low, mid, high }: { low: number; mid: number; high: number }) {
  const W = 260
  const H = 64
  const points: string[] = []
  for (let i = 0; i <= 60; i++) {
    const f = 20 * Math.pow(1000, i / 60) // 20 Hz … 20 kHz em escala log
    const shelf = (fc: number, g: number, lowSide: boolean) => g / (1 + Math.pow(lowSide ? f / fc : fc / f, 2))
    const bell = mid * Math.exp(-Math.pow(Math.log2(f / 1000) / 1.1, 2))
    const gain = shelf(100, low, true) + bell + shelf(8000, high, false)
    points.push(`${(i / 60) * W},${H / 2 - (gain / 15) * (H / 2 - 4)}`)
  }
  return (
    <svg className="eq-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eq-zero" />
      <polyline points={`0,${H} ${points.join(' ')} ${W},${H}`} className="eq-fill" />
      <polyline points={points.join(' ')} className="eq-line" />
    </svg>
  )
}

function ProjectInspector({ project, dispatch }: Props) {
  const res = RESOLUTIONS.findIndex((r) => r.w === project.width && r.h === project.height)
  const resOptions = [...(res === -1 ? [{ value: -1, label: `${project.width} × ${project.height}` }] : []), ...RESOLUTIONS.map((r, i) => ({ value: i, label: r.label }))]
  const shortcuts: [string, string][] = [
    ['Espaço', 'Reproduzir / pausar'],
    ['S', 'Dividir no cursor'],
    ['T', 'Novo texto'],
    ['Del', 'Excluir seleção'],
    ['Ctrl Z / Ctrl Y', 'Desfazer / refazer'],
    ['← →', 'Quadro a quadro'],
    ['J / K / L', 'Voltar 5 s / pausar / tocar'],
    ['M', 'Marcador no cursor'],
    ['[ / ]', 'Marcador anterior / próximo'],
    ['Ctrl C / Ctrl V', 'Copiar / colar'],
    ['Ctrl D', 'Duplicar'],
    ['Ctrl + roda', 'Zoom da timeline'],
    ['Ctrl S', 'Salvar'],
    ['Ctrl E', 'Exportar'],
  ]
  return (
    <>
      <header className="panel-header inspector-head">
        <div className="inspector-title">
          <span className="kind-dot project" />
          <div>
            <h2>Projeto</h2>
            <span className="dim">
              {project.width} × {project.height} · {project.fps} fps
            </span>
          </div>
        </div>
      </header>
      <div className="inspector-body">
        <Section title="Formato" icon={Film}>
          <div className="field column">
            <label>Resolução</label>
            <Select
              value={res}
              options={resOptions}
              onChange={(i) => {
                const r = RESOLUTIONS[i]
                if (r) dispatch({ type: 'settings', patch: { width: r.w, height: r.h } })
              }}
            />
          </div>
          <div className="field column">
            <label>Quadros por segundo</label>
            <Select value={project.fps} options={FPS.map((f) => ({ value: f, label: `${f} fps` }))} onChange={(fps) => dispatch({ type: 'settings', patch: { fps } })} />
          </div>
        </Section>
        <div className="tip-card">
          <Scissors size={16} />
          <p>Clique num clipe para editar cor, transições, volume e texto. Clique no nome de uma trilha para mixer, tom e afinação.</p>
        </div>
        <Section title="Atalhos" icon={Keyboard}>
          <dl className="shortcuts">
            {shortcuts.map(([k, v]) => (
              <div key={k}>
                <dt>
                  {k.split(' / ').map((part, i) => (
                    <span key={part}>
                      {i > 0 && ' / '}
                      {part.split(' ').map((p) => (
                        <kbd key={p}>{p}</kbd>
                      ))}
                    </span>
                  ))}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </>
  )
}

/** Tom da música: detecta e aplica na afinação automática da trilha. */
function KeySection({ project, clip, media, dispatch }: { project: Project; clip: Clip; media: Media; dispatch: Props['dispatch'] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const track = project.tracks.find((t) => t.id === clip.trackId)
  const k = media.key
  const detect = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await window.api.detectKey(media.path, clip.in, clip.duration * (clip.speed || 1))
      if (!r) setError('Não deu para identificar o tom (trecho sem notas ou só percussão).')
      dispatch({ type: 'updateMedia', id: media.id, patch: { key: r } })
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setBusy(false)
    }
  }
  const apply = (key: number, mode: 'major' | 'minor') => {
    if (!track) return
    dispatch({ type: 'updateTrack', id: track.id, patch: { fx: { ...track.fx, autotune: { ...track.fx.autotune, enabled: true, key, scale: mode } } } })
  }
  return (
    <Section title="Tom da música" icon={Music2}>
      {k && (
        <div className="key-result">
          <span className="key-badge">{k.camelot}</span>
          <div>
            <strong>{keyName(k.key, k.mode)}</strong>
            <span className="dim">
              Confiança {Math.round(k.confidence * 100)}%{k.alternative ? ` · ou ${keyName(k.alternative.key, k.alternative.mode)} (${k.alternative.camelot}), a relativa` : ''}
            </span>
          </div>
        </div>
      )}
      {k && track && (
        <div className="key-actions">
          <button className="btn small" onClick={() => apply(k.key, k.mode)}>
            Usar na afinação da trilha
          </button>
          {k.alternative && (
            <button className="btn ghost small" onClick={() => apply(k.alternative!.key, k.alternative!.mode)}>
              Usar {keyName(k.alternative.key, k.alternative.mode)}
            </button>
          )}
        </div>
      )}
      <button className="btn action-row" onClick={() => void detect()} disabled={busy}>
        <Music2 size={15} /> {busy ? 'Analisando…' : k ? 'Detectar de novo' : 'Detectar o tom'}
      </button>
      {error && <p className="error">{error}</p>}
    </Section>
  )
}
