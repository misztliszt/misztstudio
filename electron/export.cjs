// Converte o projeto da timeline em comandos do FFmpeg.
// Camadas de vídeo: a primeira trilha da lista fica por cima (como no CapCut).
// Áudio: cada trilha passa pela mesma cadeia da prévia
//   [afinação/transposição] → EQ → compressor → pan → (seco + reverb) → volume → master.

const fs = require('node:fs')
const path = require('node:path')
const { AutoTuneCore } = require('../src/dsp/autotune-core.js')
const { makeReverbIR } = require('../src/dsp/reverb-ir.js')

const SR = 48000
const TEXT_ANIM = 0.4 // igual a src/text.ts
const SLIDE_DISTANCE = 0.06

const n = (v) => Number(v).toFixed(4)

class Inputs {
  constructor() {
    this.args = []
    this.count = 0
  }
  add(...args) {
    this.args.push(...args)
    return this.count++
  }
}

/** Expressão de volume (volume × envelope por keyframes) em função de t local do clipe. */
function volumeExpr(clip, trackVolume = 1) {
  const keys = [...(clip.volumeKeys || [])].sort((a, b) => a.t - b.t)
  const base = clip.volume * trackVolume
  if (!keys.length) return n(base)
  let expr = n(keys[keys.length - 1].v)
  for (let i = keys.length - 1; i >= 1; i--) {
    const a = keys[i - 1]
    const b = keys[i]
    const lerp = `${n(a.v)}+(${n(b.v - a.v)})*(t-${n(a.t)})/${n(Math.max(1e-6, b.t - a.t))}`
    expr = `if(lt(t,${n(b.t)}),${lerp},${expr})`
  }
  expr = `if(lt(t,${n(keys[0].t)}),${n(keys[0].v)},${expr})`
  return `${n(base)}*(${expr})`
}

/** Cadeia de atempo para qualquer velocidade (cada estágio aceita 0,5–2; o tom é preservado). */
function atempoChain(speed) {
  const parts = []
  let s = speed
  while (s > 2) {
    parts.push('atempo=2')
    s /= 2
  }
  while (s < 0.5) {
    parts.push('atempo=0.5')
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-4) parts.push(`atempo=${n(s)}`)
  return parts
}

const even = (v) => Math.max(2, Math.round(v / 2) * 2)

/**
 * Expressão de uma propriedade animada em função de `tv` (tempo local do clipe).
 * Mesmas curvas de src/anim.ts: linear, suave (smoothstep) e segurar.
 */
function animExpr(keys, base, tv) {
  if (!keys || !keys.length) return n(base)
  const ks = [...keys].sort((a, b) => a.t - b.t)
  let expr = n(ks[ks.length - 1].v)
  for (let i = ks.length - 1; i >= 1; i--) {
    const a = ks[i - 1]
    const b = ks[i]
    const p = `clip((${tv}-${n(a.t)})/${n(Math.max(1e-6, b.t - a.t))},0,1)`
    const e = a.ease === 'hold' ? '0' : a.ease === 'ease' ? `(${p})*(${p})*(3-2*(${p}))` : p
    expr = `if(lt(${tv},${n(b.t)}),${n(a.v)}+(${n(b.v - a.v)})*${e},${expr})`
  }
  return `if(lt(${tv},${n(ks[0].t)}),${n(ks[0].v)},${expr})`
}

