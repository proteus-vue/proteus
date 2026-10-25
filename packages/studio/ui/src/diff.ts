// ui/src/diff.ts —— 行级 unified diff（决策 #1245）
//
// 【为什么自己写而不装 `@codemirror/merge`】本仓的依赖安装走的是"用户本地 pnpm + 特定 store"
//   （见记忆里那条 `ERR_PNPM_UNEXPECTED_STORE`），沙箱里装不了；而"看当前改动和磁盘差在哪"
//   是代码视图最基础的一件事，不该为了它停一天。行级 LCS 是**算法**不是产品，自己实现可控。
//   ★如实说边界：这里只做**行级** diff（不做词级/字符级高亮），也不做三栏合并——
//     需要那两样时再引库，接口（DiffResult.rows）已经留好。
//
// 【性能】LCS 是 O(n·m)。超过 `MAX_CELLS` 就退回"整块替换"并置 `truncated`
//   ——宁可粗糙也不要把编辑器卡死（几百行的文件是常态，几千行的 lock 文件也真实存在）。

export type DiffKind = 'ctx' | 'add' | 'del' | 'gap'

export interface DiffRow {
  kind: DiffKind
  /** 旧文件行号（1 起；add/gap 为 null） */
  a: number | null
  /** 新文件行号（1 起；del/gap 为 null） */
  b: number | null
  text: string
}

export interface DiffResult {
  rows: DiffRow[]
  added: number
  removed: number
  /** 太大而退化成"整块替换" */
  truncated: boolean
}

const MAX_CELLS = 4_000_000

/** 逐行比较两个文本，返回带上下文的 unified 行序列 */
export function diffLines(oldText: string, newText: string, context = 3): DiffResult {
  const a = oldText.length ? oldText.split('\n') : []
  const b = newText.length ? newText.split('\n') : []
  const n = a.length
  const m = b.length

  if (n * m > MAX_CELLS) {
    const rows: DiffRow[] = [
      ...a.map((t, i) => ({ kind: 'del' as const, a: i + 1, b: null, text: t })),
      ...b.map((t, i) => ({ kind: 'add' as const, a: null, b: i + 1, text: t })),
    ]
    return { rows, added: m, removed: n, truncated: true }
  }

  // LCS 表（只存长度；回溯时再走一遍）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const raw: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ kind: 'ctx', a: i + 1, b: j + 1, text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ kind: 'del', a: i + 1, b: null, text: a[i] })
      i += 1
    } else {
      raw.push({ kind: 'add', a: null, b: j + 1, text: b[j] })
      j += 1
    }
  }
  while (i < n) {
    raw.push({ kind: 'del', a: i + 1, b: null, text: a[i] })
    i += 1
  }
  while (j < m) {
    raw.push({ kind: 'add', a: null, b: j + 1, text: b[j] })
    j += 1
  }

  // 折叠长上下文：只保留改动附近 `context` 行，其余折成一条 gap
  const keep = new Array<boolean>(raw.length).fill(false)
  raw.forEach((r, idx) => {
    if (r.kind === 'ctx') return
    for (let k = Math.max(0, idx - context); k <= Math.min(raw.length - 1, idx + context); k += 1) keep[k] = true
  })

  const rows: DiffRow[] = []
  let gapOpen = false
  raw.forEach((r, idx) => {
    if (keep[idx]) {
      rows.push(r)
      gapOpen = false
    } else if (!gapOpen) {
      rows.push({ kind: 'gap', a: null, b: null, text: '' })
      gapOpen = true
    }
  })

  return {
    rows,
    added: raw.filter((r) => r.kind === 'add').length,
    removed: raw.filter((r) => r.kind === 'del').length,
    truncated: false,
  }
}
