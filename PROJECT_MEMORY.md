# Proteus 项目记忆（PROJECT_MEMORY.md）

> **项目本地记忆文件**：新会话入口 —— 当前进度 + 关键点 + 阅读指引（详细历史在 `docs/project-memory-archive/`）。
> 新会话的 LLM **必须先读顶部「当前状态速览」**，再按 §「会话恢复指引」顺序阅读。
> **维护规则见 §《收纳规范》**（门禁 `pnpm check:memory`）——新里程碑的详细叙事**直接写进当月归档**，主文件只加一行速览。

---

## 项目概览

- **名称**：Proteus（普罗透斯）—— Vue 跨端编译框架
- **核心理念（架构方向已定案，决策 #290）**：**一份标准 Vue 源码 → 语义 IR（C-IR/CompilerIR）→ 可插拔渲染后端**（Render anywhere, on any engine）；不再是「小程序编译器」——小程序降级为 Layer 1 兼容层
- **四层可插拔（原则 #10 终极形态）**：编译（G-29 CompilerBackend）/ 逻辑（JS 引擎）/ UI（G-27 RenderBackend）/ 能力（G-28 NativeBackend）
- **技术栈**：Vue 3.4+ / Vite 5 / TypeScript 5.4+ / 微信基础库 2.29.2+（Skyline + wx.router）
- **包规模**：**45 个 @proteus-vue/* npm 包**（+ `packages/layout-core-rust` = **cargo crate，非 npm 包**，故不计数）（★2026-09-29 layout-core = App 排版核心）（check:pkg 0 error · `pnpm check:stats` 校验 ✓；31→38 修正 → G-07 glass 39 → Skyline 收口 worklet 40 → ★2026-09-14 组件库拆包 `@proteus-vue/components` 41 → ★Vapor 线新增 `@proteus-vue/slot-runtime` 42 + `@proteus-vue/layout-core` 43 → ★2026-09-30 MA1 新增 `@proteus-vue/animation` 44；版本统一 0.3.0-beta.8，见「当前状态速览」）
- **文档**：`docs/proteus-architecture.md`（L0 规约·真理来源）→ `docs/board-inventory.md`（全景索引）→ `docs/roadmap.md`（版本线）→ `roadmap-2-plan`（里程碑线）→ 各 plan

## 当前状态速览（最近一次更新：**2026-10-08·（三二九）· ★★★Apollo 诊断首版——错误不再懵 + 修 Xcode 非默认位 · 决策 #684**——用户「阿波罗方案先做起来，现在这种错误提示非常懵」+ 配图（`proteus dev --target ios` 输出 `✗ swiftc 编译失败：`**冒号后空**）。★**取证两处**：a) **详情被吞**（失败分支只过滤 `✗` 行，缩进详情不含 `✗` ⇒ 丢）；b) 错误不可行动（无码/分类/根因/建议）。★**Apollo 核心**（新 `packages/cli/src/diag.ts`）：**L2** `PT-{阶}{类}-{序号}` + **码目录 SSOT**（未登记码 `makeDiag` 抛）+ 保留 X（未知，只定位不猜因）；**L0** 解析 tsc(TSxxxx)/swiftc(file:line:col)/esbuild(对象) + `captureRaw` 兜底；**L4** 分层（码/位置/根因/建议）+ **原始错误全文始终打印** + `--raw`/`--json`；**L3 仅确定原因**（如「无匹配描述文件」→ 根因 + `signing.sh use` 建议）。★**修详情丢弃**：host-package 失败附 `diagnostics`；两处失败分支改 `printDiagnostics`（无诊断则打全部 log）。★**★顺带修真 bug**：`dev/build --target ios` **只在 shell 预设 `DEVELOPER_DIR` 时才编译**（否则 `SDK "iphoneos" cannot be located`——xcode-select 指向 CommandLineTools、Xcode 在非默认位）⇒ 新增 `resolveDeveloperDir()`（**纯 fs 能力判据**）⇒ 用户无需 source env。★**★真机复现对照**：修前 `✗ swiftc 编译失败：`（空）；修后同命令无 env = Xcode 自动解析 → swiftc **真编译** → 落到真阻塞点并给完整诊断 `PT-BE-003 签名不可用 · 根因 + 建议 + 原文`。★**BX0 实测**（落方案 §14.1）：esbuild **无稳定码**（`id===''`）但有结构化 location；tsc 有 TSxxxx；swiftc 无码但 `file:line:col` 稳定 ⇒ **下层码不可依赖 ⇒ Proteus 码唯一对外**。★**测试** cli-diag **15/15**（码 SSOT + L0 解析 + L4 保留原文 + **反例守卫**：长原文逐行保留、未传 cause 不得出"根因"行）。★**诚实边界**：**BX1（Source Map 反向映射）未做**（本批错误来自宿主工具链；生成物→源码属 JS 管线下一批）；BX3/BX8/BX9 未做；命名需商标检索。★教训：**"吞掉详情"是最贵的错误体验缺陷**（把"可诊断"降级为"猜"）；**门禁也要对着用户环境**（#683 门禁 source 了 xcode-env ⇒ 门禁绿用户红 ⇒ 能力解析必须搬进产物）。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（三二八）· ★★iOS 宿主完善——运行期壳 + dev 热刷真机打通 + 零设备编译门禁 · 决策 #683**——用户「继续 cli 宿主主线」（承接 #662 Android 端到端，补 iOS 腿）。★**缺口（先取证）**：a) CLI 生成的 **iOS 壳是静态形态**（`mountPage(fromScreenContent:)`）——Android 壳早已升**运行期形态**（QuickJS+`SuperappRuntimeHost`+`bundle-superapp.js`）；b) **无 dev 通道**；c) **CLI 宿主 iOS 壳模板无任何本地编译判据**（`check:ios-selfdraw-compile` 只管框架参考宿主）。★**环境取证**：iPhone 12 在线 + Xcode 26.5（非默认位，`xcode-env.sh` 解析）⇒ 真机可验证。★**交付**：a) **壳升运行期形态**（`templates-host/ios/shell/ProteusApp.swift` 重写：JSC+`SuperappRuntimeHost`+bundle boot/render，与 Android/鸿蒙同形）；b) **dev 热刷通道**（`ProteusBuildConfig.swift` DEV/DEV_URL + URLSession 拉 bundle + `/version` 轮询 → **重建 JSContext 重载**，保留当前屏）；c) `packageIosHost` dev 变体（覆写 BuildConfig + **仅 dev** 注入 ATS + 拷 bundle + `outApp`）；`runAppDev` iOS 分支（`devicectl install/process launch`）。★**★真机（iPhone 12）**：`proteus dev --target ios` → 打包 37.6s → 安装 2.9s → 就绪 41.0s；`PROTEUS_DEV_BUNDLE_FROM_SERVER bytes=961159` → `PROTEUS_HOST_PAGE_RENDER ok=true`；改 .vue → `bundle v3 (276ms)` → **`PROTEUS_DEV_RELOADED version=3 page=index`**。★**★零设备编译门禁** `check:ios-cli-host-compile`（swiftc -typecheck 模板壳+runtime+platform）——**破坏性验证过**（注入类型错 rc=1）；本轮抓到一处闭包签名错（`onDispatchToJS` 五项，首版多写前导参数）。★**测试** app-host-cli **18/18**（+3：运行期形态 + **反例守卫**（不得退回 fromScreenContent）+ 变体常量/dev 通道齐备）。★**诚实边界**：**鸿蒙 dev 通道仍未接**（本批兑现 android+ios）；iOS dev 为**开发签名**；swiftc `-O` 编译 ≈37s。★教训：**"两端同形"要逐端取证**；**"无本地判据的产物"是重灾区**（CLI 壳模板既不在 hosts 门禁内、又只能真机打包才编译 ⇒ 立 swiftc 门禁）；**"看着不可用"先取证**（profile 的 ProvisionedDevices 与设备 UDID 不一致，但 devicectl 安装实际成功）。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（三二七）· ★★MCP 生产化——Streamable HTTP + 六端 conformance 开箱全通 + 真实版本 · 决策 #682**——用户「继续把 MCP 这条线做完整，能生产可用的」（承接 #681 stdio）。★**生产缺口（先取证）**：a) **六端 conformance 实际只有五端**（`run_conformance` 的 vue-dom 端需 `document`，纯 Node 无 ⇒ 如实报错）；b) `serverInfo.version` **写死 '0.1.0'**（≠ 包真实 0.3.0-beta.26）；c) 只有 stdio 一种传输。★**交付**：a) **Streamable HTTP 传输**（`packages/mcp/src/http.ts` `startHttpServer`）——**stateless per-request**（每请求独立 Server+Transport）：只读知识面天然并发安全、无会话运维面；代价=无服务端推送（GET/DELETE→405）；b) **documentLike 自动注入**（`document.ts` `resolveDocumentLike`，懒加载 **happy-dom**=**optionalDependency**）⇒ **六端开箱全 ok**（未装则 vue-dom 如实报错不静默假通过）；c) **真实版本**（`meta.ts` `resolveMcpVersion` 读本包 package.json）；d) CLI `proteus mcp serve --http [--port N] [--host H] [--token T] [--quiet]` + 参数校验 + **优雅关停**（SIGINT/SIGTERM）+ 结构化请求日志（stderr）。★**安全**：HTTP 缺省只绑 **127.0.0.1**；`--host 0.0.0.0` 对外须配 `--token`（Bearer，**常量时间**比较）；无/错 token→**401**；写闸与 stdio 同（缺省只读）。★**★Node 边界（实测）**：Streamable HTTP 依赖 ESM 全局 `crypto`——**Node 18 的 ESM 无**（20+ 才有）⇒ HTTP 需 Node ≥20（stdio 不受影响）；测试 `skipIf(!globalThis.crypto)`。★**验证**：vitest **mcp-http 12/12 + mcp-stdio 14/14 + mcp-server 16/16（Node22）**· 手动 e2e（HTTP 401/200 三态 + stdout 0 字节 + SIGTERM 关停）· 门禁全绿。★**门禁修正**：`check-deps.mjs` 漏 `optionalDependencies` ⇒ 装 happy-dom 被误报缺失，已修。★**诚实边界**：HTTP stateless（无会话）/需 Node≥20/无 TLS（应前置反代）/未做真实客户端人工冒烟。★教训：**"能生产可用"= 开箱即用 + 边界诚实**（六端要真六端 / 版本要真版本 / 对外要真安全 / 边界要真标注）。★新会话以此为准。

## ★《收纳规范》（2026-10-03 立 · 门禁 `pnpm check:memory`）

**为什么立这条**：本文件曾达 **11,118 行 / 2.4 MB**（每轮里程碑的详细叙事都内联插 H3），
「新会话先读顶部」的成本被历史内容淹没。⇒ 改为「**主文件 = 当前态薄入口；历史与长表全文在 `docs/project-memory-archive/`**」。

**主文件只放六类内容**（其余一律归档）：
1. 项目概览（要点，不放过程）
2. 当前状态速览——**只保留最近 3 条**；插入新条时，第 4 条起移入当月归档
3. 关键决策与文档偏差——**全文在 `decisions.md`**；主文件只留指针 + 锚点（决策号只增不改号）
4. 待办 / 注意事项（已完成项移归档）
5. 会话恢复指引（阅读顺序；指向归档而非内联历史）
6. 归档索引（归档文件清单 + 检索方式）

**新里程碑的写法**（替代旧习惯——详细叙事不再内联）：
1. **详细叙事**（交付 / 缺陷 / 验证 / 诚实边界）追加到 `docs/project-memory-archive/<YYYY-MM>.md`（当月文件；新月份新建）；
2. 主文件顶部加**一行**状态速览（`## 当前状态速览（…）`，含「下一步」）；
3. 需长期记住的教训 → 决策条目（号 +1）追加到 `decisions.md`，架构级同时在主文件「锚点」登记一行；
4. 跑 `pnpm check:memory` 自检（主文件上限 / 结构齐备 / 速览条数 / H3 泄漏）。

## 归档索引（历史在归档——**勿整读，按关键词 grep**）

| 文件 | 内容 |
|---|---|
| `docs/project-memory-archive/2026-10.md` | 2026-10 里程碑详细叙事 + 状态速览历史栈（约 4.5k 行）|
| `docs/project-memory-archive/2026-09.md` | 09 月全部叙事 + 柔性系统重组历史 + 2026-08 进度快照 + 已落地文件 + 09-19 验证状态（约 6.5k 行） |
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#679——按号检索（`grep -n "^679\." …`）|

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#679 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

**★本轮（2026-10-08）留存 —— 新会话接手必读**
- **★★★App DevTools 面板（#672–#675）**：`proteus dev` 的 dev server 根路径 = 浏览器 DevTools（**设备环境** chips / 设备在线 / Bundle 版本·体积·重建耗时 / 当前屏 / 重建时间线 / **Elements 节点树（含内核 rect，点节点看盒模型）** / **Events 手势 trace** / **Network** / **Console** / **渲染耗时+mount**）。端点 `/`(面板) `/events`(SSE) `/ping`(心跳+env+perf) `/tree` `/inspect` `/trace` `/log`。宿主模板采集设备信息 + 推树(切屏自动刷) + JS console 垫片 + trace；**仅 dev**。
- **★★待研判（已证实用户可见，未修）**：App **导航挂载失败**——点首页卡片 trace 显示 `handled=true fired=[7]`（**handler 确实跑了**）但**无新渲染**；Console 报 `[app-adapter] 泵失败：host-invoke: screen.mount: RustLayout.create 失败（屏 index#1）`（屏切换走 **app-adapter→ScreenHost.mount**，与 runtime 渲染是**两条通路**）⇒ **点卡片不切屏**（此前完全静默，DevTools 才让它现形）。❗下轮先取证：**Rust `proteus_layout_create` 对该屏树为何返 0**——Rust `eprintln!` **未进 logcat** ⇒ ① 先让内核建树失败原因可见（on_note/stderr 回传）② 再定位屏树/几何契约。**用户可见 ⇒ 优先于其他待办**。
- **★★发版已完成（#664 → 已发布）**：用户已发布到 npm——公网各包 `latest = **0.3.0-beta.23**`（含 #663/#664 的 CLI 三修 + `templates-host`/App 能力；已验证 `resolveAppRoutes`/新主题在发布物内）。git 版本 bump 已提交追平（`8e42d962`）。
- **★★★彻底打通（#666 打包 + #667 dev 热刷，Android 纯 npm 免框架 checkout）**：外部工程（`npm create`+`npm install`，**不碰框架源码**）现可完整 `build --package` + `dev` 热刷。**打包**：桥源 `templates-host/shared/bridge/entry-superapp.ts` + AAR `templates-host/prebuilt/android/proteus-runtime.aar`（`build-runtime-aar.sh` 同步）随 CLI 包发布，无框架回退 + esbuild 按 node_modules 解析。**dev**：`resolveWatchRoots` 按**布局/配置**解析监听根（模板 `src/` 与根形态都覆盖）。**门禁**：`check:bridge-sync`（桥源真源⇄随包副本逐字节一致；改真源后跑 `node scripts/sync-host-bridge.mjs`）。真机验证：出包 3.4MB + 改源码 **59ms** 重建 → 宿主 `PROTEUS_DEV_RELOADED`。**★剩余**：iOS/harmony runtime（26/33MB 静态库）仍需独立托管（`host-runtime-package-plan.md`，已证伪其"尚未发生"前提）。
- **★★★"新工程 → 手机"已验证（#664 本地包 + #665 补更）**：`create-proteus` 新工程 → `build --target android --package` → 3.4MB APK → 装机 `PROTEUS_APP_READY`。修 **4** 缺陷：D1 `routesOutput` 硬编码（→ `app-routes.ts` 唯一实现）、D2 三端文本默认白→黑（Web 基准）、D3 CLI 宿主主题 `Theme.Material.NoActionBar`（状态栏透明）、D4 **App 页根块级满宽**（#665 · `buildLayoutTemplate` 单根补 `widthRatio:1`，修 `text-align:center`+根 padding 渲染成顶左）。**★已生成宿主需删 `dist/app/<端>/host` 重建**才拿 D3。**剩余**：App 端 `<button>` 的**原生外形**（圆角/阴影/按下态）属独立 UX 批次（语义已渲染，随 D2 可见）。
- **★★★CLI 启动期「陈旧 dist」守卫（#663）**：`npx proteus` 走 `packages/cli/dist/index.js`，**改了 `packages/*/src` 忘 `build-packages` ⇒ 跑的是旧代码**（实测：`proteus dev --target android` 仍启动 web），而 `tsx src` 手测正常=假绿。现 `main()` 顶部 `warnIfDistStale(cmd)` 从 dist 运行时会对陈旧包打 stderr 告警（不阻断）。**修法**：`node scripts/build-packages.mjs`。
- **★★★完整宿主 + CLI 出包 + dev 热刷（#662，Android 已端到端）**：`proteus build --target android --package`（`--host-dir` 可省）→ `dist/app/android/{host/, bundle-superapp.js, proteus-host.apk}`（**项目包名** = `proteus.config` native 段，如 `cn.proteus.superapp`）；`proteus dev --target android` → 改源码秒级热刷（真机验过 `PROTEUS_DEV_RELOADED`）。**剩余**：**iOS/鸿蒙 dev 热刷宿主通道待接**（iOS `#if DEBUG`+ATS / 鸿蒙 `buildMode`+NetworkKit）——本批**只端到端兑现 Android**；壳定位已收口（`hosts/*` 仅框架测试，CLI 生成宿主=项目自有）。
- **iOS 签名切换器（#657，两台电脑 office/home 分档）**：办公室机（kagsdeimac）已上档 `lyl@shxuxi.cn`；★**设备端需"信任新证书"**（设置→通用→VPN与设备管理——iOS 强制步骤；若 App 启动被拦先点这个）；**回家用机首次** `bash hosts/ios/signing.sh use <家里账号>` 上档一次即可；自查 `bash hosts/ios/signing.sh status`。
- **★超应用 CSS 能力扩展（主线，进行中）**：计划 `docs/proteus-superapp-css-expansion-plan.md`（5 个新族 **F1 定位 / F2 filter / F3 排版 / F4 交互态与伪元素 / F5 滚动**；裁定 A→E 顺序）。**★批 A（定位族）已收官**：fixed / sticky（全三端）· z-index 数值→语义层映射（#658）· 验收页 E 案例 + 四端验证（Android/iOS/鸿蒙红片在最上+Web 基准+MP 产物级）+ `css:verify z-index` 三段判据全过。**剩余**：
  · **iOS/鸿蒙的滚动锚定像素证据待补**（批 A⑤ 欠账；装置问题：iOS superapp 空跑起的是 `bundle-superapp.js` 而非 css-conformance ⇒ `--screen=` 无处可去；鸿蒙 `superapp-screen-*` 无滚动参数）。fixed/sticky 的 iOS/鸿蒙**实现已编译验证**（swiftc/HAP），仅缺滚动像素。
  · **批 B–E（F2 filter/backdrop-filter · F3 排版增强 · F4 状态伪类与伪元素 · F5 滚动增强）全部待做**。
  · **z-index v1 边界（#658 具名）**：负值 / stacking context 完整语义 / relative·sticky·flex·grid item 的 z 不生效——后续如需扩展从此处接。
