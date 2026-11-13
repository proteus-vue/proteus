/**
 * diagRank.ts —— 诊断「排序口径」的单一真源（决策 #1498）
 *
 * 【为什么要单独一个文件】此前两组顺序是各写各的：
 *   · DiagPanel.vue 按 `diagList` 的 路径→行→列 顺序分组（谁路径靠前谁在上）；
 *   · FileTree.vue 的徽标跳转用 `find` 取第一条（同样是路径最靠前）。
 *   看起来一致，但一旦要「问题最多的文件排前面」，两边各排一次必然漂移。
 *   ⇒ 口径收在这里：纯函数、零运行时依赖，可直接单测。
 *
 * 【口径】按文件分组，**错误数降序 → 警告数降序 → 路径**；组内沿用 `mergeSort`
 *   的行→列 顺序（编辑器画波浪线、跳转定位都依赖它，不动）。
 *   ★`severity` 缺省按 error 计，与 FileTree 的 `diagMark` 同口径（老后端可能不给该字段）。
 */
import type { Diag } from './bridge'

export interface DiagGroup {
  path: string
  items: Diag[]
  errors: number
  warnings: number
}

/** 诊断事件的路径可能带 `./`，而树行不带 —— 只在比较时归一，不改写 `Diag.path` */
const norm = (p: string) => p.replace(/^\.\//, '')

/** 按文件分组并按严重度排序；同一文件内保持输入顺序（mergeSort 已排好 行→列）。 */
export function diagGroups(list: Diag[]): DiagGroup[] {
  const map = new Map<string, Diag[]>()
  for (const d of list) {
    const key = norm(d.path)
    const arr = map.get(key)
    if (arr) arr.push(d)
    else map.set(key, [d])
  }
  const groups = [...map.entries()].map(([path, items]) => ({
    path,
    items,
    errors: items.filter((i) => i.severity !== 'warning').length,
    warnings: items.filter((i) => i.severity === 'warning').length,
  }))
  groups.sort(
    (a, b) => b.errors - a.errors || b.warnings - a.warnings || a.path.localeCompare(b.path),
  )
  return groups
}

/**
 * 一个树行作用域内的诊断，按 `diagGroups` 的组顺序展开。
 * · 文件行：只取该文件；· 目录行：所有前缀匹配的子文件，按组顺序串起来。
 *
 * ★★目录的**首次落点**因此是「错误最多的文件」，而不是 #1494 里的「路径最靠前」——
 *   用户点一个折叠的顶层目录，最想看的是问题最集中的文件。这是 #1494 handoff
 *   里明确留下的「未做：按错误数排序」。
 * ★返回的仍是原始 `Diag` 对象（`path` 未改写），`ws.jump` 的打开路径与旧行为一致。
 */
export function diagScopeFrom(groups: DiagGroup[], path: string, dir: boolean): Diag[] {
  const want = norm(path)
  const prefix = `${want}/`
  return groups
    .filter((g) => (dir ? g.path.startsWith(prefix) : g.path === want))
    .flatMap((g) => g.items)
}

/**
 * 一次性用法（单测 / 没有渲染缓存的调用方）。
 * ★UI 里**不要**在每一行调它：文件树上千行，每行重排一次诊断会明显卡
 *   （#1404 为 gitMark 用 Map 就是同一个理由）。渲染侧用 `diagGroups` 算一次，
 *   再用 `diagScopeFrom` 按行取。
 */
export function diagScope(list: Diag[], path: string, dir: boolean): Diag[] {
  return diagScopeFrom(diagGroups(list), path, dir)
}
