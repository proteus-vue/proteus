# Proteus 跨端 CSS 引擎（PCE）· G-61

> 状态：**📋 规划（已入库 · 决策 #544；基准口径追加 #546）** ｜ 编号：**G-61** ｜ 依赖：G-08（css-compat）、G-21（style-safety）、G-27/G-37（RenderBackend SPI）、G-38（CompilerBackend SPI）
> 一句话定位：**把「一份 CSS 引擎」放在编译期做唯一实现，把「落地」拆成每宿主一个样式应用器，把「视觉一致」变成三层可判定门禁。**

---

## 0. 为什么立这个 plan（一句话）

今天 Proteus 的样式链路是**三套互不相干的实现**：Web 用浏览器 CSSOM、Skyline 用微信容器、App 用编译期字段折叠（`docs/generated/app-css-surface.md:6-7` 原文：「App 端**无 CSS 引擎**」）。

缺的不是一个包，是**一条链**：

```
CSS 真源（解析→层叠→继承→计算值） → 统一产物（StyleIR） → 每宿主应用器（落地点） → 能力协商（降级编译） → 一致性判据（可判定）
```

这五格今天**全空或半空**（量化见 `01-baseline-survey.md`）。

---

## 1. 架构：一份引擎 + 四层可插拔

```
SFC <style>  ──►  ┌───────────────────────────────────────────────┐
                  │  L-A  CSE  编译期 CSS 引擎（唯一实现 · 零运行期）│
                  │  collect → index → match → cascade → inherit   │
                  │        → compute → normalize                   │
                  │  + 动态 class 预计算（属性维度分解）            │
                  └───────────────────┬───────────────────────────┘
                                      ▼
                        L-B  StyleIR（ComputedStyle v1 契约）
                     单一事实源 · 可序列化 · 逐字段可比 · 版本化
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
      L-C Web Applier        L-C Skyline Applier       L-C App Applier
      → 原生 CSS（保真）      → wxss 子集               → 引擎字段 + 绘制属性
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      ▼
                    一致性门禁（三层判据 · 全部棘轮 · expected 唯一来源 = Web）
              ① 基准等价（IR ≡ Web 计算样式 · 编译期硬）
              ② 数值等价（各端 ≡ Web 快照 · ≤0.5dp · 运行期硬）
              ③ 像素观察（各端真截图 ≡ Web 基准截图 · 非门禁）

      L-D  Capability Registry（能力协商）—— 驱动编译期降级，贯穿全部四层
      ★基准（baseline）：Web 视觉三件套（计算样式 / 几何 / 渲染截图）冻结入仓
```

| 层 | 名称 | 职责 | 约束 |
|---|---|---|---|
| **L-A** | **CSE 编译期 CSS 引擎** | 唯一 CSS 真源：收集/索引/匹配/五级层叠/继承/计算值 + 动态 class 预计算 | 运行期零解析；Node 与 Rust 双后端产同一 IR；`proteus explain` 可 trace |
| **L-B** | **StyleIR 契约** | 唯一样式产物（`ComputedStyle` 规范化） | 字段闭集 + 值类型 + 版本号；**IR 之外禁第二条样式通路** |
| **L-C** | **SApp 宿主样式应用器 SPI** | 每宿主一个，**唯一样式落地点** | 可 conformance（同一 IR → 等价应用后状态） |
| **L-D** | **Capability Registry** | 声明每端原生能力，驱动**编译期降级** | 三张样式属性表合一；降级语义等价且可观测 |

---

## 2. ★三条已定调的决策（本次入库确认 + 基准追加）

### 2.1 Web 端 = **A 档**（保浏览器原生 CSS，IR 作影子真值）

- **Web 端继续由浏览器原生 CSSOM 渲染**，**不**由 IR 生成 Web CSS。
- StyleIR 在 Web 端的角色是**基准真值**（比对对象），与既有的「Web = 真值基准」设定一致（`docs/Proteus_CSS_Profile规格.md:400`）。
- 一致性由**编译期 lint 前置**保证：Profile 外写法在 Web 端也报错（`05-…` B4），从而「Web 跑通 = 各端行为一致」。
- **B 档（IR 生成 Web CSS）不采用**，仅在 Profile 稳定后作为可选优化再评估。

