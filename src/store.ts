import { useCallback, useReducer } from 'react'
import type { Clip, ColorAdjust, Marker, Media, Project, TextStyle, Track, TrackFx, TrackKind } from './types'
import { ANIM_PROPS, defaultTransform } from './anim'

export const uid = () => Math.random().toString(36).slice(2, 10)

/** Duração padrão de uma imagem ou texto ao ser colocado na timeline. */
export const IMAGE_DURATION = 5
const MIN_CLIP = 0.1

export const defaultFx = (): TrackFx => ({
  eq: { low: 0, mid: 0, high: 0 },
  comp: { enabled: false, threshold: -18, ratio: 3 },
  reverb: { mix: 0, decay: 2 },
  pan: 0,
  autotune: { enabled: false, key: 0, scale: 'chromatic', speed: 0.7, mix: 1 },
  transpose: 0,
  duck: { enabled: false, source: null, depth: 12 },
})

export const defaultColor = (): ColorAdjust => ({ brightness: 0, contrast: 1, saturation: 1, hue: 0, sepia: 0, lut: null })

export const defaultText = (): TextStyle => ({
  content: 'Seu texto aqui',
  font: 'Segoe UI',
  size: 96,
  color: '#ffffff',
  bold: true,
  outline: true,
  background: null,
  x: 0.5,
  y: 0.5,
  animation: 'fade',
})

const clipDefaults = (): Omit<Clip, 'id' | 'mediaId' | 'trackId' | 'start' | 'in' | 'duration'> => ({
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  volumeKeys: [],
  transitionIn: { type: 'none', duration: 0.5 },
  transitionOut: { type: 'none', duration: 0.5 },
  color: defaultColor(),
  transform: defaultTransform(),
  keyframes: {},
  speed: 1,
})

export function makeTrack(kind: TrackKind, name: string, fx?: Partial<TrackFx>): Track {
  return { id: uid(), kind, name, muted: false, hidden: false, volume: 1, fx: { ...defaultFx(), ...fx } }
}

export interface Template {
  id: string
  name: string
  description: string
  build: () => Project
}

const base = (width: number, height: number, fps: number, tracks: Track[]): Project => ({ version: 1, width, height, fps, media: {}, tracks, clips: [] })

export const TEMPLATES: Template[] = [
  {
    id: 'youtube',
    name: 'YouTube 16:9',
    description: '1920×1080 · 30 fps · 2 trilhas de vídeo, 2 de áudio',
    build: () => base(1920, 1080, 30, [makeTrack('video', 'Vídeo 2'), makeTrack('video', 'Vídeo 1'), makeTrack('audio', 'Áudio 1'), makeTrack('audio', 'Música')]),
  },
  {
    id: 'vertical',
    name: 'Reels / TikTok 9:16',
    description: '1080×1920 · 30 fps · trilha de textos por cima',
    build: () => base(1080, 1920, 30, [makeTrack('video', 'Textos'), makeTrack('video', 'Vídeo 1'), makeTrack('audio', 'Música')]),
  },
  {
    id: 'square',
    name: 'Quadrado 1:1',
    description: '1080×1080 · 30 fps',
    build: () => base(1080, 1080, 30, [makeTrack('video', 'Vídeo 2'), makeTrack('video', 'Vídeo 1'), makeTrack('audio', 'Áudio 1')]),
  },
  {
    id: 'podcast',
    name: 'Podcast / entrevista',
    description: 'Vozes com EQ e compressor prontos; a música abaixa sozinha quando alguém fala',
    build: () => {
      const voice = makeTrack('audio', 'Voz 1', { eq: { low: -3, mid: 2, high: 3 }, comp: { enabled: true, threshold: -20, ratio: 4 } })
      return base(1920, 1080, 30, [
        makeTrack('video', 'Vídeo'),
        voice,
        makeTrack('audio', 'Voz 2', { eq: { low: -3, mid: 2, high: 3 }, comp: { enabled: true, threshold: -20, ratio: 4 } }),
        { ...makeTrack('audio', 'Música', { duck: { enabled: true, source: voice.id, depth: 14 } }), volume: 0.6 },
      ])
    },
  },
  {
    id: 'music',
    name: 'Clipe musical / cover',
    description: 'Trilha "Voz" com afinação automática ligada e reverb',
    build: () =>
      base(1920, 1080, 30, [
        makeTrack('video', 'Vídeo'),
        makeTrack('audio', 'Voz', {
          autotune: { enabled: true, key: 0, scale: 'major', speed: 0.8, mix: 1 },
          reverb: { mix: 0.2, decay: 2.2 },
          comp: { enabled: true, threshold: -18, ratio: 3 },
        }),
        makeTrack('audio', 'Instrumental'),
      ]),
  },
]

