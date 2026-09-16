// src/components/p-svg-canvas/path-parser.ts
// ★2026-09-09 真机实证：真机 `createPath2D(SVG 字符串)` 不可用（模拟器可用）——
//   改用**直接绘制命令**（beginPath/moveTo/lineTo/bezierCurveTo/arc），零 Path2D 依赖，双端一致。
// 本模块把 SVG path `d` 字符串解析为 ctx 命令序列。

/** 绘制目标（微信离屏 canvas ctx 的最小路径接口） */
export interface PathTarget {
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void
  /** 原生圆弧（可选——缺省时 arcTo 回退贝塞尔分段） */
  arc?(cx: number, cy: number, r: number, start: number, end: number, ccw?: boolean): void
  /** ★2026-09-09 原生椭圆/弧（可选）——真机离屏 canvas 已实证支持（能力探测），
   *  用真曲线绘制圆弧（硬件抗锯齿）替代折线近似，消除大半径圆环的多边形折面。 */
  ellipse?(cx: number, cy: number, rx: number, ry: number, rot: number, start: number, end: number, ccw?: boolean): void
  closePath(): void
}

/** 词法：数字（含负号/小数/科学计数）+ 命令字母 */
function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) out.push(m[1] !== undefined ? m[1] : Number(m[2]))
  return out
}

/** 弧线端点参数化 → 中心参数化（SVG 规范 F.6.5），随后用 ctx.arc 绘制 */
function arcTo(
  t: PathTarget,
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xRotDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): void {
  if (rx === 0 || ry === 0) {
    t.lineTo(x2, y2)
    return
  }
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (xRotDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2
  let rxs = rx * rx
  let rys = ry * ry
  const x1ps = x1p * x1p
  const y1ps = y1p * y1p
  // 半径过小 → 按规范放大
  const lambda = x1ps / rxs + y1ps / rys
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
    rxs = rx * rx
    rys = ry * ry
  }
  const sign = largeArc !== sweep ? 1 : -1
  let num = rxs * rys - rxs * y1ps - rys * x1ps
  if (num < 0) num = 0
  const coef = sign * Math.sqrt(num / (rxs * y1ps + rys * x1ps))
  const cxp = (coef * (rx * y1p)) / ry
  const cyp = (coef * -(ry * x1p)) / rx
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI
  // ★2026-09-09 真机「锯齿」根因：此前一律把弧拆成折线（整圆仅 2π/(π/16)=32 段）→
  //   大半径圆环/圆形出现明显多边形折面。真机离屏 canvas 已实证支持 arc/ellipse（能力探测），
  //   故优先下发**原生真曲线**（硬件抗锯齿）；仅在目标不支持时回退折线近似（采样/mock 场景）。
  const cosA = Math.cos(phi)
  const sinA = Math.sin(phi)
  const theta2 = theta1 + dTheta
  const ccw = dTheta < 0
  if (Math.abs(phi) < 1e-6 && Math.abs(rx - ry) < 1e-6 && typeof t.arc === 'function') {
    t.arc(cx, cy, rx, theta1, theta2, ccw)
    return
  }
  if (typeof t.ellipse === 'function') {
    t.ellipse(cx, cy, rx, ry, phi, theta1, theta2, ccw)
    return
  }
  // 回退：折线近似
  const steps = Math.max(2, Math.ceil(Math.abs(dTheta) / (Math.PI / 16)))
  for (let i = 1; i <= steps; i++) {
    const th = theta1 + (dTheta * i) / steps
    const px = cx + rx * Math.cos(th) * cosA - ry * Math.sin(th) * sinA
    const py = cy + rx * Math.cos(th) * sinA + ry * Math.sin(th) * cosA
    t.lineTo(px, py)
  }
}

/**
 * 解析 SVG path d → 调用 target 的绘制命令（不含 beginPath/fill/stroke——由调用方负责）。
 * 支持 M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z（完整常用集）。
 */
