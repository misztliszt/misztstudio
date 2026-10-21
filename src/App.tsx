import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FolderOpen,
  Gauge,
  Home,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Rows3,
  Save,
  Scissors,
  ScissorsLineDashed,
  SlidersHorizontal,
  SlidersVertical,
  Sparkles,
  Split,
  Trash2,
  Type,
  Undo2,
  Upload,
  Zap,
  Drum,
  Flag,
  TrendingUp,
  Snowflake,
  Rewind,
  BetweenHorizontalStart,
  Eraser,
  AudioWaveform,
  Plug,
  Mic,
  MonitorPlay,
  History as HistoryIcon,
  Settings,
} from 'lucide-react'
import type { Clip } from './types'
import { defaultTransform } from './anim'
import { clock } from './clock'
import { ExportDialog } from './components/ExportDialog'
import { Intro } from './components/Intro'
import { LinkImportDialog } from './components/LinkImportDialog'
import { BgRemoveDialog } from './components/BgRemoveDialog'
import { VstDialog } from './components/VstDialog'
import { RecordDialog } from './components/RecordDialog'
import { ExportQueue } from './components/ExportQueue'
import { HistoryPanel } from './components/HistoryPanel'
import { PreferencesDialog } from './components/PreferencesDialog'
import { buildKeymap, comboOf, shortcutLabel, type ShortcutId } from './shortcuts'
import { ScreenRecordDialog } from './components/ScreenRecordDialog'
import { detectBeats } from './beats'
import { getPeaks } from './waveform'
import type { ExportOptions } from './types'
import { ContextMenu, type MenuItem, type MenuState } from './ui/ContextMenu'
import { PlaybackEngine } from './engine'
import { projectDuration, SPEED_RAMPS, uid, useProject, type Template } from './store'
import type { AppSettings, ExportPayload, Media, ProbeResult, Project, UpdateStatus } from './types'
import { colorMatrix } from './color'
import { FRAME_ANIMATIONS, renderTextPng, renderTextSequence } from './text'
import { MediaBin } from './components/MediaBin'
import { Preview } from './components/Preview'
import { Timeline } from './components/Timeline'
import { Inspector } from './components/Inspector'
import { Mixer } from './components/Mixer'
import { CaptionsDialog } from './components/Dialogs'
import { StemsDialog } from './components/StemsDialog'
import { Welcome } from './components/Welcome'
import { IconButton, Segmented } from './components/controls'
import { useFeedback } from './ui/feedback'
import logoUrl from '../build/icon.png'

/** Codecs que o Chromium decodifica bem; outros (HEVC, ProRes…) precisam de proxy. */
const PLAYABLE = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora', 'mpeg4'])
const needsProxy = (m: Media, mode: AppSettings['proxyMode'] = 'auto') =>
  m.kind === 'video' && !m.proxy && mode !== 'never' && (mode === 'always' || (m.codec && !PLAYABLE.has(m.codec)) || m.width * m.height > 1920 * 1080 * 1.1)
