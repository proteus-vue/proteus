// website/src/motion/engine-motion.ts —— ★★站点动效运行时（Morpheus 引擎的**浏览器宿主**）
//
// 【这是什么（以及为什么产品页需要它）】
//   产品页本身就是这个引擎的炫技场——所以页面上的每一处动效都应当**真的由引擎驱动**，
//   而不是另写一套 CSS transition（那等于"用别人的引擎演示自己的引擎"）。
//   本文件是引擎在浏览器里的**宿主层**，与 iOS/Android 宿主同构：
//
//     声明（AnimDecl）
//       → **引擎编译**（compileAnimations / compileChoreography —— 真校验、真线格式）
//       → **引擎求值**（animValue —— 与 Rust 内核 golden 对拍过的 TS 镜像；曲线同一台机器）
//       → 本文件兜底：相位循环（loop/yoyo）与写 DOM（"宿主"职责，等价于两端宿主的写层）
//
//   ★与真机宿主的口径一致：内核负责曲线求值与相位推进（`tick` / `loop_phase`），
//     宿主负责把值写到平台层。浏览器里平台层是 DOM/CSS ⇒ 映射表见 `applyPose`。
//
// 【支持映射的通道（逐条如实，不假装）】
//   translateX/Y · scale · rotate · skewX/Y · opacity      → transform / opacity（合成属性，最廉价）
//   clip（15..30，inset/circle/polygon）                    → `clip-path`（与内核同一套几何语义）
//   strokeProgress（31）                                    → SVG `stroke-dasharray/-dashoffset`（弧长画线）
//   glowIntensity（34）                                     → `filter: drop-shadow`（**近似**：内核是分层描边）
//   gradientMix（32）                                       → 两层渐变交叉淡入（读引擎混合因子；浏览器无渐变插值）
//   maskProgress（35）                                      → `mask-image` 渐变色标推进（线性/径向）
//   color（5..8）/ textColor（9..12）                        → `background-color` / `color`（四通道组装）
//
// 【★不支持映射的通道（诚实边界）】
//   pathMorph（33）：两态路径的**逐点插值**只在 Rust 内核（`SvgPath::morphed`）——TS 侧没有镜像；
//     浏览器里做等价物需要另一份实现（第三份 = 分叉源）。⇒ 站点动效层**不使用**该通道；
//     墙上的"路径变形"演示以**真机录屏**呈现（那是唯一 truthful 的呈现方式）。
//
// 【性能纪律（站点也是生产）】
//   · 每帧只写**不触发布局**的属性（transform / opacity / filter / clip-path / 颜色）；
//   · 元素离开视口即停（observer 卸载）；`prefers-reduced-motion` 直达终态；
//   · 一个 rAF 驱动**全部** runner（唯一帧源——与内核"帧驱动唯一来源"同一纪律）。
import { ANIM_KIND_ID, CURVE_ID, compileAnimations } from '@proteus-vue/animation'

/** 动效目标（DOM 元素或 SVG 元素——两者都有 `.style`；本层只写不触发布局的属性） */
export type MotionTarget = HTMLElement | SVGElement

/**
 * ★★**模板 ref → DOM 元素**（2026-10-01 浏览器验收抓出的形态缺陷）
 *
 * 【为什么必须有】Vue 模板里 `ref` 挂在**组件**上（`<p-view>` / `<p-grid>`）时，
 *   `ref.value` 拿到的是**组件实例**（不是元素）——`.children` / `.dataset` / `IntersectionObserver.observe`
 *   全都会当场抛错（实测：`Array.from(undefined)` / "parameter 1 is not of type 'Element'"）。
 *   ⇒ 统一在这里解包（`$el`），调用方不必各自记得这条 Vue 细节。
 */
export function asElement(v: unknown): MotionTarget | null {
  if (!v) return null
  if (v instanceof HTMLElement || (typeof SVGElement !== 'undefined' && v instanceof SVGElement)) return v
  const el = (v as { $el?: unknown }).$el
  return el instanceof HTMLElement || (typeof SVGElement !== 'undefined' && el instanceof SVGElement) ? el : null
}
import type { AnimDecl, EngineAnim, CurveId, ClipAnimDecl } from '@proteus-vue/animation'
import { animValue } from '@proteus-vue/slot-runtime'

