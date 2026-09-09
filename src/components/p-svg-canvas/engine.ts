// src/components/p-svg-canvas/engine.ts
// ★2026-09-09 G-62 Canvas 通道：SVG → 离屏 canvas 绘制引擎（复杂动画支持）
//
// 背景（实证链）：
//   · `<image>` 渲染 SVG 是**静态光栅化**——内部 SMIL/CSS 动画不播放（§11.1 MD5 证明）
//   · `SelectorQuery.node()` 拿不到可见 canvas（正常运行时同样 TIMEOUT，§12.2 A 探针）
//   · **离屏 canvas 完全可用**：`createOffscreenCanvas` + `getContext('2d')` + `createPath2D(svgD)`
//     + rAF 62fps + `toDataURL` 2ms + `isPointInPath`（§12.2 B-G 探针）
//
// 架构（对齐原生「几何缓存 + 每帧只改参数」思路）：
//   SVG 树 → SvgScene（解析一次，编译期产出）
//     ↓ 运行时
//   Path2D 缓存（几何复用，不重解析）→ 每帧按 t 求值改参数 → 离屏 canvas 绘制
//     → toDataURL → setData({src}) 回传 <image>（rAF 驱动，实测 48fps）
//
// 诚实边界：回传是瓶颈（18ms/次）→ 大图/高帧率场景受限；建议 ≤512px 画布 + 30fps 目标。

import { tracePath } from './path-parser'

/** 场景节点（编译期从 SVG 树产出） */
export interface SceneNode {
  /** SVG 标签类型 */
  tag: 'path' | 'circle' | 'rect' | 'ellipse' | 'line' | 'polyline' | 'polygon' | 'g'
  /** 静态属性（fill/stroke/strokeWidth/opacity…） */
  attrs: Record<string, string | number>
  /** path d（tag=path 时；createPath2D 直接接受 SVG 字符串） */
  d?: string
  /** 动画规格（可多条） */
  anims?: AnimSpec[]
  /** 子节点（g 容器） */
  children?: SceneNode[]
  /** transform（静态；动画时由 AnimSpec 覆盖） */
  transform?: Transform2D
}

/** 二维变换 */
export interface Transform2D {
  translate?: [number, number]
  rotate?: number
  scale?: [number, number]
  /** 旋转/缩放中心（viewBox 坐标） */
  origin?: [number, number]
}

/** 动画规格（SMIL → 时间轴插值） */
export interface AnimSpec {
  /** 目标属性（attributeName） */
  attr: string
  /** 变换类型（attributeName=transform 时） */
  transformType?: 'rotate' | 'scale' | 'translate'
  /** 关键值序列（字符串，按分号分隔——与 SMIL values 同形） */
  values: string[]
  /** 时长（毫秒） */
  dur: number
  /** 延迟（毫秒） */
  delay: number
  /** 是否无限循环 */
  repeat: boolean
}

/** 场景（一次解析，多次绘制） */
export interface SvgScene {
  /** viewBox（x y w h） */
  viewBox: [number, number, number, number]
  /** 根节点列表 */
  nodes: SceneNode[]
  /** 总时长（所有动画的最大值；0 = 静态） */
  duration: number
}

/** 绘制上下文（微信离屏 canvas 的最小接口） */
export interface DrawCtx {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  lineCap: string
  lineJoin: string
  /** ★2026-09-09 描边虚线（SVG stroke-dasharray → Canvas setLineDash 语义；数组或字符串） */
  setLineDash?(segments: number[]): void
  /** ★SVG stroke-dashoffset → Canvas lineDashOffset */
  lineDashOffset?: number
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(rad: number): void
  scale(x: number, y: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  arc(cx: number, cy: number, r: number, s: number, e: number, ccw?: boolean): void
  closePath(): void
  fill(): void
  stroke(): void
  fillRect(x: number, y: number, w: number, h: number): void
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void }
  createRadialGradient(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number): { addColorStop(o: number, c: string): void }
}

/** 离屏 canvas（最小接口） */
export interface OffscreenCanvasLike {
  width: number
  height: number
  getContext(type: '2d'): DrawCtx
  /** @deprecated 真机不可用（保留仅为类型兼容）——改用 tracePath */
  createPath2D?(d?: string): unknown
  toDataURL(type?: string, quality?: number): string
  requestAnimationFrame(cb: (t: number) => void): number
  cancelAnimationFrame(id: number): void
}

