// website/src/playground/particles.ts —— Hero 语义粒子场（★#389b WebGL 零依赖引擎 / ★#389c 神经连线 + 滚动联动）
// 设计纪律：① 零第三方依赖（手写 WebGL1，几 KB——three.js ~600KB 毁 LCP 预算）
//   ② 降级链完整：WebGL 不可用 → 返回 null（调用方回退静态辉光）/ prefers-reduced-motion → 静态单帧 / 离屏或隐藏页 → 暂停 rAF
//   ③ 性能：DPR 封顶 1.5、粒子数按面积推算并夹紧、加色混合 point sprite、连线只对 8% 大粒子（O(k²) k≈60）
// 概念映射：粒子 = 语义节点；连线 = 语义边（距离阈值内的神经链路）——「语义网络的可体验化」
// ★#389c 顶点布局统一 [x, y, size, t, alpha]（步长 20B）：点 alpha=1；线 alpha 随距离衰减；连线 → 语义边

export interface ParticleFieldOptions {
  /** 双主色（0-255 rgb），默认 brand 紫 → brand2 青 */
  colors?: [[number, number, number], [number, number, number]]
  /** 粒子上限（按面积推算后夹紧） */
  maxParticles?: number
  /** 全局不透明度（0-1） */
  alpha?: number
  /** 鼠标扰动半径（px） */
  mouseRadius?: number
  /** 连线距离阈值（px，仅大粒子参与） */
  linkDistance?: number
  /** 面积除数（越小密度越高；默认 1700） */
  densityDivisor?: number
}

export interface ParticleFieldHandle {
  destroy(): void
}

/** 粒子数按面积推算并夹紧 [140, max]（可测试的纯函数；divisor 越小密度越高） */
export function particleCountFor(width: number, height: number, max = 900, divisor = 1700): number {
  if (width <= 0 || height <= 0) return 0
  return Math.max(140, Math.min(max, Math.round((width * height) / divisor)))
}

const VERT = `
attribute vec2 a_pos;
attribute float a_size;
attribute float a_t;
attribute float a_alpha;
uniform vec2 u_res;
varying float v_t;
varying float v_alpha;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = a_size;
  v_t = a_t;
  v_alpha = a_alpha;
}`

const FRAG = `
precision mediump float;
varying float v_t;
varying float v_alpha;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform float u_alpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float a = smoothstep(1.0, 0.0, length(d) * 2.0);
  a *= a;
  vec3 col = mix(u_c1, u_c2, v_t);
  gl_FragColor = vec4(col * a * u_alpha * v_alpha, a * u_alpha * v_alpha);
}`

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

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  return prog
}

