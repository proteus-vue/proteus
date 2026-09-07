# 语义原语目录文档范式（Primitives Docs）

> `proteus-website-v3/` 附属文档 2/6 · 配套：G-31（语义组件/API 设计）+ G-32（128 原语完整清单）
> 本文定义 **`/primitives` 频道每一个页面必须遵守的统一结构**——这是官网与 uni-app/Taro/小程序「组件文档」的本质分野。

---

## 0. 一句话

> **竞品官网的一个组件页 =「这个标签有哪些属性」；**
> **Proteus 的一个原语页 =「这个语义是什么 × 五个后端如何各司其职 × 如何降级 × 与小程序有何不同 × 如何验证」。**

页面结构由方法论五支柱直接推导（G-31 §「五支柱在组件/API 层的具体化」），不允许多样化——**统一的页面范式本身就是「语义优先」的落地**。

---

## 1. 页面五区块（强制，不可省略）

每个原语页面必须按此顺序包含 5 个区块：

```
┌────────────────────────────────────────────────────────────┐
│ ① 语义定义（Semantics）         ← 支柱① 语义优先          │
│    · 一句话意图                                                │
│    · 属性 schema（TS 类型）                                   │
│    · IR 约束（编译期校验规则）                                 │
├────────────────────────────────────────────────────────────┤
│ ② 多后端实现剖面（Backend Implementations）  ← 支柱② 解耦  │
│    · VueDom / Native(iOS·Android·Harmony) / Flutter / Skia  │
│    · 每个后端：映射到的原生 API + 关键代码片段                 │
├────────────────────────────────────────────────────────────┤
│ ③ 降级行为（Degradation）       ← 支柱③ 验证先于运行       │
│    · Tier 1/2/3/4 各端表现                                    │
│    · @conditional 规则 + 编译期提示                           │
├────────────────────────────────────────────────────────────┤
│ ④ 小程序 / uni-app / Taro 对照（Migration Appendix）         │
│    · 来源组件/API → Proteus 原语                            │
│    · 迁移方式（直映 / 属性还原 / 组合 / 收敛私有层）          │
├────────────────────────────────────────────────────────────┤
│ ⑤ 可运行 Demo + Conformance（Proof）   ← 原则 W-4          │
│    · Playground 内联 + 代码示例                               │
│    · conformance 状态（X/48 passing）                       │
└────────────────────────────────────────────────────────────┘
```

**纪律**：
- ①②③ 顺序固定，**禁止把「小程序对照」放主体**（竞品官网的错误就是把它当主体）
- ⑤ 的 conformance 数据**必须来自 CI 自动生成**，页面不可手写（单一事实源）
- 五个区块在页面内以 `<section id>` 锚定，URL `#semantics` 等可直接跳转

---

## 2. 区块 ① 语义定义（范例：`<p-grid>`）

### 2.1 页面头部

```md
---
title: <p-grid> — 二维网格布局
category: layout
primitive-id: LAYOUT-003
tier: 1
---

# `<p-grid>`

> 语义：**按最小列宽自动分列的二维网格**。开发者描述意图（"每列至少 160px"），
> 后端决定具体实现（CSS Grid / UICollectionView / GridView / 几何计算）。
```

### 2.2 属性 schema（TS，从 component-ir.schema.json 自动生成）

```ts
interface PGridProps {
  /** 最小列宽（px）。列数 = floor(容器宽 / minColWidth) */
  minColWidth: number          // required, > 0
  /** 最大列数上限 */
  maxCols?: number             // ≥ 1
  /** 行列间距 */
  gap?: number | [number, number]
  /** 行高策略 */
  autoRows?: 'auto' | 'fixed' | number
}
```

### 2.3 IR 约束（编译期校验，编译透明）

```
IR.Node(kind: 'layout.grid') {
  minColWidth > 0            → 否则 error: "minColWidth must be positive"
  maxCols ≥ 1                → 否则 error
  minColWidth * maxCols < 容器宽  → warn: "maxCols unreachable"
  子节点数 ≤ 1000            → 否则 warn: "consider virtual list (<p-list>)"
}
```

