# Proteus 业务代码跨端调试方案

> **代号：暂定 `Helios`**（希腊神话：全视的太阳神——取其"看得见一切"义；备选 `Lynceus`（阿耳戈号锐眼，能看穿地下）、`Selene`）。★**定名前必须做正式商标与包名检索**，检索通过前**不进入万神殿已定名清单**（对齐仓库命名纪律）。
> 状态：**方案定稿，未实现** · v1 · 2026-10-10
> 定位：**业务代码（用户写的 `.vue`）在五端下的运行期调试与可观测**——这是仓库 6 份既有调试计划的**唯一空白象限**（§1.3 有取证）。
> 一句话：**别人是"打印出去再想办法"，我们是"编译期就知道这条日志是谁"**。
> 关联：`proteus-devtools-plan`（G-19 运行时诊断 · 数据面复用）· `proteus-devtools-plus-plan`（G-34 协议层）· `proteus-devtools-suite-plan`（G-54 编码期 · 互补不重叠）· `docs/Proteus_构建与编译错误语义化诊断方案.md`（Apollo · 编译期版，本方案是**运行期版**）· `docs/Proteus_业务埋点采集与多端口径统一方案.md`（Clio · **业务上报，不得共用总线**）· `14-input-bridge-latency.md`（S2 零拷贝通道 = 本方案的线格式）

---

## 0. 结论先行

1. **能做，而且底子比任何一家跨端框架都厚**——但**不是再做一个 Flipper**。仓库已有的 `TraceBus` + 两套 DevTools + 三端 console 垫片 + 零依赖 sourcemap + IR 节点源位置，已经构成了一条**完整的骨架**；缺的不是能力，是**四道断掉的接口**（§1.2）。

2. **痛点定性：`console.log` 之所以是全行业默认，不是因为它好，而是因为跨端场景有六条结构性缺陷**（§2），**任何"把字符串打印出去"的方案都救不了它们**——包括 vConsole、Flipper、Flutter DevTools。

3. **空白象限**：仓库 6 份调试计划覆盖了「框架自身诊断（G-19）」「编码期（G-54/G-55）」「协议桥与 HMR（G-34）」「Vue 组件树（Vue DevTools 接入）」「平台运营（G-50）」五个方向——**唯独没有人负责"业务代码自己的日志与错误"**（§1.3 矩阵取证）。

4. **我们的空位是「编译期结构化」（Compile-time Structured Debugging）**：现有四代方案**全部**是"运行期采集 → 回传 → 展示"范式；Proteus 是唯一一个**编译期就知道每一条日志在哪个组件、哪一行、属于哪个原语、在哪一端会降级**的框架。→ 于是运行期只需要说一句 `logId`。

5. **三机制**：**L1 日志身份化**（编译期给每条日志发身份证）· **L2 错误语义化**（Apollo 的运行期版，共用 PT 码）· **L3 单通道汇聚**（一条 TraceBus 事实通道，五端同一协议）。

6. **杀手功能（别人结构上做不到）**：`proteus debug explain <logId>` —— 输入一个日志身份，回溯到**源码位置 + 编译决策链 + 五端表现差异**。

7. **明确不做**（诚实边界，§10）：❌ 断点调试器（App 端 JSC/QuickJS/JSVM **无统一调试协议**，见 §3.3）· ❌ 生产遥测（G-19 M8.3 已裁定延后，与中台分工）· ❌ 自建第 N 个 DevTools UI（复用既有两套 + Vue DevTools）。

---

## 1. 现状取证

### 1.1 已有底座（**必须先说清，否则就是第七个轮子**）

