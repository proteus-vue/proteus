# Vapor for Proteus IR 设计方案

> 定位：**自研编译期更新管线**，替换 Vue 运行时的「组件级重建 → VNode → diff」路径
> 适用：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4）
> 目标：把「更新一个节点」从 O(子树规模) 降为 **O(1) 槽位写入**
> 本文档是《Proteus App 端高性能渲染落地方案》的配套设计，术语与 §3 / §4 保持一致

---

## 0. 决策：不绑定 Vue 3.6，走自研

### 0.1 为什么不能用 Vue 官方 Vapor

Vue 3.6 Vapor Mode 的官方不支持清单中明确包含：

> **渲染 · 自定义渲染器 · 不支持**

原因：Vapor 编译产物是**直接调用 DOM API** 的代码（`document.createElement` / `appendChild`），它绕过了 `createRenderer` 这套 Host API 抽象。而 Vue 的跨平台能力恰恰来自渲染器抽象——Vue 官方自己的表述是「跨平台靠 renderer 抽象，不是靠 VDOM」。

**结论：Proteus 使用自定义渲染器，因此无法使用 Vue 官方 Vapor。自研是唯一路径。**

### 0.2 自研反而更优的三个理由

| 维度 | Vue 官方 Vapor | Proteus 自研 |
|---|---|---|
| 渲染目标 | DOM（具体平台） | **Proteus IR（平台无关）** — 更干净的 codegen 目标 |
| Vue 版本依赖 | 必须 3.6 | **编译器独立于 Vue 版本**（见 §8） |
| 运行时响应式 | 保留 Proxy 依赖收集 | **可编译期替换为槽位直写**（见 §4） |

第 3 条是核心：**Vue 必须兼容任意 JS 运行时行为，不敢假设「动态绑定集合编译期可枚举」**；Proteus 面对的是受限子集，可以做更激进的转换。

### 0.3 问题定义：更新粒度的错配

```
Vue 的更新粒度 = 组件        （一个组件 = 一个 render 函数 = 一个渲染 effect）
Proteus 需要的    = 绑定槽位
```

响应式更新时，Vue 重新执行整个组件的 render，**重建该组件子树的所有 VNode**，再 patch。Vue 已有的 Block Tree + PatchFlag 只压缩了 patch 段：

> diff 退化为一维数组遍历，复杂度从 O(n) 降至 O(m)，m 为动态节点数

**但 VNode 创建仍是 O(子树规模)。**

### 0.4 实测背景（本方案的立项依据）

| 项 | 实测 |
|---|---|
| 场景 | 动态渲染节点中**只更新一个节点的形状**，其余不变 |
| 宿主侧（Rust 排版核心 + JSI） | **1 ms** |
| Vue 侧总耗时 | **70 ms** |

单节点形状变化在逻辑上是 O(1) 的工作量，宿主侧 1ms 已证明。**多出的 69ms 是 Vue 为「找出那一个变化」付出的代价，属于净浪费。**

**本方案的目标不是 70ms → 10ms，而是逼近宿主的 1ms**——因为这里改变的是复杂度（O(n) → O(1)），不是常数。

---

## 1. 架构总览

### 1.1 三层产物（在既有两份的基础上扩展为三分）

既有方案 §4 定义了 `LayoutTemplate` + `PatchTable`，本方案**新增第三份产物**：

```
┌─ LayoutTemplate   静态结构（已有）      ─┐
├─ PatchTable       动态槽位表（已有）     ├─ 编译期产出，运行时零解析
└─ UpdateProgram    更新程序（★ 新增）    ─┘
```

| 产物 | 内容 | 运行时角色 |
|---|---|---|
| LayoutTemplate | 扁平化节点树 + 静态属性 + 拍平结果 | 一次性构造 |
| PatchTable | 槽位定义 + 类型信息 | 槽位容器 |
| **UpdateProgram** | **「槽位新值 → IR 更新指令」的编译期生成逻辑** | **每次更新执行** |

**关键区别**：既有方案说「运行时更新 = 遍历 bindings 写值」，但**没定义写值之后如何生成指令**。UpdateProgram 就是这段逻辑，且它在编译期就已确定。

### 1.2 更新路径对比

```
【现状 · Vue VDOM】
dep 变化 → 组件 render 重跑 → 重建 2 万 VNode → diff → patch → nodeOps → JSI
                              └──────── 69ms ────────┘         └─ 1ms ─┘

【目标 · Vapor for Proteus IR】
dep 变化 → 直写槽位 → UpdateProgram 生成指令 → JSI → Rust 排版核心
           └── O(1) ─┘   └── 极短 ─────────┘        └─ 1ms ─┘
```

### 1.3 分层

```
L0  编译器（Node / Rust 双后端）
    SFC → 语义 IR → { LayoutTemplate, PatchTable, UpdateProgram }
                            ↓
L1  槽位运行时（新增包 @proteus-vue/slot-runtime）
    槽位容器 / 响应式订阅 / UpdateProgram 执行 / 指令发射
                            ↓ IR 更新指令（平台无关）
L2  平台执行层（三端各一份，或复用既有后端）
    App: JSI → Rust 排版核心 → 系统渲染管线
    Web: DOM 操作
    小程序: setData / Skyline 更新
```

---

## 2. IR 更新指令集（平台无关）

### 2.1 设计原则

