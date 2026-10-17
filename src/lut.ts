/** LUT 3D (.cube) aplicada na prévia via WebGL2; na exportação o FFmpeg usa lut3d. */

export interface Lut {
  size: number
  data: Float32Array
}

export function parseCube(text: string): Lut {
  let size = 0
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('LUT_3D_SIZE')) size = Number(line.split(/\s+/)[1])
    else if (/^[-\d.]/.test(line)) {
      const parts = line.split(/\s+/).map(Number)
      if (parts.length >= 3) values.push(parts[0], parts[1], parts[2])
    }
  }
  if (!size || values.length !== size * size * size * 3) throw new Error('Arquivo .cube inválido ou sem LUT_3D_SIZE')
  return { size, data: new Float32Array(values) }
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D src;
uniform sampler3D lut;
uniform float size;
in vec2 uv;
out vec4 color;
void main() {
  vec4 c = texture(src, uv);
  vec3 coord = c.rgb * ((size - 1.0) / size) + 0.5 / size;
  color = vec4(texture(lut, coord).rgb, c.a);
}`

export class LutRenderer {
  readonly canvas = document.createElement('canvas')
  private gl: WebGL2RenderingContext | null
  private program: WebGLProgram | null = null
  private srcTex: WebGLTexture | null = null
  private luts = new WeakMap<Lut, WebGLTexture>()

  constructor() {
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (this.gl) this.setup(this.gl)
  }

  private setup(gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'src'), 0)
    gl.uniform1i(gl.getUniformLocation(prog, 'lut'), 1)
    this.srcTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.program = prog
  }

  private lutTexture(gl: WebGL2RenderingContext, lut: Lut) {
    let tex = this.luts.get(lut)
    if (!tex) {
      tex = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_3D, tex)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE)
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data)
      this.luts.set(lut, tex)
    }
    return tex
  }

  /** Devolve um canvas com `source` passado pela LUT, ou null sem WebGL2. */
  apply(source: TexImageSource, width: number, height: number, lut: Lut): HTMLCanvasElement | null {
    const gl = this.gl
    if (!gl || !this.program) return null
    // Limita a resolução de trabalho: a prévia não precisa de mais que isso.
    const scale = Math.min(1, 1920 / width, 1080 / height)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture(gl, lut))
    gl.uniform1f(gl.getUniformLocation(this.program, 'size'), lut.size)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }
}