**这些约束在 Compiler 阶段（G-29）强制**，违反即构建失败，而非运行时表现不一致——这是支柱③「验证先于运行」的具体兑现。

---

## 3. 区块 ② 多后端实现剖面（核心差异化内容）

**这是竞品组件文档完全没有的区块**，也是「可插拔架构」的可视化证据。

```md
## Backend Implementations

### VueDomBackend
\`\`\`css
/* 编译产物 */
.p-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
\`\`\`
→ Compiler 将 `minColWidth` 转为 CSS `minmax()`。

### NativeBackend (iOS)
映射：`UICollectionView` + `UICollectionViewCompositionalLayout`
\`\`\`swift
let item = NSCollectionLayoutItem(...)
item.contentInsets = NSDirectionalEdgeInsets(...)
let group = NSCollectionLayoutGroup.horizontal(...)
group.interItemSpacing = .fixed(gap)
\`\`\`
→ `minColWidth` → `NSCollectionLayoutDimension.fractionalWidth(1.0 / cols)`

### NativeBackend (Android)
映射：`RecyclerView` + `GridLayoutManager`（或 LazyLayout `StaggeredGrid`）
\`\`\`kotlin
val layout = GridLayoutManager(ctx, cols)
recyclerView.layoutManager = layout
\`\`\`

### NativeBackend (HarmonyOS)
映射：`Grid` 组件 + `GridItem`
\`\`\`ts
Grid() { ForEach(items, item => GridItem() { ... } ) }
  .columnsTemplate('1fr '.repeat(cols).trim())
\`\`\`

### FlutterBackend
映射：`GridView.builder` + `SliverGridDelegateWithFixedCrossAxisCount`
\`\`\`dart
GridView.builder(
  gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: minColWidth),
  ...
)
\`\`\`

### SkiaBackend
映射：几何计算 + `SkCanvas::drawRect`
\`\`\`cpp
for (int i = 0; i < count; i++) {
  auto cell = computeCell(i, minColWidth, gap, width);
  canvas->drawRect(cell.rect, paint);
}
\`\`\`
```

**关键叙事**：五个后端**实现机制完全不同**（CSS / CompositionalLayout / LayoutManager / Grid / GridView / 直接绘制），但**语义完全一致**——开发者只写 `<p-grid :min-col-width="160">`。

页面底部固定一行：

> **所有后端实现同一 C-IR 语义 `layout.grid`。切换 Render Backend = 换实现，不改业务代码（G-27）。**

---

## 4. 区块 ③ 降级行为（G-30 Tier 模型可视化）

```md
## Degradation

| Tier | 端 | `<p-grid>` 表现 |
|------|-----|----------------|
| 1 | Phone / Pad / PC（全能力） | 完整网格 |
| 2 | Car / TV（缺部分能力） | 保留网格，间距降为固定值 |
| 3 | Watch / 老设备（渲染受限） | **自动降级为 `<p-stack direction="vertical">` 单列** |
| 4 | Headless（SSR/Agent） | 仅产出语义 IR，不渲染 |

### 降级规则
\`\`\`vue
<p-grid :min-col-width="160">
  <p-card v-for="item in items" />
</p-grid>

<!-- Tier 3 端编译器自动重写为： -->
<p-stack direction="vertical">
  <p-card v-for="item in items" />
</p-stack>
\`\`\`

编译期提示：`[proteus] <p-grid> auto-degraded to <p-stack> on Tier 3 (watch)`。
```

**开发者不需要写条件判断**——降级由 Backend 的 `capabilities` 声明驱动（G-30），编译期完成。

---

## 5. 区块 ④ 小程序 / uni-app / Taro 对照（附录，非主体）

