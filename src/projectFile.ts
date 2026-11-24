import type { Clip, Project } from './types'
import { normalizeProject } from './store'

export interface ParsedProject {
  project: Project
  /** Quantos clipes foram descartados por estarem inválidos (trilha ou mídia que não existe, tempos quebrados). */
  dropped: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Lê o texto de um arquivo .edproj, confere a estrutura e devolve o projeto já normalizado.
 * Lança um Error com mensagem em português quando o arquivo não serve.
 */
export function parseProjectJson(json: string): ParsedProject {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('O arquivo está corrompido ou não é um projeto do Miszt Studio.')
  }
  if (!isObj(raw)) throw new Error('O arquivo não é um projeto do Miszt Studio.')
  if (typeof raw.version === 'number' && raw.version > 1) throw new Error('Este projeto foi salvo por uma versão mais nova do Miszt Studio. Atualize o programa para abri-lo.')
  if (raw.version !== 1) throw new Error('O arquivo não é um projeto do Miszt Studio.')
  if (!Array.isArray(raw.tracks) || raw.tracks.length === 0) throw new Error('O projeto não tem trilhas.')
  if (!raw.tracks.every((t) => isObj(t) && typeof t.id === 'string' && (t.kind === 'video' || t.kind === 'audio'))) throw new Error('As trilhas do projeto estão inválidas.')

  const media = isObj(raw.media) ? (raw.media as Project['media']) : {}
  const trackIds = new Set((raw.tracks as { id: string }[]).map((t) => t.id))
  const clipsIn = Array.isArray(raw.clips) ? (raw.clips as unknown[]) : []

  const clips: Clip[] = []
  let dropped = 0
  for (const c of clipsIn) {
    const ok =
      isObj(c) &&
      typeof c.id === 'string' &&
      typeof c.trackId === 'string' &&
      trackIds.has(c.trackId) &&
      finite(c.start) &&
      c.start >= 0 &&
      finite(c.duration) &&
      c.duration > 0 &&
      // Clipe de mídia precisa de uma mídia que exista no projeto; clipe de texto não.
      (isObj(c.text) || (typeof c.mediaId === 'string' && c.mediaId in media))
    if (!ok) {
      dropped++
      continue
    }
    const clip = { ...(c as unknown as Clip) }
    if (!finite(clip.in) || clip.in < 0) clip.in = 0
    if (!finite(clip.speed) || clip.speed <= 0) clip.speed = 1
    clips.push(clip)
  }

  const project = normalizeProject({
    ...(raw as unknown as Project),
    width: finite(raw.width) && raw.width >= 2 ? raw.width : 1920,
    height: finite(raw.height) && raw.height >= 2 ? raw.height : 1080,
    fps: finite(raw.fps) && raw.fps >= 1 ? raw.fps : 30,
    media,
    clips,
    markers: Array.isArray(raw.markers) ? (raw.markers as Project['markers']) : [],
    magnetic: raw.magnetic === true,
  })

  // Referências pendentes: o ducking que aponta para uma trilha que não existe é desligado.
  project.tracks = project.tracks.map((t) => (t.fx.duck.source && !trackIds.has(t.fx.duck.source) ? { ...t, fx: { ...t.fx, duck: { ...t.fx.duck, enabled: false, source: null } } } : t))
  return { project, dropped }
}
