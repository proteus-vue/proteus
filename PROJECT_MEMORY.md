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

## 当前状态速览（最近一次更新：**2026-10-09·（三六一）· ★★★切屏掉帧诊断——「原生渲染阶段」进窗口详情（JS profile 覆盖不到的大头）· 决策 #718**——用户「每次切屏都掉帧，是不是 dev server 接入的影响？」+「空闲正常、只有切屏掉帧」（截图：切屏窗口 `renderMs 64.57`/`dropped 3`，但**窗口详情里 JS CPU 阶段只有 flush 2ms+instantiate 1ms+relink 0.3ms≈3ms**，且那条 `/ping` 原文**确实带 profile**）。★**诊断（分层取证）**：① **dev 不是主因**——量 superapp 四屏"整树 JSON 序列化"（dev 每次渲染/tick 要做）：63 节点 **0.033ms**、97 节点 **0.053ms** ⇒ 对 16.7ms 预算**不到 1%**；② **真因 = 切屏全量 mount**（`runtime.mountScreen`→`host.mount` 全量重建：Rust 布局 + CALayer 建层）——**release 也有**，与 dev 无关；③ **决定性证据**：同窗口 **JS 3ms vs renderMs 64ms** ⇒ 62ms 在 **JS profile 覆盖不到处**（原生内核）。★**交付**：① **原生渲染阶段进窗口详情**——iOS 壳把桥 `lastTiming`（measure/layout/build_layers/total）、Android 壳把内核回执 `lastLayoutMs/lastMeasureMs` 编成 **`perf.render`（端无关 `[{label,ms}]`）**；面板窗口详情新增**「原生渲染阶段」段**（橙条 + 注"切屏掉帧的大头通常在这里"）⇒ 一眼看到 64ms 花在 layout+build_layers；② **删死代码** iOS `lastTreeJson`（只写不读、占渲染热路径）；③ **★排空式防陈旧读数**：`lastTiming` 会残留 ⇒ 每 tick 都发会让空闲窗口反复报 65ms（**#710「恒定读数」第三次**）⇒ iOS `consumeRenderTiming()`（写即置脏、脏才取并清）、Android `devRenderJson`+`takePerfJsonForPing()`（取用即清）⇒ **只真有渲染的窗口才带 render**。★**验证**：真 dev server+Playwright：切屏窗口 ⇒ 面板出现「原生渲染阶段（本窗口·内核回执）」`measure 8.2/layout 22.4/build_layers 31.1/total 64.5ms`(橙)+JS 段(蓝)+零 pageerror；单测 `app-host-cli` **33/33**（+#718 静态锁）；三端编译门禁绿。★**诚实边界**：**未真机复测**；Android 分段是上一次 mount/applyOps 的；`render` 只覆盖内核侧（宿主 onDraw/CALayer commit 不在内）；**切屏 64ms 本身没优化**（只讲清"它在哪"）。★教训：**"是不是 X 导致的"要分层取证**（先量 X 自身成本排除，再看真凶）；**"某指标存在"≠"它解释现象"**（JS 3ms 答不了"64ms 哪来" ⇒ 要在缺口处补数据）；**残留读数必须排空式上报**；**热路径死代码要删**；**"调试是否影响性能"用同窗口其它阶段量级差判**。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-09·（三六〇）· ★★★CPU ⇄ 掉帧事件链联动（点 CPU 高峰 ⇒ 该窗口的 CPU 明细 + 事件链 + 哪个 handler 撑起来的）· 决策 #717**——用户「继续把 CPU 阶段排行和 #714 的掉帧事件链联动」。★**关键洞察（数据本就够）**：`profSamples` 里**每个样本都自带那一窗口的 `perf.profile`**（#716 修好后每 tick 都发）⇒「哪一帧的 CPU 明细」早已躺在样本里，只是此前面板只把**最新一条**灌进 CPU 面板、没留"样本↔窗口"关联。★**交付（两个单向面板接成双向）**：① **统一窗口详情**——#714 的 `showJankDetail` **并入** `showWindowDetail(i,focus?)`：上半=**本窗口 CPU 阶段明细**（含 `.vue:行:列` + 聚焦行高亮）、下半=**事件链**；② **CPU→窗口**：排行每行**可点** ⇒ `latestSampleWithStage(label)` 反查"含该阶段的最新样本" ⇒ `showWindowDetail(idx,label)` 聚焦该 handler；③ **掉帧→窗口**：掉帧柱开**同一**详情（无聚焦）⇒"点 CPU 高峰"与"点掉帧柱"是**同一窗口的两种视角**；④ 样式 `.craw.clink`/`.craw.cfocus`/`.cdot`。★**验证**：**真 dev server + Playwright**（两窗口，都带 profile）：点 CPU 第 2 行 ⇒ 头 `运行期 CPU 阶段（本窗口）· 已聚焦 handler「h0」`、聚焦行 `handler「h0」index.vue:14:9`、CPU 行 3；关掉点掉帧柱 ⇒ 同一框、CPU 行 3、零 pageerror；单测 `app-host-cli` **32/32**（+#717 静态锁 + 更新 #714 断言）。★**诚实边界**：联动是"**同一窗口**相关视图"（CPU 排行=窗口累计、事件链=前 1.6s）⇒**不构成因果**；CPU 行定位到"该阶段**出现**的最新样本"非"最贵那一次"（后者按 `maxMs` 找，属后续）；跨窗口同名 handler 会合并。★教训：**"联动"先查"数据够不够"**（本例数据早就够，缺的只是留关联 ⇒ 别急着加采集）；**两个单向归因面板可合成一个双向窗口视图**；**命名跟语义走**（showJankDetail→showWindowDetail）+ **重命名同步改既有断言**。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-09·（三五九）· ★★★CPU Profiler 恒空根因（esbuild `define` 只替换*裸标识符*）+ Android 采样改走 UI 泵 · 决策 #716**——用户「测试了下**一直没有返回心跳数据**」（截图：Profiler 62 样本正常，CPU 区块恒「等待设备心跳…」）。★**取证（截图即证据）**：掉帧详情里 `/ping` 的 **perf 原文** `{"dropped":4,"fps":55.4,…,"renderMs":65.38}`——**没有 `profile` 字段** ⇒ 不是面板问题，是**设备发的 perf 就没带 profile**。★**根因（一行）**：桥写成 `(globalThis as …{__DEV__?}).__DEV__ ? …`——而 **esbuild 的 `define` 只替换*裸标识符* `__DEV__`**，`globalThis.__DEV__`（**属性访问**）**替换不到** ⇒ 运行时 `undefined` ⇒ `profile:true` **永不生效**（prof 恒空、**零报错**）。实证：`--define:__DEV__=true` 后产物里 `globalThis.__DEV__` 原样残留。★**修**：桥改**裸 `__DEV__`**（+ `declare const __DEV__: boolean`），核实全部打 `entry-superapp` 的 bundler（app-bundle / build-batch(鸿蒙亦经它) / build-app-stack）**都已 define**；真构建验证 dev `...true ? { profile:true }`（开）/ release **折叠掉**。★**顺带修 Android 响应性**：此前只在 `recordPerf`（post-render）排空 ⇒ 点击/切屏采不到 ⇒ 改 **UI 泵每 400ms 排空**并入心跳（与 iOS 每 tick 同语义）。★**验证**：`app-host-cli` **31/31**——新增两条回归锁：(i) 桥源码须用裸 `__DEV__`、不得出现 `globalThis as … { __DEV__`；(ii) **真 dev server `/bundle`** 必须含 `profile: true`（测真产物——门关着则红）；真构建 dev 开/release 折叠；Android 编译门禁绿。★**诚实边界**：仍**未真机复测**（以"真 dev bundle 产物断言 + 静态锁 + 编译门禁"为准）；`profile` 是"门开了"的证据，真机 CPU 排行读数待真机确认。★教训：**esbuild `define`/C `-D` 只替换裸标识符**（`globalThis.X`/`window.X` 替换不到——本仓第一次裸用 `__DEV__` 正因此踩中）；**"恒空"先看"数据源发出来没有"**（截图 perf 原文缺字段直接锁定，别在消费端找）；**dev 开关这类"门"必须用真构建产物断言**；**两端采样排空点要一致**；**注释含"坏写法"字样时静态锁要用精确正则**。★新会话以此为准。

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
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#718——按号检索（`grep -n "^718\." …`）|

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#718 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

