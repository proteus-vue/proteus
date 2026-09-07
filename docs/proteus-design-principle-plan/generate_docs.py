#!/usr/bin/env python3
"""生成 Proteus「统一语义 + 原生实现」全局设计原则补充文档。

产物:
  - architecture-principle.md       (主文档)
  - app-renderer-layout.md          (App Renderer plan 补充)
  - component-layout-semantics.md   (Component plan 补充)

写入本脚本所在目录（docs/proteus-design-principle/）
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)


def write(path: str, content: str) -> None:
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"written: {full} ({len(content.encode('utf-8'))} bytes)")


ARCHITECTURE_PRINCIPLE = """# 全局设计原则 #10：统一语义 + 原生实现

> **"Semantics Unified, Implementation Native."**
> 语义统一，实现各端最优。

---

## 1. 一句话定义

**Proteus 不自己实现任何端的能力，只定义"统一语义"，再映射到各端最强原生实现。**

这条原则贯穿 Glass、布局、API、主题、导航——是整套框架的**统一哲学**。

---

## 2. 为什么需要这条原则（决策背景）

### 2.1 三条候选路线

| 路线 | 含义 | 代表 | 一致性 | 原生质感 | 成本 | 系统新特性 |
|------|------|------|--------|---------|------|-----------|
| **A. 自绘** | 自己算布局 + 自己画像素 | Flutter (Skia) | 像素级 | ❌ 自己画 | 极高 | 滞后 |
| **B. 跨端引擎** | 一套布局引擎跑全端 | Yoga (RN/Facebook) | 像素级 | ⚠️ 半原生 | 高（维护引擎） | 滞后 |
| **C. 语义统一 + 原生实现** | 框架定义语义，各端原生实现 | **Proteus（本原则）** | **语义一致** | ✅ 全原生 | **低** | **即时** |

### 2.2 选择 C 的理由

1. **成本最低**：不需要维护 Yoga 级约束求解器
2. **原生质感最高**：各端用系统布局容器，外观/动效/无障碍免费
3. **系统新特性即时可用**：iOS 26 新间距、鸿蒙 NEXT 新容器，不用等框架更新
4. **符合各平台设计规范**：iOS 遵循 HIG、鸿蒙遵循 HarmonyOS 指南、Android 遵循 Material —— 而不是"一套 UI 硬套三端"

### 2.3 关键区分：语义一致 ≠ 像素一致

- ❌ **像素一致**：五个端渲染结果逐像素相同（Flutter / Yoga 追求）
- ✅ **语义一致**：五个端对"语义"的理解相同，视觉表现**符合该平台规范**

> 例：`p-flex justify="space-between"` 在 iOS 上用 `UIStackView.distribution = .equalSpacing`，
> 鸿蒙上用 `Flex({ justifyContent: FlexAlign.SpaceBetween })`，Android 上用 `ConstraintLayout` 链式约束。
> **间距数值可能不同（遵循各平台规范），但"两端对齐、中间均分"的语义一致。**

---

## 3. 原则的核心公式

```
┌─────────────────────────────────────────────────────┐
│  统一语义层 (Semantics Layer)                        │
│  p-flex / p-stack / p-grid / pg-glass / api/*       │
│  ↓ （Compiler IR 固化）                              │
├──────────────┬──────────────┬───────────────────────┤
│  原生实现 iOS │ 原生实现 鸿蒙 │ 原生实现 Android/Web  │
│  UIStackView │  Flex 容器   │  ConstraintLayout/    │
│  + AutoLayout│  + ArkUI     │  CSS Flexbox          │
└──────────────┴──────────────┴───────────────────────┘
         ↓              ↓              ↓
    系统渲染管线（原生质感 + 无障碍 + 系统新特性）
```

**三层职责**：
1. **语义层**：定义"做什么"（跨端一致）
2. **映射层**：IR → 平台 API 调用（Compiler + Renderer）
3. **原生层**：平台自己完成渲染（系统负责）

---

## 4. 适用范围（全局铁律）

这条原则**不只是布局**，它是一条**贯穿全局的设计哲学**：