### 2.2 App 端 = **新通路并行、逐字段切换**（禁一次性替换）

- App 端现状是 `parseStaticStyle` **直折进引擎字段**，改造触及 `parseStaticStyle`/`parseClassRules` 高风险区。
- **纪律**：新 IR 通路与既有折叠通路**并行存在**，按字段逐批切换；**每切一批都必须有 IR 等价判据兜底**，任一批不达标即回退该批。
- 目标终态：既有直折通路下线，**IR 成为 App 端唯一样式输入**（届时 L-B 铁律 .2 生效）。

### 2.3 ★一致性基准 = **Web 视觉（唯一）**（2026-10-05 追加，决策 #546）

- **"多端视觉一致性"的 `expected` 只有一个来源：Web 端的真实渲染**——不是三端两两互比，不是"以 IR 为准"，也不是"以某端自称的实现为准"。
- **基准三件套**（可采集、可冻结）：**B-a** 计算样式（`getComputedStyle`）· **B-b** 几何（`getBoundingClientRect` → snapshot）· **B-c** 视觉（Playwright 真渲染截图，环境指纹锁定）。判据①②③ 分别消费 B-a / B-a+B-b / B-c。
- **为什么是 Web**：① 只有 Web 是**完整实现**（其余两端都是子集，用子集当基准等于让缺能力的那端定义"应该长什么样"）；② **A 档的直接推论**——浏览器算出来的值就是权威答案，IR 只负责把它规范化；③ 本仓 **#542/#543/#545** 三轮修复已按此实践，其中 #543 的教训正是"只看一端"。
- **四条纪律**：**D1 单一**（端间互比只能诊断，不得定案）· **D2 冻结**（golden 快照入仓，不靠当场重跑；活体重采集只用于基准腐化检测）· **D3 可复现**（登记浏览器/DPR/视口/字体/主题指纹，变化即基准变更须审批 + diff 审计）· **D4 基准自身合法**（基准样本必须先过 Profile lint）。
- **基准守护**：基准清单可寻址 + 变更须审批 + 腐化检测 + **基准不得由被测端自证**（App/Skyline 脚本只读基准）。
- 详见 `03-consistency-gates.md` §1、§6。

---

## 3. 一致性：三层判据（全部棘轮 · 全部以 Web 为 expected）

| 层 | 判据 | `expected`（基准） | 时点 | 门禁 |
|---|---|---|---|---|
| **① 基准等价** | Node/Rust 双后端 IR 逐字节相同；IR vs 浏览器 `getComputedStyle` 逐属性比对（Profile 内目标 100%） | **B-a** Web 计算样式 | 编译期 | **硬** |
| **② 数值等价** | 各端 snapshot（Geometry + NormalizedStyle）相对 **Web 快照** ≤0.5dp（容差按 `packages/consistency/src/tolerance.ts`，禁全局阈值） | **B-a + B-b** | 运行期 | **硬** |
| **③ 像素观察** | 每端**真截图** + 锚定归一 + 与 **Web 基准截图** 并排登记 | **B-c** Web 基准截图 | 运行期 | **非门禁**（承 G-56.7） |

详见 `03-consistency-gates.md`。

---

## 4. 分批实施

| 批次 | 内容 | 验收 |
|---|---|---|
| **B0** | 契约冻结：StyleIR v1 + 能力注册表三表合一 + SApp SPI 签名 + **基准 manifest（Web 基准环境指纹与快照寻址）** | `check:app-css-surface` **由红转绿**；`check:baseline-manifest` 0 error |
| **B1** | CSE 内核（补 Profile P3）：匹配 / 五级层叠 / 继承 / 计算值 | IR vs `getComputedStyle` 100 例一致率 100% |
| **B2** | 动态 class 预计算（补 P4） | 动态组合 IR 与浏览器一致；查表 O(1) 有 profile 证据 |
| **B3** | 三端 Applier + 同一 conformance | **各端相对 Web 基准**：L2 覆盖 2/38 → 38/38 |
| **B4** | 降级编译 + lint 收口（补 P5/P6） | Profile 外写法在 **Web 端也报错**（= 基准自身合法，D4） |
| **B5** | 一致性门禁升级（三层判据 + 基准守护 + 假绿防护 + 逐端留证） | 三端真截图**与 Web 基准并排**留证；基准腐化检测上线；数字不粉饰 |

