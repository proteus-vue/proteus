// packages/icons/src/normalize.ts —— SVG path `d` **归一化**：任意常用命令 → 仅绝对 M/L/C/Q/Z。
//
// 【为什么需要（图标库方案 §5 ①）】内核 `svg_path.rs` **只认 M/L/C/Q/Z**（明确拒绝 A 弧 与 S/T 平滑曲线
//   ——消息给修法："先转成 C/Q"）。设计工具导出的图标常带 A/S/T ⇒ 必须在**构建期/消费前**转成内核能吃的形态。
//   ⇒ 本转换器 = "内核拒绝的那半"的工具端（唯一实现；各端不再各写一份——本仓纪律 #22）。
//
// 【支持集】M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z（完整常用集），全部**展开为绝对**命令
//   （相对/隐含重复/平滑控制点反射/弧→三次贝塞尔 都在这里处理）。
// 【输出】仅含 `M x y L x y C … Q … Z`（绝对）——① 内核 svg_path.rs 可解析；
//   ② Web 内联 <svg d=…> 可渲染；③ MP Path2D 可消费（同一份 `d`）。
//
// 【弧 A→C】用 SVG 规范 F.6.5（端点参数化→中心参数化）+ 标准三次贝塞尔近似（每段 ≤90°）。
const TAU = Math.PI * 2

function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) out.push(m[1] !== undefined ? m[1] : Number(m[2]))
  return out
}

/** 格式化数字（去掉浮点噪声；保留 3 位小数足够图标精度）。 */
function f(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Number.isInteger(r) ? String(r) : String(r)
}

/** 两点夹角（向量 u→v；带符号）。 */
function angle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
  let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))))
  if (ux * vy - uy * vx < 0) a = -a
  return a
}

/** 椭圆弧（端点参数化）→ 一串三次贝塞尔（每段 ≤90°，标准近似；SVG F.6.5 求中心/起止角）。 */
function arcToCubics(
  x1: number, y1: number, rxIn: number, ryIn: number, xRotDeg: number,
  largeArc: number, sweep: number, x2: number, y2: number,
): Array<[number, number, number, number, number, number]> {
  if (rxIn === 0 || ryIn === 0) return [] // 退化为直线（调用方补 LineTo）
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
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
  const coef = sign * Math.sqrt(num / (rxs * y1ps + rys * x1ps || 1))
  const cxp = (coef * (rx * y1p)) / ry
  const cyp = (coef * -(ry * x1p)) / rx
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dTheta > 0) dTheta -= TAU
  if (sweep && dTheta < 0) dTheta += TAU
  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)))
  const delta = dTheta / segs
  const k = (4 / 3) * Math.tan(delta / 4)
  const out: Array<[number, number, number, number, number, number]> = []
  const cosA = Math.cos(phi)
  const sinA = Math.sin(phi)
  let th = theta1
  let px = x1
  let py = y1
  for (let i = 0; i < segs; i++) {
    const th2 = th + delta
    const cos1 = Math.cos(th)
    const sin1 = Math.sin(th)
    const cos2 = Math.cos(th2)
    const sin2 = Math.sin(th2)
    const ex = cx + rx * cos2 * cosA - ry * sin2 * sinA
    const ey = cy + rx * cos2 * sinA + ry * sin2 * cosA
    // 起止点切向（单位）→ 控制点
    const dx1 = -rx * sin1 * cosA - ry * cos1 * sinA
    const dy1 = -rx * sin1 * sinA + ry * cos1 * cosA
    const dx2 = -rx * sin2 * cosA - ry * cos2 * sinA
    const dy2 = -rx * sin2 * sinA + ry * cos2 * cosA
    out.push([px + k * dx1, py + k * dy1, ex - k * dx2, ey - k * dy2, ex, ey])
    px = ex
    py = ey
    th = th2
  }
  return out
}

/**
 * 归一化 `d` → 仅绝对 M/L/C/Q/Z 的字符串（内核 `svg_path.rs` + Web `<svg>` + MP Path2D 同吃）。
 * 未知/非法 token ⇒ 抛错（不静默产出坏路径——与"反黑盒"纪律一致）。
 */
