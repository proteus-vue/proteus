# Proteus CSS Profile 规格

> 文档版本：v1.0 · 适用框架：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4）
> 适用端：Web（浏览器原生 CSS）· 微信小程序 Skyline · App（NativeVapor 自研渲染）
> 定位：**三端共同遵守的 CSS 受支持子集**，由编译期 lint 强制，是 App 端自研渲染引擎的实现目标与一致性基准

---

## 0. 为什么需要 Profile

### 0.1 问题原点

绕开系统 UI 框架后，CSS 能力的天花板确实被打开了——浏览器本身也只是"一套 UI 框架 + 渲染管线"。但存在一个真实悖论：

**App 端现有的性能优势，部分正来自"支持的 CSS 少"。**

业界所有自研渲染引擎都在做减法，且高度一致：

| 方案 | 布局引擎 | CSS 覆盖范围 |
|---|---|---|
| React Native / Yoga | Flexbox | **刻意排除** CSS Grid 与 float |
| uni-app x（UCSS） | Yoga Flexbox | 仅 CSS 子集，**只支持 flex**；仅简单类选择器与标签选择器，**不支持复杂后代/组合选择器** |
| Satori（Vercel OG） | Yoga | display 仅 flex/none，**无 grid**；无 fixed/sticky；**无 z-index**；无选择器、伪元素、媒体查询 |

uni-app x 排除复杂选择器的官方理由：**"为了原生解析极速性能"**。

### 0.2 性能侵蚀点（量化）

浏览器为此付出的运行时成本，正是自研引擎要做完整 CSS 时必须复制的：

> 在 Blink 中计算某元素计算样式的时间，**约 50% 用于匹配选择器**，另一半用于从匹配规则构建 RenderStyle。

选择器匹配实测开销（10000 节点子树）：

| 选择器 | 耗时 | 复杂度 |
|---|---|---|
| `li` | 0.12 μs/元素 | O(1) 标签哈希 |
| `.item` | 0.15 μs/元素 | O(1) 类哈希 |
| `ul#list li` | 0.45 μs/元素 | O(n) 后代回溯 |
| `ul > li:nth-child(2n+1)` | **1.30 μs/元素** | O(n²) |

浏览器为此做的优化（按 key selector 分桶索引、从右向左匹配、计数型 Bloom filter 快速拒绝祖先匹配——后者为 WebKit 带来整体 25% 提升、后代/子选择器 2 倍提升）**全是运行时开销**。

### 0.3 破局点：编译期收敛

通用 Web 做不到、但 **Vue SFC 能做到**的关键差异：

**SFC 的样式是封闭、可枚举的。**

- 编译期可枚举全部 class 及组合，**层叠、继承、特异性在编译期算完**，运行时零成本
- 动态 class 的候选集合通常也可枚举——`:class="{ active, disabled }"` 只有 4 种组合，编译期预计算出 4 套最终样式，运行时退化为 **O(1) 查表**

**核心结论**：静态样式可以支持任意复杂的选择器与层叠规则，因为编译期就算完了。**边界只在动态部分。**

这与 Proteus 既有的"编译期优先"主张完全同构，且可直接复用 111 条规则注册表与 Rust 后端。

### 0.4 Proteus 特有的额外约束

Web 端是**零转换直跑标准 SPA**，用的就是浏览器原生 CSS。因此 App 端的目标不是"实现多少 CSS 标准"，而是**"复刻浏览器在受支持范围内的行为"**。

浏览器有大量隐含规则（margin 折叠、BFC、containing block 判定、层叠上下文创建条件……），精确复刻比"实现一个子集"难一个数量级。

**推论（反直觉）**：App 端 CSS 支持得越多，与 Web 端不一致的表面积越大。**限制在边界清晰的小 Profile 内，反而最容易做到两端真正一致。**

---

## 1. Profile 定义原则