**关键路径**：B0 → B1 → B2 →（B3 ∥ B4）→ B5。

---

## 5. 分册索引

| 文件 | 内容 |
|---|---|
| `01-baseline-survey.md` | 现状勘察 · 五个结构性缺口 · 量化指标 · 完整证据索引（每条结论带 `文件:行`） |
| `02-style-ir-contract.md` | **B0 交付物**：StyleIR v1 字段闭集 + 值类型 + 版本规则 + Capability Registry + SApp SPI 草案 |
| `03-consistency-gates.md` | **基准 = Web 视觉（唯一）** + 三条判据 + 棘轮 + 基准守护 + 假绿防护 + 逐端留证纪律 |
| `04-batches-and-boundaries.md` | B0–B5 分批细则 + 逐端验收清单 + 不做清单 + 风险 + 规约冲突处理 |

---

## 6. 不变量（INV-CE-01~10）

| 编号 | 不变量 |
|---|---|
| INV-CE-01 | 同一 SFC，Node 后端与 Rust 后端产出的 IR **逐字节相同** |
| INV-CE-02 | 三端 Applier 消费同一 IR，产出**等价**的"应用后状态" |
| INV-CE-03 | 运行期**零 CSS 解析**（选择器匹配 / 层叠 / 单位换算在调用栈中零出现，profile 可证） |
| INV-CE-04 | 能力声明与实现**一致**（未实现必 SKIP，禁假绿） |
| INV-CE-05 | 降级发生在**编译期**、**语义等价**、**可观测** |
| INV-CE-06 | 三张样式属性表**同源**（`check:app-css-surface` 绿，禁半开状态） |
| INV-CE-07 | 新增样式字段必须**四同步**：IR 规范 + 三 Applier + 三层判据 |
| INV-CE-08 | 三层一致性判据**全部棘轮**（只增不减） |
| INV-CE-09 | **基准唯一**：一致性 `expected` 只有 Web 视觉一个来源；**端间互比只能诊断、不得定案** |
| INV-CE-10 | **基准冻结且可复现**：基准以 golden 快照入仓 + 环境指纹登记；变更须审批/diff 审计；**基准不得由被测端自证** |

---

## 7. 诚实边界（本 plan 立项时的现状）

- 本 plan 为**规划**，尚无落地实现——除**复用既有资产**外：`layout-core-rust`（Taffy flex+grid，`ops_apply.rs::apply_style_key`）、`packages/component-ir/src/pnode-style.ts`（`resolveLength`）、`packages/consistency`（snapshot/tolerance/pixel）、`docs/Proteus_CSS_Profile规格.md`（L0–L5 + 7 步算法 + `ComputedStyle` 草案）、`scripts/gen-css-capability-alignment.mjs`。
- 不自研文本基础设施（字体 / BiDi / RTL / emoji / OpenType —— Profile L4）。
- 不追求「Web CSS 五端像素级兼容」（Flutter/Yoga 的路）。
- 不引 Blink/WebF 路线（记录于 `Proteus_CSS_Profile规格.md §10`）。

> ★纪律：本目录状态标注遵循本仓规约——`✅ 已完成` 必须能 grep 到证据；`❌ 未实现` 不得被读成"已有设计"。

**基准相关现状（追加口径，决策 #546）**：已有 Web 探针（`packages/consistency/src/probes/web.ts`）与像素基线文件（`docs/consistency-pixel-noise.json`）；**尚无**基准 manifest（`docs/generated/style-baseline/manifest.json`）、基准腐化检测脚本、写入守卫——这三项为 B0/B5 的新增交付物，当前标注为 ❌ 未实现。