| 能力 | 出处 | 现状 | 本方案怎么用 |
|---|---|---|---|
| **TraceBus**（统一事件协议 + 环形缓冲 10000 + 脱敏 + 采样 + 零开销门控 + `globalThis` 惰性单例） | `packages/devtools-runtime/src/index.ts` | **已交付** | **L3 的事实通道**（只扩事件源，不重建） |
| Web/MP DevTools UI（十视图 + 时间旅行 + 插件 + 开放 API） | `packages/devtools/` | **已交付** | 面板复用（人看的那一半） |
| App DevTools 面板（SSE 单页 + 反向命令 `/panelcmd`→`/cmd`） | `packages/cli/src/app-devtools-page.ts`、`app-dev-server.ts` | **已交付** | App 三端复用 |
| **设备→开发机回传通道**（`/ping` `/log` `/trace` `/tree` `/inspect` `/bridge`） | `packages/cli/src/app-dev-server.ts:344-385` | **已交付** | **L3 的"线"已经铺好了** |
| 三端 console 垫片（Android `installDevConsole` / iOS `installDevConsoleShim` / Harmony `devInstallConsoleShim`） | `packages/cli/templates-host/{android,ios,harmony}` | **已交付** | **L1 的挂载点** |
| 零依赖 source map 消费者（`mapStack` 逐帧映射） | `packages/cli/src/sourcemap.ts`（决策 **#711**） | **已交付**（dev bundle 内联 map） | **L2 栈回源** |
| **IR 节点源位置** `loc {line, column}` + `file` | `packages/slot-runtime/src/layout-template.ts:41-46`（决策 **#713**）、`packages/render-backend/src/screen-runtime.ts:69-73` | **已交付** | **L2 节点级回源**（注释自述：App 页面 SFC 不打包、无 esbuild sourcemap ⇒ 这是**唯一**通路） |
| Apollo 诊断（PT 码 SSOT + 分层 + `--json`/`--raw` + 强制保留原文） | `packages/cli/src/diag.ts` | **已交付**（编译期） | **L2 复用码表与格式化** |
| 操作录制回放（SessionBundle + 回放引擎） | `docs/proteus-devtools-plan/16-record-replay.md` | **已排期** | §6 的 `debug replay` 直接复用 |
| 「日志要能被 grep / 重定向」+ 非 TTY 零 ANSI | `packages/cli/src/ui.ts:9-13` | **已交付** | CLI 输出的既有纪律 |
| 静态门禁范式（禁盲等的正则棘轮） | `scripts/check-no-blind-wait.mjs` | **已交付** | §7 门禁照此范式 |

### 1.2 ★ 缺口：四道断掉的接口（本方案的存在理由）

底座很厚，但**四处接口是断的**——这就是"只能 console.log"的真实原因：

| # | 断口 | 取证 |
|---|---|---|
| **①** | **宿主错误 → Apollo 诊断，无连接**。设备侧错误只进 DevTools 面板的 `/log`，与 `diag.ts` **零调用关系**；`diag.ts` 全文件无网络/设备读取。 | `diag.ts`（无网络引用）；`app-dev-server.ts:374-385` |
| **②** | **普通日志无来源**。console 垫片只捕获 `level + text`；**只有 Error 才带 `stack` 字符串，且三端 native 都不读 `.stack`**——错误串恒为 `Error: message` 级。 | `templates-host/android/.../AppActivity.java:639-650`；`hosts/ios/.../selfdraw-app.swift:167-170`；`hosts/android/js-engine/quickjs_jni.c:757-767` |
| **③** | **两套 UI 割裂**。Web/MP 走 `@proteus-vue/devtools`（WS/CDP），App 三端走 CLI dev server（HTTP/SSE）——**仅共享事件协议形状，UI 与数据面各自实现**。 | `packages/devtools/` vs `packages/cli/src/app-devtools-page.ts` |
| **④** | **日志无身份、不可门禁**。裸字符串 ⇒ 无法被 CI 断言、无法跨端对齐、无法回溯源码；回归只能靠人眼。 | 无任何 `logId` / DebugManifest 概念（全仓零命中） |

> **另一条硬事实**：`docs/Proteus_Playground设计方案.md:277` 与 `:464` 已把"**编译错误只在终端可见 | 必须回传手机端，否则手机调试寸步难行**"列为**坑位清单**——这一条连"编译期"都还没解决，更不用说运行期。

### 1.3 六份既有计划的定位矩阵（**谁管什么，我不重复谁**）