| 能力域 | 统一语义 | 原生实现（映射） | 文档归属 |
|--------|---------|-----------------|---------|
| **布局** | `p-flex` / `p-stack` / `p-grid` | iOS UIStackView / 鸿蒙 Flex / Android ConstraintLayout | Component plan |
| **玻璃** | `<pg-glass preset>` | iOS UIGlassEffect / 鸿蒙 fractal / Android RenderEffect | Glass plan |
| **导航** | `router.push()` + 转场声明 | iOS UINavigationController / 鸿蒙 Navigator / Android Fragment | Router plan |
| **主题** | 语义 token (`color.surface`) | iOS UITraitCollection / 鸿蒙 Theme / CSS 变量 | Theme plan |
| **动画** | `transition` / `worklet` | iOS Core Animation / 鸿蒙 animator / Android MotionLayout | Animation plan |
| **手势** | `onPan` / `onLongPress` | iOS UIGestureRecognizer / 鸿蒙 Gesture / Android GestureDetector | App Renderer |
| **字体** | `<p-text>` + 动态字号 | 各平台 Dynamic Type / 系统字体 | Component plan |
| **无障碍** | 语义 role | iOS VoiceOver / 鸿蒙 Accessibility / TalkBack | Accessibility |

**一句话**：Proteus 只定义"语义契约"，**绝不**自己画像素、自己算布局、自己实现系统能力。

---

## 5. 反例（明确禁止）

以下做法**违反原则 #10**，禁止出现在任何 plan 或代码中：

| 禁止项 | 原因 | 替代方案 |
|--------|------|---------|
| ❌ 引入 Skia/Canvas 自绘 UI | 违反"原生实现" | 用原生 View + 原生布局 |
| ❌ 引入 Yoga 做跨端布局 | 成本高风险，且阻碍系统新特性 | 语义层 + 各端原生布局 |
| ❌ 用 WebView 套壳渲染 App | 非原生、性能差（uni-app 老路） | Custom Renderer + JSI |
| ❌ 自己实现手势识别器 | 系统级手势（边缘返回等）无法替代 | 映射系统 GestureRecognizer |
| ❌ 硬编码像素值追求"完全一致" | 违背平台设计规范 | 用语义 token + 平台自适应 |

---

## 6. 实施规则（三要三不要）

### ✅ 三要

1. **要定义语义契约**：每个能力域先写 `Semantics` 接口（TypeScript 类型），再写映射
2. **要映射系统最强 API**：能用系统级 API 就用（如 iOS `UIGlassEffect`），不用自研
3. **要允许端差异**：语义一致即可，视觉/交互遵循该平台规范

### ❌ 三不要

1. **不要追求像素一致**：那是 Flutter 的路，不是你的路
2. **不要自己实现系统能力**：手势/导航/无障碍交给系统
3. **不要引入跨端自绘引擎**：成本高风险，且违反原生优先战略

---

## 7. 对齐已有决策

这条原则**不是新东西**，而是把已有决策**提炼成全局铁律**：

- **Glass L3**：`<pg-glass>` → iOS `UIGlassEffect` / 鸿蒙 fractal（语义→原生）✅ 已对齐
- **App Renderer**：JSI 直调 Native API（不封装子集，100% 可达）✅ 已对齐
- **Platform 分层**：L1 必达 / L2 尽力 / L3 系统级（能力分层 = 语义分层）✅ 已对齐
- **IR 骨架**：统一 IR → 各端消费（语义统一）✅ 已对齐

**本次只是把"隐含哲学"显式化，作为全局第 10 条铁律。**

---

## 8. 对外话术（Website / README）

> **Proteus 不追求"一套 UI 跑三端"，而是追求"一份语义，三端各自最美"。**
>
> 我们用统一的声明式语义描述界面，再由各平台用最原生的方式实现——
> iOS 遵循 HIG、鸿蒙遵循 HarmonyOS 指南、Android 遵循 Material。
> 结果是：**开发体验统一（写一次），用户体验原生（各端最优）。**
>
> 系统新特性（如 iOS 26 液态玻璃）即时可用，无需等待框架更新。

---

## 9. 执行位与落地

| 动作 | 归属 plan | 优先级 |
|------|----------|--------|
| 将原则 #10 写入 Architecture 规约 | Architecture v1.x | P0（立即） |
| 定义 `LayoutSemantics` 接口 | Component plan | G-03 |
| 实现 `PlatformLayoutEngine` 映射 | App Renderer M2 | G-05 |
| 语义 token 主题系统 | Theme plan | G-07 |
| 对齐 Glass / Router / Animation | 各对应 plan | 各自里程碑 |

---

## 10. 参考

