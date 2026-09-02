# Proteus 架构规划全景（Board Inventory · v2）

> **定位**：全部 plan / 六层分层 / 双路线 / 实现状态的**单一权威索引**（替代 2026-08 的 17 板块盘点表）
> **关联**：`docs/proteus-positioning-v3.md`（对外门面）· `docs/roadmap.md`（版本线 v0.1→v2.0）· `docs/proteus-roadmap-2-plan/`（里程碑线 M1-M3）· `proteus-architecture`（规约）
> **更新规则**：新增/完成批次必须同步本表；分层归属以本表为准（roadmap-2 §1 六层口径）

---

## 0. 一句话架构

> **Proteus = 语义 IR + 双 SPI（渲染 G-27 / 原生 G-28）+ 全终端（G-25）+ 任意端接入（G-30）**
> slogan：**Render anywhere, on any engine.**（v3：*One semantic model. Any render engine. Zero native glue.*）

不锁渲染引擎、不锁原生能力：上层语义模型（p-* 原语 + IR）为标准，各端 Backend 通过 SPI + conformance 接入。现有实现（编译器 + Vue DOM + MP 产物）即 **G-27 的 VueDomBackend**——架构方向已定案，后续沿路线图扩展后端矩阵。

---

## 1. 双路线对照（两条时间线如何串联）

| 分层 | 版本线（roadmap.md） | 里程碑线（roadmap-2） | 现状 |
|------|---------------------|----------------------|------|
| L0 规约 | v0.1+（原则/铁律积累） | M1.1 规约收口 | 🟡 决策已积累（PROJECT_MEMORY 290 条），正式规约收口待 M1.1 |
| L1 方法论 | v0.4+（G-22 系） | M1 地基（0-3 月） | 🟡 G-22 / G-22.5 ✅ 已落地；G-24/25/26/27/28 ⬜ 规划 |
| L2 核心引擎 | v0.2-v0.4 | M1.2-M1.8 | ✅ 大部分已落地（compiler / plugin / types / build / app-config / module / lifecycle） |
| L3 能力 | v0.3-v0.5 | M2.3-M2.5 | ✅ 大部分已落地（router / pinia / api / platform / component / i18n / security / fluid / css-compat） |
| L4 工具链 | v0.2-v1.0 | M1.8 / M2.7 | ✅ 大部分已落地（cli / devtools / testing / test-framework / vue-devtools） |
| L5 交付 | v1.0-v2.0 | M2-M3 | ⬜ 大部分未启动（★render-backend / native-backend 为核心方向） |

**关键路径（18 月）**：规约 → G-27 SPI → compiler IR → NativeBackend → FlutterBackend → 混合渲染 → G-28 生态 → benchmark。**G-27 B5 FlutterBackend 是唯一技术不确定项（最早 spike）。**

---

## 2. 六层全景总表

### L0 规约

| plan | 编号 | 状态 | 说明 / 下一动作 |
|------|------|------|----------------|
| `proteus-methodology-plan` | 方法论提炼（统一语义收敛） | ✅ 已入库 | **哲学根文档**：核心公式「语义定义 + 后端实现」四维度投影（编译 G-29 / UI G-27 / 能力 G-28 / 端接入 G-30）+ 五支柱（语义优先/解耦/验证先于运行/渐进覆盖 80-18-1.9-0.1/可泛化）+ Tier 模型（R+C+J 三元组）+ 原则速查（★#1 与 positioning #10 同义）——onboarding 第一课 / 对外叙事根；§9 关系图已对齐实际目录 |
| `docs/proteus-architecture.md`（规约） | 原则 #0-#12 + 铁律 + FLD/GLS/RND/NAT/PRIM 规则 | ✅ **M1.1 已收口** | **真理来源**（原则 #0 统一语义收敛根 + 五支柱 + 分层/能力/落地三类铁律 + 十系严格规则 + 分层双路线 + 来源更新规则——合并 17 份 architecture-update + PROJECT_MEMORY 决策链） |