/** 缓动函数（SMIL 默认 linear；calcMode=spline 时用 easeInOut） */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** 在关键值序列上按进度 p(0..1) 插值（分段线性） */
export function sampleValues(values: string[], p: number): string {
  if (!values.length) return ''
  if (values.length === 1) return values[0]
  const clamped = Math.max(0, Math.min(1, p))
  const seg = clamped * (values.length - 1)
  const i = Math.min(values.length - 2, Math.floor(seg))
  const local = seg - i
  const a = values[i]
  const b = values[i + 1]
  // 数值插值（支持 "1;0.5;1" / "0,0;10,0" 等）
  const na = a.split(/[,\s]+/).map(Number)
  const nb = b.split(/[,\s]+/).map(Number)
  if (na.length === nb.length && na.every((n) => !Number.isNaN(n)) && nb.every((n) => !Number.isNaN(n))) {
    return na.map((n, k) => n + (nb[k] - n) * local).join(',')
  }
  return local < 0.5 ? a : b // 非数值（颜色等）→ 阶跃
}

/** 计算某时刻 t(ms) 的动画属性值 */
export function evalAnim(anim: AnimSpec, tMs: number): string | null {
  const total = anim.dur + anim.delay
  if (total <= 0) return anim.values[anim.values.length - 1] ?? null
  let local = tMs - anim.delay
  if (local < 0) return anim.values[0] ?? null
  if (anim.repeat) local = local % anim.dur
  else if (local >= anim.dur) local = anim.dur
  const p = anim.dur > 0 ? local / anim.dur : 1
  return sampleValues(anim.values, easeInOut(p))
}

/** 取节点在时刻 t 的 transform（静态 + 动画覆盖） */
function nodeTransform(node: SceneNode, tMs: number): Transform2D | undefined {
  let tf = node.transform
  if (!node.anims) return tf
  for (const a of node.anims) {
    if (a.attr !== 'transform' || !a.transformType) continue
    const v = evalAnim(a, tMs)
    if (v === null) continue
    const nums = v.split(/[,\s]+/).map(Number)
    tf = { ...tf }
    if (a.transformType === 'rotate') {
      tf.rotate = nums[0] || 0
      if (nums.length >= 3) tf.origin = [nums[1], nums[2]]
    } else if (a.transformType === 'scale') {
      tf.scale = [nums[0] ?? 1, nums[1] ?? nums[0] ?? 1]
    } else if (a.transformType === 'translate') {
      tf.translate = [nums[0] || 0, nums[1] || 0]
    }
  }
  return tf
}

/** 取节点在时刻 t 的数值属性（fill/stroke/opacity/r 等） */
function nodeAttr(node: SceneNode, name: string, tMs: number): string | number | undefined {
  let v: string | number | undefined = node.attrs[name]
  if (node.anims) {
    for (const a of node.anims) {
      if (a.attr === name) {
        const s = evalAnim(a, tMs)
        if (s !== null) v = s
      }
    }
  }
  return v
}

/** 应用变换到 ctx */
function applyTransform(ctx: DrawCtx, tf: Transform2D | undefined): void {
  if (!tf) return
  const [ox, oy] = tf.origin ?? [0, 0]
  if (tf.translate) ctx.translate(tf.translate[0], tf.translate[1])
  if (tf.rotate || tf.scale) {
    ctx.translate(ox, oy)
    if (tf.rotate) ctx.rotate((tf.rotate * Math.PI) / 180)
    if (tf.scale) ctx.scale(tf.scale[0], tf.scale[1])
    ctx.translate(-ox, -oy)
  }
}

/** 把 hex/rgb 颜色与透明度合成（canvas 无 fill-opacity → 用 globalAlpha 近似） */
function colorOf(v: string | number | undefined, fallback: string): string {
  if (v === undefined || v === null) return fallback
  const s = String(v)
  return s === 'none' ? 'none' : s
}

