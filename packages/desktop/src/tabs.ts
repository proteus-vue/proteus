// packages/desktop/src/tabs.ts
// ★G-24 B3（proteus-semantic-primitives-plan 01 §7 Navigation p-tabs）：桌面标签页纯逻辑
//   · resolveTabAfterClose：关闭某 tab 后应激活的 id（关闭非激活 → 不变；关闭激活 → 右邻优先，末位回退左邻）
//   · normalizeTabs：激活合法性归一（激活 id 不存在/空 → 首个；空列表 → 无）
//   映射：UISegmentedControl / TabLayout（01 §7）；与移动端 p-tabbar（S3 底部）区分——桌面窗口 tabs（可关、多行/滚动由宿主）
export interface DesktopTab {
  id: string
  label: string
  closable?: boolean
}

export interface TabCloseResult {
  tabs: DesktopTab[]
  activeId: string | null
}

/** ★resolveTabAfterClose：关闭 tab 后的激活迁移 */
export function resolveTabAfterClose(tabs: DesktopTab[], activeId: string | null, closedId: string): TabCloseResult {
  const closedIdx = tabs.findIndex((t) => t.id === closedId)
  const remaining = tabs.filter((t) => t.id !== closedId)
  if (closedIdx < 0) return { tabs: remaining, activeId } // 关闭不存在 → 原样
  if (activeId !== closedId) {
    // 关闭非激活：active 指向不变（若其 id 仍存在）
    const stillActive = remaining.some((t) => t.id === activeId)
    return { tabs: remaining, activeId: stillActive ? activeId : (remaining[remaining.length - 1]?.id ?? null) }
  }
  // 关闭的是激活 tab：右邻优先（原 closedIdx 位），越界回退左邻（末位）
  const next = remaining[Math.min(closedIdx, remaining.length - 1)] ?? remaining[remaining.length - 1] ?? null
  return { tabs: remaining, activeId: next ? next.id : null }
}

/** ★normalizeTabs：激活合法性归一（激活 id 缺失/不存在 → 首个；空 → null） */
export function normalizeTabs(tabs: DesktopTab[], activeId: string | null): string | null {
  if (!tabs.length) return null
  if (activeId && tabs.some((t) => t.id === activeId)) return activeId
  return tabs[0].id
}