- Flutter 布局系统（RenderBox / Constraints）— 自绘路线的天花板
- Yoga（Facebook）— 跨端布局引擎，RN 使用
- iOS UIStackView / AutoLayout — 原生布局容器
- 鸿蒙 ArkUI Flex / Grid — 原生声明式布局
- Android ConstraintLayout / FlexboxLayout — 原生布局
- NativeScript 元数据生成 — 语义→原生映射的实现参考

---

> **原则 #10 是 Proteus 的灵魂：不做下一个 Flutter，做第一个"语义统一 + 原生最优"的跨端框架。**
"""

APP_RENDERER_LAYOUT = """# App Renderer 补充：布局引擎归属

> 归属：`proteus-app-renderer-plan`
> 对齐：Architecture 原则 #10（统一语义 + 原生实现）

---

## 1. 决策：布局引擎归谁？

### 结论

**Proteus App 端不引入跨端自绘布局引擎（如 Yoga / Skia），布局语义由框架统一定义，各端用原生布局容器实现。**

| 端 | 布局语义 | 原生实现 |
|----|---------|---------|
| iOS | `p-flex` / `p-stack` / `p-grid` | `UIStackView` + AutoLayout constraints |
| 鸿蒙 | 同上 | ArkUI `Flex` / `Column` / `Row` / `Grid` |
| Android | 同上 | `ConstraintLayout` 链式约束 / `FlexboxLayout` |
| Web | 同上 | CSS Flexbox / Grid |
| Skyline | 同上 | WXSS Flexbox / Grid |

**五个端，一份语义，五种原生实现。**

---

## 2. 语义契约：`LayoutSemantics`

框架只定义语义，**不关心平台怎么实现**：

```typescript
// Compiler 产出的 IR 节点（语义层）
interface LayoutIR {
  kind: 'flex' | 'stack' | 'grid'
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  gap?: number | { row: number; col: number }
  padding?: Spacing
  margin?: Spacing
  sizing?: {
    width?: 'auto' | number | 'fill'
    height?: 'auto' | number | 'fill'
    flex?: number
  }
  wrap?: boolean
}
```

**这份 IR 五端通用**，各端 Renderer 消费它调用平台 API。

---

## 3. 映射示例

### 3.1 `p-flex direction="row" justify="space-between"`

```swift
// iOS: UIStackView
let stack = UIStackView(arrangedSubviews: children)
stack.axis = .horizontal
stack.distribution = .equalSpacing  // space-between
```

```typescript
// 鸿蒙: ArkUI Flex
Flex({
  direction: FlexDirection.Row,
  justifyContent: FlexAlign.SpaceBetween
}) { ... }
```

```kotlin
// Android: ConstraintLayout 链式约束
ConstraintSet {
  createHorizontalChain(
    elements = children,
    chainStyle = ChainStyle.Spread  // space-between
  )
}
```

```css
/* Web / Skyline: CSS Flexbox */
.flex { display: flex; flex-direction: row; justify-content: space-between; }
```

---

### 3.2 `p-stack alignment="center"`

| 端 | 实现 |
|----|------|
| iOS | `UIStackView` + `alignment = .center` |
| 鸿蒙 | `Stack({ alignContent: Alignment.Center })` |
| Android | `FrameLayout` / `ConstraintLayout` 居中约束 |
| Web | `display: grid; place-items: center` |

---

## 4. 实现层：`PlatformLayoutEngine`

各端实现一个接口，**Compiler IR → 平台 API 调用**：

```typescript
// 伪代码：App Renderer 内的布局映射器
interface PlatformLayoutEngine {
  applyFlex(parent: NativeNode, spec: FlexIR): void
  applyStack(parent: NativeNode, spec: StackIR): void
  applyGrid(parent: NativeNode, spec: GridIR): void
  measure(node: NativeNode, constraints: SizeConstraints): Size
}

// iOS 实现
class IOSLayoutEngine implements PlatformLayoutEngine {
  applyFlex(parent: UIView, spec: FlexIR) {
    const stack = UIStackView.new()
    stack.axis = spec.direction === 'row' ? .horizontal : .vertical
    stack.distribution = mapJustify(spec.justify)  // 语义→原生枚举
    parent.addSubview(stack)
  }
  // ...
}
```

**映射表是单一事实源**（`p-*` 组件映射表的布局子集）。

---

## 5. 语义收敛策略（如何做到"语义一致"）

