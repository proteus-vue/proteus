# G-41 宿主接入契约与 Vue 绑定架构

> **Proteus Planning System · 第 41 号规划**
> 状态：Draft v1 · 依赖：G-27/G-28/G-29/G-30/G-31/G-32/G-38/G-39/G-40
> 编号段：铁律 `G-41.1`–`G-41.6`，补充规则 `CMP051`–`CMP058`（避让 G-40 的 `CMP044`–`CMP050`）

---

## 1. 这份文档回答什么

前面 G-27（渲染后端）、G-38（编译器）、G-39（宿主运行时）、G-40（执行载体）分别定义了**单个插槽的插头形状**。但有一个问题从没有人回答过：

> **一个宿主（比如一个 iOS App）到底怎么把 Proteus 接进去？接完之后，开发者始终写 Vue，为什么换渲染引擎时 Vue 代码能一行不改？框架和宿主各自该干什么、不该干什么？**

这三个问题分别是：

| 缺口 | 本文对应章节 |
|------|-------------|
| Vue 凭什么"始终不变"且引擎可换 | §3 + `vue-binding-architecture.md` |
| 框架 vs 宿主的职责边界 | §4 + `responsibility-contract.md` |
| 宿主从零接入的完整流程 | §5 + `host-guide.md` |
| 怎么验证宿主接对了 | §6 + `host-conformance.md` |

**这份文档落地后，"任意端接入"才从"定义好了插槽"变成"有人真的能接进去"。**

---

## 2. 三方关系模型

Proteus 运行时由**三方**构成，此前文档从未把这三者放在一张图里讲清楚：

```
┌───────────────────────────────────────────────────────────┐
│  ① 框架（Proteus Core）                                     │
│     · IR 标准（Component IR / Render IR）                   │
│     · Diff 算法、响应式、调度器                              │
│     · Vue 绑定层（createRenderer + nodeOps 转发）            │
│     · 引擎选择策略                                          │
│     ★ 不碰：线程、原生 View、进程、引擎实例                  │
└───────────────────────┬───────────────────────────────────┘
                        │ nodeOps SPI（G-27）
                        ↓
┌───────────────────────────────────────────────────────────┐
│  ② 渲染引擎（RenderBackend）                                │
│     · UIKit / Android View / Flutter / Skia / Harmony / DOM │
│     · 把 IR 节点 → 原生 UI 树                                │
│     · 手势桥接                                              │
│     ★ 不碰：IR 定义、Diff、线程、生命周期                    │
└───────────────────────┬───────────────────────────────────┘
                        │ 运行在
                        ↓
┌───────────────────────────────────────────────────────────┐
│  ③ 宿主（Host）                                             │
│     · 进程 / 线程 / 事件循环（G-39 HostRuntime）             │
│     · 执行载体（JSI / AOT / WASM）（G-40 Carrier）           │
│     · 根容器（原生 View / ViewController / Activity）        │
│     · 原生能力实现（G-28 CapabilityBackend）                 │
│     ★ 不碰：IR 解析、Diff、渲染决策                          │
└───────────────────────────────────────────────────────────┘
```

**三者是"正交"的**——任意组合都应可工作：

```
宿主 × 引擎 = 6 宿主 × 6 引擎 = 36 种组合，全部应合法
（iOS + UIKit、iOS + Flutter、Android + Skia、Web + DOM、Harmony + ArkUI …）
```

这正是"插拔"的终极含义：**不是"框架支持 N 个端"，而是"宿主和引擎自由组合"。**

---

## 3. Vue 为什么能"始终不变"

### 3.1 机制：Vue 3 的 renderer 本身就是插槽化的

Vue 3 的 `@vue/runtime-core` 是**平台无关内核**，它不包含任何 DOM 代码：

```js
// Vue 3 源码里，DOM renderer 本身是这样创建的
import { createRenderer } from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
export const renderer = createRenderer({ ...nodeOps, patchProp })
```

**DOM renderer 只是"一个 Backend 实现"，不是 Vue 的本体。**

Proteus 做的事情就是：**提供另一组 nodeOps 实现，把 VNode 转成 IR 节点，再交给 RenderBackend。**

```
业务 SFC（永远不变）
    ↓ Vue 编译器（永远不变）
VNode 树（永远不变）
    ↓ ★ nodeOps（唯一的变量）
IR 节点 → ProteusRenderBackend（可插拔）
    ↓
原生 UI 树（随引擎变）
```

**所以"始终用 Vue + 自由切换引擎"的机制是：nodeOps 是唯一变量，其余全部恒定。**

### 3.2 关键决策：构造时绑定 vs 运行时转发

**这是一个此前从未定死、但会决定实现方向的细节。**

Vue 的 `createRenderer(nodeOps)` 在**构造时**就把 nodeOps 绑进 renderer 实例，**不能事后更换**。因此"换引擎"只有两条路：

| 方案 | 做法 | 同 App 多引擎混用 | 开销 | 复杂度 |
|------|------|------------------|------|--------|
| **A. 每页面一个 renderer** | 每个页面 `createRenderer(backend.nodeOps)` | ✅ 天然支持 | 每页面一个 renderer 实例（轻量） | 中 |
| **B. 全局 renderer + 转发层** | 全局 nodeOps 内部持有 `currentBackend`，方法调用时转发 | ✅ 支持（切换 `currentBackend`） | 一次间接调用 | 低 |

