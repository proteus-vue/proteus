# Proteus Architecture（全局缝合规约）

> **本文件是 18 份落地文档的唯一顶层规约（Single Source of Truth）。**
> 任何层级的命名、scope、依赖方向、分批编号，均以本文件为准；各 plan 只允许引用、不得重定义。

---

## 0. 文档体系版本

- **框架对外名称**：Proteus
- **npm scope**：`@proteus-vue`（与 GitHub org `proteus-vue` 对齐，避开被占用的 `@proteus`）
- **文档版本**：v3.16（本批追加：G-58 plugin-api，决策 #395）
- **规约文档数**：18 份原始 plan（G-01~G-20）+ 15 份新增 plan（G-21~G-35 追加）+ 10 份 SPI/宿主/验证 plan（G-36~G-45 追加）+ 7 份本批 plan（G-46~G-52 追加）+ 2 份验证/工具 plan（G-53/G-54 追加，决策 #391）+ 1 份落地 plan（G-55 追加，决策 #392）+ 1 份宿主 plan（G-56 追加，决策 #393）+ 1 份可观测 plan（G-57 追加，决策 #394）+ 1 份生态 plan（G-58 追加，决策 #395）+ 本规约 + 1 份原则补充（design-principle）

---

## 1. 分层（L0 地基 → L5 门面）

```
L0 类型契约 : types            ← 所有层的依赖根，不得依赖任何业务层
L1 编译内核 : compiler
L2 运行时   : pinia / router / api / component / platform / lifecycle / module
L3 基建      : cli / testing / devtools / build
L4 横切      : security / i18n
L5 验证+门面 : blueprint / website / test-framework
```

**依赖方向铁律（单向，禁止回边）**：
- `L(n)` 只能依赖 `L(<n)`；同层之间**只允许通过 `contracts.ts` 通信**
- `types` 是纯类型层（`import type` only），**零运行时依赖**
- 业务层**禁止 import `types/internal/*`**，只消费 `@proteus-vue/types` 公开 API

---

## 2. 包名注册表（唯一，全量统一为 @proteus-vue）

> 18 份文档中所有包名 **已全量统一为 `@proteus-vue/*`**（共 120 处 token，v3.0 批量回填完成；校验：`grep -rE "@proteus/"` 零残留）。

### L0 类型契约
| 包名 | 职责 | 对应 plan |
|------|------|-----------|
| `@proteus-vue/types` | 全局类型 Registry + Zod schema + Platform 判别联合 | types |
| `@proteus-vue/contracts` | 跨层共享 DTO（`RouteRecord`/`StoreSnapshot`/`ApiResponse`/`CapabilityDescriptor`） | types §07 |

### L1 编译内核
| 包名 | 职责 |
|------|------|
| `@proteus-vue/compiler` | SFC parser → IR → 三端 codegen |
| `@proteus-vue/css-compat` | CSS 跨端兼容（G-21）：--strict-css 校验 CSS001-012 + 编译期重写 + css-compat-report（纯逻辑零运行时依赖） |
| `@proteus-vue/source-map` | 源码映射（DevTools 跳转用） |

### L2 运行时
| 包名 | 职责 |
|------|------|
| `@proteus-vue/pinia` | 全局状态 + 分片 + 持久化 |
| `@proteus-vue/router` | 路由 + 分包 + 守卫 |
| `@proteus-vue/api` | 请求/拦截/缓存/签名 |
| `@proteus-vue/components` | `p-*` 组件库（Web ↔ Skyline 映射） | component |
| `@proteus-vue/built-in-components` | 框架内置组件（微信内置组件为基准；Web 模拟/Skyline 原生/App v0.6，决策 #162 拆包） | component |
| `@proteus-vue/platform` | 平台判别 + 能力探测 + `PlatformAPI` |
| `@proteus-vue/lifecycle` | 应用/页面生命周期编排 |
| `@proteus-vue/module` | 模块化 + 依赖图 + 循环检测 |

### L3 基建
| 包名 | 职责 |
|------|------|
| `@proteus-vue/cli` | `proteus` 命令面 |
| `@proteus-vue/vite-plugin` | Build 唯一入口 |
| `@proteus-vue/devtools-runtime` | TraceBus + 六源采集 |
| `@proteus-vue/devtools-panel` | 调试 UI（时间轴/快照/火焰图） |
| `@proteus-vue/test-utils` | wx mock / createMockContext |

### L4 横切
| 包名 | 职责 |
|------|------|
| `@proteus-vue/security` | 加密存储/凭证/权限 |
| `@proteus-vue/i18n` | ICU 消息 + Loader + Audit |