| 计划 | 代号 | 管的是 | 象限 |
|---|---|---|---|
| `proteus-devtools-plan` | G-19 | 运行时诊断：**框架自身**六源 trace（lifecycle/router/store/api/capability/compiler）→ 面板 | 框架 × 运行期 |
| `proteus-devtools-plus-plan` | G-34 | JSI 架构的毫秒级 HMR + 协议层（CDP 桥 / 原生视图检查器 / LeakRegistry） | 协议 × 开发期 |
| `proteus-devtools-suite-plan` | G-54 | **编码期（authoring-time）**：IDE 内嵌框架独占知识（IR/分层/conformance/SPI） | 框架 × 编码期 |
| `proteus-devtools-landing-plan` | G-55 | G-54 的工程落地（Rust 常驻内核守护进程 + 宿主适配器 + 性能预算） | 工程 × 编码期 |
| `proteus-vue-devtools-plan` | G-19 补充 | **Vue 组件树 / 状态**（复用 Vue DevTools UI + `setupDevtoolsPlugin`） | 业务组件 × 运行期（**状态维度**） |
| `proteus-developer-platform-plan/06` | G-50 A3 | 平台化调试协议（多租户 / 沙箱 / 配额 / 发布流水线） | 平台 × 运营期 |
| **本方案** | **Helios（暂定）** | **业务代码自己的 `console` / 抛错：跨端统一、带源位置、可汇聚、可门禁** | **业务 × 运行期（日志/错误维度）** ← **唯一空白** |

> **一句话区分**：G-19 回答"**框架**刚才发生了什么"；Vue DevTools 回答"**组件状态**现在是什么"；G-54 回答"**这段代码**编译成什么"；**本方案回答"**我那行 console.log** 到底跑没跑、在哪一端跑、输出的是什么"**——这个没人管。

---

## 2. 为什么 `console.log` 救不了跨端（六条结构性缺陷）

| # | 缺陷 | 为什么它是结构性的（不是"工具不够好"） |
|---|---|---|
| **D1** | **语义过桥即失真** | 跨边界只能传字符串。对象 → `[object Object]`，循环引用 → 抛错或截断，`Map/Set/Proxy` → 无法还原。**这不是格式化问题，是通道问题。** |
| **D2** | **位置失真** | 编译后位置 ≠ 源码位置。同类公开 bug：Taro issue **#16271**——"编译器输出的错误定位指向 `dist` 产物，而非开发者写的源码"（`构建与编译错误语义化诊断方案.md:41-47` 已引）。**报错了，但没用。** |
| **D3** | **五端五个地方看日志** | uni-app 实测（公开问答取证）：浏览器预览在 HBuilderX 控制台；Android 真机要 `adb logcat`（tag `chromium`）；iOS 真机要 Safari Web Inspector；小程序在微信开发者工具；App 端还得装 vConsole。**同一份代码，五个窗口。** 这正是"繁琐"的来源。 |
| **D4** | **真机不可断点、不可步进** | Web 有 Chrome DevTools，因为浏览器有调试协议。App 三端**没有统一协议**（§3.3），Harmony 更是**一次性 VM**（每次交互新建 → eval → 销毁，`host_app_runtime_impl.h:19-24`）——**根本不存在可长连的调试会话**。 |
| **D5** | **生产黑盒** | 错误只在发生的那一瞬可见，之后就没了。三端 native 各写一份 `host-app-events.json`（history ≤ 64），Harmony **连这个都没有**（`host_app_runtime_impl.h:256,345` — 异常对象取到后**直接丢弃**）。 |
| **D6** | **日志无法被门禁** | 裸字符串进不了 CI。今天修好的 bug，明天可能因为一条日志被删/被改而重新隐形——**没人知道。** |

> **D3 是痛点，D6 是它为什么永远修不好。** 前面五代工具都在治 D1–D5，**没人治 D6**。

---

## 3. 对标：四代调试方案，以及它们的共同盲点

### 3.1 代际划分

| 代 | 代表 | 解决了什么 | **没有解决什么** |
|---|---|---|---|
| **1.0 打印** | `console.log` / `alert` | 零成本上手 | 全部（D1–D6） |
| **2.0 端上面板** | **vConsole**（uni-app / Taro 生态标配） | 真机屏幕上可见（"黑夜里的手电筒"） | 仍是字符串（D1）、无源位置（D2）、**生产必须关（否则泄露）**（D5） |
| **3.0 外部工具** | **Flipper / RN DevTools / Reactotron**（RN）· **DevTools + Inspector**（Flutter）· **devtool 工具链**（Lynx：`base_devtool/common` + android/ios 特化 + `inspector_performance_agent`） | 结构化、断点、网络、性能 | **每端一套工具**（D3）；需设备连开发机；App 端协议各自为政 |
| **4.0 编译期结构化** | **（空位）** | — | — |

