// packages/desktop/src/breadcrumb.ts
// ★G-24 B3（proteus-semantic-primitives-plan 01 §7 Navigation p-breadcrumb）：面包屑纯逻辑（路由栈推导）
//   · deriveBreadcrumb(segments)：路径段 → 面包屑（末段为当前——home 归并/驼峰化显示名，对齐 deriveNameFromFile 惯例）
//   纯函数（数据来自路由栈——宿主把当前路由 path 分段传入）
export interface Crumb {
  name: string
  /** 显示名（段驼峰化——'user-profile' → 'User Profile'） */
  label: string
  current: boolean
}

/** 段 → 显示名：kebab/下划线 → 空格首字母大写（'user-profile' → 'User Profile'；'index' 归并为空由宿主处理） */
export function crumbLabel(segment: string): string {
  const parts = segment.split(/[-_]/).filter(Boolean)
  if (!parts.length) return ''
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

/** ★deriveBreadcrumb：路由路径段（不含根 'index'）→ 面包屑链（末段 current=true） */
export function deriveBreadcrumb(segments: string[]): Crumb[] {
  const cleaned = (segments ?? []).filter((s) => s && s !== 'index')
  if (!cleaned.length) return []
  return cleaned.map((s, i) => ({ name: s, label: crumbLabel(s), current: i === cleaned.length - 1 }))
}
