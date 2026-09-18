# 依赖关系图（Dependency Graph）

> 配套：`01-master-roadmap.md` §2。本文件给出可执行的分层依赖明细。

---

## 1. 分层索引

| 层 | 代号 | 份数 | Plan 列表 |
|----|------|------|-----------|
| L0 | 规约 | 1 | `proteus-architecture` |
| L1 | 方法论 | 7 | G-22, G-22.5, G-24, G-25, G-26, G-27, G-28 |
| L2 | 核心引擎 | 8 | compiler, compiler-plugin, types, build, app-config, app-renderer, module, lifecycle |
| L3 | 能力 | 14 | glass, safe-area, fluid-layout, css-compat, memorial, router, pinia, api, platform, component, performance, memory, i18n, security |
| L4 | 工具链 | 6 | devtools, vue-devtools, cli, testing, test-framework, app-capabilities |
| L5 | 交付 | 10 | blueprint, website, style-safety, semantic-primitives, adaptive-container, device-adaptation, native-backend, render-backend, dev-efficiency, positioning, AI Agent |

**合计：1 规约 + 45 plan = 46 份。**

---

## 2. 硬依赖边（DAG）

> 格式：`上游 → 下游`（上游必须先完成）。

### 2.1 L0 → L1（规约必须先于方法论）

```
proteus-architecture → G-22
proteus-architecture → G-22.5
proteus-architecture → G-24
proteus-architecture → G-25
proteus-architecture → G-26
proteus-architecture → G-27
proteus-architecture → G-28
```

### 2.2 L1 → L2（方法论驱动引擎设计）

```
G-27（渲染后端）→ compiler（IR 层）
G-27（渲染后端）→ app-renderer（Backend 注册机制）
G-28（原生能力）→ compiler-plugin（Backend 自动注册）
G-28（原生能力）→ app-config（capabilities 声明）
G-24（语义原语）→ types（CapabilityKey / PropsSchema）
G-22（柔性布局）→ compiler（LayoutConstraint IR）
G-26（开发效率）→ devtools（可观测性支撑）
```

### 2.3 L2 → L3（引擎支撑能力）

```
compiler + compiler-plugin → glass
compiler + compiler-plugin → safe-area
compiler + compiler-plugin → fluid-layout
compiler + compiler-plugin → css-compat
compiler + compiler-plugin → memorial
compiler + compiler-plugin → router
compiler + compiler-plugin → pinia
compiler + compiler-plugin → api
compiler + compiler-plugin → platform
compiler + compiler-plugin → component
compiler + compiler-plugin → performance
compiler + compiler-plugin → memory
types                    → 全部 L3（类型定义前置）
app-config               → api, platform, component
```

### 2.4 L1 → L5（方法论直接支撑交付层）

```
G-27 → render-backend（官方 Backend 实现）
G-28 → native-backend（官方 Backend 实现）
G-22 → adaptive-container（p-adaptive 五端）
G-25 → device-adaptation（车机/TV/手表）
G-24 → semantic-primitives（六大家族）
G-23（AI Agent）→ ai-fluid-agent
G-26 → dev-efficiency
L1 全部 → positioning（门面归纳）
```

### 2.5 L3 → L5（能力支撑成品）

```
glass + safe-area + memorial → blueprint（业务参考实现）
style-safety ← compiler + compiler-plugin + css-compat（编译期防御）
component → website（组件文档）
```

### 2.6 L2 → L4（引擎支撑工具链）

```
compiler → cli（build/dev/preview）
compiler + app-renderer → devtools（运行时观测）
types → testing / test-framework（类型测试）
lifecycle → devtools（生命周期追踪）
```

---

## 3. 可并行组合（Parallelizable）

以下组合**无依赖边**，可在同阶段并行推进：

### 3.1 L1 内部
G-22 / G-22.5 / G-24 / G-25 / G-26 **互不依赖**，可并行（均只依赖 L0）。

### 3.2 L3 能力之间
glass / safe-area / fluid-layout / css-compat / memorial / router / pinia / api / platform / component / performance / memory / i18n / security **互不依赖**，可并行（均只依赖 L2）。