### 3.2 关键洞察：**四代全是"运行期采集"**

所有方案的骨架都是同一个：**运行期产生 → 采集 → 回传 → 展示**。差别只在采集器和 UI。

- **Flutter 能断点**，是因为 **Dart VM 自带 service protocol**（语言运行时内建）；
- **RN 能断点**，是因为 **Hermes 实现了 CDP**；
- **Lynx 能连调试器**，是因为**自建了一整套 CDP agent**（成本极高）；
- **微信小程序能断点**，是因为**它自己就是宿主 + 引擎**。

### 3.3 于是，我们的 App 三端做不到什么（**必须承认**）

Proteus App 端用的是**别人的引擎**：iOS = 系统 **JavaScriptCore**、Android = **QuickJS**、Harmony = **JSVM**。

| 引擎 | 有调试协议吗 | 结论 |
|---|---|---|
| JavaScriptCore | 有 `JSContextGroup` 私有调试接口，但**非公开 API**、需自行实现 inspector 前端 | **不划算**，且 App Store 风险 |
| QuickJS | **无**（需自建 `-DDUMP_LEAKS` 级别自研） | **不做** |
| JSVM | 有 DevEco 工具链（`hdc` + DevEco Profiler），但**只在 Harmony 侧** | 且**一次性 VM 模型**（每次交互销毁）使会话无法长连 |

> **所以：断点调试器不是我们的战场**——那是引擎厂商的位置。**我们的战场是"编译期已知"**：编译器知道每一条日志的身份、位置、所属原语、以及它在五端的落地差异。**这是引擎厂商给不了的，也是 RN/Flutter 结构上做不到的。**

---

## 4. 方案：编译期结构化调试（Compile-time Structured Debugging）

### 4.1 L1 · 日志身份化（Log Identity）★ 核心发明

**编译期**：每个 `console.*` 站点被编译成一份**身份**——

```ts
// 源码 pages/detail.vue:88
console.log('user', u.id)

// 编译期产出（DebugManifest 条目 + 运行期调用）
{ logId: 0x3f21, file: 'pages/detail.vue', line: 88, column: 5,
  level: 'log', template: 'user $1', owner: 'p-view#12', component: 'DetailPage' }

// 运行期发出的（走 S2 零拷贝通道，不是 JSON 文本）
Uint8Array [ 0x3f, 0x21, /* args: 42 */ ]
```

**收益（每一条都对应 §2 的一条缺陷）**：

| 收益 | 对应缺陷 |
|---|---|
| 线格式从 `"user 42"`（含格式开销）变成 `logId + 原始参数`，**体积↓、可结构化还原** | D1 |
| 位置**编译期确定**，永不失真（不依赖 source map 反解） | D2 |
| **五端共用同一个 `logId`** ⇒ 日志可跨端对齐（见 §5.2） | D3 |
| `DebugManifest` 是**可 diff 的产物** ⇒ 可进 CI 门禁 | D6 |

> **关键纪律（对齐仓库铁律）**：manifest 只在 **dev** 发射；release 缺失时**降级为源码字面量**（不是报错）——功能不得只落 dev-only（`docs/proteus-new-host-implementation-semantics.md:54-57`）。

### 4.2 L2 · 错误语义化（Apollo 的运行期版）

Apollo 只覆盖**编译期**（tsc/swiftc/esbuild），且 §13 明确"不做运行期错误捕获"。本方案补上运行期那一半，**共用同一套码表与格式化**：

- **扩展 Apollo 新增阶段 `R`（运行期）`PT-R{类别}-{NNN}`**，新码须**补录进 `DIAG_CODES`**（未登记码 `makeDiag` 会直接 throw，这是既有的强约束）。
- **接回源位置**：错误发生时，用 `LayoutNode.loc`（节点级）+ `screen-runtime.ts` 的 `file`（屏级）+ `sourcemap.ts::mapStack`（JS 栈级）还原到 `.vue:line:col`。
- **补 `.stack` 读取**：三端 native 现在全部只取 `toString()`/`message`（§1.2 断口②）——**必须在捕获点补读 `stack` 并回传**，否则永远没有帧信息。
- **Hermes 式脱敏**：复用 TraceBus 的 `redactValue`（`password/token/authorization/idcard/phone`），**在采集点脱敏而不是展示点**。

