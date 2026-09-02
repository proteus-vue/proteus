# 里程碑与分批（Milestones & Batches）

> 配套：`01-master-roadmap.md` §3。本文件给出 M1/M2/M3 的可执行分批计划。

---

## 0. 总览

| 里程碑 | 周期 | 层 | Plan 数 | 并行流 | 关键路径 |
|--------|------|----|---------|--------|----------|
| **M1 地基** | 0–3 月 | L0+L1+部分 L2 | ~15 | 2–3 | **3 月**（下限） |
| **M2 能力** | 4–9 月 | L1 余 + L2 余 + L3 + L4 + 部分 L5 | ~25 | **7** | **6 月**（下限） |
| **M3 生态** | 10–18 月 | L5 余 + 生态 + benchmark | ~5 + 长尾 | 4–5 | **9 月**（下限） |
| **合计** | **18 月** | 全部 | **45** | — | **18 月**（下限） |

**理论最短工期 = 关键路径 = 18 个月。** 并行化只能填满"非关键路径"的空闲时间，无法缩短关键路径。

---

## 1. M1 — 地基期（0–3 月）

### 目标
证明"语义 IR + 双 SPI"是可运行架构，而非纸面设计。**唯一不可替代的阶段。**

### 分批

#### M1.1 规约收口（月 0–0.5）
- `proteus-architecture`：原则 #10 泛化（+#10.8/#10.9/#10.10）、铁律总表、FLD/GLS/PRIM/DEV/TV/WATCH/VEH/BP/RND/NAT 规则汇总
- 产出：规约 v1 定稿

#### M1.2 核心引擎骨架（月 0.5–1.5）
- `compiler`：LayoutConstraint IR + Render IR + Semantic IR 三套 IR
- `types`：核心类型（CapabilityKey / PropsSchema / BackendCapabilities）
- `app-config`：配置 schema + capabilities 声明
- `compiler-plugin`：Plugin API + 生命周期钩子
- 产出：能跑通"解析 SFC → 生成 IR"的最小链路

#### M1.3 双 SPI 原型（月 1.5–2.5）★ 关键
- **G-27 B1**：`ProteusRenderBackend` 接口 + `BackendCapabilities` + `backend-conformance-test`
- **G-27 B2**：`VueDomBackend`（`createRenderer(nodeOps)` 复用）
- **G-28 B1**：`ProteusNativeBackend` 接口雏形
- 产出：**"换一个 flag 切渲染后端"的 demo**

#### M1.4 柔性 + 约束骨架（月 2–3）
- **G-22 B1**：`compute()` + `resolveProfile()` 纯逻辑（零依赖、可单测）
- `style-safety`：FLD/CSS 规则引擎雏形（≥20 条规则）
- `devtools` M1：TraceBus（调试可追溯性）
- 产出：Playground —— 拖拽窗口，布局实时 reflow

### M1 退出标准（缺一不可）

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | `resolveProfile(W,H,F)` + `compute()` 单测全绿 | `vitest run` |
| 2 | Backend 切换 demo 可运行 | 实机演示 |
| 3 | `backend-conformance-test` 验证假 Backend 完整性 | CI 绿 |
| 4 | clamp 算法 + Plugin API 联调出 Playground | 实机演示 |
| 5 | FLD/CSS 拦截 ≥20 条违规 | 规则覆盖率报告 |

### M1 风险
- **风险**：团队可能想在 M1 就做"完整能力" → **必须克制，M1 只做地基**
- **缓解**：明确 M1 退出标准，达标即进入 M2，不做镀金

---

## 2. M2 — 能力期（4–9 月）

### 目标
用 M1 地基把 6 类终端 + 原生能力 + AI 闭环串起来。**真实业务 App 可全栈跑通。**

### 分批（7 个并行流）

#### 流 1：混合渲染（月 4–8）★ 关键路径
- G-27 B4：`NativeBackend`（nodeOps → UIView / Activity / Component）
- G-27 B5：`FlutterBackend`（Flutter Embedder C ABI）
- 产出：**同 App 页面 A 原生 + 页面 B Flutter**

#### 流 2：原生能力（月 4–8）
- G-28 B2-B3：Top30 语义接口 + 三端实现（相机/定位/扫码/分享/通知/蓝牙/NFC/生物识别…）
- 产出：业务代码零原生

#### 流 3：柔性 + 自适应（月 4–6）
- G-22 完整：p-grid / p-fluid / p-stack / p-fit
- G-22.5：p-adaptive（Sheet/Dialog/Popover 五端）
- 产出：自适应 Playground