### L1 方法论（杠杆支点：语义收敛 + 后端实现）

| plan | 编号 | 状态 | 说明 / 下一动作 |
|------|------|------|----------------|
| `proteus-fluid-layout-plan` / `proteus-fluid-system-plan` / `proteus-fluid-layout-essence-plan` | **G-22** | ✅ 已落地 | S1-S4 全原语（p-fluid/p-fit/p-scale/p-grid/p-stack/p-split/p-aspect/p-sidebar/p-toolbar/p-safe/p-zone）+ `@proteus-vue/fluid` 包 + FLD001-013 + fluid:check 门禁 |
| `proteus-adaptive-container-plan` | **G-22.5** | ✅ B1/B2/B4 | p-adaptive 纯逻辑 + Controller + p-modal（sheet/dialog/popover 形态自动切换 + anchor 锚定）；B3 原生映射待 App Renderer |
| `proteus-semantic-primitives-plan` | **G-24** | ⬜ 规划 | 六大家族 + 原则 #10.8（须有系统原生对应才进核心 p-*）；B1 桌面交互原语（p-hover/p-shortcut）可立即动手 |
| `proteus-device-adaptation-plan` | **G-25** | ⬜ 规划 | 三维断点 W×H×F（车机/TV/手表）；VEH001/TV001/WATCH001 |
| （dev-efficiency） | **G-26** | ⬜ 规划 | 开发效率度量 + benchmark 基线（roadmap-2 提及，目录待建） |
| `proteus-render-backend-1-plan` | **G-27** | ⬜ **M1.4 待启** | ★**下一大方向**：ProteusRenderBackend SPI（nodeOps 对齐 Vue）+ VueDomBackend 原型（现有 renderer.ts 已有 nodeOps 雏形） |
| `proteus-native-backend-1-plan` | **G-28** | ⬜ 规划 | 原生能力 SPI + Top30 目录 + 权限自动生成 → 99% 业务零原生 |
| `proteus-universal-backend-plan` | **G-30** | 📋 Draft | Platform=(R,C,J) 三元组 + Tier 1-4 + conformance；待 G-27/28 后启用 |

### L2 核心引擎

| plan | 编号 | 状态 | 说明 |
|------|------|------|------|
| `proteus-compiler-plan` | G-02 | ✅ | 编译管线 + 规则注册表 + explain/trace + 自校验 |
| `proteus-compiler-plugin-plan` | **G-21** | ✅ | Compiler Plugin API（IR 可编程访问） |
| `proteus-compiler-backend-1-plan` | **G-29** | ⬜ 规划 | 编译器后端可插拔（与 G-27/28 同哲学） |
| `proteus-types-plan` / `proteus-types-plus-plan` | G-03 | ✅ | @proteus-vue/types + Schema + config:check + migrate codemod |
| `proteus-build-plan` | G-04 | ✅ | plugin-vite（mp 编译 + gen-routes + 共享模块/分包）+ 体积门禁 |
| `proteus-app-config-plan` | G-35 | ✅ | app.config 分层 + schema 校验 + 远程 |
| `proteus-app-renderer-plan` | G-07/22 | ✅ B1 核心 | @proteus-vue/renderer-app：NativeAdapter + createRenderer host config（★G-27 NativeBackend 的既有底座） |
| `proteus-module-plan` | G-05 | ✅ | @proteus-vue/module：契约/图谱/编排器 + 分包 + 审计 |
| `proteus-lifecycle-plan` | G-06 | ✅ | defineApp 五阶段 + 编排器 + 错误隔离 + trace |
| `proteus-app-plan` | — | ✅ B1 | 框架本体拆包 + installWebPlatform |

### L3 能力（语义原语 + 系统能力）

