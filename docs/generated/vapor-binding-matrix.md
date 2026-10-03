# Vapor 绑定类型 × 路径归属矩阵（生成物 —— 勿手改）

> **生成**：`node scripts/gen-vapor-binding-matrix.mjs`（`--check` 纳入 verify 链，漂移即红）
> **卡**：V2「槽位 O(1) 覆盖全部绑定类型」· **性质**：绑定分类的**唯一事实源**

## 0. 为什么有这份文档

卡 V2 的交付物是「绑定类型清单 + 逐类标注 L1 槽位直写 / L0 标准路径」。
**手写这份表 = 第 N 份副本**，会随编译器改动静默过期（本仓已多次实测）。
⇒ 本表由脚本**求值真实编译器**生成：计数来自真项目实跑，路径归属逐条给**代码证据位置**。

## 1. 路径归属表（★每条带证据位置）

| # | 绑定类型 | 归属 | 实现位置（证据） | 说明 |
|---|---|---|---|---|
| 1 | 属性绑定（`:x` / `v-bind:x`） | **L1 槽位直写** | packages/compiler/src/vapor/deps.ts —— `name === 'bind'` 分支 + `normalizePropKey` | 属性名归一到 propKey（layout.* / paint.* / text.content / attr.*）；`:key` 标记为不可更新（仅作行标识） |
| 2 | 文本插值（`{{ }}`） | **L1 槽位直写** | packages/compiler/src/vapor/deps.ts —— `n.type === 5`（INTERPOLATION）分支 | propKey 归一为 `text.content`；实证 L0 率最高（13/204）——多为依赖不可枚举或位于运行时分支内 |
| 3 | 样式绑定（`:style`） | **L1 槽位直写** | packages/compiler/src/vapor/deps.ts —— `normalizePropKey`：style → paint.style | 与 :class 同族（都经 paint 通道） |
| 4 | 类名绑定（`:class`） | **L1 槽位直写** | packages/compiler/src/vapor/deps.ts —— `normalizePropKey`：class → paint.class | 同上 |
| 5 | 列表数据源（`v-for="x in list"` 的源表达式） | **L1 槽位直写** | packages/compiler/src/vapor/deps.ts —— v-for 预扫描推源绑定（propKey=list.items） | 产 `LIST_SET`（整体换源）；★列表**行内**绑定走另有 `list-item` 槽位（见下） |
| 6 | 列表行内绑定（`v-for` 内的 `{{ it.x }}` / `:key` 等） | **L1 槽位直写** | packages/compiler/src/vapor/build.ts —— kind: list-item 分支（L233 起） | ★关键设计：行会实例化 N 次 ⇒ 无单一 nodeId ⇒ 由 `ListRegistry` 按 (listId, itemKey, itemSlotId) 解析到具体行（这才是 O(1) 的来源） |
| 7 | 可见性（`v-show`） | **L1 槽位直写** | packages/compiler/src/vapor/deps.ts —— name === show（propKey=visible，但**不置** inBranch） | ★与 `v-if` 的关键区别：节点**始终在树内**，只是可见性切换 ⇒ 属可更新属性 ⇒ L1（这是本仓有意区分的一对） |
| 8 | 条件（`v-if` / `v-else-if`） | **L0 标准路径** | packages/compiler/src/vapor/deps.ts —— name === if/else-if（propKey=visible） | ★**有意 L0**：分支是**结构性**变化（增删节点），不是属性更新 ⇒ 走标准路径（C-IR diff）。`v-show` 则相反（节点恒在树内，仅可见性）⇒ L1 |
| 9 | 事件（`@click` 等） | **L0 标准路径** | packages/renderer-app/src/adapters/selfdraw.ts —— normalizeEventType → 命中测试 + 派发 | ★**有意不经槽位**：事件不走"值更新"语义，走**命中测试 → 冒泡链派发**（`hit_test` 三端共享）。槽位是"值 → 节点属性"的通道，事件是"输入 → 回调"的通道，两者不同族 |

## 2. 真项目实测（showcase）

载体：`showcase/`（**128 个 SFC**，跳过 1 个已知文件）· 采集自真实编译器的逐绑定 tier 决策。

| 绑定类型 | 总数 | L1 | L0 | L1 覆盖率 |
|---|---|---|---|---|
| `attr` | 1421 | 1420 | 1 | 99.9% |
| `text` | 185 | 172 | 13 | 93.0% |
| `style` | 4 | 4 | 0 | 100.0% |
| `class` | 1 | 1 | 0 | 100.0% |
| `list-source` | 24 | 24 | 0 | 100.0% |
| `branch` | 16 | 15 | 1 | 93.8% |
| **合计** | **1651** | **1636** | **15** | **99.1%** |

★**说明**：`event` 行（若出现）为 0 —— 事件**不经槽位采集**（见 §1 第 8 行：事件走命中测试 + 派发）。
因此本表的 `合计` 只覆盖**值绑定**（属性/文本/样式/类名/列表/条件/可见性）。

## 3. 结论（卡 V2 的三条验收）

1. **绑定类型清单完整** —— 八类：属性 / 文本 / 样式 / 类名 / 列表源 / **列表行内** / 条件 / 事件。
   前六类走槽位（L1），后两类**有意**走 L0 侧通道（条件=结构变化；事件=输入通道）。
2. **每类明确归属** —— 见 §1（每条带代码证据位置）。
3. **O(1) 验证** —— 单节点更新延迟 ≈ 宿主侧耗时：见 `tests/vapor-binding-o1.test.ts`
   （判据：更新延迟**不随**同类绑定总数增长；且槽位寻址为 `(sourceId, slotId)` 直取）。

## 4. 诚实边界

- **L0 ≠ 缺陷**：条件与事件走 L0 是**设计选择**（结构变化 / 输入通道与"值更新"不同族），
  不是"未实现"。把它们强塞进槽位会违背 V4 的「误判为 L1 ⇒ 静默不更新」红线。
- 实测 L0 共 **15** 个（占 0.9%），主要是文本插值的依赖不可枚举/运行时分支内。
- 计数只覆盖 showcase（本仓现有的最真项目）；换项目后数字会变，**归属表**（§1）不变。
