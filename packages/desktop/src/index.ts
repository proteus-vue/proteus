// packages/desktop/src/index.ts —— @proteus-vue/desktop 公共入口（G-24 B1 桌面交互原语 + B2 系统集成四件套）
//   纯逻辑（可单测）+ Vue 指令工厂（Web 接线；MP 端不注册——桌面交互无对等天然降级）
export { parseShortcutExpr, normalizeMod, matchShortcut, shortcutLabel } from './shortcut'
export type { ShortcutBinding, KeyEventLike, ShortcutMod, ShortcutKey } from './shortcut'
export { createFocusTrap, FOCUSABLE_SELECTOR } from './focus-trap'
export type { FocusTrapOptions, FocusTrap, FocusableElement } from './focus-trap'
export { buildMenuPosition, buildContextMenu, menuPointFrom } from './context-menu'
export type { MenuItem, MenuPoint, MenuSize, ViewportSize, PositionedMenu } from './context-menu'
export { resolveHoverClass, isHoverPointer, normalizePointerType, canHover } from './hover'
export type { HoverPreset, PointerKind } from './hover'
// ★G-24 B2（proteus-semantic-primitives-plan 04-system-integration）：系统集成四件套纯逻辑
//   p-notify（Notification API）/ p-permission（权限门禁 + Compiler 期清单）/ p-clipboard（Clipboard API + 降级）/ p-deeplink（参数化深链匹配）
export {
  PERMISSION_CATALOG,
  buildPermissionManifest,
  checkPermission,
  requestPermission,
  permissionEntry,
  defaultPermissionQuery,
  defaultPermissionRequest,
} from './permission'
export type { PermissionState, PermissionEntry, PermissionEnv } from './permission'
export { notifySupported, getNotifyPermission, requestNotifyPermission, sendNotification } from './notify'
export type { NotifyPayload, NotifyResult, NotifyEnv, NotificationCtor, NotificationLike } from './notify'
export { clipboardSupported, copyText, pasteText } from './clipboard'
export type { ClipboardResult, ClipboardEnv } from './clipboard'
export { parseDeepLink, matchDeepLink } from './deeplink'
export type { DeepLink, DeepLinkMatch } from './deeplink'
// ★G-24 B3（proteus-semantic-primitives-plan 01 §7 Navigation + 06 B3）：导航结构四件套
//   p-master-detail（UISplitViewController 三列）/ p-command（⌘K 面板数据层）/ p-tabs（桌面标签关闭迁移）/ p-breadcrumb（路由栈推导）
export { computeSplitLayout, applySplitNav } from './master-detail'
export type { SplitColumn, SplitLayoutOptions, SplitLayout, SplitNavAction, SplitNavOptions, SplitNavResult } from './master-detail'
export { resolveTabAfterClose, normalizeTabs } from './tabs'
export type { DesktopTab, TabCloseResult } from './tabs'
export { filterCommands, moveCommandIndex } from './command'
export type { CommandItem, CommandFilterResult } from './command'
export { deriveBreadcrumb, crumbLabel } from './breadcrumb'
export type { Crumb } from './breadcrumb'
export {
  createDesktopDirectives,
  createHoverDirective,
  createShortcutDirective,
  createFocusTrapDirective,
  createContextMenuDirective,
  createPermissionDirective,
} from './directives'
export type { ShortcutDirectiveValue, ContextMenuDirectiveValue, PermissionDirectiveValue, PermissionDirectiveOptions } from './directives'