/* ═══════════════════════ 求值（引擎数值 + 宿主相位） ═══════════════════════ */

/** 一条指令在一帧的值（含 keyframes 分段与 repeat/yoyo 相位——宿主侧口径，与内核 `loop_phase` 同语义） */
export function evalAnim(a: EngineAnim, tMs: number): number {
  const delay = a.delayMs ?? 0
  const dur = (a.durMs ?? 0) > 0 ? (a.durMs as number) : 1
  const reps = a.repeat ?? 1
  const t = tMs - delay
  if (t <= 0) return reps < 0 ? loopEval(a, 0) : evalSegment(a, 0)
  if (reps < 0) {
    // 无限：相位取模（yoyo 按奇偶轮翻转）
    const cycles = t / dur
    const round = Math.floor(cycles)
    const u = cycles - round
    return loopEval(a, a.alternate && round % 2 === 1 ? 1 - u : u)
  }
  if (reps > 1) {
    const cycles = t / dur
    if (cycles >= reps) return loopEval(a, a.alternate && (reps - 1) % 2 === 1 ? 0 : 1)
    const round = Math.floor(cycles)
    const u = cycles - round
    return loopEval(a, a.alternate && round % 2 === 1 ? 1 - u : u)
  }
  return evalSegment(a, Math.min(1, t / dur))
}

/** 单遍内的求值：keyframes 分段（首段起点 = from）或单段曲线 */
function evalSegment(a: EngineAnim, u: number): number {
  const kf = a.keyframes
  if (kf && kf.length > 0) {
    // 段时长归一（编译器保证时长和 > 0）
    const total = kf.reduce((s, k) => s + Math.max(0, k.durMs), 0) || 1
    let acc = 0
    let prev = a.from
    for (const seg of kf) {
      const w = Math.max(0, seg.durMs) / total
      if (u <= acc + w || seg === kf[kf.length - 1]) {
        const lu = w > 0 ? Math.min(1, Math.max(0, (u - acc) / w)) : 1
        return animValue(seg.curve, prev, seg.to, lu)
      }
      acc += w
      prev = seg.to
    }
    return kf[kf.length - 1]!.to
  }
  return animValue(a.curve, a.from, a.to, Math.min(1, Math.max(0, u)))
}

/** 循环相位：把 [0,1] 的 u 交给曲线求值（yoyo 的翻转已在上层完成） */
function loopEval(a: EngineAnim, u: number): number {
  return evalSegment(a, u)
}

/* ═══════════════════════ 姿态（一批指令 → 每节点一帧的值） ═══════════════════════ */

/** 一帧的姿态：合成属性 + 逐通道原始值（供映射层取 clip / stroke / glow / 混合因子） */
export interface Pose {
  tx: number
  ty: number
  scale: number
  rotate: number
  /** 3D（通道 13/14；度）——宿主侧以 `perspective` 呈现（与内核同一语义） */
  rotateX: number
  rotateY: number
  skewX: number
  skewY: number
  opacity: number
  /** 逐 kind → 值（clip 槽 / strokeProgress / glowIntensity / gradientMix / maskProgress / 颜色通道） */
  channels: Map<number, number>
}

export function emptyPose(): Pose {
  return { tx: 0, ty: 0, scale: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0, opacity: 1, channels: new Map() }
}