export function newProject(): Project {
  return TEMPLATES[0].build()
}

/** Preenche campos novos em projetos salvos por versões anteriores. */
export function normalizeProject(p: Project): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      const fx = defaultFx()
      const old = (t.fx ?? {}) as Partial<TrackFx>
      return {
        ...t,
        fx: {
          eq: { ...fx.eq, ...old.eq },
          comp: { ...fx.comp, ...old.comp },
          reverb: { ...fx.reverb, ...old.reverb },
          pan: old.pan ?? 0,
          autotune: { ...fx.autotune, ...old.autotune },
          transpose: old.transpose ?? 0,
          duck: { ...fx.duck, ...old.duck },
        },
      }
    }),
    clips: p.clips.map((c) => {
      const t = defaultTransform()
      return { ...clipDefaults(), ...c, color: { ...defaultColor(), ...c.color }, transform: { ...t, ...c.transform, crop: { ...t.crop, ...c.transform?.crop } } }
    }),
  }
}

export function projectDuration(p: Project) {
  return p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
}

/** Duração máxima que a mídia permite a partir de `inPoint` (Infinity para imagens e textos). */
export function maxSourceDuration(media: Media | undefined, inPoint: number) {
  return !media || media.kind === 'image' ? Infinity : Math.max(0, media.duration - inPoint)
}

/** Duração máxima do clipe na timeline, considerando a velocidade. */
export function maxClipDuration(media: Media | undefined, clip: Pick<Clip, 'in' | 'speed'>) {
  return maxSourceDuration(media, clip.in) / (clip.speed || 1)
}

const shiftKeys = <T extends { t: number }>(keys: T[], by: number, scale = 1) => keys.map((k) => ({ ...k, t: (k.t - by) * scale }))

function mapKeyframes(c: Clip, fn: <T extends { t: number }>(keys: T[]) => T[]): Clip['keyframes'] {
  const out: Clip['keyframes'] = {}
  for (const p of ANIM_PROPS) if (c.keyframes[p]?.length) out[p] = fn(c.keyframes[p]!)
  return out
}

export type Action =
  | { type: 'load'; project: Project }
  | { type: 'addMedia'; media: Media[] }
  | { type: 'updateMedia'; id: string; patch: Partial<Media> }
  | { type: 'removeMedia'; mediaId: string }
  | { type: 'addClip'; mediaId: string; trackId?: string; start: number }
  | { type: 'addText'; start: number; duration?: number; trackId?: string; text?: Partial<TextStyle> }
  | { type: 'addTexts'; trackName: string; items: { start: number; duration: number; content: string }[]; text: Partial<TextStyle> }
  | { type: 'detachAudio'; clipId: string }
  | { type: 'addStems'; sourceClipId: string; items: { label: string; media: Media }[]; muteOriginal: boolean }
  | { type: 'updateClip'; id: string; patch: Partial<Clip> }
  | { type: 'setSpeed'; id: string; speed: number }
  | { type: 'toggleMarker'; t: number }
  | { type: 'updateMarker'; id: string; patch: Partial<Marker> }
  | { type: 'removeMarker'; id: string }
  | { type: 'insertClips'; clips: Clip[] }
  | { type: 'removeClips'; ids: string[] }
  | { type: 'split'; time: number; ids: string[] }
  | { type: 'addTrack'; kind: TrackKind }
  | { type: 'updateTrack'; id: string; patch: Partial<Track> }
  | { type: 'removeTrack'; id: string }
  | { type: 'settings'; patch: Partial<Pick<Project, 'width' | 'height' | 'fps'>> }

function overlaps(p: Project, trackId: string, start: number, duration: number, ignore?: string) {
  return p.clips.some(
    (c) => c.trackId === trackId && c.id !== ignore && start < c.start + c.duration - 1e-6 && c.start < start + duration - 1e-6,
  )
}

