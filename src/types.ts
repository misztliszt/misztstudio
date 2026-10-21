export type MediaKind = 'video' | 'audio' | 'image'
export type TrackKind = 'video' | 'audio'

export interface Media {
  id: string
  path: string
  url: string
  name: string
  kind: MediaKind
  /** Segundos; 0 para imagens (duração livre). */
  duration: number
  width: number
  height: number
  hasAudio: boolean
  thumb: string | null
  /** Codec de vídeo informado pelo ffprobe. */
  codec?: string
  /** Versão leve usada só na prévia (a exportação usa o original). */
  proxy?: string | null
  /** Vídeo com canal de transparência (ex.: fundo removido, WebM VP9). */
  alpha?: boolean
  /** Grade de batidas detectada (sob demanda). */
  beats?: { bpm: number; offset: number } | null
}

export type ScaleName = 'chromatic' | 'major' | 'minor' | 'pentatonicMajor' | 'pentatonicMinor' | 'blues'

export interface AutoTune {
  enabled: boolean
  /** Tônica: 0 = Dó … 11 = Si. */
  key: number
  scale: ScaleName
  /** 0 = correção lenta/natural, 1 = instantânea (efeito "robô"). */
  speed: number
  /** 0..1 mistura entre original e corrigido. */
  mix: number
}

export interface TrackFx {
  /** Ganhos em dB das bandas grave (100 Hz), médio (1 kHz) e agudo (8 kHz). */
  eq: { low: number; mid: number; high: number }
  comp: { enabled: boolean; threshold: number; ratio: number }
  reverb: { mix: number; decay: number }
  /** -1 (esquerda) … 1 (direita). */
  pan: number
  autotune: AutoTune
  /** Transposição de tom em semitons (-12..12; frações = cents). */
  transpose: number
  /** Abaixa esta trilha automaticamente quando a trilha `source` (voz) tem som. */
  duck: { enabled: boolean; source: string | null; depth: number }
}

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  hidden: boolean
  volume: number
  fx: TrackFx
}

export type TransitionType = 'none' | 'dissolve' | 'black' | 'flash' | 'zoomIn' | 'zoomOut' | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown' | 'spin'

/** Efeitos de vídeo do clipe (mesmas fórmulas na prévia e na exportação). */
export interface VideoEffects {
  /** Desfoque em px (referência: altura 1080). */
  blur: number
  /** 0..1 */
  vignette: number
  /** 0..1 */
  grain: number
  /** Tremor de câmera 0..1. */
  shake: number
  /** Espelhar na horizontal. */
  mirror: boolean
}
export interface Transition {
  type: TransitionType
  duration: number
}

export interface ColorAdjust {
  /** -1..1 */
  brightness: number
  /** 0..2 (1 = neutro) */
  contrast: number
  /** 0..3 (1 = neutro) */
  saturation: number
  /** Graus. */
  hue: number
  /** 0..1 */
  sepia: number
  /** Caminho de um arquivo .cube. */
  lut: string | null
}

export type TextAnimation = 'none' | 'fade' | 'slide' | 'pop' | 'bounce' | 'typewriter' | 'wordByWord' | 'karaoke'

export interface TextStyle {
  content: string
  font: string
  /** Tamanho em px relativo a uma altura de 1080. */
  size: number
  color: string
  bold: boolean
  outline: boolean
  /** Cor da caixa de fundo, ou null. */
  background: string | null
  /** Posição do centro (0..1). */
  x: number
  y: number
  animation: TextAnimation
  /** Cor de destaque do karaokê. */
  highlight?: string
  /** Tempos de cada palavra (s desde o início do clipe), vindos do Whisper. */
  words?: { t0: number; t1: number; w: string }[]
}

export interface VolumeKey {
  /** Segundos a partir do início do clipe. */
  t: number
  v: number
}

export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'
export type Ease = 'linear' | 'ease' | 'hold'

export interface Keyframe {
  /** Segundos a partir do início do clipe (na timeline). */
  t: number
  v: number
  /** Curva até o próximo keyframe. */
  ease: Ease
}