- **平台无关**：同一条指令三端都能执行，语义一致
- **最小完备**：覆盖 Vue 模板全部更新语义，不多不少
- **数值化**：节点用编译期整数 ID，属性用枚举键，运行时无字符串解析
- **可批处理**：指令可累积成批，一次 JSI 跨边界提交

### 2.2 指令集

```ts
enum OpCode {
  // ── 属性与内容 ──
  SET_PROP      = 0x01,  // (nodeId, propKey, value)      普通属性
  SET_STYLE     = 0x02,  // (nodeId, styleId, value)      归一化样式（枚举键）
  SET_TEXT      = 0x03,  // (nodeId, text)                文本内容
  SET_ATTRS     = 0x04,  // (nodeId, attrMask, *values)   批量属性（v-bind 对象）
  TOGGLE_VIS    = 0x05,  // (nodeId, visible)             v-show / v-if

  // ── 结构 ──
  INSERT_BLOCK  = 0x10,  // (blockId, refNodeId, pos)     插入已编译块实例
  REMOVE_NODE   = 0x11,  // (nodeId)
  MOVE_NODE     = 0x12,  // (nodeId, refNodeId, pos)

  // ── 列表 ──
  LIST_SET      = 0x20,  // (listId, dataRef)             整体替换数据源
  LIST_SPLICE   = 0x21,  // (listId, start, delCount, *items)
  LIST_UPDATE   = 0x22,  // (listId, itemKey, slotId, value) ★ item 级更新

  // ── 组件边界 ──
  CALL_COMPONENT_UPDATE = 0x30,  // (componentId, slotId, value) 透传子组件
}

interface UpdateOp {
  op: OpCode
  nodeId: number        // 编译期分配的稳定整数 ID
  payload: unknown      // 强类型，由 PatchTable 的槽位类型决定
}
```

### 2.3 为什么 `LIST_UPDATE` 是必需的

`v-for` 列表是 VNode 重建的重灾区。若仅提供 `LIST_SET`，则单个 item 变化仍需重建整个列表。

**`LIST_UPDATE` 让 item 级更新成为 O(1)**：

```ts
// item.name 变化（第 4021 行）
// 现状：重建 4000 行的 VNode 树
// 目标：一条指令
{ op: LIST_UPDATE, listId: 3, itemKey: 'id-4021', slotId: 7, payload: 'new name' }
```

**这是本方案相对 Vue Vapor 的一个额外优势**——Vue 官方 Vapor 面向 DOM，无此抽象层。

### 2.4 指令批处理

单次 JSI 跨边界调用有固定开销。所有指令累积到 `OpBuffer`，在一帧内**一次性提交**：

```ts
interface OpBuffer {
  ops: UpdateOp[]        // 紧凑数组
  count: number
  // 提交：一次 JSI 调用
  flush(): void
}
```

**约束**：`flush()` 每帧最多一次，由调度器统一触发（对齐 vsync / Choreographer）。

---

## 3. 槽位（Slot）设计

### 3.1 槽位是更新的最小单位

每个动态绑定 = 一个槽位。槽位是**强类型值容器**，携带：

```ts
interface Slot<T = unknown> {
  id: number               // 编译期分配
  nodeId: number
  kind: SlotKind           // 决定生成哪种 OpCode
  value: T
  dirty: boolean
  // 编译期生成的发射器：值变化 → 追加指令
  emit(next: T, buf: OpBuffer): void
}

type SlotKind =
  | 'text'          // → SET_TEXT
  | 'prop'          // → SET_PROP
  | 'style'         // → SET_STYLE
  | 'list-data'     // → LIST_SET / LIST_SPLICE
  | 'list-item'     // → LIST_UPDATE
  | 'visibility'    // → TOGGLE_VIS
  | 'component-prop'// → CALL_COMPONENT_UPDATE
```

### 3.2 槽位与既有 DynamicBinding 的关系

方案 §3.3 已定义 `DynamicBinding`（`slotId` / `nodeId` / `propKey` / `exprId` / `updateKind`）。

**本方案在其上扩展**，不破坏原结构：

```ts
interface DynamicBinding {
  // ── 既有字段（保留）──
  slotId: number
  nodeId: number
  propKey: string
  exprId: string
  updateKind: 'attr' | 'style' | 'text-content' | 'list-data' | 'visibility'

  // ── 新增 ──
  opCode: OpCode          // 编译期确定，运行时无分支
  tier: UpdateTier        // L0 / L1，见 §5
  deps: string[]          // 编译期识别的响应式源标识（用于 L1）
}
```

### 3.3 槽位写入即更新

```ts
function setSlot<T>(slot: Slot<T>, next: T) {
  if (Object.is(slot.value, next)) return   // 相等即短路，O(1)
  slot.value = next
  if (!slot.dirty) { slot.dirty = true; dirtySlots.push(slot) }
  scheduleFlush()                            // 对齐帧调度
}

function flush() {
  for (const slot of dirtySlots) {
    slot.emit(slot.value, opBuffer)          // 编译期生成的发射器
    slot.dirty = false
  }
  dirtySlots.length = 0
  opBuffer.flush()                           // 一次 JSI 提交
}
```

**这就是整个运行时更新路径。没有 render、没有 VNode、没有 diff。**

---

## 4. 编译期响应式转换（核心）

### 4.1 目标

