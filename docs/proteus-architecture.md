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
- **原则 #0 第六投影（G-36，Agent 书写面）**：代码的生成过程也必须服从语义收敛——AI 产出的是符合 IR 契约的标准代码，而非自由文本。Agent 是语义层的「自动化生产者」。五支柱覆盖完整生命周期：设计（语义定义）→ 生成（Agent）→ 验证（conformance）→ 运行（六端渲染）。
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
| #13 | 可插拔层可验证性：任何声称「可插拔」的层（渲染 G-37 / 编译 G-38 / 宿主运行时 G-39 / 执行载体 G-40 / 宿主接入 G-41 / 宿主容器 G-42 / 资源所有权 G-43）须同时提供 SPI + Conformance + ≥2 参考实现（★避让：原稿 #11 与既有 #11 冲突，重编号） | render/compile/host-runtime/execution-carrier/host-integration/host-container/ownership |
| #13.5 | 编译器 IR 为中间表示：编译后端只消费 `SourceFile → ProgramIR → IRModule` 契约，不假设上游框架 | compiler-backend-spi G-38 |
| #13.6 | 降级等价：Fallback 不改变语义 | compiler-backend-spi G-38 |
| #13.7 | 确定性：可复现构建（同一 IR 任一后端产物行为一致） | compiler-backend-spi G-38 |
| #13.8 | 宿主运行时为运行环境抽象，必须可替换（任何宿主实现 ProteusHostRuntime SPI 接入） | host-runtime-spi G-39 |
| #13.9 | 线程安全由 Runtime 唯一保证（Backend/业务不得直接操作线程） | host-runtime-spi G-39 |
| #13.10 | 生命周期状态机必须确定性（Runtime 统一定义 bootstrapping→running→suspended→destroyed） | host-runtime-spi G-39 |
| #13.11 | 执行载体可插拔：不得绑定任何一种执行载体（JSI 只是默认实现而非架构绑定，业务须能在 JSI/AOT/WASM 间切换而无需修改） | execution-carrier G-40 |
| #13.12 | 实时能力逃逸：实时能力（音频/高频传感器/游戏循环）必须在原生线程闭环运行，禁止由 JS 侧驱动循环 | execution-carrier G-40 |
| #13.13 | 性能数据必须实测：对外宣称的任何性能数字必须来自实测基准；工程推算必须标注 `measured: false` 且禁止对外引用 | execution-carrier G-40 |
| #13.14 | 零拷贝降级必须显式：不支持零拷贝时必须返回 `null` 显式降级，禁止静默返回拷贝对象（制造性能谎言） | execution-carrier G-40 |
| #13.15 | 宿主接入必须有组合验证：单插槽 conformance 通过 ≠ 三方组合正确，必须有跨层 Host Conformance（H-01~H-08） | host-integration G-41 |
| #13.16 | 绑定层必须插槽化：框架与前端框架（Vue）的绑定必须通过 nodeOps 等标准插槽，禁止直接依赖具体渲染实现 | host-integration G-41 |
| #13.17 | 注册先于启动：宿主必须在 bootstrap 前完成 Runtime / Carrier / Backend / Capability 全部注册 | host-integration G-41 |
| #13.18 | 页面生命周期必须有单一 Owner：页面状态必须由 IR 实例唯一持有，禁止「JS 状态 ↔ 原生 View」双边持有 | host-container G-42 |
| #13.19 | 资源必须由框架代管：定时器/监听/订阅/请求必须走框架代管接口，禁止业务裸用全局 API | host-container G-42 |
| #13.20 | 容器形态必须可插拔：页面组织方式（单页/栈/超级应用/小程序/窗口/嵌入）必须是可替换策略，禁止硬编码 | host-container G-42 |
| #13.21 | 资源所有权可插拔：边界资源（GC 管不到的）所有权管理必须是框架定义的语义层能力，不得依赖特定语言/运行时的内存范式 | ownership G-43 |
| #13.22 | 确定性 Drop：边界资源释放时机必须确定，不得依赖 GC | ownership G-43 |
| #13.23 | 所有权关系 100% 可观测：所有权图必须完整维护 Owner/Borrow/Weak + 源码位置 + 生命周期，并在 DevTools 可视化 | ownership G-43 |
| #13.24 | 所有权可验证：所有权实现必须通过 Conformance 测试 | ownership G-43 |
| #13.25 | 测试语义可插拔：期望行为必须用可序列化的 Test IR 描述，执行必须是可插拔的 TestBackend（禁止逻辑塞进运行器闭包） | testing-framework G-44 |
| #13.26 | 跨层组合正确性必须被自动化验证：七套 conformance 之外，跨层集成（Compiler→Render→Host→Carrier→Container→Ownership）必须有 INT 套件且 100% 通过（无暂时跳过） | testing-framework G-44 |
| #13.27 | 任一 Backend conformance FAIL 即阻断：任何后端的失败都阻断合并，报告必须含 trace 链（定位到 IR 节点 + 源码行） | testing-framework G-44 |
| #13.28 | 基座零插件知识：基座是 SPI 宿主而非业务载体，新插件接入禁止修改基座代码 | dev-host G-45 |
| #13.29 | 变化层与稳定层构建隔离：构建时间必须随「改动」而非「规模」伸缩（基座 cacheKey 禁含规模因子） | dev-host G-45 |
| #13.30 | 动态装载必须先验证：签名 + conformance 快检通过才可注册能力，失败拒绝并降级（降级不崩溃） | dev-host G-45 |

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
| **G-36.1** | **AI Agent 输出必须通过 conformance + `verify-llm.js`，否则不得交付** | ai-agent |
| **G-36.2** | **Agent 不得生成小程序组件名（view/scroll-view/swiper 等），必须走 G-32 原语** | ai-agent |
| **G-36.3** | **Agent 不得裸写平台 API（wx.*/uni.*），必须走 Hook / `useMiniProgram()`** | ai-agent |
| **G-36.4** | **新增 Skill 必须经受组合性审查，能用现有 Skill 组合则不得新增** | ai-agent |
| **G-36.5** | **Agent 上下文必须走 MCP 按需查询，禁止全量塞入 system prompt** | ai-agent |
| **G-36.6** | **失败自修复必须有上限（≤3 次），超限转人工** | ai-agent |
| **G-36.7** | **Agent 生成的代码必须可追溯到 Component IR（保留 IR 注释/source map）** | ai-agent |
| **G-37.1** | **Backend 必须基于 `semantic` 字段分发渲染，禁止基于标签名字符串** | render-backend-spi |
| **G-37.2** | **Backend 对 C-IR 只读消费，不得修改 IR 节点** | render-backend-spi |
| **G-37.3** | **`capabilities` 必须诚实声明，未声明 = 不支持** | render-backend-spi |
| **G-37.4** | **所有 SPI 方法必须从同一线程调用；Backend 内部多线程自行同步** | render-backend-spi |
| **G-37.5** | **Conformance 测试必须 0 失败；声明支持的能力必须全部通过** | render-backend-spi |
| **G-37.6** | **降级必须可见（开发期警告 + 生产期日志），不得静默** | render-backend-spi |
| **G-38.1** | **编译后端 IR 不可知：不得假设任何前端框架**（只消费 `SourceFile → ProgramIR → IRModule` 契约） | compiler-backend-spi |
| **G-38.2** | **产物语义等价：同一份 IRModule 经任何合规后端 emit，运行行为必须一致** | compiler-backend-spi |
| **G-38.3** | **`compilerCapabilities` 必须诚实声明，未声明 = 不支持** | compiler-backend-spi |
| **G-38.4** | **降级必须可观测：FallbackBackend 生效须显式警告 + 日志** | compiler-backend-spi |
| **G-38.5** | **性能基准强制：编译耗时/内存须过 benchmark，超预算不得宣称合规** | compiler-backend-spi |
| **G-38.6** | **确定性产出：同输入同配置必须产出逐字节一致的产物（可复现构建）** | compiler-backend-spi |
| **G-39.1** | **生命周期唯一拥有：Backend 不得自己监听平台前后台事件，只能 `runtime.on('suspend'\|'resume', cb)` 订阅** | host-runtime-spi |
| **G-39.2** | **线程唯一拥有：Backend 不得直接创建线程（pthread/new Thread/dispatch_async），耗时任务走 `runOnThread`** | host-runtime-spi |
| **G-39.3** | **`capabilities` 必须如实反映宿主能力，不得虚报（未声明组 conformance 自动 SKIP）** | host-runtime-spi |
| **G-39.4** | **降级可观测：每次降级（后台→主线程/文件→内存/桥→Err）必须触发 `fallback` 事件 + 日志** | host-runtime-spi |
| **G-39.5** | **原生桥白名单：仅预注册能力可调用 + 参数 schema 校验 + 超时可取消；Native→JS 回调必须切回 JS 线程** | host-runtime-spi |
| **G-39.6** | **禁止循环依赖：L1 Framework → L4 Runtime 单向，禁止 L4 → L1 回边** | host-runtime-spi |
| **G-40.1** | **执行载体无关：业务代码不得假设 JS 运行时存在（禁 window/globalThis/eval/jsi::Value 直操/Proxy 拦截，Compiler IR 层静态扫描命中即编译错误）** | execution-carrier |
| **G-40.2** | **三路径语义等价：同一份源码 JSI / AOT / WASM 三条路径必须产出语义等价行为（G-38.2 的执行层延伸，conformance 验证）** | execution-carrier |
| **G-40.3** | **实时能力禁止 JS 驱动：回调周期 <100ms 或吞吐 >1MB/s 的能力必须在原生线程闭环，JS 仅 configure/start/stop/onEvent；`rtJsDrivenViolations` 恒为 0** | execution-carrier |
| **G-40.4** | **大块数据强制零拷贝：>4KB 数据跨界传输必须走 `ArrayBuffer` / `SharedArrayBuffer`，禁止走字符串通道（JSI 字符串转换默认拷贝）** | execution-carrier |
| **G-40.5** | **RenderBackend 必须支持批处理：所有后端必须实现 `commitBatch(ops)`，框架默认走批处理路径，批内操作不得逐次跨界** | execution-carrier |
| **G-40.6** | **载体可观测：载体必须暴露 `getMetrics()`；`rtJsDrivenViolations > 0` → CI 构建失败** | execution-carrier |
| **G-41.1** | **框架不碰线程/原生 View/平台 SDK：框架代码不得直接创建线程、访问原生 View、调用平台 SDK** | host-integration |
| **G-41.2** | **宿主不解析 IR/不干预 Diff：宿主不得读取 IR 内容或干预 Diff 结果** | host-integration |
| **G-41.3** | **引擎不感知 Vue：引擎不得 import vue/@vue/*，不得感知响应式/SFC 存在** | host-integration |
| **G-41.4** | **业务无平台判断：业务代码不得出现平台判断或原生 SDK 直接调用** | host-integration |
| **G-41.5** | **业务不假设 JS 运行时：复用 G-40.1（禁假设宿主运行时执行环境）** | host-integration |
| **G-41.6** | **注册先于 bootstrap：宿主必须在 bootstrap 前完成 Runtime + Carrier + Backend 注册，且通过 host-conformance（H-01~H-08）** | host-integration |
| **G-42.1** | **IR 是页面唯一真相：Backend 挂载点不得独立持有业务状态** | host-container |
| **G-42.2** | **页面销毁必须五原子：unmount→unbindEvents→releaseResources→destroyIR→releaseQuota 不可部分执行** | host-container |
| **G-42.3** | **资源由框架代管：业务不得裸用 `setTimeout`/`setInterval`/`addEventListener`，走 pageContext 代管接口** | host-container |
| **G-42.4** | **容器不得解析 IR/干预 Diff：容器只管生命周期时机** | host-container |
| **G-42.5** | **超级应用容器必须崩溃隔离 + 资源配额：业务崩溃后宿主必须存活** | host-container |
| **G-42.6** | **宿主仓库严禁 fork 框架源码：禁止复制/内嵌框架源码，定制走官方扩展点/依赖替换/组合配置（扫描器 CI）** | host-container |
| **G-43.1** | **边界资源必须归属某个 Owner：GC 管不到的资源创建即登记所有权图，禁止无主资源** | ownership |
| **G-43.2** | **Move 后原所有者不得再访问：transferTo() 后状态为 moved，任何 read/write 必须拦截（PSS strict 编译期报错）** | ownership |
| **G-43.3** | **借用不得逃逸其作用域：Borrow<T> 存入全局/store/闭包均为逃逸（PSS strict 编译期报错）** | ownership |
| **G-43.4** | **默认路径框架代管：99% 场景（定时器/订阅/请求）走 Managed<T>，业务零心智负担** | ownership |
| **G-43.5** | **所有权关系必须 100% 可观测：所有权图维护 Owner/Borrow/Weak + 源码位置 + 生命周期，DevTools 全展示** | ownership |
| **G-43.6** | **确定性 Drop：释放必须确定性（显式 drop()/作用域结束/页面强制回收），禁止依赖 GC 时机** | ownership |
| **G-44.1** | **断言必须可序列化为 AssertionNode：禁止把逻辑塞进测试运行器闭包（跨 Backend/跨进程的前提）** | testing-framework |
| **G-44.2** | **任一 Backend 的 conformance FAIL → 阻断合并（体系正确性不容降级）** | testing-framework |
| **G-44.3** | **跨层集成测试必须 100% 通过（无「暂时跳过」——INT 套件是链路正确性核心）** | testing-framework |
| **G-44.4** | **同一份 Test IR 必须在 ≥2 个 Backend 上可执行（可插拔的可验证性）** | testing-framework |
| **G-44.5** | **性能基准退化 > 5% → 阻断（基准值固化 .proteus/benchmark.json，改动须 Owner 审批）** | testing-framework |
| **G-44.6** | **失败报告必须含 trace 链：定位到 IR 节点 + 源码行（可调试性）** | testing-framework |
| **G-45.1** | **基座零插件知识：基座禁止静态依赖/感知任何具体插件（只依赖 DevHost SPI + 装载协议）；新插件接入禁止修改基座一行代码** | dev-host |
| **G-45.2** | **未装载能力的语义调用必须走转发桩 pending 语义（装载后回放），禁止抛同步异常、禁止要求业务写重试** | dev-host |
| **G-45.3** | **装载即验证：动态模块必须过签名校验 + conformance 快检（每能力 ≥1 用例），任一 FAIL 拒绝装载并降级，禁止带伤注册** | dev-host |
| **G-45.4** | **双层产物强制分离：基座 cacheKey = f(框架版本, ABI)，禁止含页面数/插件数等业务规模因子；基座构建频次必须为「每框架版本 1 次」** | dev-host |
| **G-45.5** | **动态装载全链可观测：loaded/upgraded/rejected/fallback/pending/replay 必须发事件（TraceBus 同源），禁止静默降级** | dev-host |
| **G-45.6** | **发布形态诚实边界：商店发布包必须回静态链接（每版本一次）；动态装载通道禁止用于规避商店审核或绕过分发合规** | dev-host |
| **G-45.7** | **动态模块签名证书链必须与基座同源：不同源拒绝装载（G45_ABI_SIGN_CHAIN_MISMATCH）** | dev-host |
| **G-45.8** | **manifest 哈希须与 dev server 推送清单一致（防 MITM）：不匹配拒绝装载（G45_MANIFEST_HASH_MISMATCH）** | dev-host |
| **G-45.9** | **Install-Once 仅限开发态与内部分发，禁止宣称「线上热更新」** | dev-host |
| **G-45.10** | **发布态 ABI 冻结后，运行态禁止引入未预注册的原生能力：release/runtime 态 loadModule 一律拒绝（G45_MODE_FORBIDDEN）；运行态仅参数灰度（非代码）** | dev-host |

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
| CMP | CMP017-022 | error | Agent 取色限 tokens（017）/页面类型声明（018）/迁移映射日志（019）/adapt-device 不改语义（020）/MCP 鉴权（021）/评测含车机+手表（022） | 🆕 ai-agent-plan（G-36） |
| CMP | CMP023-028 | error | SPI 接口最小化 ≤20 方法（023）/NodeHandle 不透明（024）/差分完整性（025）/资源释放（026）/手势 no-op 兜底（027）/首帧预算（028） | 🆕 render-backend-spi-plan（G-37） |
| CMP | CMP029-034 | error | 接口完整性（029）/确定性 emit（030）/降级语义一致（031）/缓存键可移植（032）/诊断不抛异常（033）/源码位置保留（034） | 🆕 compiler-backend-spi-plan（G-38） |
| CMP | CMP035-043 | error | 宿主不假设业务（035）/禁跳层访问（036）/禁循环依赖（037）/能力声明一致（038）/降级可观测（039）/生命周期确定性（040）/线程 postMessage 不共享（041）/资源清理（042）/性能基准强制（043） | 🆕 host-runtime-plan（G-39） |
| CMP | CMP044-050 | error | 载体须声明 capabilities（044）/实时类能力注册须分类（045）/未实测数据禁止对外宣称（046）/零拷贝不得 slice（047）/不支持须返回 null 显式降级（048）/零拷贝降级须上报指标（049）/批处理不得逐次跨界（050） | 🆕 execution-carrier-plan（G-40） |
| CMP | CMP051-058 | error | 宿主注册先于 bootstrap（051）/业务禁直接引用 RenderBackend/nodeOps（052）/业务禁直接调 HostRuntime.createWorker/invokeNative（053）/引擎禁 import vue（054）/框架禁 import 平台 SDK（055）/宿主禁 IR 字段分支判断（056）/引擎切换须过 H-05 热切换验证（057）/宿主上线须 host-conformance 0 失败（058） | 🆕 host-integration-plan（G-41） |
| CMP | CMP059-066 | error | 容器策略可声明式配置（059）/深度超限不得静默丢弃（060）/配额超限返回 null（061）/沙箱作用域完全隔离（062）/崩溃后必须上报宿主（063）/安全网关拒绝而非降级（064）/容器必须声明 capabilities（065）/销毁报告可观测 DestroYReport（066） | 🆕 host-container-plan（G-42） |
| CMP | CMP067-073 | error | 业务禁直接释放框架代管资源（067）/跨设备转移必须原子（068）/不可转移资源显式拒绝（069）/释放失败不得静默（070）/Owned<T> 禁被 ref/reactive 包装（071）/PSS strict 禁引入未声明第三方库（072）/配额记账须与所有权图一致（073） | 🆕 ownership-plan（G-43） |
| CMP | CMP074-081 | error | 跨 Backend 同语义必须产出结构一致 state（074）/Test IR 文件（.tir.json）必须进 git（075）/arrange·act·assert 必须 JSON 可序列化（076）/跨 Backend 结果不一致 = 语义分歧必须修复（077）/三维断点矩阵必须有自动化覆盖（078）/新 plan 落地必须同步提供 Test IR（079）/Agent 产物须过 TestBackend 门禁（080）/性能基准固化且改动须 Owner 审批（081） | 🆕 testing-framework-plan（G-44） |
| CMP | CMP082-088 | error | 基座禁引用插件（082）/未装载调用走 pending 非抛（083）/manifest+签名缺一拒绝（084）/装载必跑快检 FAIL 拒绝+降级（085）/cacheKey 禁规模因子（086）/快检覆盖率≥能力数（087）/推送通道 TLS+token+审计（088） | 🆕 dev-host-plan（G-45） |

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

*Architecture Contract v1 · 2026-09-03 · M1.1 规约收口完成（v3.10 dev-host G-45 追加）*