export function normalizePath(d: string): string {
  const tk = tokenize(d)
  const out: string[] = []
  let i = 0
  let cmd = ''
  let cx = 0, cy = 0 // 当前点
  let sx = 0, sy = 0 // 子路径起点
  let prevCx = 0, prevCy = 0 // 上一个三次控制点（S 反射用）
  let prevQx = 0, prevQy = 0 // 上一个二次控制点（T 反射用）
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
    } else if (!cmd) {
      throw new Error(`normalizePath: 路径以下达坐标前的 token 开头（非法 d）：${d.slice(0, 40)}`)
    }
    const rel = cmd >= 'a' // 小写 = 相对
    const C = cmd.toUpperCase()
    const ax = (x: number): number => (rel ? cx + x : x)
    const ay = (y: number): number => (rel ? cy + y : y)
    switch (C) {
      case 'M': {
        const x = ax(num()), y = ay(num())
        out.push(`M ${f(x)} ${f(y)}`)
        cx = sx = x; cy = sy = y
        break
      }
      case 'L': {
        const x = ax(num()), y = ay(num())
        out.push(`L ${f(x)} ${f(y)}`)
        cx = x; cy = y
        break
      }
      case 'H': {
        const x = rel ? cx + num() : num()
        out.push(`L ${f(x)} ${f(cy)}`)
        cx = x
        break
      }
      case 'V': {
        const y = rel ? cy + num() : num()
        out.push(`L ${f(cx)} ${f(y)}`)
        cy = y
        break
      }
      case 'C': {
        const x1 = ax(num()), y1 = ay(num()), x2 = ax(num()), y2 = ay(num()), x = ax(num()), y = ay(num())
        out.push(`C ${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)}`)
        prevCx = x2; prevCy = y2; cx = x; cy = y
        break
      }
      case 'S': {
        // 首控制点 = 上一控制点关于当前点的反射（上一命令非 C/S ⇒ 反射到当前点自身）
        const reflect = prevCmd === 'C' || prevCmd === 'S'
        const x1 = reflect ? 2 * cx - prevCx : cx
        const y1 = reflect ? 2 * cy - prevCy : cy
        const x2 = ax(num()), y2 = ay(num()), x = ax(num()), y = ay(num())
        out.push(`C ${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)}`)
        prevCx = x2; prevCy = y2; cx = x; cy = y
        break
      }
      case 'Q': {
        const x1 = ax(num()), y1 = ay(num()), x = ax(num()), y = ay(num())
        out.push(`Q ${f(x1)} ${f(y1)} ${f(x)} ${f(y)}`)
        prevQx = x1; prevQy = y1; cx = x; cy = y
        break
      }
      case 'T': {
        const reflect = prevCmd === 'Q' || prevCmd === 'T'
        const x1 = reflect ? 2 * cx - prevQx : cx
        const y1 = reflect ? 2 * cy - prevQy : cy
        const x = ax(num()), y = ay(num())
        out.push(`Q ${f(x1)} ${f(y1)} ${f(x)} ${f(y)}`)
        prevQx = x1; prevQy = y1; cx = x; cy = y
        break
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num()
        const x = ax(num()), y = ay(num())
        const cubics = arcToCubics(cx, cy, rx, ry, rot, laf, sf, x, y)
        if (cubics.length === 0) out.push(`L ${f(x)} ${f(y)}`)
        else for (const c of cubics) out.push(`C ${f(c[0])} ${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(c[4])} ${f(c[5])}`)
        cx = x; cy = y
        break
      }
      case 'Z': {
        out.push('Z')
        cx = sx; cy = sy
        break
      }
      default:
        throw new Error(`normalizePath: 不支持的 SVG 命令 \`${cmd}\``)
    }
    prevCmd = C
  }
  return out.join(' ')
}

/** 是否已"内核可吃"（只含 M/L/C/Q/Z 绝对命令——无需转换，可直接透传）。 */
export function isKernelCompatible(d: string): boolean {
  return !/[AaSsTtHhVv]/.test(d)
}
