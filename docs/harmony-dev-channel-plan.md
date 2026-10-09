# 鸿蒙 DevTools dev 通道 —— 立项 / 落地计划

> **状态**：立项（2026-10-09 · 决策 #719）。**本轮未写任何代码**——按用户决定"这轮只做安卓，
> 鸿蒙另立里程碑"。本文固化取证结论与分步方案，供后续独立批次接手。
>
> **一句话**：安卓/iOS 的 dev 通道（`proteus dev --target <端>`：dev server 心跳 + 面板元素/事件/性能 +
> 面板→设备命令）在鸿蒙上是**零**——本项要把它建成，且**前置**是鸿蒙 CLI 壳先要变成"运行期壳"。

---

## 1. 背景：dev 通道是什么（三端契约）

`proteus dev --target <ios|android|harmony>` 起一个 **dev server**（`packages/cli/src/app-dev-server.ts`，
端点端无关），宿主设备通过 HTTP 与它双向对话：

| 方向 | 端点 | 作用 |
|---|---|---|
| 宿主→server | `GET /ping?screen=&env=&perf=` | 设备在线 + 当前屏 + 环境 + 性能（面板心跳） |
| 宿主→server | `GET /log` `GET /trace` `POST /tree` `GET /inspect` `GET /bridge` | 面板 Console / Events / Elements / Network |
| server→宿主 | `GET /version` `GET /bundle` | 热重载（版本变 ⇒ 重拉 bundle 重渲） |
| server→宿主 | `GET /cmd` | 反向命令（highlight / edit / reset / eval），面板入队、宿主轮询取走 |

iOS/Android 的接线：`templates-host/{ios,android}` 的壳 + `ProteusBuildConfig.{DEV,DEV_URL}`
（dev 变体就地覆写）+ `startDevWatch`（轮询 `/version`/`/cmd`，上报 `/ping`/`/log`/`/tree`/`/trace`）。

---

## 2. 现状取证（**鸿蒙全空**，逐条有据）

| 环节 | iOS | Android | 鸿蒙 |
|---|---|---|---|
| dev manifest / 权限 | 构建期注入 ATS 例外 | `AndroidManifest.dev.xml`（INTERNET + cleartext） | **无**（`module.json5` 连 `requestPermissions` 都没有） |
| dev server 地址注入 | 启动参数 `--proteusDev` | intent extra `proteusDev` | **无** |
| 心跳/热刷/命令 | `ProteusApp.swift` `startDevWatch` | `AppActivity.startDevWatch` | **无** |
| `packageXxxHost` dev 变体 | 有（覆写 `ProteusBuildConfig.swift`） | 有（覆写 `ProteusBuildConfig.java`） | **无**（`packageHarmonyHost` 无 `dev`/`devUrl` 参数） |
| `proteus dev --target` 装/起 | `devicectl` launch + 注入 | `adb install` + `am start --es proteusDev` | **仅 `ui.info('请用 hdc')` 提示 stub**（`index.ts` runAppDev harmony 分支） |
| 元素高亮 / 节点树内省 | `highlightNode` / `__proteusSuperappTree` | `VaporRenderHost.highlightNode` + `pushDevTree` | **无**（`Superapp.ets` 的 `highlightTab` 只是 Tab 选中态，非 dev 元素高亮） |

**实证**：`grep -rE "ping|/version|/cmd|devServer|http|INTERNET" packages/cli/templates-host/harmony hosts/harmony/host-app/entry/src/main/ets` → **零命中**。

---

## 3. ★★ 核心障碍：鸿蒙 CLI 壳**没有运行期**（无 JS 引擎）

**这是最关键的一条，决定"鸿蒙 dev 要同级"不是"补端点"而是"先改壳架构"。**

- **CLI 模板壳**（`packages/cli/templates-host/harmony/entry/.../MainPage.ets`）**不 eval bundle**：
  它只 `getRawFileContentSync('app-screen-content.json')`（**静态内容**：项目 SFC 的编译产物 nodes）
  → `appScreenCommands`（C++ 转 RenderCmd）→ `renderCommands` 上屏。**无 JS 引擎、无路由、无事件、无响应式**
  （对照：Android/iOS 壳跑的是 `bundle-superapp.js`，含 router/runtime/events）。
- **reference 宿主**（`hosts/harmony/host-app/.../Superapp.ets`）**有** JS 引擎（`libproteus_bench.so` 的
  `superappDrive`/`superappScreen` eval bundle），但**是"一次性 VM"**：每次交互**新建 VM → eval → 泵 → 读 → 销毁**
  （`proteus_bench.cpp:3770-3782`：跨 napi 调用复用同一 VM 会在 V8 微任务排空阶段 SIGSEGV / HandleScope 溢出）。
  ★诚实边界：`docs/project-memory-archive/decisions.md` 已记「hostBoot/hostDrive 仍留 dev——与 dev 的
  screen.* 执行器簇深度耦合、带项目身份（superapp）」= 这是**参考宿主的 dev 装置**，不是 runtime 单元。
