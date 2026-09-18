# App Renderer 补充：布局引擎归属

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