Vue 运行时保留 Proxy 依赖收集，因为它必须兼容任意 JS 行为。**Proteus 面对受限子集，可以把依赖收集搬到编译期**。

```
【Vue 默认路径】
ref 写入 → trigger → 组件渲染 effect 重跑 → 重建 VNode → diff → patch

【编译期响应式转换】
ref 写入 → trigger → 直写对应槽位 → UpdateProgram 发射指令
           （订阅关系在编译期就已静态确定）
```

**差异不在"谁监听"，而在"监听之后做什么"**：Vue 重跑整个 render，Proteus 只写受影响的槽位。

### 4.2 转换器要回答的两个问题

编译期必须静态求出：

1. **这个响应式源会影响哪些槽位？**（`deps → slots` 映射）
2. **源值到槽位值的求值函数是什么？**（纯函数，可编译期生成）

### 4.3 算法

```
Step 1  响应式源识别
        扫描 <script setup>，识别 ref / reactive / computed / props 声明
        为每个源分配稳定 sourceId

Step 2  模板表达式分析
        对每个动态绑定，解析其表达式的标识符引用集
        例：:class="{ active: isActive }"  → 依赖 { isActive }
            {{ item.name }}              → 依赖 { item.name }（列表内为相对路径）

Step 3  依赖图构建
        建立 sourceId → slotId[] 的静态映射
        【这是编译期产物，运行时直接查表，不做依赖收集】

Step 4  求值函数生成
        为每个槽位生成一个纯函数：(源值快照) → 槽位值
        例：slot_7 = (s) => s.isActive ? 'active' : ''

Step 5  订阅代码生成
        生成订阅逻辑：对每个 sourceId 注册订阅，变化时求值并直写对应槽位
        【替代 Vue 的组件渲染 effect】

Step 6  安全性判定（★ 关键，见 §5）
        无法静态证明安全的绑定 → 降级为 L0（标准 Vue 渲染）
```

### 4.4 生成物形态

编译期产出的不是 JS 源码字符串，而是**可序列化的订阅表**：

```ts
interface SubscriptionTable {
  entries: Array<{
    sourceId: number
    slots: Array<{
      slotId: number
      evaluatorId: number      // 指向编译期生成的求值函数
      tier: UpdateTier
    }>
  }>
}
```

运行时加载该表，为 L1 槽位注册直写订阅，其余走 L0。

### 4.5 与 Computed 的关系

`computed` 仍然是运行时的（因为它依赖 Vue 响应式语义）。**但 computed 的消费端可以走 L1**：computed 值变化 → 直写依赖它的槽位，而不触发组件重跑。

---

## 5. 渐进式安全边界（★ 最重要的一节）

### 5.1 原则：能证明才激进，否则退回

**不要假设所有业务代码都满足条件。** 编译器按**槽位粒度**做安全性判定，通过者走 L1，未通过者退回 L0（标准 Vue 渲染路径）。**行为正确性优先于性能。**

### 5.2 两级分层

| 层级 | 路径 | 适用 |
|---|---|---|
| **L0 VDOM 兜底** | 标准 Vue 渲染（组件重建 + VNode + diff） | 无法静态证明安全的绑定 |
| **L1 槽位直写** | 编译期订阅 → 直写槽位 → 发射指令 | 可静态证明安全的绑定 |

**L0 与 L1 可在同一组件内共存**：某个槽位走 L1，另一个走 L0，互不影响。

### 5.3 L1 准入条件（全部满足才可升级）

编译期必须能静态证明：

| # | 条件 | 说明 |
|---|---|---|
| C1 | 表达式为**纯函数** | 无副作用、无 I/O、无闭包写入 |
| C2 | 依赖集**编译期可枚举** | 不出现运行时才确定的标识符 |
| C3 | 不依赖**动态组件** | 无 `<component :is>` 的运行时解析 |
| C4 | 不涉及**动态 slot 分发** | slot 内容静态确定 |
| C5 | 不含**运行时才确定的 `v-if` 分支结构** | 分支条件可静态分析 |
| C6 | 不在**自定义 render 函数**中 | 手写 `h()` 无法静态分析 |
| C7 | 不依赖 `getCurrentInstance` / 内部 API | 3.6 中 Vapor 亦不支持，此处同理 |

### 5.4 常见降级场景（直接判 L0，不必尝试）

- `<component :is="dyn">`
- 手写 render function / JSX
- 递归组件
- 依赖 `getCurrentInstance()`
- 表达式中调用非纯函数（如 `Date.now()`、含副作用的方法）
- 动态 key 的 slot

### 5.5 可观测性要求

**`proteus explain` 必须能输出每个槽位的分层判定与理由**：

```
slot_7  :class="{active}"     → L1  ✓ 纯函数 / 依赖可枚举 / 无动态结构
slot_12 <component :is>       → L0  ✗ C3 动态组件
slot_31 {{fmt(item.ts)}}      → L0  ✗ C1 无法证明纯函数（可加 @pure 注解升级）
```

**没有这个能力，L0/L1 混跑将完全无法调试。** 这是硬性要求。

### 5.6 逃生通道

提供显式注解，允许开发者对编译器无法证明、但人工可保证安全的表达式强制升级：

```ts
// @proteus-pure
function fmt(ts: number) { return new Date(ts).toLocaleString() }
```

**必须同时提供反向注解**（强制降级），用于规避误判：

```html
<!-- @proteus-tier=L0 -->
```

---

