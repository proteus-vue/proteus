# Proteus JS 引擎选型与可插拔方案

> 定位：**引擎选型结论留痕 + 引擎层做成可替换组件**（选型**已收口**，不再为换引擎投入；
> 可插拔化作为"未来生态变化时能随时切换"的架构保险，按需推进）
> 适用：Proteus v2.47+（Vue 3.4 / Vite 5 / TS 5.4）
> 依赖：《Host ABI 宿主抽象层设计方案》（注入式 trait 原则）、《缺口补齐任务卡清单》、
> `docs/proteus-android-js-engine-selection.md`（Android 侧同题实测）、
> `docs/proteus-execution-carrier-plan/`（G-40 执行载体 SPI）
> ★★**决策（2026-09-30，用户裁定）**：**默认即现状**——iOS = 系统 JavaScriptCore（解释执行，
> 无 JIT；真机 iPhone 12 / iOS 26.3 已验证）+ Android = 内置 QuickJS（`.so` 0.94MB，S3/S3b 已验证）。
> **不做引擎切换**；**引擎层可插拔化（EN2）保留**——目的是生态变化（合规/性能/体积）时能随时切换，
> 而非现在换。EN0（iOS 26 合规）已按本轮证据收敛为"运行时无异常 + 无需为审核换引擎"（见 §2.5）。

---

## 0. 结论摘要

| 问题 | 结论 |
|---|---|
| Hermes 不兼容 ESM | ✅ **成立**——官方明确不提供运行时模块加载器，**无公开路线图** [citation:13][citation:17][citation:35] |
| 因此必须放弃 Hermes？ | ❌ **未必**——ESM 是"格式"问题，打包成 IIFE/CJS 后可能可行 |
| 现在该换引擎吗？ | ❌ **不换（已裁定）**——默认即现状（iOS JSC / Android QuickJS）；Vapor 落地后 JS 执行量已大幅下降（V0~V4 全完成） |
| iOS 26 合规风险 | ✅ **已收敛：无需为审核换引擎**——真机 iOS 26.3 跑 JSC 正常（24/24 + 25/25 用例）；审核指南全文无引擎条款（见 §2.5） |
| 最紧急的事 | 🟡 **无紧急项**——引擎层可插拔化（EN2）作为架构保险按需推进 |
| 架构上该做的 | ✅ **引擎层可插拔（EN2 保留）**——生态变化时随时切换；不阻塞主线 |
| 若必须换，首选 | **Hermes**（若 IIFE 验证通过）→ **QuickJS**（ESM 原生支持） |

---

## 1. 现状诊断

### 1.1 Hermes 对 ESM 的支持：官方明确不支持

Hermes 官方 Features 文档将 ES Modules 列入「Intentionally Excluded / De-prioritized」：

> **ES Modules (import/export)**: Hermes does not currently provide a runtime module loader. While an implementation existed previously, **it was removed** as the React Native ecosystem relies heavily on bundlers (like Metro) which provide their own module systems. [citation:13][citation:35]

官方 2025 年 5 月对 ESM 支持的回复：

> "No update for now. ESM is essential for cross-module optimizations in a AOT compiler, but at this time **we unfortunately don't have a public roadmap for getting there**." [citation:17]

### 1.2 ★ 但要区分两个层次

| 层 | 性质 | Hermes 状态 | 影响 |
|---|---|---|---|
| **ESM 模块格式** | 模块系统 | ❌ 无运行时加载器，**无路线图** [citation:13][citation:17] | 卡住 |
| **Proxy** | 语言特性 | ✅ **已支持**（RN 0.64 起官方添加，明确为兼容 mobx / react-native-firebase）[citation:18][citation:26] | **不卡** |

**关键推论**：Vue 3 响应式依赖的是 Proxy，**不是 ESM**。
所以"Hermes 不兼容 Vue 3"这个判断需要修正——它不兼容的是 **ESM 格式**，不是 Vue 3 本身。

### 1.3 Hermes 的 ESM 部分支持有语义缺陷

Hermes 对 ESM 提供"部分支持"，方式是**把 import 转成 require 调用**。
这导致 **live bindings 无法满足**——被导入模块的值变化时，导入方的本地绑定不更新 [citation:21][citation:38]。