### L5 验证 + 门面
| 包名 | 职责 |
|------|------|
| `@proteus-vue/blueprint` | Proteus Music 150 页验证应用 |
| `@proteus-vue/website` | 官网（dogfooding） |
| `@proteus-vue/test-framework` | 统一测试框架 |

### 第三方类型（**不重复造**，铁律 #6）
| 用途 | 包 | 说明 |
|------|-----|------|
| 小程序 API/构造器 | `miniprogram-api-typings` | `wx.*` / `App`/`Page`/`Component` → 命名空间 `WechatMiniprogram` |
| WXML 标签属性 | **Proteus 自建 schema** | 官方 d.ts 不管模板层，归 Compiler 的 `MpComponentSchema` |

---

## 3. 全局铁律（v3.0 = 9 条，全 18 份共享）

```
#1  单一事实源（全局 Registry）
#2  Platform 判别联合（无 any）
#3  端能力静态可分析
#4  渐进式适配
#5  源码即文档（Zod + 示例）
#6  第三方类型复用（miniprogram-api-typings，不重复造）
#7  向后兼容（major 版本化 + deprecation）
#8  分层锁定（import 方向单向，types 零运行时依赖）
#9  跨层一致性（同名必同义，契约先行 → contracts.ts）
```

任何 plan 新增约束**必须追加到本列表**，禁止在本地重新编号。

---

## 4. 全局分批编排（唯一执行序，杜绝跨 plan 批次号冲突）

> **批次命名空间隔离**：每份 plan 内部仍用 B1-Bn，但**全局执行序**由下表 `G-xx` 定义。LLM 执行时按 `G` 序号推进，同一 `G` 内的批次可并行。

