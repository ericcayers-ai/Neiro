import type { SpectrogramData, WaveformData } from '../api/types'

type Rgba = [number, number, number, number]

interface SolidProgram {
  program: WebGLProgram
  position: number
  color: WebGLUniformLocation | null
}

interface ColorProgram {
  program: WebGLProgram
  position: number
  color: number
}

interface SpectrogramProgram {
  program: WebGLProgram
  position: number
  texCoord: number
  texture: WebGLUniformLocation | null
}

interface ProgramCache {
  solid?: SolidProgram
  color?: ColorProgram
  spectrogram?: SpectrogramProgram
}

export interface VizColors {
  background?: string
  grid?: string
  accent?: string
  playhead?: string
}

export interface PianoRollNote {
  onset: number
  offset: number
  pitch: number
  confidence?: number
  color: string
}

export interface PianoRollOptions extends VizColors {
  tempoBpm?: number
  playheadTime?: number | null
}

const caches = new WeakMap<WebGL2RenderingContext, ProgramCache>()

export function createWebGL2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    })
  } catch {
    return null
  }
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create WebGL shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compile error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create WebGL program')
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown WebGL link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export function drawWebGLWaveform(
  canvas: HTMLCanvasElement,
  wave: WaveformData,
  colors: VizColors = {},
): boolean {
  const gl = createWebGL2Context(canvas)
  if (!gl) return false
  try {
    const W = resizeCanvas(canvas, 160)
    const H = canvas.height
    gl.viewport(0, 0, W, H)
    clear(gl, colors.background || '#0e1116')

    const solid = getSolidProgram(gl)
    gl.useProgram(solid.program)

    drawLineStrip(gl, solid, new Float32Array([-1, 0, 1, 0]), colors.grid || '#1f242e')

    const n = Math.min(wave.width, wave.min.length, wave.max.length)
    if (n <= 0) return true

    const vertices = new Float32Array(Math.max(2, n) * 4)
    if (n === 1) {
      const yMax = clamp(wave.max[0], -1, 1) * 0.95
      const yMin = clamp(wave.min[0], -1, 1) * 0.95
      vertices.set([-1, yMax, -1, yMin, 1, yMax, 1, yMin])
    } else {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1
        const j = i * 4
        vertices[j] = x
        vertices[j + 1] = clamp(wave.max[i], -1, 1) * 0.95
        vertices[j + 2] = x
        vertices[j + 3] = clamp(wave.min[i], -1, 1) * 0.95
      }
    }
    drawLineStrip(gl, solid, vertices, colors.accent || '#56B4E9', gl.TRIANGLE_STRIP)
    return true
  } catch (err) {
    console.warn('WebGL waveform draw failed', err)
    return false
  }
}

export function drawWebGLSpectrogram(
  canvas: HTMLCanvasElement,
  data: SpectrogramData,
  colors: VizColors = {},
): boolean {
  const gl = createWebGL2Context(canvas)
  if (!gl) return false
  try {
    const W = resizeCanvas(canvas, 160)
    const H = canvas.height
    gl.viewport(0, 0, W, H)
    clear(gl, colors.background || '#0e1116')
    if (!data.cols || !data.rows || data.data.length === 0) return true

    const program = getSpectrogramProgram(gl)
    gl.useProgram(program.program)

    const vertices = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      -1, 1, 0, 0,
      1, -1, 1, 1,
      1, 1, 1, 0,
    ])
    const vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW)
    gl.enableVertexAttribArray(program.position)
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(program.texCoord)
    gl.vertexAttribPointer(program.texCoord, 2, gl.FLOAT, false, 16, 8)

    const texture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      data.cols,
      data.rows,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array(data.data),
    )
    gl.uniform1i(program.texture, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.deleteBuffer(vertexBuffer)
    gl.deleteTexture(texture)
    return true
  } catch (err) {
    console.warn('WebGL spectrogram draw failed', err)
    return false
  }
}