**结论**：不能依赖这个部分支持。

---

## 2. iOS 26 合规核实（★2026-09-30 已收敛：运行时无异常；审核无引擎条款）

> ★★**本节结论（先给结论再留推理）**：**不需要为 iOS 26 换引擎**。
> · **运行时**：本仓真机 iPhone 12 / **iOS 26.3** 上 JSC 自绘链路 **24/24 + 25/25 用例全过**
>   （`hosts/ios/run-selfdraw.sh --bench` 报告；宿主 `import JavaScriptCore`）；
> · **合规/审核**：App Store 审核指南**全文逐词检索**——无 "JavaScriptCore" / "JIT" / "interpreter"
>   任何提及；最相关的是 **2.5.2**（禁下发改变 App 功能的代码）与 **4.7**（明文允许
>   HTML5/JavaScript mini apps、mini games、plug-ins）；`allow-jit` entitlement **仅 macOS**（无 iOS 版本）
>   ⇒ iOS 第三方 App **从来没有 JIT**，"解释执行"不是审核判据；
> · **传闻核查**：中英多轮检索「iOS 26 移除 legacy JIT / 阻止非官方 JSC 集成」**零一手佐证**
>   （原引 [citation:15] 权威性低，本仓已实测反证）。
> ⇒ 下方 2.1~2.4 保留作为**当时的风险分析记录**（历史语境），行动项已并入 §2.5。

### 2.5 ★ 本轮取证结论（2026-09-30，一手证据）

| 证据 | 内容 | 意义 |
|---|---|---|
| **App Store 审核指南**（全文检索原文） | 无 "JavaScriptCore"/"JIT"/"interpreter"/"interpreted code"；**2.5.2** 管"不得下载/执行改变 App 功能的代码"；**4.7** 明确允许 HTML5/JavaScript mini apps 与 plug-ins（配 4.7.1–5） | 指南管"下发代码的行为"，**不管"用哪个引擎"** |
| **JavaScriptCore 框架文档** | 公开框架（iOS/tvOS/visionOS 在列，**无弃用标记**）；自述用途 = "Evaluate JavaScript programs from within an app" | Apple 自己文档化"App 内嵌 JS"用法 |
| **`allow-jit` entitlement 文档** | **仅 macOS**（10.7+）；无它时依赖 JIT 的框架 "fall back to an interpreter" | iOS 第三方 App**从来没有 JIT** ⇒ "移除 legacy JIT"对解释执行路径是空集 |
| **传闻核查** | 「iOS 26 阻止非官方 JSC 集成」中英检索**零佐证** | 未证实传闻 |
| **本仓真机** | iPhone 12 / iOS 26.3 · JSC 链路 24/24 + 25/25 全过 | 运行时直接反证 |
| **生态存在性** | RN（JSC/Hermes 两条腿）· Unity（iOS IL2CPP AOT）· Flutter（iOS AOT）· Cordova/Capacitor · 微信/支付宝小程序平台 | 若"嵌入第三方 JS 引擎"是拒审项，半个 App Store 不存在 |

**真正的上架风险点（与引擎无关，值得单独管理）**：
1. **2.5.2 + 开发者协议**：可下发 JS 代码，但不得借此改变 App 主要用途/新增原生能力
   ⇒ **OTA/热更新才是审核战场**（Playground 方案已把"OTA 不能新增原生能力"写成硬边界）；
2. 若定位是"宿主内跑第三方小程序"：**4.7.1–4.7.5**（内容过滤/举报、软件索引、年龄分级）
   成为产品设计要求——依旧引擎无关；
3. 私有 API / 动态下发**原生**代码：真会拒。JSC 是公开框架，不在其列。

**观测信号（真出事前会先亮的三盏灯）**：① Xcode SDK 升级出现 JSC 弃用/unavailable 标注；
② Apple 开发者新闻/WWDC 出现引擎级政策；③ RN/Flutter/Unity 生态集体告警。
—— 现在一盏都没亮；正确动作是保留 EN2（可插拔）作为便宜的保险。

