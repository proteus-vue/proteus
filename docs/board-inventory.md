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
| L1 方法论 | v0.4+（G-22 系） | M1 地基（0-3 月） | 🟡 G-22 / G-22.5 / **G-27（SPI+conformance+B1/B2）✅**；G-24/25/26/28 ⬜ 规划 |
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
| `proteus-architecture-facade-plan` | 规约层（执行序 G 表 + CI 门禁） | ✅ v3.8 | **`00-architecture.md`（全局执行序 G-01~G-43 + 9 铁律 + 包注册表）/ `ARCHITECTURE.md`（一页全景）/ `01-optimization-log.md`（v3.0~v3.8 变更）三文件**——由 `scripts/check-consistency.js` 校验「三文件 G 表同集合且 G-01~G-N 连续」（CI 门禁 `consistency.yml`）；v3.6（决策 #315）追加 G-36~G-39 四 SPI/Agent 行；v3.7（决策 #340）追加 G-40 execution-carrier 行；v3.8（决策 #341）追加 G-41/G-42/G-43 宿主层三 plan 行；★新 plan 入仓必须同步本表（决策 #177/#315 纪律） |
| `proteus-methodology-plan` | 方法论提炼（统一语义收敛） | ✅ 已入库 | **哲学根文档**：核心公式「语义定义 + 后端实现」四维度投影（编译 G-29 / UI G-27 / 能力 G-28 / 端接入 G-30）+ 五支柱（语义优先/解耦/验证先于运行/渐进覆盖 80-18-1.9-0.1/可泛化）+ Tier 模型（R+C+J 三元组）+ 原则速查（★#1 与 positioning #10 同义）——onboarding 第一课 / 对外叙事根；§9 关系图已对齐实际目录 |
| `docs/proteus-architecture.md`（规约） | 原则 #0-#13.24 + 铁律 + FLD/GLS/RND/NAT/PRIM/AI/CMP 规则 | ✅ **M1.1 已收口 + SPI 七系追加** | **真理来源**（原则 #0 统一语义收敛根 + 五支柱 + #13.x 可插拔可验证（含 #13.11-13.24 宿主层子原则）+ 分层/能力/落地三类铁律 + 严格规则 + 分层双路线 + 来源更新规则——合并 architecture-update + 决策链；G-37/38/39/40/41/42/43 SPI 铁律与 CMP017-073 已并入） |

### L1 方法论（杠杆支点：语义收敛 + 后端实现）

