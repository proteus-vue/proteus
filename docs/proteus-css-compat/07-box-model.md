# 07 盒模型与安全区

> `width/height/padding/margin/border/box-sizing` 是 ✅ 直映射档，**五端均支持**——这是 CSS 兼容最稳的一块。

## 一、盒模型兼容（✅ 全绿）

| 属性 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| width / height | ✅ | ✅ | ✅ | ✅ | ✅ |
| min-width / max-width | ✅ | ✅ | ✅ | ✅ | ✅ |
| min-height / max-height | ✅ | ✅ | ✅ | ✅ | ✅ |
| padding (四方向) | ✅ | ✅ | ✅ | ✅ | ✅ |
| margin (四方向) | ✅ | ✅ | ✅ | ✅ | ✅ |
| border (width/style/color) | ✅ | ✅ | ✅ | ✅ | ✅ |
| border-radius | ✅ | ✅ | ✅ | ✅ | ✅ |
| box-sizing | ✅ | ✅(border-box/content-box) | ✅(AutoLayout) | ✅ | ✅ |

**结论**：标准盒模型是「语义一致」最容易达成的一块，业务可放心使用。

## 二、单位

允许：`px`（主单位）、`rem`（按端根字号）、`%`。
禁用：`vh / vw / calc`（→ 走 `p-safe-area` / 编译期重写，见 03）。

> `rem` 根字号按端设定：Web=16px、Skyline=按屏幕、iOS/Android/鸿蒙=按系统字体缩放（呼应无障碍动态字体）。

## 三、安全区（safe-area）

系统级 inset（状态栏、底部 Home Indicator、刘海、键盘）**必须用语义指令**，禁止硬编码 `padding-top: 44px`。

```vue
<p-safe-area edges="top" />
<p-view class="page">...</p-view>
```

| 端 | 映射 |
|----|------|
| Web | `env(safe-area-inset-*)` + viewport-fit=cover |
| Skyline | `safe-area-inset-*` 环境变量 |
| iOS | `safeAreaLayoutGuide` / `additionalSafeAreaInsets` |
| Android | `WindowInsets` / `systemBars` |
| 鸿蒙 | `getWindowAvoidArea` |

## 四、键盘避让（键盘弹出）

`100vh` 在微信/鸿蒙键盘弹出时不收缩 → 输入框被遮挡。

**方案**：`<p-page keyboard-avoid="auto">`，Renderer 监听键盘事件，调整页面底部约束。

```vue
<p-page keyboard-avoid="auto">
  <p-input v-model="text" />
</p-page>
```

| 端 | 实现 |
|----|------|
| Web | `visualViewport` API |
| Skyline | `keyboard-height` 事件 |
| iOS | `UIKeyboardWillShowNotification` + constraint |
| Android | `WindowInsetsCompat` + `adjustResize` |
| 鸿蒙 | `KeyboardAvoidMode` / `getKeyboardHeight` |

## 五、动态字体（无障碍）

`rem` / `em` 随系统字号缩放，**禁止用 `px` 固定文字尺寸**（会破坏无障碍）。

```css
/* ✅ 跟随系统字号 */
.title { font-size: 1.125rem; }

/* ❌ 固定，视障用户放大无效 */
.bad   { font-size: 18px; }
```

Compiler 可配 `preferRelativeFont: true`，对 `px` 字号告警。

## 六、负 margin 与裁剪

`margin: -8px`、负偏移在五端行为略有差异（尤其鸿蒙/Android 裁剪）。
**规则**：负 margin 仅允许在 `p-stack` 重叠场景，且需配对 `overflow:visible`；
其他场景改用 `transform: translate`（✅ 全端支持）。

## 七、边框与背景的渲染细节

- `border-radius` + `overflow:hidden`：iOS 需 `layer.masksToBounds`、鸿蒙需 `clip`——Renderer 自动补齐，**业务无感知**
- `background-clip`：五端支持不一 → 仅 Web/Skyline 直接用，原生端降级（warn）
- `box-sizing`：统一默认 `border-box`（与 Vue/现代 CSS 惯例一致）