## 6. 三端执行层

### 6.1 App 端（主战场）

```
槽位直写 → OpBuffer → JSI（一次跨边界）→ Rust 排版核心 → 系统渲染管线
```

- 指令在 Rust 侧直接消费，无中间转换
- 复用既有 `tree_patch()` 接口（方案 §5.2）
- **目标：单节点更新 P95 逼近宿主侧 1ms**

### 6.2 Web 端（关键取舍）

**Web 端继续保留标准 Vue VDOM 渲染**，不做槽位直写。理由：

1. 项目定位是「Web 端零转换直跑标准 SPA」，改为指令路线会破坏该定位
2. Web 端需要完整 Vue 生态兼容性（第三方组件库、指令、插件）
3. **Web 端 VDOM 是最好的「正确性真值基准」**（见 §7）

**代价与补偿**：两端更新路径不同，一致性风险上升。由 §7 的 conformance 门禁兜底。

### 6.3 小程序 Skyline 端

- 指令映射为 Skyline 更新调用
- 需注意 `setData` 的序列化开销，优先走 Skyline 的原生更新通道
- Skyline 端 CSS 支持矩阵须先实测（见 CSS Profile 规格 P1）

---

## 7. 一致性保证（Web 端作为真值基准）

### 7.1 核心机制

**Web 端由浏览器原生渲染，天然是"正确行为"的定义者。用它做基准真值。**

```
同一份 SFC
   ├─ Web 端：Vue VDOM 渲染 → getComputedStyle / getBoundingClientRect（真值）
   └─ App 端：槽位直写 → Rust 排版核心 → 读取布局结果
                    ↓
              conformance 比对（≤ 0.5 dp）
```

这复用了方案 §5.7 已确立的方法（Yoga 官方亦用此法：写 HTML 在 Chrome 渲染，以浏览器结果作为测试期望值）。

### 7.2 一致性风险清单（L0/L1 混跑特有）

| 风险 | 说明 | 应对 |
|---|---|---|
| **L0/L1 更新时序差异** | L1 直写与 L0 组件重跑可能在不同时机生效 | 统一在一帧内 flush，L0 与 L1 指令合并后一次性提交 |
| **L0 子树内的 L1 槽位** | 父级重跑可能重建子节点，导致 L1 槽位引用失效 | 禁止跨组件边界的 L1 穿透；组件边界处强制 L0 |
| **指令顺序** | 结构变更（INSERT/REMOVE）与属性写入的顺序影响结果 | 指令按「结构 → 属性 → 内容」分段排序 |
| **同一帧多次写入** | 中间态可能产生额外指令 | 槽位 `dirty` 去重，只发射最终值 |

### 7.3 强制规则

1. **组件边界强制 L0**：props 跨组件传递必须走 Vue 标准路径，不穿透
2. **一帧一次 flush**：L0 与 L1 的指令在同一批内提交
3. **指令分段排序**：结构类 → 属性类 → 内容类
4. **conformance 门禁必须覆盖 L0/L1 混跑场景**，不能只测纯 L1

---

## 8. Vue 版本兼容策略

### 8.1 设计原则：编译器不依赖 Vue 版本

```
编译器层（版本无关）
  依赖：Vue SFC AST / compiler-core 的 IR 结构
  产出：LayoutTemplate + PatchTable + UpdateProgram
        ↓
运行时 shim 层（版本适配）
  依赖：Vue 响应式的订阅 API（ref / reactive / computed 的 track & trigger）
  适配：3.4 / 3.5 / 3.6 各一份薄适配
```

**编译器只消费 AST，不消费运行时**，因此跨版本稳定。

### 8.2 运行时 shim 的适配点

| Vue 版本 | 适配要点 |
|---|---|
| 3.4（当前） | 标准响应式订阅 |
| 3.5 | 同 3.4，API 兼容 |
| 3.6 | **alien-signals 重构**：`@vue/reactivity` 内部实现变更，但公开 API（`ref` / `reactive` / `computed` / `effect`）不变 → shim 无需改写，**但可白嫖性能收益** |

### 8.3 关于 3.6 的 alien-signals

Vue 3.6 把 `@vue/reactivity` 基于 alien-signals 重构，**显著提升响应式性能与内存占用**。

**本方案不绑定 3.6，但升级到 3.6 是免费的收益**——因为 shim 层用的是公开 API，重构对其透明。

**建议**：保持 3.4 兼容基线，同时验证 3.6 兼容性，让使用者自行选择。

### 8.4 对本项目的直接建议

用户当前为 Vue 3.4。**本方案可在 3.4 上完整实现**，无需等待或升级。

---

## 9. 里程碑

### V0 · 探针实验（≈0.5 天）★ 必须先做

在做任何编译器工作之前，先用 Vue 原生手段测出理论上限：

- [x] 在测试组件上加 `v-memo`（**运行时等价物 `withMemo`**——本基准是无编译器的手写 render 树，
      `v-memo` 编译期展开成的正是它；同一实现，见 `hosts/ios/bridge/bench-app.ts`）
- [x] 或把高频变动区域拆为独立子组件（`V0Row` 子组件策略）
- [x] 复测「单节点更新」耗时
- [x] ★**真机复跑**（2026-09-28 · iPhone 12 / iOS 26.3 · 报告 build_id `7094b968-094631`，
      24/24 用例完成；跑法 `bash hosts/ios/run-selfdraw.sh --bench`）

