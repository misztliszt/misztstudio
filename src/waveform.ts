import { useEffect, useState } from 'react'
import type { Media } from './types'

/** Picos por segundo guardados para desenhar a forma de onda. */
export const PEAKS_PER_SECOND = 100
/** Arquivos maiores que isso não são decodificados inteiros na memória. */
const MAX_BYTES = 400 * 1024 * 1024

/** Acima disto (≈ 1 GB de PCM decodificado a 48 kHz estéreo) a forma de onda não é calculada. */
const MAX_SECONDS = 3600

const cache = new Map<string, Promise<Float32Array | null>>()
let ctx: AudioContext | null = null
// Uma decodificação por vez: importar várias mídias de uma vez não pode estourar a memória.
let queue: Promise<unknown> = Promise.resolve()

async function compute(media: Media): Promise<Float32Array | null> {
  if (media.duration > MAX_SECONDS) return null
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
    const run = queue.then(() => compute(media))
    queue = run.catch(() => undefined)
    job = run.catch(() => {
      // Falha (arquivo ainda não pronto, rede…) não fica guardada para sempre: a próxima tentativa refaz.
      cache.delete(media.id)
      return null
    })
    cache.set(media.id, job)
  }
  return job
}

export function usePeaks(media: Media | undefined) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const eligible = !!media && media.kind !== 'image' && media.hasAudio
  useEffect(() => {
    if (!media || !eligible) {
      setPeaks(null) // trocou por uma mídia sem áudio: some a onda antiga
      return
    }
    let alive = true
    void getPeaks(media).then((p) => alive && setPeaks(p))
    return () => {
      alive = false
    }
    // Só refaz quando a mídia muda de verdade (um novo objeto com os mesmos dados não deve refazer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.id, media?.url, eligible])
  return peaks
}