- **多端逐页视觉验收（长欠账）**：css-conformance **31 页** × 4 端逐页截图 + 独立子代理终评（现只覆盖代表页）。
- **鸿蒙签名现状（环境态，非代码）**：本机 `~/.ohos/config/*.p7b` 现绑定 `dev.proteus.cssconf`；`dev.proteus.host`（default 产品）暂无匹配签名 ⇒ 默认鸿蒙构建 SignHap 报 `00303074`。要装默认应用需在 DevEco 为 `dev.proteus.host` 再签一份。
- **官网域后续**：可继续通读其余指南页（13 布局 / 19 平台 API / 22 Skyline 等）是否仍含"双端"旧叙事。
- **（已完成，勿重做）** iOS `styleOf` 透传覆盖门禁已落地（`pnpm check:ios-style-keys`，决策 #650）——本会话抓出并修掉 `borderRadiusPct` / `animation` 两处静默降级。

**长期注意事项（仍在场）**
- ⚠ **CDP 视觉验收纪律**（2026-09-04 用户强反馈「你懂什么叫居中吗」）：官网改样式必须 CDP 截图 + **数值级核对**（居中/上下间距对称、偏差 <4px，禁目测）；布局壳禁用带默认布局语义的组件（`p-view` 默认 `flex-column` 会盖 `justify-content:center`——同源坑三次）。
- ⚠ **根 `vue-tsc` 零错误**须持续保持。
- **Skyline iOS 真机白屏**（微信平台已知问题，roadmap v0.5）：真机实测时记录复现路径（决策 #69）。