```md
## Migration from Mini-Program / uni-app / Taro

| 来源 | Proteus 原语 | 方式 | codemod |
|------|-------------|------|---------|
| `<view class="grid">` | `<p-grid>` | **语义还原**（消灭无语义 view） | ✅ |
| `<scroll-view scroll-x>` | `<p-scroll axis="x">` | 属性还原 | ✅ |
| `<swiper indicator-dots>` | `<p-stack snap="mandatory" loop>` | **组合还原（swiper 被消灭）** | ✅ |
| `<movable-view direction="all">` | `<p-draggable :axis="'both'">` | 属性还原 | ✅ |

> **说明**：`swiper` 不是独立组件，而是「一维排列 + 吸附 + 循环」的组合结果。
> 详见 [为什么消灭 swiper →](/docs/guide/semantic-model#no-swiper)。

### 迁移三步
\`\`\`bash
npm i @proteus/compat-miniprogram   # Step 1: 原项目直接跑
npx proteus-codemod miniprogram      # Step 2: 自动转 70-90%
# Step 3: 剩余语义还原（AI Agent G-23 辅助）
\`\`\`
```

**要点**：对照表是「承认来源」，不是「照搬 API」——标注哪些是「组合还原」（消灭 swiper 类冗余组件），这正是方法论优于「翻译派」的地方。

---

## 6. 区块 ⑤ 可运行 Demo + Conformance（证明）

```md
## Try it & Conformance

<PlaygroundEmbed
  source="<p-grid :min-col-width='160'>..."
  :render="['vuedom','native','flutter','skia']"
  :device="['phone','car']"
/>

| Backend | conformance | 版本 |
|---------|-------------|------|
| VueDom | 48/48 ✓ | 0.1.0 |
| Native (iOS) | 48/48 ✓ | 0.1.0 |
| Native (Android) | 47/48 ⚠️ `autoRows: fixed` 未实现 | 0.1.0 |
| Flutter | 46/48 🔶 beta | 0.1.0-alpha |
| Skia | 48/48 ✓ | 0.1.0 |

> 数据来源：`/backends/conformance` (CI #<build-number>，自动生成于 2026-09-02)
```

**`<PlaygroundEmbed>`** 是官网自定义组件（dogfooding）：在文档页内嵌可交互 Playground 实例，状态与 `/playground` 一致。

---

## 7. 原语目录总览页 `/primitives`

128 原语的**可搜索 + 可筛选**索引：

```
搜索框：  [  ____________ ]   筛选： [类别 ▼] [Tier ▼] [是否L1 ▼]

类别（6）：
  📐 Layout (12)        p-box / p-stack / p-grid / p-fluid / p-adaptive / p-fit / ...
  🎨 UI (18)           p-text / p-button / p-input / p-image / p-media / ...
  🧭 Shell (10)        p-nav / p-tab / p-modal / p-portal / ...
  👆 Gesture (10)      v-gesture:tap / longpress / pan / scale / ...
  ⚡ Capability (50)   useFetch / useNative / useAuth / usePayment / ...
  🔧 Engineering (28)  router.* / lifecycle / useStorage / ...

┌──────────────────────────────────────────────────────────────┐
│ <p-grid>           layout     Tier 1   L1   48/48   [Docs →] │
│ <p-stack>          layout     Tier 1   L1   48/48   [Docs →] │
│ useFetch()         capability Tier 1   L1   --      [Docs →] │
│ p-media            ui         Tier 1   L2   ...     [Docs →] │
│ ... (128 行)                                                  │
└──────────────────────────────────────────────────────────────┘

覆盖度：L1 (80%) · L2 (18%) · L3 (1.9%) · L4 (0.1%) = 100%
```

---

## 8. 生成规则（工程化，禁止手写 128 页）

**页面来源是单一事实源**：

```
proteus-semantic-primitives/
  component-catalog.md          ← G-32 128 原语定义（权威）
  component-ir.schema.json      ← IR 约束（权威）
        ↓ 构建脚本（官网 CI）
  website/src/primitives/<cat>/<id>.md   ← 自动生成 5 区块骨架
        ↓ 开发者补充
  手写内容仅限：示例 / 说明文字 / 迁移注释
```

**理由**：128 页手写不可维护且必漂移；**从 IR schema 生成骨架 + 手写增值内容**，才能保证「原语定义改一处，文档自动同步」——这是 G-32「100% 覆盖」铁律（G-32.1）在官网层的兑现。

---

*本文是 `01-website-rearchitecture.md` 的附属规范，页面范式与 G-31/G-32 / component-ir.schema.json 严格对齐。*
*Architecture: `@proteus/architecture` · Plans: G-31/32 · Status: v2 (2026-09-02)*
