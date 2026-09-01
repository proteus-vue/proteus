# `p-adaptive` 编译器实现与运行时

> **执行位**：G-22 补充 / G-21（Compiler Plugin dogfooding）
> **关联**：`02-compiler-implementation.md`（G-22 主流程）、`03-tools-registry.md`（G-23 Agent）

---

## 1. Compiler 侧：SFC 解析 → AdaptiveConstraint IR

### 1.1 解析 `p-adaptive` 表达式

```
p-adaptive="sheet(0,600) | dialog(600,840) | popover(840,∞)"
        ↓ AST 解析
{
  type: 'AdaptiveConstraint',
  variants: [
    { form: 'sheet',   range: [0, 600] },
    { form: 'dialog',  range: [600, 840] },
    { form: 'popover', range: [840, Infinity] },
  ],
}
```

解析规则：
- `|` 分隔变体
- 区间 `(a, b)` 支持 `∞` / `infinity` 表示无上限
- **端点必须单调非降**，否则报错 FLD007

### 1.2 校验（编译期）

```typescript
function validateAdaptiveConstraint(node: AdaptiveConstraint): Diagnostic[] {
  const { variants } = node
  const diags: Diagnostic[] = []

  // FLD007：区间连续不重叠
  for (let i = 1; i < variants.length; i++) {
    if (variants[i].range[0] !== variants[i - 1].range[1]) {
      diags.push(error('FLD007', `区间不连续: ${variants[i - 1].form} 结束于 ${variants[i - 1].range[1]}, ${variants[i].form} 起始于 ${variants[i].range[0]}`))
    }
  }

  // FLD009：端点须来自 app.config.layout.breakpoints
  for (const v of variants) {
    const [lo, hi] = v.range
    if (lo !== 0 && !isDefinedBreakpoint(lo)) {
      diags.push(warning('FLD009', `端点 ${lo} 未定义在 app.config.layout.breakpoints`))
    }
    if (hi !== Infinity && !isDefinedBreakpoint(hi)) {
      diags.push(warning('FLD009', `端点 ${hi} 未定义在 app.config.layout.breakpoints`))
    }
  }

  return diags
}
```

### 1.3 代码生成

**Web / Skyline target**：生成 CSS `@container` 查询 + class 切换

```css
.modal { container-type: inline-size; }
@container (max-width: 600px) { .modal { /* sheet 样式 */ } }
@container (min-width: 600px) and (max-width: 840px) { .modal { /* dialog 样式 */ } }
@container (min-width: 840px) { .modal { /* popover 样式 */ } }
```

**iOS / Android / 鸿蒙 target**：生成原生容器选择逻辑（见 §2）

### 1.4 作为 Compiler Plugin（G-21）实现

`p-adaptive` 解析注册为 Compiler Plugin 的 `parse` + `buildIR` 钩子——与 Glass、SafeArea、Memorial 一致，**dogfooding 原则 #11**：

```typescript
export default definePlugin({
  name: 'proteus:adaptive',
  parse(ctx) { /* 识别 p-adaptive 指令 */ },
  buildIR(ctx) { /* 生成 AdaptiveConstraint 节点 */ },
  codegen(ctx) { /* 各端映射 */ },
})
```

## 2. 运行时：容器宽度监听 + 形态切换

### 2.1 核心类 `AdaptiveController`

```typescript
class AdaptiveController {
  private currentForm: string
  private resizeObserver: ResizeObserver | null = null

  constructor(
    private el: NativeView,
    private variants: AdaptiveVariant[],
    private onChange: (form: string) => void,
  ) {
    this.currentForm = this.compute(window.innerWidth) // 初始
    this.bind()
  }

  private bind() {
    // Web: ResizeObserver 监听容器（非 window）
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const w = entries[0].contentRect.width
        this.update(w)
      })
      this.resizeObserver.observe(this.el)
    }
    // App: 映射原生尺寸监听（见 §3）
  }

  private update(width: number) {
    const form = this.compute(width)
    if (form !== this.currentForm) {
      this.currentForm = form
      this.onChange(form) // 触发原生容器切换
    }
  }

  private compute(width: number): string {
    return this.variants.find(v => width >= v.lo && width < v.hi)?.form
      ?? this.variants[this.variants.length - 1].form
  }

  destroy() { this.resizeObserver?.disconnect() }
}
```

### 2.2 关键点：监听**容器宽度**，不是屏幕宽度

- Web：`ResizeObserver` 观察组件根元素
- 鸿蒙：`componentUtils.getRectangleById` + `onConfigurationChanged`
- Android：`View.OnLayoutChangeListener` / `WindowManager`
- iOS：`viewDidLayoutSubviews` / `traitCollectionDidChange`

**嵌套容器各自独立判断**——父级侧边栏收起时，子级弹窗的区间基于自身容器宽度重新计算。

### 2.3 形态切换 = 换原生容器

```typescript
// nodeOps（各端原生映射）
function applyAdaptiveForm(el: NativeView, form: string, anchor?: NativeView) {
  switch (platform) {
    case 'ios':
      iosPresent(el, form, anchor)   // UISheet / UIAlert / UIPopover
      break
    case 'android':
      androidPresent(el, form, anchor) // BottomSheet / AlertDialog / PopupWindow
      break
    case 'harmony':
      harmonyPresent(el, form, anchor) // Sheet / Dialog / Popup
      break
    case 'web':
    case 'skyline':
      webApplyForm(el, form)          // CSS class 切换（@container）
      break
  }
}
```

## 3. 五端原生映射速览

| 形态 | iOS | Android | 鸿蒙 |
|------|-----|---------|------|
| `sheet` | `UISheetPresentationController` + `detents` | `BottomSheetDialogFragment` | `Sheet` + `show` |
| `dialog` | `UIAlertController(.alert)` | `AlertDialog.Builder` | `AlertDialog` |
| `popover` | `UIPopoverPresentationController`（`sourceView = anchor`） | `PopupWindow` + `EpicenterGravity` | `Popup` + `target` |
| `drawer` | `UISplitViewController` (hidden primary) | `DrawerLayout` | `SideBarContainer` |
| `sidebar` | `UISplitViewController` (both visible) | `NavigationRail` + `Scaffold` | `SideBarContainer` (auto) |
| `split` | `UISplitViewController` (master-detail) | `SlidingPaneLayout` | `SideBarContainer` + 双栏 |

## 4. 与 DevTools（G-19）协同

- Inspector 显示当前容器宽度 + 命中的形态区间
- 可手动切换形态（覆盖自动判断）→ 调试响应式断点
- Timeline 记录形态切换事件 + 耗时

## 5. 可单测性（B1 优先）

`AdaptiveController.compute()` 是**纯函数**，零依赖：

```typescript
test('compute form by width', () => {
  const variants = [
    { form: 'sheet', lo: 0, hi: 600 },
    { form: 'dialog', lo: 600, hi: 840 },
    { form: 'popover', lo: 840, hi: Infinity },
  ]
  expect(compute(variants, 320)).toBe('sheet')
  expect(compute(variants, 600)).toBe('dialog')
  expect(compute(variants, 1024)).toBe('popover')
})
```

**B1 可先落地纯逻辑（区间校验 + compute），App 端原生映射 B3 后补。**
