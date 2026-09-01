# 五端原生映射详解

> **执行位**：G-22 补充（自适应容器 `p-adaptive` 各端实现）
> **关联**：G-07（Glass 映射方法论）、G-09（Safe Area）、`04-five-end-runtime.md`（G-22）

---

## 1. 映射总览

| 形态 | iOS | Android | 鸿蒙（ArkUI） | Web | Skyline |
|------|-----|---------|---------------|-----|---------|
| `sheet` | `UISheetPresentationController` | `BottomSheetDialog` | `Sheet`（`@ohos.arkui.advanced`） | `<dialog>` + `position: fixed bottom` | 半屏页面栈 |
| `dialog` | `UIAlertController(.alert)` | `AlertDialog` | `AlertDialog` | `<dialog>` 居中 | `wx.showModal` 自定义 |
| `popover` | `UIPopoverPresentationController` | `PopupWindow` | `Popup` | Popover API / anchored | 浮层组件 |
| `drawer` | `UISplitViewController` | `DrawerLayout` | `SideBarContainer` | `<details>` / off-canvas | 侧滑组件 |
| `sidebar` | `UISplitViewController`（双栏） | `NavigationRail` + `Scaffold` | `SideBarContainer`（showMode） | CSS Grid 侧栏 | 侧栏组件 |
| `split` | `UISplitViewController`（master-detail） | `SlidingPaneLayout` | `SideBarContainer` + `Grid` | CSS Grid 双栏 | 双栏页面 |

## 2. iOS 映射

### 2.1 Sheet → `UISheetPresentationController`（iOS 15+）

```swift
let vc = UIViewController()
vc.modalPresentationStyle = .pageSheet
if let sheet = vc.sheetPresentationController {
    sheet.detents = [.medium(), .large()]
    sheet.prefersEdgeAttachedInCompactHeight = true  // 横屏贴边 → 变 popover 形态
    sheet.widthFollowsPreferredContentSizeWhenEdgeAttached = true
}
present(vc, animated: true)
```

**关键**：iOS 系统**本身**就支持"随尺寸/环境自动调整 sheet 形态"——`prefersEdgeAttachedInCompactHeight` 在横屏紧凑高度时自动贴边呈现为 popover 风格。Proteus 把这套能力通过 `p-adaptive` 暴露给开发者。

### 2.2 Dialog → `UIAlertController`

```swift
let alert = UIAlertController(title: "确认", message: nil, preferredStyle: .alert)
alert.addAction(UIAlertAction(title: "确定", style: .default))
present(alert, animated: true)
```

### 2.3 Popover → `UIPopoverPresentationController`

```swift
let vc = UIViewController()
vc.modalPresentationStyle = .popover
vc.popoverPresentationController?.sourceView = anchorView  // 指向触发源
vc.popoverPresentationController?.sourceRect = anchorView.bounds
present(vc, animated: true)
```

### 2.4 Split → `UISplitViewController`

```swift
let split = UISplitViewController(style: .doubleColumn)
split.preferredDisplayMode = .oneBesideSecondary  // 宽度不足自动变 drawer
split.preferredSplitBehavior = .tile
```

**iOS 的 `UISplitViewController` 本身就是"自适应容器"的典范**：`preferredDisplayMode` 只是"偏好"，系统会根据可用宽度**自动**在 `.oneOverSecondary`（drawer 风格）和 `.oneBesideSecondary`（sidebar 风格）间切换。Proteus 的 `p-adaptive` 把这个自适应行为**编译期映射**到各端。

## 3. Android 映射

### 3.1 Sheet → `BottomSheetDialog`（Material Components）

```kotlin
val bottomSheet = BottomSheetDialog(context)
bottomSheet.setContentView(view)
bottomSheet.show()
// 行为模式：expandable / half-expanded / hidden（系统处理）
```

### 3.2 Dialog → `AlertDialog`

```kotlin
AlertDialog.Builder(context)
    .setTitle("确认")
    .setPositiveButton("确定") { _, _ -> }
    .show()
```

### 3.3 Drawer → `DrawerLayout` / `NavigationView`

```xml
<androidx.drawerlayout.widget.DrawerLayout>
    <FrameLayout android:id="@+id/content" />
    <com.google.android.material.navigation.NavigationView
        android:layout_gravity="start" />
</androidx.drawerlayout.widget.DrawerLayout>
```

