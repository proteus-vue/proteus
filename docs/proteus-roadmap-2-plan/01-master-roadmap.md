# Proteus 总体规划路线图（Master Roadmap）

> 状态：v1 · 2026-09-02 · 与 `proteus-architecture`（规约层）、`proteus-positioning` v3（门面层）口径对齐
> 目标读者：架构决策者 / 技术负责人 / 社区维护者
> 配套：`02-dependency-graph.md`（依赖关系）、`03-milestones.md`（M1/M2/M3 分批）、`04-critical-path.md`（关键路径）、`05-risk-horizon.md`（风险与前瞻）

---

## 0. TL;DR

**45 份 plan + 1 份架构规约，分 3 个里程碑、6 个阶段落地。** 核心策略是**先地基、后能力、再生态**——把"架构代际领先"收敛成一条可执行的依赖链，而不是 45 个并行任务。

| 里程碑 | 时间 | 交付物 | 判定标准 |
|--------|------|--------|----------|
| **M1 地基** | 0–3 月 | 双 SPI 原型 + IR + 编译期约束 + 首个 Backend | 能跑"换一个 flag 切渲染后端"的 demo |
| **M2 能力** | 4–9 月 | 五端原生映射 + 柔性/自适应 + G-28 Top30 + AI Agent | 真实业务 App 可全栈跑通 6 类终端 |
| **M3 生态** | 10–18 月 | 官方 Backend 生态 + Website + 插件市场 + 性能达标 | 99% 业务场景零原生代码 + benchmark 领先 |

**一句话路线**：先把"语义 IR + 双 SPI"这件唯一不可替代的事做实（M1），再用它把柔性、自适应、全终端、原生能力、AI 闭环全部串起来（M2），最后用生态和性能数据把"代际领先"从定性变定量（M3）。

---

## 1. 全景分层（45 份 plan 的分布）

整个规划体系按**抽象层级**自上而下分为 6 层。每一层依赖其下方所有层，禁止反向依赖（铁律，见 §6）。

```
┌─────────────────────────────────────────────────────────────┐
│ L0 架构规约（proteus-architecture）                         │
│     原则 #1–#10（+泛化 #10.8/#10.9/#10.10）· 铁律 · FLD/GLS │
├─────────────────────────────────────────────────────────────┤
│ L1 方法论层（7 份：G-22 / G-22.5 / G-24 / G-25 / G-26 /     │
│                 G-27 / G-28）                                │
│     ↑ 原则 #10 的终极兑现：语义收敛 + 后端实现               │
├─────────────────────────────────────────────────────────────┤
│ L2 核心引擎（8 份：compiler / compiler-plugin / types /      │
│                 build / app-config / app-renderer / module / │
│                 lifecycle）                                   │
│     ↑ IR、SPI、编译期、运行时、模块化                         │
├─────────────────────────────────────────────────────────────┤
│ L3 能力层（14 份：glass / safe-area / fluid / css-compat /   │
│                 memorial / router / pinia / api / platform / │
│                 component / performance / memory / i18n /    │
│                 security）                                    │
│     ↑ 具体能力，全部走 L1 语义 + L2 引擎                     │
├─────────────────────────────────────────────────────────────┤
│ L4 工具链（6 份：devtools / vue-devtools / cli / testing /   │
│                 test-framework / app-capabilities）            │
│     ↑ 开发体验、调试、测试、可观测                            │
├─────────────────────────────────────────────────────────────┤
│ L5 交付层（10 份：blueprint / website / style-safety /       │
│                 semantic-primitives / adaptive-container /    │
│                 device-adaptation / native-backend /          │
│                 render-backend / dev-efficiency / positioning │
│                 + AI Agent）                                  │
│     ↑ 业务可直接消费的成品 + 对外门面                         │
└─────────────────────────────────────────────────────────────┘
```

**关键洞察**：L1 方法论层只有 7 份，却是**整个体系的杠杆支点**——它一旦稳定，L3 的 14 份能力、L5 的交付层全部可以按同一套模式批量产出。这就是"先方法论、后能力"的成本优势。

### 各层份数

| 层 | 份数 | 性质 | 是否阻断下游 |
|----|------|------|-------------|
| L0 规约 | 1（规约，非 plan） | 真理来源 | ✅ 是 |
| L1 方法论 | 7 | 架构决策 | ✅ 是 |
| L2 核心引擎 | 8 | 基础设施 | ✅ 是 |
| L3 能力 | 14 | 功能实现 | ⚠️ 部分 |
| L4 工具链 | 6 | 开发体验 | ❌ 否（可与 L3 并行） |
| L5 交付 | 10 | 成品/门面 | ❌ 否 |