1. **三端交集优先**：Profile 内的每一项特性，Web / Skyline / App 三端都必须有明确行为（Web 由浏览器提供，App 由自研引擎实现，Skyline 由微信容器提供）
2. **编译期能折叠的，尽量支持**：静态层叠、继承、复杂选择器属于"零运行时成本"，应放开
3. **动用运行时成本的特性，分级管控**：z-index、fixed/sticky、filter 等关联合成层与内存，默认关闭
4. **不自研文本基础设施**：字体、BiDi/RTL、emoji 复用平台能力（CoreText / StaticLayout / 平台文本栈）
5. **超出 Profile 即编译期报错**，不留到运行时静默降级

---

## 2. 三端基线对照

| 维度 | Web | Skyline（小程序） | App（NativeVapor） |
|---|---|---|---|
| 样式实现 | 浏览器原生 CSS | 微信容器 CSS | **自研渲染引擎（UCSS Profile）** |
| 选择器能力 | 完整 CSS | 需实测确认，**不支持复杂组合选择器** | 编译期折叠，运行时仅查表 |
| 层叠/继承 | 浏览器运行时计算 | 容器实现 | **编译期计算，运行时零成本** |
| 布局 | 完整（block/inline/grid/flex） | flex 为主 | **flex + grid**（★DCP-2 已定案：Grid 开放为 **L2**；Skyline 端实测退化为 block，故属「有条件可用」） |
| 单位 | px/em/rem/%/vw/vh/… | px/rpx/%，**vw/vh 通常被忽略或解析为 0** | 编译期折叠为逻辑像素或比例系数 |

> ⚠️ Skyline 端的具体支持矩阵需以真机实测为准，本文不预设细节。Profile 落地前必须补齐 Skyline 实测表。

---

## 3. 特性分级：L0 – L5

### L0 · 零运行时成本（全支持）

> 判定标准：编译期可完全折叠，运行时无匹配、无层叠、无继承计算。

| 特性 | 说明 |
|---|---|
| **任意复杂选择器** | 后代、子、兄弟、属性、伪类（静态部分）。编译期完成匹配 |
| **层叠（Cascade）** | origin & importance → `@layer` → specificity → source order，完整五级层叠算法 |
| **继承（Inheritance）** | 可继承属性沿节点树向下传播，编译期完成 |
| **特异性（Specificity）** | 完整 (a,b,c) 三元组，含 `:is()` / `:where()` / `:has()` 规则 |
| **单位换算** | em / rem / % / rpx / vw / vh → 逻辑像素或比例系数 |
| **静态伪类** | 编译期可判定的部分（如结构性伪类的静态情形） |
| **样式隔离** | scoped / CSS Modules / external-class |

**继承属性边界**（必须精确实现，两端不可有差异）：

| 可继承 | 不可继承 |
|---|---|
| color, font, line-height, letter-spacing, visibility, cursor | background, border, margin, padding, position, display |

### L1 · 低运行时成本（直接支持）

| 特性 | 说明 |
|---|---|
| background-color | 纯色背景。**必须走 backgroundColor 通道，不得进绘制流程**（见 §6 与内存专项） |
| border / border-radius（简单） | 纯绘制指令 |
| 2D transform | translate / scale / rotate |
| opacity（叶子节点） | 不创建层叠上下文的退化情形 |

### L2 · 中等成本（按需支持）

| 特性 | 说明 | 状态 |
|---|---|---|
| flex / flex-direction / justify-content / align-items | Flexbox 基础 | ✅ M1 起 |
| gap / row-gap / column-gap | — | ✅ |
| position: relative / absolute | 需 containing block 判定 | 🟡 M3 |
| overflow: hidden / scroll | — | 🟡 M3 |
| **grid** | ★**DCP-2 已定案：开放为 L2**（Taffy 已有完整 Grid）；⚠ 但 **Skyline 端实测退化为 block** ⇒ **有条件可用**：App 端可用，Skyline 端需降级为嵌套 flex | ✅ App / 降级 Skyline |
| text-overflow / max-lines 截断 | 依赖平台文本度量 | 🟡 M3 |

### L3 · 高成本（默认关闭，编译期标记，按需启用）

> ⚠️ 这些特性直接关联**合成层数量**，而 iOS 上每个合成层就是一块 backing store——与内存专项 §12 直接冲突。

