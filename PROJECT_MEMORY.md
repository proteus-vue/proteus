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

## 当前状态速览（最近一次更新：**2026-10-08·（二八七）· ★★★配置模型 v4 重构（按端分区）+ 官网配置文档对齐 · 决策 #641**——用户「① proteus.config 和 app.config 有些是小程序时代的设计，不符合承载超级应用的定位（platform 二选一、很多一级字段是小程序 skyline 的）② 这个文档细粒度不够，很多字段没单独说明、也没做锚点导航」。★**取证**：`platform: 'mp-weixin'|'web'` 只在 `vite-config.ts` 做一次 fallback，目标端真源本就是 CLI `--target`（`BUILD_TARGETS=web/skyline/ios/android/harmony/all`）；顶层 `skyline/appid/skylineLayout/profileBoundary/setDataBridge/style.px2rpx/page/globalStyle/rules` 全是小程序/Skyline 专属字段。★**v4 形状（按端分区）**：`targets.{web,mp,ios,android,harmony}` 一级键，**各端自持配置**（含原生工程身份——原 `native.*` 并入 `targets.{ios,android,harmony}`）；跨端共享面留顶层（`pagesDir` / `router` / `budget` / `vite` / `audit` / `gates` / `compiler` / `layout` / `app` 共享身份）；`platform` 字段**删除**；`skyline:boolean` → `targets.mp.renderer`。★**实现**：`config.ts` 重写 + 新 `MpTargetConfig`/`IosTargetConfig`/`AndroidTargetConfig`/`HarmonyTargetConfig`/`WebTargetConfig`；新 `config-resolve.ts`（`resolveProteusConfig` = **消费方唯一入口**：版本链迁移 + 形状归一[`config-v4-shape.ts`] + 默认值）；`migration.ts` v3→v4 + `CONFIG_VERSION=4`；`config-layers`/`config-validate`/`config-schema` 三处 lockstep 重排；`migrate-types` codemod 注入 `version:4`。★**消费方改造（约 15 处）**：plugin-vite（plugin/gen-routes/vite-config 改读 `targets.mp`+`renderer`）；cli（build/dev/health/app-content/app-runtime-content/converts native-config[读 `targets.<端>`+`app`]/strict-cli[CLI002 由 targets 判定]/check[先归一再校验]）。★**六个具体 config 迁移**：examples/showcase/css-conformance（含 native→targets）/website/superapp/create-proteus 模板。★**验证**：`config:check` 五 config 全过 + v3 旧配置**自动迁移通过** + 向后兼容（未知字段仍报 CONFIG_UNKNOWN_FIELD）；**真机构建链**（examples build:mp 产 app.json `rendererOptions.skyline.defaultDisplayBlock` 42 页 2 分包 + check:mp-artifacts 绿；build:web 绿）；根 vue-tsc 零错误；config 相关 **149 例单测全绿**（config-layers/config-validate/generate-types/migrate-types/define-proteus/types-b6/vite-config/gen-routes/router-config/contract-build/strict-cli/component-b2..b6/mp-transform-exclude/health/config-loader/gate/audit-all/check-cli/router-project-driven/router-rules/native-config）；`generate types --check` 无漂移；website 十门禁 + `build:website` 绿；根 check:deps/script-compile/docs/gates-sync/no-blind-wait/safe-edit/internal-versions/pkg 全绿。★**已知存量红（非本轮）**：全量 `pnpm test` 有 4 处 pre-existing 失败（HEAD 即红，与本轮无关）——golden 快照缺 `$nav` 助手 / `registry-drift` 缺 `page/nav-global` 登记 / `fluid-formformfactor-render` CssEngine emoji / `hmr-dev-server` 时序超时。★**教训**：① 配置字段有**四个登记点**（`ProteusConfig` / `CONFIG_FIELD_LAYERS` / `KNOWN_FIELDS` / Schema）——只改其一 = 半接线；② **归一器不得吞掉未知字段**（否则 config:check 看不到拼写错误——本轮实测被抓）；③ 形状归一必须**幂等**（对已 v4 配置跑一次也不破坏）；④ 旧配置**自动迁移可用**（不破人），新形态是唯一 canonical。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二八六）· ★★★官网配置文档重构（编译器配置 / 运行时配置）+ 收口三个「孤儿配置字段」· 决策 #640**——用户「官网文档没有同步框架配置新内容，而且全局配置和页面配置以及里面的内容都不太符合实际情况，现在是编译器配置和运行时配置」）。★**取证（先读 SSOT 再动）**：官网 `guides/10-config`（旧「全局配置与页面配置」）与 `guides/11-app-config`（旧「应用配置」）**未跟上** ① #635 新增的 `native` 段（零覆盖）② 实际配置模型 = `proteus.config`（**编译器配置**·构建期，Compiler/CLI 消费）vs `app.config`（**运行时配置**·运行时，业务 `useAppConfig` 消费）。★**顺带挖出真缺陷（孤儿字段）**：`skylineLayout` / `profileBoundary` / `layout` 三项在 `ProteusConfig` **已声明且有真实消费方**（gen-routes / profile-boundary-plugin / plugin.ts），却**漏登** `CONFIG_FIELD_LAYERS` + CLI `KNOWN_FIELDS` + JSON Schema ⇒ 项目里写了会被判 `CONFIG_UNKNOWN_FIELD`（**阻断**）+ `CONFIG_LAYER_VIOLATION`（漏标）——铁律 #5「新增字段必须补录」的存量欠账。★**修（三处同步补录·铁律 #5）**：`packages/types/src/config-layers.ts`（三字段归 compiler）/ `packages/cli/src/config-validate.ts`（KNOWN_FIELDS + 轻量类型校验）/ `packages/types/src/config-schema.ts`（+3 property）。★**文档重构（zh+en 各 2 页）**：`10-config` → 标题「**编译器配置与页面配置**」，开篇改为「按消费时机划分两个正交配置面」+ 补 `native`/`globalStyle`/`page.webviewPages`/`skylineLayout`/`profileBoundary`/`layout` 子表；`11-app-config` → 标题「**运行时配置 app.config**」+ 补 `safeArea.statusBar`；同步 6 处交叉引用（05/08/09/29 + app-config-runtime，zh+en）。★**验证**：website 十门禁（doc-links/en-drift/reference/content/stats/primitives/doc-components…）全绿 + 根 vue-tsc / check:instr-spec / docs / script-compile / no-blind-wait / safe-edit / gates-sync / stats / alltarget 全绿 + `generate types --check`（schema 无漂移）+ config/coupled 单测 45 例全绿 + **破坏性验证**（`layout`/`profileBoundary` 现可由 config-validate 接受，非法 level 仍被拦）+ `pnpm build:website` 成功（新文案进 dist）。★**教训**：① **配置字段有四个登记点**（`ProteusConfig` / `CONFIG_FIELD_LAYERS` / `KNOWN_FIELDS` / Schema）——只改其一 = 半接线，`layout/profileBoundary/skylineLayout` 即此形态（声明了却用不了）；② **文档是字段白名单的镜子**：文档列了、校验器不认，「照文档写」的用户当场被阻断（**文档↔校验器必须同源**）；③ 官网配置页组织应跟**消费时机**（编译器配置 vs 运行时配置）走，而非旧的「全局/页面」直觉。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二八五）· ★★★修复「官网连续多轮静默未部署」根因——lockfile ↔ workspace package.json 失同步 + 立 `check:lockfile-sync` 门禁 · 决策 #639**——用户「继续」（在 #638 收尾推送时查出）。★**现象（先取证）**：`[deploy]` 推了几轮官网仍不更新；查 Pages run 列表——**真部署的 run 全部 conclusion=failure**，而「无标记被跳过」的 run 反而显示 success（**假绿**）。★**根因（两级）**：① pages.yml/CI 的「安装」步用 `pnpm install --frozen-lockfile`，而 `pnpm-lock.yaml` 与 `packages/render-backend/package.json` **失同步**（后者在 B1-step2 `3e3cfd95` 加了 `@proteus-vue/slot-runtime` 依赖，lockfile 的 importers 缺该 `link:` 项）⇒ 安装**直接失败**、后续部署 step 全 skipped；② 该漂移**两头都看不见**——本地 `pnpm install`（非 frozen）**静默把 lockfile 改对**（开发机永远看不到），CI 侧整条 run 又可能显示 success（部署 step 全 skipped）。★**修**：`pnpm install --no-frozen-lockfile` 重算 lockfile（只 +3 行 = 补上缺失的 `slot-runtime` link）。★**立门禁（工具层兜住——与「提交≠交付」「含官网改动≠已上线」同族）**：新建 `scripts/check-lockfile-sync.mjs`——**判据 = CI 安装步同一条命令**（`pnpm install --frozen-lockfile --ignore-scripts --lockfile-only --offline`，~0.3s、只读、不写盘）；接 `verify` 链**最前**（fail-fast）+ `gates-sync` 的 LOCAL_ONLY（CI 已在安装步覆盖，本条补本地 pre-push 盲区）。破坏性验证：stash 回退 lockfile ⇒ 门禁 rc=1 并打印 pnpm 归因（`ERR_PNPM_OUTDATED_LOCKFILE`：render-backend 差 `@proteus-vue/slot-runtime`）；恢复 ⇒ rc=0。★**验证**：`pnpm install --frozen-lockfile` 本机通过（= CI 契约）；check:lockfile-sync / gates-sync（70 CI + 45 本地全接线）/ script-compile / safe-edit 全绿；`node --check` 新脚本 OK。★**影响面（如实）**：线上自 `55804e90`（2026-10-06 21:28 UTC）起未真正上线——所有含 `[deploy]` 的 run 都因该步失败，期间含 #637 官网文档梳理等官网改动。★**教训**：① **本地能「自动修正」的漂移 ⇒ 必须有针对消费方契约的门禁**（本地非 frozen install 静默改 lockfile，与「hook 契约漂移」同族：自测通过 ≠ 契约成立）；② **「run 显示 success」≠「部署真跑了」**——判别看 **job steps 是否真 ran**，不看 conclusion（`deploy-pending` 头注早有此条，本轮是活体实证）；③ 门禁只报红，「清存量红 / 修静默故障」仍是收尾纪律。★新会话以此为准。

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

