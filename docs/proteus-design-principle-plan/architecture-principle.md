# 全局设计原则 #10：统一语义 + 原生实现

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
