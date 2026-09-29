---
title: Vapor 更新路径
order: 43
group: 编译期
---

# Vapor 更新路径

常规 Vue 更新要在 JS 侧重建 VNode 树并逐节点比对（改 1 个元素也要走完整 diff）；Proteus 的 Vapor 路径把这件事**前移到编译期**：模板编译成「响应式源 → 槽位」的依赖图，更新时**直接写入变化的槽位**，再以二进制指令流下发到内核。

它与本组其它编译期能力的区别是**作用域**：模板/脚本/样式转换产出的是「首次渲染要什么」，而 Vapor 管的是**首次之后的每一次更新**。

| 维度 | 常规 Vue 更新 | Vapor 更新路径 |
|---|---|---|
| 变化定位 | 运行时重建 VNode + 递归比对 | 编译期已确定「源 → 槽位」依赖 |
| 下发内容 | 整棵新树的 diff 结果 | 变化的槽位指令（定长字段） |
| 受影响范围 | 由 diff 结果决定 | 由布局边界 + 槽位依赖共同决定 |

## 为什么不直接用 Vue 官方的 Vapor

Vue 3.6 也在做 Vapor Mode（编译期更新），思路同源。但**它用不了**——这是 Proteus 自研的原因，不是偏好问题。

**证据（不是传闻，可直接复验）**：`@vue/runtime-vapor` 的运行时**直接调用 DOM API**，且**没有可替换的宿主抽象**：

```
@vue/runtime-vapor 源码路径: src/dom/node.ts        ← 路径本身就是 DOM 专用
  createElement(tagName, ns)  → document.createElementNS / document.createElement
  createTextNode(value)       → document.createTextNode
  createComment(data)         → document.createComment
公开 API 签名绑死 DOM 类型: createVaporApp: CreateAppFunction<ParentNode, …>
                            createPlainElement(…): HTMLElement
                            createTextNode(value?): Text
grep -c createRenderer  →  0                       ← 没有自定义渲染器入口
```

而 Proteus 的 App 端恰恰**建立在自定义渲染器上**（`createRenderer` + 自绘指令流 / 原生视图映射）。
⇒ 两者**不兼容**：官方 Vapor 把"宿主是什么"编译死成 DOM，Proteus 需要它是可插拔的。

**自研的三点结构性优势**：

| 维度 | Vue 官方 Vapor | Proteus 自研 |
|---|---|---|
| 渲染目标 | DOM（具体平台） | **平台无关 IR** —— 更干净的 codegen 目标 |
| Vue 版本依赖 | 绑 3.6（**当前仍是 rc，未正式发布**） | **编译器独立于 Vue 版本**（Vue 3.4–3.6 产物逐字节相同） |
| 响应式转换 | 保留 Proxy 依赖收集 | **编译期换成槽位直写** |

第三条是核心：Vue 要兼容**任意** JS 运行时行为，不敢假设「动态绑定集合编译期可枚举」；Proteus 面对受限子集，可做更激进的转换。

★**适用范围（避免误读）**：「用不了官方 Vapor」限定在 **App / 小程序端**（自定义渲染器路线）。
**Web 端目标是 DOM**，官方 Vapor 与 Proteus 哲学同构（都拒绝虚拟 DOM），可作后续兼容目标——两者是不同通道，不是同一问题的两种答案。

## 三层机制

### ① 编译期：源 → 槽位

`buildVaporSubscriptions(source)` 扫描模板里的响应式引用，为每个「会变化的属性」生成一条**槽位订阅**：它记录该槽位由哪个源的哪条表达式驱动、属于 L0（标准路径）还是 L1（可槽位直写）。分层判定从严不从宽——**误判为 L1 会导致界面静默不更新**，比慢十倍严重。

### ② 运行期：槽位直写

源变化时，运行时按依赖图**只结算受影响的槽位**，其余不动。配合两类压缩：

- **行级失效**：列表里改一行就只算那一行（`relinkRow`），不做整表扫描；
- **布局边界**：变更若被显式尺寸的元素罩住，重排范围锁死在该子树内。

### ③ 传输：二进制指令流

指令以定长字段 + 顺序读的二进制格式下发（无字符扫描、无浮点文本解析——这是更新的热路径）。协议自 v2 起**按需携带键池**：只把本次消息实际引用的条目放进池并重映射引用下标，而非每条消息重发全量池。