function clipAudioFilter(i, clip, label) {
  const parts = [`[${i}:a]asetpts=PTS-STARTPTS`, `aresample=${SR}`, ...atempoChain(clip.speed || 1), 'aformat=sample_fmts=fltp:channel_layouts=stereo', `volume='${volumeExpr(clip)}':eval=frame`]
  if (clip.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${n(clip.fadeIn)}`)
  if (clip.fadeOut > 0) parts.push(`afade=t=out:st=${n(Math.max(0, clip.duration - clip.fadeOut))}:d=${n(clip.fadeOut)}`)
  // Garante a duração exata do clipe mesmo se a mídia acabar antes.
  parts.push(`apad=whole_dur=${n(clip.duration)}`, `atrim=0:${n(clip.duration)}`)
  const delay = Math.round(clip.start * 1000)
  parts.push(`adelay=delays=${delay}:all=1`)
  return parts.join(',') + `[${label}]`
}

function audioClipsOf(project, trackId) {
  return project.clips.filter((c) => {
    if (c.trackId !== trackId || !c.mediaId || c.duration <= 0 || c.audioDetached) return false
    const m = project.media[c.mediaId]
    return m && m.kind !== 'image' && m.hasAudio
  })
}

function addClipInput(inputs, clip, media) {
  // Trecho da mídia de origem: a duração na timeline vezes a velocidade.
  // VP9 com transparência só mantém o alfa com o decodificador libvpx.
  const decoder = media.alpha ? ['-c:v', 'libvpx-vp9'] : []
  return inputs.add('-ss', n(clip.in), '-t', n(clip.duration * (clip.speed || 1)), ...decoder, '-i', media.path)
}

/** Mixa as trilhas indicadas (sem efeitos de trilha) num rótulo de saída. */
function mixClips(project, inputs, filters, clips, out) {
  const labels = []
  for (const clip of clips) {
    const i = addClipInput(inputs, clip, project.media[clip.mediaId])
    const label = `c${clip.id.replace(/\W/g, '')}_${i}`
    filters.push(clipAudioFilter(i, clip, label))
    labels.push(`[${label}]`)
  }
  if (labels.length === 1) filters.push(`${labels[0]}anull[${out}]`)
  else filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[${out}]`)
}

function writeWavFloat(file, channels) {
  const frames = channels[0].length
  const nch = channels.length
  const dataBytes = frames * nch * 4
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20) // IEEE float
  buf.writeUInt16LE(nch, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * nch * 4, 28)
  buf.writeUInt16LE(nch * 4, 32)
  buf.writeUInt16LE(32, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  let o = 44
  for (let f = 0; f < frames; f++) for (let c = 0; c < nch; c++, o += 4) buf.writeFloatLE(channels[c][f], o)
  fs.writeFileSync(file, buf)
}

/** Aplica afinação/transposição a um arquivo PCM f32le estéreo intercalado. */
function processPitch(rawIn, rawOut, fx) {
  const data = fs.readFileSync(rawIn)
  const pcm = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
  const frames = pcm.length >> 1
  const core = new AutoTuneCore(SR)
  core.setParams({ ...fx.autotune, transpose: fx.transpose })
  const BLOCK = 128
  const inL = new Float32Array(BLOCK)
  const inR = new Float32Array(BLOCK)
  const outL = new Float32Array(BLOCK)
  const outR = new Float32Array(BLOCK)
  const out = new Float32Array(pcm.length)
  for (let f = 0; f < frames; f += BLOCK) {
    const len = Math.min(BLOCK, frames - f)
    for (let i = 0; i < len; i++) {
      inL[i] = pcm[(f + i) * 2]
      inR[i] = pcm[(f + i) * 2 + 1]
    }
    if (len < BLOCK) {
      inL.fill(0, len)
      inR.fill(0, len)
    }
    core.process(inL, inR, outL, outR, BLOCK)
    for (let i = 0; i < len; i++) {
      out[(f + i) * 2] = outL[i]
      out[(f + i) * 2 + 1] = outR[i]
    }
  }
  fs.writeFileSync(rawOut, Buffer.from(out.buffer))
}

/** Ganhos do StereoPannerNode (especificação Web Audio) como filtro pan do FFmpeg. */
function panFilter(p) {
  if (!p) return null
  const x = p <= 0 ? p + 1 : p
  const gl = Math.cos((x * Math.PI) / 2)
  const gr = Math.sin((x * Math.PI) / 2)
  if (p <= 0) return `pan=stereo|c0=c0+${n(gl)}*c1|c1=${n(gr)}*c1`
  return `pan=stereo|c0=${n(gl)}*c0|c1=c1+${n(gr)}*c0`
}

function trackFxChain(fx) {
  const parts = []
  if (fx.eq.low) parts.push(`lowshelf=f=100:t=s:w=1:g=${n(fx.eq.low)}`)
  if (fx.eq.mid) parts.push(`equalizer=f=1000:t=q:w=0.7:g=${n(fx.eq.mid)}`)
  if (fx.eq.high) parts.push(`highshelf=f=8000:t=s:w=1:g=${n(fx.eq.high)}`)
  if (fx.comp.enabled) parts.push(`acompressor=threshold=${n(Math.pow(10, fx.comp.threshold / 20))}:ratio=${n(fx.comp.ratio)}:attack=10:release=100:knee=2`)
  const pan = panFilter(fx.pan)
  if (pan) parts.push(pan)
  return parts
}

const escapeFilterPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

/**
 * Prepara a exportação: grava PNGs de texto e IRs de reverb, renderiza as trilhas com
 * afinação (via `runFfmpeg`) e devolve os argumentos do comando final.
 */
async function prepareExport(payload, outPath, { workDir, runFfmpeg }) {
  const { project, textImages = {}, colorMatrices = {}, textSequences = {} } = payload
  const opts = { format: 'mp4', codec: 'h264', resolution: 0, fps: 0, quality: 'high', normalize: false, ...payload.options }
  const audioOnly = opts.format === 'mp3' || opts.format === 'wav'
  const { width: W, height: H, fps } = project
  const trackById = new Map(project.tracks.map((t) => [t.id, t]))
  const trackOrder = new Map(project.tracks.map((t, i) => [t.id, i]))
  const clips = project.clips.filter((c) => trackById.has(c.trackId) && c.duration > 0 && (c.text || project.media[c.mediaId]))
  const total = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0)
  if (total <= 0) throw new Error('A timeline está vazia')
  fs.mkdirSync(workDir, { recursive: true })

  const inputs = new Inputs()
  const filters = audioOnly ? [] : [`color=c=black:s=${W}x${H}:r=${fps}:d=${n(total)},format=rgba[base]`]
  let lastVideo = 'base'

  // ---------- Vídeo ----------
  const visual = (audioOnly ? [] : clips)
    .filter((c) => {
      const t = trackById.get(c.trackId)
      return t.kind === 'video' && !t.hidden && (c.text || project.media[c.mediaId].kind !== 'audio')
    })
    .sort((a, b) => trackOrder.get(b.trackId) - trackOrder.get(a.trackId) || a.start - b.start)

  for (const clip of visual) {
    const start = clip.start
    const end = clip.start + clip.duration
    const chain = []
    let i
    let yExpr = '0'
    const seq = clip.text && textSequences[clip.id]
    if (seq && seq.length) {
      // Animação renderizada quadro a quadro na interface: imagens com duração (concat demuxer).
      const dir = path.join(workDir, `text_${clip.id}`)
      fs.mkdirSync(dir, { recursive: true })
      const lines = []
      seq.forEach((f, k) => {
        const file = path.join(dir, `${String(k).padStart(5, '0')}.png`)
        fs.writeFileSync(file, Buffer.from(f.png, 'base64'))
        lines.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${n(f.duration)}`)
      })
      lines.push(lines[lines.length - 2]) // o último arquivo repetido aplica a última duração
      const list = path.join(dir, 'list.txt')
      fs.writeFileSync(list, lines.join('\n'))
      i = inputs.add('-f', 'concat', '-safe', '0', '-i', list)
      chain.push(`[${i}:v]fps=${fps}`, 'format=rgba', `scale=${W}:${H}`, `trim=duration=${n(clip.duration)}`, `setpts=PTS-STARTPTS+${n(start)}/TB`)
    } else if (clip.text) {
      const png = path.join(workDir, `text_${clip.id}.png`)
      fs.writeFileSync(png, Buffer.from(textImages[clip.id] || '', 'base64'))
      i = inputs.add('-loop', '1', '-framerate', String(fps), '-t', n(clip.duration), '-i', png)
      chain.push(`[${i}:v]format=rgba`, `scale=${W}:${H}`)
      chain.push(`setpts=PTS-STARTPTS+${n(start)}/TB`)
      if (clip.text.animation === 'fade' || clip.text.animation === 'slide') {
        const d = Math.min(TEXT_ANIM, clip.duration / 2)
        chain.push(`fade=t=in:st=${n(start)}:d=${n(d)}:alpha=1`, `fade=t=out:st=${n(end - d)}:d=${n(d)}:alpha=1`)
        if (clip.text.animation === 'slide') yExpr = `if(lt(t-${n(start)},${TEXT_ANIM}),(1-(t-${n(start)})/${TEXT_ANIM})*${n(SLIDE_DISTANCE * H)},0)`
      }
    } else {
      const media = project.media[clip.mediaId]
      const speed = clip.speed || 1
      if (media.kind === 'image') i = inputs.add('-loop', '1', '-framerate', String(fps), '-t', n(clip.duration), '-i', media.path)
      else i = addClipInput(inputs, clip, media)

      // Tempo: velocidade e posição na timeline primeiro, para que `t` dos filtros seguintes seja o da timeline.
      chain.push(`[${i}:v]setpts=(PTS-STARTPTS)/${n(media.kind === 'image' ? 1 : speed)}+${n(start)}/TB`, `fps=${fps}`)

      // Corte e tamanho-base (encaixado no quadro), como em src/anim.ts clipLayout.
      const tr = clip.transform || { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { left: 0, top: 0, right: 0, bottom: 0 } }
      const cr = tr.crop
      if (cr.left || cr.right || cr.top || cr.bottom) {
        chain.push(`crop=iw*${n(1 - cr.left - cr.right)}:ih*${n(1 - cr.top - cr.bottom)}:iw*${n(cr.left)}:ih*${n(cr.top)}`)
      }
      const sw = media.width || W
      const sh = media.height || H
      const cw = sw * (1 - cr.left - cr.right)
      const ch = sh * (1 - cr.top - cr.bottom)
      const fit = Math.min(W / cw, H / ch)
      const bw = cw * fit
      const bh = ch * fit
      const kf = clip.keyframes || {}
      const local = `(t-${n(start)})`
      const ti = clip.transitionIn
      const to = clip.transitionOut
      const tIn = ti.type !== 'none' && ti.duration > 0 ? ti : null
      const tOut = to.type !== 'none' && to.duration > 0 ? to : null
      // Transições com movimento (mesmas fórmulas de src/fx.ts): e = 1 − p²(3 − 2p).
      const pIn = tIn ? `clip((t-${n(start)})/${n(tIn.duration)},0,1)` : null
      const pOut = tOut ? `clip((${n(end)}-t)/${n(tOut.duration)},0,1)` : null
      const eIn = pIn ? `(1-(${pIn})*(${pIn})*(3-2*(${pIn})))` : '0'
      const eOut = pOut ? `(1-(${pOut})*(${pOut})*(3-2*(${pOut})))` : '0'
      const transScale = []
      const transDx = []
      const transDy = []
      const transRot = []
      let transMaxScale = 1
      for (const [tt, e, dir] of [[tIn && tIn.type, eIn, 1], [tOut && tOut.type, eOut, -1]]) {
        if (tt === 'zoomIn') (transScale.push(`(1+0.3*${e})`), (transMaxScale *= 1.3))
        else if (tt === 'zoomOut') transScale.push(`(1-0.25*${e})`)
        else if (tt === 'spin') (transScale.push(`(1-0.4*${e})`), transRot.push(`${-120 * dir}*${e}`))
        else if (tt === 'slideLeft') transDx.push(`${dir}*${e}*W`)
        else if (tt === 'slideRight') transDx.push(`${-dir}*${e}*W`)
        else if (tt === 'slideUp') transDy.push(`${dir}*${e}*H`)
        else if (tt === 'slideDown') transDy.push(`${-dir}*${e}*H`)
      }

      const kfScale = animExpr(kf.scale, tr.scale, local)
      const scaleE = [kfScale, ...transScale].join('*')
      const animatedScale = !!(kf.scale && kf.scale.length) || transScale.length > 0
      if (animatedScale) {
        chain.push(`scale=w='max(2,trunc(${n(bw)}*(${scaleE})/2)*2)':h='max(2,trunc(${n(bh)}*(${scaleE})/2)*2)':eval=frame`)
      } else {
        chain.push(`scale=${even(bw * tr.scale)}:${even(bh * tr.scale)}`)
      }
      const fx = clip.effects || {}
      chain.push('format=rgba')

      const c = clip.color
      if (c.lut) chain.push(`lut3d=file='${escapeFilterPath(c.lut)}'`)
      if (c.brightness !== 0 || c.contrast !== 1) {
        const e = `clip((val*${n(1 + c.brightness)}-127.5)*${n(c.contrast)}+127.5,0,255)`
        chain.push(`lutrgb=r='${e}':g='${e}':b='${e}'`)
      }
      const m = colorMatrices[clip.id]
      if (m) {
        chain.push(`colorchannelmixer=rr=${n(m[0])}:rg=${n(m[1])}:rb=${n(m[2])}:gr=${n(m[3])}:gg=${n(m[4])}:gb=${n(m[5])}:br=${n(m[6])}:bg=${n(m[7])}:bb=${n(m[8])}`)
      }

      // Efeitos da camada (antes do pad/rotação, quando a imagem ainda é opaca).
      if (fx.blur > 0) chain.push(`gblur=sigma=${n((fx.blur * H) / 1080)}`)
      if (fx.vignette > 0) chain.push(`vignette=angle=${n(0.15 + fx.vignette * 0.9)}`)
      if (fx.grain > 0) chain.push(`noise=alls=${Math.round(fx.grain * 40)}:allf=t+u`)
      if (fx.blur > 0 || fx.vignette > 0 || fx.grain > 0) chain.push('format=rgba')

      // Com escala animada, a camada muda de tamanho a cada quadro: ela é centralizada numa tela
      // transparente fixa (no maior tamanho), recriada a cada quadro, para não deixar rastro.
      if (animatedScale) {
        const maxS = Math.max(tr.scale, ...(kf.scale || []).map((k) => k.v)) * transMaxScale
        filters.push(chain.join(',') + `[s${i}]`)
        filters.push(`color=c=black@0:s=${even(bw * maxS) + 2}x${even(bh * maxS) + 2}:r=${fps}:d=${n(clip.duration)},format=rgba,setpts=PTS-STARTPTS+${n(start)}/TB[cv${i}]`)
        chain.length = 0
        chain.push(`[cv${i}][s${i}]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame:eof_action=pass:format=auto`)
      }
      // Espelho só depois do tamanho fixo: o hflip do FFmpeg cai se o quadro muda de tamanho.
      if (fx.mirror) chain.push('hflip')

      // Opacidade e cor das transições (lineares, como em src/fx.ts).
      const fadeKind = (type) => (type === 'black' ? ':color=black' : type === 'flash' ? ':color=white' : ['dissolve', 'zoomIn', 'zoomOut', 'spin'].includes(type) ? ':alpha=1' : null)
      if (tIn && fadeKind(tIn.type)) chain.push(`fade=t=in:st=${n(start)}:d=${n(tIn.duration)}${fadeKind(tIn.type)}`)
      if (tOut && fadeKind(tOut.type)) chain.push(`fade=t=out:st=${n(end - tOut.duration)}:d=${n(tOut.duration)}${fadeKind(tOut.type)}`)

      // Opacidade: fixa via canal alfa; animada via geq (mais lento, usado só quando necessário).
      if (kf.opacity && kf.opacity.length) {
        chain.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${animExpr(kf.opacity, tr.opacity, `(T-${n(start)})`)},0,1)'`)
      } else if (tr.opacity < 1) {
        chain.push(`colorchannelmixer=aa=${n(Math.max(0, tr.opacity))}`)
      }

      const rotAnimated = !!(kf.rotation && kf.rotation.length) || transRot.length > 0
      if (rotAnimated || Math.abs(tr.rotation) > 0.01) {
        const rot = [animExpr(kf.rotation, tr.rotation, local), ...transRot].join('+')
        chain.push(`rotate=a='(${rot})*PI/180':ow='hypot(iw,ih)':oh=ow:c=black@0`)
      }

      const xE = animExpr(kf.x, tr.x, local)
      const yE = animExpr(kf.y, tr.y, local)
      // Deslocamentos extras: transições de deslizar e tremor de câmera (fórmula de src/fx.ts shakeOffset).
      const dx = [...transDx]
      const dy = [...transDy]
      if (fx.shake > 0) {
        dx.push(`${n(fx.shake * 0.012)}*W*(sin(${local}*29.1)+0.6*sin(${local}*47.7+1.3))`)
        dy.push(`${n(fx.shake * 0.012)}*H*(sin(${local}*33.7+0.7)+0.6*sin(${local}*53.1+2.1))`)
      }
      const xOff = dx.length ? `+${dx.join('+')}` : ''
      const yOff = dy.length ? `+${dy.join('+')}` : ''
      filters.push(chain.join(',') + `[v${i}]`)
      filters.push(`[${lastVideo}][v${i}]overlay=x='(W-w)/2+(${xE})*W${xOff}':y='(H-h)/2+(${yE})*H${yOff}':eval=frame:eof_action=pass:enable='between(t,${n(start)},${n(end)})'[o${i}]`)
      lastVideo = `o${i}`
      continue
    }
    filters.push(chain.join(',') + `[v${i}]`)
    filters.push(`[${lastVideo}][v${i}]overlay=x=0:y='${yExpr}':eof_action=pass:enable='between(t,${n(start)},${n(end)})'[o${i}]`)
    lastVideo = `o${i}`
  }
  if (!audioOnly) {
    // Resolução de saída: o lado menor vira `resolution` (mantendo a proporção).
    const shortSide = Math.min(W, H)
    const target = opts.resolution && opts.resolution !== shortSide ? opts.resolution : 0
    const scale = target ? (W <= H ? `,scale=${target}:-2:flags=lanczos` : `,scale=-2:${target}:flags=lanczos`) : ''
    filters.push(`[${lastVideo}]format=yuv420p${scale}[vout]`)
  }

  // ---------- Áudio ----------
  /** Trilha seca (clipes mixados, sem efeitos), do tamanho da timeline, em PCM f32le estéreo. */
  const stems = new Map()
  const renderStem = async (track) => {
    if (stems.has(track.id)) return stems.get(track.id)
    const tid = `t${trackOrder.get(track.id)}`
    const stemInputs = new Inputs()
    const stemFilters = []
    mixClips(project, stemInputs, stemFilters, audioClipsOf(project, track.id), 'stem')
    stemFilters.push(`[stem]apad=whole_dur=${n(total)},atrim=0:${n(total)}[stemout]`)
    const raw = path.join(workDir, `${tid}_dry.raw`)
    await runFfmpeg(['-y', '-hide_banner', ...stemInputs.args, '-filter_complex', stemFilters.join(';'), '-map', '[stemout]', '-f', 'f32le', '-ar', String(SR), '-ac', '2', raw])
    stems.set(track.id, raw)
    return raw
  }

  const trackOuts = []
  for (const track of project.tracks) {
    if (track.muted || track.volume <= 0) continue
    const trackClips = audioClipsOf(project, track.id)
    if (!trackClips.length) continue
    const fx = track.fx
    const tid = `t${trackOrder.get(track.id)}`
    const pitch = fx.autotune.enabled || fx.transpose !== 0

    if (pitch) {
      // Renderiza a trilha seca, aplica a afinação em JS e usa o resultado como entrada.
      const rawIn = await renderStem(track)
      const rawOut = path.join(workDir, `${tid}_tuned.raw`)
      processPitch(rawIn, rawOut, fx)
      const i = inputs.add('-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', rawOut)
      filters.push(`[${i}:a]anull[${tid}dry]`)
    } else {
      mixClips(project, inputs, filters, trackClips, `${tid}dry`)
    }

    let label = `${tid}dry`
    const fxParts = trackFxChain(fx)
    if (fxParts.length) {
      filters.push(`[${label}]${fxParts.join(',')}[${tid}fx]`)
      label = `${tid}fx`
    }
    if (fx.reverb.mix > 0) {
      const ir = path.join(workDir, `${tid}_ir.wav`)
      writeWavFloat(ir, makeReverbIR(SR, fx.reverb.decay))
      const irIn = inputs.add('-i', ir)
      filters.push(`[${label}]asplit[${tid}d][${tid}w]`)
      filters.push(`[${tid}w][${irIn}:a]afir=gtype=-1,volume=${n(fx.reverb.mix)}[${tid}wet]`)
      filters.push(`[${tid}d][${tid}wet]amix=inputs=2:normalize=0:duration=first[${tid}rv]`)
      label = `${tid}rv`
    }
    // Ducking: multiplica pela curva de ganho calculada a partir da trilha de voz (mesmo algoritmo da prévia).
    const duck = fx.duck
    const source = duck && duck.enabled && duck.source ? trackById.get(duck.source) : null
    if (source && source.id !== track.id && audioClipsOf(project, source.id).length) {
      const gainFile = path.join(workDir, `${tid}_duck.raw`)
      writeDuckCurve(await renderStem(source), gainFile, duck.depth)
      const gi = inputs.add('-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', gainFile)
      filters.push(`[${label}][${gi}:a]amultiply[${tid}dk]`)
      label = `${tid}dk`
    }
    filters.push(`[${label}]volume=${n(track.volume)}[${tid}out]`)
    trackOuts.push(`[${tid}out]`)
  }

  const master = opts.normalize ? 'mix' : 'aout'
  if (trackOuts.length > 1) filters.push(`${trackOuts.join('')}amix=inputs=${trackOuts.length}:normalize=0:duration=longest[${master}]`)
  else if (trackOuts.length === 1) filters.push(`${trackOuts[0]}anull[${master}]`)
  else filters.push(`anullsrc=r=${SR}:cl=stereo,atrim=0:${n(total)}[${master}]`)
  // Loudness padrão das plataformas de streaming (−14 LUFS, pico −1 dBTP).
  if (opts.normalize) filters.push(`[mix]loudnorm=I=-14:TP=-1:LRA=11,aresample=${SR}[aout]`)

  const crf = { max: 15, high: 19, medium: 23, small: 28 }[opts.quality] ?? 19
  const outFps = String(opts.fps || fps)
  const args = ['-y', '-hide_banner', ...inputs.args, '-filter_complex', filters.join(';')]
  if (audioOnly) {
    args.push('-map', '[aout]')
    if (opts.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '320k')
    else args.push('-c:a', 'pcm_s24le')
  } else {
    args.push('-map', '[vout]', '-map', '[aout]', '-r', outFps)
    if (opts.format === 'webm') {
      args.push('-c:v', 'libvpx-vp9', '-crf', String(crf + 12), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '192k')
    } else {
      const preset = opts.quality === 'max' ? 'slow' : opts.quality === 'small' ? 'faster' : 'medium'
      if (opts.codec === 'h265') args.push('-c:v', 'libx265', '-preset', preset, '-crf', String(crf + 4), '-tag:v', 'hvc1')
      else args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf))
      args.push('-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', opts.quality === 'small' ? '128k' : '256k', '-movflags', '+faststart')
    }
  }
  args.push('-t', n(total), outPath)
  return { args, total }
}