**历史已完工单（2026-08～09，全 ✅，勿重做）**：框架拆包 45 包 + npm 发布 · 组件库 P0 · i18n/devtools/types/security/app-plan B1 · 构建缓存 M8 · G-32 语义原语（capability 50/50、工程原语 28/28）等——详见 `docs/project-memory-archive/2026-09.md` 与 `decisions.md`（#1–#507）。

## 后续规划（更新于 2026-09-02，★以「当前状态速览」为准）

**主路线（G-32 完整语义落地，决策 #303-#311 链）**：
- **G-32 B3 续**：⑤ Capability **50/50 收官**（七/八期 12 能力：map(C4)/sms(C22)/background(C25)/socket-task(C28)/data-channel(C31)/cookie(C32)/face-id(C39)/in-app-purchase(C46)/mini-program(C47)/embedded(C48)/live(C49)/extension(C50)——web 真实 document.cookie·visibilitychange·WebSocket·WebAuthn + wx 原生 createMapContext·navigateToMiniProgram·startSoterAuthentication facial·onAppHide/Show·SocketTask·storage Cookie + 宿主桥 data-channel/embedded/live/extension 诚实降级，决策 #323）
- **G-32 B5**：⑥ 工程原语 28（**★★28/28 收官：首期 E1 useState/E2 useComputed/E3 useWatch/E6 useLifecycle/E7 useReady/E9 usePageParam（决策 #319）+ 续 E10-E17 路由语义化（决策 #320）+ 续二 E19-E23 动画（决策 #321）+ 续三 E24-E28 工程化（决策 #322）——`createEngineering`/`createRouterEngineering`/`createAnimationEngineering`/`createToolingEngineering` 注入式四工厂 + 组件形态 p-transition/p-animate（E19/E20 已 implemented）+ 纯声明工具 defineComponent/defineCapability**；B5 收官——唯一剩余 E18 router-link（声明式导航组件形态）待后续批次）；与 G-17 路由/G-34 HMR 协同
- **G-32 B6**：对照矩阵自动化（miniprogram-mapping 与 catalog 自动同步）+ codemod 完善（scroll-view/swiper AI 语义还原 + 路由名表）

