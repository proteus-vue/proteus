/**
 * breadcrumbs.ts —— 路径 → 面包屑分段（决策 #1407 引入 · #1423 抽出）
 *
 * ★调用方有个**硬约束**：把结果直接铺进 `#codePath` 时，**textContent 必须正好等于完整路径**
 *   （门禁用它比对"当前文件"）。所以分隔符要用内联 `/` 文本、模板写在一行，
 *   并且按钮与分隔符必须在同一个 `template v-for` 里（否则 `i` 不在作用域，分隔符不渲染）。
 */
export interface Crumb {
  name: string
  /** 该段对应的目录路径；最后一段（文件名）为空串 */
  dir: string
}

export function crumbsOf(path: string): Crumb[] {
  if (!path) return []
  const parts = path.split('/').filter(Boolean)
  let acc = ''
  return parts.map((name, i) => {
    acc = acc ? `${acc}/${name}` : name
    return { name, dir: i === parts.length - 1 ? '' : acc }
  })
}