export function drawWebGLPianoRoll(
  canvas: HTMLCanvasElement,
  notes: PianoRollNote[],
  options: PianoRollOptions = {},
): boolean {
  const gl = createWebGL2Context(canvas)
  if (!gl) return false
  try {
    const W = resizeCanvas(canvas, 280)
    const H = canvas.height
    gl.viewport(0, 0, W, H)
    clear(gl, options.background || '#0e1116')
    if (!notes.length) return true

    const tMax = Math.max(...notes.map((note) => note.offset)) + 0.5
    let pLo = Math.min(...notes.map((note) => note.pitch)) - 2
    let pHi = Math.max(...notes.map((note) => note.pitch)) + 3
    if (pHi - pLo < 13) {
      const mid = (pHi + pLo) / 2
      pLo = mid - 7
      pHi = mid + 7
    }

    const rects: number[] = []
    const grid = parseColor(options.grid || '#1f242e')
    const rowH = H / (pHi - pLo)
    for (let p = Math.ceil(pLo / 12) * 12; p <= pHi; p += 12) {
      const y = H - ((p - pLo) / (pHi - pLo)) * H
      pushPixelRect(rects, 0, y, W, Math.min(H, y + 1), W, H, grid)
    }
    const beat = 60 / (options.tempoBpm || 120)
    for (let t = 0; t < tMax; t += beat) {
      const x = (t / tMax) * W
      pushPixelRect(rects, x, 0, Math.min(W, x + 1), H, W, H, grid)
    }

    for (const note of notes) {
      const x0 = (note.onset / tMax) * W
      const w = Math.max(2, ((note.offset - note.onset) / tMax) * W - 1)
      const y = H - ((note.pitch - pLo) / (pHi - pLo)) * H
      const alpha = 0.35 + 0.65 * clamp(note.confidence ?? 1, 0, 1)
      const color = parseColor(note.color, alpha)
      pushPixelRect(
        rects,
        x0,
        y - rowH * 0.9,
        Math.min(W, x0 + w),
        y - rowH * 0.9 + Math.max(2, rowH * 0.8),
        W,
        H,
        color,
      )
    }

    if (options.playheadTime != null && Number.isFinite(options.playheadTime)) {
      const x = clamp(options.playheadTime / tMax, 0, 1) * W
      pushPixelRect(rects, x, 0, Math.min(W, x + 2), H, W, H, parseColor(options.playhead || '#9bb8d4'))
    }

    const program = getColorProgram(gl)
    gl.useProgram(program.program)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rects), gl.STREAM_DRAW)
    gl.enableVertexAttribArray(program.position)
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 24, 0)
    gl.enableVertexAttribArray(program.color)
    gl.vertexAttribPointer(program.color, 4, gl.FLOAT, false, 24, 8)
    gl.drawArrays(gl.TRIANGLES, 0, rects.length / 6)
    gl.deleteBuffer(buffer)
    gl.disable(gl.BLEND)
    return true
  } catch (err) {
    console.warn('WebGL piano-roll draw failed', err)
    return false
  }
}

function getCache(gl: WebGL2RenderingContext): ProgramCache {
  let cache = caches.get(gl)
  if (!cache) {
    cache = {}
    caches.set(gl, cache)
  }
  return cache
}

function getSolidProgram(gl: WebGL2RenderingContext): SolidProgram {
  const cache = getCache(gl)
  if (!cache.solid) {
    const program = createProgram(
      gl,
      `#version 300 es
      in vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }`,
      `#version 300 es
      precision mediump float;
      uniform vec4 u_color;
      out vec4 outColor;
      void main() {
        outColor = u_color;
      }`,
    )
    cache.solid = {
      program,
      position: gl.getAttribLocation(program, 'a_position'),
      color: gl.getUniformLocation(program, 'u_color'),
    }
  }
  return cache.solid
}

function getColorProgram(gl: WebGL2RenderingContext): ColorProgram {
  const cache = getCache(gl)
  if (!cache.color) {
    const program = createProgram(
      gl,
      `#version 300 es
      in vec2 a_position;
      in vec4 a_color;
      out vec4 v_color;
      void main() {
        v_color = a_color;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }`,
      `#version 300 es
      precision mediump float;
      in vec4 v_color;
      out vec4 outColor;
      void main() {
        outColor = v_color;
      }`,
    )
    cache.color = {
      program,
      position: gl.getAttribLocation(program, 'a_position'),
      color: gl.getAttribLocation(program, 'a_color'),
    }
  }
  return cache.color
}