export function tracePath(t: PathTarget, d: string): void {
  const tk = tokenize(d)
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let prevCtrlX = 0
  let prevCtrlY = 0
  let prevCmd = ''
  const num = (): number => Number(tk[i++])
  while (i < tk.length) {
    const t0 = tk[i]
    if (typeof t0 === 'string') {
      cmd = t0
      i++
    } else if (cmd === 'M') {
      cmd = 'L'
    } else if (cmd === 'm') {
      cmd = 'l'
    }
    const rel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z'
    switch (cmd.toUpperCase()) {
      case 'M': {
        const x = num()
        const y = num()
        cx = rel ? cx + x : x
        cy = rel ? cy + y : y
        sx = cx
        sy = cy
        t.moveTo(cx, cy)
        break
      }
      case 'L': {
        const x = num()
        const y = num()
        cx = rel ? cx + x : x
        cy = rel ? cy + y : y
        t.lineTo(cx, cy)
        break
      }
      case 'H': {
        const x = num()
        cx = rel ? cx + x : x
        t.lineTo(cx, cy)
        break
      }
      case 'V': {
        const y = num()
        cy = rel ? cy + y : y
        t.lineTo(cx, cy)
        break
      }
      case 'C': {
        const x1 = num()
        const y1 = num()
        const x2 = num()
        const y2 = num()
        const x = num()
        const y = num()
        const c1x = rel ? cx + x1 : x1
        const c1y = rel ? cy + y1 : y1
        const c2x = rel ? cx + x2 : x2
        const c2y = rel ? cy + y2 : y2
        const ex = rel ? cx + x : x
        const ey = rel ? cy + y : y
        t.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
        prevCtrlX = c2x
        prevCtrlY = c2y
        cx = ex
        cy = ey
        break
      }
      case 'S': {
        const x2 = num()
        const y2 = num()
        const x = num()
        const y = num()
        const c2x = rel ? cx + x2 : x2
        const c2y = rel ? cy + y2 : y2
        const c1x = /[CcSs]/.test(prevCmd) ? 2 * cx - prevCtrlX : cx
        const c1y = /[CcSs]/.test(prevCmd) ? 2 * cy - prevCtrlY : cy
        const ex = rel ? cx + x : x
        const ey = rel ? cy + y : y
        t.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey)
        prevCtrlX = c2x
        prevCtrlY = c2y
        cx = ex
        cy = ey
        break
      }
      case 'Q': {
        const qx = num()
        const qy = num()
        const x = num()
        const y = num()
        const c1x = rel ? cx + qx : qx
        const c1y = rel ? cy + qy : qy
        const ex = rel ? cx + x : x
        const ey = rel ? cy + y : y
        t.quadraticCurveTo(c1x, c1y, ex, ey)
        prevCtrlX = c1x
        prevCtrlY = c1y
        cx = ex
        cy = ey
        break
      }
      case 'T': {
        const x = num()
        const y = num()
        const c1x = /[QqTt]/.test(prevCmd) ? 2 * cx - prevCtrlX : cx
        const c1y = /[QqTt]/.test(prevCmd) ? 2 * cy - prevCtrlY : cy
        const ex = rel ? cx + x : x
        const ey = rel ? cy + y : y
        t.quadraticCurveTo(c1x, c1y, ex, ey)
        prevCtrlX = c1x
        prevCtrlY = c1y
        cx = ex
        cy = ey
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        const rot = num()
        const laf = num()
        const sf = num()
        const x = num()
        const y = num()
        const ex = rel ? cx + x : x
        const ey = rel ? cy + y : y
        arcTo(t, cx, cy, rx, ry, rot, laf, sf, ex, ey)
        cx = ex
        cy = ey
        break
      }
      case 'Z':
      case 'z': {
        t.closePath()
        cx = sx
        cy = sy
        break
      }
      default:
        i++
    }
    prevCmd = cmd
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★2026-09-09 animateMotion：路径采样（沿路径按弧长取点——SVG animateMotion 的 path 属性）
// 实现：用 tracePath 的同一套解析逻辑，但把命令记录为「点序列」而非直接下发 ctx；
//   贝塞尔/弧线离散为折线 → 累计弧长 → 按进度 t(0..1) 插值取点。
// ─────────────────────────────────────────────────────────────────────────────

/** 采样点 */
export interface SamplePoint {
  x: number
  y: number
}

/** 收集型 target：把路径命令转为折线点序列 */
function collectPoints(d: string): SamplePoint[] {
  const pts: SamplePoint[] = []
  let cur: SamplePoint = { x: 0, y: 0 }
  const t: PathTarget = {
    beginPath() {
      pts.length = 0
    },
    moveTo(x, y) {
      cur = { x, y }
      pts.push({ x, y })
    },
    lineTo(x, y) {
      cur = { x, y }
      pts.push({ x, y })
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      // 三次贝塞尔离散（16 段足够视觉平滑）
      const n = 16
      for (let i = 1; i <= n; i++) {
        const u = i / n
        const v = 1 - u
        const px = v * v * v * cur.x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * x
        const py = v * v * v * cur.y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * y
        pts.push({ x: px, y: py })
      }
      cur = { x, y }
    },
    quadraticCurveTo(cx, cy, x, y) {
      const n = 12
      for (let i = 1; i <= n; i++) {
        const u = i / n
        const v = 1 - u
        const px = v * v * cur.x + 2 * v * u * cx + u * u * x
        const py = v * v * cur.y + 2 * v * u * cy + u * u * y
        pts.push({ x: px, y: py })
      }
      cur = { x, y }
    },
    arc(cx, cy, r, s, e, ccw) {
      // 自适应段数（弧越长越密——原固定 16 段在整圆上偏粗）
      const span = Math.abs(e - s)
      const n = Math.max(8, Math.ceil(span / (Math.PI / 32)))
      for (let i = 1; i <= n; i++) {
        const a = s + ((e - s) * i) / n
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
      }
      cur = { x: cx + r * Math.cos(e), y: cy + r * Math.sin(e) }
    },
    ellipse(cx, cy, rx, ry, rot, s, e, ccw) {
      void ccw
      const span = Math.abs(e - s)
      const n = Math.max(8, Math.ceil(span / (Math.PI / 32)))
      const cosR = Math.cos(rot)
      const sinR = Math.sin(rot)
      for (let i = 1; i <= n; i++) {
        const a = s + ((e - s) * i) / n
        const ex = rx * Math.cos(a)
        const ey = ry * Math.sin(a)
        pts.push({ x: cx + ex * cosR - ey * sinR, y: cy + ex * sinR + ey * cosR })
      }
      const eex = rx * Math.cos(e)
      const eey = ry * Math.sin(e)
      cur = { x: cx + eex * cosR - eey * sinR, y: cy + eex * sinR + eey * cosR }
    },
    closePath() {
      if (pts.length) pts.push({ ...pts[0] })
    },
  }
  tracePath(t, d)
  return pts
}

/**
 * 沿 SVG path 按进度 p(0..1) 取点（弧长参数化——animateMotion 的核心）。
 * 返回 null：路径无效或点数不足。
 */
export function getPointAtLength(d: string, p: number): SamplePoint | null {
  const pts = collectPoints(d)
  if (pts.length < 2) return null
  // 累计弧长
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  const total = cum[cum.length - 1]
  if (total <= 0) return pts[0]
  const target = Math.max(0, Math.min(1, p)) * total
  // 二分/线性查找段
  let i = 1
  while (i < cum.length && cum[i] < target) i++
  if (i >= cum.length) return pts[pts.length - 1]
  const segLen = cum[i] - cum[i - 1]
  const local = segLen > 0 ? (target - cum[i - 1]) / segLen : 0
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * local,
    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * local,
  }
}

/** 路径总长度（供需要按长度匀速的场景） */
export function getPathLength(d: string): number {
  const pts = collectPoints(d)
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x
    const dy = pts[i].y - pts[i - 1].y
    total += Math.sqrt(dx * dx + dy * dy)
  }
  return total
}