---

## 2. 依赖关系总览

> 详细图见 `02-dependency-graph.md`。此处只列**关键依赖边**（阻断性依赖）。

### 2.1 硬依赖（Must precede）

```
L0 规约
  └─→ L1 全部（原则 #10 泛化必须先定）

L1 G-27 渲染后端可插拔
  └─→ L2 compiler（IR 层）
  └─→ L2 app-renderer（Backend 注册）
  └─→ L3 component（原生映射）
  └─→ L5 render-backend（官方 Backend 实现）

L1 G-28 原生能力可插拔
  └─→ L2 compiler-plugin（Backend 自动注册）
  └─→ L3 api / platform（语义接口）
  └─→ L5 native-backend（官方 Backend 实现）

L1 G-22 柔性布局
  └─→ L3 fluid-layout
  └─→ L3 css-compat
  └─→ L5 adaptive-container

L2 compiler + compiler-plugin
  └─→ 几乎所有 L3 / L5（编译期能力的前置）

L2 types
  └─→ 所有需要类型定义的层
```

### 2.2 可并行（Can parallelize）

以下组合**互不阻断**，可在同一阶段并行推进以压缩工期：

- L3 各能力之间（glass / safe-area / memorial / router …）——**只要 L1 方法论已定**
- L4 工具链 与 L3 能力——**只要 L2 运行时稳定**
- L5 website 与任何层——**只要 positioning 稳定**
- L5 AI Agent 与 L3 能力——**只要 IR + Style Safety 可用**

**并行是 M2 压缩到 6 个月的关键**（详见 `03-milestones.md`）。

---

## 3. 分批策略（M1 / M2 / M3）

### 3.1 M1 — 地基期（0–3 月，目标：可演示）

**核心命题**：证明"语义 IR + 双 SPI"真能跑通，而不是纸上架构。

**★2026-09 提前落地注记**：M1 地基期主体在框架侧已大幅提前收官——G-27（M1.4/M1.5/M2.1 段）**B1-B6 全落地**（`@proteus-vue/render-backend`：SPI + conformance + 五官方后端原型 Headless/VueDom/Native×3/Flutter + B6 混合渲染 `createHybridRenderer` + demo 页 render-backend-demo「换 flag 切后端」+ E2E 7 例，决策 #293-#331）；宿主层 **G-41（接入）/ G-42（容器）/ G-43（所有权）** 的 B1-B5 亦提前落地（决策 #342-#353，同包：Dispatcher / Host Conformance / vue-bridge / StackContainer / SuperAppContainer / Owned+借用检查器）；**剩余主体 = 真机原生宿主工程接线**（iOS/Android/Flutter/Harmony 宿主实现 RenderBackend 并接入 `createProteusRenderer`）。

| 阶段 | Plan | 交付 | 依赖 |
|------|------|------|------|
| M1.1 | L0 规约收口 | 原则 #10 泛化 + 铁律总表 | ✅ 已完成（docs/proteus-architecture.md，2026-09-02） |
| M1.2 | compiler（IR 层） | LayoutConstraint IR + Render IR | M1.1 |
| M1.3 | types + app-config | 核心类型 + 配置 schema | M1.2 |
| M1.4 | G-27 B1（Backend SPI + conformance test） | `ProteusRenderBackend` 接口 | ✅ **B1-B6 全部完成**（@proteus-vue/render-backend：SPI + runBackendConformance + 五官方后端原型集齐（Headless/VueDom/Native×3/Flutter）+ B6 混合渲染 + demo 页 render-backend-demo（换 flag 切后端，E2E 实测 7 例），2026-09） |
| M1.5 | G-27 B2（VueDomBackend） | `createRenderer(nodeOps)` 复用 | M1.4 → ✅ 已完成（并入 G-27 B1-B6 批次；另有 G-41 vue-bridge 真实 Vue3 createRenderer 接入） |
| M1.6 | style-safety（三层防御骨架） | FLD/CSS 规则引擎雏形 | M1.2 |
| M1.7 | G-22 B1（clamp 算法）+ G-21（Plugin API） | 柔性布局最小原型 | M1.2 |
| M1.8 | devtools M1（TraceBus） | 调试可追溯 | M1.2 |

