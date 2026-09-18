// packages/desktop/src/command.ts
// ★G-24 B3（proteus-semantic-primitives-plan 01 §7 Navigation p-command）：命令面板 ⌘K 纯逻辑
//   · filterCommands(items, query)：title/关键词/分组模糊过滤（稳定序）
//   · moveCommandIndex(list, active, dir)：↑↓ 键盘导航（循环 + 空列表 -1）——⌘K 面板数据层
//   纯函数零依赖（面板 UI/快捷键接线由宿主——⌘K 全局监听同 p-shortcut B1 模式）
export interface CommandItem {
  id: string
  title: string
  /** 分组（搜索结果显示） */
  group?: string
  /** 关键词（别名搜索） */
  keywords?: string[]
}

export interface CommandFilterResult {
  items: CommandItem[]
  /** 命中分组（保持出现序） */
  groups: string[]
}

/** ★filterCommands：子串过滤（title + keywords + group；大小写不敏感；稳定序） */
export function filterCommands(items: CommandItem[], query: string): CommandFilterResult {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) {
    const allGroups: string[] = []
    for (const it of items) {
      const g = it.group ?? ''
      if (g && !allGroups.includes(g)) allGroups.push(g)
    }
    return { items, groups: allGroups }
  }
  const out: CommandItem[] = []
  const groups: string[] = []
  for (const it of items) {
    const hay = `${it.title} ${it.keywords?.join(' ') ?? ''} ${it.group ?? ''}`.toLowerCase()
    if (hay.includes(q)) {
      out.push(it)
      const g = it.group ?? ''
      if (g && !groups.includes(g)) groups.push(g)
    }
  }
  return { items: out, groups }
}

/** ★moveCommandIndex：键盘 ↑↓ 移动（循环；空/越界回 0；无结果 -1） */
export function moveCommandIndex(active: number, dir: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (active < 0 || active >= count) return dir === 1 ? 0 : count - 1
  return (active + dir + count) % count
}
