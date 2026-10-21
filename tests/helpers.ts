import type { Clip, Media, Project } from '../src/types'
import { makeTrack, newProject, normalizeProject } from '../src/store'

/** Projeto vazio com uma trilha de vídeo e uma de áudio, ímã desligado. */
export function emptyProject(): Project {
  const p = newProject()
  return { ...p, magnetic: false, media: {}, clips: [], markers: [], tracks: [makeTrack('video', 'Vídeo 1'), makeTrack('audio', 'Áudio 1')] }
}

export function media(id: string, kind: Media['kind'] = 'video', duration = 10): Media {
  return { id, path: `C:/fake/${id}.mp4`, url: `media://local/${id}`, name: id, kind, duration, width: 1920, height: 1080, hasAudio: kind !== 'image', thumb: null } as Media
}

/** Clipe completo (com todos os campos padrão) a partir de um parcial. */
export function clip(partial: Partial<Clip> & Pick<Clip, 'id' | 'trackId' | 'start' | 'duration'>): Clip {
  const p = normalizeProject({ ...emptyProject(), clips: [{ mediaId: null, in: 0, ...partial } as Clip] })
  return p.clips[0]
}