### 4.3 L3 · 单通道汇聚（One Wire）

**一条事实通道，五个端，两个消费端**：

```
  Web ──────────┐
  Skyline MP ───┤
  iOS ──────────┼──→ TraceBus（统一事件协议）──┬──→ DevTools 面板（人看）
  Android ──────┤   新增 source: log / error  │
  Harmony ──────┘                             └──→ CLI（CI 断言 / --json）
```

- **App 三端**复用**已存在**的 dev server `/log` 通道（`app-dev-server.ts:374-385`）；
- **Web/MP** 复用 `@proteus-vue/devtools` 的 WS relay；
- **不新建通道**——这正是 §1.1 说的"线已经铺好了，只是上面跑的是字符串"。

> **与 Clio 的边界（硬约束）**：`docs/Proteus_业务埋点采集与多端口径统一方案.md:29-32` 明确"**诊断轨道与业务轨道不得共用总线**"。本方案走 **TraceBus（诊断）**，Clio 走业务上报——**两者不得混用**。

---

## 5. 杀手功能（别人结构上做不到的三件事）

### 5.1 `proteus debug explain <logId>` —— 日志的"身份证查询"

```
$ proteus debug explain 0x3f21

  logId   0x3f21
  来源    pages/detail.vue:88:5        ← 编译期确定，非 source map 反解
  组件    DetailPage → p-view#12
  模板    'user $1'
  编译决策  该行位于 v-if 分支内 ⇒ Harmony 端走「降级路径」(PT-CD-004)
  五端表现  web ✓  skyline ✓  ios ✓  android ✓  harmony ✗（缺失）★
```

**为什么别人做不到**：这条命令要同时吃下**编译期决策链**（`proteus explain` 已有）与**运行期事实**（本方案新补）——RN 的 Metro 不知道组件树，Flutter 的 DevTools 不知道编译决策，**只有"编译期全知"的框架能给出这一个答案**。

### 5.2 跨端日志对齐（五端 diff）—— "同一条日志，Harmony 丢了"

因为五端共享 `logId`，可以**直接 diff 五端的日志集合**：

```
$ proteus debug logs --diff

  ✗ 仅 Harmony 缺失 (3)
      0x3f21  pages/detail.vue:88   user $1
      0x2a07  pages/cart.vue:41     total $1
      ...
  ⚠ 参数不一致 (1)
      0x1c33  pages/list.vue:112    web=[42]  ios=[43]     ← 疑似时序/竞态

  结论：3 条日志在 Harmony 端从未执行 ⇒ 命中已知问题：一次性 VM 内 console 只在
        hostAppRender 路径被捕获（host_app_runtime_impl.h:420）
```

> **这是跨端框架专属能力**——Web 框架没有"第二端"，单端框架没有"对齐"问题。**它把调试从"我看我的日志"升级为"五端的事实比对"。**

### 5.3 日志 lint（编译期）—— 把"日志质量"变成可检查项

在编译期对 `console.*` 站点做静态检查（复用现有编译规则门禁范式）：

| 规则 | 判据 | 为什么 |
|---|---|---|
| `LOG001` | `console.error` 只传字符串字面量，无上下文对象 | 出错时你需要的恰恰是上下文（对齐 Apollo 的"报错要带上下文"） |
| `LOG002` | 日志出现在循环体内且无节流 | 会刷屏，掩盖真问题 |
| `LOG003` | 打印敏感字段（命中脱敏键） | 在采集点就该拦住 |
| `LOG004` | 裸 `console.log` 未走 debug 通道 | 保证 L1 覆盖率（否则 manifest 有洞） |

> **别的框架里没有这种东西**——因为它们的日志是"运行期的自由文本"，**根本没有一个"编译期站位"可以被检查**。这是 L1 的直接衍生品。

---

## 6. CLI 面貌：`proteus debug` 命令族

> **设计原则**：**CLI 只做"机器可断言"的那一半**，人看的 UI 全部复用既有资产（App DevTools 面板 / G-19 面板 / Vue DevTools）——**不新建第 N 个 UI**。