**M1 退出标准（缺一不可）**：
1. ✅ `resolveProfile(W,H,F)` + `compute()` 纯逻辑单测全绿
2. ✅ `proteus create` 能跑通"Vue 后端 ↔ 原生后端"切换 demo
3. ✅ `backend-conformance-test` 能验证一个假 Backend 的接口完整性
4. ✅ clamp 算法 + Plugin API 联调出"拖拽窗口实时 reflow"的 Playground
5. ✅ FLD/CSS 规则能拦截至少 20 条常见违规

### 3.2 M2 — 能力期（4–9 月，目标：全栈跑通）

**核心命题**：用 M1 的地基把 6 类终端 + 原生能力 + AI 闭环全部串起来。

| 阶段 | Plan | 交付 |
|------|------|------|
| M2.1 | G-27 B4（NativeBackend）+ B5（FlutterBackend） | **混合渲染**：同 App 原生 + 自绘 —— 🟡 框架侧已提前落地（B4 Native×3 + B5 Flutter widget 映射 + B6 混合渲染 `createHybridRenderer` 区域级切后端 + demo 页；剩余 = 真机原生宿主工程接线，2026-09） |
| M2.2 | G-28 B1-B3（Top30 语义接口 + 三端实现） | 扫码/定位/分享/通知 可用 |
| M2.3 | G-22 完整 + G-22.5（p-adaptive 五端） | Sheet/Dialog/Popover 自动切换 |
| M2.4 | G-25（车机/TV/手表三维断点） | 五端真机跑通 |
| M2.5 | L3 能力批量（glass / safe-area / memorial / router / pinia / api） | 业务可用能力集 |
| M2.6 | G-23（AI Agent）+ G-26（开发效率度量） | AI 自修复闭环 + benchmark |
| M2.7 | L4 工具链（cli / testing / devtools 完整） | 工程化闭环 |

**M2 退出标准**：
1. ✅ 真实业务 App（blueprint 级别）在手机/平板/PC/车机/TV/手表 6 类终端跑通
2. ✅ G-28 Top30 能力中 ≥20 个在三端有实现，业务代码零原生
3. ✅ AI Agent 能在 Style Safety 约束下自动完成"硬编码宽度 → p-fluid"迁移
4. ✅ benchmark 首个可引用数据点（开发耗时 / 多端适配改动量 / 缺陷发现时长）

### M2 并行计划（压缩工期的关键）

```
        M2.1 混合渲染 ─┐
        M2.2 G-28 原生 ─┤
        M2.3 柔性/自适应 ┤── 全部依赖 M1，可并行推进
        M2.4 全终端 ────┤
        M2.5 L3 能力 ───┤
        M2.6 AI + 效率 ─┘
                ↓ 汇聚
        M2.7 工具链（可与上并行）
```

**M2 是 6 个并行流 + 工具链，理想情况 6 个月可达**（关键路径 = 最长单流 ≈ 6 月）。

### 3.3 M3 — 生态期（10–18 月，目标：量化领先）

**核心命题**：把"代际领先"从定性变成可引用的性能 + 生态数据。

| 阶段 | Plan | 交付 |
|------|------|------|
| M3.1 | G-28 L2 官方 Backend 生态（≥30 个） | 官方维护 + 社区贡献 |
| M3.2 | G-27 更多渲染后端（Skia / Headless / 游戏引擎探索） | 后端矩阵完整 |
| M3.3 | performance + memory 深度优化 | 启动/内存/帧率达标 |
| M3.4 | security + i18n 完备 | 企业级可用 |
| M3.5 | website（官网 + 文档 + Playground） | 对外门面上线 |
| M3.6 | blueprint 完整业务参考实现 | showcase |
| M3.7 | 大规模 benchmark + 对标报告 | **99% 零原生 + 性能领先的数据** |

**M3 退出标准**：
1. ✅ G-28 能力覆盖达 99% 业务场景（L1+L2+L3 ≥ 99%，L4 ≤ 1%）
2. ✅ 性能 benchmark 在启动耗时、内存、帧率、包体积全面对齐或超过 Flutter/RN
3. ✅ Website 上线，文档/教程/Playground 完整
4. ✅ 至少 3 个生产级业务 App 验证

---

## 4. 关键里程碑与可演示产物

| 时点 | 里程碑 | 对外可讲的故事 |
|------|--------|---------------|
| M1 末 | **Backend 切换 demo** | "换一个 flag，同一份代码从 Web 跑成原生" |
| M2.1 末 | **混合渲染 demo** | "同一个 App，页面 A 原生、页面 B Flutter" |
| M2.3 末 | **自适应 Playground** | "拖拽窗口，弹窗自动 Sheet→Dialog→Popover" |
| M2.4 末 | **六端真机视频** | "一份代码，手机/平板/PC/车机/TV/手表" |
| M2.6 末 | **AI 迁移 demo** | "Agent 读日志，自动把硬编码改成 p-fluid" |
| M3.5 末 | **Website 上线** | 完整门面 + 文档 + Playground |
| M3.7 末 | **对标报告** | 数据证明 99% 零原生 + 性能领先 |