### 2.1 风险描述（历史记录）

有资料称：**iOS 26 移除对 legacy JIT runtime 的支持，并阻止非官方 JavaScriptCore 集成**，
并称 Hermes 成为 Apple 相对容忍的唯一 JS 引擎 [citation:15]。

**但该来源权威性较低，必须自行核实。**

### 2.2 Apple 官方口径（确定性较高）

Apple 官方文档：JIT 需要 `com.apple.security.cs.allow-jit` entitlement，
Hardened Runtime 默认禁止；**没有该权限的框架会回退到解释器** [citation:27]。

另有资料印证：第三方 App 引入 JSC 时 **JIT 是关闭的**，
仅 Safari 与 WKWebView 默认开启 [citation:33]；iOS 上 JSC 无法 JIT，
因为"发布后 iOS 下只有苹果自己的 app、进程才有权限" [citation:30]。

### 2.3 核实清单（必须在 iOS 26 真机执行）

- [ ] iOS 26 真机启动当前（JSC）版本，是否崩溃或警告
- [ ] 控制台是否出现 JIT failure / unsupported symbols
- [ ] TestFlight 提交是否被拒（审核理由）
- [ ] 是否有 App Store 审核相关提示

### 2.4 出口判据

| 结果 | 行动 |
|---|---|
| iOS 26 正常 | JSC 路线保留，继续 §3 |
| **iOS 26 异常/被拒** | 🔴 **强制换引擎**——这不是选型问题而是生存问题，直接跳到 §4 |

---

## 3. 第二步：IIFE 打包验证（约 1 小时，收益可能很大）

### 3.1 为什么值得试

**编译发生在本地（CLI/构建脚本）与 CI，不是云端。** 而本地与 CI 侧本来就有打包器（Vite / esbuild）——
**打包成 IIFE/CJS 是这条链路的默认产物形态，不是额外工作。**
RN 也是这么做的：Metro → CJS → Hermes 字节码 [citation:21]。

**所以之前"Hermes 不兼容"的结论，实际上是"直接喂 ESM 源码"造成的，而非能力不兼容。**

> ✅ **这个澄清让 EN1 通过的概率明显上升**——打包环节天然存在，
> ESM → IIFE 由现有工具链完成，不需要任何新增设施。

### 3.2 验证步骤

1. Vite / esbuild 将业务打包为 **IIFE 单文件**（或 CJS）
2. 喂给 Hermes 执行
3. 验证 Vue 3 能否正常初始化与渲染

### 3.3 出口判据

| 结果 | 行动 |
|---|---|
| ✅ Vue 3 跑通 | **Hermes 可行**——拿回其内存与启动优势（内存是你的核心卖点之一） |
| ❌ 跑不通 | 彻底关闭 Hermes 路线，转 §4 的 QuickJS |

### 3.4 ⚠️ 一个已知障碍

有资料称：**Hermes 字节码不支持块级作用域（let/const）**，Hermes 团队明确短期不合并，
导致 esbuild 默认产物（现代语法）与之冲突，有项目因此被迫 `enableHermes: false` [citation:25]。

**该来源权威性较低，但需重点验证**——若属实，IIFE 打包时必须降级到 ES5 语法，
而这可能影响产物体积与性能。**验证时一并确认。**

---

## 4. 引擎候选排序

### 4.1 Hermes（若 IIFE 验证通过）

| 项 | 说明 |
|---|---|
| 优势 | 内存、启动、体积；AOT 字节码；**Apple 相对容忍** [citation:15] |
| 障碍 | ESM 无运行时加载器 [citation:13][citation:17]；可能的 let/const 限制 [citation:25] |
| Proxy | ✅ 已支持 [citation:18][citation:26] |

### 4.2 ★ QuickJS（最值得认真评估）