### 5.1 语义层最小集

只定义**所有平台都能表达**的语义，避免"某平台表达不了"：

| 定义 | 五端支持情况 | 决策 |
|------|-------------|------|
| `p-flex` (row/column, justify 6 种, align 5 种) | ✅ 五端全支持 | **纳入 L1（必达）** |
| `p-grid` (columns + gap) | ✅ 五端全支持 | **纳入 L1（必达）** |
| `p-stack` (alignment) | ✅ 五端全支持 | **纳入 L1（必达）** |
| `p-masonry` (瀑布流) | ⚠️ iOS/鸿蒙需自研容器 | **纳入 L2（尽力，低版本降级 flex）** |
| `p-blur` (玻璃) | ⚠️ 需系统 API | **纳入 L3（系统级）** |

### 5.2 平台差异处理

- **语义支持 → 原生映射**：直接调平台 API
- **语义不支持 → 降级**：`p-masonry` 在低版本退化为 `p-flex wrap`
- **语义不存在 → L3 系统级**：如玻璃效果，仅高版本可用

**遵循 Platform plan 的 L1/L2/L3 分层**，布局语义也按此分层。

---

## 6. 性能考虑

### 6.1 原生布局 vs 自绘

| 指标 | 原生布局（本方案） | 自绘（Flutter） |
|------|------------------|----------------|
| 首次布局 | 依赖系统（快） | 引擎自算（可控） |
| 动态更新 | 系统增量布局 | 引擎增量布局 |
| 复杂嵌套 | 系统优化（AutoLayout 有缓存） | 引擎优化（RelayoutBoundary） |
| 跨端一致性 | 语义一致 | 像素一致 |

**原生布局性能足够**：iOS AutoLayout、鸿蒙 ArkUI、Android ConstraintLayout 都经过多年优化，日常业务场景无瓶颈。

### 6.2 性能边界（需 AOT/IFR 兜底）

- **超深嵌套（>20 层）**：原生布局递归成本高 → 用 IR 做布局树扁平化（view flattening）
- **长列表**：用 `recycle-view`（内存 plan 已覆盖）
- **首帧**：用 AOT + IFR（性能 plan 已覆盖）

---

## 7. 与 Flutter / ArkUI 的对标

| 能力 | Flutter | ArkUI | Proteus（本方案） |
|------|---------|-------|------------------|
| 布局声明式 | ✅ Widget | ✅ @Component | ✅ `p-flex` 等 |
| 布局实现 | **自绘 Skia** | **鸿蒙渲染服务** | **各端原生布局** |
| 跨端一致 | 像素级 | 仅鸿蒙 | 语义一致 |
| 原生外观 | ❌ | ✅（鸿蒙） | ✅（全端） |
| 系统新特性 | 滞后 | 即时 | **即时** |
| 无障碍 | 需手动 | 系统 | **系统（免费）** |

**Proteus 的选择**：放弃像素一致，**换取原生质感 + 系统新特性即时可用 + 无障碍免费**。

---

## 8. 实施里程碑

| 批次 | 内容 | 验收 |
|------|------|------|
| M2 | 定义 `LayoutIR` + `PlatformLayoutEngine` 接口 | 类型通过 |
| M3 | iOS/鸿蒙布局映射实现 | 真机跑通 `p-flex` 示例 |
| M4 | Android 布局映射 | 三端（iOS/鸿蒙/Android）`p-flex` 行为一致 |
| M5 | 复杂布局（嵌套/grid/stack） | 通过语义一致性测试 |

---

## 9. 禁止项（对齐原则 #10）

- ❌ 禁止引入 Yoga / FlexboxLayout 作为"统一引擎"
- ❌ 禁止用 Canvas/Skia 自绘布局
- ❌ 禁止硬编码像素值追求像素一致
- ❌ 禁止自己实现布局约束求解器

**只允许**：定义语义 → 映射系统布局 API。

---

## 10. 参考实现

- **NativeScript**：`layout-base.ts` 处理布局，各平台 `ios/utils.ts` / `android/utils.ts` 实现——可参考其"语义→平台"分层结构
- **RN**：Yoga 是反例（成本高），但其 Flex 语义定义可借鉴
- **Flutter**：`RenderBox` 约束系统——理解"布局即约束求解"，但不照搬实现

---