| 特性 | 风险 |
|---|---|
| **z-index** | 需实现完整层叠上下文与合成层管理。**直接推高内存** |
| position: fixed / sticky | 需独立合成层与滚动同步 |
| 3D transform | 合成层 + 光栅化 |
| filter / backdrop-filter | 离屏渲染，额外缓冲区 |
| shadow（非 shadowPath 情形） | 离屏渲染 |
| will-change | 预创建合成层 |

**启用方式**：显式在 `proteus.config.ts` 声明，或组件级 opt-in。编译期对未声明的使用报错。

### L4 · 不自研（复用平台能力）

| 特性 | 策略 |
|---|---|
| @font-face / 字体回退 / 可变字体 | 复用 CoreText（iOS）/ StaticLayout（Android）/ 平台字体栈 |
| OpenType 特性（kerning / ligatures） | 同上 |
| BiDi / RTL | 同上 |
| emoji | 同上（作为字体/图形资源加载，不自研着色逻辑） |
| 复杂富文本混排 | 平台文本引擎 |

**参考**：Satori 在文本上明确认输——不支持 WOFF2、kerning、ligatures、RTL、emoji。Proteus 不应在此重复投入。

### L5 · 禁止（编译期报错）

| 特性 | 原因 |
|---|---|
| 运行时动态选择器匹配 | 无法编译期折叠 |
| 无法折叠的动态层叠 | 同上 |
| 运行时插入样式表 | 破坏封闭性假设 |
| 超出 Profile 的任意特性 | 一致性不可控 |

---

## 4. 编译期折叠算法

### 4.1 输入与输出

**输入**：SFC 的 `<template>` 节点树 + `<style>` 样式表（含 scoped 变换后）
**输出**：每个节点的 `ComputedStyle`（归一化结构，见 §4.5）

### 4.2 算法步骤

```
Step 1  样式表收集与展开
        - 展开 @import（同步展开，编译期无阻塞问题）
        - 应用 scoped / CSS Modules 变换
        - 记录每条规则的 source order

Step 2  规则索引
        - 按 key selector（最右复合选择器）分桶
          · #id   → IdRules
          · .class → ClassRules
          · tag   → TagRules
        - 复杂度从 O(节点 × 全规则) 降至 O(节点 × 相关规则)

Step 3  选择器匹配（从右向左）
        - 从 key selector 命中候选，再回溯验证祖先
        - 祖先验证可用 Bloom filter 快速拒绝（可选优化）
        - 【编译期一次性执行，运行时不再发生】

Step 4  层叠解析
        对每个节点的每条属性，按优先级排序取唯一胜者：
          1. Origin & Importance（Transition > !important UA > !important user > …）
          2. @layer 顺序
          3. Specificity (a, b, c)
          4. Source order
        - 层叠顺序在单个 @layer 内才按特异性比较

Step 5  继承传播
        - 沿节点树自上而下，可继承属性在子节点无匹配规则时继承父值
        - 显式 inherit / initial / unset 关键字在此处理

Step 6  计算值求解
        - 相对单位转为绝对值：em(父 font-size)、rem(根 font-size)、%(父对应维度)
        - vw/vh/rpx → 比例系数（运行时按视口尺寸求值）

Step 7  输出 ComputedStyle + PaintHint
```

### 4.3 关键约束

- Step 1–6 **全部在编译期完成**，产物随 LayoutTemplate 一起序列化
- 运行时**不存在** CSS 解析、选择器匹配、层叠计算、单位换算
- `proteus explain` 必须能 trace：某节点某属性的最终值来自哪条规则、经过哪几步层叠判定

### 4.4 与既有编译器的衔接

- 复用 111 条转换规则注册表，新增规则自带 AI 说明书
- Node / Rust 双后端语义等价 Golden 门禁必须继续通过
- 折叠结果需可被 Headless 后端消费，用于 conformance 比对

### 4.5 ComputedStyle 输出结构

