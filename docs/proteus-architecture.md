# Proteus 架构规约（Architecture Contract）

> **状态**：v1（2026-09-02）· M1.1 规约收口 ✅
> **定位**：全部 plan / 决策 / 铁律 / 严格规则的**真理来源（Single Source of Truth）**——roadmap-2 分层 L0 层
> **关联**：`docs/proteus-methodology-plan/`（哲学根：统一语义收敛）· `docs/board-inventory.md`（全景索引）· `docs/proteus-positioning-v3.md`（门面）
> **来源**：PROJECT_MEMORY 291 条决策 + 17 份 plan `architecture-update.md` 增量（本文件为合并收口）

---

## 0. 核心公式与根原则

```
任何跨端问题 = 语义定义（框架做） + 后端实现（平台做）
```

- **原则 #0（统一语义收敛，methodology 根原则）**：Proteus 不做跨端翻译，定义与平台无关的语义内核；一切平台差异下沉为「后端实现细节」。同 shape 四投影：编译（G-29）/ UI（G-27）/ 能力（G-28）/ 端接入（G-30）。
- **原则 #0 第五投影（G-31，开发者书写面）**：框架暴露给开发者的每一个组件与 API，必须先定义语义（Component IR / Hook 接口），再交由各端 Backend 实现；**禁止将任何既有平台的组件名、属性名、API 形态直接上升为框架标准**——小程序组件集（view/text/wx.xxx）降级为 Layer 1 兼容层（`@proteus/compat-miniprogram`），Proteus 语义组件（p-* + useNative/useFetch）是 Layer 0。
- **五支柱**（详见 methodology §3）：① 语义优先于实现 ② 接口与实现彻底解耦 ③ 验证先于运行（编译期消灭不可能）④ 渐进式覆盖（80/18/1.9/0.1）⑤ 方法论可泛化。

---

## 1. 原则总表

| 编号 | 原则 | 落地 |
|------|------|------|
| #0 | 统一语义收敛（根） | 四维度投影（G-27/28/29/30） |
| #1 | 单一事实源（SFC + 路由表 + Design Token） | 编译期归一 |
| #2 | 语义收敛，原生实现（框架定义做什么，后端决定怎么做） | p-* 原语 + Backend SPI |
| #3 | 编译期优先于运行期 | IR + Golden Test |
| #4 | 降级不崩溃（L3→L2→L1→solid） | BackendCapabilities 能力协商 |
| #5 | 开发者只写一次，五端自适应 | 语义层 + 后端矩阵 |
| #6 | 接口与实现解耦 | SPI 模式 |
| #7 | 验证先于运行 | conformance + 编译期约束 |
| #8 | 渐进式覆盖 | L1 内置 / L2 官方 / L3 社区 / L4 兜底 |
| #9 | 显式声明 > 隐式假设 | BackendCapabilities / defineCapability |
| #10 | **统一语义 + 后端实现（方法论根基）** | G-27/28/29/30 + Glass/SafeArea/Fluid/Adaptive |
| #10.7 | 视觉能力走 Glass 分层（L1/L2/L3） | glass-plan |
| #10.8 | 语义原语须对应至少一个 OS 原生能力（防膨胀） | semantic-primitives PRIM001-005 |
| #10.9 | 断点模型覆盖全部输入形态（touch/cursor/remote/dial/voice） | device-adaptation W×H×F |
| #11 | 核心能力实现为 Compiler Plugin（dogfooding） | compiler-plugin G-21 |
| #12 | AI Agent 产物须通过编译期强制校验 | ai-fluid-agent AI001-005 |

> ★编号体系说明：methodology 原则速查 #1-#10 为本表 #0-#9 的映射（methodology #1 = 本表 #10），以本表为准。

---

## 2. 铁律总表

### 2.1 分层铁律（roadmap-2 §6）

1. **L1 方法论先于 L3 能力**：任何新能力必须先定义语义原语，再写实现（G-28.1 同源）
2. **L2 引擎先于 L4 工具链**：devtools/cli 只能在稳定运行时上构建
3. **禁止跨层反向依赖**：L3 不得 import L5，L4 不得 import L3 的具体实现（并行化前提）

### 2.2 能力/后端铁律

| 编号 | 内容 | 来源 |
|------|------|------|
| G-21.1 / G-21.2 | 编译器能力必须走 Plugin 注册表 / IR 可编程访问 | compiler-plugin |
| G-22.5 | 禁止手动判断宽度切换形态（`if (width < 600) showSheet()`）→ 用 `p-adaptive` 声明式断点 | adaptive-container |
| G-22.6 | p-adaptive 区间端点指「容器宽度」非屏幕宽度；监听容器尺寸不监听屏幕旋转 | adaptive-container |
| G-24.1 | 系统集成能力（通知/权限/分享/窗口/深链）必须通过 p-* 语义访问 | semantic-primitives |
| G-24.2 | 无系统原生对应的能力不得进入核心 p-*（归组件/插件层） | semantic-primitives |
| G-25.1/2/3 | 车机 driving-safe / TV focus-mode / 手表单列一屏 | device-adaptation |
| G-28.1 | 业务代码禁止平台判断或原生 SDK 直接调用 → 一律走 `useNative()` | native-backend |
| G-29.1 | 三端 Compiler Backend 对同一 SFC 必须产出语义等价的 CompilerIR（IR Golden Test 强制） | compiler-backend |
| G-30.1-4 | 单一 IR 约束 / Tier 判定 / conformance 强制 / 降级不越权 | universal-backend |
| RND001 | 禁止业务直调后端专有 API；走 p-* 或 Backend SPI | render-backend |
| RND002-005 | 后端须通过 conformance test / 能力声明真实 / 热切换可回滚 / 混合渲染走 Texture Sharing | render-backend |
| **G-31.1** | **内置组件必须 p- 前缀 + 语义命名；禁止引入与小程序/HTML 组件同名的无语义组件（view/scroll-view/swiper 属兼容层）** | component-semantics |
| **G-31.2** | **每个组件属性须声明 Tier 降级行为（CMP006 编译期拦截）** | component-semantics |
| **G-31.3** | **Layer 0 所有 API 必须 Promise/Hook 化，禁止回调式/全局对象式（无 wx.xxx）** | component-semantics |
| **G-31.4** | **新组件进 L1 前须 ≥3 端真实 Backend 通过 conformance test** | component-semantics |

