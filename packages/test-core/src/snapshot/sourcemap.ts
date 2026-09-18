// packages/test-core/src/snapshot/sourcemap.ts
// ★test-framework B2：sourcemap v3 解码 + 完整性校验（02-snapshot-compile.md §快照对象 source map）
// 对齐 Compiler M5：产物每行 → .vue 源码行；校验每个映射段行号都在产物/源码范围内（行列映射回源）
// 纯 TS 零依赖（手写 VLQ 解码；sourcemap v3 规范：segment = [genCol, srcIdx(delta), srcLine(delta), srcCol]）
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export interface DecodedMapping {
  /** 产物行（0-based） */
  genLine: number
  genCol: number
  /** 源码行（0-based；无源码映射段 = null，生成代码行） */
  srcLine: number | null
  srcCol: number | null
}

export interface SourceMapViolation {
  kind: 'invalid-sourcemap' | 'gen-line-out-of-range' | 'src-line-out-of-range'
  message: string
}

/** base64 VLQ 段解码（单段 → 数值数组；符号位为最低位，续位 0x20） */
export function decodeVlqSegment(seg: string): number[] {
  const vals: number[] = []
  let value = 0
  let shift = 0
  for (const ch of seg) {
    const digit = B64.indexOf(ch)
    if (digit === -1) break
    const cont = (digit & 0x20) !== 0
    value += (digit & 0x1f) << shift
    if (cont) {
      shift += 5
      continue
    }
    const neg = (value & 1) === 1
    vals.push(neg ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return vals
}

/** 解码 sourcemap mappings（`;` 分行，`,` 分段；srcLine 跨段累积 delta） */
export function decodeMappings(mappings: string): DecodedMapping[] {
  const out: DecodedMapping[] = []
  let prevSrcLine = 0
  const lines = mappings.split(';')
  for (let line = 0; line < lines.length; line++) {
    const segments = lines[line]?.split(',').filter((s) => s.length > 0) ?? []
    for (const seg of segments) {
      const vals = decodeVlqSegment(seg)
      if (vals.length === 0) continue
      let srcLine: number | null = null
      let srcCol: number | null = null
      if (vals.length >= 4) {
        prevSrcLine += vals[2] as number
        srcLine = prevSrcLine
        srcCol = vals[3] as number
      }
      out.push({ genLine: line, genCol: vals[0] as number, srcLine, srcCol })
    }
  }
  return out
}

/**
 * 校验 sourcemap 完整性：每个带源码映射的段，genLine 在产物行数内、srcLine 在源码行数内
 * （对齐 02 §快照对象 source map「行列映射回 .vue 源文件」；无源码映射段跳过）
 */
export function verifySourceMap(sourcemap: unknown, js: string, source: string): SourceMapViolation[] {
  const violations: SourceMapViolation[] = []
  let sm: { mappings?: string }
  try {
    sm = typeof sourcemap === 'string' ? (JSON.parse(sourcemap) as { mappings?: string }) : (sourcemap as { mappings?: string })
  } catch {
    return [{ kind: 'invalid-sourcemap', message: 'sourcemap 非合法 JSON' }]
  }
  if (!sm || typeof sm.mappings !== 'string') {
    return [{ kind: 'invalid-sourcemap', message: 'sourcemap 缺 mappings 字段' }]
  }
  const jsLines = js.split('\n').length
  const srcLines = source.split('\n').length
  for (const m of decodeMappings(sm.mappings)) {
    if (m.srcLine === null) continue
    if (m.genLine >= jsLines) {
      violations.push({ kind: 'gen-line-out-of-range', message: `gen 行 ${m.genLine} ≥ 产物行数 ${jsLines}` })
    }
    if (m.srcLine >= srcLines) {
      violations.push({ kind: 'src-line-out-of-range', message: `src 行 ${m.srcLine} ≥ 源码行数 ${srcLines}` })
    }
  }
  return violations
}
