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
| L4 工具链 | v0.2-v1.0 | M1.8 / M2.7 | ✅ 大部分已落地（cli / devtools / testing / test-framework / vue-devtools）+ 🟡 G-44 验证层规划入库（Test IR + TestBackend SPI） |
| L5 交付 | v1.0-v2.0 | M2-M3 | ⬜ 大部分未启动（★render-backend / native-backend 为核心方向） |

**关键路径（18 月）**：规约 → G-27 SPI → compiler IR → NativeBackend → FlutterBackend → 混合渲染 → G-28 生态 → benchmark。**G-27 B5 FlutterBackend 是唯一技术不确定项（最早 spike）。**

---

## 2. 六层全景总表

### L0 规约

| plan | 编号 | 状态 | 说明 / 下一动作 |
|------|------|------|----------------|
| `proteus-architecture-facade-plan` | 规约层（执行序 G 表 + CI 门禁） | ✅ v3.16 | **`00-architecture.md`（全局执行序 G-01~G-58 + 9 铁律 + 包注册表）/ `ARCHITECTURE.md`（一页全景）/ `01-optimization-log.md`（v3.0~v3.16 变更）三文件**——由 `scripts/check-consistency.js` 校验「三文件 G 表同集合且 G-01~G-N 连续」（CI 门禁 `consistency.yml`）；v3.6（决策 #315）追加 G-36~G-39 四 SPI/Agent 行；v3.7（决策 #340）追加 G-40 execution-carrier 行；v3.8（决策 #341）追加 G-41/G-42/G-43 宿主层三 plan 行；v3.9（决策 #364）追加 G-44 testing-framework 行；v3.10（决策 #369）追加 G-45 dev-host 行；v3.11（决策 #385）追加 **G-46~G-52 七 plan 行**（resource-pool / combined-conformance / miniprogram-runtime / sandbox-isolation / developer-platform / test-ir-runner / cross-device-verification）+ 白皮书 `docs/proteus-whitepaper-plan/`（非 G 序，登记于「其他文档」）；v3.12（决策 #391）追加 **G-53 mobile-verification / G-54 devtools-suite 两行**（G-53=孤儿 plan 补登记，泛化序修正 15→17；G-54 原稿自编 G-55 编号避让重编、CMP-163~170→155~162）；v3.13（决策 #392）追加 **G-55 devtools-landing 行**（原稿自编 G-56 编号避让重编、原则 #13.60-62 撞号顺延 #13.63-65）；v3.14（决策 #393）追加 **G-56 studio 行**（原稿自编 G-57 编号避让重编、原则 #13.57-59 撞号顺延 #13.66-68）；v3.15（决策 #394）追加 **G-57 inspector 行**（原稿自编 G-58 编号避让重编、原则 #13.60-62 第三次撞号顺延 #13.69-71）；v3.16（决策 #395）追加 **G-58 plugin-api 行**（原稿自编 G-59——studio 预留号——编号避让重编、原则 #13.60-62 第四次撞号顺延 #13.72-74）；★新 plan 入仓必须同步本表（决策 #177/#315 纪律） |
| `proteus-methodology-plan` | 方法论提炼（统一语义收敛） | ✅ 已入库 | **哲学根文档**：核心公式「语义定义 + 后端实现」四维度投影（编译 G-29 / UI G-27 / 能力 G-28 / 端接入 G-30）+ 五支柱（语义优先/解耦/验证先于运行/渐进覆盖 80-18-1.9-0.1/可泛化）+ Tier 模型（R+C+J 三元组）+ 原则速查（★#1 与 positioning #10 同义）——onboarding 第一课 / 对外叙事根；§9 关系图已对齐实际目录 |
| `docs/spi-first-methodology/` | **—（元方法论，不占 G 序）** | ✅ v1 入库（#373）+ 第 10~16 次登记（#385）+ 第 17~21 次登记（#391~#395） | **★SPI-First 五步法**：把「不绑 X」泛化（九次 → **二十一次**）抽象为通用工程方法论——① 找耦合点（grep 量化：出现 ≥2 文件 = 候选）→ ② 语义收敛（接口禁技术名词）→ ③ 可插拔后端（≥2 含 Mock/Headless——单后端 SPI 是假 SPI）→ ④ conformance（同一套测试跨后端可判定）→ ⑤ 诚实边界（性能/能力/适用三边界）；**二十一次泛化 ↔ 五步法映射表**（G-27/29/31/39/40/42/43/44/45 + G-46~G-58 逐行，G-55 为 G-54 落地不占序）+ 8 反模式 AP-01~08（单后端/泄名/无 conformance/绕接口/仅类型/过度设计/后端爆炸/成本不透明）+ 耦合点审计模板 + 速查卡 + verify.sh 自检 31 项 PASS；★不依附 Proteus 可独立使用；**新一次泛化须先在此登记方法论变更再落地 plan**（★第 10~16 次投影 G-46~G-52 已随决策 #385 补录登记；第 17~18 次投影 G-53/G-54 随决策 #391 登记——G-53 不绑设备供给、G-54 不绑 IDE 形态；第 19 次投影 G-56（自有宿主壳：不绑宿主来源）随决策 #393 登记；第 20 次投影 G-57（可观测性出口：不绑可观测性来源）随决策 #394 登记；第 21 次投影 G-58（插件 API：不绑扩展来源）随决策 #395 登记）；★原稿旧编号已重指向（宿主运行时 G-36→G-39、渲染 conformance G-34→G-27、载体 G-37→G-40、测试框架 G-41→G-44） |
| `docs/proteus-architecture.md`（规约） | 原则 #0-#13.74 + 铁律 + FLD/GLS/RND/NAT/PRIM/AI/CMP 规则 | ✅ **M1.1 已收口 + SPI 八系追加 + G-46~52 并入 + #391~#395 工具链五 plan 并入** | **真理来源**（原则 #0 统一语义收敛根 + 五支柱 + #13.x 可插拔可验证（含 #13.11-13.24 宿主层子原则 + #13.25-13.27 测试验证层 + #13.28-13.30 dev-host + #13.31-56 G-46~G-52 + #13.57-59 G-53 + #13.60-62 G-54 + #13.63-65 G-55 + #13.66-68 G-56 + #13.69-71 G-57 + #13.72-74 G-58）+ 分层/能力/落地三类铁律 + 严格规则 + 分层双路线 + 来源更新规则——合并 architecture-update + 决策链；G-37/38/39/40/41/42/43 SPI 铁律与 CMP017-073、G-44 铁律与 CMP074-081、G-45 铁律与 CMP082-088、G-46~G-52 铁律与 CMP089-146、G-53 与 CMP147-154、G-54 与 CMP155-162、G-55 与 CMP163-170、G-56 与 CMP171-178、G-57 与 CMP179-186、G-58 与 CMP187-194 已并入） |

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
| `proteus-dev-host-plan` | **G-45** | 🟡 **B1-B2 已落地（#369/#370）** | ★**调试基座即宿主（Install-Once Host）**：原则 #0 第九次投影（不绑定基座形态）——打破 uni-app 式「自定义基座循环」（改原生插件 → 云打包 → 重装 → 循环往复，页面越多越慢）：**插件 = DynamicBackendModule 动态装载**（manifest + 签名 + conformance 快检 + factory——门禁链 G45_MANIFEST_INCOMPLETE/G45_SIGN/G45_CONFORMANCE_COVERAGE/G45_CONFORMANCE_FAIL）+ **转发桩 pending 语义**（未装载调用回放，业务零重试零重启——G-32.3 非抛同源）+ **双层产物**（基座 cacheKey = f(框架版本, ABI) 与页面数/插件数无关——构建 O(改动) 非 O(规模)，参考实现 C-07 机器证明：20→150 页 base 构建 0 次重打）；三端分级：Android/鸿蒙全热替换（Tier A：DexClassLoader/HSP）/ iOS 增量重签（Tier B，App Store 2.5.2 诚实边界）/ 模拟先行（Tier C 全端）；NAT-C 八项 + CMP082-088 + 铁律 G-45.1-10 + 原则 #13.28-30；**补丁一/二（#371）**：三态生命周期（dev/release/runtime 显式建模——发布态 ABI 冻结静态链接、运行态仅参数灰度禁代码下发）+ ABI 版本管理（major/minor/patch 三元组 + 兼容矩阵「major 相等 + minor 向后兼容」+ 四类变更处理 + cacheKey 精确化含 manifestHash/signatureChainHash + ABI-01~08 conformance）——铁律扩至 G-45.7-10（签名链同源/manifest 哈希防 MITM/Install-Once 禁宣称线上热更新/运行态禁引入未预注册能力）；**落地**：B1 参考实现 dev-host-reference.cjs（零依赖可跑 12 自检 PASS，verify.sh）+ **B2 `@proteus-vue/dev-host` 真实现**（DevHost/ForwardingStub/BuildCache+planBuild/checkResultShape，zero-dep 11.0kb + 24 用例 + demo 页 dev-host-demo webOnly 五区块交互）+ **补丁落地（#371）**：`src/abi.ts`（checkAbiCompat 兼容矩阵）+ DevHost 三态 mode 门禁（release/runtime 拒绝装载 G45_MODE_FORBIDDEN）+ freezeAbi/registerPushManifest/setFeatureFlag + ABI-01~08 用例 + **B3a（#372）**：推送协议层（信封四类 + canonical 哈希 + token 门禁 + 审计）+ DevServer（pushModule 前置校验/LoadReport 回传/G45_TIMEOUT）+ DeviceLink（完整性复算 + loader 装载模拟）+ connectInMemory 全链 e2e（含 MITM 双向拦截）+ CLI `proteus host push`（前置校验 + 信封生成）；依赖：G-39（调试形态）/G-28（NativeBackend）/G-42（签名网关）/G-38（cacheKey）/G-44（NAT-C 跑 test-ir runner）/G-40（pending 回放批处理零拷贝） |
| `proteus-resource-pool-plan` | **G-46** | 📋 规划（已入库，#385） | ★**宿主级统一资源池（混合 App 内一致性）**：原则 #0 第十次投影（不绑资源容器形态）——G-27 外（渲染）一致性的对偶：三层池（L1 登录态/L2 请求/L3 缓存）+ Cookie⇄Token 双轨自动降级 + **跨页所有权**（G-43 语义应用于登录态/凭证/缓存：页面 Rc 借用/Weak 观察/登出级联清理）+ RSC-01~05 安全（HttpOnly/同源白名单/Token 吊销/SSO 一次性）+ 三平台 Backend 过同一 conformance；铁律 G-46.1-8 + CMP089-096 + OWN-01-10；参考实现 38/38 PASS（verify.sh）；诚实边界：真实原生桥接 B3 待启；★编号避让：原稿「建议顺延 G-47」定案 G-46（决策 #385） |
| `proteus-miniprogram-runtime-plan` | **G-48** | 📋 规划（已入库，#385） | ★**兼容式小程序运行容器**：原则 #0 第十二次投影（不绑小程序运行时形态）——以微信小程序标准为事实标准做「标准运行时内核 + PlatformAdapter SPI」兼容容器：双线程语义（AppService/PageFrame + setData 序列化通道）+ 兼容矩阵 L0-L3（L0+L1 ≥ 90%）+ 能力桥（Capability IR：login/pay/share...）+ **L1 逻辑隔离基线**（scopedToken 凭证派生/存储 AppID 分桶/销毁级联——SBX-L1 集；进程级/配额机制归 G-49）；信任分级（自有/受控/开放）；铁律 G-48.1-8 + CMP103-109 + RT/ADAPT/CAP 套件；参考实现 26/26 + verify 13/13；依赖 G-27/28/39/42/43/44/45/46/47；★与 G-49 去重：07/08 章压缩为 L1 基线 + 前向引用 sandbox-isolation-plan |
| `proteus-sandbox-isolation-plan` | **G-49** | 📋 规划（已入库，#385） | ★**小程序进程级沙箱隔离**：原则 #0 第十三次投影（不绑隔离强度）——IsolationLevel L1 逻辑 / L2 存储权限 / L3 进程 / L4 运行时（V8 isolate/microVM 留 G-50）分层 + **CapabilityBridge 声明式权限网关**（deny-by-default，替代 addJavascriptInterface——业界 9/10 审计坑）+ ResourceQuota（QUOTA_EXCEEDED 走拒绝通道不抛宿主）+ 三平台矩阵（Android android:process / 鸿蒙 Ability / iOS 系统 WebContent 诚实边界 CMP-117）；崩溃隔离/配额承接 G-42、Drop 级联承接 G-43（引用不重述）；铁律 G-49.1-6 + CMP110-117 + SBX-01~08（G-48 的 L1 集另标 SBX-L1）；参考实现 30/30 + verify 14/14（含负向）；**L3 落地 = G-50 开放平台硬前置** |
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
| `@proteus-vue/docs` 文档引擎 | —（官网 B2 核心件） | ✅ **B1 落地（#365）** | Markdown → Docs IR（语义块 AST：标题锚点/代码围栏/列表/表格/引用）→ HTML（docs-* 语义类）/ **Vue SFC**（直喂框架编译器 compileVueSfc——「文档也是编译产物」）+ 零依赖轻量高亮器 + TOC/搜索索引/frontmatter；vite md 虚拟模块接入待下一批 |
| `@proteus-vue/test-ir` 验证语义层 | —（G-44 B1 核心） | ✅ **B1 落地（#367）** | Test IR（可序列化断言八种 + ActOp 十操作 + Profile3D）+ **五官方 TestBackend**（Node/JSI/AOT/Host/Device——supports 门控：breakpoint 设备专属）+ 断言解释器（含 and·or 组合、宽松 eq）+ ConformanceRunner 统一汇总（byBackend）+ 断点矩阵生成器（100 profiles）+ INT-01~05 跨层集成套件 |
| `proteus-testing-framework-plan` | **G-44** | 📋 **规划（已入库，#364）** | ★**验证层第八次泛化**：Test IR（可序列化断言——eq/match/exists/count/throws/**notLeak**（消费 G-43 所有权图）/conforms + ActOp render·transfer·press·resize 等 + Profile3D W×H×F）+ **TestBackend SPI 五官方后端**（Node/JSCarrier/AOT/Host/Device——旧 test-framework 降格为 DeviceBackend 实现）+ **跨层集成 INT 套件**（Compiler→Render→Host→Carrier→Container→Ownership 链路——G-44.3 禁跳过）+ **G-25 三维断点自动化**（100 profiles 参数化生成——G-25 首次被自动化）+ 统一 conformance runner（七套汇总）+ 铁律 G-44.1-6 + CMP074-081；**参考实现 testing-reference.js 零依赖可跑**（断点矩阵 100/100 + 跨层集成 14/14 + 负向用例有牙齿，verify.sh 10/10 PASS）；★编号避让：原稿 G-41 与 host-integration 撞号、CMP067-074 与 ownership 撞号（→G-44 + CMP074-081，决策 #364） |
| `proteus-combined-conformance-plan` | **G-47** | 📋 规划（已入库，#385） | ★**组合一致性 Conformance**：原则 #0 第十一次投影（不绑测试层级）——G-27 Backend × G-46 Pool「单层 PASS ≠ 组合正确」：三类交界处漏洞（会话字段丢失/后端私有资源/切换竞态）+ **六不变量 INV-01~06**（切后端登录态/缓存不丢、登出×切换交换律、并发、同 IR 同视图、降级）+ 接缝测试层（金字塔新增 COMBO 层）+ CCI-01-06 组合层铁律；是 G-44 INT 系列的组合层扩展（INT-A~E 为局部套件标签）；铁律 G-47.1-6（=CCI-01-06）+ CMP097-102；参考实现 23/23 + verify 15/15；依赖 G-27/G-44/G-45/G-46 |
| `proteus-developer-platform-plan` | **G-50** | 📋 规划（已入库，#385，纯 plan） | ★**小程序开发者平台（系列收官）**：原则 #0 第十四次投影（不绑平台/生态形态）——G-48（能跑）+ G-49（安全跑）之上的「开发者界面 + 生态界面」闭环；**A 工具链平台**（04-08：CLI 流水线/脚手架/调试协议/组件工具箱/发布运行时）+ **B 开放生态平台**（09-12：开发者门户/提审审核/分发商店/治理分佣），共用唯一契约工件 **AppPackage**（manifest + 双签名）；双签名（developer+platform，G-45 扩展）+ restricted 人工审核 + append-only 审计 + SettlementSPI（不内置结算）；conformance 39 断言清单（A18 + B17 + 接缝2 + 负向2，文档化）+ selfcheck.cjs 8/8；**B 生态以 G-49 L3 为硬前置**；铁律 G-50.1-8 + CMP118-131 + AP-13~17 |
| `proteus-test-ir-runner-plan` | **G-51** | 📋 规划（已入库，#385） | ★**TestIRRunner 与真运行时验证**：原则 #0 第十五次投影（不绑验证执行环境）——把 G-46~G-50 的 conformance 从文档层落到可运行：**L0 文档自检 / L1 IR 模拟（InMemory）/ L2 真运行时（NativeAdapter 契约：Android 独立进程 / Harmony EcmaVM / iOS WKWebView2）三阶梯度**（前阶是后阶回归）+ execute(suite): report 唯一入口 + DEGRADED/TIMEOUT/QUOTA 状态 + FAIL 分类定位 + runner 回归基线；断言载体 = G-44 Test IR（G-44.1，不引入第二套 IR）；铁律 G-51.1-6 + CMP132-139；参考实现 self-test 36/36 + verify 14/14；依赖 G-44/G-46~G-50 |
| `proteus-cross-device-verification-plan` | **G-52** | 📋 规划（已入库，#385） | ★**跨设备一致性验证**：原则 #0 第十六次投影（不绑设备形态）——同 suite 跨设备结果漂移（screen/os/input/env 四维组合爆炸）→ **等价类划分 + 代表采样 + DriftFingerprint 四维归因 + ε 容差 + 归一化 diff**：DeviceEquivalenceClass / MatrixReport / ProfileSource（云端按需补充，本地优先）；是 G-51 execute() 的设备维度同构扩展 executeOn(matrix, suite)；承接 G-44 Device 后端 + G-25 三维断点先例；铁律 G-52.1-6 + CMP140-146 + INV-D1~D5；参考实现 44/44 + verify PASS=56；云端调度留 G-53 |
| `proteus-mobile-verification-plan` | **G-53** | 📋 规划（#390ii 批次顺带入库，#391 补登记） | ★**移动端验证编排**：原则 #0 第十七次投影（不绑设备供给方式）——解决「机型众多买不起」：一台 Mac 模拟器池化服务化（serve-sim）+ 云真机（¥0.5/分钟）接进 G-51/G-52 验证矩阵；**四档降级链**（in-memory→web/DOM→ios-sim 本地/远程→cloud-device，SKIP≠FAIL）+ **8 等价类清单**（2026 Q1 中国，覆盖≈95%）+ **CoverageGate 覆盖率门槛**（MVP 0.3→发布前 0.9，skipped 列表防黑盒）；铁律 G-53.1-8 + CMP147-154 + INV-M1~M8；参考实现 self-test 41/41 + verify PASS=58；诚实边界：iOS 模拟器无法脱离 Xcode / 模拟器测不了硬件 / 份额为季度快照（G-53.8 禁写死）/ EULA 仅限内部共享 |
| `proteus-devtools-suite-plan` | **G-54** | 📋 规划（已入库，#391） | ★**框架配套开发者工具（编码期）**：原则 #0 第十八次投影（不绑 IDE 形态）——编码期（authoring-time）空白区：框架六类独占知识（IR/分层/断言/拓扑/等价类/渲染语义）工具化；**三层解耦**（能力内核 FrameworkKnowledgeProvider 六纯查询方法唯一 → 协议层 LSP/DAP/自研 RPC → IDE 适配层薄可换）+ **五档降级链**（LSP→DAP→RPC→CLI→raw，SKIP≠FAIL 全挂退 raw）；六项能力 MVP=②分层守护+③断言内联（反馈分钟级→毫秒级）；铁律 G-54.1-8 + CMP155-162 + INV-DT-01~08；参考实现 self-test 51/51 + verify PASS=68；★编号避让：原稿自编 G-55（假想兄弟 plan「DevTools 加固」未入库）→ 重编 G-54、CMP-163~170→155~162、泛化 15→18；诚实边界：⑤⑥ 数据 Mock / 仅 VSCode 参考适配（其余 IDE 未实测）/ RPC 面板不在 MVP |
| `proteus-devtools-landing-plan` | **G-55** | 📋 规划（已入库，#392） | ★**开发者工具落地形态与性能工程（G-54 工程落地，不占泛化序）**：宿主层可换绝不 fork（VSCode 主档/Zed 性能档/Neovim/CLI/Web 兑底——Cursor/Windsurf 停在 VSCode 1.99.3、80+ NVD 漏洞、8+ 工程师合并的结构性滞后实证）+ **内核唯一 Rust 常驻守护进程**（性能瓶颈在内核不在编辑器——增量索引 O(affected) + deps 精确失效 + LRU 淘汰只降性能不丢正确性）+ **六项性能预算确定性断言**（计数阻断/墙钟仅 warn）+ **架构试金石**（加第二宿主不改内核 = apiSurface 冻结 INV-PF-06）；铁律 G-55.1-8 + CMP163-170 + INV-PF-01~08；参考实现 self-test 58/58 + verify PASS=73；★编号避让：原稿 G-56→G-55、CMP-171~178→163~170、原则 #13.60-62 撞号顺延 #13.63-65、泛化"第 16 次"宣称修正（不占序）、计数 66→72 修正；诚实边界：预算为对标目标值未实测 / Zed·Neovim 适配未实现 / 能力⑤⑥ Mock |
| `proteus-studio-plan` | **G-56** | 📋 规划（已入库，#393） | ★**Proteus Studio 自有宿主壳（第 19 次泛化：不绑宿主来源）**——自有与第三方宿主可互换：绝不自研编辑器内核/GUI（G-56.1 红线：xi 已死/Lapce pre-alpha/Floem IME·无障碍不可用实证；集成 CodeMirror 6 + xterm.js+pty + libmpv）+ **StudioShell 仅新增 3 类型**（StudioShell/EmbedStrategy/CompanionLink，其余全复用——SPI-First 复利）+ 四宿主共用内核零改动（架构试金石加强：自有宿主最易开后门，恰最能验证分层）+ **移动端伴侣**（form.mobile 唯一 ✅，L6 探索级）+ 降级五档（mpv-offscreen→mpv-wid→window→web→headless，DEGRADED 不 FAIL）+ 生态边界诚实（不兼容 .vsix/Marketplace，语言智能走 LSP/DAP；插件生态已入库为 **G-58**（#395）；铁律 G-56.1-9（.1 红线无降级）+ CMP171-178 + INV-ST-01~08；参考实现 self-test 67/67 + verify PASS=86；★编号避让：原稿 G-57→G-56、CMP-179~186→171~178、原则 #13.57-59 撞号顺延 #13.66-68、泛化"第 16 次"→第 19 次、G-59 预留取消；诚实边界：libmpv 离屏 FBO 真嵌入需 PoC（决定 device.native 唯一 ✅ 是否成立）/ Tauri 数字为对标未实测 / 移动端伴侣为推演无参考实现 / iOS 跨 App inspect 无先例 |
| `proteus-inspector-plan` | **G-57** | 📋 规划（已入库，#394） | ★**Proteus Inspector（第 20 次泛化：不绑可观测性来源）**——三层叠加：**L0 通用运行时指标**（用宿主已有的 VM Service/Flipper/CDP，绝不重新实现探针）+ **L1 语义增强**（L0 × 框架拓扑——把数字变成带结构的数字，本份核心增量）+ **L2 框架语义**（SPI 拓扑/分层违规/隔离域/conformance 独占数据）+ 扩展协议（ext.<package>.<command>）+ **安全红线**（Debug-only 编译期剔除/localhost+一次性 token/绝不采集用户数据/覆盖率不粉饰）；与 G-19 分工：G-19 是数据源、G-57 是出口协议，不重复造；铁律 G-57.1-8 + CMP179-186 + INV-INSP-01~08；参考实现 self-test 64/64 + verify PASS=83；★编号避让：原稿 G-58→G-57、CMP-187~194→179~186、原则 #13.60-62 第三次撞号顺延 #13.69-71、泛化"第 17 次"→第 20 次；诚实边界：L0 为模拟数据 / 真实宿主接入未实现 / Release 扫描断言未落地 CI |
| `proteus-plugin-api-plan` | **G-58** | 📋 规划（已入库，#395） | ★**Proteus Studio 插件 API 与扩展生态（第 21 次泛化：不绑扩展来源）**——内置功能/官方插件/第三方插件同权：**内置功能走插件 API（G-58.1 红线无降级：apiSurface 快照 S1===S2 机器试金石，VSCode "core built as extensions" 同哲学）**+ 默认零权限（capability 显式声明+白名单+越权 denied 不终止+只读优先——VSCode Extension Host 全权限覆辙不重蹈）+ 声明式优先（Tier 0 零 WASM，Zed "most extensions without Rust code" 同哲学）+ API 只增不改（WIT 版本化并存，稳定版冻结永不修改）+ WASM 崩溃隔离（trap/panic/死循环隔离，资源超限只杀该插件）+ 资源限额强制 + 能力探测纯元数据（G-55 崩溃坑继承：禁发请求试探）+ 提案 API 禁发布（发布期强制校验）；铁律 G-58.1-8（.1 红线）+ CMP187-194 + INV-EX-01~08 + AP-EX-01~07；新增类型仅 4 个（PluginHost/PluginManifest/Capability/ApiVersionSpec）；参考实现 self-test 104/104 + verify PASS=40；★编号避让：原稿 G-59（studio 预留号）→G-58、CMP-195~202→187~194、原则 #13.60-62 第四次撞号顺延 #13.72-74、泛化"第 18 次"→第 21 次；诚实边界：wasmtime 真实集成属阶段 2 / 插件市场签名体系未设计 / 插件间互调阶段 1 有意禁止 |
| `proteus-app-capabilities-plan` | — | ✅ | 应用级能力（hooks/能力检查） |

