import { useEffect, useState } from 'react'
import type { Media } from './types'

/** Picos por segundo guardados para desenhar a forma de onda. */
export const PEAKS_PER_SECOND = 100
/** Arquivos maiores que isso não são decodificados inteiros na memória. */
const MAX_BYTES = 400 * 1024 * 1024

const cache = new Map<string, Promise<Float32Array | null>>()
let ctx: AudioContext | null = null

async function compute(media: Media): Promise<Float32Array | null> {
  const res = await fetch(media.url)
  if (Number(res.headers.get('content-length')) > MAX_BYTES) return null
  const buf = await res.arrayBuffer()
  ctx ??= new AudioContext()
  const audio = await ctx.decodeAudioData(buf)
  const step = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SECOND))
  const count = Math.ceil(audio.length / step)
  const peaks = new Float32Array(count)
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = audio.getChannelData(ch)
    for (let i = 0; i < count; i++) {
      let max = 0
      const end = Math.min(data.length, (i + 1) * step)
      for (let j = i * step; j < end; j++) {
        const v = data[j] < 0 ? -data[j] : data[j]
        if (v > max) max = v
      }
      if (max > peaks[i]) peaks[i] = max
    }
  }
  return peaks
}

/** Envelope de picos da mídia (calculado uma vez e guardado). */
export function getPeaks(media: Media) {
  let job = cache.get(media.id)
  if (!job) {
    job = compute(media).catch(() => null)
    cache.set(media.id, job)
  }
  return job
}

export function usePeaks(media: Media | undefined) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  useEffect(() => {
    if (!media || media.kind === 'image' || !media.hasAudio) return
    let alive = true
    void getPeaks(media).then((p) => alive && setPeaks(p))
    return () => {
      alive = false
    }
  }, [media])
  return peaks
}