| G 序 | 批次 | 依赖 | 产出（地基验证点） |
|------|------|------|-------------------|
| **G-01** | types B1-B3 | — | Registry + schema + Platform 判别联合 |
| **G-02** | compiler B1-B3 | types G-01 | parser → IR → 最小 codegen |
| **G-03** | types B8（官方 typings 整合）+ platform B1 | G-01, G-02 | `wx.*` 继承官方类型 |
| **G-04** | pinia B1 / router B1 / api B1 | types G-01 | 三个运行时骨架（可并行） |
| **G-05** | lifecycle B1 + module B1 | G-04 | 生命周期 + 模块化 |
| **G-06** | component B1-B3（p-* + WXML schema） | G-02, G-04 | 组件映射 + 模板类型 |
| **G-07** | cli B1 + testing B1 + test-framework B1 | G-02 | CLI 骨架 + Vitest + wx mock |
| **G-08** | devtools B1（TraceBus） | G-04, G-07 | 唯一采集汇聚点 |
| **G-09** | security B1 + i18n B1 | types G-01 | 加密存储 + ICU catalog |
| **G-10** | compiler B4-B6 + types B4-B7 | G-02, G-06 | 优化 + 校验 + super-app |
| **G-11** | build B1-B5 | G-02, G-10, G-07 | Vite 插件 + 多入口 + 分包 |
| **G-12** | router M7.1/M8.4 + module B5 + api A1-A4 | G-04, G-06 | 强类型钩子（对齐 types §04） |
| **G-13** | devtools B2-B9 + build B6-B8 | G-08, G-11 | 面板功能 + CI 矩阵 + 缓存 |
| **G-14** | security B2-B8 + i18n B2-B7 | G-09, G-12 | 权限树 + RTL + Audit |
| **G-15** | build B9-B10 + testing 全量 | G-11, G-13 | 体积预算 + 快照 + 契约门禁 |
| **G-16** | blueprint B1-B5（骨架 + 核心模块 30 页） | G-12, G-15 | 播放器跨 5 层跑通 ✅ |
| **G-17** | blueprint B6-B10（交易/IM/内容 + 验收） | G-14, G-16 | 150 页全量 + audit < 12s |
| **G-18** | website B1-B5（文档站 + Playground） | G-15, G-16 | 官网 dogfooding |
| **G-19** | website B6-B8 + test-framework E2E | G-17, G-18 | 展示 Blueprint 成果 |
| **G-20** | 全量回归 + CrossLayerChecker + changeset 发布 | 全部 | **v1.0 可发布** |
| **G-21** | css-compat B1-B3（CSS 跨端兼容矩阵 + --strict-css + 编译期重写） | G-02/G-10（Compiler CSS 管线） | 四级兼容矩阵 + lint 规则 + 语义组件 |
| **G-22** | app-renderer M1-M6（Custom Renderer + JSI 骨架 + p-* 原生映射） | G-06（Component）、G-21 | 原生视图树 + Glass L3 + 三端一致 |
| **G-23** | safe-area M1-M5（p-safe 语义 + 灵动岛 + 五端 insets + 玻璃联动） | G-22、G-21 | 安全区/灵动岛避让 + CSS013-015 |
| **G-24** | memory-plan M1-M6（四层治理 + Owner/Disposer/Budget + 可回收视图 + JSI 引用） | G-06（Component）、G-22 | 可验证回收 + 峰值可追溯 |
| **G-25** | memorial（纪念日一键置灰） | G-21（滤镜管线） | 声明式灰度，五端同步 |
| **G-26** | skeleton（骨架屏自动生成，与 IFR 同源） | G-10（Compiler IR）、G-25 | 骨架 IR 与真实 IR 同源 |
| **G-27** | theme + fontscale（主题 token + 字体缩放） | G-21、G-25 | 语义 token + 系统联动 + 无闪屏 |
| **G-28** | cache（L0-L3 分层缓存 + 字节预算） | G-24（Memory） | 四层缓存 + 淘汰 + 防 OOM |
| **G-29** | glass（液态玻璃 L1-L3 跨端：pg-glass + 平台映射 + 降级） | G-06（Component）、G-22（App Renderer） | L1 必达 + 降级不崩溃 + L3 系统级 |
| **G-30** | performance（AOT 预编译 + IFR 静态首帧 + Worklet 隔离） | G-10（Compiler IR）、G-22（App Renderer） | 首屏 <200ms + 手势 60fps |
| **G-31** | style-safety B1-B4（样式运行时安全：白名单 + Validator + 编译期推导 + 五端闸门） | G-21（CSS 矩阵）、G-22（App Renderer patchStyle） | 非法样式值永不抵达原生 + 静态推导覆盖率 > 80% |
| **G-32** | router-plus（严格路由：配置校验 + 导航映射 + 转场事务 + deep link） | G-12（Router 强类型）、G-22 | 路由层 Style Safety 接入 + 转场不 crash |
| **G-33** | cli-plus（严格 CLI：编译管线 + dev server + strict 开关） | G-07（CLI 骨架）、G-21/G-31 | CLI 集成 strict 门禁 + 增量编译 |
| **G-34** | devtools-plus（HMR + DevTools 协议 + 可视化） | G-08（TraceBus）、G-31、G-33 | HMR 生效 + Style Safety 闸门可见 |
| **G-35** | app-config（应用全局配置：运行时配置 + 远端更新 + 五端存储） | G-27（theme）、G-28（cache）、G-25 | 应用级配置统一管理 + 可远端更新 |
| **G-36** | ai-agent（AI Agent 接入：MCP Server + Agent Kit + 4 Skill + Guardrails） | G-29、G-31、G-32 | AI 产出符合柔性 IR 的标准代码 + conformance 准入 |
| **G-37** | render-backend-spi（G-27 RenderBackend SPI 规范：18 方法 + conformance 42 + 参考实现） | G-27、G-29、G-32 | 任何渲染后端实现 SPI + 过 conformance = 合规（G-27 可执行落地） |
| **G-38** | compiler-backend-spi（G-29 CompilerBackend SPI 规范：parse/transform/emit + 增量 + conformance 42） | G-29、G-32 | 任何编译后端实现 SPI + 过 conformance = 合规（与 G-37 同形） |
| **G-39** | host-runtime-spi（宿主运行时 SPI：生命周期/线程/JS 引擎/原生桥 + L0-L4 职责矩阵 + conformance 42） | G-27、G-28、G-29、G-30 | 运行载体唯一拥有者 + 跨层合法 + conformance 准入 |
| **G-40** | execution-carrier（执行载体 SPI：JSICarrier/AOTCarrier 双参考实现 + 批处理差分 + 零拷贝通道 + 实时逃逸 + conformance） | G-39、G-37、G-38 | 执行载体可插拔（JSI 只是当前默认载体）+ JSI 边界治理 + 实时能力原生闭环 |
| **G-41** | host-integration（宿主接入契约 + Vue 绑定架构：三方正交 + nodeOps Dispatcher 热切换/混合渲染 + conformance 32 H-01~H-08） | G-27、G-39、G-40、G-38 | 宿主接得进去（未过 host-conformance 不得上线）+ Vue 代码换引擎零改动 |
| **G-42** | host-container（宿主容器 SPI + 页面生命周期：五层容器栈 + 六容器策略 + 五原子销毁 + 严禁 fork + conformance 38） | G-39、G-41、G-40、G-27 | 页面组织不绑容器形态 + IR 单一 Owner 消灭栈泄漏 + 超级应用隔离 |
| **G-43** | ownership（资源所有权 SPI + 内存治理：Owned/Borrow/Weak + 借用检查器 PSS + 确定性 Drop + 所有权图 conformance 42） | G-42、G-40、G-39、G-38 | GC 盲区资源归谁清晰 + 泄漏可定位 + 跨设备所有权转移 |
| **G-44** | testing-framework（测试方法论：Test IR 可序列化断言 + TestBackend SPI 五后端（Node/JSI/AOT/Host/Device）+ 八次泛化 + conformance 统一 runner） | G-27、G-29、G-39、G-40、G-41、G-42、G-43、G-25 | 验证层可插拔（同一 Test IR 多后端执行报告一致）+ 跨层集成自动化 + G-25 三维断点首次自动化 + 性能基准门禁 |
| **G-45** | dev-host（调试基座即宿主：Install-Once Host + 动态后端装载 + 转发桩 pending 语义 + 双层构建缓存 + 装载即验证 conformance） | G-39、G-42、G-28、G-38、G-44 | 基座与插件解耦（改原生插件零重打基座，baseRebuildCount=0 机器证明）+ 构建时间 O(改动) 非 O(规模) + 动态模块装载即验证 |
| **G-46** | resource-pool（宿主级统一资源池：登录态/Cookie/Token 三层池 + 双轨降级 + 跨页所有权 + RSC 安全 + conformance 38） | G-27、G-39、G-42、G-43、G-44、G-45 | 内（数据）一致性 = G-27 外（渲染）一致性的对偶——切端数据链不断 + CMP089-096 |
| **G-47** | combined-conformance（组合一致性：G-27 Backend × G-46 Pool 交界 + 接缝测试层 + 六不变量 + 23 断言） | G-27、G-44、G-45、G-46 | 单层 PASS ≠ 组合正确——切后端登录态/缓存不丢（INV-01~06 机器化）+ CMP097-102 |
| **G-48** | miniprogram-runtime（兼容式小程序运行容器：标准运行时内核 + PlatformAdapter SPI + 兼容矩阵 L0-L3 + L1 逻辑隔离） | G-27、G-28、G-39、G-42、G-43、G-44、G-45、G-46、G-47 | 以微信小程序标准为事实标准——平台差异全封装 Adapter、内核零改动 + CMP103-109 |
| **G-49** | sandbox-isolation（小程序进程级沙箱隔离：IsolationLevel L1-L4 + CapabilityBridge 权限网关 + ResourceQuota + 三平台矩阵） | G-42、G-43、G-45、G-46、G-47、G-48 | 一个恶意小程序拖不垮宿主——机制强制隔离（L3 进程 = G-50 硬前置）+ CMP110-117 |
| **G-50** | developer-platform（小程序开发者平台：A 工具链 + B 开放生态，共用 AppPackage + DeveloperPlatform SPI + 双签名） | G-48、G-49（L3 硬前置）、G-44、G-45 | 从「能跑/安全跑」到「开发→审核→发布→治理」生态闭环 + CMP118-131 |
| **G-51** | test-ir-runner（TestIRRunner 与真运行时验证：L0 文档 / L1 IR 模拟 / L2 真机三阶梯度 + NativeAdapter 契约） | G-44、G-46、G-47、G-48、G-49、G-50 | 验证执行环境可插拔——断言从文档层落到可运行 + CMP132-139 |
| **G-52** | cross-device-verification（跨设备一致性验证：DeviceEquivalenceClass + DriftFingerprint 四维归因 + ε 归一化 diff） | G-51、G-44、G-25、G-46~G-50 | 同 suite 跨设备结果稳定——等价类替代穷举（INV-D1~D5）+ CMP140-146 |
| **G-53** | mobile-verification（移动端验证编排：模拟器池化 + 云真机 + CoverageGate 覆盖率门槛） | G-51、G-52 | 设备供给可插拔——本地/池化/云四档降级统一调度（INV-M1~M8）+ CMP147-154 |
| **G-54** | devtools-suite（框架配套开发者工具·编码期：FrameworkKnowledgeProvider 六项能力内核 + LSP/DAP/RPC/CLI/raw 五档适配） | G-19、G-50、G-51、G-53 | 编码期辅助——分层守护/断言内联先行（INV-DT-01~08）+ CMP155-162 |
| **G-55** | devtools-landing（开发者工具落地形态与性能工程：G-54 的工程落地——宿主适配绝不 fork + Rust 常驻内核 + 确定性性能预算） | G-54、G-51、G-53、G-27 | 性能与不绑定 IDE 不冲突——内核唯一常驻 + 宿主可换（INV-PF-01~08）+ CMP163-170 |
| **G-56** | studio（Proteus Studio 自有宿主壳：第四宿主 + 移动端伴侣——Tauri 壳 + CodeMirror 6 + libmpv 设备嵌入，内核零改动） | G-55、G-54、G-53 | 自有宿主不享有内核特权——宿主来源可换（INV-ST-01~08）+ CMP171-178 |
| **G-57** | inspector（Proteus Inspector：三层可观测性叠加——L0 宿主探针 / L1 语义增强 / L2 框架语义，出口协议化） | G-19、G-51、G-54、G-56 | 可观测性来源可换——叠加不替代（INV-INSP-01~08）+ CMP179-186 |
| **G-58** | plugin-api（Proteus Studio 插件 API 与扩展生态：PluginHost + 能力权限模型 + WIT 版本化，WASM 隔离） | G-56、G-55、G-54、G-51 | 扩展来源无关——内置功能走同一 API（INV-EX-01~08）+ CMP187-194 |