export interface Transform {
  /** Deslocamento do centro, em fração da largura/altura do quadro. */
  x: number
  y: number
  /** 1 = encaixado no quadro. */
  scale: number
  /** Graus, sentido horário. */
  rotation: number
  /** 0..1 */
  opacity: number
  /** Corte em fração da mídia original (0..1 de cada lado). */
  crop: { left: number; top: number; right: number; bottom: number }
}

export interface Clip {
  id: string
  /** null para clipes de texto. */
  mediaId: string | null
  trackId: string
  /** Posição na timeline (s). */
  start: number
  /** Deslocamento dentro da mídia de origem (s). */
  in: number
  duration: number
  volume: number
  fadeIn: number
  fadeOut: number
  volumeKeys: VolumeKey[]
  transitionIn: Transition
  transitionOut: Transition
  color: ColorAdjust
  text?: TextStyle
  /** O áudio deste clipe de vídeo foi separado para uma trilha de áudio. */
  audioDetached?: boolean
  transform: Transform
  effects: VideoEffects
  keyframes: Partial<Record<AnimProp, Keyframe[]>>
  /** Velocidade de reprodução (0.25–4). A duração na timeline já considera a velocidade. */
  speed: number
}

export interface Project {
  version: 1
  width: number
  height: number
  fps: number
  media: Record<string, Media>
  tracks: Track[]
  clips: Clip[]
  /** Marcadores na régua da timeline. */
  markers?: Marker[]
  /** Timeline magnética: a trilha principal (vídeo mais embaixo) não deixa buracos. */
  magnetic?: boolean
}

export interface Marker {
  id: string
  t: number
  label: string
  color: string
}

export type ProbeResult = { ok: true; media: Omit<Media, 'id'> } | { ok: false; path: string; error: string }

export interface ExportPayload {
  project: Project
  /** PNG (base64) de cada clipe de texto, do tamanho do quadro. */
  textImages: Record<string, string>
  /** Animações de texto renderizadas quadro a quadro: imagens com a duração de cada uma. */
  textSequences?: Record<string, { png: string; duration: number }[]>
  /** Matriz de cor 3×3 (saturação/matiz/sépia) de cada clipe com ajuste. */
  colorMatrices: Record<string, number[]>
  options: ExportOptions
}

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'mp3' | 'wav'

export interface ExportOptions {
  format: ExportFormat
  codec: 'h264' | 'h265'
  /** Lado menor em pixels, ou 0 para a resolução do projeto. */
  resolution: number
  /** 0 = fps do projeto. */
  fps: number
  quality: 'max' | 'high' | 'medium' | 'small'
  /** Normaliza o volume para −14 LUFS (padrão de YouTube/Spotify/TikTok). */
  normalize: boolean
  fileName: string
}

export interface LinkInfo {
  id: string
  title: string
  uploader: string | null
  duration: number
  thumbnail: string | null
  maxHeight: number | null
  extractor: string | null
  license: string | null
  webpage: string
}

/** Tela ou janela que pode ser gravada. */
export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string | null
}

/** Resultado da pesquisa do YouTube (via yt-dlp). */
export interface SearchResult {
  id: string
  title: string
  channel: string | null
  duration: number
  views: number | null
  thumbnail: string
  url: string
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
  exists: boolean
  width?: number
  height?: number
  duration?: number
  clips?: number
}

export interface StemsStatus {
  installed: boolean
  device: 'cuda' | 'cpu' | null
  /** Versão do Python encontrada (quando ainda não instalado). */
  python: string | null
  gpu: boolean
  dir: string
}

export interface StemsProgress {
  stage: string
  text?: string
  line?: string
  step?: number
  total?: number
  progress?: number
  download?: boolean
  device?: string
}