export function createParticleField(canvas: HTMLCanvasElement, opts: ParticleFieldOptions = {}): ParticleFieldHandle | null {
  let gl: WebGLRenderingContext | null = null
  try {
    gl = (canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true }) ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  } catch {
    gl = null
  }
  if (!gl) return null

  const prog = createProgram(gl)
  if (!prog) return null

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const alpha = opts.alpha ?? 0.5
  const maxParticles = opts.maxParticles ?? 900
  const mouseRadius = opts.mouseRadius ?? 150
  const linkDist = opts.linkDistance ?? 150
  const linkDist2 = linkDist * linkDist
  const densityDivisor = opts.densityDivisor ?? 1700
  const c1 = (opts.colors?.[0] ?? [124, 92, 255]).map((v) => v / 255) as [number, number, number]
  const c2 = (opts.colors?.[1] ?? [0, 224, 198]).map((v) => v / 255) as [number, number, number]

  let w = canvas.clientWidth || 300
  let h = canvas.clientHeight || 150
  let count = particleCountFor(w, h, maxParticles, densityDivisor)
  const px = new Float32Array(maxParticles)
  const py = new Float32Array(maxParticles)
  const vx = new Float32Array(maxParticles)
  const vy = new Float32Array(maxParticles)
  const size = new Float32Array(maxParticles)
  const tt = new Float32Array(maxParticles)
  const phase = new Float32Array(maxParticles)
  const isAccent = new Uint8Array(maxParticles)

  function seed(i: number): void {
    px[i] = Math.random() * w
    py[i] = Math.random() * h
    vx[i] = (Math.random() - 0.5) * 0.35
    vy[i] = (Math.random() - 0.5) * 0.35
    const accent = Math.random() < 0.11
    isAccent[i] = accent ? 1 : 0
    size[i] = (accent ? 4.8 + Math.random() * 2.4 : 1.8 + Math.random() * 2.0) * dpr
    tt[i] = Math.random()
    phase[i] = Math.random() * Math.PI * 2
  }
  for (let i = 0; i < maxParticles; i++) seed(i)

  // 顶点交错布局 [x, y, size, t, alpha]（5 floats · 20B）
  const STRIDE = 5
  const pointBuf = new Float32Array(maxParticles * STRIDE)
  const MAX_SEG = 1500
  const lineBuf = new Float32Array(MAX_SEG * 2 * STRIDE)

  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  gl.useProgram(prog)
  const uRes = gl.getUniformLocation(prog, 'u_res')
  const uC1 = gl.getUniformLocation(prog, 'u_c1')
  const uC2 = gl.getUniformLocation(prog, 'u_c2')
  const uAlpha = gl.getUniformLocation(prog, 'u_alpha')
  const aPos = gl.getAttribLocation(prog, 'a_pos')
  const aSize = gl.getAttribLocation(prog, 'a_size')
  const aT = gl.getAttribLocation(prog, 'a_t')
  const aAlpha = gl.getAttribLocation(prog, 'a_alpha')
  const pointVbo = gl.createBuffer()
  const lineVbo = gl.createBuffer()
  // ★#389c 修复：attribute 数组必须显式启用——否则顶点读到常量值，全部粒子叠在一个点（不可见）
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aSize)
  gl.enableVertexAttribArray(aT)
  gl.enableVertexAttribArray(aAlpha)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE) // 加色（premultiplied 输出——frag 已乘 alpha）
  gl.uniform3f(uC1, c1[0], c1[1], c1[2])
  gl.uniform3f(uC2, c2[0], c2[1], c2[2])
  gl.uniform1f(uAlpha, alpha)

  function bindPointers(vbo: WebGLBuffer): void {
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo)
    gl!.vertexAttribPointer(aPos, 2, gl!.FLOAT, false, 20, 0)
    gl!.vertexAttribPointer(aSize, 1, gl!.FLOAT, false, 20, 8)
    gl!.vertexAttribPointer(aT, 1, gl!.FLOAT, false, 20, 12)
    gl!.vertexAttribPointer(aAlpha, 1, gl!.FLOAT, false, 20, 16)
  }

  // —— 鼠标扰动 ——
  let mx = -9999
  let my = -9999
  let mouseActive = false
  const onMove = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect()
    if (r.width <= 0) return
    mx = e.clientX - r.left
    my = e.clientY - r.top
    mouseActive = my > -mouseRadius && my < r.height + mouseRadius
  }
  window.addEventListener('pointermove', onMove, { passive: true })

  // —— 可见性 ——
  let inView = true
  let io: IntersectionObserver | null = null
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      inView = entries.some((en) => en.isIntersecting)
      ensureLoop()
    })
    io.observe(canvas)
  }
  const onVis = (): void => ensureLoop()
  document.addEventListener('visibilitychange', onVis)

  // —— 尺寸 ——
  let ro: ResizeObserver | null = null
  function resize(): void {
    w = canvas.clientWidth || w
    h = canvas.clientHeight || h
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    gl!.viewport(0, 0, canvas.width, canvas.height)
    count = particleCountFor(w, h, maxParticles)
  }
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      resize()
      if (reducedMotion) drawStatic()
    })
    ro.observe(canvas)
  }

  function step(now: number, dtN: number): void {
    const r2 = mouseRadius * mouseRadius
    for (let i = 0; i < count; i++) {
      px[i] += vx[i] * dtN + Math.sin(now * 0.0006 + phase[i]) * 0.08 * dtN
      py[i] += vy[i] * dtN
      if (mouseActive) {
        const dx = px[i] - mx
        const dy = py[i] - my
        const d2 = dx * dx + dy * dy
        if (d2 < r2 && d2 > 0.01) {
          const d = Math.sqrt(d2)
          const f = (1 - d / mouseRadius) * 0.45 * dtN
          vx[i] += (dx / d) * f
          vy[i] += (dy / d) * f
        }
      }
      vx[i] *= 0.986
      vy[i] *= 0.986
      const m = 24
      if (px[i] < -m) px[i] = w + m
      if (px[i] > w + m) px[i] = -m
      if (py[i] < -m) py[i] = h + m
      if (py[i] > h + m) py[i] = -m
    }
  }

  function fillPoints(): void {
    for (let i = 0; i < count; i++) {
      pointBuf[i * 5] = px[i]
      pointBuf[i * 5 + 1] = py[i]
      pointBuf[i * 5 + 2] = size[i]
      pointBuf[i * 5 + 3] = tt[i]
      pointBuf[i * 5 + 4] = 1
    }
  }

  /** ★#389c 神经连线：大粒子（accent）距离 < linkDist → 语义边（alpha 随距离衰减） */
  function fillLines(): number {
    let v = 0
    for (let i = 0; i < count && v < MAX_SEG * 2; i++) {
      if (!isAccent[i]) continue
      for (let j = i + 1; j < count && v < MAX_SEG * 2; j++) {
        if (!isAccent[j]) continue
        const dx = px[i] - px[j]
        const dy = py[i] - py[j]
        const d2 = dx * dx + dy * dy
        if (d2 >= linkDist2) continue
        const a = (1 - Math.sqrt(d2) / linkDist) * 0.34
        const tMix = (tt[i] + tt[j]) / 2
        // 顶点 1
        lineBuf[v * 5] = px[i]
        lineBuf[v * 5 + 1] = py[i]
        lineBuf[v * 5 + 2] = 0
        lineBuf[v * 5 + 3] = tMix
        lineBuf[v * 5 + 4] = a
        v++
        // 顶点 2
        lineBuf[v * 5] = px[j]
        lineBuf[v * 5 + 1] = py[j]
        lineBuf[v * 5 + 2] = 0
        lineBuf[v * 5 + 3] = tMix
        lineBuf[v * 5 + 4] = a
        v++
      }
    }
    return v
  }

  function draw(): void {
    gl!.uniform2f(uRes, w, h)
    gl!.clearColor(0, 0, 0, 0)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    // 点（语义节点）
    bindPointers(pointVbo)
    gl!.bufferData(gl!.ARRAY_BUFFER, pointBuf.subarray(0, count * STRIDE), gl!.DYNAMIC_DRAW)
    gl!.drawArrays(gl!.POINTS, 0, count)
    // 线（语义边）
    const verts = fillLines()
    if (verts > 0) {
      bindPointers(lineVbo)
      gl!.bufferData(gl!.ARRAY_BUFFER, lineBuf.subarray(0, verts * STRIDE), gl!.DYNAMIC_DRAW)
      gl!.drawArrays(gl!.LINES, 0, verts)
    }
  }

  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  let raf = 0
  let running = false
  let last = 0
  function frame(now: number): void {
    raf = 0
    if (!inView || document.hidden) return
    const dtN = Math.min(50, now - last || 16.7) / 16.7
    last = now
    step(now, dtN)
    fillPoints()
    draw()
    raf = requestAnimationFrame(frame)
  }
  function ensureLoop(): void {
    const shouldRun = !reducedMotion && inView && !document.hidden
    if (shouldRun && !running) {
      running = true
      last = 0
      raf = requestAnimationFrame(frame)
    } else if (!shouldRun && running) {
      running = false
      cancelAnimationFrame(raf)
    }
  }

  resize()
  if (reducedMotion) drawStatic()
  else requestAnimationFrame(() => ensureLoop())

  function drawStatic(): void {
    fillPoints()
    gl!.uniform1f(uAlpha, alpha * 0.7)
    draw()
    gl!.uniform1f(uAlpha, alpha)
  }

  return {
    destroy(): void {
      if (raf) cancelAnimationFrame(raf)
      running = false
      ro?.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      gl!.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