| plan | 编号 | 状态 | 说明 |
|------|------|------|------|
| `proteus-glass-plan` | G-07 | ⬜ 规划 | pg-glass 系统级玻璃（L1/L2/L3 降级） |
| `proteus-safe-area-plan` | G-09 | 🟡 | p-safe 语义已落地（fluid-system S2）；App 端安全区待渲染层 |
| `proteus-fluid-layout-plan`（四原语） | G-22 | ✅ | 见 L1 |
| `proteus-css-compat-plan` | G-08 | ✅ | CSS 矩阵 + 布局语义 + 矩阵测试 |
| `proteus-memorial-skeleton-plan` | G-11 | ⬜ 规划 | 纪念日置灰 + 骨架屏 |
| `proteus-router-plan` / `proteus-router-plus-plan` | G-17 | ✅ | 声明式路由 + 守卫/tabBar/分包 + 深链 |
| `proteus-pinia-plan` | G-15 | ✅ | M1-M8 + MP 桥 + 快照时间旅行 + 协同 |
| `proteus-api-plan` | G-14 | ✅ | createApi 跨端请求 + 凭证托管 |
| `proteus-platform-plan` | G-13 | ✅ | Capability 契约/Registry/降级 + 矩阵测试 |
| `proteus-component-plan` | G-10 | ✅ | 16 内置组件 + runtime 共享模块 + components:audit 门禁 |
| `proteus-performance-plan` / `proteus-memory-plan` | G-12/G-18 | ✅ | 虚拟列表/体积预算 + 内存规范（disposer） |
| `proteus-i18n-plan` | G-19 | ✅ | @proteus-vue/i18n + i18n:check 门禁 |
| `proteus-security-plan` | G-20 | ✅ M1-M3 | 加密存储 + 凭证托管 + 权限最小化 |
| `proteus-api-plan`（设备信息） | — | ✅ | getDeviceInfo 等 |

### L4 工具链

| plan | 编号 | 状态 | 说明 |
|------|------|------|------|
| `proteus-cli-plan` / `proteus-cli-plus-plan` | G-17 | ✅ | build/explain/rules/check 全家 + 健康检查 + 美观 help |
| `proteus-devtools-plan` / `proteus-devtools-plus-plan` | G-19 | ✅ | TraceBus + 九视图 + 双向调试 + 远程中转 + 会话导出导入 |
| `proteus-vue-devtools-plan` | G-19 | ✅ | vue devtools 面板（Router/App Config/Style Safety）+ 本地面板双通道 |
| `proteus-testing-plan` / `proteus-test-framework-plan` | G-16 | ✅ | 四层金字塔 + 统一测试 API + 双端驱动 |
| `proteus-app-capabilities-plan` | — | ✅ | 应用级能力（hooks/能力检查） |

### L5 交付层

| plan | 编号 | 状态 | 说明 |
|------|------|------|------|
| `proteus-blueprint-plan` | — | ⬜ | 完整业务参考实现（M2 验收载体） |
| `proteus-website-plan` | — | ⬜ | 官网（roadmap-2 附属 01-website-skeleton 已列执行项） |
| `proteus-style-safety-plan` | G-21 | ✅ | FLD/CSS 三层防御 + 矩阵测试 |
| `proteus-semantic-primitives-plan`（B1+ 落地产物） | G-24 | ⬜ | 桌面交互原语组件 |
| `proteus-adaptive-container-plan`（组件层） | G-22.5 | ✅ B4 | p-modal 已落地；p-drawer/p-nav/p-detail 待续 |
| `proteus-device-adaptation-plan`（组件层） | G-25 | ⬜ | 车机/TV/手表原语 |
| `proteus-native-backend-1-plan`（官方后端） | G-28 | ⬜ | 官方原生后端实现 |
| `proteus-render-backend-1-plan`（官方后端） | G-27 | ⬜ M1.4 | ★VueDomBackend 原型 → Flutter/Native/Skia/Headless |
| （dev-efficiency） | G-26 | ⬜ | benchmark 数据 |
| `proteus-positioning-v3.md` | — | ✅ | 对外门面（v2 存档 archive/） |
| `proteus-ai-fluid-agent-plan` | G-23 | ⬜ 规划 | AI Agent 操作 LayoutConstraint IR + FLD 校验闭环 |

