// packages/router/src/stack-diff.ts
// ★router-plus G-32 M1：路由栈 diff（01-router.md §2.3 核心机制）
// Route[]（声明式）→ Vue Router 计算差异 → RoutePatch（push/pop/replace/tab）
// ★纯函数：输入两栈路径序列，输出补丁序列（Web history / Skyline 页面栈 / App 原生栈共用）
export interface RoutePatch {
  type: 'push' | 'pop' | 'replace' | 'tab'
  /** push/replace/tab 目标路径 */
  path?: string
  /** pop 数量 */
  count?: number
}

/**
 * 计算路由栈 diff（公共前缀 → 多余的 pop，新增的 push；根切换 → replace/tab）
 * 简化模型：栈 = 路径序列（栈底 → 栈顶）。tab 切换 = 根路径变化（replace 语义 + tab 标记）。
 */
export function computeRoutePatch(prev: string[], next: string[]): RoutePatch[] {
  const patches: RoutePatch[] = []

  // 公共前缀长度
  let common = 0
  while (common < prev.length && common < next.length && prev[common] === next[common]) common++

  // 根路径变化 → tab/replace（非栈式切换）
  if (common === 0 && next.length > 0) {
    if (prev.length > 0) {
      patches.push({ type: 'pop', count: prev.length })
    }
    // 后续 push 覆盖新增部分；根标记 tab 语义（调用方按业务决定 tab/replace）
    patches.push({ type: 'tab', path: next[0] })
    for (let i = 1; i < next.length; i++) {
      patches.push({ type: 'push', path: next[i] })
    }
    return patches
  }

  // 多余旧栈 → pop
  const popCount = prev.length - common
  if (popCount > 0) patches.push({ type: 'pop', count: popCount })

  // 新增 → push
  for (let i = common; i < next.length; i++) {
    patches.push({ type: 'push', path: next[i] })
  }

  return patches
}

/** 应用补丁到当前栈（模拟执行，测试/Web history 共用） */
export function applyRoutePatch(stack: string[], patches: RoutePatch[]): string[] {
  const out = stack.slice()
  for (const p of patches) {
    if (p.type === 'push' && p.path) out.push(p.path)
    else if (p.type === 'pop' && p.count) out.splice(out.length - p.count, p.count)
    else if (p.type === 'tab' && p.path) {
      out.splice(0, out.length) // tab 根切换：清栈 + 新根
      out.push(p.path)
    } else if (p.type === 'replace' && p.path) {
      if (out.length > 0) out[out.length - 1] = p.path
      else out.push(p.path)
    }
  }
  return out
}