**并行候选（按顺序）**：
- **G-29 B2**：RustBackend（SWC 生态 → 同一 CompilerIR——conformance IR Golden Test 已就绪，接入即可验证）
- **G-27 B6**：混合渲染（Texture Sharing 抽象 + 页面级切后端 + DevTools 可视化）
- **G-31 收尾**：B7 续（useFetch/useStorage 已收口——剩 router 语义化对齐）

**★已整合（决策 #312-#314）**：`docs/proteus-website-v3-plus/` 与 `docs/proteus-website-v3-final/`（未跟踪）的新内容 G-33/G-34 已抽离入库为 **`docs/proteus-ai-agent-plan/`（G-36 AI Agent）** 与 **`docs/proteus-render-backend-spi-plan/`（G-37 RenderBackend SPI）**（编号避让：G-33=CLI、G-34=HMR 已实现占用）；**另发现同批 zip `proteus-compiler-backend-spi.zip`（pack.sh 产物）内含第三个新 plan——CompilerBackend SPI 原稿 G-35（与 app-config 冲突）→ 一并整合为 **`docs/proteus-compiler-backend-spi-plan/`（G-38，含 verify.sh/pack.sh/MANIFEST/conformance-runner.js 自检工具链）**；原稿引用 G-34（RenderBackend SPI）→ G-37、原则 #11（可插拔可验证）→ #13（含 #13.5-7 编译器专项子原则）同步重指向**；MCP Server（AI B1）、SPI 套件（G-37 B2）、编译器 SPI（G-38 B1）、宿主运行时 SPI（G-39 B1）可与既有 `@proteus-vue/render-backend`·`@proteus-vue/compiler-backend`·`@proteus-vue/renderer-app` 实现互为印证。**另发现第四 plan `proteus-host-runtime-plan`（未跟踪，原稿 G-36 与 AI Agent 冲突 + 兄弟引用旧编号）→ 按 #312 同法整合为 **`docs/proteus-host-runtime-plan/`（G-39，编号避让 G-36→G-39 / G-34→G-37 / G-35→G-38 / 原则 #11→#13，决策 #314）**。

