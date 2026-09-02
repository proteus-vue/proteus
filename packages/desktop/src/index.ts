// packages/desktop/src/index.ts —— @proteus-vue/desktop 公共入口（G-24 B1 桌面交互原语）
//   纯逻辑（可单测）+ Vue 指令工厂（Web 接线；MP 端不注册——桌面交互无对等天然降级）
export { parseShortcutExpr, normalizeMod, matchShortcut, shortcutLabel } from './shortcut'
export type { ShortcutBinding, KeyEventLike, ShortcutMod, ShortcutKey } from './shortcut'
export { createFocusTrap, FOCUSABLE_SELECTOR } from './focus-trap'
export type { FocusTrapOptions, FocusTrap, FocusableElement } from './focus-trap'
export { buildMenuPosition, buildContextMenu, menuPointFrom } from './context-menu'
export type { MenuItem, MenuPoint, MenuSize, ViewportSize, PositionedMenu } from './context-menu'
export { resolveHoverClass, isHoverPointer, normalizePointerType, canHover } from './hover'
export type { HoverPreset, PointerKind } from './hover'
export {
  createDesktopDirectives,
  createHoverDirective,
  createShortcutDirective,
  createFocusTrapDirective,
  createContextMenuDirective,
} from './directives'
export type { ShortcutDirectiveValue, ContextMenuDirectiveValue } from './directives'