**每个里程碑都必须产出"可演示产物"**——这是对外叙事的弹药库，也是内部信心的来源。

---

## 5. 关键路径（Critical Path）

> 详细分析见 `04-critical-path.md`。此处给结论。

**最长路径**（决定总工期）：

```
L0 规约
  → L1 G-27（渲染后端 SPI）
  → L2 compiler（IR）
  → G-27 B4 NativeBackend + B5 FlutterBackend
  → M2.1 混合渲染 demo
  → M3.1 G-28 生态 + M3.7 benchmark
```

**这条路径约 16–18 个月**，是整个项目的**理论最短工期下限**。其他所有并行流都无法缩短这条路径。

### 关键路径上的风险点

1. **G-27 B5 FlutterBackend**（Embedder C ABI）——技术难度最高，是唯一可能拖垮关键路径的项
2. **G-28 Top30 三端实现**——依赖各平台 SDK 维护者配合，生态风险
3. **M3.7 benchmark**——需要真实业务数据，时间不确定性高

**管理建议**：
- **优先投入 G-27 B5**（FlutterBackend）——它是关键路径上唯一的技术不确定项，越早启动越好
- **G-28 生态采用"官方主导 + 社区贡献"双轨**——降低单点依赖
- **benchmark 从 M1 就开始采集基线**——避免 M3 才发现数据不对

---

## 6. 分层铁律（禁止反向依赖）

为确保路线图可执行，重申三条架构铁律：

- **L1 方法论必须先于 L3 能力**：任何新能力必须先定义语义原语，再写实现（G-28.1 同源）
- **L2 引擎必须先于 L4 工具链**：devtools/cli 只能在稳定运行时上构建
- **禁止跨层反向依赖**：L3 不得 import L5，L4 不得 import L3 的具体实现

**违反铁律的后果**：依赖关系变成网状 → 无法分批 → 45 个任务全部互相阻断 → 项目不可交付。**分层不是美学，是并行化的前提。**

---

## 7. 风险与前瞻（详见 `05-risk-horizon.md`）

| 风险 | 影响 | 缓解 |
|------|------|------|
| Flutter Embedder C ABI 稳定性 | 关键路径 | 早期 spike + 鸿蒙/三星已有先例佐证 |
| 官方 Backend 生态供给不足 | G-28 99% 不达 | 官方主导 Top30 + 社区贡献激励 |
| benchmark 数据不及预期 | M3 叙事 | M1 起采集基线，持续对齐 |
| 团队规模不足以并行 6 流 | 工期 | 优先关键路径，非关键流延后到 M3 |
| 竞品跟进（uni-app/Flutter） | 护城河 | 方法论护城河深，跟进需重构架构 |

---

## 8. 与既有文档的关系

- **`proteus-architecture`**：真理来源，本路线图的分层即源于规约
- **`proteus-positioning` v3**：对外门面，本路线图的"可演示产物"即对外话术弹药
- **各 G-XX / M-X plan**：具体执行细则，本路线图只做编排、不重复细节
- **`docs/board-inventory.md`（v2 架构规划全景）**：全部 plan / 六层分层 / 双路线 / 实现状态的单一权威索引，与本路线图 §1 分层互为参照（替代原 PROTEUS_PLANS_OVERVIEW）

---

## 9. 下一步行动（Immediate Next）

1. ✅ 本路线图 + 依赖图 + 里程碑 + 关键路径 + 风险（本次交付）
2. ⬜ 起 `proteus-website` 骨架（把 positioning §5 杀手特性做成落地页）——**下一个执行项**
3. ✅ M1.1 把 L0 规约收口（docs/proteus-architecture.md：原则 #0-#12 + 铁律 + 规则总表，2026-09-02）
4. ✅ M1.4 `ProteusRenderBackend` SPI + conformance 已落地并扩展至 **B1-B6**（五官方后端原型 + 混合渲染 + demo 页，2026-09；下一执行项 = M2.1 真机宿主工程接线）

**本路线图的交付 = 把"45 份 plan"从清单变成可执行计划**。至此整轮体系完全闭环：规约层 → 方法论层 → 引擎层 → 能力层 → 工具链 → 交付层，每一层都知道自己什么时候做、依赖谁、产出什么。