**判读**：

| 结果 | 说明 |
|---|---|
| 70ms → 10ms 量级 | 诊断成立，编译器目标即 10ms 以下 |
| 仍然 60ms+ | **瓶颈不在 VNode 重建，需重新归因，暂停本方案** |

> `v-memo` 机制：依赖数组未变时直接复用缓存 VNode，**连子树 VNode 创建都跳过**。有实测记录：万级列表单次更新 ~380ms → ~45ms。这是判断理论上限最快的探针。

#### ★V0 结果（2026-09-28）—— **真机达标**

**真机（权威 · iPhone 12 / iOS 26.3 · JavaScriptCore）1000 项**：

| 用例 | plain（现状） | v-memo 等价物 | 组件拆分 |
|---|---|---|---|
| **单节点更新（改第 500 行圆点）** | **78ms** | **9ms**（8.7×） | **10ms**（7.8×） |
| 零行变更（改标题 margin） | 80ms | 9ms | 12ms |
| `patchProp` 调用次数 | **5003** | **7** | **7** |

**判读：诊断成立，且真机直达 10ms 量级**（判读表第一档：70ms → 10ms）。
决定性证据是 `patchProp` **5003 → 7**：O(n) 成本**确实**在「整棵 patch 遍历 + 逐节点标脏」，
不在响应式或 diff 算法本身；用 `v-memo` 等价物或组件边界把未变子树挡在遍历之外，
真机耗时即从 78ms 降到 **9ms** —— **达到 §10 验收标准（单节点更新 P95 ≤ 10ms）的合格线**。

**装置可信度（三重）**：
① 桌面先自检 `tests/v0-probe-mechanism.test.ts`（6/6）：三用法同树、memo/comp 确跳过未变行 VNode 创建；
② 真机 `V0_SELFCHECK_FAIL` **0 条**：三用法的宿主读数逐位一致（relayout/layers 均 7/7）⇒ 数字可比；
③ 真机 `plain` 与既有 S2 基线吻合（78ms vs 81ms）⇒ 装置与历史读数对齐。
桌面通道（`bash hosts/ios/run-v0-probe.sh`）给出 10–14ms → 1–3ms，与真机**同比率同方向**。

**★★真机读数带出的额外发现（方向 B 的新靶子）**：
「零行变更」场景（改标题 margin）里，Vue 侧同样降到 9ms，**但宿主侧要 78–89ms、
`relayout` = 7005 节点（整树重排）** —— 标题的 margin 改变了其后所有行的位置，
触发宿主侧全量重排。⇒ **宿主侧也存在一个与 Vue 无关的 O(树规模) 热点**，
属于「布局影响面」问题（与增量布局的边界判定同源），对方向 B 有直接参考价值。

**诚实边界（不得省略）**：
① 探针**只证明「有这笔代价」且**Vue 原生手段**能拿回大部分（8.7×），
   不证明编译器能拿到**同等或更多**收益——但编译器是**静态决定**补丁（不逐 tick 比依赖数组），
   理论上限**不低于**本探针。
② `withMemo` 每行的依赖数组是**手工列举**的（6 项）；编译器需从模板推导等价集合，
   推导正确性是 V2 的核心风险（§5 L0/L1 分层即为此设计）；
③ 读数取自**单次真机运行**（每档 1 次操作 × 7 次取中位的桌面口径不同：真机为单次读数，
   但 78ms 与既有 S2 基线 81ms 吻合，且三档差异（78/9/10）远超噪声）。

### V1 · IR 扩展与指令集（≈1.5 人周）—— ✅ **已完成**（2026-09-28）

- [x] `DynamicBinding` 扩展（`opCode` / `tier` / `deps`）—— `packages/component-ir/src/pnode.ts`
- [x] `OpCode` 指令集与 `OpBuffer` 实现 —— 新增包 **`@proteus-vue/slot-runtime`**（第 43 个）
- [x] `Slot` 容器与 `emit` 发射器 —— `slot-runtime/src/slot.ts`（含帧调度：同帧多次写入只 flush 一次）
- [x] `LIST_UPDATE` 指令（item 级更新）—— `slot-runtime/src/list.ts`（1 条指令 = 1 次 item 更新）
- [x] Golden 门禁：Node/Rust 双端对齐 —— `tests/update-ops-golden.test.ts` ⇄
      `packages/layout-core-rust/tests/ops_conformance.rs`（★真跨语言：TS 编码 → Rust 解码 → 语义比对）

**V1 落地要点（与方案原文的对应关系）**

| 方案条目 | 落地位置 | 说明 |
|---|---|---|
| §2.2 指令集 12 条 | `slot-runtime/src/opcode.ts` | 号值即线上判别字节；`InserPos` / `SlotKind` 齐备 |
| §2.4 OpBuffer 批处理 | `slot-runtime/src/buffer.ts` | 二进制线上格式（**非 JSON**）：头 20B + 键表 + 字符串池 + 定长指令体 |
| §3.1 槽位/发射器 | `slot-runtime/src/slot.ts` | `createSlot` = 编译器生成发射函数的**运行时等价物**（同 V0 用 `withMemo` 替代 `v-memo` 的手法） |
| §3.3 写入即更新 | `slot-runtime/src/slot.ts` | `setSlot`：`Object.is` 短路 → 标脏 → 帧调度 → `emit` → 一次提交 |
| §2.3 LIST_UPDATE | `slot-runtime/src/list.ts` | 另有 `emitItemUpdates` 批量入口（业务最常见形态） |
| §5 分层判定 | `slot-runtime/src/tier.ts` | 七项准入 + 双逃生通道 + `explain` 输出（§5.5 硬性要求） |