## 实测数据

以下数字全部来自真机脚本产出，可按「出处」列自行复算。

| 指标 | 实测 | 出处 |
|---|---|---|
| 单节点更新（行级失效路径） | p50 **0.121 ms** | `hosts/ios/results/bench-filtered-V11.json` |
| 单节点更新（粗粒度全表触发） | p50 **3.62 ms** | 同上（同一份报告的另一档） |
| 单次更新载荷 | **45 字节**（协议 v2 前为 8964 字节） | 同上（`payload_bytes`） |
| 结构变更增量（增 / 删 / 头部插入） | 399KB→**67KB** / 332KB→**526B** / 365KB→**34KB** | `hosts/ios/results/bench-filtered-S5.json` |
| 文本变更增量 | 281KB→**15KB** | `hosts/ios/results/bench-filtered-S4.json` |
| 整树重排（持久 taffy 树） | **17.16 ms → 1.52 ms** | 真机 V0 用例（度量调用 6003→0） |
| 长列表视口裁剪 | 指令 **16001 → 1592（↓90.1%）** | `npx tsx scripts/bench-culling.mjs 400 40` |

## 公开接口

三个符号即可走通「模板 → 订阅表 → 实例化」：

```ts
import { buildLayoutTemplate, buildVaporSubscriptions } from '@proteus-vue/compiler'
import { instantiateTemplate, ListRegistry, SlotRuntime, VaporRuntime } from '@proteus-vue/slot-runtime'

const { template } = buildLayoutTemplate(sfc, 'app.vue')      // 模板 → 静态结构 + 槽位
const { table } = buildVaporSubscriptions(sfc, 'app.vue')     // 响应式源 → 槽位订阅表
const registry = new ListRegistry()
const inst = instantiateTemplate(template, { viewport, read, table, registry })  // + 数据 → 节点树
```

## 当前状态（诚实分级）

「代码已落地」与「用户拿得到」是两件事——本页按后者分级。

| 能力 | 状态 |
|---|---|
| 编译器转换（订阅表 / 模板结构） | ✅ 已实现，可 `proteus explain --vapor` 逐槽位观测 |
| 端上指令消费（iOS / Android 实验宿主） | ✅ 已实现，真机量化（见上表） |
| **接入默认编译路径** | 📋 **未接入**：Vite 插件不产 Vapor 通路，用户工程走不到 |
| 布局边界 / 行级失效的完整收益 | 🟡 取决于模板是否声明了显式尺寸（否则范围上浮） |

### 未接入默认路径

Vapor 通路目前只被 CLI 观测命令（`proteus explain --vapor`）与真机实验宿主消费。**普通工程编译时不走它**——所以上表数字描述的是「这条通路本身能达到的水平」，不是「当前默认构建的用户收益」。

### 已知边界

- **L1 覆盖率是单页读数**：演示页 77.8%，不代表全部业务代码；
- **部分 opcode 未支持**：`INSERT_BLOCK` / `MOVE_NODE` / `CALL_COMPONENT_UPDATE` 会**如实上报 unsupported**，不静默降级；
- **虚拟化下 `splice` 显式拒绝**：层未全量物化时对不存在的层增删会静默分叉，故宁可拒绝；
- **真机绝对读数受热降频影响**：比值可信、绝对值不跨轮比。

## 可复现验收

| 门禁 | 锁什么 |
|---|---|
| `pnpm check:vapor-perf` | 性能棘轮：上限 + **优化路径生效证明**（已接 CI） |
| `cargo test --test ops_conformance` | 跨语言 golden：TS 编码 → Rust 解码逐字节比对 |
| `pnpm check:instr-spec` | 指令集规格表 ↔ 代码一致（生成式，防漂移） |

```bash
pnpm check:vapor-perf                          # 性能棘轮
npx tsx packages/cli/src/index.ts explain --vapor examples/App.vue   # 逐槽位分层观测
npx tsx scripts/bench-culling.mjs 400 40       # 视口裁剪收益（零设备）
```

## 本组导航

- [编译管线总览](/docs/framework/26-compiler-pipeline)：小程序四件套的生成流程
- [编译规则与决策链](/docs/framework/compile-rules)：反黑盒与 explain
- [渲染后端](/docs/framework/23-render-backend)：五后端与可插拔渲染
- [数据更新](/docs/framework/data-updates)：常规更新路径与触发时机
