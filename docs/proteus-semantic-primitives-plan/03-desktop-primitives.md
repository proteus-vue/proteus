# 桌面交互原语（B1：Input 家族核心）

> 目标：让 PC 端从"布局兼容"升级到"交互可用"。

## 1. p-hover（指针悬停）

```vue
<button p-hover="brighten">提交</button>
```
映射：Web `:hover` / 鸿蒙 hover 事件 / iOS 无（编译期剔除，降级为 tap 高亮）。

## 2. p-context-menu（右键菜单）

```vue
<p-card p-context-menu="cardActions" :menu-items="menuItems" />
```
映射：iOS `UIMenu` / Android `PopupMenu` / Web `contextmenu`。

## 3. p-shortcut（键盘快捷键）

```vue
<button p-shortcut="mod+s:save" @click="save">保存</button>
```
- `mod` = ⌘(Mac) / Ctrl(Windows/Linux)，**自动遵循平台惯例**（PRIM005）
- 映射：各端 keydown + 菜单栏显示快捷键提示

## 4. p-focus-trap（焦点陷阱，无障碍刚需）

```vue
<p-modal p-focus-trap>
  <!-- Tab/Shift+Tab 在弹窗内循环 -->
</p-modal>
```
映射：iOS 自动管理 / Web `focus-trap` / Android `FocusArea`。

## 5. p-drag / p-drop（拖拽，含文件）

```vue
<div p-drop="files" @drop="handleFiles">拖拽文件到此处</div>
```
映射：iOS `UIDragInteraction` / HTML5 DnD / Android `DragAndDrop`。

## 6. p-resizable（可调整尺寸）

```vue
<p-split p-resizable :min="200" :max="600" v-model:width="sideWidth" />
```
映射：`UIPanGesture` / `ResizeObserver` / 鸿蒙 `Resizable`。

## 编译期行为

```
p-hover     → Web: :hover / App: 编译期剔除（降级）
p-shortcut  → 全局 keydown 注册 + 菜单栏绑定
p-focus-trap → Web: focus-trap 注入 / iOS: 自动
```

**无系统原生对应的（如手柄适配）走组件层，框架只保证语义。**

## 示例：完整 PC 卡片

```vue
<p-card
  p-hover="lift"
  p-context-menu="cardMenu"
  p-drag="card"
  p-shortcut="mod+a:selectAll"
>
  {{ item.title }}
</p-card>
```
→ **一次声明，五端原生交互。**