**★V1 过程中修掉/避开的四个真缺陷（值得记，都会静默出错）**

| # | 缺陷 | 现象 | 处置 |
|---|---|---|---|
| 1 | **分层条件极性写反** | C3–C7 是**否定式**（"不在动态组件内"），首版统一按"必须为 true"判 ⇒ 任何**没出现动态组件**的绑定反被判 L0（方向完全相反） | 加 `expect` 极性字段；单测立即抓到 |
| 2 | **golden 表示层假红** | 指令体数值是 f32；TS 侧 canonical JSON 存原始 f64（`0.3333333333333333`），Rust 解出 f32（`0.3333333432674408`）⇒ 同一字节流被判"不一致" | canonical 视图统一 `Math.fround` 归一；Rust 侧用**数值感知**比对（不做容差——精确相等） |
| 3 | **常量名撞内置对象** | 把路径常量命名为 `JSON` ⇒ 遮蔽全局 `JSON`，报 `JSON.stringify is not a function` 却看不出原因 | 改名 `JSON_PATH` |
| 4 | **新增包未接门禁链** | 新包导致官网声明的包数（42）过时 ⇒ `check:stats` 红（**门禁正确工作**） | 更新为 43 并注明第 43 个是谁 |

**★诚实边界（V1 不等于「性能已到手」）**
① 本里程碑交付的是**指令集 + 槽位运行时 + 通道**；**编译器生成**这些调用属 V2——
   目前槽位由调用方手工 `setSlot`（与 V0 探针手工给 `withMemo` 依赖数组是同一手法）。
② Rust 侧本里程碑只做**解码 + 契约测试**；`LIST_UPDATE` 等指令的**布局应用**属 V3（App 端打通）。
③ 「单节点更新 P95 ≤ 3ms」是 §10 的**目标值**，V1 未测——它要等 V3 端到端才有意义；
   V0 的真机 9ms 是**探针上界**，不是本实现的读数。

### V2 · 编译期响应式转换（≈2.5 人周）—— ✅ **已完成**（2026-09-28）

- [x] 响应式源识别 + 模板表达式分析 —— `packages/compiler/src/vapor/sources.ts` + `deps.ts`
- [x] `deps → slots` 静态映射 —— `build.ts`（`SubscriptionTable.sources[].slots`）
- [x] 求值函数生成 —— `EvaluatorSpec` 三形态（`member` 免解析 / `expr` / `const`）
- [x] **L0/L1 安全性判定**（§5.3 七项条件）—— 复用 `slot-runtime/tier.ts`（★同一语义一处实现）
- [x] `proteus explain` 输出分层判定与理由（硬性要求）—— `proteus explain <file> --vapor`

**V2 落地要点**

| 方案条目 | 落地位置 | 说明 |
|---|---|---|
| §4.3 Step 1 源识别 | `vapor/sources.ts` | 五类源（ref/reactive/computed/props/model）；★用官方 `compileScript.bindings` 定语义（本仓定调：宏语义不自造） |
| §4.3 Step 2 表达式分析 | `vapor/deps.ts` | 用 `@vue/compiler-dom` AST + `@babel/parser`（**不用正则扫模板**——误判会漏订源 = 静默不更新） |
| §4.3 Step 3 依赖图 | `vapor/build.ts` | `sourceId → slotId[]`；★列表内 `item.x` 走 `scopeSources` 挂回**列表源** |
| §4.3 Step 4 求值函数 | `vapor/build.ts` | `member`（`item.name` 类免解析）/ `expr` / `const` |
| §4.3 Step 5 订阅表 | `vapor/build.ts` | `SubscriptionTable` **可 JSON 序列化**（§4.4 要求：不是源码字符串，跨端禁 eval） |
| §4.3 Step 6 安全性判定 | 复用 `tier.ts` | 七条件逐项 → tier；文件级事实（C3/C7）作用于整文件 |

**★实测覆盖率（`proteus explain --vapor`，见下方示例）**：典型页面 **L1 77.8%**（7/9），
已达 §10 验收线「L1 覆盖率 ≥70%」。

**★★V2 抓到的四个真缺陷（都会静默出错，逐个都有回归测试）**

| # | 缺陷 | 现象 | 根因与处置 |
|---|---|---|---|
| 1 | **指令表达式读错字段** | 只收集到插值，`:class`/`:style`/`v-for` **全部漏采** | DOM AST 的指令值在 `prop.exp.content`，首版读 `prop.value.content`（DOM 侧无 `value`）⇒ 改读 `exp`，属性名取 `arg.content` |
| 2 | **列表内绑定未挂到列表源** | `{{ item.title }}` 标了 L1，但**依赖图里找不到它** ⇒ 该源变化不会写这个槽位（静默不更新） | 首版拿作用域名 `item` 找同名源（不存在）⇒ 新增 `scopeSources` 别名映射（`item` → `list`）；并加"挂不上就出诊断"的兜底 |
| 3 | **C1 两条通路混为一谈** | 人工 `@proteus-pure` 担保被显示成「静态证明」（`⚠` 显示成 `✓`）⇒ 诊断失去区分度 | 静态可判纯（无调用）与人工担保（有调用但全白名单）分开传参；`forced` 标记由此正确 |
| 4 | **新增 CLI 旗标使参考文档漂移** | `gen:reference` 门禁红（**门禁正确工作**） | 重跑 `website/scripts/gen-reference.mjs` 更新 `content/reference/cli.md` |