### 2.3 落地约束（既有，合并保留）

- **降级铁律**：某端不支持 → 编译期拦截（`@conditional` / `defineCapability`）→ 运行时降级链 → 兜底 solid，不崩溃
- **组件审计铁律**：组件内禁止 `document.*`/`window.*` 平台 API 直调（no-platform-api）、禁止同步存储（no-sync-storage）、清单完整（manifest-complete）——`components:audit` CI 门禁
- **反黑盒铁律**：编译器每条规则须有 AI 说明书（transforms 注册表），产物可枚举、可查询、可反查源码

---

## 3. 严格规则总表

| 系列 | 规则 | 级别 | 说明 | 载体 |
|------|------|------|------|------|
| FLD | FLD001-013 | error/warning | 柔性布局治理：禁 @media（001）/禁硬编码断点（002）/p-fluid 须区间（003）/p-grid 须 min-col-width（004）/p-adaptive 区间连续（007）/禁手动宽度判断（008）/端点来自 breakpoints（009）/过小字号（012）/p-scale 越界（013） | `proteus fluid:check` |
| CSS | CSS017/018 | error | 禁 backdrop-filter 裸写 / 无障碍缺失 | style-safety |
| GLS | GLS001-006 | error | Glass 须走 `<pg-glass>` 入口 | glass-plan |
| PRIM | PRIM001-005 | error | 禁手动 `if (isDesktop)` 等平台分支 | semantic-primitives |
| VEH/TV/WATCH | VEH001 / TV001 / WATCH001 | error | 车机 driving-safe / TV 焦点模式 / 手表单列 | device-adaptation |
| DEV/BP | DEV/BP 系列 | warning/error | 设备断点一致性 / 断点来源 | device-adaptation |
| RND | RND001-005 | error | 禁绕过 SPI 直调渲染引擎 / conformance 强制 | render-backend |
| NAT | NAT 系列 | error | 原生能力须走 useNative() | native-backend |
| AI | AI001-005 | error/warning | Agent 产物须过 `--strict-css` + FLD | ai-fluid-agent |
| STS | STS 系列 | error | Style Safety 运行时约束 | style-safety |
| CMP | CMP005-008 | error | 业务直调平台 SDK（005）/组件属性缺降级声明（006）/回调式 API 进 Layer 0（007）/L1 组件不足 3 端 conformance（008） | component-semantics |

---

## 4. 分层与双路线（详见 board-inventory.md）

```
L0 规约（本文） → L1 方法论（G-22/22.5/24/25/26/27/28/30） → L2 核心引擎（compiler/types/build/...）
→ L3 能力（14） → L4 工具链（6） → L5 交付（10+）
```

- **版本线**（roadmap.md）：v0.1 ✅ → v0.6（App 原生 = G-27 时代）→ v1.0 → v2.0
- **里程碑线**（roadmap-2-plan）：M1 地基（双 SPI 原型）→ M2 能力（混合渲染 + 六终端）→ M3 生态
- **关键路径（18 月）**：规约 → G-27 SPI → compiler IR → NativeBackend → FlutterBackend → 混合渲染 → G-28 生态 → benchmark

---

## 5. 架构全景（一句话）

> **Proteus = 语义 IR + 双 SPI（渲染 G-27 / 原生 G-28）+ 全终端（G-25）+ 任意端接入（G-30）**
> **Render anywhere, on any engine.**（v3：*One semantic model. Any render engine. Zero native glue.*）

现有实现（编译器 + Vue DOM + MP 产物）即 **G-27 的 VueDomBackend**；`@proteus-vue/renderer-app` 的 NativeAdapter 即 NativeBackend 底座。

---

## 6. 文档关系（真理来源位置）

```
PROTEUS-METHODOLOGY.md（哲学根：统一语义收敛）
    ↓ 提炼为
proteus-architecture.md（本文：原则 + 铁律 + 规则 = 真理来源）
    ↓ 落地于
G-27/28/29/30 四层 SPI（render/native/compiler/universal backend plan）
    ↓ 编排于
proteus-roadmap-2-plan/（M1-M3）· roadmap.md（v0.x）· board-inventory.md（全景索引）
    ↓ 叙事出口
proteus-positioning-v3.md
```

---

## 7. 来源与更新规则

- **来源**：17 份 plan `architecture-update.md`（adaptive-container / app-capabilities / app-config / cli-plus / compiler-backend-1 / compiler-plugin / device-adaptation / devtools-plus / fluid-layout / memorial-skeleton / methodology / native-backend-1 / render-backend-1 / router-plus / semantic-primitives / style-safety / universal-backend）+ PROJECT_MEMORY 决策链
- **更新规则**：任何 plan 的 architecture-update.md 变更 → 必须同步本文件（对应章节）→ board-inventory 状态同步；本文件是唯一可引用规约（plan 内不再各自为政）

---

*Architecture Contract v1 · 2026-09-02 · M1.1 规约收口完成*