**G-41 的选型：方案 B 为主，方案 A 为辅。**

理由：

1. 方案 B 的 `currentBackend` 转发只有一次间接调用开销，可忽略
2. 方案 B 让"热切换"成为一个赋值操作（`switchBackend(b)`），DevTools 可实时切换
3. 方案 A 在"同一页面内需要多个引擎混合渲染"时无解（比如一个页面主体用原生、内嵌图表用 Skia）

**混合渲染场景（方案 A 无解、方案 B 天然支持）：**

```js
// 同一页面：主体走原生，内嵌图表走 Skia
<p-box>
  <p-list>...</p-list>              {/* NativeBackend */}
  <p-canvas engine="skia">...</p-canvas>  {/* SkiaBackend，同一页面内 */}
</p-box>
```

因此 G-41 采用**方案 B 的转发层**，并把它定为 `ProteusNodeOpsDispatcher`（见 `vue-binding-architecture.md`）。

### 3.3 热切换的实现

```js
// 运行时切换引擎（DevTools / 路由守卫 / 远程配置均可用）
switchBackend(createBackend('flutter'))

// 等价于
dispatcher.currentBackend = flutterBackend
// 后续所有 nodeOps 调用自动转发到新 Backend
// 已渲染的旧节点：走 Backend 的 hydrate 或重建（由 Backend 决定）
```

**这就是"开发者始终写 Vue，换引擎零改动"的完整机制。**

---

## 4. 职责边界（禁止清单）

详见 `responsibility-contract.md`，此处给出**必须死守的 6 条**：

| 编号 | 禁令 | 理由 |
|------|------|------|
| **G-41.1** | 框架**不得**直接创建线程、访问原生 View、调用平台 SDK | 否则跨端性丧失 |
| **G-41.2** | 宿主**不得**解析 IR、干预 Diff、决定渲染方式 | 否则引擎不可替换 |
| **G-41.3** | 引擎**不得**感知 Vue、响应式、SFC 的存在 | 否则引擎与框架耦合 |
| **G-41.4** | 业务代码**不得**出现平台判断或原生 SDK 调用 | 否则"一套代码"失效 |
| **G-41.5** | 业务代码**不得**假设 JS 运行时存在（复用 G-40.1） | 否则 AOT 路径不可切换 |
| **G-41.6** | 宿主**必须**在 bootstrap 前完成 Runtime + Carrier + Backend 三者注册 | 否则运行期行为未定义 |

---

## 5. 宿主接入流程（8 步）

详见 `host-guide.md`，此处给出通用流程（各平台差异见该文件）：

```
1  集成 Proteus Runtime（Swift Package / Gradle / ohpm / npm）
2  实现或选用 HostRuntime（G-39：线程模型 + 事件循环）
3  选择执行载体（G-40：JSI / AOT / WASM）
4  选择或实现 RenderBackend（G-27）
5  实现 CapabilityBackend（G-28，按需）
6  宿主生命周期挂钩（AppDelegate / Activity / onPageShow）
7  加载业务产物（G-38 CompilerBackend 产出）
8  attachToHost(根容器) + 跑 host-conformance
```

**第 8 步是硬门禁**：宿主未通过 conformance 不得上线（G-41.6）。

---

## 6. 宿主 Conformance

`host-conformance.md` 定义 **H-01 ~ H-08 共 32 项测试**，覆盖：

| 组 | 内容 |
|----|------|
| H-01 | 接入完整性（Runtime/Carrier/Backend 三者注册） |
| H-02 | 生命周期正确性（bootstrap→suspend→resume→destroy 状态机） |
| H-03 | ★ 引擎可切换性（同一 SFC 在两个引擎下渲染，IR 一致） |
| H-04 | 职责边界（宿主不解析 IR、框架不建线程） |
| H-05 | 热切换（switchBackend 后节点正确重建） |
| H-06 | 混合渲染（同页面多引擎共存） |
| H-07 | 能力契约（CapabilityBackend 声明与实现一致） |
| H-08 | 错误降级（引擎/能力缺失时的降级路径） |

**H-03 是整套架构的验收核心**——它用机器证明"同一份 Vue 代码，换引擎后行为一致"。

---

## 7. 与既有体系的协同

| Plan | 关系 |
|------|------|
| G-27 | 定义"渲染可插拔"方向；G-41 提供落地路径 |
| G-27 | RenderBackend SPI；G-41 的 nodeOps Dispatcher 是其调用方 |
| G-38 | 编译产物；G-41 第 7 步消费它 |
| G-39 | HostRuntime；G-41 第 2 步实例化它 |
| G-40 | ExecutionCarrier；G-41 第 3 步选择它 |
| G-28 | CapabilityBackend；G-41 第 5 步注册它 |
| G-31/32 | 128 语义原语；G-41 保证其在 Vue 中可用 |
| G-30 | 任意端 Tier 模型；G-41 是其"接入侧"实现 |

---

## 8. 诚实边界

| 不做 | 原因 |
|------|------|
| 不改 Vue 编译器 | Vue 编译器是稳定的公共资产，改造它收益低风险高 |
| 不要求宿主支持所有引擎 | Tier 2/3 宿主可只支持部分引擎（capabilities 声明） |
| 不承诺热切换零成本 | 切换后节点重建开销由 Backend 决定，可能是 O(n) |
| 不承诺同页面混合渲染所有组合 | 纹理共享/坐标系差异需 Backend 显式支持（G-27 已定义） |