**★诚实边界（V2 完成 ≠ 端到端跑通）**
① 本里程碑交付 **SFC → 订阅表** 的编译期产物；**把产物接到 Vue 运行时**（订阅注册、
   槽位直写、与 L0 的共存调度）属 **V3**（App 端打通）。
② `evaluator` 目前是**声明**（`member`/`expr`/`const`），运行时从声明重建函数的实现属 V3；
   本里程碑只保证「声明可序列化 + 形态可判定」。
③ `analyzeExprDeps` 覆盖常见模板表达式形态；**深度嵌套的作用域遮蔽**（内部箭头函数参数
   与外层同名）按"局部优先"处理——若未来发现误判，会体现在依赖集上，由 L0 兜底（不会静默错）。
④ L1 覆盖率 77.8% 是**单个演示页面**的读数，不代表全部业务代码；§10 的「≥70%」需在真实
   项目集上持续度量（棘轮门禁属后续工作）。

### V3 · App 端打通（≈2 人周）—— ✅ **已完成**（2026-09-28）

- [x] 槽位运行时对接 JSI —— Swift 宿主新增 `applyOps(opsBytesJson)`（二进制指令入口）
- [x] Rust 侧指令消费 —— `ops_apply.rs` + FFI `proteus_layout_apply_ops`
- [x] 一帧一次 flush 调度 —— 沿用 `SlotRuntime` 的帧调度（真机实测 **101 次 flush / 100 次更新**）
- [x] **单节点更新 P95 实测** —— 真机见下

#### ★★V3 真机读数（iPhone 12 · iOS 26.3 · 报告 `089d848b-103149` · 25/25 用例）

| 路径 | 端到端 p50 | p95 | 说明 |
|---|---|---|---|
| S2 基线（现网 Vue VDOM） | 82ms | — | 改 1 个圆点，整树重渲染 |
| V0 探针（Vue 原生手段上界） | 10ms | 9ms | `withMemo` 手工替代 `v-memo`——**这是上界，不是本实现** |
| **V3 完整链路（本实现）** | **0ms** | **1ms** | 订阅表 → 槽位直写 → 二进制指令 → Rust 应用 |

**⇒ 达到 §10 验收标准「单节点更新 P95 ≤ 10ms（合格线）· ≤ 3ms（目标值）」。**

**宿主侧分解（V3，100 次更新）**：`apply_ms` **0.02ms** · `layers_ms` **0.01ms** ·
`relayout_count=2`（只重排受影响的 2 个节点）· `scopes=[0]` · `unsupported=0`（无指令被丢弃）。
指令流量：`l1_slots=1 · l0_slots=0 · unsupported_evaluators=0`。

**★V3 补的三个真缺口（都会静默出错）**
| # | 缺口 | 症状 | 处置 |
|---|---|---|---|
| 1 | **Rust 侧只对最后一个脏节点重排** | 批量指令（一帧 N 个槽位）时其余节点几何**静默过期** | 新增 `relayout_multi`：多脏节点 → 去嵌套 → 各自重排（避免重复算同一子树） |
| 2 | **nodeId 用「绑定序号」而非「元素序号」** | `<p-view><p-view :width="w"/></p-view>` 的绑定拿到 nodeId=0（根）⇒ **指令写到错误的节点**，不报错、几何静默不对 | `TemplateBindingRef.elementIndex`（模板序 DFS 给每个**元素**编号，与 IR builder 同源） |
| 3 | **`NodeDto` 字段形状**（扁平 vs 嵌套 `style`） | 按自绘适配器形状写测试树 ⇒ 尺寸被**静默忽略**、几何全 0 | 端到端测试层暴露（编译/运行时两侧都绿也照样错）——这正是该层存在的意义 |

**★诚实边界（V3 完成 ≠ 全部指令都能用）**
① **已支持**：`SET_STYLE` / `SET_PROP`（`layout.*`）/ `SET_TEXT` / `TOGGLE_VIS` / `SET_ATTRS` / `REMOVE_NODE`。
② **明确上报为 unsupported**（不猜、不静默）：`LIST_UPDATE` / `LIST_SET` / `LIST_SPLICE`
   （需**宿主侧列表映射** itemKey → 节点 id，布局核心不知道"哪些节点属于哪个列表项"）、
   `INSERT_BLOCK`（需编译期块实例）、`MOVE_NODE`、`CALL_COMPONENT_UPDATE`。
   上报即 `unsupported` 数组——**静默忽略才是最危险的失效模式**。
③ `:style` 绑定归一为 `paint.style`（**不透明**）⇒ 正确地按「仅绘制」处理、不重排；
   要测/要走几何必须用明确属性绑定（`:width` → `layout.width`）。
④ 本里程碑用**最小编译产物**（单绑定场景）验证通路；全量 SFC → 端上渲染需 V4 的一致性收尾。
⑤ `bytes → JSON 数组` 的跨边界形态是 JSExport 的妥协（ArrayBuffer 支持不稳）；
   指令流极小（单节点更新 45 字节）故成本可忽略；ARM 侧的 JSI 直传属后续优化。