### 其他文档（非 plan）

| 文件 | 说明 |
|------|------|
| `docs/roadmap.md` | 版本线（v0.1→v2.0，对标 uni-app/Taro）——与本表 §1 双路线对照 |
| `docs/routing.md` / `compiler.md` / `configuration.md` / `types.md` / `packages.md` / `getting-started.md` | 使用文档 |
| `docs/vue-compat-plan.md` / `vue-compat-advance.md` | Vue 兼容性文档（能力已落地） |
| `docs/archive/proteus-positioning-v2.md` | positioning v2 存档（v3 为权威门面） |

---

## 3. 现有实现资产对照（已落地清单，2026-09）

| 资产 | 位置 | 归属 |
|------|------|------|
| Fluid System 全原语（S1-S4） | `@proteus-vue/fluid` + `src/components/p-*` | G-22 ✅ |
| p-adaptive 形态求解（B1/B2/B4） | `@proteus-vue/fluid` adaptive.ts + `src/components/p-adaptive` + `p-modal` | G-22.5 ✅ |
| fluid:check 严格门禁（FLD001-013） | `packages/cli/src/fluid-check.ts` | G-21 ✅ |
| 组件审计（no-platform-api 等） | `components:audit` CLI | G-10 ✅ |
| Vue 自定义渲染器 host config（NativeAdapter） | `@proteus-vue/renderer-app` | **G-27 NativeBackend 底座** 🟡 |
| nodeOps 雏形（onClick→bindtap 映射） | `packages/runtime/src/renderer.ts` | **G-27 VueDomBackend 底座** 🟡 |
| MP 编译器 + 规则注册表（69 条） | `packages/compiler` | G-02/G-21 ✅ |
| devtools 全链路（TraceBus/面板/远程/会话） | `@proteus-vue/devtools*` | G-19 ✅ |
| 测试框架统一 API + 双端驱动 | `@proteus-vue/test-core` | G-16 ✅ |

---

## 4. 严格规则 / 铁律总览

| 系列 | 内容 | 载体 |
|------|------|------|
| FLD001-013 | 柔性布局治理（断点/死尺寸/p-fluid/p-grid/p-scale/p-adaptive） | `proteus fluid:check` |
| CSS017/018 | backdrop-filter 裸写 / 无障碍缺失 | style-safety |
| GLS001-006 | Glass 须走 `<pg-glass>` 入口 | glass-plan |
| PRIM001-005 | 禁止手动 `if (isDesktop)` | semantic-primitives |
| VEH001 / TV001 / WATCH001 | 车机 driving-safe / TV 焦点 / 手表单列 | device-adaptation |
| RND001-005 | 禁止绕过 SPI 直调渲染引擎 / 后端须过 conformance | render-backend |
| AI001-005 | Agent 产物须过 `--strict-css` + FLD | ai-fluid-agent |
| 分层铁律 | L1 先于 L3 / 禁跨层反向依赖（并行化前提） | roadmap-2 §6 |

---

## 5. 状态速览（一句话）

- **已落地**：G-02/03/04/05/06/08/10/12/13/14/15/16/17/18/19/20/21/22/22.5 + L2 引擎 + L4 工具链（≈ 20 个板块）
- **待启（近期候选）**：M1.1 规约收口 → **M1.4 G-27 SPI 原型（VueDomBackend）** → G-24 B1 桌面原语 → p-drawer（G-22.5 B4 剩余）
- **规划（中期）**：G-25 全终端 / G-28 原生后端 / G-26 度量 / G-23 AI Agent / G-29 编译器后端 / G-30 Universal
- **远期**：FlutterBackend（关键路径唯一不确定项）/ 生态 / benchmark

---

*Board Inventory v2 · 2026-09 · 与 positioning-v3 / roadmap.md / roadmap-2-plan 口径对齐*