| 命令 | 作用 | 复用 / 新增 |
|---|---|---|
| `proteus debug open` | 起统一调试台（按端自动选 App 面板或 G-19 面板） | 复用两套 UI |
| `proteus debug logs` | 终端实时流：可 grep、可 `--level` / `--source` / `--component` 过滤、`--json` | 复用 `/log` + TraceBus |
| `proteus debug logs --diff` | **五端日志对齐**（§5.2） | 新 |
| `proteus debug explain <logId>` | **日志身份查询**（§5.1） | 新（吃 `explain.ts` + manifest） |
| `proteus debug errors [--json]` | 运行期错误结构化输出（PT-R 码），接 CI | 复用 Apollo 格式化 |
| `proteus debug record` / `replay` | 录制回放 | 复用 `16-record-replay` |
| `proteus debug lint` | 日志质量检查（§5.3） | 新（编译期规则） |

> **与 `proteus explain` 的分工**：`explain` 回答"这段**代码**编译成什么"（编译期）；`debug explain` 回答"这条**日志**从哪来、为什么在这、五端如何"（运行期 + 编译期联合）。**不重叠。**

---

## 7. 门禁（让"调试"变成可回归的东西）

> 本仓纪律：**性能项没有门禁等于没做**（`15-dactyl-demo.md` §11）。**调试项同理**——可观测性一旦不能回归，就会重新腐化成"散落的 console.log"。

| 门禁 | 判据 | 范式来源 |
|---|---|---|
| `check:debug-manifest-fresh` | `DebugManifest` 与实际日志站点**逐条一致**（棘轮：只增不减） | `check:profile-baseline` |
| `check:no-raw-console` | release 产物中**无裸 `console.log`**（必须经 debug 通道，可剥离） | `check-no-blind-wait.mjs`（正则 + 白名单 + 棘轮） |
| `check:error-codes-registered` | 运行期新错误码必须登记 `DIAG_CODES` | `makeDiag` 既有 throw 行为 |
| `check:log-desensitized` | 日志采集点命中脱敏键即失败 | TraceBus `redactValue` |
| `check:log-lint` | §5.3 的 LOG001–LOG004 | 编译规则门禁 |

---

## 8. 与既有计划的关系（避免重复立项）

| 既有 | 关系 |
|---|---|
| `proteus-devtools-plan`（G-19） | **数据面与 UI 全部复用**；本方案只**扩展事件源**（`log` / `error`）与**补上业务日志维度**。**不重建 TraceBus。** |
| `proteus-devtools-plus-plan`（G-34） | 协议层复用；HMR 与调试通道**共用消息通道**（对齐其 `06-debug-protocol.md` 的同款结论） |
| `proteus-devtools-suite-plan` / `landing-plan`（G-54/G-55） | **正交**：那两份管**编码期**（敲键盘时在 IDE 里查框架知识）；本方案管**运行期**（跑起来之后）。§5.3 的日志 lint 走它们的**协议层**接入 IDE。 |
| `proteus-vue-devtools-plan` | **互补维度**：Vue DevTools 管**状态/组件树**；本方案管**日志/错误**。同一条源位置可互相跳转（`loc` 是共享字段）。 |
| `Proteus_构建与编译错误语义化诊断方案.md`（Apollo） | **编译期 ↔ 运行期两半**：共用 PT 码、分层格式化、`--json`/`--raw`、**并新增阶段 `R`**。 |
| `Proteus_业务埋点采集与多端口径统一方案.md`（Clio） | **严格分离**：Clio = 业务上报（送出去）；本方案 = 诊断（开发期看）。**不得共用总线**（其 §0.0③ 明令）。 |
| `14-input-bridge-latency.md` | **S2 零拷贝通道 = 本方案 L1 的线格式**（否则日志本身就是延迟源） |
| `15-dactyl-demo.md` | Dactyl 的 HUD 指标与崩裂回放**消费**本方案的事件流（`hosts/shared/dactyl/` 直接读） |
| `Proteus_Playground设计方案.md` | 本方案**解决**其 §14 坑位清单里"编译错误只在终端可见"与 §4.1 待建的"日志回传" |

---

## 9. 分期与 DoD