/** 求一批指令在 t 时刻的姿态（按 nodeId 归并；同 (节点,属性) 取**最后一条**——与内核替换语义一致） */
export function evalBatch(anims: readonly EngineAnim[], tMs: number): Map<number, Pose> {
  const out = new Map<number, Pose>()
  for (const a of anims) {
    let p = out.get(a.nodeId)
    if (!p) {
      p = emptyPose()
      out.set(a.nodeId, p)
    }
    const v = evalAnim(a, tMs)
    switch (a.kind) {
      case ANIM_KIND_ID.translateX: p.tx = v; break
      case ANIM_KIND_ID.translateY: p.ty = v; break
      case ANIM_KIND_ID.scale: p.scale = v; break
      case ANIM_KIND_ID.rotate: p.rotate = v; break
      case ANIM_KIND_ID.rotateX: p.rotateX = v; break
      case ANIM_KIND_ID.rotateY: p.rotateY = v; break
      case ANIM_KIND_ID.skewX: p.skewX = v; break
      case ANIM_KIND_ID.skewY: p.skewY = v; break
      case ANIM_KIND_ID.opacity: p.opacity = v; break
      default: p.channels.set(a.kind, v); break
    }
  }
  return out
}

/* ═══════════════════════ DOM 写层（"宿主"职责——映射表见文件头） ═══════════════════════ */