> **布局引擎归属的终局：Proteus 定义语义，系统完成渲染。这是"统一语义 + 原生实现"原则在布局域的具体落地。**
"""

COMPONENT_LAYOUT_SEMANTICS = """# Component 补充：布局语义规范

> 归属：`proteus-component-plan`
> 对齐：Architecture 原则 #10（统一语义 + 原生实现）

---

## 1. 布局组件清单（统一语义层）

Proteus 暴露给业务的布局组件，**五端通用**：

| 组件 | 语义 | L 层 | 各端原生映射 |
|------|------|------|-------------|
| `<p-view>` | 通用容器 | L1 | `UIView` / `Component` / `View` / `div` |
| `<p-flex>` | 弹性布局 | L1 | `UIStackView` / `Flex` / `ConstraintLayout` / `flex` |
| `<p-stack>` | 堆叠布局 | L1 | `UIStackView(overlay)` / `Stack` / `FrameLayout` / `grid` |
| `<p-grid>` | 网格布局 | L1 | `UICollectionView` / `Grid` / `RecyclerView(Grid)` / `grid` |
| `<p-scroll>` | 滚动容器 | L1 | `UIScrollView` / `Scroll` / `NestedScrollView` / `scroll-view` |
| `<p-recycle>` | 回收列表 | L1 | `UITableView` / `List` / `RecyclerView` / `recycle-view` |
| `<p-masonry>` | 瀑布流 | L2 | 原生容器 / 降级 `p-flex wrap` | 
| `<p-divider>` | 分隔线 | L1 | `Separator` / `Divider` / `View` / `border` |

**L1 = 五端必达，L2 = 尽力达（低版本降级）。**

---

## 2. `p-flex` 完整语义

```vue
<p-flex
  direction="row | column"
  justify="start | center | end | space-between | space-around | space-evenly"
  align="start | center | end | stretch | baseline"
  :gap="8"
  :wrap="false"
>
  <slot />
</p-flex>
```

### 2.1 属性 → 原生枚举映射

| `justify` | iOS `UIStackView.Distribution` | 鸿蒙 `FlexAlign` | Android `ChainStyle` | CSS |
|-----------|-------------------------------|-----------------|---------------------|-----|
| `start` | `.fill` (leading) | `Start` | `Packed` (start) | `flex-start` |
| `center` | `.centered` | `Center` | `Packed` (center) | `center` |
| `end` | `.fill` (trailing) | `End` | `Packed` (end) | `flex-end` |
| `space-between` | `.equalSpacing` | `SpaceBetween` | `Spread` | `space-between` |
| `space-around` | `.equalCentering` | `SpaceAround` | `Spread_Inside` | `space-around` |
| `space-evenly` | `.equalSpacing` (custom) | `SpaceEvenly` | `Spread` | `space-evenly` |

> 这张表是**单一事实源**，写在 Component plan 的映射表文件里。

---

## 3. `p-stack` 完整语义

```vue
<p-stack alignment="top-start | top-center | top-end | center | bottom-start | ...">
  <slot />
</p-stack>
```

| `alignment` | iOS | 鸿蒙 | Android | CSS |
|-------------|-----|------|---------|-----|
| `center` | `.alignment = .center` | `Alignment.Center` | 居中约束 | `place-items: center` |
| `top-start` | `.topLeading` | `TopStart` | 左上约束 | `align-items: start` |

---

## 4. `p-grid` 完整语义

```vue
<p-grid :columns="3" :gap="8">
  <slot />
</p-grid>
```

| 端 | 实现 |
|----|------|
| iOS | `UICollectionView` + `UICollectionViewFlowLayout` |
| 鸿蒙 | `Grid` + `GridItem` |
| Android | `RecyclerView` + `GridLayoutManager` |
| Web / Skyline | CSS `display: grid; grid-template-columns: repeat(3, 1fr)` |

---

## 5. 语义收敛规则

### 5.1 只定义"五端都能表达"的语义

- ✅ `justify` 6 种值：五端全支持 → 纳入 L1
- ✅ `align` 5 种值：五端全支持 → 纳入 L1
- ⚠️ `gap` 小数精度：iOS/Android 支持任意值，Web 支持 → 纳入 L1
- ❌ `p-masonry` 精确控制：iOS/鸿蒙需自研 → 纳入 L2（降级）

### 5.2 不允许的语义