### 3.3 L4 工具链之间
devtools / cli / testing / test-framework / app-capabilities **互不依赖**，可并行（均只依赖 L2）。

### 3.4 L5 交付之间
website / style-safety / semantic-primitives / adaptive-container / device-adaptation / dev-efficiency / positioning **互不依赖**，可并行（均只依赖 L1）。

### 3.5 跨层并行
- L4 工具链 与 L3 能力：**可并行**（只要 L2 稳定）
- L5 website 与任何层：**完全独立**
- L5 AI Agent 与 L3 能力：**可并行**（只要 IR + Style Safety 可用）

---

## 4. 并行度分析（为何 M2 能压到 6 个月）

M2 阶段同时推进的并行流：

```
流 1：G-27 混合渲染（NativeBackend + FlutterBackend）
流 2：G-28 原生能力（Top30 三端）
流 3：G-22 + G-22.5 柔性/自适应
流 4：G-25 全终端
流 5：L3 能力批量（glass/safe-area/memorial/router/pinia/api…）
流 6：G-23 AI + G-26 效率
流 7：L4 工具链（cli/testing/devtools）
```

**理想并行度 = 7**。若每流串行需 6 月，则 7 流并行理论上仍受**关键路径**（最长单流 ≈ 6 月）约束。

**结论**：M2 工期下限 = 关键路径长度 ≈ 6 个月，**无法通过加人进一步压缩**——这是架构性限制。

---

## 5. 禁止的依赖（Anti-dependencies）

为确保 DAG 无环，明确禁止：

1. ❌ L3 能力 → import L5 交付（如 component 不得依赖 blueprint）
2. ❌ L4 工具链 → import L3 具体实现（如 devtools 只依赖 L2 运行时接口）
3. ❌ L5 交付 → import 其他 L5 实现细节（如 website 只消费公共 API）
4. ❌ 同层回边（如 G-27 不得依赖 G-28 的具体实现）

**CI 门禁建议**：用依赖图静态分析（见 `proteus-build-plan` M1.2）自动检测循环依赖，违规即红。

---

## 6. 依赖图可视化（ASCII）

```
L0  architecture
        │
        ▼
L1  G-22 ─ G-22.5 ─ G-24 ─ G-25 ─ G-26 ─ G-27 ─ G-28
        │                                  │         │
        ▼                                  ▼         ▼
L2  compiler ─ compiler-plugin ─ types ─ build ─ app-config ─ app-renderer ─ module ─ lifecycle
        │                                  │
        └──────────┬───────────────────────┘
                   ▼
L3  glass ─ safe-area ─ fluid ─ css-compat ─ memorial ─ router ─ pinia ─ api ─ platform
        ─ component ─ performance ─ memory ─ i18n ─ security
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
L4  devtools ─ cli ─ testing ─ test-framework ─ app-capabilities
                        │
                        ▼
L5  blueprint ─ website ─ style-safety ─ semantic-primitives ─ adaptive-container
        ─ device-adaptation ─ native-backend ─ render-backend ─ dev-efficiency
        ─ positioning ─ AI Agent
```

**每一列是流水线阶段，列内可并行。** 这就是"分层 = 并行化前提"的可视化表达。

---

## 7. 循环依赖检测（自检）

对以上依赖图做拓扑排序，结果为**有效 DAG**（无环）。自检记录：

- L0 → L1 → L2 → L3 → L4 → L5：**单向，无环** ✅
- L1 内部：7 份互不依赖 ✅
- L3 内部：14 份互不依赖 ✅
- L5 website：仅依赖 positioning（L5 内唯一允许的轻量依赖，因 positioning 是归纳层而非实现层）⚠️

**关于 website → positioning**：严格说是 L5 内部依赖，但因 positioning 是"门面归纳层"（只汇总、不实现），允许此项作为**唯一例外**，并在 CI 中显式标注。

---

## 8. 落地建议

1. **M1 先把 L0 + L1 + 部分 L2 收口**——这是唯一不可替代的阶段
2. **M2 把并行度拉满**——7 流并行，用团队规模换时间
3. **M3 聚焦关键路径**——生态 + benchmark 是长尾，需持续投入
4. **CI 加依赖图静态分析**——自动拦截循环依赖与跨层违规