| plan | 编号 | 状态 | 说明 / 下一动作 |
|------|------|------|----------------|
| `proteus-fluid-layout-plan` / `proteus-fluid-system-plan` / `proteus-fluid-layout-essence-plan` | **G-22** | ✅ 已落地 | S1-S4 全原语（p-fluid/p-fit/p-scale/p-grid/p-stack/p-split/p-aspect/p-sidebar/p-toolbar/p-safe/p-zone）+ `@proteus-vue/fluid` 包 + FLD001-013 + fluid:check 门禁 |
| `proteus-design-principle-plan` | —（原则补充） | ✅ 已入库 | **全局设计原则 #10「统一语义 + 原生实现」显式化**：architecture-principle（原则定义）/ app-renderer-layout（布局归属）/ component-layout-semantics（p-flex/p-stack/p-grid 语义）/ config-update；facade 规约「+1 份原则补充」即指本目录；2026-08 规范化（决策 #177 统一 -plan 后缀）
| `proteus-adaptive-container-plan` | **G-22.5** | ✅ B1/B2/B4 | p-adaptive 纯逻辑 + Controller + p-modal（sheet/dialog/popover 形态自动切换 + anchor 锚定）；B3 原生映射待 App Renderer |
| `proteus-semantic-primitives-plan` | **G-24** | 🟡 **B1-B4 全落地（#329/#337/#338/#339）** | 六大家族 + 原则 #10.8（须有系统原生对应才进核心 p-*）；B1 桌面交互原语（p-hover/p-shortcut/p-focus-trap/p-context-menu）；B2 系统集成四件套（p-notify/p-permission/p-clipboard/p-deeplink + v-p-permission 门禁）；B3 导航结构（p-master-detail/p-command ⌘K/p-tabs/p-breadcrumb）；**B4 生命周期/设备（p-lifecycle/p-state-restoration/p-network-status/p-low-power）**——`@proteus-vue/desktop`（32 包）**17 模块 + 五 v-p-* 指令** Pure logic + Web 接线（§9 Device 家族由 @proteus-vue/api capability hooks 承接——防重复） |
| `proteus-device-adaptation-plan` | **G-25** | ⬜ 规划 | 三维断点 W×H×F（车机/TV/手表）；VEH001/TV001/WATCH001 |
| （dev-efficiency） | **G-26** | ⬜ 规划 | 开发效率度量 + benchmark 基线（roadmap-2 提及，目录待建） |
| `proteus-render-backend-1-plan` | **G-27** | 🟡 **B1-B6 已落地** | ★`@proteus-vue/render-backend` 包：SPI + conformance（RND002）+ **五官方后端原型集齐**（Headless/VueDom/Native×3/Flutter widget 映射）+ **B6 混合渲染**（Texture Sharing + 区域级切后端 + DevTools 路由 trace）+ **可视化 demo 页** `render-backend-demo`（换 flag 切后端——M1 退出标准；E2E 实测 7 例） |
| `proteus-render-backend-spi-plan` | **G-37** | 📋 规划（已入库） | ★**G-27 的可执行落地**：RenderBackend SPI 规范（18 方法接口 + 生命周期 + C-IR 消费契约 + 布局分工 + 手势桥 + 线程模型）+ Conformance 套件（42 测试 C-01~C-10）+ 5 步实现指南 + B1-B5 分批；铁律 G-37.1-6 + CMP023-028；★与既有 `@proteus-vue/render-backend` 实现（M1.4 B1/B2 已落地）互为印证 |
| `proteus-native-backend-1-plan` | **G-28** | ⬜ 规划 | 原生能力 SPI + Top30 目录 + 权限自动生成 → 99% 业务零原生 |
| `proteus-universal-backend-plan` | **G-30** | 📋 Draft | Platform=(R,C,J) 三元组 + Tier 1-4 + conformance；待 G-27/28 后启用 |
| `proteus-component-semantics-plan` | **G-31** | 🟡 **B1-B6 已落地 + B7 骨架** | ★**入口语义化**：C-IR schema + 属性约束（GRID_CONFLICT/CMP006）+ semantic 映射 + toComponentIR + **全后端消费 semantic（proteus-* 语义类）+ B5 conformance 门禁** + **B7 能力 Hook 层骨架**（@proteus-vue/api/capability.ts + CMP007 `api-check`）+ **B6 兼容层 + codemod**（@proteus-vue/compat-miniprogram：createWxCompat 桥 + migrateMpSource 幂等转换 + `proteus migrate mp`）；G-31.1-4 + CMP005-8；**小程序组件集降级为 Layer 1 兼容层方向** |
| `proteus-semantic-primitives-plus-plan` | **G-32** | 🟡 **B1 ✅ + B2 ✅ + B4 Shell/Gesture + B3 Hook 三期** | ★**完整语义落地闭环 IR**：128 原语清单 SSOT（`PRIMITIVE_CATALOG`）+ SEMANTIC_ENUM 18→53 + `proteus audit coverage` 门禁 + **布局 12 + UI 18 + Shell 10 + Gesture 核心全双端落地（31 新组件 + `@proteus-vue/gesture` + v-gesture，audit 57 组件全过，42 implemented 语义）× 6 后端 conformance + ⑤ Capability Hook 三期（21 useXxx：一期 10 + 二期 useFetch/usePermission/useStorage/createReactiveStorage + 三期 sensor/brightness/phone-call/biometric(WebAuthn)/payment/login/qr-code/useAuth 组合 + bridge 全能力 + CMP007 api-check）**；⑤ Capability 余 29 / ⑥ Engineering 28 待续 |