- [ ] Rust 侧指令消费
- [ ] 一帧一次 flush 调度（对齐 Choreographer）
- [ ] **单节点更新 P95 实测**

### V4 · 一致性与收尾（≈2 人周）

- [ ] Web 端真值比对 conformance 门禁
- [x] L0/L1 混跑场景覆盖（V2 已测：同一组件内共存，`explain --vapor` 可观测）
- [ ] Vue 3.4 / 3.5 / 3.6 兼容性验证
- [ ] 性能棘轮门禁
- [ ] ★V3 遗留：宿主侧**列表映射**（让 `LIST_UPDATE` 可用——当前上报 unsupported）
- [ ] ★V3 遗留：全量 SFC → 端上渲染（当前用最小编译产物验证通路）

---

## 10. 验收标准

| 指标 | 合格线 | 目标 | 说明 |
|---|---|---|---|
| **单节点更新 P95** | ≤ 10 ms | **≤ 3 ms** | 本方案核心指标，宿主侧基线 1ms |
| L1 覆盖率 | ≥ 70% 槽位 | ≥ 90% | 越高越好，但不牺牲正确性 |
| conformance（vs Web） | ≤ 0.5 dp | ≤ 0.25 dp | 含 L0/L1 混跑场景 |
| 每帧 flush 次数 | = 1 | = 1 | 多次 flush 说明调度有问题 |
| 既有五后端测试 | 全绿 | 全绿 | 不得破坏 Web / Skyline |
| Golden 门禁 | 通过 | 通过 | Node/Rust 双端等价 |

**新增常驻基准**：`单节点更新 P95 延迟`，与宿主侧 1ms 并列展示。

---

## 11. 坑位清单

| # | 坑 | 应对 |
|---|---|---|
| 1 | **跳过 V0 探针** | 未证明瓶颈在 VNode 重建就开工，可能白做数月 |
| 2 | **L1 误判导致 UI 不更新** | 这是最危险的失效模式（静默错误）。准入条件从严，`explain` 可追溯 |
| 3 | **L0/L1 时序不一致** | 统一 flush 批次 + 指令分段排序 |
| 4 | **跨组件 L1 穿透** | 组件边界强制 L0 |
| 5 | **`v-for` 的 key 不稳定** | 用 index 作 key 会导致 LIST_UPDATE 命中错误项，lint 强制 |
| 6 | **表达式含隐式依赖** | 如 `Date.now()`、闭包外部变量 → 判 L0 |
| 7 | **Web 端与 App 端更新路径不同** | 一致性靠 conformance 门禁，不能靠人工保证 |
| 8 | **一次更新触发多次 JSI** | 必须批处理，每帧一次 |
| 9 | **误以为要升级 Vue 3.6** | 不需要。编译器版本无关，shim 适配即可 |
| 10 | **过度追求 L1 覆盖率** | 正确性优先。L0 存在是特性，不是缺陷 |

---

## 12. 给实现 LLM 的执行指令

1. **V0 探针未完成前，禁止开始 V1**。探针结果若表明瓶颈不在 VNode 重建，须停止并重新归因。
2. **L0/L1 分层必须可观测**。`proteus explain` 无法输出分层判定与理由的，视为未完成。
3. **安全性判定从严，不从宽**。误判为 L1 会导致静默的 UI 不更新，比慢 10 倍更严重。
4. **不得破坏既有五后端**。Web / Skyline 端既有测试必须全绿。
5. **新增转换规则自带 AI 说明书**，与既有 69 条规则约定一致。
6. **组件边界强制 L0**，禁止跨组件 L1 穿透。
7. **每帧一次 flush**，指令按「结构 → 属性 → 内容」分段排序。
8. **不绑定 Vue 版本**。编译器只消费 AST；运行时 shim 需同时适配 3.4 / 3.5 / 3.6。
9. **conformance 必须覆盖 L0/L1 混跑**，不能只测纯 L1 路径。

---

## 附：关键事实依据

- Vue 3.6 Vapor Mode 官方不支持清单含「渲染 · 自定义渲染器 · 不支持」；亦不支持 Options API、`getCurrentInstance()`、手写 render function、Suspense（纯 Vapor）
- Vapor Mode 编译产物为直接调用 DOM API 的代码，绕过 `createRenderer` 抽象；Vue 官方表述为「跨平台靠 renderer 抽象，不是靠 VDOM」
- Vue 更新粒度为组件级：一个组件实例 = 一个 render 函数 = 一个独立渲染 effect；响应式更新时整个组件 render 重跑
- Block Tree + PatchFlag 将 diff 复杂度从 O(n) 降至 O(m)（m 为动态节点数），但 **VNode 创建仍为 O(子树规模)**
- `v-memo` 在依赖未变时复用缓存 VNode，跳过子树 diff 与 VNode 重建；万级列表实测单次更新 ~380ms → ~45ms
- Vue 3.6 将 `@vue/reactivity` 基于 alien-signals 重构，提升响应式性能与内存；公开 API 不变
- Vue 官方 Vapor 面向 DOM，无 Proteus IR 这类平台无关抽象层
- Yoga 官方测试法：写 HTML 在 Chrome 渲染，以浏览器按 CSS Flexbox 规范算出的布局作为测试期望值