```ts
interface ComputedStyle {
  // 布局
  display: 'flex' | 'none'          // L2；grid 见 DCP-2（App 开放 L2 / Skyline 降级）
  flexDirection: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  justifyContent: JustifyValue
  alignItems: AlignValue
  gap: ResolvedLength
  width / height / minWidth / …: ResolvedLength
  margin / padding: Edges<ResolvedLength>
  position: 'static' | 'relative' | 'absolute'   // L3 的 fixed/sticky 需 opt-in
  inset: Edges<ResolvedLength>

  // 绘制
  backgroundColor: Color | null
  border: BorderValue
  borderRadius: Corners<ResolvedLength>
  opacity: number
  transform: Transform2D | null

  // 文本
  fontSize / lineHeight / letterSpacing: ResolvedLength
  color: Color
  fontWeight / fontFamily: FontValue

  // 绘制提示（供平台层决定 backing store 策略，见 §6）
  paintHint: PaintHint
}

type ResolvedLength =
  | { kind: 'absolute'; dp: number }              // 已折叠为逻辑像素
  | { kind: 'ratio'; ratio: number; base: 'width' | 'height' | 'viewportWidth' | 'viewportHeight' | 'fontSize' }
```

---

## 5. 动态 class 组合预计算

### 5.1 朴素方案与其问题

对 `:class="{ a: x, b: y, c: z }"` 枚举 2³ = 8 种组合，为每种预计算成套样式。

**问题**：n 个动态 class → 2ⁿ 组合，n 稍大即爆炸。

### 5.2 推荐方案：按属性维度分解

**关键洞察**：不是枚举 class 组合，而是找出"**哪些属性受哪些动态 class 影响**"，对每个属性单独建小查找表。

```
对每个节点：
  1. 收集该节点上所有可能生效的动态 class 集合 D
  2. 对每个 CSS 属性 p：
     a. 找出 D 中会影响 p 的 class 子集 Dp
     b. 计算 p 在 Dp 各组合下的取值
     c. 若取值数 > 1 → 生成一张查找表 lookup[p]
        若取值唯一 → 折叠为常量，运行时零成本
  3. 运行时：按当前 class 状态位图查各属性的 lookup 表
```

**复杂度**：从 2ⁿ 降为 Σ(每个属性的不同取值数)。绝大多数属性不受动态 class 影响，会被折叠为常量。

### 5.3 互斥分组优化

对语义上互斥的 class（如 tab 的 active / inactive / disabled），编译期识别为**互斥组**，组内按 k 选 1 而非 2ᵏ。

### 5.4 爆炸保护

- 单节点动态属性查找表总数超过阈值（建议 16）→ 编译期警告，建议拆分组件
- 属性取值数超过阈值（建议 8）→ 同上
- 无法在编译期确定候选集合的动态绑定（如 `:class="someRuntimeVar"`）→ **L5 禁止，编译期报错**

### 5.5 运行时查表结构

```
节点运行时状态：classBitmap（位图，每 bit 对应一个动态 class）
属性更新：
  for p in dynamicProps[node]:
     newValue = lookup[p][classBitmap & mask[p]]
     if newValue != current: 写入 + 标记脏
```

`mask[p]` 为属性 p 实际依赖的 class 位掩码，进一步缩小查表开销。

---

## 6. 与内存专项的联动

Profile 的 L3 特性与 §12 iOS 内存专项**直接冲突**，必须联动：

| L3 特性 | 内存影响 | 管控 |
|---|---|---|
| z-index | 每个层叠上下文 → 合成层 → 一块 backing store | 默认关闭，opt-in |
| fixed / sticky | 独立合成层 | 同上 |
| 3D transform | 合成层 + 光栅化 | 同上 |
| filter / backdrop-filter | 离屏缓冲区（上限为屏幕总像素 2.5 倍） | 同上 |
| shadow | 离屏渲染，需显式 shadowPath | 拆分图层，禁用 mask |

**强制规则**：L3 特性的启用必须同步纳入内存验收（iOS 端内存增量 ≤ 原生 × 1.15）。启用 L3 而内存不达标 → 门禁阻断。

### PaintHint（编译期推导，禁止运行时判断）

```ts
interface PaintHint {
  isMonochrome: boolean       // 纯色内容 → 紧凑 contentsFormat
  isPureBackground: boolean   // 纯色背景 → 走 backgroundColor，不分配 backing store
  shareableContent?: string   // 可共享图形的资源 hash → 走 contents 共享内存
  staticSubtree: boolean      // 完全静态 → 允许拍平 / 允许光栅化
  needsCompositingLayer: boolean  // L3 特性标记 → 合成层计数
}
```