| 批次 | 内容 | DoD（可证伪） |
|---|---|---|
| **H0 · 取证与地基** | 三端补 `.stack` 读取并回传；确认 `/log` 通道端到端（含 Harmony）；写 `debug-metrics.schema.json` | 三端各能收到一条**带 `.vue:line:col` 的错误**（真机证据） |
| **H1 · L1 日志身份化** | 编译期 `logId` 生成 + `DebugManifest` 产物 + 运行期线格式 + `debug logs` | 五端同一条 `console.log` 落到同一 `logId`；体积对比报告 |
| **H2 · L2 错误语义化** | PT-R 码段（登记 `DIAG_CODES`）+ 三层回源（节点/屏/栈）+ `debug errors --json` | 一个真机运行期异常，输出**源码位置 + PT 码 + 原文全文** |
| **H3 · L3 汇聚与对齐** | 五端事件接入同一 TraceBus；`debug logs --diff`；`debug explain <logId>` | 五端 diff 能**自动指认**"某端缺失"并归因到已知端差异 |
| **H4 · 门禁与 lint** | §7 的五条门禁 + §5.3 日志 lint | 门禁进 CI；故意删一条日志 ⇒ 门禁红 |

> 每批必须带**真机取证**与门禁（本仓纪律）。

---

## 10. 风险与诚实边界

| # | 风险 / 边界 | 处置 |
|---|---|---|
| R1 | **Harmony 一次性 VM 导致日志丢失**（console 只在 `hostAppRender` 一次调用内可见，`host_app_runtime_impl.h:420`；异常对象取到即丢，`:256,345`） | H0 专项：**在 VM 销毁前 drain**（已有 `g_devConsoleOut` 雏形，16KB）+ 补 `HostAppBoot/Drive/Eval` 三条路径的垫片 + 错误**必须写 hilog**（现状不写 ⇒ native 日志不可见） |
| R2 | **`DebugManifest` 体积** | 只在 dev 发射；分段 + 差分（对齐 G-19 的 SessionBundle 思路） |
| R3 | **日志本身成为性能源** | 线格式走 S2 零拷贝；`enabled=false ⇒ emit noop`（TraceBus 既有门控）；Dactyl 的 `viz=off` 同款纪律 |
| R4 | **两套 UI 合一成本高** | **不做合一**——只统一**数据面**（事件协议已统一）；UI 各自演进（本方案不改 UI） |
| R5 | **生产采集** | ❌ **不做**。对齐 G-19 M8.3 的裁定（"生产零端点零开销"，生产遥测由中台 SessionBundle 覆盖）；**release 剥离调试件**（`DEV` 编译期常量） |
| R6 | **断点调试缺席** | 诚实承认（§3.3）：JSC 私有 API / QuickJS 无协议 / JSVM 一次性会话 ⇒ **不在"断点"上竞争** |
| R7 | **命名未检索** | `Helios` 为**暂定**，定名前须做商标与包名检索，检索通过前**不入万神殿已定名清单** |
| R8 | **"跨端日志对齐"依赖五端都接了 L1** | H3 前该功能**不作为结论引用**；缺端时明确标注"未接入"而非"缺失" |

---

## 附录 A · 一句话对外话术

> **对开发者**：*"在 `.vue` 里写 `console.log`，在手机上直接看到 `pages/detail.vue:88`——不用连 adb，不用开 Safari，五端一个窗口。"*
> **对评审**：*"别人的调试是'打印出去再想办法'；我们是'编译期就知道这条日志是谁'——所以它能被对齐、被 diff、被门禁。"*
> **诚实版**：*"我们不做断点调试器，那是引擎厂商的位置；我们把'编译期已知'这件事做到极致。"*

## 附录 B · 本方案明确不做（对齐既有"不做清单"）

| 不做 | 理由 |
|---|---|
| 断点 / 单步调试器 | 三端引擎无统一调试协议；Harmony 一次性 VM 无长连会话（§3.3） |
| 生产遥测 / 监控面板 | G-19 M8.3 已裁定延后；生产聚合归中台（`devtools-plan/11-m8-observability.md:40-46`） |
| 第 N 个 DevTools UI | 复用 G-19 面板 + App 面板 + Vue DevTools |
| 业务埋点 / 数据平台 | Clio 的领域；**不得共用总线** |
| 自动修复 / AI 改代码 | Apollo §17 已裁定：只给建议，不自动改 |
| 截屏式回放 | `16-record-replay.md:59` 已排除（体积/隐私） |