**遗留已知限制**（★2026-09-19 复核）：~~tabBar 100vh 遮挡~~ **已实测关闭**（Skyline 的 100vh **按页面类型解析**——tabBar 页得 `windowHeight`=762（底边恰在 tabBar 顶边）、非 tabBar 页得 `screenHeight`=844 满屏 ⇒ 不存在遮挡；已加几何回归锁）。**仍存**：半屏页 / 长列表 list-view 摊平 / 下拉刷新 Web 端未桥接；其余 roadmap 大项（v0.5 多端 / v0.6 App+Vapor / v1.0 生产可用）见 docs/roadmap.md。

## 会话恢复指引（新 LLM 按此顺序阅读）

0. **★★★先挂载效率规范 Skill（每会话强制）**：执行 `Skill(ai-efficiency-rules)`
   （文件 `.agents/skills/ai-efficiency-rules/SKILL.md`），再开始任何工具调用——
   约束固定 `sleep` 盲等 / 重复拉取远程资源 / 重复读文件 / 无归因重试 / 该并行却串行 / 输出爆炸。
   同规则见根目录 `AGENTS.md` §0。
1. `PROJECT_MEMORY.md`（本文件）—— **★先读顶部「当前状态速览」**（只保留最近 3 条）：架构方向 / 最近里程碑 / 当前数量 / 路线图位置 / 待决项；**详细历史与决策链全文在 `docs/project-memory-archive/`（按月归档 + decisions.md，勿整读、按号/关键词 grep）**。
2. `docs/proteus-architecture.md` —— **L0 规约（真理来源）**：原则 #0-#12 + 铁律 + 十系规则总表（G-31.1-4/CMP005-8/RND001-005 等）
3. `docs/board-inventory.md` —— **架构规划全景（v2）**：六层 plan 分层索引 + 双路线对照 + 资产对照（改新增 plan/包后同步此表）
4. `docs/proteus-positioning-v3.md` —— 对外门面（slogan One semantic model. Any render engine.）
5. `docs/roadmap.md` + `docs/roadmap-2-plan/` —— 版本线 + 里程碑线（M1 双 SPI 原型 → M2 能力 → M3 生态）
6. `LLM_IMPLEMENTATION_GUIDE.md` —— §0 痛点对照 + 阶段任务指令
7. `packages/compiler/src/transforms/registry.ts` + `README.md` —— 编译规则注册表（AI 说明书，改动编译器前先查）
8. `proteus.config.ts` —— 当前配置；`examples/pages/` 是 Playground 演示