`needsCompositingLayer` 为 true 的节点，绘制层必须计入合成层预算，超限即编译期报错。

---

## 7. Lint 拦截规则

### 7.1 错误级（阻断构建）

| ID | 规则 | 提示 |
|---|---|---|
| E-CSS-001 | 使用了 L5 禁止特性 | 运行时动态选择器/动态样式表插入 |
| E-CSS-002 | 使用了未声明的 L3 特性 | 需在 config 或组件级 opt-in |
| E-CSS-003 | 使用了 Profile 外的属性 | 列出不支持的属性名 |
| E-CSS-004 | `:class` 绑定无法编译期枚举候选集 | 改为 `{ active: bool }` 对象语法 |
| E-CSS-005 | 单节点动态属性查找表超限 | 建议拆分组件 |
| E-CSS-006 | 拍平节点绑定了事件/transform | 违反 flattenEligible 判定 |

### 7.2 警告级（不阻断）

| ID | 规则 | 提示 |
|---|---|---|
| W-CSS-101 | 选择器嵌套深度 > 3 | 建议 BEM 扁平化 |
| W-CSS-102 | 使用了 `!important` | 建议改用 @layer |
| W-CSS-103 | 使用了 ID 选择器 | 特异性过高，后续覆盖困难 |
| W-CSS-104 | 单节点动态属性数接近阈值 | — |
| W-CSS-105 | 在**不支持 grid 的端**（Skyline）使用了 grid | 提供嵌套 flex 改写建议（App 端 DCP-2 已开放，不告警） |

### 7.3 lint 与 Web 端的关系（关键）

**Web 端也必须跑同一套 lint。**

Web 端由浏览器原生渲染，天然支持完整 CSS——但开发者写出 Profile 外的样式时，**App 端会不一致**。

因此：
- Web 端：浏览器照常渲染，但 lint **报错**，阻止提交
- 这样才能保证"Web 端跑通 = App 端行为一致"

这是把一致性约束前置到编译期，与 Proteus 整体主张一致。

---

## 8. 验收门禁

### 8.1 conformance 比对

同一份源码在 **Web（浏览器）/ Headless / App NativeVapor** 三端的 ComputedStyle 与布局结果必须一致。

| 比对项 | 容差 |
|---|---|
| 布局盒模型（x/y/w/h） | ≤ 0.5 dp |
| 颜色值 | 精确相等 |
| 文本度量 | ≤ 0.5 dp（跨平台字体差异另设白名单） |

**注意**：Web 端直接读浏览器的 `getComputedStyle` 与 `getBoundingClientRect` 作为**基准真值**——这是 Proteus 相对其他跨端框架的天然优势，必须利用。

### 8.2 编译期折叠正确性

- 折叠结果与浏览器 `getComputedStyle` 逐属性比对（取 100+ 真实组件样本）
- 动态 class 各组合的折叠结果，与浏览器在该组合下的实际计算值比对
- 一致率目标：**100%**（Profile 内）

### 8.3 运行时零成本验证

- App 端运行时**不得存在** CSS 字符串解析、选择器匹配、特异性计算
- 验证方法：运行时 profile，确认样式相关调用栈只有查表与写值

### 8.4 与既有门禁的关系

- 既有 Node/Rust 双后端 Golden 门禁继续通过
- 既有五后端（Headless / VueDom / Skyline / Native×3 / Flutter）既有测试全绿
- 新增 Profile 相关用例

---

## 9. 实施顺序