> **追加说明（v3.2）**：G-21~G-30 为 2026-08 新增 10 份 plan（css-compat / app-renderer / safe-area / memory-plan / memorial-skeleton / app-capabilities / test-framework / types-plus / glass / performance）的全局执行位。其中 test-framework 已并入 G-07、types-plus 已并入 G-01（B1-B2 先行），不再单独占位。各 plan 声称的旧编号（css G-04、renderer G-05、safe-area G-05/G-08、memorial G-11/G-12、app-capabilities G-13~G-15、glass 里程碑 G-04~G-18、performance G-10/G-05）与本表冲突，一律以本表为准（对应关系：css→G-21、renderer→G-22、safe-area→G-22/G-23、memorial→G-25/G-26、theme/fontscale→G-27、cache→G-28、glass→G-29、performance→G-30）。

> **追加说明（v3.3）**：style-safety（样式运行时安全，2026-08 新增 plan）并入本表 **G-31**。其文档声称的 G-16 与 blueprint（G-16 = blueprint B1-B5）撞号，**一律以本表为准：G-16 = blueprint、style-safety = G-31**。依赖关系：B1 依赖 CSS 四级矩阵（G-21 ✅ 已完成）+ Compiler IR（G-10），B4 五端闸门依赖 App Renderer（G-22）。