/** 绘制单个节点（递归） */
function drawNode(ctx: DrawCtx, canvas: OffscreenCanvasLike, node: SceneNode, tMs: number): void {
  ctx.save()
  applyTransform(ctx, nodeTransform(node, tMs))

  const opacity = nodeAttr(node, 'opacity', tMs)
  if (opacity !== undefined) ctx.globalAlpha = Number(opacity) || 0

  if (node.tag === 'g') {
    for (const c of node.children ?? []) drawNode(ctx, canvas, c, tMs)
    ctx.restore()
    return
  }

  const fill = colorOf(nodeAttr(node, 'fill', tMs), '#000')
  const stroke = colorOf(nodeAttr(node, 'stroke', tMs), 'none')
  const sw = nodeAttr(node, 'strokeWidth', tMs)
  if (sw !== undefined) ctx.lineWidth = Number(sw) || 1
  const lc = nodeAttr(node, 'strokeLinecap', tMs)
  if (lc) ctx.lineCap = String(lc)
  const lj = nodeAttr(node, 'strokeLinejoin', tMs)
  if (lj) ctx.lineJoin = String(lj)
  // ★2026-09-09 真机实证补：stroke-dasharray / stroke-dashoffset（描边进度动画必需——
  //   SVG 的 dashoffset 从 N 变 0 = 线条「画出来」的经典效果；此前完全未处理 → 描边动画不动）
  const da = nodeAttr(node, 'strokeDasharray', tMs) ?? nodeAttr(node, 'stroke-dasharray', tMs)
  if (da !== undefined && da !== '' && String(da) !== 'none' && typeof ctx.setLineDash === 'function') {
    const segs = String(da).split(/[,\s]+/).map(Number).filter((n) => !Number.isNaN(n))
    if (segs.length) ctx.setLineDash(segs)
  }
  const doff = nodeAttr(node, 'strokeDashoffset', tMs) ?? nodeAttr(node, 'stroke-dashoffset', tMs)
  if (doff !== undefined) ctx.lineDashOffset = Number(doff) || 0

  // 几何：★真机实证 createPath2D(SVG 字符串) 不可用（模拟器可用）→ 自写解析器直接下发绘制命令
  const d = node.tag === 'path' ? (node.d ?? '') : primitiveToPathD(node, tMs)
  if (d) {
    ctx.beginPath()
    tracePath(ctx, d)
    if (fill !== 'none') {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke !== 'none') {
      ctx.strokeStyle = stroke
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** 基础图形 → 等价 SVG path d（支持动画属性插值） */
export function primitiveToPathD(node: SceneNode, tMs: number): string {
  const n = (name: string, dflt: number): number => {
    const v = nodeAttr(node, name, tMs)
    return v === undefined ? dflt : Number(v) || 0
  }
  switch (node.tag) {
    case 'circle': {
      const cx = n('cx', 0), cy = n('cy', 0), r = n('r', 0)
      return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
    }
    case 'ellipse': {
      const cx = n('cx', 0), cy = n('cy', 0), rx = n('rx', 0), ry = n('ry', 0)
      return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
    }
    case 'rect': {
      const x = n('x', 0), y = n('y', 0), w = n('width', 0), h = n('height', 0)
      return `M${x} ${y} H${x + w} V${y + h} H${x} Z`
    }
    case 'line': {
      const x1 = n('x1', 0), y1 = n('y1', 0), x2 = n('x2', 0), y2 = n('y2', 0)
      return `M${x1} ${y1} L${x2} ${y2}`
    }
    case 'polyline':
    case 'polygon': {
      const pts = String(nodeAttr(node, 'points', tMs) ?? '').trim()
      if (!pts) return ''
      return `M${pts.replace(/[,\s]+/g, ' ').trim().replace(/ /g, ' L')}` + (node.tag === 'polygon' ? ' Z' : '')
    }
    default:
      return ''
  }
}

/** 绘制一帧（清空 + 全场景重绘） */
export function drawScene(canvas: OffscreenCanvasLike, scene: SvgScene, tMs: number): void {
  const ctx = canvas.getContext('2d')
  const [vx, vy, vw, vh] = scene.viewBox
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  // viewBox → 画布缩放
  ctx.scale(canvas.width / vw, canvas.height / vh)
  ctx.translate(-vx, -vy)
  for (const node of scene.nodes) drawNode(ctx, canvas, node, tMs)
}

/** 命中判定：点是否落在场景任一图形内（viewBox 坐标——包围盒近似，零 Path2D 依赖）。
 *  诚实边界：path 用采样点包围盒（曲线/凹形可能误判）；circle/ellipse/rect 精确。 */
export function hitTest(canvas: OffscreenCanvasLike, scene: SvgScene, px: number, py: number): number {
  void canvas
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const node = scene.nodes[i]
    const n = (name: string, dflt: number): number => {
      const v = node.attrs[name]
      return v === undefined ? dflt : Number(v) || 0
    }
    if (node.tag === 'circle') {
      const cx = n('cx', 0), cy = n('cy', 0), r = n('r', 0)
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) return i
    } else if (node.tag === 'ellipse') {
      const cx = n('cx', 0), cy = n('cy', 0), rx = n('rx', 0), ry = n('ry', 0)
      if (rx > 0 && ry > 0 && ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1) return i
    } else if (node.tag === 'rect') {
      const x = n('x', 0), y = n('y', 0), w = n('width', 0), h = n('height', 0)
      if (px >= x && px <= x + w && py >= y && py <= y + h) return i
    } else {
      const d = node.d ?? ''
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
      const xs = nums.filter((_, k) => k % 2 === 0)
      const ys = nums.filter((_, k) => k % 2 === 1)
      if (xs.length && ys.length) {
        if (px >= Math.min(...xs) && px <= Math.max(...xs) && py >= Math.min(...ys) && py <= Math.max(...ys)) return i
      }
    }
  }
  return -1
}