**★本轮（2026-10-08）留存 —— 新会话接手必读**
- **★★★App DevTools 面板（#672–#675）**：`proteus dev` 的 dev server 根路径 = 浏览器 DevTools（**设备环境** chips / 设备在线 / Bundle 版本·体积·重建耗时 / 当前屏 / 重建时间线 / **Elements 节点树（含内核 rect，点节点看盒模型）** / **Events 手势 trace** / **Network** / **Console** / **渲染耗时+mount**）。端点 `/`(面板) `/events`(SSE) `/ping`(心跳+env+perf) `/tree` `/inspect` `/trace` `/log`。宿主模板采集设备信息 + 推树(切屏自动刷) + JS console 垫片 + trace；**仅 dev**。
- **★★修（#694a · 2026-10-09 已修）**：App **导航挂载失败（点卡片不切屏）**——根因 = **env token 未解析**（编译产物 `"minHeight":"env:--pf-vh"` 字符串直进内核 ⇒ serde `expected f32` ⇒ `proteus_layout_create` 返 0）；Android 已由 #677 修、**iOS 漏了** ⇒ #694a 在 iOS `ScreenHost.mount` 补同一解析（`SelfDrawBridge.current` 单一实现）。★**仍欠**：**破坏性验证**（剥掉解析调用 ⇒ 应复现 create 返 0）未跑完——`packageIosHost` 会 `syncRuntimeUnits` 覆盖生成宿主，须剥**框架源码**重打包（那次被用户叫停）。★下次**别耗真机全流程**，用 **Node 层兜底**：直接对 `screen.mount` 载荷断言「无 `env:` 字符串残留」。**用户可见 ⇒ 优先**。
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

