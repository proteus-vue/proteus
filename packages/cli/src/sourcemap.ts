// packages/cli/src/sourcemap.ts —— ★★★最小 source map 消费者（决策 #711，**零依赖**）
//
// 【为什么自研（而不是引 source-map 库）】本仓 CLI 要**零新增依赖**；而 sourcemap v3 的 `mappings`
//   是**充分定义**的（VLQ base64 分段），解码 + 二分查列 ≈ 50 行即可（配单测锁定）。
//
// 【做什么】`//# sourceMappingURL=data:application/json;base64,<...>` 内联 map ⇒
//   `bundle-superapp.js:行:列`（栈里的位置）⇒ 映射回 `原始文件:行:列`（如 `pages/index.vue`）。
//   ★行号约定：栈是 **1 基**行/列；sourcemap 的 `mappings` 是 **0 基**行/列（本模块对外统一收/返 1 基）。

/** source map v3（本仓用到的子集） */
export interface RawSourceMap {
  version: number
  sources: string[]
  sourcesContent?: (string | null)[]
  names?: string[]
  mappings: string
}
export interface MappedPos { source: string; line: number; column: number; name?: string }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]!] = i

/** 从一段 VLQ 分隔串解出连续整数（每个字段 = 1 个或多个 base64 字符；最高位=续位、次高位=符号）。 */
function decodeVlq(segment: string): number[] {
  const out: number[] = []
  let shift = 0
  let value = 0
  for (let i = 0; i < segment.length; i++) {
    const d = B64_INDEX[segment[i]!]
    if (d === undefined) throw new Error(`非法 VLQ 字符：${segment[i]}`)
    const cont = d & 32
    value += (d & 31) << shift
    if (cont) { shift += 5; continue }
    const negate = value & 1
    value >>= 1
    out.push(negate ? -value : value)
    value = 0
    shift = 0
  }
  return out
}

/**
 * 解析 `mappings` → 每行一组映射段 `{ genCol, srcIdx, srcLine(0基), srcCol, nameIdx? }`。
 *   跨行/跨段的相对增量（VLQ 是**相对**编码）在此还原为**绝对**值。
 */
export function parseMappings(map: RawSourceMap): Array<Array<{ genCol: number; srcIdx: number; srcLine: number; srcCol: number; nameIdx: number }>> {
  const lines = map.mappings.split(';')
  const rows: Array<Array<{ genCol: number; srcIdx: number; srcLine: number; srcCol: number; nameIdx: number }>> = []
  let srcIdx = 0, srcLine = 0, srcCol = 0, nameIdx = 0
  for (const line of lines) {
    let genCol = 0
    const segs: Array<{ genCol: number; srcIdx: number; srcLine: number; srcCol: number; nameIdx: number }> = []
    if (line) {
      for (const seg of line.split(',')) {
        if (!seg) continue
        const f = decodeVlq(seg)
        genCol += f[0]!
        if (f.length >= 4) {
          srcIdx += f[1]!
          srcLine += f[2]!
          srcCol += f[3]!
          if (f.length >= 5) nameIdx += f[4]!
          segs.push({ genCol, srcIdx, srcLine, srcCol, nameIdx })
        } else {
          // 仅生成为列（无源映射）——保留占位，供列查找
          segs.push({ genCol, srcIdx: -1, srcLine: 0, srcCol: 0, nameIdx: -1 })
        }
      }
    }
    rows.push(segs)
  }
  return rows
}

/** 查**生成位置**（1 基行列）对应的源位置；无映射 ⇒ null。 */
export function originalPositionFor(map: RawSourceMap, genLine: number, genColumn: number): MappedPos | null {
  const rows = parseMappings(map)
  const row = rows[genLine - 1]
  if (!row || row.length === 0) return null
  const col = Math.max(0, genColumn - 1)   // 0 基
  // 二分找 ≤ col 的最后一个段
  let lo = 0, hi = row.length - 1, hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (row[mid]!.genCol <= col) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  if (hit < 0) return null
  const seg = row[hit]!
  if (seg.srcIdx < 0) return null
  const source = map.sources[seg.srcIdx]
  if (source == null) return null
  const name = seg.nameIdx >= 0 && map.names ? map.names[seg.nameIdx] : undefined
  return { source, line: seg.srcLine + 1, column: seg.srcCol + 1, ...(name ? { name } : {}) }
}

/** 从 bundle 文本里抽内联 source map（`//# sourceMappingURL=data:application/json;base64,<b64>`）。 */
export function inlineMapOf(bundleText: string): RawSourceMap | null {
  const m = /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=]+)/.exec(bundleText)
  if (!m) return null
  try {
    const json = Buffer.from(m[1]!, 'base64').toString('utf8')
    const map = JSON.parse(json) as RawSourceMap
    return map && map.mappings ? map : null
  } catch {
    return null
  }
}

/** 栈行里的 `at … (file:line:col)` / `file:line:col` ⇒ 抽 `{line, col}`（1 基）。 */
export function locationInFrame(frame: string): { line: number; column: number } | null {
  const m = /:(\d+):(\d+)($|\D)/.exec(frame)
  if (!m) return null
  return { line: Number(m[1]), column: Number(m[2]) }
}

/**
 * 把一个栈字符串整体映射（逐帧：仅映射**含 bundle 文件名**的帧；其余原样）。
 *   `bundleName` 默认 `bundle-superapp.js`。
 */
export function mapStack(map: RawSourceMap, stack: string, bundleName = 'bundle-superapp.js'): string {
  return stack
    .split('\n')
    .map((line) => {
      if (!line.includes(bundleName)) return line
      const loc = locationInFrame(line)
      if (!loc) return line
      const o = originalPositionFor(map, loc.line, loc.column)
      if (!o) return line
      const short = o.source.replace(/^.*?\/(?=[^/]+\/[^/]+$)/, '')   // 去掉过长的绝对前缀
      const mapped = `${short}:${o.line}:${o.column}${o.name ? ` (${o.name})` : ''}`
      return line.replace(/\(?([^\s()]*bundle-superapp\.js:\d+:\d+)\)?/, `(${mapped})`)
    })
    .join('\n')
}
