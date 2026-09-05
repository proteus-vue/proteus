// packages/desktop/src/index.ts —— @proteus-vue/desktop 公共入口（G-24 B1 桌面交互原语 + B2 系统集成四件套）
//   纯逻辑（可单测）+ Vue 指令工厂（Web 接线；MP 端不注册——桌面交互无对等天然降级）
export { parseShortcutExpr, normalizeMod, matchShortcut, shortcutLabel, detectShortcutPlatform } from './shortcut'
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
export { createCursorGlow, prefersReducedMotion as prefersReducedMotionCursor, hasFinePointer, CURSOR_GLOW_DEFAULTS } from './cursor-glow'
export type { CursorGlowOptions, CursorGlowHandle } from './cursor-glow'
// ★#449 G-24 B5 网页原语四件套（官网豁免回收——scroll/cross-window/元素查询/URL 地址栏）：纯逻辑 + env 回落全局
//   p-scroll-observer（滚动进度/滚动态 rAF 节流）/ 跨窗消息订阅（origin 校验 + type 过滤）/ 锚点定位 / 页面 URL 读写
//   与 G-24 B4 network/lifecycle 同族：desktop 承担 Web 接线，页面零裸 window/document/navigator/location/history
// ★#449 p-scroll-observer：页面滚动观测（window/document 几何收口——App 顶部进度条 / Home Hero 联动）
export { createScrollObserver, readPageScroll } from './scroll'
export type { ScrollState, ScrollObserverEnv, ScrollObserver } from './scroll'
// ★#449 跨窗消息原语（spirit iframe postMessage——origin 校验 + type 过滤收口）
export { subscribeWindowMessage } from './window-message'
export type { WindowMessage, WindowMessageEnv, WindowMessageOptions, WindowMessageHandle } from './window-message'
// ★#449 锚点定位原语（scrollToId——SPA 后 v-html 锚点跳转）
export { scrollToId } from './anchor'
export type { AnchorScrollEnv } from './anchor'
// ★#449 页面 URL 读写原语（location/history 收口——分享链接地址栏伴侣）
export { currentPageOrigin, currentPagePathname, replacePageUrl } from './page-url'
export type { PageUrlEnv } from './page-url'
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
// ★G-24 B4（proteus-semantic-primitives-plan 01 §8 Lifecycle + 06 B4）：生命周期/设备家族四件套
//   p-lifecycle（前后台）/ p-state-restoration（UIStateRestoration 语义）/ p-network-status（NWPathMonitor）/ p-low-power（低电量）
//   ★§9 Device（camera/bluetooth/nfc/sensor/file-system）由 @proteus-vue/api capability hooks 承接（#318/#323 双桥）——防重复不建 desktop 模块
export { createLifecycleTracker, phaseOf } from './lifecycle'
export type { AppPhase, LifecycleEnv, LifecycleTracker } from './lifecycle'
export { buildRestoreToken, filterRestorable, captureState, restoreState, clearRestoreState, restoreKey } from './state-restoration'
export type { RestoreStorage } from './state-restoration'
export { detectNetwork, createNetworkTracker } from './network'
export type { NetworkInfo, NetworkKind, NetworkEnv, NetworkTracker } from './network'
export { detectLowPower, createLowPowerTracker } from './low-power'
export type { PowerInfo, BatteryLike, PowerEnv, LowPowerTracker } from './low-power'
export {
  createDesktopDirectives,
  createHoverDirective,
  createShortcutDirective,
  createFocusTrapDirective,
  createContextMenuDirective,
  createPermissionDirective,
} from './directives'
export type { ShortcutDirectiveValue, ContextMenuDirectiveValue, PermissionDirectiveValue, PermissionDirectiveOptions } from './directives'