/**
 * Curva de ganho do ducking a partir da trilha de voz (PCM f32le estéreo):
 * RMS em blocos de 10 ms; acima de −40 dBFS abaixa `depth` dB, com ataque de 50 ms e
 * liberação de 400 ms. Igual ao seguidor de envelope da prévia (src/audio.ts).
 */
function writeDuckCurve(sourceRaw, outFile, depth) {
  const data = fs.readFileSync(sourceRaw)
  const pcm = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
  const frames = pcm.length >> 1
  const BLOCK = SR / 100
  const low = Math.pow(10, -Math.abs(depth) / 20)
  const out = new Float32Array(frames * 2)
  let cur = 1
  for (let b = 0; b * BLOCK < frames; b++) {
    const s = b * BLOCK
    const e = Math.min(frames, s + BLOCK)
    let sum = 0
    for (let f = s; f < e; f++) {
      const m = (pcm[f * 2] + pcm[f * 2 + 1]) * 0.5
      sum += m * m
    }
    const rms = Math.sqrt(sum / Math.max(1, e - s))
    const target = rms > DUCK_THRESHOLD ? low : 1
    const tc = target < cur ? DUCK_ATTACK : DUCK_RELEASE
    const next = cur + (target - cur) * (1 - Math.exp(-0.01 / tc))
    for (let f = s; f < e; f++) {
      const g = cur + ((next - cur) * (f - s)) / (e - s)
      out[f * 2] = g
      out[f * 2 + 1] = g
    }
    cur = next
  }
  fs.writeFileSync(outFile, Buffer.from(out.buffer))
}

const DUCK_THRESHOLD = 0.01
const DUCK_ATTACK = 0.05
const DUCK_RELEASE = 0.4

/** Mixagem simples (sem efeitos) da timeline inteira, para transcrição. */
function buildMixdownArgs(project, sampleRate) {
  const inputs = new Inputs()
  const filters = []
  const clips = project.tracks.filter((t) => !t.muted).flatMap((t) => audioClipsOf(project, t.id))
  if (!clips.length) throw new Error('Não há áudio na timeline para transcrever')
  mixClips(project, inputs, filters, clips, 'mix')
  return ['-hide_banner', '-loglevel', 'error', ...inputs.args, '-filter_complex', filters.join(';'), '-map', '[mix]', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1']
}

module.exports = { prepareExport, buildMixdownArgs }