### 3.4 Sidebar → `NavigationRail`（Material 3）

```kotlin
// Scaffold { NavigationRail { ... } ; content }
// 宽屏自动显示 rail，窄屏切换为 drawer（Material 自适应规范）
```

## 4. 鸿蒙映射

### 4.1 SideBarContainer（核心）

鸿蒙 ArkUI 的 `SideBarContainer` 是**原生自适应容器**——`showMode` 随窗口尺寸自动切换：

```typescript
SideBarContainer({
  type: SideBarContainerType.Embed,  // 嵌入模式（sidebar）
  // 窄屏自动变为 Overlay（drawer）
  showSideBar: true,
  controlButton: { ... }
}) {
  // 侧栏内容
}
```

- `Embed`：侧栏嵌入（宽屏，sidebar 形态）
- `Overlay`：悬浮覆盖（窄屏，drawer 形态）
- **系统自动根据窗口宽度切换**，无需开发者判断

### 4.2 Sheet / Dialog / Popup

```typescript
// Sheet
import { Sheet } from '@ohos.arkui.advanced'
Sheet({ isShow: this.visible }) { Content() }

// Popup（锚定）
Button().bindPopup(this.visible, {
  builder: () => Content(),
  targetSpace: 8,
})
```

## 5. Web / Skyline 映射

### 5.1 CSS `@container` 查询（推荐）

```css
.modal { container-type: inline-size; }
@container (max-width: 37.5rem) { .modal { /* sheet */ } }   /* 600px */
@container (min-width: 37.5rem) and (max-width: 52.5rem) { .modal { /* dialog */ } }
@container (min-width: 52.5rem) { .modal { /* popover */ } }
```

**关键点**：`@container` 监听的是**容器宽度**，不是视口宽度——与 App 端"监听组件根元素尺寸"语义一致，真正实现跨端统一。

### 5.2 Popover（Web）

```css
.modal[form="popover"] {
  position: fixed;
  /* anchor positioning API（Chrome 125+） */
  anchor-name: --trigger;
  top: anchor(--trigger bottom);
  left: anchor(--trigger start);
}
```

### 5.3 Skyline

Skyline 作为小程序原生渲染后端，通过 `p-adaptive` 映射为：
- `sheet` → 半屏页面栈（`wx.navigateTo` + 自定义转场）
- `dialog` → 原生模态层
- `popover` → 浮层组件（`position: fixed` + `anchor`）

## 6. 降级策略

与 Glass（L3→L2→L1→solid）一致，**能力检测 → 逐级降级 → 绝不崩溃**：

| 形态 | 首选 | 降级 1 | 降级 2 |
|------|------|--------|--------|
| `sheet` | iOS 15+ `UISheetPresentationController` | `UIViewController` + 自定义转场 | 普通模态全屏 |
| `popover` | `UIPopoverPresentationController` | `UIAlertController(.actionSheet)` | 居中 dialog |
| `sidebar` | `NavigationRail`（Material 3） | `BottomNavigationView` | 顶部 TabBar |
| `split` | `UISplitViewController` | `SlidingPaneLayout` | 全屏跳转 |

**降级由 `CapabilityRegistry`（G-07 能力矩阵同款）统一判断**，开发者无感。

## 7. 与 iOS 系统能力的同构性总结

| iOS 系统能力 | Proteus 映射 |
|--------------|-------------|
| `UISheetPresentationController` + detents | `p-adaptive="...sheet..."` |
| `prefersEdgeAttachedInCompactHeight`（横屏自动贴边变 popover） | 区间端点语义 |
| `UISplitViewController` 自动切 drawer/sidebar | `p-adaptive="drawer|sidebar"` |
| `UIAlertController` adaptive presentation | `p-adaptive="...dialog..."` |
| `UITraitCollection` horizontal size class | 容器宽度断点（同源概念） |

**Proteus 不是发明自适应逻辑，而是把 iOS/Android/鸿蒙各自已有的系统级自适应能力，用统一语义收敛、跨端映射。** 这与柔性布局四原语（`p-grid` → `UICollectionView`）、Glass（`UIGlassEffect`）、SafeArea（`safeAreaInsets`）完全同构。
