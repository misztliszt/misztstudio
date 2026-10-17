import type { CaptionMessage, CaptionRequest } from './captions.worker'
import type { Project } from './types'

export const CAPTION_MODELS = [
  { id: 'onnx-community/whisper-base', label: 'Rápido (base, ~150 MB)' },
  { id: 'onnx-community/whisper-small', label: 'Preciso (small, ~500 MB)' },
]

export const CAPTION_LANGUAGES = [
  { id: 'portuguese', label: 'Português' },
  { id: 'english', label: 'Inglês' },
  { id: 'spanish', label: 'Espanhol' },
  { id: 'french', label: 'Francês' },
  { id: 'italian', label: 'Italiano' },
  { id: 'german', label: 'Alemão' },
]

const MAX_LINE = 42
const SAMPLE_RATE = 16000

export interface CaptionItem {
  start: number
  duration: number
  content: string
}

/** Quebra trechos longos em linhas curtas, dividindo o tempo pelo número de caracteres. */
export function toCaptionItems(chunks: { text: string; start: number; end: number | null }[], total: number): CaptionItem[] {
  const items: CaptionItem[] = []
  chunks.forEach((c, idx) => {
    if (!c.text) return
    const end = c.end ?? chunks[idx + 1]?.start ?? Math.min(total, c.start + 3)
    const lines: string[] = []
    let line = ''
    for (const word of c.text.split(/\s+/)) {
      if (line && (line + ' ' + word).length > MAX_LINE) {
        lines.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    if (line) lines.push(line)
    const chars = lines.reduce((s, l) => s + l.length, 0) || 1
    let t = c.start
    for (const l of lines) {
      const d = ((end - c.start) * l.length) / chars
      items.push({ start: t, duration: Math.max(0.3, d), content: l })
      t += d
    }
  })
  return items
}

/** Mixa o áudio da timeline (16 kHz mono) e transcreve num worker. */
export async function transcribe(project: Project, model: string, language: string, onMessage: (m: CaptionMessage) => void) {
  onMessage({ type: 'status', text: 'Mixando o áudio da timeline…' })
  const buf = await window.api.mixdown(project, SAMPLE_RATE)
  const audio = new Float32Array(buf)
  const worker = new Worker(new URL('./captions.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<{ text: string; start: number; end: number | null }[]>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<CaptionMessage>) => {
      const m = e.data
      onMessage(m)
      if (m.type === 'done') {
        worker.terminate()
        resolve(m.chunks)
      } else if (m.type === 'error') {
        worker.terminate()
        reject(new Error(m.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ audio, model, language } satisfies CaptionRequest, [audio.buffer])
  })
}