> **追加说明（v3.4）**：router-plus / cli-plus / devtools-plus（2026-08 新增 P0 plan，第 33-35 份）并入本表 **G-32 / G-33 / G-34**。其声称的 G-17 / G-18 / G-19 与 blueprint（G-17 = blueprint B6-B10、G-18 = website B1-B5、G-19 = website B6-B8 + test-framework）撞号，**一律以本表为准**（router-plus→G-32、cli-plus→G-33、devtools-plus→G-34；旧编号引用 G-05/G-06/G-09/G-11/G-12/G-13/G-16 同前重指向：G-05→G-22 系、G-06→G-22 系、G-09→G-23 系、G-11/G-12→G-12、G-13→G-08/G-11、G-16→G-31）。

> **追加说明（v3.5）**：app-config（应用全局配置，2026-08 新增 plan）并入本表 **G-35**。其声称的 G-20（= v1.0 全量回归 + 发布）撞号，**一律以本表为准**（app-config→G-35）；旧编号引用重指向：Theme/Font G-13/G-15→G-27、Memorial G-11→G-25、Style Safety G-16→G-31、Cache G-14→G-28、CLI G-18→G-33、DevTools G-19→G-34、Router G-17→G-32、Glass G-12→G-29。

> **追加说明（v3.6）**：website-v3 同批四份新规划文档抽离入库，并入本表 **G-36 / G-37 / G-38 / G-39**（ai-agent / render-backend-spi / compiler-backend-spi / host-runtime-spi）。其原稿声称编号均与已实现 plan 撞号，**一律以本表为准**（ai-agent G-33→G-36、render-backend-spi G-34→G-37、compiler-backend-spi G-35→G-38、host-runtime G-36→G-39；旧编号引用 G-27/G-28/G-29/G-30/G-31/G-32 同前有效）。依赖关系：G-37 与既有 `@proteus-vue/render-backend`（G-27 已落地）互校；G-38 与 `@proteus-vue/compiler-backend`（G-29 B1）互校；G-39 与 `@proteus-vue/renderer-app`·`@proteus-vue/hmr`·platform/capabilities 互校。详见 PROJECT_MEMORY 决策 #312/#313/#314。

