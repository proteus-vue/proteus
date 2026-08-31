# 05 五端样式映射细则

> Web / Skyline / iOS / Android / 鸿蒙 —— 同一份 `p-*` 声明，各自用原生方式实现。

## 一、映射总则

```
SFC <style> + <template>
    ↓ Compiler
LayoutSemantics IR（统一语义：p-flex / p-stack / box-model / visual）
    ↓ 各端 Renderer
  ① Web       → CSSOM（DOM style）
  ② Skyline   → WXSS + 原生组件样式
  ③ iOS       → UIView 属性 + AutoLayout / UIStackView
  ④ Android   → View 属性 + ConstraintLayout / FlexboxLayout
  ⑤ 鸿蒙      → ArkUI 组件属性 + Flex/Stack/Grid
```

## 二、布局容器映射

| 语义 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| `p-flex row` | `flex` row | flex row | `UIStackView(axis:.horizontal)` | `ConstraintLayout` chain / `Row` | `Row()` |
| `p-flex col` | `flex` col | flex col | `UIStackView(axis:.vertical)` | `LinearLayout` vertical | `Column()` |
| `p-stack` | `position:relative` + 绝对定位子 | Stack | `UIView` + manual frame/constraints | `FrameLayout` / `ConstraintLayout` | `Stack()` |
| `p-grid` | `grid` | grid | `UICollectionView` + compositional | `GridLayoutManager` | `Grid()` |
| `p-scroll` | `overflow:auto` | `<scroll-view>` | `UIScrollView` | `RecyclerView` / `NestedScrollView` | `Scroll()` / `List()` |

## 三、盒模型映射

| 语义 | 五端处理 |
|------|---------|
| width / height | 直接映射（各端均支持） |
| min-width / max-width | 直接映射 |
| padding | 直接映射 |
| margin | 直接映射（鸿蒙用 `margin`、iOS AutoLayout 间距） |
| border | 直接映射（颜色走 rgba→ARGB） |
| border-radius | 直接映射（iOS `layer.cornerRadius`、鸿蒙 `borderRadius`） |
| box-sizing: border-box | 默认 ✅（Skyline 支持 border-box/content-box） |

## 四、视觉映射

| 语义 | Web | Skyline | iOS | Android | 鸿蒙 |
|------|-----|---------|-----|---------|------|
| background-color | ✅ | ✅ | ✅ | ✅ | ✅ |
| opacity | ✅ | ✅ | `alpha` | `alpha` | `opacity` |
| color | ✅ | ✅ | ✅ | ✅ | ✅ |
| backdrop-filter | ✅ | ✅ | `UIGlassEffect` | `RenderEffect` | `effect:blur` |

> 颜色格式：Compiler color 模块统一 → Web/Skyline/iOS/Android CSS 用 `rgba()`，鸿蒙 + Android shadow 用 `ARGB` 十六进制。

## 五、Skyline 专项（小程序端关键约束）

Skyline 与 WebView 的差异，正是选 Skyline 换原生渲染的要付出的：

- ✅ 支持：`border-box/content-box`、`linear-gradient`、`backdrop-filter`、`:active/:first-child/:nth-child`(8.0.49+)
- ❌ 不支持：通用选择器、属性选择器、`float`、`inline`(除 text 嵌套)、裸 `overflow:scroll`(须 `<scroll-view>`)
- ⚠️ 部分：`z-index` 仅兄弟节点生效（无层叠上下文）、transform 仅 translate/scale、`:hover` 有限

→ **Skyline 是「CSS 子集最接近 Web」的小程序渲染方案**，也是 Proteus 小程序端选它的核心理由。

## 六、端差异的收敛策略

**不允许**业务代码写 `if (platform === 'ios')` 处理样式差异。
**统一入口**：语义组件 + Compiler 映射表。

```ts
// Renderer 内部（非业务）
function applyFlex(node: NativeNode, spec: FlexSpec, platform: Platform) {
  switch (platform) {
    case 'ios':     return UIStackViewBinding.create(node, spec)
    case 'android': return ConstraintLayoutBinding.apply(node, spec)
    case 'harmony': return ArkUIFlexBinding.apply(node, spec)
    // ...
  }
}
```

业务层只写 `<p-flex direction="row" justify="center">` —— 差异内聚在 Renderer。

## 七、设备分级与降级

低端机（见 Memory / Performance plan）自动降级：

| 能力 | 高端 | 低端降级 |
|------|------|---------|
| `<p-glass>` | 系统玻璃 | 半透明纯色 |
| `<p-shadow>` | elevation 4 | elevation 1 / 无阴影 |
| 渐变 | 原生渐变层 | 纯色 |

降级映射表由 Compiler 生成，**运行期按设备分级切换**。
