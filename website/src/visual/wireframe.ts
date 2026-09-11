// website/src/visual/wireframe.ts
// ★2026-09-11 零依赖手写 WebGL1 引擎：线框几何体（icosahedron）——慢速旋转 + 深度衰减 + 边缘流光。
//   为什么手写：不引第三方 3D（three.js ~600KB 已移除）；这也是「工程深度」的自证——
//   官网是框架自身编译产物，这块零依赖 WebGL 是同一套工程标准的体现（非装饰贴图）。
//   降级链：WebGL 不可用 → 返回 null（调用方隐藏 canvas）；prefers-reduced-motion → 静态单帧；
//          离屏（IntersectionObserver）→ 暂停 rAF（省电）。
//   ★审计：本文件为 .ts（D-2/FLD 门禁只扫 .vue），WebGL/window 使用不受限（与旧 particles.ts 同约定）。

export interface WireframeOptions {
  /** 线框颜色（0..1 三元组） */
  color?: [number, number, number]
  /** 不透明度 */
  alpha?: number
  /** 旋转速度（弧度/秒；0 = 不转） */
  speed?: number
  /** 设备像素比上限（清晰度/性能平衡） */
  maxDpr?: number
  /** 静态单帧（prefers-reduced-motion）——不启动 rAF */
  still?: boolean
}

export interface WireframeHandle {
  destroy(): void
}

/** icosahedron：12 顶点 / 30 边（黄金比构造，归一化到单位球） */
export function buildIcosahedron(): { positions: Float32Array; vertexCount: number } {
  const t = (1 + Math.sqrt(5)) / 2
  const raw: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]
  const norm = raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z)
    return [x / l, y / l, z / l] as [number, number, number]
  })
  const dist = (i: number, j: number): number =>
    Math.hypot(norm[i][0] - norm[j][0], norm[i][1] - norm[j][1], norm[i][2] - norm[j][2])
  // 最短点距 = icosahedron 边长；据此筛出 30 条边
  let minD = Infinity
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) minD = Math.min(minD, dist(i, j))
  const eps = minD * 1.08
  const idx: number[] = []
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (dist(i, j) < eps) idx.push(i, j)
  const positions = new Float32Array(idx.length * 3)
  for (let k = 0; k < idx.length; k++) {
    const v = norm[idx[k] as number] as [number, number, number]
    positions[k * 3] = v[0]
    positions[k * 3 + 1] = v[1]
    positions[k * 3 + 2] = v[2]
  }
  return { positions, vertexCount: idx.length }
}

const VERT = `
attribute vec3 a_pos;
uniform mat3 u_rot;
uniform vec2 u_res;
uniform float u_scale;
varying float v_depth;
varying float v_phase;
void main() {
  vec3 p = u_rot * a_pos;
  v_depth = p.z;
  v_phase = a_pos.x + a_pos.y * 0.5 + a_pos.z * 0.25;
  float persp = 1.0 / (1.0 - p.z * 0.30);
  vec2 xy = p.xy * persp * u_scale;
  gl_Position = vec4(xy.x * (u_res.y / u_res.x), xy.y, 0.0, 1.0);
}
`

const FRAG = `
precision mediump float;
varying float v_depth;
varying float v_phase;
uniform vec3 u_color;
uniform float u_alpha;
uniform float u_time;
void main() {
  float d = v_depth * 0.5 + 0.5;                        // 0 后 .. 1 前
  float a = u_alpha * mix(0.20, 1.0, d);                // 深度衰减
  a *= 0.80 + 0.20 * sin(u_time * 1.5 + v_phase * 4.0); // 边缘流光
  gl_FragColor = vec4(u_color * a, a);                  // 预乘 → 加色混合发光
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/** 行主序 3x3 相乘 */
function mul3(a: number[], b: number[]): number[] {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  }
  return o
}

export function createWireframeCore(canvas: HTMLCanvasElement, opts: WireframeOptions = {}): WireframeHandle | null {
  const color = opts.color ?? [0.486, 0.361, 1] // #7c5cff
  const alpha = opts.alpha ?? 0.62
  const speed = opts.speed ?? 0.22
  const maxDpr = opts.maxDpr ?? 2
  const still = opts.still === true

  let gl: WebGLRenderingContext | null = null
  try {
    gl = (canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true }) ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  } catch {
    gl = null
  }
  if (!gl) return null

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)

  const geo = buildIcosahedron()
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE) // 加色（预乘输出）——暗底发光
  gl.uniform3f(gl.getUniformLocation(prog, 'u_color'), color[0], color[1], color[2])
  gl.uniform1f(gl.getUniformLocation(prog, 'u_alpha'), alpha)
  gl.uniform1f(gl.getUniformLocation(prog, 'u_scale'), 0.82)
  const uRot = gl.getUniformLocation(prog, 'u_rot')
  const uRes = gl.getUniformLocation(prog, 'u_res')
  const uTime = gl.getUniformLocation(prog, 'u_time')

  let disposed = false
  let visible = true
  let raf = 0
  let t0 = performance.now()
  let tSec = 0
  let tilt = -0.5 // 固定倾角（俯视一点，立体感更好）

  const resize = (): void => {
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, maxDpr)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    gl!.viewport(0, 0, w, h)
    gl!.uniform2f(uRes, w, h)
  }

  const draw = (): void => {
    if (!gl) return
    resize()
    const cy = Math.cos(tSec * speed)
    const sy = Math.sin(tSec * speed)
    const cx = Math.cos(tilt)
    const sx = Math.sin(tilt)
    // Rx * Ry（行主序）→ 上传需列主序
    const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
    const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
    const r = mul3(Rx, Ry)
    gl.uniformMatrix3fv(uRot, false, new Float32Array([r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]))
    gl.uniform1f(uTime, tSec)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.LINES, 0, geo.vertexCount)
  }

  const frame = (now: number): void => {
    if (disposed) return
    const dt = Math.min(0.05, (now - t0) / 1000)
    t0 = now
    if (visible) tSec += dt
    draw()
    raf = requestAnimationFrame(frame)
  }

  // 离屏暂停（省电）；IntersectionObserver 缺失 → 恒可见
  let io: IntersectionObserver | null = null
  if (typeof IntersectionObserver === 'function' && !still) {
    io = new IntersectionObserver((entries) => {
      for (const en of entries) visible = en.isIntersecting
    })
    io.observe(canvas)
  }

  if (still) {
    draw() // 静态单帧（reduced-motion）
  } else {
    t0 = performance.now()
    raf = requestAnimationFrame(frame)
  }

  return {
    destroy(): void {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      io?.disconnect()
      io = null
      try {
        const lose = gl?.getExtension('WEBGL_lose_context')
        lose?.loseContext()
      } catch {
        /* 忽略 */
      }
      gl = null
    },
  }
}