**关键包地图（决策 #314 后）**：`@proteus-vue/render-backend`（G-27 五后端 + conformance）· `@proteus-vue/component-ir`（G-31 C-IR + G-32 128 原语 SSOT + audit）· `@proteus-vue/compiler-backend`（G-29 编译器 SPI + NodeBackend）· `packages/compiler-backend-rust`（G-29 B2 RustBackend cargo crate——同一 CompilerIR）· `@proteus-vue/gesture`（G-32 ④）· `@proteus-vue/api/capability.ts`（G-32 ⑤ useXxx 50/50——传感器/WebAuthn/useAuth/近场媒体/收官 12 能力）· `@proteus-vue/api/router-engineering.ts`（G-32 B5 续 E10-E17 路由语义化）· `@proteus-vue/api/animation-engineering.ts`（G-32 B5 续二 E21-E23 动画 Hook）+ `src/components/p-transition`·`p-animate`（E19/E20 组件形态，IR engineering.transition/animate implemented）· `@proteus-vue/api/tooling-engineering.ts`（G-32 B5 续三 E24-E28 工程化 Hook + define 工具）· `@proteus-vue/api/request-engineering.ts`（请求数据层 R1-R4：策略请求/useQuery SWR/enqueue/去重）· `@proteus-vue/compat-miniprogram`（G-31 B6 迁移）· `@proteus-vue/desktop`（G-24 B1 桌面交互原语——v-p-hover/-shortcut/-focus-trap/-context-menu）· `src/components/p-*`（57 组件聚合导出）；规划 SPI（同批四 plan：G-36 AI Agent / G-37 RenderBackend SPI / G-38 CompilerBackend SPI / G-39 Host Runtime SPI，均有规约 + conformance 套件 + 参考实现，与既有包互为印证）