const errorText = (err: unknown) => String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function App() {
  const { project, history, dispatch, undo, redo, checkpoint, jump, canUndo, canRedo } = useProject()
  const { toast, confirm } = useFeedback()
  const [screen, setScreen] = useState<'loading' | 'welcome' | 'editor'>('loading')
  const [showIntro, setShowIntro] = useState(true)
  const [recovery, setRecovery] = useState<{ json: string; savedAt: number } | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null)
  const [zoom, setZoom] = useState(40)
  const [bottom, setBottom] = useState<'timeline' | 'mixer'>('timeline')
  const [dialog, setDialog] = useState<'captions' | null>(null)
  const [stemsClip, setStemsClip] = useState<string | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [bgClip, setBgClip] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [savedProject, setSavedProject] = useState<Project | null>(null)
  const [proxyProgress, setProxyProgress] = useState<Record<string, number>>({})
  const engine = useMemo(() => new PlaybackEngine(), [])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const shortcuts = settings?.shortcuts
  const key = useCallback((id: ShortcutId) => shortcutLabel(id, shortcuts), [shortcuts])

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
  }, [])
  const changeSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    setSettings(await window.api.setSettings(patch))
  }, [])
  useEffect(() => engine.setQuality(settings?.previewQuality === 'half' ? 0.5 : settings?.previewQuality === 'quarter' ? 0.25 : 1), [engine, settings?.previewQuality])
  const duration = projectDuration(project)

  // Relógio de reprodução: o cursor (clock) anda a cada quadro fora do React;
  // o estado `time` do app só é atualizado algumas vezes por segundo durante a reprodução.
  const anchor = useRef({ startNow: 0, startTime: 0 })
  useEffect(() => {
    if (!playing) return
    anchor.current = { startNow: performance.now(), startTime: time }
    let raf = 0
    let lastState = 0
    const loop = (now: number) => {
      const t = anchor.current.startTime + (now - anchor.current.startNow) / 1000
      if (t >= duration) {
        clock.set(duration)
        setTime(duration)
        setPlaying(false)
        return
      }
      clock.set(t)
      engine.update(t, true)
      if (now - lastState > 150) {
        lastState = now
        setTime(t)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // `time` só serve de ponto de partida quando a reprodução começa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration])

  useEffect(() => engine.setProject(project), [engine, project])
  useEffect(() => {
    if (!playing) engine.update(time, false)
  }, [engine, time, playing])
  useEffect(() => {
    if (playing) engine.update(clock.get(), true)
  }, [engine, playing])
  useEffect(() => () => engine.dispose(), [engine])

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, t)
    anchor.current = { startNow: performance.now(), startTime: clamped }
    clock.set(clamped)
    setTime(clamped)
  }, [])

  const togglePlay = useCallback(() => {
    if (duration <= 0) return
    if (playing) {
      // Para exatamente na posição do relógio, não no último quadro desenhado.
      seek(Math.min(duration, anchor.current.startTime + (performance.now() - anchor.current.startNow) / 1000))
      setPlaying(false)
    } else {
      if (time >= duration - 0.01) seek(0)
      setPlaying(true)
    }
  }, [duration, time, playing, seek])

  // ---------- Proxies ----------
  useEffect(() => window.api.onProxyProgress((path, value) => setProxyProgress((p) => (path in p ? { ...p, [path]: value } : p))), [])

  const requestProxy = useCallback(
    (m: Pick<Media, 'id' | 'path' | 'name'>) => {
      setProxyProgress((p) => ({ ...p, [m.path]: 0 }))
      window.api
        .makeProxy(m.path)
        .then((url) => {
          dispatch({ type: 'updateMedia', id: m.id, patch: { proxy: url } })
          toast.success('Proxy pronto', { detail: `${m.name} agora roda leve na prévia.` })
        })
        .catch((err) => toast.error('Não foi possível gerar o proxy', { detail: `${m.name}: ${errorText(err)}` }))
        .finally(() =>
          setProxyProgress((p) => {
            const next = { ...p }
            delete next[m.path]
            return next
          }),
        )
    },
    [dispatch, toast],
  )

  const addProbed = useCallback(
    (results: ProbeResult[]) => {
      const fresh: Media[] = []
      const errors: string[] = []
      const known = new Set(Object.values(project.media).map((m) => m.path))
      for (const r of results) {
        if (!r.ok) errors.push(`${r.path.split(/[\\/]/).pop()}: ${r.error}`)
        else if (!known.has(r.media.path)) fresh.push({ ...r.media, id: uid() })
      }
      if (fresh.length) {
        dispatch({ type: 'addMedia', media: fresh })
        toast.success(fresh.length === 1 ? 'Mídia importada' : `${fresh.length} mídias importadas`, { detail: fresh.map((m) => m.name).join(', ') })
      }
      for (const m of fresh) if (needsProxy(m, settings?.proxyMode)) requestProxy(m)
      if (errors.length) toast.error('Alguns arquivos não foram importados', { detail: errors.join(' · ') })
    },
    [project.media, dispatch, requestProxy, toast, settings?.proxyMode],
  )

  const importMedia = async () => addProbed(await window.api.importMedia())

  // ---------- Edição ----------
  const split = useCallback(() => {
    const under = project.clips.filter((c) => time > c.start && time < c.start + c.duration)
    const ids = selection.length ? under.filter((c) => selection.includes(c.id)).map((c) => c.id) : under.map((c) => c.id)
    if (ids.length) dispatch({ type: 'split', time, ids })
  }, [project.clips, selection, time, dispatch])

  const removeSelected = useCallback(() => {
    if (!selection.length) return
    dispatch({ type: 'removeClips', ids: selection })
    setSelection([])
  }, [selection, dispatch])

  const addText = useCallback(
    (at = time, trackId?: string) => {
      dispatch({ type: 'addText', start: at, trackId })
      setSelectedTrack(null)
    },
    [dispatch, time],
  )

  // ---------- Área de transferência (clipes) ----------
  const clipboard = useRef<Clip[]>([])
  const [clipboardSize, setClipboardSize] = useState(0)

  const copySelection = useCallback(
    (ids = selection) => {
      const clips = project.clips.filter((c) => ids.includes(c.id))
      if (!clips.length) return false
      clipboard.current = structuredClone(clips)
      setClipboardSize(clips.length)
      return true
    },
    [project.clips, selection],
  )

  /** Cola os clipes copiados a partir de `at`, mantendo as distâncias entre eles. */
  const paste = useCallback(
    (at = time, trackId?: string) => {
      const src = clipboard.current
      if (!src.length) return
      const first = Math.min(...src.map((c) => c.start))
      const targetKind = trackId ? project.tracks.find((t) => t.id === trackId)?.kind : undefined
      const clips = src.map((c) => {
        const kind = project.tracks.find((t) => t.id === c.trackId)?.kind
        return { ...structuredClone(c), id: uid(), start: at + (c.start - first), trackId: trackId && targetKind === kind ? trackId : c.trackId }
      })
      dispatch({ type: 'insertClips', clips })
      setSelection(clips.map((c) => c.id))
    },
    [time, project.tracks, dispatch],
  )

  const duplicate = useCallback(
    (ids = selection) => {
      const src = project.clips.filter((c) => ids.includes(c.id))
      if (!src.length) return
      const first = Math.min(...src.map((c) => c.start))
      const last = Math.max(...src.map((c) => c.start + c.duration))
      const clips = src.map((c) => ({ ...structuredClone(c), id: uid(), start: last + (c.start - first) }))
      dispatch({ type: 'insertClips', clips })
      setSelection(clips.map((c) => c.id))
    },
    [project.clips, selection, dispatch],
  )

  const cut = useCallback(
    (ids = selection) => {
      if (!copySelection(ids)) return
      dispatch({ type: 'removeClips', ids })
      setSelection([])
    },
    [copySelection, selection, dispatch],
  )

  // ---------- Edição rápida ----------
  const rippleDelete = useCallback(
    (ids = selection) => {
      if (!ids.length) return
      dispatch({ type: 'rippleDelete', ids })
      setSelection([])
    },
    [selection, dispatch],
  )

  const freezeFrame = useCallback(
    async (clip: Clip) => {
      const media = clip.mediaId ? project.media[clip.mediaId] : undefined
      if (!media || media.kind !== 'video') return
      const at = time > clip.start && time < clip.start + clip.duration ? time : clip.start
      const src = clip.in + (at - clip.start) * (clip.speed || 1)
      const r = await window.api.extractFrame(media.path, src)
      if (!r.ok) {
        toast.error('Não foi possível congelar o quadro', { detail: r.error })
        return
      }
      dispatch({ type: 'freezeFrame', clipId: clip.id, at, media: { ...r.media, id: uid(), name: `Quadro de ${media.name}` }, duration: 2 })
      toast.success('Quadro congelado', { detail: '2 s de imagem parada inseridos no cursor.' })
    },
    [project.media, time, dispatch, toast],
  )

  const [reversing, setReversing] = useState<string | null>(null)
  const reverseClip = useCallback(
    async (clip: Clip) => {
      const media = clip.mediaId ? project.media[clip.mediaId] : undefined
      if (!media || media.kind !== 'video' || reversing) return
      setReversing(clip.id)
      toast.info('Invertendo o clipe…', { detail: 'Pode levar alguns segundos em clipes longos.', duration: 3000 })
      try {
        const r = await window.api.reverseMedia(media.path, clip.in, clip.duration * (clip.speed || 1), media.hasAudio)
        if (!r.ok) throw new Error(r.error)
        dispatch({ type: 'replaceClipMedia', clipId: clip.id, media: { ...r.media, id: uid(), name: `${media.name} (reverso)` } })
        toast.success('Clipe invertido')
      } catch (err) {
        toast.error('Não foi possível inverter', { detail: errorText(err) })
      } finally {
        setReversing(null)
      }
    },
    [project.media, reversing, dispatch, toast],
  )

  // ---------- Áudio de estúdio ----------
  const [vstClip, setVstClip] = useState<string | null>(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [screenOpen, setScreenOpen] = useState(false)

  /** Usa um áudio processado do trecho do clipe: em vídeo, separa o áudio; em áudio, troca a mídia. */
  const applyProcessedAudio = useCallback(
    (clip: Clip, r: ProbeResult, suffix: string) => {
      const media = clip.mediaId ? project.media[clip.mediaId] : undefined
      if (!media || !r.ok) {
        toast.error('Não foi possível processar o áudio', { detail: r.ok ? undefined : r.error })
        return false
      }
      const processed = { ...r.media, id: uid(), name: `${media.name} (${suffix})` }
      if (media.kind === 'video') dispatch({ type: 'detachAudio', clipId: clip.id, media: processed })
      else dispatch({ type: 'replaceClipMedia', clipId: clip.id, media: processed })
      return true
    },
    [project.media, dispatch, toast],
  )

  const cleanVoice = useCallback(
    async (clip: Clip, level: 'light' | 'medium' | 'strong') => {
      const media = clip.mediaId ? project.media[clip.mediaId] : undefined
      if (!media) return
      toast.info('Limpando a voz…', { duration: 2500 })
      try {
        const r = await window.api.cleanAudio(media.path, clip.in, clip.duration * (clip.speed || 1), level)
        if (applyProcessedAudio(clip, r, 'voz limpa')) toast.success('Ruído removido', { detail: media.kind === 'video' ? 'O áudio limpo foi para uma trilha de áudio.' : undefined })
      } catch (err) {
        toast.error('Não foi possível limpar a voz', { detail: errorText(err) })
      }
    },
    [project.media, applyProcessedAudio, toast],
  )

  // ---------- Batidas ----------
  const detectBeatsFor = useCallback(
    async (mediaId: string) => {
      const media = project.media[mediaId]
      if (!media) return
      toast.info('Analisando o ritmo…', { detail: media.name, duration: 2000 })
      const peaks = await getPeaks(media)
      const grid = peaks ? detectBeats(peaks) : null
      if (!grid) {
        toast.warning('Não encontrei um ritmo claro', { detail: 'A detecção funciona melhor em músicas com batida marcada.' })
        return
      }
      dispatch({ type: 'updateMedia', id: mediaId, patch: { beats: grid } })
      toast.success(`${grid.bpm} BPM`, { detail: 'As batidas aparecem no clipe e os cortes grudam nelas.' })
    },
    [project.media, dispatch, toast],
  )

  // ---------- Menus de contexto ----------
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const openClipMenu = (e: React.MouseEvent, clip: Clip) => {
    e.preventDefault()
    e.stopPropagation()
    const ids = selection.includes(clip.id) ? selection : [clip.id]
    setSelection(ids)
    setSelectedTrack(null)
    const media = clip.mediaId ? project.media[clip.mediaId] : undefined
    const inside = time > clip.start && time < clip.start + clip.duration
    const timed = media && media.kind !== 'image'
    const audible = media && media.kind !== 'image' && media.hasAudio && !clip.audioDetached
    const visual = media && media.kind !== 'audio'
    const items: MenuItem[] = [
      { label: 'Copiar', icon: Copy, shortcut: 'Ctrl+C', onClick: () => copySelection(ids) },
      { label: 'Recortar', icon: ScissorsLineDashed, shortcut: 'Ctrl+X', onClick: () => cut(ids) },
      { label: 'Colar no cursor', icon: ClipboardPaste, shortcut: 'Ctrl+V', disabled: !clipboardSize, onClick: () => paste() },
      { label: 'Duplicar', icon: CopyPlus, shortcut: 'Ctrl+D', onClick: () => duplicate(ids) },
      { separator: true },
      { label: 'Dividir no cursor', icon: Scissors, shortcut: 'S', disabled: !inside, onClick: () => dispatch({ type: 'split', time, ids: [clip.id] }) },
    ]
    if (timed) {
      items.push({
        label: 'Velocidade',
        icon: Gauge,
        submenu: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((s) => ({ label: `${s}×`, checked: Math.abs((clip.speed || 1) - s) < 1e-3, onClick: () => dispatch({ type: 'setSpeed', id: clip.id, speed: s }) })),
      })
      items.push({ label: 'Rampa de velocidade', icon: TrendingUp, submenu: SPEED_RAMPS.map((r) => ({ label: r.name, onClick: () => dispatch({ type: 'speedRamp', clipId: clip.id, factors: r.factors }) })) })
    }
    if (media?.kind === 'video') {
      items.push({ label: 'Congelar quadro no cursor', icon: Snowflake, onClick: () => void freezeFrame(clip) })
      items.push({ label: 'Inverter (reverso)', icon: Rewind, disabled: !!reversing, onClick: () => void reverseClip(clip) })
      items.push({ label: 'Remover fundo (IA)…', icon: Eraser, onClick: () => setBgClip(clip.id) })
    }
    if (media?.kind === 'video' && media.hasAudio && !clip.audioDetached) items.push({ label: 'Separar áudio do vídeo', icon: Split, onClick: () => dispatch({ type: 'detachAudio', clipId: clip.id }) })
    if (audible) items.push({ label: 'Separar voz e instrumentos…', icon: Sparkles, onClick: () => setStemsClip(clip.id) })
    if (audible) {
      items.push({ label: 'Limpar voz (remover ruído)', icon: AudioWaveform, submenu: [
        { label: 'Leve', onClick: () => void cleanVoice(clip, 'light') },
        { label: 'Média', onClick: () => void cleanVoice(clip, 'medium') },
        { label: 'Forte', onClick: () => void cleanVoice(clip, 'strong') },
      ] })
      items.push({ label: 'Plugin VST3…', icon: Plug, onClick: () => setVstClip(clip.id) })
    }
    if (audible && media) items.push({ label: media.beats ? `Batidas: ${media.beats.bpm} BPM (detectar de novo)` : 'Detectar batidas', icon: Drum, onClick: () => detectBeatsFor(media.id) })
    if (visual) {
      items.push({ separator: true })
      items.push({ label: 'Restaurar transformação', icon: RotateCcw, onClick: () => dispatch({ type: 'updateClip', id: clip.id, patch: { transform: defaultTransform(), keyframes: {} } }) })
    }
    items.push(
      { separator: true },
      { label: 'Excluir e fechar o buraco', icon: BetweenHorizontalStart, shortcut: 'Shift+Del', danger: true, onClick: () => rippleDelete(ids) },
      { label: ids.length > 1 ? `Excluir ${ids.length} clipes` : 'Excluir', icon: Trash2, shortcut: 'Del', danger: true, onClick: () => dispatch({ type: 'removeClips', ids }) },
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const openTimelineMenu = (e: React.MouseEvent, clip: Clip | null, trackId: string, at: number) => {
    if (clip) return openClipMenu(e, clip)
    e.preventDefault()
    const track = project.tracks.find((t) => t.id === trackId)
    if (!track) return
    const sameKind = project.tracks.filter((t) => t.kind === track.kind).length
    const items: MenuItem[] = [
      { label: clipboardSize > 1 ? `Colar ${clipboardSize} clipes aqui` : 'Colar aqui', icon: ClipboardPaste, disabled: !clipboardSize, onClick: () => paste(at, trackId) },
    ]
    if (track.kind === 'video') items.push({ label: 'Adicionar texto aqui', icon: Type, onClick: () => addText(at, trackId) })
    items.push(
      { separator: true },
      { label: 'Mover o cursor para cá', icon: MousePointer2, onClick: () => seek(at) },
      { label: 'Marcador aqui', icon: Flag, shortcut: 'M', onClick: () => dispatch({ type: 'toggleMarker', t: at }) },
      { label: 'Efeitos da trilha', icon: SlidersHorizontal, onClick: () => setSelectedTrack(trackId) },
      { separator: true },
      { label: 'Remover trilha', icon: Trash2, danger: true, disabled: sameKind <= 1, onClick: () => dispatch({ type: 'removeTrack', id: trackId }) },
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const openMediaMenu = (e: React.MouseEvent, media: Media) => {
    e.preventDefault()
    const items: MenuItem[] = [{ label: 'Adicionar no cursor', icon: Plus, onClick: () => dispatch({ type: 'addClip', mediaId: media.id, start: time }) }]
    if (media.kind === 'video' && !media.proxy && proxyProgress[media.path] === undefined) items.push({ label: 'Gerar proxy', icon: Zap, onClick: () => requestProxy(media) })
    items.push(
      { label: 'Mostrar na pasta', icon: FolderOpen, onClick: () => void window.api.showInFolder(media.path) },
      { separator: true },
      { label: 'Remover do projeto', icon: Trash2, danger: true, onClick: () => dispatch({ type: 'removeMedia', mediaId: media.id }) },
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Seleciona o clipe de texto recém-criado.
  const lastClipCount = useRef(project.clips.length)
  useEffect(() => {
    if (project.clips.length === lastClipCount.current + 1) {
      const last = project.clips[project.clips.length - 1]
      if (last.text) setSelection([last.id])
    }
    lastClipCount.current = project.clips.length
  }, [project.clips])

  // ---------- Arquivo ----------
  const dirty = savedProject !== project && (project.clips.length > 0 || Object.keys(project.media).length > 0)
  const projectName = filePath ? filePath.split(/[\\/]/).pop()!.replace(/\.edproj$/i, '') : 'Sem título'

  const save = useCallback(
    async (saveAs = false) => {
      const target = await window.api.saveProject(JSON.stringify(project, null, 2), saveAs ? null : filePath)
      if (target) {
        setFilePath(target)
        setSavedProject(project)
        void window.api.autosave(null)
        toast.success('Projeto salvo', { detail: target, duration: 2500 })
      }
    },
    [project, filePath, toast],
  )

  // O projeto normalizado só existe depois do `load`; marca-o como salvo nesse momento.
  const markSaved = useRef(false)
  useEffect(() => {
    if (markSaved.current) {
      markSaved.current = false
      setSavedProject(project)
    }
  }, [project])

  const loadProject = useCallback(
    (loaded: Project, path: string | null, saved: boolean) => {
      setPlaying(false)
      markSaved.current = saved
      dispatch({ type: 'load', project: loaded })
      setSelection([])
      setSelectedTrack(null)
      seek(0)
      setFilePath(path)
      setScreen('editor')
    },
    [dispatch, seek],
  )

  const parseProject = (json: string) => {
    const p = JSON.parse(json) as Project
    if (p.version !== 1 || !Array.isArray(p.tracks)) throw new Error('Arquivo de projeto inválido')
    return p
  }

  /** Pergunta antes de descartar alterações não salvas. */
  const canDiscard = useCallback(
    async () => !dirty || (await confirm({ title: 'Descartar alterações?', message: `As alterações em “${projectName}” ainda não foram salvas.`, confirmLabel: 'Descartar', danger: true })),
    [dirty, confirm, projectName],
  )

  const open = async () => {
    if (!(await canDiscard())) return
    const res = await window.api.openProject()
    if (!res) return
    try {
      loadProject(parseProject(res.json), res.filePath, true)
    } catch (err) {
      toast.error('Não foi possível abrir o projeto', { detail: errorText(err) })
    }
  }

  const openRecent = async (path: string) => {
    if (!(await canDiscard())) return
    try {
      const res = await window.api.openProjectPath(path)
      loadProject(parseProject(res.json), res.filePath, true)
    } catch (err) {
      toast.error('Não foi possível abrir o projeto', { detail: errorText(err) })
    }
  }

  const newFromTemplate = async (t: Template) => {
    if (!(await canDiscard())) return
    loadProject(t.build(), null, true)
    setRecovery(null)
    void window.api.autosave(null)
  }

  // Início: projeto passado pelo sistema (duplo clique num .edproj) ou tela inicial.
  useEffect(() => {
    let alive = true
    void (async () => {
      const initial = await window.api.initialProject()
      if (!alive) return
      if (initial) {
        try {
          loadProject(parseProject(initial.json), initial.filePath, true)
          return
        } catch (err) {
          toast.error('Não foi possível abrir o projeto', { detail: errorText(err) })
        }
      }
      const saved = await window.api.readAutosave()
      if (!alive) return
      setRecovery(saved)
      setScreen('welcome')
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recover = () => {
    if (!recovery) return
    try {
      loadProject(parseProject(recovery.json), null, false)
      toast.info('Projeto recuperado', { detail: 'Salve-o para não perder as alterações.' })
    } catch {
      toast.error('O arquivo de recuperação está corrompido')
    }
    setRecovery(null)
  }

  // Autosave.
  const latest = useRef({ project, dirty })
  latest.current = { project, dirty }
  const autosaveMs = (settings?.autosaveSeconds ?? 20) * 1000
  useEffect(() => {
    const id = setInterval(() => {
      if (latest.current.dirty) void window.api.autosave(JSON.stringify(latest.current.project))
    }, autosaveMs)
    return () => clearInterval(id)
  }, [autosaveMs])

  // Atualização automática: avisa quando a versão nova já foi baixada.
  useEffect(
    () =>
      window.api.onUpdateStatus((st) => {
        setUpdate(st)
        if (st.state === 'ready')
          toast.info(`Miszt Studio ${st.version} está pronto`, {
            detail: 'Reinicie para instalar a atualização (ou ela entra ao fechar o app).',
            duration: 20000,
            action: { label: 'Reiniciar agora', run: () => void window.api.installUpdate() },
          })
      }),
    [toast],
  )

  // ---------- Exportação ----------
  const [exportOpen, setExportOpen] = useState(false)
  const exportVideo = () => {
    if (duration <= 0) {
      toast.warning('Nada para exportar', { detail: 'Adicione clipes à timeline primeiro.' })
      return
    }
    setPlaying(false)
    setExportOpen(true)
  }

  const runExport = async (options: ExportOptions) => {
    setExportOpen(false)
    const payload: ExportPayload = { project, textImages: {}, colorMatrices: {}, textSequences: {}, options }
    for (const c of project.clips) {
      if (c.text && FRAME_ANIMATIONS.has(c.text.animation)) payload.textSequences![c.id] = renderTextSequence(c.text, project.width, project.height, c.duration, project.fps)
      else if (c.text) payload.textImages[c.id] = renderTextPng(c.text, project.width, project.height)
      else if (c.color.saturation !== 1 || c.color.hue !== 0 || c.color.sepia !== 0) payload.colorMatrices[c.id] = colorMatrix(c.color)
    }
    try {
      const job = await window.api.exportVideo(payload)
      if (job) toast.info('Exportação na fila', { detail: 'Pode continuar editando; o progresso aparece no canto da janela.', duration: 3500 })
    } catch (err) {
      toast.error('A exportação falhou', { detail: errorText(err).slice(0, 300) })
    }
  }

  // ---------- Teclado ----------
  useEffect(() => {
    if (screen !== 'editor') return
    const keymap = buildKeymap(shortcuts)
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes((el as HTMLInputElement).type))) return
      if (dialog || stemsClip || document.querySelector('.modal')) return
      const combo = comboOf(e)
      const id = combo ? keymap.get(combo) : undefined
      if (!id) return
      switch (id) {
        case 'undo':
          undo()
          break
        case 'redo':
          redo()
          break
        case 'history':
          setHistoryOpen((o) => !o)
          break
        case 'save':
          save()
          break
        case 'saveAs':
          save(true)
          break
        case 'open':
          open()
          break
        case 'import':
          importMedia()
          break
        case 'export':
          exportVideo()
          break
        case 'preferences':
          setPrefsOpen(true)
          break
        case 'copy':
          copySelection()
          break
        case 'cut':
          cut()
          break
        case 'paste':
          paste()
          break
        case 'duplicate':
          duplicate()
          break
        case 'selectAll':
          setSelection(project.clips.map((c) => c.id))
          break
        case 'play':
          togglePlay()
          break
        case 'split':
          split()
          break
        case 'text':
          addText()
          break
        case 'rippleDelete':
          rippleDelete()
          break
        case 'delete':
          removeSelected()
          break
        case 'marker':
          dispatch({ type: 'toggleMarker', t: time })
          break
        case 'pause':
          if (playing) togglePlay()
          break
        case 'forwardPlay':
          if (!playing) togglePlay()
          break
        case 'back5':
          seek(time - 5)
          break
        case 'prevMarker':
        case 'nextMarker': {
          const ts = (project.markers ?? []).map((m) => m.t)
          const target = id === 'prevMarker' ? [...ts].reverse().find((t) => t < time - 0.01) : ts.find((t) => t > time + 0.01)
          if (target !== undefined) seek(target)
          break
        }
        case 'home':
          seek(0)
          break
        case 'end':
          seek(duration)
          break
        case 'frameBack':
          seek(time - 1 / project.fps)
          break
        case 'frameForward':
          seek(time + 1 / project.fps)
          break
        case 'secondBack':
          seek(time - 1)
          break
        case 'secondForward':
          seek(time + 1)
          break
        case 'deselect':
          setSelection([])
          setSelectedTrack(null)
          setHistoryOpen(false)
          break
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, undo, redo, save, togglePlay, split, addText, removeSelected, seek, time, duration, project.fps, dialog, stemsClip, shortcuts])

  // Mantém seleções coerentes com desfazer/refazer.
  useEffect(() => {
    setSelection((sel) => sel.filter((id) => project.clips.some((c) => c.id === id)))
    setSelectedTrack((t) => (t && project.tracks.some((x) => x.id === t) ? t : null))
  }, [project.clips, project.tracks])

  useEffect(() => {
    document.title = screen === 'editor' ? `${dirty ? '• ' : ''}${projectName} — Miszt Studio` : 'Miszt Studio'
  }, [screen, projectName, dirty])

  const selectClips = (ids: string[]) => {
    setSelection(ids)
    if (ids.length) setSelectedTrack(null)
  }

  const [hasProject, setHasProject] = useState(false)
  useEffect(() => {
    if (screen === 'editor') setHasProject(true)
  }, [screen])

  const goHome = () => {
    setPlaying(false)
    setScreen('welcome')
  }

  const isWin = window.api.platform === 'win32'

  return (
    <div
      className={`app ${screen !== 'editor' ? 'on-welcome' : ''} ${isWin ? 'win' : ''}`}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && screen === 'editor' && e.preventDefault()}
      onDrop={async (e) => {
        if (!e.dataTransfer.files.length || screen !== 'editor') return
        e.preventDefault()
        addProbed(await window.api.probeFiles(Array.from(e.dataTransfer.files)))
      }}
    >
      <header className="titlebar">
        <div className="brand">
          <img src={logoUrl} alt="" />
          {screen === 'editor' ? (
            <div className="project-title">
              <span className="project-name">{projectName}</span>
              <span className={`save-state ${dirty ? 'dirty' : ''}`}>{dirty ? 'Não salvo' : filePath ? 'Salvo' : ''}</span>
            </div>
          ) : (
            <span className="project-name">Miszt Studio</span>
          )}
        </div>
        {screen === 'editor' && (
          <>
            <div className="tool-group">
              <IconButton icon={Home} label="Início" onClick={goHome} />
              <IconButton icon={FolderOpen} label="Abrir projeto" shortcut={key('open')} onClick={open} />
              <IconButton icon={Save} label="Salvar" shortcut={key('save')} onClick={() => save()} />
              <IconButton icon={Settings} label="Preferências" shortcut={key('preferences')} onClick={() => setPrefsOpen(true)} />
            </div>
            <div className="tool-group">
              <IconButton icon={Undo2} label="Desfazer" shortcut={key('undo')} onClick={undo} disabled={!canUndo} />
              <IconButton icon={Redo2} label="Refazer" shortcut={key('redo')} onClick={redo} disabled={!canRedo} />
              <IconButton icon={HistoryIcon} label="Histórico" shortcut={key('history')} onClick={() => setHistoryOpen((o) => !o)} active={historyOpen} />
            </div>
            <div className="tool-group">
              <IconButton icon={Scissors} label="Dividir no cursor" shortcut={key('split')} onClick={split} />
              <IconButton icon={Trash2} label="Excluir seleção" shortcut={key('delete')} onClick={removeSelected} disabled={!selection.length} />
            </div>
            <div className="tool-group">
              <IconButton icon={Type} label="Texto" shortcut={key('text')} onClick={() => addText()} showLabel />
              <IconButton icon={Captions} label="Legendas" onClick={() => setDialog('captions')} showLabel />
              <IconButton icon={Mic} label="Gravar" onClick={() => { setPlaying(false); setRecordOpen(true) }} showLabel />
              <IconButton icon={MonitorPlay} label="Gravar tela" onClick={() => { setPlaying(false); setScreenOpen(true) }} />
            </div>
            <div className="titlebar-drag" />
            <button className="btn primary export-btn" onClick={exportVideo} data-tip={key('export')}>
              <Upload size={15} strokeWidth={2.2} /> Exportar
            </button>
          </>
        )}
        {screen !== 'editor' && <div className="titlebar-drag" />}
        {screen !== 'editor' && <IconButton icon={Settings} label="Preferências" onClick={() => setPrefsOpen(true)} />}
        {isWin && <div className="window-controls-space" />}
      </header>

      {screen === 'welcome' && (
        <Welcome
          current={hasProject ? { name: projectName, dirty } : null}
          onResume={() => setScreen('editor')}
          recovery={recovery}
          onTemplate={newFromTemplate}
          onOpen={open}
          onOpenRecent={openRecent}
          onRecover={recover}
          onDiscardRecovery={() => {
            setRecovery(null)
            void window.api.autosave(null)
          }}
        />
      )}

      {screen === 'editor' && (
        <>
          <main className="workspace">
            <MediaBin
              media={Object.values(project.media)}
              proxyProgress={proxyProgress}
              onImport={importMedia}
              onAdd={(mediaId) => dispatch({ type: 'addClip', mediaId, start: time })}
              onRemove={(mediaId) => dispatch({ type: 'removeMedia', mediaId })}
              onProxy={(mediaId) => requestProxy(project.media[mediaId])}
              onContextMenu={openMediaMenu}
              onImportLink={() => setLinkOpen(true)}
            />
            <Preview
              engine={engine}
              project={project}
              selected={selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined}
              time={time}
              duration={duration}
              playing={playing}
              onToggle={togglePlay}
              onSeek={seek}
              onSelect={selectClips}
              dispatch={dispatch}
              checkpoint={checkpoint}
            />
            <Inspector
              project={project}
              selection={selection}
              selectedTrack={selectedTrack}
              time={time}
              engine={engine}
              dispatch={dispatch}
              checkpoint={checkpoint}
              onSeek={seek}
              onDetectBeats={detectBeatsFor}
              onAudioTool={(tool, clip) => (tool === 'vst' ? setVstClip(clip.id) : void cleanVoice(clip, tool))}
              onVideoTool={(tool, clip) => (tool === 'freeze' ? void freezeFrame(clip) : tool === 'reverse' ? void reverseClip(clip) : setBgClip(clip.id))}
              onSeparate={(id) => {
                setPlaying(false)
                setStemsClip(id)
              }}
            />
          </main>

          <section className="bottom">
            <div className="bottom-bar">
              <Segmented
                value={bottom}
                onChange={setBottom}
                options={[
                  { value: 'timeline', label: 'Timeline', icon: Rows3 },
                  { value: 'mixer', label: 'Mixer', icon: SlidersVertical },
                ]}
              />
            </div>
            {bottom === 'timeline' ? (
              <Timeline
                project={project}
                time={time}
                zoom={zoom}
                selection={selection}
                selectedTrack={selectedTrack}
                onSelectTrack={setSelectedTrack}
                playing={playing}
                dispatch={dispatch}
                checkpoint={checkpoint}
                onSeek={seek}
                onSelect={selectClips}
                onZoom={setZoom}
                onContextMenu={openTimelineMenu}
              />
            ) : (
              <Mixer
                project={project}
                engine={engine}
                selectedTrack={selectedTrack}
                onSelectTrack={(id) => {
                  setSelection([])
                  setSelectedTrack(id)
                }}
                dispatch={dispatch}
                checkpoint={checkpoint}
              />
            )}
          </section>
        </>
      )}

      {stemsClip &&
        (() => {
          const clip = project.clips.find((c) => c.id === stemsClip)
          const media = clip?.mediaId ? project.media[clip.mediaId] : undefined
          if (!clip || !media) return null
          return (
            <StemsDialog
              clip={clip}
              media={media}
              onClose={() => setStemsClip(null)}
              onDone={(items, muteOriginal) => {
                dispatch({ type: 'addStems', sourceClipId: clip.id, items, muteOriginal })
                setStemsClip(null)
                setBottom('timeline')
                toast.success('Faixas separadas', { detail: items.map((i) => i.label).join(', ') })
              }}
            />
          )
        })()}

      {dialog === 'captions' && (
        <CaptionsDialog
          project={project}
          total={duration}
          onClose={() => setDialog(null)}
          onDone={(items, style) => {
            dispatch({ type: 'addTexts', trackName: 'Legendas', items, text: style })
            setDialog(null)
            toast.success('Legendas criadas', { detail: `${items.length} linhas na trilha “Legendas”.` })
          }}
        />
      )}

      {menu && <ContextMenu state={menu} onClose={closeMenu} />}

      {linkOpen && (
        <LinkImportDialog
          onClose={() => setLinkOpen(false)}
          onDone={(result) => {
            setLinkOpen(false)
            addProbed([result])
          }}
        />
      )}

      {bgClip &&
        (() => {
          const clip = project.clips.find((c) => c.id === bgClip)
          const media = clip?.mediaId ? project.media[clip.mediaId] : undefined
          if (!clip || !media) return null
          return (
            <BgRemoveDialog
              clip={clip}
              media={media}
              onClose={() => setBgClip(null)}
              onDone={(r) => {
                setBgClip(null)
                if (!r.ok) {
                  toast.error('Não foi possível remover o fundo', { detail: r.error })
                  return
                }
                dispatch({ type: 'replaceClipMedia', clipId: clip.id, media: { ...r.media, id: uid(), name: `${media.name} (sem fundo)` } })
                toast.success('Fundo removido', { detail: 'Coloque outra mídia na trilha de baixo para aparecer atrás.' })
              }}
            />
          )
        })()}

      {vstClip &&
        (() => {
          const clip = project.clips.find((c) => c.id === vstClip)
          const media = clip?.mediaId ? project.media[clip.mediaId] : undefined
          if (!clip || !media) return null
          return (
            <VstDialog
              clip={clip}
              media={media}
              onClose={() => setVstClip(null)}
              onDone={(r, name) => {
                setVstClip(null)
                if (applyProcessedAudio(clip, r, name)) toast.success(`Processado pelo ${name}`)
              }}
            />
          )
        })()}

      {recordOpen && (
        <RecordDialog
          at={time}
          onPlay={(on) => {
            if (on) setPlaying(true)
            else setPlaying(false)
          }}
          onClose={() => setRecordOpen(false)}
          onDone={(r, at) => {
            setRecordOpen(false)
            if (!r.ok) {
              toast.error('Não foi possível salvar a gravação', { detail: r.error })
              return
            }
            const media = { ...r.media, id: uid() }
            dispatch({ type: 'addMedia', media: [media] })
            const target = project.tracks.find((t) => t.id === selectedTrack && t.kind === 'audio')
            dispatch({ type: 'addClip', mediaId: media.id, start: at, trackId: target?.id })
            toast.success('Gravação adicionada', { detail: media.path })
          }}
        />
      )}

      {screenOpen && (
        <ScreenRecordDialog
          at={time}
          onClose={() => setScreenOpen(false)}
          onDone={(r, at) => {
            setScreenOpen(false)
            const parts = [r.video, r.system, r.mic]
            const failed = parts.find((x) => x && !x.ok)
            if (failed && !failed.ok) toast.error('Parte da gravação não pôde ser salva', { detail: failed.error })
            const ok = (x?: ProbeResult) => (x?.ok ? { ...x.media, id: uid() } : null)
            const video = ok(r.video)
            const audio = [
              { label: 'Áudio do sistema', media: ok(r.system) },
              { label: 'Microfone', media: ok(r.mic) },
            ].filter((a): a is { label: string; media: Media } => !!a.media)
            if (!video && !audio.length) return
            dispatch({ type: 'addRecording', start: at, video, audio })
            toast.success('Gravação de tela adicionada', { detail: r.dir, action: { label: 'Abrir pasta', run: () => window.api.showInFolder((video ?? audio[0].media).path) } })
          }}
        />
      )}

      {showIntro && <Intro onDone={() => setShowIntro(false)} />}

      {exportOpen && <ExportDialog project={project} duration={duration} name={projectName === 'Sem título' ? 'video' : projectName} onExport={runExport} onClose={() => setExportOpen(false)} />}

      <ExportQueue />
      {historyOpen && screen === 'editor' && (
        <HistoryPanel
          history={history}
          onJump={(i) => {
            setPlaying(false)
            jump(i)
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {prefsOpen && settings && <PreferencesDialog settings={settings} update={update} onChange={(p) => void changeSettings(p)} onClose={() => setPrefsOpen(false)} />}
    </div>
  )
}