function getSpectrogramProgram(gl: WebGL2RenderingContext): SpectrogramProgram {
  const cache = getCache(gl)
  if (!cache.spectrogram) {
    const program = createProgram(
      gl,
      `#version 300 es
      in vec2 a_position;
      in vec2 a_texCoord;
      out vec2 v_texCoord;
      void main() {
        v_texCoord = a_texCoord;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }`,
      `#version 300 es
      precision mediump float;
      uniform sampler2D u_texture;
      in vec2 v_texCoord;
      out vec4 outColor;
      void main() {
        float t = texture(u_texture, v_texCoord).r;
        float r = min(1.0, (40.0 + t * 260.0) / 255.0);
        float g = max(0.0, (t * 200.0 - 30.0) / 255.0);
        float b = (max(0.0, 90.0 - t * 90.0) + max(0.0, t - 0.8) * 800.0) / 255.0;
        outColor = vec4(r, g, min(1.0, b), 1.0);
      }`,
    )
    cache.spectrogram = {
      program,
      position: gl.getAttribLocation(program, 'a_position'),
      texCoord: gl.getAttribLocation(program, 'a_texCoord'),
      texture: gl.getUniformLocation(program, 'u_texture'),
    }
  }
  return cache.spectrogram
}

function drawLineStrip(
  gl: WebGL2RenderingContext,
  program: SolidProgram,
  vertices: Float32Array,
  color: string,
  mode: number = gl.LINES,
) {
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW)
  gl.enableVertexAttribArray(program.position)
  gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0)
  gl.uniform4fv(program.color, parseColor(color))
  gl.drawArrays(mode, 0, vertices.length / 2)
  gl.deleteBuffer(buffer)
}

function resizeCanvas(canvas: HTMLCanvasElement, fallbackCssHeight: number): number {
  const dpr = window.devicePixelRatio || 1
  const cssW = Math.max(1, canvas.clientWidth || canvas.width || 1)
  const cssH = Math.max(1, canvas.clientHeight || fallbackCssHeight)
  const width = Math.max(1, Math.round(cssW * dpr))
  const height = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return width
}

function clear(gl: WebGL2RenderingContext, color: string) {
  const [r, g, b, a] = parseColor(color)
  gl.clearColor(r, g, b, a)
  gl.clear(gl.COLOR_BUFFER_BIT)
}

function pushPixelRect(
  rects: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  height: number,
  color: Rgba,
) {
  const nx0 = (clamp(x0, 0, width) / width) * 2 - 1
  const nx1 = (clamp(x1, 0, width) / width) * 2 - 1
  const ny0 = 1 - (clamp(y0, 0, height) / height) * 2
  const ny1 = 1 - (clamp(y1, 0, height) / height) * 2
  rects.push(
    nx0, ny1, ...color,
    nx1, ny1, ...color,
    nx0, ny0, ...color,
    nx0, ny0, ...color,
    nx1, ny1, ...color,
    nx1, ny0, ...color,
  )
}

function parseColor(input: string, alphaOverride?: number): Rgba {
  const color = input.trim()
  if (color.startsWith('#')) {
    const hex =
      color.length === 4
        ? color
            .slice(1)
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : color.slice(1, 7)
    const value = Number.parseInt(hex, 16)
    if (Number.isFinite(value)) {
      return [
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
        alphaOverride ?? 1,
      ]
    }
  }
  const rgb = color.match(/rgba?\(([^)]+)\)/)
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number.parseFloat(part.trim()))
    if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) {
      return [
        clamp(parts[0] / 255, 0, 1),
        clamp(parts[1] / 255, 0, 1),
        clamp(parts[2] / 255, 0, 1),
        alphaOverride ?? clamp(parts[3] ?? 1, 0, 1),
      ]
    }
  }
  return [1, 1, 1, alphaOverride ?? 1]
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value))
}
