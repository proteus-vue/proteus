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

## 当前状态速览（最近一次更新：**2026-10-08·（二九五）· ★★★内置 CSS 环境变量 · Stage 2 余项「群 E 设备标量 `--pf-hairline`」（一条物理像素的逻辑长度）· 决策 #649**——用户「想起来了上次的内置CSS变量好像没做完吧？只做到了 vw-vh 这个」。★**现状**：契约 `packages/contracts/src/env-vars.ts` 已有 A/B/C 组（几何 · #593）+ D 组（视口 `--pf-vw/--pf-vh` · #595）；#595 明列未做项 = `--pf-dpr`/`--pf-orientation` + 标量/主题非长度通道。**本轮落其中唯一**CSS 可消费的长度**项**：`--pf-hairline`（= 1/设备像素比，细线分割线刚需；`--pf-dpr` 是纯数、其余是非长度通道，都作不了 `ResolvedLength`）。★**交付（四同步）**：契约加 `--pf-hairline`（**群 E**）+ `group:'E'` + `check-env-vars` 白名单 A/B/C/D→**A/B/C/D/E**；**编译器两路径**——App 折叠面（边框简写/1–4 值/绘制侧长度接受 env）+ **CSE 真缺口修复**（`shorthand.ts` 的 border 宽度正则不认 `var()` ⇒ 落颜色槽丢宽度；`compute.ts` 的 `border-*-width` 映射只认 number ⇒ env 丢为 null——补后两路径同口径）；**四端采集**（Android `1/density` · iOS `1/UIScreen.main.scale` · 鸿蒙 `1/vp2px(1)` · **Web 新模块** `web/src/env-vars.ts` 的 `installEnvVars()` 按 `devicePixelRatio` 注入 `:root`（CSS 无法派生）+ `style.css` 兜底 · MP `readEnvVars()` 补 `1/pixelRatio`）；验收页 `safe-area.vue` 加 D 案例（细线 + 1px 参考线并排）。★**判据**：`check:env-vars` 绿（17 项 · 四同步）+ 单测（cse-core/vapor-class-styles）+ **四端真机采图**（Android/iOS/鸿蒙/Web 基准+MP）+ **像素级实测**（三端 App 细线=1 物理 px、参考=3 物理 px）+ **独立子代理逐端评审**（Android/iOS/鸿蒙 pass；**MP 首轮 fail**（细线反比参考粗）⇒ 加 CSS 兜底 `var(--pf-hairline,1px)` 后复评 **pass**）+ `probe` 四端 safe-area PASS + 全量 `pnpm test` **5375/5375** + 一批定向门禁全绿。★**诚实边界**：Web 纯 CSS 无法从设备像素比派生 hairline（须 JS 注入）· Chromium 把亚像素盒边吸附 1 CSS px（引擎锁定）· MP/Skyline 不应用内联自定义属性 ⇒ hairline 惰性（无兜底则 border-width 落初始 medium=3px、**视觉倒置**；加兜底后与参考同宽，**MP 无法表达亚像素细线**=具名边界）· `--pf-dpr`/`--pf-orientation`+主题/无障碍**非长度通道**仍未做。★**顺修 3 项存量/装置缺陷**：① 采集装置 `scrollIntoViewIfNeeded` 对无限动画元素永不 "stable" ⇒ `animation.vue` 超时中断整轮（**Web 基准长期只有 19/30 页**的真因）⇒ 改原生 `scrollIntoView`；② `examples/cse-lint-baseline.json` 陈旧 `E-CSS-004`（先证伪"本轮引入"）⇒ 刷新（lint 119→118，同步白皮书 §6 + website 引擎数据）；③ `web-adapter-link-guard.test.ts` 的 `afterEach` 隐式返回 `VitestUtils` ⇒ `vue-tsc` 报错（#647 遗留）⇒ 改块体。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二九四）· ★★★修 CSE 网格轨道：App 三端 `grid-row/column: span N` 静默丢失（案例 D 卡位错）· 决策 #648**——用户「回到 CSE 主线，看网格轨道页面，App 三端的案例 D 都不对，问题都是一样的卡片 y 位置不对」。★**根因（先坐实，非猜测）**：`css-conformance/pages/grid-tracks.vue` 案例 D = 容器 `grid-auto-rows:40px; 1fr 1fr` + 子项 A `grid-row: span 2; height:88px`。**App 端产物实测**（`dist/app/android/screen-content.json`）：D 容器有 `gridTemplateColumns/gridAutoRows`，但**子项没有任何 `gridRow`/`gridColumn`**——span 被整条丢弃。**折叠面**（`packages/compiler/src/vapor/template.ts` 的 `parseGridLine()`）**只认纯数字线号**（`1` / `1 / 3`）；`span`/`auto`/命名线一律 null ⇒ 诊断跳过（**不落字段**）。Web/MP 不走这条 App 折叠链（浏览器/Skyline 原生支持 span）⇒ **只有 App 三端错**；三端同一 Rust 内核 + 同一 IR ⇒ 现象完全一致。★**修（IR 加 span 维度）**：`GridLine{start?,end?,span?}`（折叠面 `span <n>` / `1 / span 2` / `span 2 / 3` ⇒ `{span:n}` / `{start:s,span:n}` / `{end:e,span:n}`）；内核 `style.rs` 结构体 + `ffi.rs` DTO `span` + `taffy_engine.rs` `grid_line_of`（span ⇒ `GridPlacement::Span`）。★**验证（PLAYBOOK 内核级流程）**：cargo test **211+ 全绿**（含新 `grid_span_spans_tracks` 断言 A 跨 2 行高 100 / B,C 右列 y=0,50）+ `test:coupled` 386 全绿 + 定向 vitest（vapor-class-styles 121）+ **三端真机重截**（Android 真机 `d67e31a3` / iOS 真机 iPhone12 / 鸿蒙真机 `69F9K261…`）——**均显示案例 D 正确**（蓝卡跨 2 行、x/y 右列两行，与 Web 基准一致）；**全量 `pnpm test` 5373/5373 全绿**；门禁 host-kernel-keys/style-ir-schema/script-compile/no-blind-wait/safe-edit/gates-sync/deps 全绿。★**教训**：① **"引擎能表达"≠"我们的折叠面放了行"**——taffy 的 `GridPlacement::Span` 一直支持，是**折叠面把它挡在门外**（只认数字线号）；凡"CSS 值有语义类（如 span/auto/命名）"的项，折叠面必须按语义**逐类**处理，别只做"数字"这一类；② **Web 对 ≠ App 对**（Web/Skyline 透传原生关键字，App 走自研折叠链——同源纪律：多端一致性问题先问"这条链每端各自怎么走"）；③ 三端同内核 ⇒ 一处修对三端同好（`gridRow:{span:2}` 三端 screen-content 逐字一致）。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二九三）· ★★★修两个官网实测缺陷：文档锚点撞挂载根 id（`app`）+ 站内链接被 Web 适配器劫持 · 决策 #647**——用户「这个空白问题还是存在……是因为关键词 app，这个 #app 全局设置了最小高度 100vh」+「点页内超链路由刷新了但视图没刷新，手动刷新才对」。★**缺陷①（用户已定位，我坐实）**：`website/index.html` 的挂载根 `<div id="app">` + `#app{min-height:100vh}`，与生成页的字段标题（`### app` → `H3#app`）**id 撞车**——壳规则把那个标题撑成整屏（用户看到的「大片空白」），页内 `#app` 锚点也跳到挂载根。**修**：挂载根改命名空间 id `proteus-app`（main.ts mount + style.css 同步）——**挂载根是内部实现、文档锚点是公开契约（可分享/可外链），撞车时让壳让位**。★**缺陷②（真缺陷）**：`@proteus-vue/shared` 的 **web-adapter 在构造时（模块加载副作用）就挂 `document` 级 `<a>` 点击拦截器**（preventDefault + pushState + 自己 emit）——而该单例被 components/api/desktop 等**间接 import** ⇒ 即使用 **vue-router** 的宿主（官网自身）也被装拦截器 ⇒ 站内 `<a>` 被它**绕过 vue-router** 抢走 ⇒ **URL 变、视图不动**（无报错；浏览器实测 pushState 栈证实）。**修**：加**守卫**——只有「确实有 Proteus 路由在驱动本页」（已注册 `onPageLoad` 监听；createRouter web 端会注册）时才拦截；**无监听者 ⇒ 不抢**，交还宿主路由。★**验证（浏览器实测 · playwright 驱动的 IAB）**：本地构建站点上复现了两症状（点子链 → URL 变 URL/"配置参考"→"路由" 视图不变；`#app` 撞车撑高），修后**逐条复验**（视图随链接更新；`#app` 只剩 1 个=字段标题 28px、挂载根=`#proteus-app`、锚点滚动正确）+ 截图核对。★**新增两条门禁**：`tests/website-anchor-collision.test.ts`（站点壳元素 id 必须命名空间化；无任何文档标题锚点 id 与壳 id 相同——**破坏性验证过**：把壳改回 `id=app` 当场红）+ `tests/web-adapter-link-guard.test.ts`（无监听者不拦 / 有监听者拦）。★**验证汇总**：**全量 `pnpm test` 5372/5372 全绿** + website 十门禁（config-ref/en-drift/doc-links/alltarget/docs/stats…）+ 根 check:script-compile/safe-edit/deps/gates-sync + `build:website`。★**教训**：① **id 是全局命名空间**——站点壳的裸词 id（`app`）会与文档标题锚点撞车（壳样式误伤 + 锚点跳错）；壳 id 应命名空间化，锚点是公开契约；② **模块加载副作用会污染宿主**——共享包的顶层 `document.addEventListener` 对「不驱动本页的宿主」就是劫持；应**惰性 + 守卫**（有消费者才拦截）；③ **浏览器实测不可替代**（两处都是"本地直开正常、交互才暴露"——不看渲染只看代码会漏）。★新会话以此为准。

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
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#637——按号检索（`grep -n "^637\." …`）|

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#637 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