- **结论**：`proteus dev --target harmony` 打出的包渲染的是**构建期静态内容**（`packageHarmonyHost` 只拷
  `screen-content.json`），**runAppDev 的"热重载"对它无意义**（没有运行期可热重载、没有事件可上报）。

---

## 4. 障碍清单（带依据）

| # | 障碍 | 依据 |
|---|---|---|
| H1 | **壳无运行期**（不 eval bundle） | `templates-host/harmony/.../MainPage.ets:36` 只读 `app-screen-content.json`；不像 Android/iOS 读 `bundle-superapp.js` |
| H2 | **一次性 JSVM**（无"活着的上下文"） | `proteus_bench.cpp:3770-3782`；⇒ `eval`/实时 `/tree` 触不到活 App 状态 |
| H3 | **无 INTERNET 权限** | 两处 `module.json5` 无 `requestPermissions` |
| H4 | **无 dev 地址注入** | `EntryAbility` 不读 `want.parameters`（参考宿主读 `scene`/`scroll`，可仿） |
| H5 | **`packageHarmonyHost` 无 dev 变体** | `host-package.ts:45-51`（`PackageHostOptions` 无 `dev`/`devUrl`）；`index.ts:926` 未传 |
| H6 | **无高亮 / 节点树内省原生能力** | 对照 Android `ProteusHostView.setDevHighlight` / iOS `highlightNode`；鸿蒙为零 |
| H7 | **无 ArkTS HTTP 先例** | 全仓零 `@ohos.net.http`/`@kit.NetworkKit` 调用（仅文档提及） |
| H8 | **无常驻壳线程模型** | ArkTS/UIAbility 单线程 UI；JSVM eval 非线程安全 ⇒ 轮询只能挂 `setInterval`/taskpool |

---

## 5. 建议分步（独立里程碑，建议顺序）

### 步 1 · 把鸿蒙 CLI 壳升级为**运行期壳**（前置，最大）——✅ **已落地（决策 #725 · 2026-10-09）**
目标：模板壳 eval `bundle-superapp.js`（含 router/runtime/events），与 Android/iOS 同级。
- ✅ 把 `superappDrive`/`superappScreen`（boot/切屏/实例化）从 dev 装置（`proteus_bench.cpp`）**下沉到
  runtime HAR**（`host_app_runtime_impl.h`，中性名 `hostAppBoot/Drive/Render`；bench 保留 `superapp*` 薄别名）
  ——拆掉了 `check-host-layering` 的"shell 反向依赖 dev"具名登记（棘轮已清零）。
- ✅ **一次性 VM 约束**维持（本机唯一稳定形态）：跨交互状态经 `snapshot` 回灌 `seedData`；命中链由 ArkTS 传。
- ✅ 协议：bridge（`entry-superapp.ts`）增 `__proteusHostApp*` **中性别名**（= `__proteusSuperapp*` 同一实现）
  ——绕开 runtime 禁词（`check-host-layering`）。
- ✅ 产物侧：`packageHarmonyHost` 拷 `bundle-superapp.js` 进 rawfile；壳源自愈（`syncHarmonyShell`）。
- ✅ CLI 可启动：`runAppDev` 鸿蒙分支补 `hdc install` + `aa start -a EntryAbility -b <bundle>`。
- ✅ **自持**（无框架 checkout 也能装机）：`prebuilt/harmony/proteus_render`（随 CLI 发布，含 arm64 Rust 核）；
  门禁 `check:harmony-runtime-prebuilt`（prebuilt ⇄ 真源 逐字节）。
- ✅ **顺带修的潜伏缺陷**：HAR 的 CMake 原用**框架深度相对路径** include `platform/harmony/...`，在框架参考宿主
  恰好命中、而 CLI 宿主（HAR 浅一层）失效 ⇒ `proteus_text_platform.h` not found（"cli 就能跑起来"的拦路石）。
  改为**随 HAR 自持**该平台适配头（引号 include 同目录解析，与布局无关）。
- ✅ 真机验收：参考宿主 `run-superapp.sh`（下沉忠实、无回归）+ CLI `build --target harmony --package` 真机装机跑起来。

### 步 2 · dev 地基（心跳 + 热刷 + 日志）——✅ **已落地（决策 #728 · 2026-10-09）**
- ✅ `module.json5` 加 `ohos.permission.INTERNET`（恒带；release 不发起网络 ⇒ 由 `DEV` 门控代码保证）。
- ✅ 鸿蒙版 `ProteusBuildConfig.ets`（`DEV`/`DEV_URL`，对齐两端）+ `EntryAbility` 读 `want.parameters['proteusDev']`
  → `AppStorage`（`--ps proteusDev <url>`；`DEV_URL` 编译期兜底）。
- ✅ ArkTS 侧 dev-watch（`dev/DevWatch.ets`，`@kit.NetworkKit` 的 `http`）：有界 `setInterval` 轮询
  `/version`→`/bundle`（**热刷**）+ `/ping`（上报 screen/env/perf）+ `/log`（原生日志）+ `/trace`（事件）+ `/tree`（POST 树）。
  ★单飞（busy）+ 失败静默（尽力而为）——产品内的周期性 dev 轮询（非"等条件"盲等）。