/** Encontra (ou cria) uma trilha compatível e livre no intervalo pedido. */
function trackFor(p: Project, kind: TrackKind, start: number, duration: number, preferred?: string, topmost = false): [Project, string] {
  const pref = p.tracks.find((t) => t.id === preferred && t.kind === kind)
  if (pref && !overlaps(p, pref.id, start, duration)) return [p, pref.id]
  const ordered = kind === 'video' && !topmost ? [...p.tracks].reverse() : p.tracks
  const free = ordered.find((t) => t.kind === kind && !overlaps(p, t.id, start, duration))
  if (free) return [p, free.id]
  const track = nextTrack(p, kind)
  return [{ ...p, tracks: kind === 'video' ? [track, ...p.tracks] : [...p.tracks, track] }, track.id]
}

function nextTrack(p: Project, kind: TrackKind): Track {
  const count = p.tracks.filter((t) => t.kind === kind).length + 1
  return makeTrack(kind, `${kind === 'video' ? 'Vídeo' : 'Áudio'} ${count}`)
}

export function reduce(p: Project, a: Action): Project {
  switch (a.type) {
    case 'load':
      return normalizeProject(a.project)
    case 'addMedia': {
      const media = { ...p.media }
      for (const m of a.media) media[m.id] = m
      return { ...p, media }
    }
    case 'updateMedia': {
      const m = p.media[a.id]
      if (!m) return p
      return { ...p, media: { ...p.media, [a.id]: { ...m, ...a.patch } } }
    }
    case 'removeMedia': {
      const media = { ...p.media }
      delete media[a.mediaId]
      return { ...p, media, clips: p.clips.filter((c) => c.mediaId !== a.mediaId) }
    }
    case 'addClip': {
      const m = p.media[a.mediaId]
      if (!m) return p
      const duration = m.kind === 'image' ? IMAGE_DURATION : m.duration
      const [next, trackId] = trackFor(p, m.kind === 'audio' ? 'audio' : 'video', a.start, duration, a.trackId)
      const clip: Clip = { ...clipDefaults(), id: uid(), mediaId: m.id, trackId, start: Math.max(0, a.start), in: 0, duration }
      return { ...next, clips: [...next.clips, clip] }
    }
    case 'addText': {
      const duration = a.duration ?? 3
      const [next, trackId] = trackFor(p, 'video', a.start, duration, a.trackId, true)
      const clip: Clip = { ...clipDefaults(), id: uid(), mediaId: null, trackId, start: Math.max(0, a.start), in: 0, duration, text: { ...defaultText(), ...a.text } }
      return { ...next, clips: [...next.clips, clip] }
    }
    case 'addTexts': {
      const track = makeTrack('video', a.trackName)
      const clips: Clip[] = a.items.map((it) => ({
        ...clipDefaults(),
        id: uid(),
        mediaId: null,
        trackId: track.id,
        start: it.start,
        in: 0,
        duration: Math.max(MIN_CLIP, it.duration),
        text: { ...defaultText(), ...a.text, content: it.content },
      }))
      return { ...p, tracks: [track, ...p.tracks], clips: [...p.clips, ...clips] }
    }
    case 'detachAudio': {
      // Copia o áudio do clipe de vídeo para uma trilha de áudio, no mesmo ponto, e silencia o vídeo.
      const source = p.clips.find((c) => c.id === a.clipId)
      const m = source?.mediaId ? p.media[source.mediaId] : undefined
      if (!source || !m || m.kind !== 'video' || !m.hasAudio || source.audioDetached) return p
      const [next, trackId] = trackFor(p, 'audio', source.start, source.duration)
      const audio: Clip = {
        ...clipDefaults(),
        id: uid(),
        mediaId: m.id,
        trackId,
        start: source.start,
        in: source.in,
        duration: source.duration,
        volume: source.volume,
        fadeIn: source.fadeIn,
        fadeOut: source.fadeOut,
        volumeKeys: source.volumeKeys,
        speed: source.speed,
      }
      return {
        ...next,
        clips: [...next.clips.map((c) => (c.id === source.id ? { ...c, audioDetached: true, volume: 0, fadeIn: 0, fadeOut: 0, volumeKeys: [] } : c)), audio],
      }
    }
    case 'addStems': {
      // Uma trilha de áudio por faixa separada, alinhada com o clipe de origem.
      const source = p.clips.find((c) => c.id === a.sourceClipId)
      if (!source) return p
      const media = { ...p.media }
      const tracks: Track[] = []
      const clips: Clip[] = []
      for (const { label, media: m } of a.items) {
        media[m.id] = m
        const track = makeTrack('audio', label)
        tracks.push(track)
        clips.push({ ...clipDefaults(), id: uid(), mediaId: m.id, trackId: track.id, start: source.start, in: 0, duration: Math.min(source.duration, m.duration || source.duration) })
      }
      const sourceIndex = p.tracks.findIndex((t) => t.id === source.trackId)
      const at = p.tracks[sourceIndex]?.kind === 'audio' ? sourceIndex + 1 : p.tracks.length
      return {
        ...p,
        media,
        tracks: [...p.tracks.slice(0, at), ...tracks, ...p.tracks.slice(at)],
        clips: [...p.clips.map((c) => (c.id === source.id && a.muteOriginal ? { ...c, volume: 0 } : c)), ...clips],
      }
    }
    case 'updateClip': {
      const clip = p.clips.find((c) => c.id === a.id)
      if (!clip) return p
      const updated = { ...clip, ...a.patch }
      updated.start = Math.max(0, updated.start)
      updated.duration = Math.max(MIN_CLIP, updated.duration)
      if (overlaps(p, updated.trackId, updated.start, updated.duration, clip.id)) return p
      return { ...p, clips: p.clips.map((c) => (c.id === a.id ? updated : c)) }
    }
    case 'toggleMarker': {
      // Um marcador no instante (±0,05 s) é removido; senão, cria um novo.
      const markers = p.markers ?? []
      const near = markers.find((m) => Math.abs(m.t - a.t) < 0.05)
      if (near) return { ...p, markers: markers.filter((m) => m !== near) }
      const colors = ['#f5b544', '#2bd3c0', '#ec5c9b', '#4f7cff', '#a46bff']
      const marker: Marker = { id: uid(), t: Math.max(0, a.t), label: `Marcador ${markers.length + 1}`, color: colors[markers.length % colors.length] }
      return { ...p, markers: [...markers, marker].sort((x, y) => x.t - y.t) }
    }
    case 'updateMarker':
      return { ...p, markers: (p.markers ?? []).map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)).sort((x, y) => x.t - y.t) }
    case 'removeMarker':
      return { ...p, markers: (p.markers ?? []).filter((m) => m.id !== a.id) }
    case 'setSpeed': {
      // Mantém o mesmo trecho da mídia: a duração na timeline muda na proporção inversa.
      const clip = p.clips.find((c) => c.id === a.id)
      if (!clip) return p
      const speed = Math.min(4, Math.max(0.25, a.speed))
      const ratio = (clip.speed || 1) / speed
      const nextStart = Math.min(...p.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clip.start + clip.duration - 1e-6).map((c) => c.start), Infinity)
      const duration = Math.max(MIN_CLIP, Math.min(clip.duration * ratio, nextStart - clip.start))
      const scaled: Clip = {
        ...clip,
        speed,
        duration,
        keyframes: mapKeyframes(clip, (keys) => shiftKeys(keys, 0, ratio)),
        volumeKeys: shiftKeys(clip.volumeKeys, 0, ratio),
      }
      return { ...p, clips: p.clips.map((c) => (c.id === clip.id ? scaled : c)) }
    }
    case 'insertClips': {
      // Cola/duplica: tenta a trilha original; se estiver ocupada, usa outra livre do mesmo tipo.
      let next = p
      const placed: Clip[] = []
      for (const c of a.clips) {
        const kind = p.tracks.find((t) => t.id === c.trackId)?.kind ?? (c.mediaId && p.media[c.mediaId]?.kind === 'audio' ? 'audio' : 'video')
        const busy = (q: Project, trackId: string) => overlaps(q, trackId, c.start, c.duration) || placed.some((o) => o.trackId === trackId && c.start < o.start + o.duration - 1e-6 && o.start < c.start + c.duration - 1e-6)
        let trackId = c.trackId
        if (!next.tracks.some((t) => t.id === trackId) || busy(next, trackId)) {
          const free = next.tracks.find((t) => t.kind === kind && !busy(next, t.id))
          if (free) trackId = free.id
          else {
            const track = nextTrack(next, kind)
            next = { ...next, tracks: kind === 'video' ? [track, ...next.tracks] : [...next.tracks, track] }
            trackId = track.id
          }
        }
        placed.push({ ...c, trackId, start: Math.max(0, c.start) })
      }
      return { ...next, clips: [...next.clips, ...placed] }
    }
    case 'removeClips':
      return { ...p, clips: p.clips.filter((c) => !a.ids.includes(c.id)) }
    case 'split': {
      const clips: Clip[] = []
      for (const c of p.clips) {
        const offset = a.time - c.start
        if (a.ids.includes(c.id) && offset > MIN_CLIP && offset < c.duration - MIN_CLIP) {
          // Cada metade fica só com a transição/fade do seu lado e com os keyframes que lhe cabem.
          const keysA = c.volumeKeys.filter((k) => k.t <= offset)
          const keysB = c.volumeKeys.filter((k) => k.t >= offset).map((k) => ({ ...k, t: k.t - offset }))
          clips.push({ ...c, duration: offset, fadeOut: 0, transitionOut: { ...c.transitionOut, type: 'none' }, volumeKeys: keysA })
          clips.push({
            ...c,
            id: uid(),
            start: a.time,
            in: c.mediaId ? c.in + offset * (c.speed || 1) : 0,
            duration: c.duration - offset,
            fadeIn: 0,
            transitionIn: { ...c.transitionIn, type: 'none' },
            volumeKeys: keysB,
            // Mantém todos os keyframes (deslocados) para a animação continuar sem salto.
            keyframes: mapKeyframes(c, (keys) => shiftKeys(keys, offset)),
          })
        } else {
          clips.push(c)
        }
      }
      return { ...p, clips }
    }
    case 'addTrack': {
      const track = nextTrack(p, a.kind)
      return { ...p, tracks: a.kind === 'video' ? [track, ...p.tracks] : [...p.tracks, track] }
    }
    case 'updateTrack':
      return { ...p, tracks: p.tracks.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)) }
    case 'removeTrack':
      return { ...p, tracks: p.tracks.filter((t) => t.id !== a.id), clips: p.clips.filter((c) => c.trackId !== a.id) }
    case 'settings':
      return { ...p, ...a.patch }
  }
}