### L5 交付层

| plan | 编号 | 状态 | 说明 |
|------|------|------|------|
| `proteus-blueprint-plan` | — | ⬜ | 完整业务参考实现（M2 验收载体） |
| `proteus-website-plan` | — | 🟡 **B1-B2 部分落地（#374）** | ★官网 dogfooding：`website/` 应用落地——**文档系统 MVP**（10 篇指南由 @proteus-vue/docs 构建期编译 + 侧边栏 frontmatter 自动生成 + Home/Guide 页）+ **★柔性框架优先（W-6/D-5 新原则）**：响应式全走 v-p-fluid clamp + 柔性网格 auto-fill/minmax，全站零 @media（`verify-llm.cjs` C8 error 门禁，存量 v3 三页 legacy 白名单至 B4）+ v-p-hover 桌面原语；验证：vue-tsc 零错误 + vite build 135KB（gzip 53KB）+ 全部门禁绿；诚实边界：路由用 vue-router（@proteus-vue/router 路由模型面向双端页面工程——差距登记 B4 评估回填）、SSG/sitemap 归 B7、codegen API 页待 types 集成；规范同步：01-website-rearchitecture W-6 / 05-dogfooding D-5 / LLM-DESIGN-RULES+.llmrules C8 / 00-overview 设计原则 7；**B3 内核（#375）**：`/playground` 浏览器内实时编译（同一套 @proteus-vue/compiler——浏览器可跑证零 node 依赖）+ 决策 trace/规则目录同屏（透明编译可交互化）+ 分享链接 base64 可复现 + compiler-sfc 独立 chunk 按需加载 + tests/website-playground 6 用例 + **B4（#376）**：首页深化（数据条 stats.ts 数字可追溯 + 对标矩阵状态诚实标注 + 方法论节）+ **D-2 dogfooding AST 审计 CI**（audit-d2.mjs：第三方 UI/@media/平台 API error + 语义原语统计，`npm run audit:website`）+ Monaco/Worker 评估结论（诚实暂缓） + **#377 审查补强**：p-* 标签真实落地（全局注册 PView/PText/PHeading/PGrid/PStack 等，模板重写，审计 19/52）+ 内容对齐 01-home.md（三大卖点 + 实时 Transform 演示内嵌——TransformDemo 组件含 IR Tab：compiler-backend 新 `./node` 浏览器安全子入口导出真实 CompilerIR） |
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
| `docs/proteus-whitepaper-plan/` | **对外叙事门面（方法论篇，不占 G 序，决策 #385 入库）**：超级应用加固方法论白皮书 v1.0——三大方案（超级应用加固 G-27+46+47 / 小程序生态 G-48+49+50 / 验证体系 G-44+51+52）+ 16 次泛化证据链 + 竞品对标与小米对齐（08 独家）+ 诚实边界；与 positioning-v3（产品/技术门面）分工；方法论/路线 SSOT 已引用化（spi-first + methodology-plan + roadmap，正文不复述） |
| ~~`docs/archive/proteus-positioning-v2.md`~~ | 已删除（决策 #364 尾——v3 为权威门面，v2 零引用归档历史化） |

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
| **G-44.1-6** | 断言必须可序列化（禁闭包逻辑）/ 任一 conformance FAIL 阻断合并 / 跨层集成 100% 无跳过 / 同一 Test IR ≥2 Backend 可执行 / 性能退化 >5% 阻断 / 失败报告含 trace 链 | testing-framework-plan |
| **CMP074-081** | 跨 Backend 同语义结构一致（074）/ .tir.json 进 git（075）/ arrange·act·assert JSON 可序列化（076）/ 跨 Backend 不一致 = 语义分歧必须修复（077）/ 三维断点矩阵必须自动化覆盖（078）/ 新 plan 落地同步 Test IR（079）/ Agent 产物须过 TestBackend 门禁（080）/ 性能基准固化须 Owner 审批（081） | testing-framework-plan |
| **G-45.1-10** | 基座零插件知识 / 未装载调用 pending 非抛（装载后回放）/ 装载即验证（签名 + conformance 快检）/ 双层产物分离（base cacheKey 禁规模因子）/ 动态装载全链可观测 / 商店发布回静态链接（合规边界）/ 签名证书链同源（G-45.7）/ manifest 哈希防 MITM（G-45.8）/ Install-Once 禁宣称线上热更新（G-45.9）/ 运行态禁引入未预注册能力·仅参数灰度（G-45.10） | dev-host-plan |
| **CMP082-088** | 基座禁引用插件（082）/ 未装载调用走 pending 非抛（083）/ manifest+签名缺一拒绝（084）/ 装载必跑快检 FAIL 拒绝+降级（085）/ cacheKey 禁规模因子（086）/ 快检覆盖率≥能力数（087）/ 推送通道 TLS+token+审计（088） | dev-host-plan |
| **G-46.1-8** | 经 ResourceFacade 取登录态禁直读 Cookie（.1）/ 禁手写平台分支（.2）/ 禁绕过网关（.3）/ 登录态 Rc/Weak 所有权、页面销毁归还（.4）/ logout 级联 L1→L3 + 跨页引用（.5）/ Backend 须过 conformance CMP089-096（.6）/ 禁 localStorage 存 Token（.7）/ 动态资源模块同签名链 + manifest 哈希（.8） | resource-pool-plan |
| **CMP089-096** | 共享池访问（089）/ HttpOnly Cookie（090）/ Cookie 同根域双轨（091）/ Token 管控含吊销（092）/ 缓存 origin 分桶（093）/ 白名单（094）/ 吊销即时（095）/ SSO 一次性（096） | resource-pool-plan |
| **G-47.1-6（=CCI-01-06）** | Backend 不缓存 readAuth（01）/ unmount 不触池资源（02）/ 切换原子事务（03）/ 登出与切换串行化（04）/ 不可用后端显式抛错（05）/ 组合 conformance 100% PASS（06） | combined-conformance-plan |
| **CMP097-102** | 不缓存认证视图（097）/ unmount 不触池（098）/ 切换原子（099）/ 登出串行化（100）/ 装载错误显式（101）/ 组合 conformance 100%（102） | combined-conformance-plan |
| **G-48.1-8** | 不绑运行时形态（.1）/ 业务零平台分支（.2）/ 双线程语义不可绕过 setData（.3）/ setData 可序列化（.4）/ 凭证最小化 scopedToken（.5）/ AppID 隔离跨桶拒绝（.6）/ 降级不崩溃（.7）/ 装载即验证（.8） | miniprogram-runtime-plan |
| **CMP103-109** | 凭证最小化（103）/ AppID 隔离（104）/ 代码包签名 + manifest 哈希（105）/ 销毁级联（106）/ 能力白名单（107）/ 敏感能力需用户触发（108）/ L1 逻辑隔离诚实边界（109） | miniprogram-runtime-plan |
| **G-49.1-6** | deny-by-default（.1）/ 无开放 bridge（.2）/ 跨小程序零共享 ISOLATION_BREACH（.3）/ Drop 级联（.4）/ 配额超限不抛宿主（.5）/ 三平台机制差异诚实边界（.6） | sandbox-isolation-plan |
| **CMP110-117** | MANIFEST_INVALID（110）/ PERMISSION_DENIED（111）/ QUOTA_EXCEEDED（112）/ INVALID_APP_ID（113）/ ISOLATION_BREACH（114）/ TOKEN_EXPIRED（115）/ SANDBOX_CRASHED（116）/ 平台差异诚实边界（117） | sandbox-isolation-plan |
| **G-50.1-8** | 审计是发布硬前置（.1）/ packageId 资源隔离（.2）/ 拒绝是业务错误（.3）/ 运行时仅信任双签名（.4）/ restricted 强制人工审核（.5）/ 撤销优雅终止（.6）/ 审计 append-only（.7）/ B 生态以 G-49 L3 为硬前置（.8） | developer-platform-plan |
| **CMP118-131** | 审计失败阻断 publish（118）/ packageId 隔离（119）/ 配额拒绝是业务错误（120）/ 双签名必填（121）/ restricted 人工审核（122）/ 撤销优雅终止（123）/ 审计 append-only（124）/ B 需 G-49 L3（125）/ 密钥轮换（126）/ 灰度隔离（127）/ hotfix 禁新增能力（128）/ 全局配额池（129）/ manifest 一致（130）/ 负向有判别力（131） | developer-platform-plan |
| **G-51.1-6** | execute 唯一入口（.1）/ 降级不崩溃 DEGRADED（.2）/ 报告必有 total（.3）/ FAIL 有分类定位（.4）/ Report 可序列化（.5）/ runner 回归基线（.6） | test-ir-runner-plan |
| **CMP132-139** | execute 返回 Report（132）/ DEGRADED（133）/ Report total（134）/ 超时可恢复（135）/ ISOLATION_BREACH 分类（136）/ 可序列化（137）/ 回归基线（138）/ 接缝+隔离组合命题（139） | test-ir-runner-plan |
| **G-52.1-6** | 等价类覆盖优先（.1）/ ε 比对禁 ===（.2）/ FAIL 归因四维（.3）/ 归一化可 diff（.4）/ 本地优先（.5）/ 基线版本化（.6） | cross-device-verification-plan |
| **CMP140-146** | 等价类+代表采样（140）/ ε 容差（141）/ 指纹四维归因（142）/ 归一化可 diff（143）/ 本地优先（144）/ 基线版本化（145）/ 跨层接缝组合命题（146） | cross-device-verification-plan |
| **G-53.1-8** | 平台不可用 SKIP / 能力缺失 DEGRADED+missing / 覆盖率不虚报 / 报告带 skipped / 自动选档 / 额度耗尽不阻断 CI / 模拟器不宣称硬件 / 份额数据不写死 | mobile-verification-plan |
| **CMP147-154** | 平台不可用 SKIP 不崩（147）/ DEGRADED+missing（148）/ 自动选档（149）/ 份额上限 1（150）/ 空覆盖阻断（151）/ SKIP 不计 PASS（152）/ 额度降级（153）/ skipped 列表（154） | mobile-verification-plan |
| **G-54.1-8** | 内核唯一（FrameworkKnowledgeProvider 单实现）/ 适配器只做翻译 / SKIP≠FAIL / 越层必报豁免显式 / 断言必带定位 / 循环可检测不崩溃 / 不重复 G-19 / 数字不虚报 | devtools-suite-plan |
| **CMP155-162** | 跨适配器一致（155）/ 未知能力 SKIP（156）/ 语义导航达后端（157）/ 越层必报+豁免不误报（158）/ 断言带定位（159）/ 环可检测（160）/ 影响面可列（161）/ 全挂降 raw（162） | devtools-suite-plan |
| **G-55.1-8** | 绝不 fork 编辑器 / 适配器只翻译 / 内核常驻增量索引 / 缓存失效精确到 deps / 内核 API 冻结 / 性能断言确定性（计数阻断墙钟 warn）/ 数字不虚报 / 宿主缺能力 SKIP 非错误 | devtools-landing-plan |
| **CMP163-170** | 适配器零业务逻辑（163）/ 无宿主 SKIP（164）/ 增量 O(affected)（165）/ 命中后零重算（166）/ 精确失效（167）/ 加宿主不改内核（168）/ 确定性判定（169）/ LRU 正确性（170） | devtools-landing-plan |
| **G-56.1-9** | 禁自研编辑器·GUI（红线）/ 自有宿主无特权 / 坐标归一化 / 风险如实上报 / Linux 默认 Web 降级 / 嵌入降级不崩 / AX 树优先 / 数字不虚报 / 生态边界诚实 | studio-plan |
| **CMP171-178** | 加宿主不改内核（171）/ 禁自研（172）/ 归一化（173）/ unknown≠hw（174）/ 降级不崩（175）/ 四宿主共内核（176）/ AX 替代截图（177）/ 移动端唯一（178） | studio-plan |
| **G-57.1-8** | 叠加不替代 / L1/L2 只增益不减损 / 扩展命名合规 / Release 编译期剔除 / localhost+token / 绝不采集用户数据 / 覆盖率不粉饰 / 不绑可观测性来源 | inspector-plan |
| **CMP179-186** | L0 独立性（179）/ 降级不减损（180）/ 命名规范（181）/ 语义关联（182）/ 可序列化（183）/ Debug-only（184）/ 鉴权（185）/ 宿主无关（186） | inspector-plan |
| **G-58.1-8** | 内置功能走插件 API（红线）/ 默认零权限只读优先 / 声明式优先 / API 只增不改 / 崩溃隔离 / 资源限额强制 / 探测纯元数据 / 提案 API 禁发布 | plugin-api-plan |
| **CMP187-194** | 快照不变（187）/ 未声明拒绝（188）/ Tier 0 零实例（189）/ WIT 冻结（190）/ 崩溃隔离（191）/ 限额强制（192）/ 探测纯元数据（193）/ 提案禁发布（194） | plugin-api-plan |
| 分层铁律 | L1 先于 L3 / 禁跨层反向依赖（并行化前提） | roadmap-2 §6 |

