# @proteus-vue/desktop

> **G-24 B1 桌面交互原语**（`docs/proteus-semantic-primitives-plan/03-desktop-primitives.md`）· 让 PC 端从「布局兼容」升级到「交互可用」

## 一句话

**把桌面交互语义化为声明式原语**——`v-p-hover` / `v-p-context-menu` / `v-p-shortcut` / `v-p-focus-trap`，业务不手写 `if (isDesktop)` 分支（PRIM001 铁律）；纯逻辑层（快捷键解析/焦点陷阱/菜单构建/悬停判定）零依赖可单测。

## 内容

| 模块 | 说明 |
|------|------|
| `shortcut.ts` | **p-shortcut** 纯逻辑：`parseShortcutExpr("mod+s:save")` · `normalizeMod("mod", platform)`（⏎ Mac / Ctrl 其余——PRIM005 平台惯例）· `matchShortcut(e, keys)` 命中判定 · `shortcutLabel`（⌘S / Ctrl+S 菜单提示） |
| `focus-trap.ts` | **p-focus-trap** 纯逻辑：`createFocusTrap(el, opts)`——Tab 循环 / Shift+Tab 反向 / 打开聚焦首项 / 关闭恢复先前焦点（`getActiveElement` 注入）；`FOCUSABLE_SELECTOR` 标准可聚焦集 |
| `context-menu.ts` | **p-context-menu** 纯逻辑：`buildMenuPosition` 防溢出翻转定位 · `menuPointFrom` 长按/右键归一点 · `buildContextMenu` 构建+定位一步 |
| `hover.ts` | **p-hover** 纯逻辑：`resolveHoverClass(preset)`（brighten/lift/underline）· `canHover(pointerType)`（mouse/pen 可悬停；touch 降级 tap 高亮） |
| `directives.ts` | **Vue 指令工厂**：`createDesktopDirectives()` → `v-p-hover` / `v-p-shortcut` / `v-p-context-menu` / `v-p-focus-trap`（Web 接线，薄层；MP 不注册天然降级） |

## 用法

```ts
// main.ts —— 注册指令（PC 卡片演示）
import { createDesktopDirectives } from '@proteus-vue/desktop'
for (const [name, dir] of Object.entries(createDesktopDirectives())) {
  app.directive(name, dir)
}
```

```vue
<!-- 桌面交互：一次声明，桌面可用（MP 端不注册指令 → 优雅降级） -->
<button v-p-hover="'lift'" v-p-shortcut="{ expr: 'mod+s:save', handler: save }">保存</button>

<div v-p-focus-trap><!-- 弹窗：Tab 循环 + Shift+Tab 反向 --></div>

<div v-p-context-menu="{ items: [{ label: '编辑', value: 'edit' }, { label: '删除', value: 'del', danger: true }], onSelect: (v) => act(v) }">右键我</div>
```

**设计**：原语 = 语义面（不绑死实现）——纯逻辑在 `@proteus-vue/desktop` 可单测；Web 用 Vue 指令接线；iOS/鸿蒙/Android 原生映射（UIMenu/PopupMenu/焦点引擎）由宿主后端承接。PRIM001-005（禁手动 `if (isDesktop)`）门禁防护在 fluid:check 同族治理链。

## 验收（06-integration-batches.md B1）

- ✅ `mod+s` → Mac `⌘S` / Windows/Linux `Ctrl+S`（平台惯例自动遵循）
- ✅ p-focus-trap → Tab 容器内循环、Shift+Tab 反向
- ✅ p-context-menu → 触摸长按 / 鼠标右键触发同一菜单（防溢出定位）
- ✅ 快捷键注册 < 1ms / 条（纯逻辑零轮询）