**★本轮（2026-10-08）留存 —— 新会话接手必读**
- **鸿蒙签名现状（环境态，非代码）**：本机 `~/.ohos/config/*.p7b` 现绑定 `dev.proteus.cssconf`；故 `dev.proteus.host`（default 产品）暂无匹配签名 ⇒ 默认鸿蒙构建在 SignHap 报 `00303074`（脚本已给定向提示）。要恢复默认应用可装机，需在 DevEco 为 `dev.proteus.host` 再签一份。
- **Android 真机安装被阻（环境态）**：本机 Xiaomi（MIUI/Android 17）`adb install` 返回 `INSTALL_FAILED_USER_RESTRICTED`（“USB 安装”守卫，需设备端手动开）。APK 本身经 `aapt2 dump badging` 验证正确。
- **★iOS `styleOf` 透传覆盖门禁（欠账，跨 6+ 次复发）**：`hosts/ios/.../selfdraw-scene.swift` 的 `styleOf` 白名单漏字段是本仓最高频静默降级（clipPath/glow/mask/borderRadiusCorners/justifySelf/gridColumn/letterSpacing/textDecoration/transform/transformOrigin/opacity/visibility…）。需补「iOS styleOf 透传字段 vs 宿主实际消费字段」门禁（`check:host-kernel-keys` 明说不覆盖 iOS）。
- **多端逐页视觉验收（长欠账）**：css-conformance 30 页 × 4 端逐页截图 + 独立子代理终评（现只覆盖代表页）。
- **官网域后续**：本轮已建链接门禁 + 内容对齐多端能力 + 修起步/框架页；可继续通读其余指南页（13 布局 / 19 平台 API / 22 Skyline 等）是否仍含“双端”旧叙事。

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

