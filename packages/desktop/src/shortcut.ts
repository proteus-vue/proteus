// packages/desktop/src/shortcut.ts
// ★G-24 B1（proteus-semantic-primitives-plan 03 §3 p-shortcut）：键盘快捷键纯逻辑
//   · parseShortcutExpr("mod+s:save") → { keys: ['mod','s'], id: 'save' }（p-shortcut="mod+s:save" 语义）
//   · normalizeMod("mod", platform) → 'meta'（darwin）/ 'ctrl'（其余）——PRIM005 平台惯例自动遵循
//   · matchShortcut(e, keys) → 键盘事件命中判定（mod/s/alt/shift + key/code 归一）
//   · shortcutLabel(binding, platform) → '⌘S'（Mac）/ 'Ctrl+S'（Win/Linux）——验收「mod+s → Mac ⌘S / Win Ctrl+S」
//   纯逻辑零 DOM 依赖（事件形状注入可单测）；MP 产物安全：无 ?. / ??；无数组解构
export type ShortcutMod = 'mod' | 'alt' | 'shift'
export type ShortcutKey = ShortcutMod | string

/** 解析结果：按键序列 + 语义 id */
export interface ShortcutBinding {
  /** 按键序列（'mod','s' 等——mod/alt/shift 修饰符 + 普通键） */
  keys: string[]
  /** 语义 id（'save'——业务 @click="save" 对应） */
  id?: string
}

/** 键盘事件形状（Web KeyboardEvent 的注入式子集——测试可 mock） */
export interface KeyEventLike {
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  key?: string
  code?: string
}

const MOD_RE = /^(ctrl|meta|mod|alt|shift|option|cmd|command)$/i

/** ★#445 平台探测原语（纯函数注入式；调用方免碰 navigator——短标签用：Darwin/mac/iPhone/iPad → 'Mac'，其余 'web'） */
export function detectShortcutPlatform(env: { platform?: string; userAgent?: string } = {}): string {
  const plat = env.platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '')
  if (plat) return plat
  const ua = env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  return /Mac|iPhone|iPad/.test(ua) ? 'Mac' : 'web'
}

/** 解析 "mod+s:save" / "mod+shift+a" / "escape" → binding（大小写/空白容忍；非法段跳过） */
export function parseShortcutExpr(expr: string): ShortcutBinding | null {
  if (!expr || expr.trim() === '') return null
  const [combo, id] = expr.split(':')
  const keys = combo
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (keys.length === 0) return null
  // id 段可选（"mod+s" 无 id 也可——仅匹配不触发）
  return { keys, id: id ? id.trim() : undefined }
}

/** 平台 mod 归一：darwin/mac → 'meta'（⌘）；其余 → 'ctrl'（PRIM005 自动遵循平台惯例） */
export function normalizeMod(mod: string, platform: string): string {
  if (mod === 'mod') return platform.toLowerCase().includes('darwin') || platform.toLowerCase().includes('mac') ? 'meta' : 'ctrl'
  return mod
}

/** 命中判定：修饰符 + 主键匹配（keys 顺序无关；mod = meta 或 ctrl 其一——Mac ⌘ / Win Ctrl，PRIM005）
 * 语义：显式 ctrl/meta/alt/shift 段 → 必须命中；mod 段 → meta 或 ctrl 至少一个；
 *       事件里出现「未声明且非 mod 允许」的修饰符 → 不命中（避免 Ctrl+Alt+S 命中 "s"）
 */
export function matchShortcut(e: KeyEventLike, keys: string[]): boolean {
  const normalized = keys.map((k) => (k === 'mod' ? 'mod' : k))
  let needsMeta = false
  let needsCtrl = false
  let needsAlt = false
  let needsShift = false
  let hasMod = false
  const plain: string[] = []
  for (const k of normalized) {
    if (k === 'mod') {
      hasMod = true
      continue
    }
    if (k === 'ctrl' || k === 'control') {
      needsCtrl = true
      continue
    }
    if (k === 'meta' || k === 'cmd' || k === 'command') {
      needsMeta = true
      continue
    }
    if (k === 'alt' || k === 'option') {
      needsAlt = true
      continue
    }
    if (k === 'shift') {
      needsShift = true
      continue
    }
    plain.push(k)
  }
  const hasMeta = e.metaKey === true
  const hasCtrl = e.ctrlKey === true
  const hasAlt = e.altKey === true
  const hasShift = e.shiftKey === true
  // 显式修饰符需求
  const explicitOk = (!needsMeta || hasMeta) && (!needsCtrl || hasCtrl) && (!needsAlt || hasAlt) && (!needsShift || hasShift)
  // mod 段：meta 或 ctrl 至少一个
  const modOk = !hasMod || hasMeta || hasCtrl
  // 未声明修饰符误带：ctrl/meta 出现需声明或被 mod 允许；alt/shift 出现需声明
  const extraOk =
    (!hasCtrl || needsCtrl || hasMod) && (!hasMeta || needsMeta || hasMod) && (!hasAlt || needsAlt) && (!hasShift || needsShift)
  if (!explicitOk || !modOk || !extraOk) return false
  if (plain.length === 0) return true
  const k = ((e.key ?? e.code ?? '') as string).toLowerCase()
  return plain.some((p) => k === p || k === p.toLowerCase())
}

/** 快捷键标签（菜单栏显示——PRIM005 验收）：mod+s → '⌘S'（darwin）/ 'Ctrl+S' */
export function shortcutLabel(expr: string, platform = 'web'): string {
  const binding = parseShortcutExpr(expr)
  if (!binding) return expr
  const isMac = platform.toLowerCase().includes('darwin') || platform.toLowerCase().includes('mac')
  return binding.keys
    .map((k) => {
      if (k === 'mod') return isMac ? '⌘' : 'Ctrl'
      if (k === 'ctrl' || k === 'control') return 'Ctrl'
      if (k === 'meta' || k === 'cmd' || k === 'command') return '⌘'
      if (k === 'alt' || k === 'option') return isMac ? '⌥' : 'Alt'
      if (k === 'shift') return isMac ? '⇧' : 'Shift'
      return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1)
    })
    .join(isMac ? '' : '+')
}