### L2 核心引擎

| plan | 编号 | 状态 | 说明 |
|------|------|------|------|
| `proteus-compiler-plan` | G-02 | ✅ | 编译管线 + 规则注册表 + explain/trace + 自校验 |
| `proteus-compiler-plugin-plan` | **G-21** | ✅ | Compiler Plugin API（IR 可编程访问） |
| `proteus-compiler-backend-1-plan` | **G-29** | 🟡 **B1+B2 已落地** | ★`@proteus-vue/compiler-backend` 包：CompilerIR 契约 + conformance（CMP002/CMP004 + ★G-31.1 语义链接）+ NodeBackend；**B2 RustBackend**：`packages/compiler-backend-rust`（cargo crate + @proteus-vue/compiler-backend-rust bin 壳）——proteus-cc-rust CLI → 同一 CompilerIR JSON（G-29.1 Node/Rust 语义等价 Golden，决策 #330）+ **examples/组件双端等价门禁 81 用例**（决策 #332）+ **编译器插拔消费点**（决策 #333：`config.compiler.backend: 'node'\|'rust'` + `proteus build --compiler rust` + vite 构建内双编译校验——**proteus.config 一个 flag 切后端（§5 最终形态最小闭环）**）；B3 WASM 待续 |
| `proteus-compiler-backend-spi-plan` | **G-38** | 🟡 **B1 + B2 + B3 前置 全落地（Node 侧）** | ★**编译器的插头标准（与 G-37 RenderBackend SPI 同形设计）**：ProteusCompilerBackend SPI（parse/transform/emit 三阶段 + IncrementalSession 增量 + FallbackBackend 降级 + getCacheKey/getArtifactHash）+ Conformance 套件（42 测试 C-01~C-10）+ Node/Rust/WASM 实现指南 + `conformance-runner.js`（补 `--backend <spec>` 外部后端加载）+ verify.sh/pack.sh 自检；铁律 G-38.1-6 + CMP029-034；**B1 接口冻结 + B2 全落地（#334/#335）**：`g38.ts`（createG38NodeBackend 三阶段 16 方法真实现）+ `g38-fallback.ts`（createG38FallbackBackend 自动降级 + onFallback）+ `g38-conformance.ts`（套件权威 TS 版）+ `proteus conformance` CLI；**B3 前置：真 IncrementalSession（#336）**：`g38-session.ts`（依赖图 + 签名缓存 + invalidate/recompute 局部重算 + commit/rollback 快照——C-06 全 PASS，42 项 PASS=36/SKIP=6（余 SKIP 全诚实能力声明））；Rust native（B3：oxc/swc + napi-rs——★template 无 Rust 官方 parser 待决策）、WASM（B4）待续 |
| `proteus-host-runtime-plan` | **G-39** | 📋 规划（已入库） | ★**宿主运行时（Host Runtime）SPI 与职责边界**：L0-L4 五层「唯一拥有者」架构（L4 进程/线程/事件循环/JS 引擎/原生桥）+ ProteusHostRuntime 接口（bootstrap/suspend/resume/destroy + createWorker/runOnThread + createEngine + invokeNative/registerNativeHandler + enqueue/nextTick，共 15+3，与 G-37/G-38 同形）+ 职责矩阵（跨层调用机器校验）+ Conformance 42（C-01~C-10）+ `runtime-reference.js`（Web/Terminal 参考实现）+ 自检工具链；铁律 G-39.1-6 + CMP035-043；★编号避让：原稿 G-36/G-34/G-35 已实现 plan 占用（决策 #314） |
| `proteus-execution-carrier-plan` | **G-40** | 📋 规划（已入库） | ★**G-39 宿主运行时的执行层（Execution Carrier）SPI 与 JSI 边界治理**：执行载体可插拔 = 原则 #0「不绑定」同族投影（平台 API G-31/32 / 渲染 G-27/37 / 编译 G-29/38 / 宿主运行时 G-39 之后，对「执行载体」的应用）；ProteusExecutionCarrier SPI（capabilities/costProfile/load/invoke/invokeBatch/allocShared/invokeBinary/getMetrics + createWorker + 实时注册，与 G-37/G-38 同形）+ **批处理差分**（一次跨界干 N ops，G-40.5）+ **零拷贝通道**（>4KB 走 ArrayBuffer，CMP048 显式降级）+ **实时逃逸**（原生闭环，JS 仅 configure/start/stop/onEvent）+ Conformance 42（C-01~C-10）+ `carrier-reference.js`（**JSICarrier/AOTCarrier 双参考实现**——对照原则 #11 ≥2 参考实现，机器证据 avgBatchSize=100）+ verify.sh/pack.sh 自检；铁律 G-40.1-6 + CMP044-050；★AOT 路径 = G-38 emit 产物第三类（aot-native）：无 JS 边界 + 真并发（实时/并发的终局解）；★编号避让：原稿 G-37/G-36/G-35/G-34 已实现 plan 占用（决策 #340） |
| `proteus-host-integration-plan` | **G-41** | ✅ **B1-B6 全部落地（#342-#359）** | ★**宿主接入契约 + Vue 绑定架构（Host Integration）**：三方正交（框架核心 × 渲染引擎 × 宿主）+ **Vue 不变机制**（createRenderer + **nodeOps Dispatcher 方案 B**：全局转发 `currentBackend` → 热切换/混合渲染，切换 = 一次赋值）+ 职责边界 6 铁律 + 8 步接入流程 + host-conformance H-01~H-08（32 项）；**落地**：`@proteus-vue/render-backend` 的 `dispatcher.ts`（B1）/ `host-conformance.ts`（B2）/ `vue-bridge.ts`（B3）/ `web-host.ts`（B4）/ `hot-switch.ts`（B5）/ **`host-matrix.ts`（B6 组合矩阵：6宿主×6引擎=36 组合 Tier 声明 + 组合级 conformance 7 项 + Tier 1 13 组全验证 failed===0）**；铁律 G-41.1-6 + CMP051-058；★编号避让：原稿 G-38 与 compiler-backend-spi 撞号（决策 #341） |
| `proteus-host-container-plan` | **G-42** | 🟡 **B1-B6 已落地（#347-#358；余「真实 App 验证」需生产 App）** | ★**宿主容器契约 + 页面生命周期治理（Host Container）**：五层容器栈 + 六种容器策略（SinglePage/Stack/SuperApp/MiniProgram/Window/Embedded——不绑容器形态）+ **IR 单一 Owner + 五原子销毁** + 框架代管资源 + 超级应用沙箱/崩溃隔离/配额/安全网关 + **严禁 fork 铁律**；**落地**：`@proteus-vue/render-backend` 的 `container-spi.ts`（B1 SPI + 页面生命周期状态机）/ `stack-container.ts`（B2）/ `container-conformance.ts`（B3 C-01~C-08 38 项 + scanRepoForFork + **B6 能力门控扩展**：C-04 pageStack/C-06 resourceQuota 未声明诚实 SKIP）/ `superapp-container.ts`（B4）/ cli `proteus conformance --repo`（B5）/ **`basic-containers.ts`（B6 四容器：SinglePage 单槽 replace + Embedded 宿主挂载点 + Window 多窗口各持栈 + MiniProgram 导航语义/tab 保活/L1 沙箱——六容器画像全部有可运行实现，全部零 FAIL）**；铁律 G-42.1-6 + CMP059-066；★编号避让：原稿 G-39 与 host-runtime 撞号（决策 #341） |
| `proteus-ownership-plan` | **G-43** | 🟡 **B1-B5 已落地（#352-#357）** | ★**资源所有权模型 + 内存治理（Resource Ownership）**：Owned/Borrow/Weak/Managed 语义层（GC 管可达性，所有权管意图——治理 GC 盲区）+ **借用检查器分层保证**（PSS strict 编译期完备——吸收鸿蒙 ArkTS「限制换能力」/ loose 主路径 / off 运行时兑底）+ Drop 五阶段协议（与 G-42 五原子销毁对接）+ **DevTools 所有权图（V-01~V-07 数据+面板）** + 跨设备所有权转移 `transferToDevice()`（B6 待真机）；**落地**：`@proteus-vue/render-backend` 的 `ownership.ts`（B1 + getProteusOwnershipGraph 全局单例 + Owned.subscribe）/ `borrow-checker.ts`（B2 + B5 补 B-07 跨页强引用/B-08 循环引用）/ `page-ownership.ts`（B3 页面所有权上下文——G-42 五原子第 3 步委托 Drop 协议）/ `ownership-observability.ts`（B4 数据层）/ **`pss.ts`（B5 PSS 编译器支持：pragma 三级声明 + P1~P9 限制 + CMP071 ref(Owned) 拦截 + insertScopeDrops 自动 drop + runPss 管线）**；devtools 第十视图 Ownership（B4 面板 UI）；`@proteus-vue/api` `createOwnershipEngineering`（B5 **useOwned/useBorrow** 响应式元信息——注入式零 vue 依赖）；铁律 G-43.1-6 + CMP067-073；★编号避让：原稿 G-40 与 execution-carrier 撞号（决策 #341） |
| `proteus-types-plus-plan` | G-03 | ✅ | @proteus-vue/types + Schema + config:check + migrate codemod（★v1.0 `proteus-types-plan` 已并入本 v2.0，决策 #313） |
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
| `proteus-semantic-primitives-plan`（B1+ 落地产物） | G-24 | 🟡 B1-B4 | `@proteus-vue/desktop` 17 模块：p-hover/p-shortcut/p-focus-trap/p-context-menu + p-notify/p-permission/p-clipboard/p-deeplink + p-master-detail/p-command/p-tabs/p-breadcrumb + **p-lifecycle/p-state-restoration/p-network-status/p-low-power（决策 #339）** + v-p-permission 门禁 |
| `proteus-adaptive-container-plan`（组件层） | G-22.5 | ✅ B4 | p-modal 已落地；p-drawer/p-nav 已由 G-32 B2 shell 原语承接（p-detail 待续） |
| `proteus-device-adaptation-plan`（组件层） | G-25 | ⬜ | 车机/TV/手表原语 |
| `proteus-native-backend-1-plan`（官方后端） | G-28 | ⬜ | 官方原生后端实现 |
| `proteus-render-backend-1-plan`（官方后端） | G-27 | ⬜ M1.4 | ★VueDomBackend 原型 → Flutter/Native/Skia/Headless |
| （dev-efficiency） | G-26 | ⬜ | benchmark 数据 |
| `proteus-positioning-v3.md` | — | ✅ | 对外门面（v2 存档 archive/） |
| `proteus-ai-fluid-agent-plan` | G-23 | ⬜ 规划 | AI Agent 操作 LayoutConstraint IR + FLD 校验闭环 |
| `proteus-ai-agent-plan` | **G-36** | 🟡 **B1-B4 已落地（#360-#363）** | ★**G-23 的第一个具体落地**：AI Agent 接入——让 AI 自动产出符合柔性 IR 的标准业务代码（MCP Server 11 工具 + Agent Kit SDK + 4 Skill + 三层 Guardrails + 自修复循环 + Token 优化 + B1-B6）；**B1 落地**：新包 **`@proteus-vue/mcp`**（传输无关 MCP Server 核心——11 工具/5 Resources/3 Prompts/CMP021 策略；数据源全 SSOT 派生）；**B2 落地**：新包 **`@proteus-vue/agent`**（Agent Kit SDK——IRBuilder 不绑 LLM 构造 IR（semantic→tag SSOT 反查）+ generateCode 规则引擎（sfc/ts）+ withProteusRules 5 条约束 + intent-to-flex 规则引擎版（实体识别→MCP 查库→IR→降级→产码）+ LlmLike 可注入——**G-36 降级策略成立：LLM 不可用时走 IR 模板**）；**B3 落地**：migrate-miniprogram Skill（**G-31 B6 codemod 复用** + wx.* API 扫描 + MCP lookup_miniprogram 核对 + **CMP019 映射日志**（tag/api × auto/manual）+ 覆盖率（≥80% 口径）+ 私有 API → useMiniProgram() 接线声明）；**B4 落地**：三层护栏 + 自修复循环（guardrails.ts：L1 IR Schema/L2 风格（C1 裸色值 token 反查表+C5 wx.*/G-36.2 命名）/L3 六端 conformance（**经 MCP 协议面**）；diagnose 五类错误分类；repairSource token 精确匹配→var(--p-*)（design-token-fix 策略）；**generateWithRetry 自修复循环（G-36.6 上限 3 超限转人工）**）；铁律 G-36.1-7 + CMP017-022；与 G-31 B6 迁移 / G-32 原语库 / G-37 RenderBackend SPI 协同；余 B5 adapt-device / B6 评测集 |

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
| **G-27 渲染后端 SPI + 官方后端原型** | `@proteus-vue/render-backend`（spi/conformance/headless/vue-dom/native×3/flutter/hybrid） | **G-27 🟡 B1-B6 全落地** |
| **G-31 C-IR 语义化 + conformance** | `@proteus-vue/component-ir`（schema/validate/map/to-ir/conformance） | **G-31 🟡 B1-B5** |
| **G-29 编译器可插拔后端（B1+B2）** | `@proteus-vue/compiler-backend`（spi/conformance/node/dual-check）+ `packages/compiler-backend-rust`（cargo）+ `@proteus-vue/plugin-vite`·`@proteus-vue/cli`（消费接线） | **G-29 🟡 B1 NodeBackend + B2 RustBackend（同一 CompilerIR——G-29.1 语义等价；examples/组件双端门禁 81 + config.compiler.backend flag 消费点 10，决策 #332/#333）** |
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
| **G-36.1-7** | AI Agent 输出必经 conformance / 禁小程序组件名 / 禁裸平台 API / Skill 组合性审查 / MCP 按需上下文 / 自修复上限 / 代码可追溯 IR | ai-agent-plan |
| **G-37.1-6** | Backend 基于 semantic 分发 / C-IR 只读 / capabilities 诚实声明 / 单线程调用 / conformance 准入 / 降级可见 | render-backend-spi-plan |
| **CMP017-022** | Agent 取色限 tokens（017）/ 页面类型声明（018）/ 迁移映射日志（019）/ adapt-device 不改语义（020）/ MCP 鉴权（021）/ 评测含车机+手表（022） | ai-agent-plan |
| **CMP023-028** | SPI 方法数 ≤20（023）/ NodeHandle 不透明（024）/ 差分完整性（025）/ 资源释放（026）/ 手势 no-op（027）/ 首帧预算（028） | render-backend-spi-plan |
| **G-38.1-6** | 编译后端 IR 不可知 / 产物语义等价 / 能力诚实声明 / 降级可观测 / 性能基准强制 / 确定性产出 | compiler-backend-spi-plan |
| **CMP029-034** | 接口完整性（029）/ 确定性 emit（030）/ 降级语义一致（031）/ 缓存键可移植（032）/ 诊断不抛异常（033）/ 源码位置保留（034） | compiler-backend-spi-plan |
| **G-39.1-6** | 生命周期唯一拥有 / 线程唯一拥有 / 能力诚实声明 / 降级可观测 / 原生桥白名单 / 禁止循环依赖 | host-runtime-plan |
| **CMP035-043** | 宿主不假设业务（035）/ 禁跳层（036）/ 禁循环依赖（037）/ 能力声明一致（038）/ 降级可观测（039）/ 生命周期确定性（040）/ 线程安全（041）/ 资源清理（042）/ 性能基准（043） | host-runtime-plan |
| **G-40.1-6** | 载体无关（禁假设 JS 运行时存在）/ 三路径（JSI/AOT/WASM）语义等价 / 实时能力禁 JS 驱动（原生闭环）/ >4KB 强制零拷贝 / RenderBackend 必须 commitBatch / 载体可观测（rtJsDrivenViolations=0） | execution-carrier-plan |
| **CMP044-050** | capabilities 声明（044）/ 实时类注册分类（045）/ 未实测禁对外宣称（046）/ 零拷贝禁 slice（047）/ 不支持须显式降级 null（048）/ 降级上报指标（049）/ 批内禁逐次跨界（050） | execution-carrier-plan |
| **G-41.1-6** | 框架不碰线程/原生 View/平台 SDK / 宿主不解析 IR / 引擎不感知 Vue / 业务无平台判断 / 业务不假设 JS / 注册先于 bootstrap（host-conformance 门禁） | host-integration-plan |
| **CMP051-058** | 注册顺序（051）/ 禁直引 RenderBackend·nodeOps（052）/ 禁直调 createWorker·invokeNative（053）/ 引擎禁 import vue（054）/ 框架禁 import 平台 SDK（055）/ 宿主禁 IR 字段分支（056）/ 切换须过 H-05（057）/ 上线须 0 失败（058） | host-integration-plan |
| **G-42.1-6** | IR 页面唯一真相 / 五原子销毁 / 资源框架代管 / 容器不解析 IR / 超级应用隔离+配额 / 严禁 fork 框架源码 | host-container-plan |
| **CMP059-066** | 容器可声明式配置（059）/ 深度超限不得静默（060）/ 配额超限返回 null（061）/ 沙箱全隔离（062）/ 崩溃上报（063）/ 安全网关拒绝而非降级（064）/ 容器声明 capabilities（065）/ 销毁报告可观测（066） | host-container-plan |
| **G-43.1-6** | 边界资源必有 Owner / Move 后禁访问 / 借用不逃逸作用域 / 默认框架代管 / 所有权 100% 可观测 / 确定性 Drop | ownership-plan |
| **CMP067-073** | 禁直接释放代管资源（067）/ 跨设备转移原子（068）/ 不可转移显式拒绝（069）/ 释放失败不禁默（070）/ Owned<T> 禁 ref/reactive 包装（071）/ PSS strict 禁未声明第三方库（072）/ 配额与所有权图一致（073） | ownership-plan |
| 分层铁律 | L1 先于 L3 / 禁跨层反向依赖（并行化前提） | roadmap-2 §6 |

