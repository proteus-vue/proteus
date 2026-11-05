/**
 * peekRange.ts —— 从文件全文里截出**一个完整的定义块**（决策 #1438）
 *
 * 【为什么不能固定 ±N 行】原来 `t.line - 3 … t.line + 2` 只给 5 行：
 *   · 长接口/长函数会被拦腰截断（用户截图：`interface Diag {` 只看到前 2 个字段）；
 *   · 定义行上方若没有注释，还会白占两行无关代码。
 *
 * 【做法】按**语法块**取（不引 TS 编译器，纯词法扫描）：
 *   1. 向上吞掉紧邻的注释块 / 多行签名续行（`extends`、`(`、`|` 结尾等）⇒ 头；
 *   2. 从头行开始数 `{}` 深度，**回到 0 的那一行**就是尾（跳过字符串与注释里的花括号）；
 *   3. 没有花括号（单行类型/常量）⇒ 向后找到 `;` / 空行为止，最多 5 行；
 *   4. 超过上限（默认 80 行）截断并标记，避免一张卡铺满屏幕。
 *
 * 【已知取舍】模板字符串里 `${ {a:1} }` 这种嵌套的 `{` 会被误计数（极少见）。
 *   真要精确应该用 tsserver 的 `navtree` 拿 span —— 但那要多一次 IPC 且要处理缓存，
 *   对"看一眼定义"这个场景，词法扫描已经够用且零延迟。
 */

export interface PeekLine {
  no: number
  text: string
}

export interface PeekSlice {
  lines: PeekLine[]
  /** 是否因为超过 `maxLines` 被截断 */
  truncated: boolean
  /** 该定义块在文件里实际占多少行（用于"共 N 行"提示） */
  span: number
}

/** 逐行跟踪花括号深度；跳过 `//`、`/* *\/`、字符串（`"` `'` `` ` ``）里的花括号 */
function scanLine(line: string, state: { depth: number; inBlock: boolean }): boolean {
  let { depth, inBlock } = state
  let sawOpen = false
  let quote = ''
  let i = 0
  while (i < line.length) {
    const c = line[i]
    const n = line[i + 1]
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (quote) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === quote) quote = ''
      i += 1
      continue
    }
    if (c === '/' && n === '/') break
    if (c === '/' && n === '*') {
      inBlock = true
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      i += 1
      continue
    }
    if (c === '{') {
      depth += 1
      sawOpen = true
      i += 1
      continue
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1)
      i += 1
      continue
    }
    i += 1
  }
  state.depth = depth
  state.inBlock = inBlock
  return sawOpen
}

/**
 * 从 `start` 找花括号配对的结束行；**本定义没有块结构**时返回 null。
 *
 * ★关键：必须先判定"这个定义到底有没有 `{`"。原实现一路往后扫，遇到文件里**后面那个**
 *   `interface {}` 就当成自己的块 —— 实测 `export const FLUSH_MS = 30` 会预览出 15 行
 *   （把后面的接口整个吞进来）。判定规则（在出现第一个 `{` 之前）：
 *     · 遇到空行 ⇒ 这条语句已经结束，无块；
 *     · 行内有 `;` ⇒ 同上；
 *     · 连续超过 12 行还没看到 `{` ⇒ 不是块（多行签名的合理上限）。
 *   多行签名（`function f(\n …\n): void {`）中间既没有空行也不以 `;` 结尾，仍能正确走到 `{`。
 */
function findBlockEnd(lines: string[], start: number): number | null {
  const state = { depth: 0, inBlock: false }
  let sawOpen = false
  for (let i = start; i < lines.length; i++) {
    const opened = scanLine(lines[i], state)
    if (opened) sawOpen = true
    if (sawOpen && state.depth === 0) return i
    if (sawOpen) continue
    /* 还没见到 `{`：判断这条语句是不是已经结束 */
    const code = lines[i].replace(/\/\/.*$/, '').trim()
    if (i > start && !code) return null
    if (code.includes(';')) return null
    if (i - start > 12) return null
  }
  return null
}

/** 无块结构时（`const X = 1`、单行 `type A = B`）：向后到 `;` 或空行为止，最多 5 行 */
function findStatementEnd(lines: string[], hit: number): number {
  const stop = Math.min(lines.length - 1, hit + 4)
  for (let i = hit; i <= stop; i++) {
    if (!lines[i].trim()) return Math.max(hit, i - 1)
    if (/[;)]\s*(?:\/\/.*)?$/.test(lines[i])) return i
  }
  return stop
}

/** 向上吞注释块 / 多行签名续行 / 装饰器，返回块头所在行（0-based） */
function findHead(lines: string[], hit: number): number {
  let head = hit
  /* 上限 12 行：JSDoc 常有好几行，但再长就不是"这个定义"的注释了 */
  for (let i = hit - 1, n = 0; i >= 0 && n < 12; i--, n++) {
    const t = lines[i].trim()
    if (!t) break
    const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    /* 多行签名/联合类型的续行：`a: string,` / `extends Foo` / `(` / `| A` / `& B` */
    const isContinuation = /[,([|&+:]$/.test(t) || /\bextends\b/.test(t)
    if (!isComment && !isContinuation) break
    head = i
  }
  return head
}

/**
 * 截出定义块。
 * @param all       文件全文按行切分（`split('\n')`）
 * @param hitLine   定义位置（**1-based**，tsserver 口径）
 * @param maxLines  最多显示多少行（超出截断并标记）
 */
export function sliceDefinition(all: string[], hitLine: number, maxLines = 80): PeekSlice {
  if (!all.length) return { lines: [], truncated: false, span: 0 }
  const hit = Math.max(0, Math.min(all.length - 1, hitLine - 1))
  const head = findHead(all, hit)
  const tail = findBlockEnd(all, head) ?? findStatementEnd(all, hit)
  const end = Math.max(tail, hit)
  const span = end - head + 1
  const cut = Math.min(end, head + maxLines - 1)
  const lines: PeekLine[] = []
  for (let i = head; i <= cut; i++) lines.push({ no: i + 1, text: all[i] })
  return { lines, truncated: cut < end, span }
}