declare global {
  interface Window {
    api: {
      importMedia(): Promise<ProbeResult[]>
      probeFiles(files: File[]): Promise<ProbeResult[]>
      saveProject(json: string, filePath?: string | null): Promise<string | null>
      openProject(): Promise<{ filePath: string; json: string } | null>
      initialProject(): Promise<{ filePath: string; json: string } | null>
      openProjectPath(path: string): Promise<{ filePath: string; json: string }>
      recentProjects(): Promise<RecentProject[]>
      removeRecent(path: string): Promise<void>
      showInFolder(path: string): Promise<void>
      openMicSettings(): Promise<void>
      platform: string
      exportVideo(payload: ExportPayload): Promise<string | null>
      cancelExport(): Promise<void>
      onExportProgress(cb: (value: number) => void): () => void
      makeProxy(path: string): Promise<string>
      extractFrame(path: string, time: number): Promise<ProbeResult>
      cleanAudio(path: string, inPoint: number, duration: number, level: 'light' | 'medium' | 'strong'): Promise<ProbeResult>
      vstStatus(): Promise<{ installed: boolean; python: string | null }>
      vstInstall(): Promise<{ installed: boolean; python: string | null }>
      vstScan(): Promise<{ name: string; path: string; vendor: string }[]>
      vstEditor(plugin: string, state?: string | null): Promise<{ state: string; name: string }>
      vstApply(path: string, inPoint: number, duration: number, plugin: string, state?: string | null): Promise<ProbeResult>
      onVstProgress(cb: (msg: { stage: string; line?: string }) => void): () => void
      saveRecording(data: ArrayBuffer): Promise<ProbeResult>
      screenSources(): Promise<CaptureSource[]>
      screenSelect(sourceId: string, systemAudio: boolean): Promise<void>
      screenBegin(parts: { key: 'video' | 'system' | 'mic'; mime: string }[]): Promise<string>
      screenChunk(id: string, key: string, data: ArrayBuffer): Promise<void>
      screenFinish(id: string): Promise<{ dir: string; video?: ProbeResult; system?: ProbeResult; mic?: ProbeResult }>
      screenDiscard(id: string): Promise<void>
      screenHotkey(on: boolean): Promise<void>
      screenMinimize(on: boolean): Promise<void>
      onScreenStop(cb: () => void): () => void
      bgPrepare(path: string, inPoint: number, duration: number): Promise<{ id: string; url: string; width: number; height: number; frames: number; fps: number }>
      bgWriteMasks(id: string, data: ArrayBuffer): Promise<void>
      bgFinish(id: string, hasAudio: boolean): Promise<ProbeResult>
      bgCancel(id: string): Promise<void>
      reverseMedia(path: string, inPoint: number, duration: number, hasAudio: boolean): Promise<ProbeResult>
      onProxyProgress(cb: (path: string, value: number) => void): () => void
      pickLut(): Promise<string | null>
      readText(path: string): Promise<string>
      mixdown(project: Project, sampleRate: number): Promise<ArrayBuffer>
      autosave(json: string | null): Promise<void>
      readAutosave(): Promise<{ json: string; savedAt: number } | null>
      ytdlpStatus(): Promise<{ installed: boolean; version: string | null; outDir: string }>
      ytdlpInstall(): Promise<{ installed: boolean; version: string | null; outDir: string }>
      ytdlpUpdate(): Promise<{ message: string; installed: boolean; version: string | null }>
      ytdlpInfo(url: string): Promise<LinkInfo>
      ytdlpSearch(query: string): Promise<SearchResult[]>
      ytdlpDownload(url: string, preset: 'best' | 'hd720' | 'max' | 'audio'): Promise<ProbeResult>
      ytdlpCancel(): Promise<void>
      /** Abre o seletor de pasta; devolve a pasta escolhida (ou a atual se cancelar). */
      ytdlpPickFolder(): Promise<string>
      onYtdlpProgress(cb: (msg: { stage: string; part?: number; progress?: number; size?: string | null; speed?: string | null; eta?: string | null }) => void): () => void
      stemsStatus(): Promise<StemsStatus>
      installStems(variant: 'cuda' | 'cpu'): Promise<{ device: 'cuda' | 'cpu' }>
      separateStems(req: { filePath: string; inPoint: number; duration: number; model: string; twoStems: boolean }): Promise<{ name: string; probe: ProbeResult }[]>
      cancelStems(): Promise<void>
      onStemsProgress(cb: (msg: StemsProgress) => void): () => void
    }
  }
}