interface History {
  past: Project[]
  present: Project
  future: Project[]
}

type HistoryAction = { type: 'do'; action: Action; merge?: boolean } | { type: 'undo' } | { type: 'redo' } | { type: 'checkpoint' }

const LIMIT = 200

function historyReducer(h: History, a: HistoryAction): History {
  switch (a.type) {
    case 'undo':
      if (!h.past.length) return h
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
    case 'redo':
      if (!h.future.length) return h
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
    case 'checkpoint':
      return { past: [...h.past, h.present].slice(-LIMIT), present: h.present, future: [] }
    case 'do': {
      const next = reduce(h.present, a.action)
      if (next === h.present) return h
      // `merge` aplica a mudança sem nova entrada (ex.: arrastar um clipe após um checkpoint).
      if (a.merge) return { ...h, present: next, future: [] }
      if (a.action.type === 'load') return { past: [], present: next, future: [] }
      // Proxies não são uma edição do usuário: não entram no histórico.
      if (a.action.type === 'updateMedia') {
        return { past: h.past.map((p) => reduce(p, a.action)), present: next, future: h.future.map((p) => reduce(p, a.action)) }
      }
      return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] }
    }
  }
}

export function useProject() {
  const [h, send] = useReducer(historyReducer, undefined, () => ({ past: [], present: newProject(), future: [] }))
  const dispatch = useCallback((action: Action, merge = false) => send({ type: 'do', action, merge }), [])
  const undo = useCallback(() => send({ type: 'undo' }), [])
  const redo = useCallback(() => send({ type: 'redo' }), [])
  const checkpoint = useCallback(() => send({ type: 'checkpoint' }), [])
  return { project: h.present, dispatch, undo, redo, checkpoint, canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}