- ❌ "距左 13.7px" 这类**精确像素** → 违反语义一致（各平台最小间距单位不同）
- ❌ "阴影模糊半径 4.5" → 应用语义 token（如 `elevation.sm`）
- ✅ 改用语义 token：`spacing.md`、`radius.lg`、`elevation.sm`

---

## 6. 响应式与断点（语义层）

```vue
<p-flex
  direction="row"
  :wrap="true"
  :gap="spacing.md"
>
  <p-view :flex="1" />
  <p-view :flex="1" />
</p-flex>
```

**断点用语义 token，不用固定 px**：

```typescript
// tokens (五端统一语义)
spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
radius  = { sm: 4, md: 8, lg: 12, xl: 20 }
```

各端映射到系统推荐值（iOS HIG spacing / Material spacing / 鸿蒙 design token）。

---

## 7. 对齐原则 #10 的验证清单

每个布局组件 PR 必须回答：

- [ ] 是否定义了清晰的**语义**（不依赖具体平台）？
- [ ] 是否映射到**各端原生实现**（非自绘）？
- [ ] 是否允许**平台差异**（语义一致而非像素一致）？
- [ ] 是否用了**语义 token**（非硬编码像素）？
- [ ] 是否遵循 **L1/L2/L3 分层**（五端支持情况）？

---

## 8. 示例：从 Vue SFC 到五端原生

```vue
<!-- 业务代码（一份，五端通用） -->
<p-flex direction="row" justify="space-between" align="center" :gap="spacing.md">
  <p-text>标题</p-text>
  <p-button>操作</p-button>
</p-flex>
```

Compiler 产出统一 IR → 各端 Renderer 映射：

```
iOS       → UIStackView (horizontal, equalSpacing, center, spacing=12pt)
鸿蒙      → Flex (Row, SpaceBetween, Center, gap=12vp)
Android   → ConstraintLayout (horizontal chain, spread, center, gap=12dp)
Web       → div (flex, row, space-between, center, gap=12px)
Skyline   → view (flex, row, space-between, center, gap=12px)
```

**视觉表现符合各平台规范，但"两端对齐 + 居中"语义完全一致。**

---

> **Component plan 的布局语义 = 原则 #10 在组件层的具体落地：定义"做什么"，让各端决定"怎么做"。**
"""
CONFIG_UPDATE = """# Architecture 规约更新说明

> 本次把「统一语义 + 原生实现」作为**全局第 10 条设计原则**显式化。

---

## 更新内容

### 新增原则 #10

在 Architecture 规约的「设计原则」章节新增：

```markdown
## 原则 #10：统一语义 + 原生实现 (Semantics Unified, Implementation Native)

Proteus 不自己实现任何端的能力，只定义"统一语义"，再映射到各端最强原生实现。

- 语义层：定义跨端一致的语义契约（p-flex / pg-glass / api/*）
- 映射层：Compiler IR → 平台 API 调用
- 原生层：平台系统完成渲染

适用范围：布局、玻璃、导航、主题、动画、手势、字体、无障碍——全部能力域。

反例（禁止）：
- 引入 Skia/Canvas 自绘 UI
- 引入 Yoga 做跨端布局
- 用 WebView 套壳渲染 App
- 自己实现系统能力（手势/导航/无障碍）
- 硬编码像素值追求像素一致
```

### 新增全局铁律 #10（对齐 Memory 文档体系）

```
G-10: 框架定义统一布局语义，各端用原生方式实现。
      不允许引入跨端自绘布局引擎。
      语义一致优先于像素一致。
```

### 全景图更新（Layer 6: 语义层）

```
Layer 0: 业务层 (SFC + p-* 组件 + Vue 响应式)
Layer 1: 语义层 (LayoutSemantics / API Semantics / GlassSemantics) ← 本次新增
Layer 2: Compiler (SFC → IR + AOT)
Layer 3: 运行时 (Renderer + Reactivity + Scheduler)
Layer 4: 平台适配 (Web DOM / Skyline WXML / App Native View)
Layer 5: 宿主环境 (Browser / WeChat / iOS / Harmony / Android)
Layer 6: 基建 (CLI / DevTools / Testing / CI)
Layer 7: 横切 (Security / i18n / Glass / Memory / Performance)
```

---

## 影响范围