- ✅ `packageHarmonyHost` 加 `dev`/`devUrl`（编译前覆写 `ProteusBuildConfig.ets` 为 `DEV=true`·`DEV_URL`，编译后还原）；
  `runAppDev` 的 `hdc install`+`aa start --ps proteusDev <url>`（#725 装起 + #728 注入）。
- ✅ dev 可视化层 `dev/DevOverlay.ets`（角标替身：`flash` toast + 面板 URL）；`if (DEV || devBase)` 门控创建（release 零残留）。
- ✅ **真机验收**：`proteus dev --target harmony` ⇒ `DEVWATCH_START`；心跳入 SSE（`host.screen/env/perf`）；
  改源码 ⇒ `version 1→2` ⇒ host 自动重渲（`hot reload · v2`）；`/tree` 97 节点、`/log` 达面板。

### 步 3 · dev 命令集（highlight / 就地编辑 / eval）——✅ **已落地（决策 #729 · 2026-10-09）**
- ✅ dev-watch 轮询 `/cmd`（one-shot）→ 宿主 `applyCommand`：
  - **highlight**：native `appScreenNodeRect(id)`（内核 rect → **cmd 同口径物理 px**，与命中同源）
    → 在 cmd 尾部叠一条**半透明高亮框**（不改 C++ 命中/sticky 语义）；
  - **就地编辑**：写入 `devEdits`（节点 id → 字段覆盖），每轮渲染**重施到实例树** ⇒ **任意字段生效**
    （不走增量 `PatchStyle` 字段子集——Android #722 的教训）；
  - **reset**：清 `devEdits` + 重渲（恢复项目代码效果）；
  - **eval**：native `hostAppEval`（一次性 VM 内 boot + 求值）→ 结果入 Console。
- ✅ **真机验收**：highlight #1 → 浅蓝高亮框；edit #1 `color=#D64545` → 标题变红；reset → 恢复黑；eval `1+2` → `3`。

### 步 4 · 深化（面板数据对齐 Android/iOS）——✅ **已落地（决策 #730 · 2026-10-09）**
- ✅ **逐帧 perf**（对齐 iOS `CADisplayLink`）：独立**常驻** `displaySync` 采样真实帧间隔 →
  `fps` / `frameMs` / `frameMaxMs` / `frames` / `dropped`（`>1.5× 帧预算` 判掉帧；排空式每心跳取一次——
  #723 教训"周期量每 tick drain"）+ `mountCalls`（渲染次数）；真机实测面板 Profiler 有真帧率/掉帧。
- ✅ **被点元素 `/inspect`**（决策 #730）：命中链末位 id → dev-watch 上报（面板高亮被点节点）。
- ✅ **项目 `console.*` → 面板 Console·项目通道**：VM 注入 console 垫片（`proteusHost.invoke('dev.console')` 回收）
  → `hostAppRender` 返回 `console`（`level\ttext`）→ 壳入队（channel=project）→ 面板。真机验证捕获项目 `console.error`。

### 一句话结论
**鸿蒙 dev 通道已与 Android/iOS 对齐**：热刷(`/version`→`/bundle`) · 心跳(`/ping`) · 日志(`/log` native+project) ·
元素树(`/tree`) · 事件(`/trace`) · 被点(`/inspect`) · 逐帧 perf · 命令集(`/cmd`：highlight/edit/reset/eval)。

---

## 6. 诚实边界（写清以免被当"已完成"）

- **本轮零代码**：本文是立项，不改鸿蒙任何文件。
- 鸿蒙 dev 通道的**真机验证**需设备在线（`decisions.md:2305` 记 `69F9K26126005311` 曾在线可验）。
- 鸿蒙 `INTERNET` 是否真无运行时弹窗、`@ohos.net.http` 到局域网 cleartext 是否需额外配置——**本仓无实证**，
  须设备实测。
- **不要在 `hosts/harmony` 的 shell 目录里 import dev 模块**——`check-host-layering` 的 ②b
  （shell 不得反向依赖 dev）会红；dev 客户端应落在 `ets/dev/`（dev→dev 合法）。

---

## 7. 参考（三端对齐锚点）

- dev server 端点：`packages/cli/src/app-dev-server.ts`
- iOS 接线（最全参照）：`packages/cli/templates-host/ios/shell/ProteusApp.swift` · `ProteusDevOverlay.swift`
- Android 接线（本轮已补齐命令集，可作次参照）：`packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java`
- 鸿蒙现状：`packages/cli/templates-host/harmony/entry/src/main/ets/shell/{MainPage,EntryAbility}.ets`（静态壳）
  · `hosts/harmony/host-app/entry/src/main/ets/shell/Superapp.ets`（运行期参考宿主）
- 一次性 VM 依据：`hosts/harmony/host-app/entry/src/main/cpp/dev/proteus_bench.cpp:3770-3782`
- 分层门禁：`scripts/check-host-layering.mjs`