| 项 | 说明 |
|---|---|
| **ESM** | ✅ **原生完整支持**（ES2025，含 modules）[citation:34]，正好绕开 Hermes 死穴 |
| 体积 | 极小（367 KiB / 简单 hello world）[citation:34]；armeabi-v7a 约 350KB [citation:28] |
| 启动 | 极快；runtime 完整生命周期 < 300 微秒 [citation:34] |
| 字节码 | ✅ 支持预编译（release 版编字节码、debug 版走源码，RN 已有先例）[citation:20] |
| iOS 表现 | 有实测称**带 code cache 优于 JSC，不带则劣于 JSC** [citation:37] |
| 内存 | 引用计数 + 循环回收，确定性释放 [citation:31][citation:34] |
| 生态 | 已有 `react-native-quickjs` 集成先例（含 Hermes 兼容层、doctor/revert）[citation:20] |

**注意**：QuickJS 无内置 inspector，调试链路需额外工作 [citation:37]。

### 4.3 V8 JIT-less

NativeScript 走过这条路（2020 年为绕开 iOS JIT 限制，从 JSC 换成 V8）[citation:22]，
但 iOS 上同样是解释执行、体积更大。**优先级低于前两者。**

### 4.4 JSC（现状）

| 项 | 说明 |
|---|---|
| iOS | JIT 被禁，仅解释执行 [citation:30][citation:33]；NativeScript 文档亦确认 [citation:14] |
| 风险 | iOS 26 可能进一步限制 [citation:15] |
| 优势 | 系统自带，无体积成本 |

---

## 5. ★ 架构建议：引擎层可插拔（立即做）

### 5.1 原则

沿用 Host ABI 的**注入式 trait 原则**——引擎应该是**可替换组件，不是硬编码依赖**。

```
业务逻辑 (JS)
    ↓
  JS Engine Trait   ← 可插拔：JSC / Hermes / QuickJS
    ↓
  Host ABI 八个接口
    ↓
  内核（Rust 排版核心）
```

### 5.2 Trait 最小接口

| 方法 | 说明 |
|---|---|
| `init(config)` | 初始化引擎实例 |
| `eval_script(bytes, is_bytecode)` | 执行脚本或字节码 |
| `register_host_object(name, obj)` | 注册原生对象（JSI 等价能力） |
| `call_js(fn_name, args)` | 调用 JS 函数 |
| `dispatch_frame()` | 每帧调度 |
| `shutdown()` | 销毁 |

### 5.3 三条硬约束

1. **内核与业务逻辑不得直接引用具体引擎 API**——只依赖 trait
2. **批处理红线不变**：跨边界调用次数 = 帧数（沿用 Host ABI 约束）
3. **引擎切换不得改变业务逻辑**——由 conformance 保证

### 5.4 为什么要做（★2026-09-30 决策后口径）

- 成本低（接口数量少，且两个真实后端**已在跑**——抽公共 trait 即可，不是从零写适配器）
- 目的**不是**"现在要换引擎"，而是**生态变化时能随时切换**（合规政策 / 性能 / 体积任一变量变化）
- **把"一旦要换就得返工"变成"随时可调"**——这是架构保险，不阻塞任何主线

★**与 §6 的关系（同一结论的两面）**：Vapor 已落地（V0~V4 全完成）⇒ JS 执行量已大幅下降，
引擎绝对性能**不再主要**；加上可插拔层，引擎选型从"高风险决策"降级为"可替换组件"。

---

## 6. 一个反直觉的推论：Vapor 落地后，引擎选型会变得不重要

| 阶段 | JS 执行量 | 引擎绝对性能的权重 |
|---|---|---|
| （当时的）现在 | Vue 侧 70ms（VNode 重建 + diff，纯 JS） | **高**——无 JIT 会明显放大这部分 |
| **Vapor 落地后（★已达成：V0~V4 全完成，2026-09-28）** | 消除 VNode + diff，只剩业务逻辑 | **大幅下降**（真机实测：单节点 P95 0.36ms） |

**结论**：现在不值得为引擎选型投入大量工程。
先用 JSC 跑通，等 Vapor 把 JS 执行量压下来之后再评估。

这也印证了一贯的判断：**瓶颈会移动，必须持续重测。**

---

## 7. 里程碑

### EN0 · iOS 26 合规核实 ✅ **已收敛（2026-09-30）**——不需要为审核换引擎