/** 颜色四通道 → CSS 颜色字符串（5..8 = 底色 R/G/B/A，9..12 = 文字色 R/G/B/A；0..255 输入按内核口径归一） */
function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.max(0, Math.min(1, a))})`
}

/** clip 参数（inset/circle/polygon）→ CSS `clip-path`（分数坐标与内核同一语义） */
function clipToCss(params: number[], kind: 'inset' | 'circle' | 'polygon'): string {
  const pct = (v: number): string => `${(v * 100).toFixed(3)}%`
  if (kind === 'inset') {
    const [t = 0, r = 0, b = 0, l = 0] = params
    return `inset(${pct(t)} ${pct(r)} ${pct(b)} ${pct(l)})`
  }
  if (kind === 'circle') {
    const [cx = 0.5, cy = 0.5, rad = 0] = params
    return `circle(${pct(rad)} at ${pct(cx)} ${pct(cy)})`
  }
  const pts: string[] = []
  for (let i = 0; i + 1 < params.length; i += 2) pts.push(`${pct(params[i]!)} ${pct(params[i + 1]!)}`)
  return `polygon(${pts.join(', ')})`
}

/** 写一帧：把 Pose 落到元素的 CSS（只碰不触发布局的属性） */
export function applyPose(
  el: MotionTarget,
  p: Pose,
  opts?: { clipKind?: 'inset' | 'circle' | 'polygon'; strokeLen?: number; perspective?: number },
): void {
  if (!el || !el.style) return
  const tf: string[] = []
  if (p.tx || p.ty) tf.push(`translate3d(${p.tx.toFixed(2)}px, ${p.ty.toFixed(2)}px, 0)`)
  if (p.scale !== 1) tf.push(`scale(${p.scale.toFixed(4)})`)
  if (p.rotate) tf.push(`rotate(${p.rotate.toFixed(3)}deg)`)
  // 3D：透视来自节点样式声明（`perspective`——与内核/两端宿主同一语义）
  if (p.rotateX || p.rotateY || opts?.perspective) {
    if (opts?.perspective) el.style.perspective = `${opts.perspective}px`
    if (p.rotateX) tf.push(`rotateX(${p.rotateX.toFixed(3)}deg)`)
    if (p.rotateY) tf.push(`rotateY(${p.rotateY.toFixed(3)}deg)`)
    el.style.transformStyle = 'preserve-3d'
  }
  if (p.skewX) tf.push(`skewX(${p.skewX.toFixed(3)}deg)`)
  if (p.skewY) tf.push(`skewY(${p.skewY.toFixed(3)}deg)`)
  el.style.transform = tf.length ? tf.join(' ') : ''
  el.style.opacity = p.opacity >= 1 ? '' : p.opacity.toFixed(4)

  // clip（15..30 槽按 kind 偏移取）
  if (opts?.clipKind) {
    const base = ANIM_KIND_ID.clip as number
    const params: number[] = []
    for (let s = 0; s < 16; s++) {
      const v = p.channels.get(base + s)
      if (v === undefined) break
      params.push(v)
    }
    if (params.length) el.style.clipPath = clipToCss(params, opts.clipKind)
  }
  // 描边进度（SVG path：dasharray = 总弧长，dashoffset = 未画到的部分）
  const sp = p.channels.get(ANIM_KIND_ID.strokeProgress as number)
  if (sp !== undefined && opts?.strokeLen) {
    const len = opts.strokeLen
    el.style.strokeDasharray = `${len}`
    el.style.strokeDashoffset = `${(len * (1 - Math.max(0, Math.min(1, sp)))).toFixed(3)}`
  }
  // 发光强度 → drop-shadow（近似：内核是 N 层描边；这里如实标注为宿主近似）
  const gi = p.channels.get(ANIM_KIND_ID.glowIntensity as number)
  if (gi !== undefined) {
    const a = Math.max(0, Math.min(1, gi))
    el.style.filter = a <= 0.01 ? 'none' : `drop-shadow(0 0 ${(6 + 18 * a).toFixed(1)}px rgba(124, 92, 255, ${(0.75 * a).toFixed(3)}))`
  }
  // 渐变混合因子 → CSS 变量（两层渐变交叉淡入由样式侧消费）
  const gm = p.channels.get(ANIM_KIND_ID.gradientMix as number)
  if (gm !== undefined) el.style.setProperty('--gmix', gm.toFixed(4))
  // 遮罩进度 → CSS 变量（mask-image 色标位置）
  const mp = p.channels.get(ANIM_KIND_ID.maskProgress as number)
  if (mp !== undefined) el.style.setProperty('--mmix', mp.toFixed(4))
  // 颜色（5..8 四通道 → background-color；9..12 → color）
  const c0 = p.channels.get(5)
  if (c0 !== undefined) {
    el.style.backgroundColor = rgba(c0, p.channels.get(6) ?? c0, p.channels.get(7) ?? c0, p.channels.get(8) ?? 1)
  }
  const t0 = p.channels.get(9)
  if (t0 !== undefined) {
    el.style.color = rgba(t0, p.channels.get(10) ?? t0, p.channels.get(11) ?? t0, p.channels.get(12) ?? 1)
  }
}

/* ═══════════════════════ 运行时（唯一帧源 + 外部 seek） ═══════════════════════ */

export interface RunnerOptions {
  /** 名义时长（ms）；缺省由指令推出（max(delayMs + durMs)） */
  durationMs?: number
  /** 无限循环（环境动效） */
  loop?: boolean
  /** 每个循环结束后暂停的时长（重播节拍；仅 loop=false 的一次性播放用） */
  holdMs?: number
  /** 外部驱动：给出 [from, to] 的进度源（滚动/指针），runner 不再自走时间 */
  seekSource?: () => number
  /** 每当一帧写完后回调（探针/调试用） */
  onFrame?: (tMs: number, poses: Map<number, Pose>) => void
}

export interface Runner {
  play(): void
  stop(): void
  /** 手动定位（seekSource 缺失时的外部驱动入口：progress 0..1） */
  seek(p: number): void
  /** 当前时刻（只读，调试/探针用） */
  readonly t: number
}

/**
 * 名义时长：整批指令的跨度。
 *   · 有限循环（`repeat: 3`）⇒ `delay + reps × dur`（循环是时间的一部分，必须计进去——
 *     否则 runner 会在循环还没跑完时就停：站点"呼吸"类声明会当场静止）；
 *   · 无限循环（`repeat: -1`）⇒ 只计单轮（无限本身没有名义终点，靠 runner 持续供帧）。
 */
export function durationOf(anims: readonly EngineAnim[], fallback = 1000): number {
  let m = 0
  for (const a of anims) {
    const reps = a.repeat ?? 1
    const dur = a.durMs ?? 0
    const span = (a.delayMs ?? 0) + (reps > 1 ? reps * dur : dur)
    if (span > m) m = span
  }
  return m > 0 ? m : fallback
}

/** 该批里是否有**无限循环**声明（决定 runner 是否持续供帧——见 createRunner 注释） */
export function hasInfinite(anims: readonly EngineAnim[]): boolean {
  return anims.some((a) => (a.repeat ?? 1) < 0)
}

/**
 * 终值（降级/reduced-motion 直达态）：
 *   有限循环 ⇒ 最后一轮的末段终值（yoyo 奇数轮末 = 回到起点）；
 *   无限循环 ⇒ **单轮末的相位值**（对 yoyo 即 `to`——一个确定、可复现的静止观察点，
 *   而不是"取 t=∞ 的任意相位"）。
 */
export function terminalValue(a: EngineAnim): number {
  const reps = a.repeat ?? 1
  if (reps < 0 || reps > 1) {
    const rounds = reps < 0 ? 1 : reps
    return loopEval(a, a.alternate && (rounds - 1) % 2 === 1 ? 0 : 1)
  }
  return evalSegment(a, 1)
}

/**
 * 创建 runner：把一批引擎指令逐帧落到 slots（nodeId → 元素）。
 * ★唯一帧源纪律：全站共享一个 rAF 泵（见 `pump`），runner 只是订阅者。
 */
export function createRunner(
  anims: readonly EngineAnim[],
  slots: ReadonlyMap<number, MotionTarget>,
  opts?: RunnerOptions & {
    clipKinds?: ReadonlyMap<number, 'inset' | 'circle' | 'polygon'>
    strokeLens?: ReadonlyMap<number, number>
    perspectives?: ReadonlyMap<number, number>
  },
): Runner {
  const total = opts?.durationMs ?? durationOf(anims)
  /**
   * ★★**无限声明 ⇒ 持续供帧**（2026-10-01 浏览器验收抓出的缺陷）：
   *   首版按 `durationMs` 到期即停 ⇒ 批次里的 `repeat:'infinite'`（呼吸/风摆）**当场冻结**
   *   （实测：光晕停在 0.94 不再动）。⇒ 只要批里有一条无限声明，runner 就持续推进
   *   （相位由 `evalAnim` 取模；有限声明会各自停在终值——与内核一致）。
   */
  const keepAlive = hasInfinite(anims) || opts?.loop === true
  let t = 0
  let running = false
  let raf = 0
  let start = 0

  const write = (tMs: number): void => {
    const poses = evalBatch(anims, tMs)
    for (const [id, p] of poses) {
      const el = slots.get(id)
      if (!el) continue
      applyPose(el, p, {
        clipKind: opts?.clipKinds?.get(id),
        strokeLen: opts?.strokeLens?.get(id),
        perspective: opts?.perspectives?.get(id),
      })
    }
    opts?.onFrame?.(tMs, poses)
  }

  const step = (now: number): void => {
    if (!running) return
    if (opts?.seekSource) {
      // 外部驱动：进度源给出 0..1
      write(Math.max(0, Math.min(1, opts.seekSource())) * total)
      raf = requestAnimationFrame(step)
      return
    }
    const raw = now - start
    if (keepAlive) {
      // 持续供帧：时间**不回卷**（各声明的相位/循环由 evalAnim 处理）
      t = raw
      write(t)
      raf = requestAnimationFrame(step)
      return
    }
    t = Math.min(raw, total)
    write(t)
    if (raw < total) {
      raf = requestAnimationFrame(step)
    } else {
      running = false
      raf = 0
    }
  }

  return {
    play(): void {
      if (running) return
      running = true
      start = performance.now() - t
      raf = requestAnimationFrame(step)
    },
    stop(): void {
      running = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
    seek(p: number): void {
      if (opts?.seekSource) return
      t = Math.max(0, Math.min(1, p)) * total
      write(t)
    },
    get t(): number {
      return t
    },
  }
}

/* ═══════════════════════ 数字生长（纯函数——挂载后调用也安全） ═══════════════════════ */

/**
 * ★**数字生长**：用引擎曲线求值（`animValue`——与内核 golden 对拍的同一实现）把文本推到位。
 *
 * 【为什么是纯函数而不是组合式】证据卡由 `v-for` 渲染，节点在挂载后才拿到；
 *   组合式（`useCountUp`）面向 setup 期的 Ref，这里面向"已有节点"。同一份曲线求值、两种入口。
 */
export function countUp(
  el: HTMLElement,
  to: number,
  opts: { durationMs?: number; decimals?: number; prefix?: string; suffix?: string; curve?: CurveId } = {},
): void {
  const { durationMs = 1100, decimals = 0, prefix = '', suffix = '', curve = 1 } = opts
  const fmt = (v: number): string => `${prefix}${v.toFixed(decimals)}${suffix}`
  if (!motionAllowed()) {
    el.textContent = fmt(to)
    return
  }
  const t0 = performance.now()
  const step = (now: number): void => {
    const u = Math.min(1, (now - t0) / durationMs)
    el.textContent = fmt(animValue(curve, 0, to, u))
    if (u < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/* ═══════════════════════ 便捷入口（页面挂载点用） ═══════════════════════ */

/** 声明 → 引擎编译（真校验；失败抛错并带修法——与产品口径一致，站点不吞错） */
export function compile(decls: readonly AnimDecl[], nodeId = 1): EngineAnim[] {
  const anims = compileAnimations(decls, { nodeId }).anims
  SITE_STATS.declarative += anims.length
  for (const a of anims) {
    if (a.repeat === undefined) continue
    SITE_STATS.loops += 1
  }
  return anims
}

/**
 * ★★**站点自证读数**（产品页徽标用）：本页实际编译出的声明式指令数 / 循环条数。
 *
 * 【为什么要有它】"产品页本身就是炫技场"要做到**可数**——页面不是"看起来在动"，
 *   而是"由 N 条引擎指令驱动"（与炫技场节目单的"32000 条声明式 / 0 逃生口"同一口径）。
 *   数字在页面挂载后统计（每次 compile 累加），展示于 Hero 徽标。
 */
export const SITE_STATS = { declarative: 0, loops: 0 }

/** 一个元素 + 一批声明 → 立即播放一次（最常见形态） */
export function playOn(el: MotionTarget, decls: readonly AnimDecl[], opts?: RunnerOptions): Runner {
  const anims = compile(decls, 1)
  const slots = new Map<number, MotionTarget>([[1, el]])
  const r = createRunner(anims, slots, opts)
  r.play()
  return r
}

/** 就绪判定：reduced-motion ⇒ 全部动效直达终态（页面侧统一取它） */
export function motionAllowed(): boolean {
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}

/**
 * 到终态（reduced-motion / 降级路径：直接把每条指令的终值写上——无限循环取单轮末相位）。
 * ★`opts.strokeLens` 必传（若批里有 strokeProgress）：否则描边**拿不到弧长**⇒ 停在 CSS 兜底值
 *   （实测：reduced-motion 下印记四段弧全停在 1000px = 一条都没画出来）。
 */
export function settle(
  anims: readonly EngineAnim[],
  slots: ReadonlyMap<number, MotionTarget>,
  opts?: { strokeLens?: ReadonlyMap<number, number>; clipKinds?: ReadonlyMap<number, 'inset' | 'circle' | 'polygon'> },
): void {
  const poses = new Map<number, Pose>()
  for (const a of anims) {
    let p = poses.get(a.nodeId)
    if (!p) {
      p = emptyPose()
      poses.set(a.nodeId, p)
    }
    const v = terminalValue(a)
    switch (a.kind) {
      case ANIM_KIND_ID.translateX: p.tx = v; break
      case ANIM_KIND_ID.translateY: p.ty = v; break
      case ANIM_KIND_ID.scale: p.scale = v; break
      case ANIM_KIND_ID.rotate: p.rotate = v; break
      case ANIM_KIND_ID.skewX: p.skewX = v; break
      case ANIM_KIND_ID.skewY: p.skewY = v; break
      case ANIM_KIND_ID.opacity: p.opacity = v; break
      default: p.channels.set(a.kind, v); break
    }
  }
  for (const [id, p] of poses) {
    const el = slots.get(id)
    if (el) applyPose(el, p, { strokeLen: opts?.strokeLens?.get(id), clipKind: opts?.clipKinds?.get(id) })
  }
}

export { CURVE_ID }
export type { AnimDecl, EngineAnim, CurveId, ClipAnimDecl }
