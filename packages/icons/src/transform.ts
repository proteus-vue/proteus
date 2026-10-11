// packages/icons/src/transform.ts —— SVG path **坐标变换**（缩放 + 平移）——图标库方案的「网格对齐」步骤。
//
// 【为什么需要（图标库方案 §6「24×24 基准网格」+ 尽调结论）】上游图标源（Material Symbols）是 **960 网格**
//   （`viewBox="0 -960 960 960"`）；而 **App 内核 `svg_path.rs` 与三端宿主不读 viewBox**（把 path 坐标当
//   节点局部坐标直接画）⇒ 必须在**数据侧**把 960 缩放到 24，三端才同源同形。
//   `normalizePath`（normalize.ts）只做「相对→绝对 + 弧/平滑→三次贝塞尔」，**不动坐标数值**——缩放由本文件补。
//
// 【输入契约】入参是**已归一化**的 `d`（仅绝对 `M/L/C/Q/Z`，坐标数字与命令以空格分隔）。此时每个命令的数字
//   都是**纯坐标值、成对出现**（M/L 一对；C 三对；Q 两对；Z 无）⇒ 顺序遍历数字、按「偶 x / 奇 y」交替即可，
//   无需解析命令语义。归一到 24 网格的图标坐标域应为 `[0, 24]`。

/** 数字格式（与 normalize.ts 同口径：去浮点噪声，保留 3 位小数足够图标精度）。 */
function f(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return String(r)
}

export interface ScaleOptions {
  /** 缩放因子 */
  scale: number
  /** x 平移（`x' = scale·x + tx`） */
  tx?: number
  /** y 平移（`y' = scale·y + ty`） */
  ty?: number
}

/**
 * 对**已归一化**的 `d` 施加仿射变换 `p' = scale·p + t`（本仓图标源 960→24 网格用 `scale=0.025, ty=24`）。
 * 命令字母原样保留；只改坐标数值。对非归一化输入（含 H/V/A/S/T）会因坐标不成对而语义错——故调用方
 * 必须先 `normalizePath`。
 */
export function scalePath(d: string, opts: ScaleOptions): string {
  const { scale, tx = 0, ty = 0 } = opts
  const toks = d.trim().split(/\s+/)
  const out: string[] = []
  let isX = true
  for (const t of toks) {
    if (/^[A-Za-z]$/.test(t)) {
      out.push(t)
      isX = true // 每个命令的首个数字是 x
      continue
    }
    const v = Number(t)
    if (Number.isNaN(v)) {
      out.push(t)
      continue
    }
    out.push(f(scale * v + (isX ? tx : ty)))
    isX = !isX
  }
  return out.join(' ')
}