- [x] iOS 26 真机启动测试 —— ✅ iPhone 12 / **iOS 26.3**：JSC 链路 24/24 + 25/25 用例全过
- [x] 控制台日志检查 —— ✅ 无 JIT failure / unsupported symbols（本仓自绘报告与设备日志）
- [x] 审核视角取证 —— ✅ 审核指南全文无引擎条款；`allow-jit` 仅 macOS；4.7 明文允许 JS mini apps
- [x] 输出结论 —— **正常（运行时）/ 无引擎级审核风险**；TestFlight/提审属组织流程，下次真实提审时顺带观察

### EN1 · IIFE 打包验证 —— ✅ **现状已满足（无需额外工作）**；Hermes 路线**暂不启用**

- [x] 打 IIFE 单文件 —— ✅ 本仓**现网产物本来就是** esbuild 单文件 IIFE
      （`hosts/ios/bridge/build.mjs` / `build-selfdraw.mjs`；注释即写"JSC 无模块系统，必须预打包"），
      Android 侧同形（`hosts/android/bridge/build-batch.mjs`）
- [ ] ~~Hermes 执行测试~~ —— **暂缓**：选型已收口为现状；若未来生态变化（如体积/启动成为主瓶颈）
      再启动，届时 IIFE 产物可直接喂 Hermes（无需新建打包链）
- [ ] ~~let/const 限制验证~~ —— 同上（仅 Hermes 路线相关）

### EN2 · 引擎层可插拔化（≈1.5 人周）★ **本次决策保留的唯一推进项**（架构保险，不阻塞主线）

- [ ] 定义 JS Engine Trait（§5.2）
- [ ] 实现 JSC 适配器（iOS 现状）+ QuickJS 适配器（Android 现状）——**抽公共 trait，不新写后端**
      （SPI-First：≥2 真实后端已存在，满足"单后端 SPI 是假 SPI"的反模式要求）
- [ ] 抽象层 conformance
- [ ] 静态检查：不得直接引用具体引擎 API
- ★**与既有计划的关系**（避免两套抽象打架）：G-39 host-runtime 的 L4 已有"JS 引擎"槽位
  （`createEngine`）；G-40 execution-carrier 已把该返回类型更名 `JSEngine` → `ExecutionCarrier`
  （理由正是"JSEngine 隐含一定是 JS 引擎"）⇒ **EN2 应作为 G-39/G-40 的一个具体落地批次**，
  不另立编号；本 §5.2 的 trait 接口是其最小形态。

### EN3 · QuickJS 适配器 —— **Android 侧已落地（无需重复投入）；iOS 侧按需**

- [x] Android = QuickJS 已内置并真机闭环（`hosts/android/js-engine/quickjs_jni.c` +
      `QuickJsEngine.java` + `.so` 0.94MB；S3/S3b/S5 真机验证；构建链 `scripts/setup-android-js-engine.sh`）
- [ ] 字节码预编译链路 —— Android 侧按需（当前直接 eval IIFE 产物，性能已达标）
- [ ] 调试链路 —— 按需（QuickJS 无内置 inspector）
- ★EN3 启动条件已从"EN0 异常或 EN1 失败"改为"EN2 抽象层落地后按需补 iOS 适配器"

### EN4 · Vapor 落地后重新评估（时机由 Vapor 进度决定）

- [ ] 重测 JS 执行量
- [ ] 重评引擎选型

---

## 8. 坑位清单

| # | 坑 | 应对 |
|---|---|---|
| 1 | **iOS 26 合规风险** | EN0 实测，异常即强制换引擎（§2） |
| 2 | **误判"Hermes 不兼容 Vue 3"** | 实际不兼容的是 ESM 格式；Proxy 已支持（§1.2） |
| 3 | **Hermes let/const 限制** | EN1 一并验证 [citation:25] |
| 4 | **Hermes ESM 部分支持的 live binding 缺陷** | 不依赖 [citation:21][citation:38] |
| 5 | **引擎硬编码导致未来返工** | EN2 可插拔化（§5） |
| 6 | **QuickJS 调试链路缺失** | EN3 需额外投入 [citation:37] |
| 7 | **现在过度投入引擎优化** | Vapor 后 JS 执行量会降，不急（§6） |
| 8 | **引擎切换破坏业务逻辑** | Trait + conformance 保证（§5.3） |
| 9 | **忽略 iOS 上 JSC 无 JIT 的事实** | 现状即解释执行，不是"高性能选择" |
| 10 | **把引擎选型当性能决策** | 它主要是**格式兼容 + 合规**问题 |