| 阶段 | 内容 | 依赖 | 实际状态（2026-09-28 逐项核实） |
|---|---|---|---|
| **P1** | Skyline 端 CSS 支持矩阵实测表 | 无（**必须先做**，否则 Profile 无基线） | ✅ **已完成**（2026-09-29 · **25/25 通过**）—— 证据 `showcase/subpackages/capabilities/pages/css-profile-probe.vue` + `tests/e2e-mp-css-profile-grid.test.ts` |
| **P2** | 定义 Profile v1 特性清单（L0–L5） | P1 | ✅ 本文档 §3 |
| **P3** | 编译期折叠算法实现 + Golden 门禁 | P2 | ◐ 单位折叠 ✅（`component-ir/src/pnode-style.ts`）+ Golden ✅（`tests/golden.test.ts`）；**§4 全量折叠（选择器/特异性/层叠相位）无独立实现** |
| **P4** | 动态 class 预计算（属性维度分解） | P3 | ❌ **未实现** |
| **P5** | Lint 规则（E-CSS / W-CSS） | P2 | ◐ **仅 1 条**（`pnode-analyze.ts` 的 E-CSS-006 拍平违规） |
| **P6** | Web 端 lint 接入（一致性前置） | P5 | ❌ **未实现** |
| **P7** | App 端 ComputedStyle 消费 + conformance 比对 | P3、M1 排版核心 | ◐ 契约 = `PProps`；浏览器 conformance ✅；App 消费链**部分** |

> ★**状态标注原则**（本仓纪律）：`✅ 已完成` 必须能 grep 到证据；`❌ 未实现` 不得被读成"已有设计"。

> P1 的 Skyline 实测表是**前置项**。Profile 必须是三端交集，缺了 Skyline 基线会导致后续返工。

---

## 10. 已知备选方案（供参考，不采用）

**WebF 路线**：直接集成 Blink CSS 引擎——既自研渲染管线，又复用 Chromium 的 CSS 实现，换取标准合规性与"跟随 Chromium 自动获得新特性"。

**代价**：二进制体积显著增大（含 Chromium CSS 代码）、C++ ↔ 宿主语言桥接复杂度、内联样式序列化开销。

对 Proteus 场景过重，但作为"既要标准合规又要自研渲染"的第三条路，记录在此备查。

---

## 附：关键事实依据

- Blink 中计算元素计算样式的时间约 50% 用于匹配选择器，另 50% 用于从匹配规则构建 RenderStyle
- 选择器匹配实测：`li` 0.12 μs、`ul#list li` 0.45 μs、`ul > li:nth-child(2n+1)` 1.30 μs（复杂度 O(1) → O(n) → O(n²)）
- 浏览器按 key selector 分桶索引、从右向左匹配；计数型 Bloom filter 快速拒绝祖先匹配为 WebKit 带来整体 25% 提升、后代/子选择器 2 倍提升
- 层叠判定顺序：Origin & Importance → @layer → Specificity → Source order；特异性在同一 @layer 内才生效
- 可继承属性：color / font / line-height / letter-spacing / visibility / cursor；不可继承：background / border / margin / padding / position / display
- 业界自研引擎普遍做减法：RN/Yoga 刻意排除 Grid 与 float；uni-app x UCSS 只支持 flex、仅简单类/标签选择器（官方理由"为了原生解析极速性能"）；Satori 无 grid / fixed / sticky / z-index / 选择器 / 伪元素 / 媒体查询，且不支持 WOFF2、kerning、ligatures、RTL、emoji
- 小程序端 vw/vh 常被忽略或解析为 0；跨端 flex 行为存在平台差异

---

## 端支持度矩阵（单一事实源 · VC1/VC2-d）

> **本节的判定不在此文档复制**——属性 × Web / Skyline / WebView 三端的支持度矩阵是**生成的**
> （`docs/generated/end-support-matrix.json` + 同名 `.md`），由 `scripts/gen-end-support-matrix.mjs`
> 从三个源工件（官方文档解析 / Playwright 实测 / 设备实测）产出，并有 `pnpm check:end-support`
> 漂移门禁（接 CI + verify）。
>
> 本文档对该矩阵的用法：**L3 / L5 分级依据**。
>
> 与本文件的关系：**本文件的规则口径引用该矩阵**——矩阵里 `supportTier=conditional` 的属性
> 对应本文的 L3"有条件可用"（需显式 opt-in）；`supportTier=unsupported` 对应 L5（编译期报错）。
> 矩阵更新（官方文档/实测变化）⇒ 重新生成即可，**不需要改本文件**。
>
> 边界校验（VC2-b）的实现与豁免（`proteus-allow-profile`）见 `packages/css-compat/src/profile-boundary.ts`。