---

## 5. 状态速览（一句话）

- **已落地**：G-02/03/04/05/06/08/10/12/13/14/15/16/17/18/19/20/21/22/22.5 + L2 引擎 + L4 工具链（≈ 20 个板块）
- **★已落地（近期批次）**：G-27 B6 混合渲染（决策 #328）→ G-24 B1 桌面原语（决策 #329）→ G-29 B2 RustBackend（决策 #330）→ **G-27 可视化 demo 页 + E2E（决策 #331）** → **G-29.1 真实文件双端等价门禁 81 用例（决策 #332）** → **G-29 编译器插拔消费点（决策 #333）** → **G-38 B1/B2-Node（决策 #334）** → **G-38 B2 尾（决策 #335）** → **G-38 B3 前置·真 IncrementalSession（决策 #336）** → **G-24 B2 系统集成四件套（决策 #337）** → **G-24 B3 导航结构（决策 #338）** → **G-24 B4 生命周期/设备（决策 #339：G-24 家族 B1-B4 全收官，desktop 17 模块）** → **G-40 执行载体 plan 整合入库（决策 #340）** → **宿主层三 plan 整合入库 G-41/42/43（决策 #341）** → **G-41 B1-B5（决策 #342-#346：nodeOps Dispatcher / Host Conformance 32 项 / 真实 Vue3 createRenderer 接入 / WebHostRuntime / 热切换三策略）** → **G-42 B1-B5（决策 #347-#351：容器 SPI / StackContainer / Conformance 38 项 / SuperAppContainer / 仓库治理 CLI）** → **G-43 B1-B2（决策 #352-#353：Owned 所有权类型 / 借用检查器 B 规则集）** → **G-43 B3（决策 #354：页面所有权上下文——G-42 五原子销毁第 3 步委托 Drop 协议：forceDrop + Managed 自动释放 + 配额归零，StackContainer/SuperAppContainer ownership 接入）** → **G-43 B4 数据层（决策 #355：DevTools 所有权图——graph mutation 事件流 + 历史时间线/计数器采样 + 四类检测（泄漏路径/长期借用/跨页强引用/无主资源）+ alloc-drop 配对，V-01~V-07）** → **G-43 B4 面板 UI（决策 #356：devtools 第十视图 Ownership——renderOwnership + tracer + 本地/Proteus.ownership 远程双通道 + install 缺省挂全局单例图）** → **G-43 B5（决策 #357：PSS 编译器支持——pragma 三级声明 + P1~P9 限制 + CMP071 ref(Owned) 拦截 + insertScopeDrops 自动 drop + runPss 管线 + B-07/B-08 补全 + useOwned/useBorrow 响应式集成）** → **G-42 B6（决策 #358：其余 4 容器落地——SinglePage 单槽/Embedded 宿主挂载/Window 多窗口/MiniProgram 导航语义+tab 保活+L1 沙箱 + conformance 能力门控扩展（C-04/C-06），六容器画像全部可运行零 FAIL）** → **G-41 B6（决策 #359：宿主×引擎组合矩阵——6×6=36 组合 Tier 声明 + 组合级 conformance（语义指纹/控件映射/热切换等价）+ Tier 1 13 组全验证 failed===0）** → **G-36 B1（决策 #360：MCP Server——新包 @proteus-vue/mcp：11 工具/5 Resources/3 Prompts/CMP021 策略，传输无关核心，数据源全 SSOT 派生）** → **G-36 B2（决策 #361：Agent Kit SDK——新包 @proteus-vue/agent：IRBuilder 不绑 LLM 构造 IR + generateCode 规则引擎 + withProteusRules + intent-to-flex 规则引擎版 + LlmLike 可注入——降级策略成立）** → **G-36 B3（决策 #362：migrate-miniprogram Skill——G-31 B6 codemod 复用 + wx.* API 扫描 + CMP019 映射日志（tag/api × auto/manual）+ 覆盖率 + AgentKit.migrate 门面）** → **G-36 B4（决策 #363：三层护栏 + 自修复循环——L1 IR Schema/L2 风格（裸色值 token 反查/wx.*/命名）/L3 六端 conformance（经 MCP 协议面）；diagnose 五类；repairSource design-token-fix 策略；generateWithRetry 上限 3 超限转人工）** → **G-44 整合入库（决策 #364：自动化测试框架第八次泛化——Test IR + TestBackend SPI 五后端 + 跨层集成 INT 套件 + G-25 三维断点自动化 100 profiles + 统一 conformance runner；编号避让 G-41→G-44、CMP067-074→CMP074-081；陈旧 00-12 副本删除；参考实现零依赖真跑 verify.sh 10/10）** → **G-46~G-52 七 plan + 白皮书整合入库（决策 #385：resource-pool / combined-conformance / miniprogram-runtime / sandbox-isolation / developer-platform / test-ir-runner / cross-device-verification + docs/proteus-whitepaper-plan（非 G 序）——编号避让统一 CMP089-146 连续段 + 原则 #13.31-56 + 铁律 G-46~G-52 + 泛化序修正 10-16 + G-48×G-49 沙箱去重 + 白皮书引用化去重；facade G 表 v3.11）** → **G-53 补登记 + G-54 devtools-suite 整合入库（决策 #391：mobile-verification 孤儿 plan 补登记——泛化序修正 15→17 + 铁律 G-53.1-8/CMP147-154/原则 #13.57-59 并入规约；devtools-suite 原稿 G-55→G-54 编号避让——CMP-163~170→155~162 + 泛化 15→18 + 铁律 G-54.1-8/原则 #13.60-62 并入 + rules 编号避让登记 + README 补建 + CHECKSUM 重算；假想「DevTools 加固」未入库降级为未编号规划，消费面前指 G-51/G-52；facade G 表 v3.12，docs/*-plan 69→71）** → **G-55 devtools-landing 整合入库（决策 #392：G-54 工程落地不占泛化序——宿主适配不 fork + Rust 常驻内核 + 确定性性能预算 + 架构试金石；编号避让原稿 G-56→G-55 + CMP-171~178→163~170 + 原则 #13.60-62 撞号顺延 #13.63-65；facade v3.13，docs/*-plan 72）** → **G-56 studio 整合入库（决策 #393：Proteus Studio 自有宿主壳——第 19 次泛化（不绑宿主来源）+ 绝不自研编辑器/GUI 红线 + 四宿主共用内核零改动 + 移动端伴侣 + 生态边界诚实；编号避让原稿 G-57→G-56 + CMP-179~186→171~178 + 原则 #13.57-59 撞号顺延 #13.66-68 + G-59 预留取消；facade v3.14，docs/*-plan 73）** → **G-57 inspector 整合入库（决策 #394：Proteus Inspector 三层可观测性叠加——第 20 次泛化（不绑可观测性来源）+ 叠加不替代 + L1 语义增强 + 安全红线；编号避让原稿 G-58→G-57 + CMP-187~194→179~186 + 原则 #13.60-62 第三次撞号顺延 #13.69-71；facade v3.15，docs/*-plan 74）** → **G-58 plugin-api 整合入库（决策 #395：Proteus Studio 插件 API 与扩展生态——第 21 次泛化（不绑扩展来源）+ 内置功能走 API 红线 + 零权限 + WIT 版本化 + WASM 隔离；编号避让原稿 G-59（studio 预留号）→G-58 + CMP-195~202→187~194 + 原则 #13.60-62 第四次撞号顺延 #13.72-74；studio 前向引用（G-59/预留段）兑现闭合；facade v3.16，docs/*-plan 75）**；**待启**：G-24 余项并入 G-32（B4+ 原语由 capability/G-32 承接）→ G-38 B3（Rust native——先定 template parse 策略）→ G-29 B3（WASM Playground）→ **G-44 B1（Test IR + SPI 骨架落地）/ G-36 B5 adapt-device Skill / B6 评测集 / G-37 RenderBackend SPI B1 / G-39 Host Runtime B1 / G-40 Execution Carrier B1** → **G-42 真实 App 验证（需生产 App）/ G-43 B6（跨设备转移——需真机环境）** → **G-46~G-52 B 批次（G-46 B2 真实原生桥接 Backend / G-48 真双线程+分包 / G-49 L3 真进程隔离（G-50 B 生态硬前置）/ G-51 NativeAdapter 阶段 2 / G-52 真机 profile 库与云端调度 G-53）**
- **方向调整（G-31）**：小程序组件/API 从「一等公民」降级为 **Layer 1 兼容层**（现有 built-in-components proteus-* 模拟 + wx.* 入口 → compat-miniprogram 演进方向）；源码入口语义化（C-IR）
- **规划（中期）**：G-25 全终端 / G-28 原生后端 / G-26 度量 / G-23 AI Agent / G-29 编译器后端 / G-30 Universal
- **远期**：FlutterBackend（关键路径唯一不确定项）/ 生态 / benchmark

---

*Board Inventory v2 · 2026-09 · 与 positioning-v3 / roadmap.md / roadmap-2-plan 口径对齐*