#### 流 4：全终端（月 5–8）
- G-25：车机（driving-safe）/ TV（焦点引擎）/ 手表（单列一屏 + 表冠）
- 产出：六端真机视频

#### 流 5：L3 能力批量（月 4–9）
- glass（L3）、safe-area、memorial、router、pinia、api、platform、component
- 产出：业务可用能力集

#### 流 6：AI + 效率（月 6–9）
- G-23：AI Agent（四工具 + 信任模型）
- G-26：开发效率度量（benchmark 基线采集）
- 产出：Agent 自动迁移 demo

#### 流 7：工具链（月 4–9，可与上并行）
- cli、testing、test-framework、devtools 完整
- 产出：工程化闭环

### M2 退出标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | 真实 App 在 6 类终端跑通 | 六端真机视频 |
| 2 | G-28 Top30 中 ≥20 个三端实现 | Backend 覆盖率报告 |
| 3 | AI Agent 完成"硬编码 → p-fluid"迁移 | Agent 演示 |
| 4 | 首个 benchmark 数据点 | 对标报告 v0 |
| 5 | 混合渲染 demo 可运行 | 实机演示 |

### M2 并行度
- 理想并行度 = **7**
- 实际受团队规模限制，建议**至少 4 个并行流**同时推进
- **关键路径 = 流 1（混合渲染）≈ 6 月**——这是 M2 工期下限

---

## 3. M3 — 生态期（10–18 月）

### 目标
把"代际领先"从定性变定量。**生态完整 + benchmark 数据领先。**

### 分批

#### M3.1 官方 Backend 生态（月 10–15）
- G-28 L2：≥30 个官方 Backend（官方主导 + 社区贡献）
- 生态治理：签名审计、质量门禁、registry
- 产出：**99% 业务场景零原生**（量化验证）

#### M3.2 渲染后端矩阵（月 10–14）
- G-27：SkiaCanvasBackend、HeadlessBackend、游戏引擎探索
- 产出：后端矩阵完整

#### M3.3 深度优化（月 12–16）
- performance：启动耗时、首帧、AOT、worklet
- memory：四级治理、页面回收、泄漏检测
- 产出：性能达标

#### M3.4 企业级完备（月 13–16）
- security：密钥/凭证/权限
- i18n：国际化
- 产出：企业级可用

#### M3.5 对外门面（月 14–17）
- website：官网 + 文档 + 教程 + Playground + showcase
- 产出：Website 上线

#### M3.6 参考实现（月 15–17）
- blueprint：完整业务参考实现（音乐/交易/社交/内容）
- 产出：showcase

#### M3.7 对标报告（月 16–18）★ 叙事关键
- 大规模 benchmark：开发耗时 / 多端适配改动量 / 缺陷发现时长 / 性能 / 内存 / 包体积
- 产出：**数据证明 99% 零原生 + 性能领先**

### M3 退出标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | G-28 覆盖 ≥99% 业务场景 | 能力覆盖率报告 |
| 2 | 性能 benchmark 对齐/超过 Flutter/RN | 对标报告 |
| 3 | Website 上线（文档/教程/Playground） | 线上验证 |
| 4 | ≥3 个生产级业务 App 验证 | 案例报告 |

---

## 4. 工时估算（参考）

| 层 | 份数 | 单份估时（人月） | 小计 | 备注 |
|----|------|------------------|------|------|
| L0 规约 | 1 | 2 | 2 | 一次性定稿 |
| L1 方法论 | 7 | 3–5 | 28 | 架构决策，需资深 |
| L2 核心引擎 | 8 | 4–6 | 40 | 技术核心 |
| L3 能力 | 14 | 2–3 | 35 | 可批量、可并行 |
| L4 工具链 | 6 | 2–3 | 15 | 工程化 |
| L5 交付 | 10 | 2–4 | 30 | 含 website |
| **合计** | **46** | — | **≈150 人月** | — |

**若团队 10 人、并行度 5**：理论工期 ≈ 150 / 10 / 5 = **3 年**。
**但通过 M1/M2/M3 分阶段 + 关键路径优化**：实际工期 ≈ **18 月**（关键路径下限）。

**差距来源**：并行化 + 依赖图优化 + 非关键路径用社区/生态分担（如 G-28 社区 Backend）。

---

## 5. 分批原则总结

1. **先地基后能力**：M1 只做 L0/L1/L2，不做 L3
2. **关键路径优先**：G-27 B5（FlutterBackend）最早启动
3. **并行度拉满**：M2 理想 7 流并行
4. **每里程碑有可演示产物**：对外叙事 + 内部信心
5. **退出标准硬约束**：不达标不进入下一阶段