> **追加说明（v3.7）**：execution-carrier（执行载体抽象 + JSI 边界治理，2026-09 新增 plan）并入本表 **G-40**，是 G-39 宿主运行时「执行层」的深化（方法论点：不绑定执行载体 = 原则 #0 的第五/六次投影，与 G-31/32 平台 API、G-27/37 渲染、G-29/38 编译、G-39 宿主运行时同族）。其原稿编号 G-37/G-36/G-35/G-34 与已入库 plan 撞号，**一律以本表为准**（原稿 G-37→G-40、G-36→G-39、G-35→G-38、G-34→G-27 系）。依赖关系：G-40 与 G-39（createEngine 执行载体插槽）/ G-38（emit 产物类型：JS bundle/bytecode/AOT 原生）互校。详见 PROJECT_MEMORY 决策 #340。

> **追加说明（v3.8）**：宿主层三份新规划文档抽离入库，并入本表 **G-41 / G-42 / G-43**（host-integration / host-container / ownership）。其原稿声称编号 G-38/G-39/G-40 与已入库 plan（compiler-backend-spi / host-runtime / execution-carrier）撞号，内部沿用 execution-carrier 原稿旧编号体系（宿主运行时 G-36、执行载体 G-37、渲染 G-34、编译 G-35、AI-Agent G-33），**一律以本表为准**（原稿 G-38→G-41、G-39→G-42、G-40→G-43、G-37→G-40、G-36→G-39、G-35→G-38、G-34→G-27 渲染本体/G-37 渲染 SPI、G-33→G-36）。依赖关系：G-41 与 G-27（RenderBackend）/ G-40（载体）互校；G-42 与 G-39（运行时）/ G-41（接入）互校；G-43 与 G-42（五原子销毁）/ G-40（零拷贝 ArrayBuffer 归属）互校。详见 PROJECT_MEMORY 决策 #341。

> **追加说明（v3.9）**：testing-framework（自动化测试框架第八次泛化：Test IR + TestBackend SPI，2026-09 新增 plan）并入本表 **G-44**。其原稿声称编号 G-41 与 host-integration 撞号，且 CMP067-074 与 ownership（G-43，CMP067-073）撞号，**一律以本表为准（G-41→G-44、CMP067-074→CMP074-081）**；原稿内部沿用 execution-carrier 旧编号体系（宿主运行时 G-36、执行载体 G-37、接入 G-38、容器 G-39、所有权 G-40、编译 G-35、渲染 G-34），已全量重指向（G-36→G-39、G-37→G-40、G-38→G-41、G-39→G-42、G-40→G-43、G-35→G-29、G-34→G-27）；原稿「第七次泛化」漏计所有权（G-43），修正为第八次。依赖关系：G-44 与 G-27/29/39/40/41/42/43（七套 conformance 统一 runner）/ G-25（三维断点自动化）/ G-36（AI 产码门禁 AI005）互校。详见 PROJECT_MEMORY 决策 #364。

> **追加说明（v3.10）**：dev-host（调试基座即宿主，2026-09 新增 plan）并入本表 **G-45**——原则 #0「不绑定」系列第九次投影（不绑定基座形态，沿 G-44 计数）。根因级解法：uni-app 式「自定义基座循环」（改原生插件 → 云打包 → 重装 → 循环往复，页面越多越慢）在「基座 = 构建产物」范式内无解，G-45 换范式为「基座 = 常驻宿主」：插件 = DynamicBackendModule（manifest + 签名 + conformance + factory）运行时装载 + 转发桩 pending 语义（未装载调用回放，业务零感知）+ 双层产物（基座 cacheKey = f(框架版本, ABI) 与页面数/插件数无关——构建 O(改动) 非 O(规模)）；三端分级：Android/鸿蒙全热替换（Tier A）/ iOS 增量重签（Tier B，App Store 2.5.2 诚实边界）/ 模拟先行（Tier C 全端）。依赖关系：G-45 与 G-39（DevHost = 宿主运行时调试形态）/ G-28（插件 factory 返回 NativeBackend）/ G-42（签名网关同源）/ G-38（cacheKey/getArtifactHash 预留）/ G-44（NAT-C 快检跑 test-ir runner）/ G-40（pending 回放走批处理零拷贝）互校。铁律 G-45.1-6 + CMP082-088 + 原则 #13.28-30。参考实现 dev-host-reference.cjs（12 自检 PASS）。详见 PROJECT_MEMORY 决策 #369。

