/// <reference lib="webworker" />
// Transcrição local com Whisper (transformers.js). O modelo é baixado do Hugging Face
// na primeira vez e fica no cache do navegador do app.
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

env.allowLocalModels = false

export interface CaptionRequest {
  audio: Float32Array
  model: string
  language: string
  /** Tempos por palavra (para legendas karaokê) em vez de por frase. */
  words?: boolean
}

export type CaptionMessage =
  | { type: 'status'; text: string }
  | { type: 'progress'; file: string; progress: number }
  | { type: 'done'; chunks: { text: string; start: number; end: number | null }[] }
  | { type: 'error'; message: string }

const post = (m: CaptionMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)
const loaded = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()

function load(model: string) {
  let job = loaded.get(model)
  if (!job) {
    const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, progress: p.progress ?? 0 })
    }
    job = (async () => {
      try {
        post({ type: 'status', text: 'Carregando modelo (GPU)…' })
        return (await pipeline('automatic-speech-recognition', model, { device: 'webgpu', dtype: 'fp32', progress_callback })) as AutomaticSpeechRecognitionPipeline
      } catch {
        post({ type: 'status', text: 'GPU indisponível, usando CPU…' })
        return (await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback })) as AutomaticSpeechRecognitionPipeline
      }
    })()
    loaded.set(model, job)
    job.catch(() => loaded.delete(model))
  }
  return job
}

self.onmessage = async (e: MessageEvent<CaptionRequest>) => {
  const { audio, model, language, words } = e.data
  try {
    const asr = await load(model)
    post({ type: 'status', text: words ? 'Transcrevendo palavra por palavra…' : 'Transcrevendo…' })
    const out = (await asr(audio, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: words ? 'word' : true })) as {
      chunks?: { text: string; timestamp: [number, number | null] }[]
    }
    post({ type: 'done', chunks: (out.chunks ?? []).map((c) => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] })) })
  } catch (err) {
    post({ type: 'error', message: String(err instanceof Error ? err.message : err) })
  }
}
