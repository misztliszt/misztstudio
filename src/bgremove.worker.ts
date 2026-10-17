/// <reference lib="webworker" />
// Máscara de pessoa/objeto principal por quadro com o MODNet (transformers.js), no próprio computador.
import { AutoModel, AutoProcessor, RawImage, env, type PreTrainedModel, type Processor } from '@huggingface/transformers'

env.allowLocalModels = false

const MODEL = 'Xenova/modnet'

export type BgWorkerIn = { type: 'load' } | { type: 'frame'; index: number; rgb: Uint8Array; width: number; height: number }
export type BgWorkerOut =
  | { type: 'status'; text: string }
  | { type: 'progress'; file: string; progress: number }
  | { type: 'ready'; device: string }
  | { type: 'mask'; index: number; mask: Uint8Array }
  | { type: 'error'; message: string }

const post = (m: BgWorkerOut, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)

let model: PreTrainedModel | null = null
let processor: Processor | null = null

async function load() {
  const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
    if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, progress: p.progress ?? 0 })
  }
  let device = 'webgpu'
  try {
    post({ type: 'status', text: 'Carregando o modelo de recorte (GPU)…' })
    model = await AutoModel.from_pretrained(MODEL, { device: 'webgpu', dtype: 'fp32', progress_callback })
  } catch {
    device = 'wasm'
    post({ type: 'status', text: 'GPU indisponível, usando a CPU (mais lento)…' })
    model = await AutoModel.from_pretrained(MODEL, { device: 'wasm', dtype: 'fp32', progress_callback })
  }
  processor = await AutoProcessor.from_pretrained(MODEL)
  post({ type: 'ready', device })
}

self.onmessage = async (e: MessageEvent<BgWorkerIn>) => {
  try {
    if (e.data.type === 'load') await load()
    else if (e.data.type === 'frame') {
      const { index, rgb, width, height } = e.data
      const image = new RawImage(rgb, width, height, 3)
      const { pixel_values } = await processor!(image)
      const { output } = await model!({ input: pixel_values })
      const maskImage = await RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(width, height)
      const mask = new Uint8Array(maskImage.data.buffer.slice(0) as ArrayBuffer, 0, width * height)
      post({ type: 'mask', index, mask }, [mask.buffer])
    }
  } catch (err) {
    post({ type: 'error', message: String(err instanceof Error ? err.message : err) })
  }
}