> **追加说明（v3.11）**：本批七份新 plan + 白皮书一并入库（2026-09，决策 #385）：**G-46**（resource-pool，宿主级统一资源池——原则 #0 第十次投影：不绑资源容器形态）/ **G-47**（combined-conformance，组合一致性——第十一次投影：不绑测试层级）/ **G-48**（miniprogram-runtime，兼容式小程序运行容器——第十二次投影）/ **G-49**（sandbox-isolation，进程级沙箱隔离——第十三次投影：不绑隔离强度）/ **G-50**（developer-platform，开发者平台——第十四次投影：不绑平台/生态形态）/ **G-51**（test-ir-runner，验证执行环境插拔——第十五次投影）/ **G-52**（cross-device-verification，跨设备一致性——第十六次投影）+ 对外叙事文档 docs/proteus-whitepaper-plan（**不占 G 序**）。编号避让纪律：七包原稿内部沿用 execution-carrier 旧编号体系（宿主 G-36、载体 G-37、容器 G-39、所有权 G-40、测试 G-41 系）→ 全量重指向官方位（G-36→G-39、G-37→G-40、G-39→G-42、G-40→G-43、G-41→G-44）；CMP 原稿自占高位段且互相撞号（G-48 的 110-116 vs G-49 的 109-117）→ 定案全库连续段 **CMP089-146**（G-46=089-096 / G-47=097-102 / G-48=103-109 / G-49=110-117 / G-50=118-131 / G-51=132-139 / G-52=140-146）；泛化序修正（G-51/G-52 原稿误作第 12/14 次，定案第 15/16 次）；原则 #13.31-56、铁律 G-46.1-8~G-52.1-6、规则 CMP089-146 并入 L0 规约；跨包去重（G-48 沙箱/能力桥章节 → G-49 权威化 + 引用；白皮书方法论/叙事章节 → 引用 spi-first/methodology SSOT）。详见 PROJECT_MEMORY 决策 #385。

> **追加说明（v3.12）**：G-53 补登记 + G-54 新入库（2026-09，决策 #391）：**G-53**（mobile-verification，移动端验证编排——原则 #0 第十七次投影：不绑设备供给方式；原随 #390ii 官网批次顺带入库未登记，本批补齐 board-inventory/facade/规约/spi-first 四路登记，泛化序修正 15→17）/ **G-54**（devtools-suite，框架配套开发者工具·编码期——第十八次投影：不绑 IDE 形态；原稿自编 G-55 基于假想兄弟 plan「DevTools 加固 = G-54/CMP-155~162」的接续，而 G-53 已占用 147~154 且门禁要求 G 序连续 → 重编 **G-54**、CMP-163~170 → **CMP-155~162**、泛化序 15 → **18**；假想「DevTools 加固」降级为未编号后续规划，消费面前指 G-51/G-52，编号避让全记录见该包 rules.md）；原则 #13.57-62、铁律 G-53.1-8/G-54.1-8、规则 CMP147-154/CMP155-162 并入 L0 规约；spi-first 映射表登记第 17~18 次泛化。详见 PROJECT_MEMORY 决策 #391。

> **追加说明（v3.13）**：G-55 新入库（2026-09，决策 #392）：**G-55**（devtools-landing，开发者工具落地形态与性能工程——**G-54 的工程落地，不占泛化序**，沿 G-37→G-27 先例）：宿主层可换绝不 fork（Cursor/Windsurf 停在 VSCode 1.99.3、80+ NVD 漏洞、8+ 工程师合并的结构性滞后实证）+ 内核层唯一 Rust 常驻守护进程（性能瓶颈在内核不在编辑器——增量索引 O(affected) + deps 精确失效 + LRU 淘汰只降性能不丢正确性）+ 六项性能预算确定性断言（计数阻断/墙钟仅 warn）+ 架构试金石（加第二宿主适配器不改内核 = apiSurface 冻结，INV-PF-06）。编号避让：原稿自编 G-56（基于旧序 suite=G-55）→ 定案 G-55 + CMP-171~178→163~170 + 原则 #13.60-62→#13.63-65（与 G-54 原稿撞号）+ 泛化"第 16 次"宣称修正（不占序）。原则 #13.63-65、铁律 G-55.1-8、规则 CMP163-170 并入 L0 规约。详见 PROJECT_MEMORY 决策 #392。

> **追加说明（v3.14）**：G-56 新入库（2026-09，决策 #393）：**G-56**（studio，Proteus Studio 自有宿主壳——**第 19 次泛化：不绑宿主来源**，自有与第三方宿主可互换）：绝不自研编辑器内核/GUI（G-56.1 红线，xi/Lapce/Floem 实证）+ StudioShell 仅新增 3 类型（StudioShell/EmbedStrategy/CompanionLink，其余全复用）+ 四宿主共用内核零改动（架构试金石加强——自有宿主最易开后门，恰最能验证分层）+ 移动端伴侣（form.mobile 唯一 ✅）+ 生态边界诚实（不兼容 .vsix/Marketplace，语言智能走 LSP/DAP）。编号避让：原稿自编 G-57（旧序接续）→ 定案 G-56 + CMP-179~186→171~178 + 原则 #13.57-59→#13.66-68（与 G-53 撞号）+ 泛化"第 16 次"→第 19 次 + G-59 预留取消。原则 #13.66-68、铁律 G-56.1-9、规则 CMP171-178 并入 L0 规约；spi-first 映射表登记第 19 次。详见 PROJECT_MEMORY 决策 #393。