| Plan | 变更 |
|------|------|
| Architecture | 新增原则 #10 + 铁律 #10 + 全景图语义层 |
| App Renderer | 新增「布局引擎归属」章节（见 app-renderer-layout.md） |
| Component | 新增布局语义规范（见 component-layout-semantics.md） |
| Glass | 已对齐（preset → 系统 API），无需修改 |
| Platform | 已对齐（L1/L2/L3 分层 = 语义分层），无需修改 |
| Memory | 已对齐（销毁语义），无需修改 |

---

> 本次是**架构自洽性更新**：把隐含哲学显式化，不产生新代码，不产生新依赖。
"""
README = """# Proteus 设计原则补充文档

> 全局设计原则 #10：**统一语义 + 原生实现**

---

## 文档清单

| 文件 | 内容 | 归属 |
|------|------|------|
| `architecture-principle.md` | 原则 #10 完整定义 + 决策背景 + 适用范围 + 对外话术 | Architecture 规约 |
| `app-renderer-layout.md` | 布局引擎归属决策 + LayoutSemantics + 映射示例 + 里程碑 | App Renderer plan |
| `component-layout-semantics.md` | 布局组件语义规范 (p-flex/p-stack/p-grid) + 映射表 | Component plan |
| `config-update.md` | Architecture 规约更新说明（原则 #10 + 铁律 + 全景图） | 基建 |

---

## 核心结论

**Proteus 不追求"一套 UI 跑三端"（像素一致），而是追求"一份语义，三端各自最美"（语义一致）。**

```
统一语义层 (Semantics)
    ↓ Compiler IR
各端原生实现 (Native)
    ↓
系统渲染管线（原生质感 + 无障碍 + 系统新特性）
```

**这条原则贯穿全部能力域**：布局、玻璃、导航、主题、动画、手势、字体、无障碍。

---

## 关键决策

- ❌ 不引入 Skia/Canvas 自绘
- ❌ 不引入 Yoga 跨端布局引擎
- ✅ 定义语义契约 → 映射系统最强原生 API
- ✅ 语义一致优先于像素一致
- ✅ 系统新特性即时可用（如 iOS 26 液态玻璃）

---

## 使用方式

1. 将 `architecture-principle.md` 内容合并进 `Architecture.md` 的原则章节
2. 将 `app-renderer-layout.md` 作为附录加入 `proteus-app-renderer-plan`
3. 将 `component-layout-semantics.md` 合并进 Component plan 的布局章节
4. `config-update.md` 作为 PR 描述参考

---

## 验证清单

- [x] 原则 #10 与 Glass plan 对齐（preset → 系统 API）
- [x] 原则 #10 与 App Renderer 对齐（JSI → Native）
- [x] 原则 #10 与 Platform 分层对齐（L1/L2/L3 = 语义分层）
- [x] 原则 #10 与 Memory plan 对齐（销毁语义）
- [x] 原则 #10 与 Performance plan 对齐（AOT/IFR 不违反原生优先）

---

> **这不是新架构，而是把隐含哲学显式化——让整个 23 份 plan 体系有一个贯穿始终的"灵魂"。**
"""

PACK_SCRIPT = """#!/bin/bash
# 打包 + 完整性校验（对齐其他 plan 的双通道交付模式）
set -euo pipefail

cd "$(dirname "$0")"
OUT="proteus-design-principle"
rm -f "${OUT}.zip" CHECKSUMS.md5

zip -q "${OUT}.zip" \
  README.md \
  architecture-principle.md \
  app-renderer-layout.md \
  component-layout-semantics.md \
  config-update.md \
  pack.sh

echo "=== 校验 ==="
unzip -t "${OUT}.zip" | tail -2

echo "=== 文件清单（md5）==="
md5sum *.md > CHECKSUMS.md5 2>/dev/null || md5 -r *.md > CHECKSUMS.md5
cat CHECKSUMS.md5

echo "=== 非空检查 ==="
find . -maxdepth 1 -name "*.md" -size 0 -print | grep -q . && { echo "ERROR: 存在空文件"; exit 1; } || echo "OK: 无空文件"

echo ""
echo "=== 完成: ${OUT}.zip ==="
"""

# ---- 写入所有文件 ----
write("architecture-principle.md", ARCHITECTURE_PRINCIPLE)
write("app-renderer-layout.md", APP_RENDERER_LAYOUT)
write("component-layout-semantics.md", COMPONENT_LAYOUT_SEMANTICS)
write("config-update.md", CONFIG_UPDATE)
write("README.md", README)
write("pack.sh", PACK_SCRIPT)

print("\nall files generated.")