---

## 9. 给实现 LLM 的执行指令（★2026-09-30 按决策重写）

1. **引擎选型已收口：默认即现状**（iOS 系统 JSC / Android 内置 QuickJS）。**不要提议换引擎**，
   也不要"顺手"引入 Hermes/其他引擎——需要变更时先回用户决策。
2. **EN0（iOS 26 合规）已收敛**：运行时真机已证（iOS 26.3 全过）、审核指南无引擎条款。
   不再需要专门调研；下次真实提审时顺带观察即可。
3. **EN2（可插拔化）是唯一保留的推进项**——且它是**架构保险**，不是当前优先级：
   排期时与 G-39/G-40 合批，**不单独插队**、不阻塞主线。
4. **实现 EN2 时"抽公共 trait"，不新写后端**：iOS JSC 与 Android QuickJS 两个真实后端已在跑，
   直接在它们之上收敛接口（SPI-First：单后端 SPI 是假 SPI）。
5. **不得在内核或业务逻辑中直接引用具体引擎 API**——只依赖 Trait（静态检查）。
6. **引擎切换不得改变业务逻辑行为**，由 conformance 保证。
7. **批处理红线不受引擎切换影响**，沿用 Host ABI 约束。
8. **不要为引擎选型投入大量性能优化工程**——Vapor 已落地（V0~V4 全完成），JS 执行量已大幅下降（§6）。
9. 凡标注来源权威性较低的事实，**必须自行实测确认后再行动**——本文件 §2.5 已有反面案例
   （「iOS 26 封杀 JSC」传闻被真机反证）。

---

## 附：关键事实依据

**Hermes ESM**
- 官方 Features 文档：ES Modules 属「Intentionally Excluded」；无运行时模块加载器，历史实现已移除 [citation:13][citation:35]
- 官方 2025-05 回复：无公开路线图 [citation:17]
- ESM 部分支持 = import 转 require，**live bindings 不满足** [citation:21][citation:38]
- 有资料称字节码不支持块级作用域（let/const），esbuild 产物冲突（**权威性较低**）[citation:25]

**Hermes Proxy**
- RN 0.64 起官方添加 Proxy 支持，明确为兼容 mobx / react-native-firebase [citation:18][citation:26]
- 更早版本（RN 0.63 / Hermes v0.5.0）曾报 `Property 'Proxy' doesn't exist` [citation:22]

**iOS JSC / JIT**
- Apple 官方：JIT 需 `com.apple.security.cs.allow-jit`，Hardened Runtime 默认禁止，无权限则回退解释器 [citation:27]
- 第三方 App 引入 JSC 时 JIT 关闭，仅 Safari / WKWebView 默认开启 [citation:33]
- iOS 上 JSC 无法 JIT，仅苹果自有进程有权限 [citation:30]
- NativeScript iOS runtime 文档：Apple 不允许 App Store Apps 使用 JIT [citation:14]
- NativeScript 2020 年为绕开此限制从 JSC 换到 V8（JIT-less，有性能损失）[citation:22]
- iOS 26 移除 legacy JIT runtime、阻止非官方 JSC 集成（**权威性较低，须核实**）[citation:15]

**QuickJS**
- 官方：ES2025 支持，**包括 modules**；367 KiB；启动极快（runtime 生命周期 < 300μs）；引用计数 GC [citation:34]
- 完整 ES6 模块系统支持（含相对导入、系统模块、原生 .so 模块）[citation:31]
- Android armeabi-v7a 约 350KB，支持 ES2020 [citation:28]
- RN 集成先例：release 编字节码、debug 走源码、Hermes 兼容层、doctor/revert [citation:20]
- iOS 实测：带 code cache 优于 JSC，不带则劣于 JSC；**无内置 inspector** [citation:37]
