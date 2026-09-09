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
  arc(cx: number, cy: number, r: number, start: number, end: number, ccw?: boolean): void
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
  // ctx.arc 仅支持圆；椭圆用缩放近似（rx===ry 时精确）
  const steps = Math.max(2, Math.ceil(Math.abs(dTheta) / (Math.PI / 16)))
  const cosA = Math.cos(phi)
  const sinA = Math.sin(phi)
  for (let i = 1; i <= steps; i++) {
    const th = theta1 + (dTheta * i) / steps
    const px = cx + rx * Math.cos(th) * cosA - ry * Math.sin(th) * sinA
    const py = cy + rx * Math.cos(th) * sinA + ry * Math.sin(th) * cosA
    if (i === 1) t.lineTo(px, py)
    else t.lineTo(px, py)
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