---

## 5. 状态速览（一句话）

- **已落地**：G-02/03/04/05/06/08/10/12/13/14/15/16/17/18/19/20/21/22/22.5 + L2 引擎 + L4 工具链（≈ 20 个板块）
- **★已落地（近期批次）**：G-27 B6 混合渲染（决策 #328）→ G-24 B1 桌面原语（决策 #329）→ G-29 B2 RustBackend（决策 #330）→ **G-27 可视化 demo 页 + E2E（决策 #331）** → **G-29.1 真实文件双端等价门禁 81 用例（决策 #332）** → **G-29 编译器插拔消费点（决策 #333）** → **G-38 B1/B2-Node（决策 #334）** → **G-38 B2 尾（决策 #335）** → **G-38 B3 前置·真 IncrementalSession（决策 #336）** → **G-24 B2 系统集成四件套（决策 #337）** → **G-24 B3 导航结构（决策 #338）** → **G-24 B4 生命周期/设备（决策 #339：G-24 家族 B1-B4 全收官，desktop 17 模块）** → **G-40 执行载体 plan 整合入库（决策 #340）** → **宿主层三 plan 整合入库 G-41/42/43（决策 #341）** → **G-41 B1-B5（决策 #342-#346：nodeOps Dispatcher / Host Conformance 32 项 / 真实 Vue3 createRenderer 接入 / WebHostRuntime / 热切换三策略）** → **G-42 B1-B5（决策 #347-#351：容器 SPI / StackContainer / Conformance 38 项 / SuperAppContainer / 仓库治理 CLI）** → **G-43 B1-B2（决策 #352-#353：Owned 所有权类型 / 借用检查器 B 规则集）** → **G-43 B3（决策 #354：页面所有权上下文——G-42 五原子销毁第 3 步委托 Drop 协议：forceDrop + Managed 自动释放 + 配额归零，StackContainer/SuperAppContainer ownership 接入）** → **G-43 B4 数据层（决策 #355：DevTools 所有权图——graph mutation 事件流 + 历史时间线/计数器采样 + 四类检测（泄漏路径/长期借用/跨页强引用/无主资源）+ alloc-drop 配对，V-01~V-07）** → **G-43 B4 面板 UI（决策 #356：devtools 第十视图 Ownership——renderOwnership + tracer + 本地/Proteus.ownership 远程双通道 + install 缺省挂全局单例图）** → **G-43 B5（决策 #357：PSS 编译器支持——pragma 三级声明 + P1~P9 限制 + CMP071 ref(Owned) 拦截 + insertScopeDrops 自动 drop + runPss 管线 + B-07/B-08 补全 + useOwned/useBorrow 响应式集成）** → **G-42 B6（决策 #358：其余 4 容器落地——SinglePage 单槽/Embedded 宿主挂载/Window 多窗口/MiniProgram 导航语义+tab 保活+L1 沙箱 + conformance 能力门控扩展（C-04/C-06），六容器画像全部可运行零 FAIL）** → **G-41 B6（决策 #359：宿主×引擎组合矩阵——6×6=36 组合 Tier 声明 + 组合级 conformance（语义指纹/控件映射/热切换等价）+ Tier 1 13 组全验证 failed===0）** → **G-36 B1（决策 #360：MCP Server——新包 @proteus-vue/mcp：11 工具/5 Resources/3 Prompts/CMP021 策略，传输无关核心，数据源全 SSOT 派生）** → **G-36 B2（决策 #361：Agent Kit SDK——新包 @proteus-vue/agent：IRBuilder 不绑 LLM 构造 IR + generateCode 规则引擎 + withProteusRules + intent-to-flex 规则引擎版 + LlmLike 可注入——降级策略成立）** → **G-36 B3（决策 #362：migrate-miniprogram Skill——G-31 B6 codemod 复用 + wx.* API 扫描 + CMP019 映射日志（tag/api × auto/manual）+ 覆盖率 + AgentKit.migrate 门面）** → **G-36 B4（决策 #363：三层护栏 + 自修复循环——L1 IR Schema/L2 风格（裸色值 token 反查/wx.*/命名）/L3 六端 conformance（经 MCP 协议面）；diagnose 五类；repairSource design-token-fix 策略；generateWithRetry 上限 3 超限转人工）**；**待启**：G-24 余项并入 G-32（B4+ 原语由 capability/G-32 承接）→ G-38 B3（Rust native——先定 template parse 策略）→ G-29 B3（WASM Playground）→ **G-36 B5 adapt-device Skill / B6 评测集 / G-37 RenderBackend SPI B1 / G-39 Host Runtime B1 / G-40 Execution Carrier B1** → **G-42 真实 App 验证（需生产 App）/ G-43 B6（跨设备转移——需真机环境）**
- **方向调整（G-31）**：小程序组件/API 从「一等公民」降级为 **Layer 1 兼容层**（现有 built-in-components proteus-* 模拟 + wx.* 入口 → compat-miniprogram 演进方向）；源码入口语义化（C-IR）
- **规划（中期）**：G-25 全终端 / G-28 原生后端 / G-26 度量 / G-23 AI Agent / G-29 编译器后端 / G-30 Universal
- **远期**：FlutterBackend（关键路径唯一不确定项）/ 生态 / benchmark

---

*Board Inventory v2 · 2026-09 · 与 positioning-v3 / roadmap.md / roadmap-2-plan 口径对齐*