> **追加说明（v3.15）**：G-57 新入库（2026-09，决策 #394）：**G-57**（inspector，Proteus Inspector 三层可观测性叠加——**第 20 次泛化：不绑可观测性来源**）：叠加不替代（L0 探针用宿主已有的 VM Service/Flipper/CDP，绝不重新实现）+ L1 语义增强（指标 × 框架拓扑——把数字变成带结构的数字，本份核心增量）+ L2 框架语义（SPI 拓扑/隔离域/conformance 独占数据）+ 扩展协议（ext.<package>.<command> 命名规约）+ 安全红线（Debug-only 编译期剔除/localhost+一次性 token/绝不采集用户数据）。编号避让：原稿自编 G-58（旧序接续）→ 定案 G-57 + CMP-187~194→179~186 + 原则 #13.60-62→#13.69-71（第三次撞号，60-62 已被 G-54 占用）+ 泛化"第 17 次"→第 20 次。原则 #13.69-71、铁律 G-57.1-8、规则 CMP179-186 并入 L0 规约；spi-first 映射表登记第 20 次。详见 PROJECT_MEMORY 决策 #394。

> **追加说明（v3.16）**：G-58 新入库（2026-09，决策 #395）：**G-58**（plugin-api，Proteus Studio 插件 API 与扩展生态——**第 21 次泛化：不绑扩展来源**，内置功能/官方插件/第三方插件同权）：内置功能走插件 API（G-58.1 红线：apiSurface 快照 S1===S2 机器试金石）+ 默认零权限（capability 白名单 + 越权 denied 不终止）+ 声明式优先（Tier 0 零 WASM）+ API 只增不改（WIT 版本化并存）+ WASM 崩溃隔离 + 资源限额强制 + 提案 API 禁发布。编号避让：原稿自编 G-59（studio 原稿预留号）→ 定案 G-58 + CMP-195~202→187~194 + 原则 #13.60-62→#13.72-74（**第四次撞号**）+ 泛化"第 18 次"→第 21 次。原则 #13.72-74、铁律 G-58.1-8、规则 CMP187-194 并入 L0 规约；spi-first 映射表登记第 21 次。详见 PROJECT_MEMORY 决策 #395。

### 执行原则
- **每批 = 1 PR = LLM 单次 ≤ 3 文件**
- **地基三联先跑通**：G-01（types B1）+ G-02（compiler B1）+ G-07（test-framework B1）是最高优先级
- 任意层改动 → `CrossLayerChecker`（types §11）即时报错
- 验收见各 plan 的 `acceptance` 章节

---

## 5. CI / 可观测（贯穿全局，不单独成层）

- `proteus audit all`：全量审计，目标 **< 12s**（Blueprint 150 页）
- `CrossLayerChecker`：CI 阶段扫描跨层一致性（同名不同义 / 重复类型 / import 深度）
- `--trace-transform` / `--explain` / `--measure`：所有层统一 flag，输出对接 DevTools TraceBus
- 体积预算 / 分包映射 / 产物快照：**四道门禁**，任一超限阻断 PR

---

## 6. 迁移记录（v2.x → v3.0）

| 变更 | 影响范围 |
|------|---------|
| scope `@proteus/*` → `@proteus-vue/*` | 全 18 份，117 处（已回填） |
| 新增 `contracts.ts` 单文件 | types §07，消除 Router/Module 各自定义 DTO |
| 全局分批改 `G-xx` 命名空间 | 各 plan 内部 B1-Bn 保留，新增本文件 G-01~G-20 |
| 第三方类型边界明确 | types §08-§11（官方 typings vs 自建 schema） |

---

## 7. 验收（全局 v3.0）

- [ ] 18 份文档 scope 100% 统一为 `@proteus-vue/*`（grep 零残留 `@proteus/`）
- [ ] 任意两份 plan 的共享类型均指向 `contracts.ts`，无重复定义
- [ ] `CrossLayerChecker` 跑通，零违规
- [ ] G-01 → G-20 执行序无环、无悬空依赖
- [ ] Blueprint 150 页全量审计 < 12s，契约测试全绿
