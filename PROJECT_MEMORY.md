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

## 当前状态速览（最近一次更新：**2026-10-08·（二九一）· ★★★权限声明结构化 —— 逐权限原因说明（reason / usedScene / maxSdkVersion）+ Android uses-feature/queries + iOS ATS · 决策 #645**——用户「还是不够用，比如动态权限申请原因描述等等」（承 #644）。★**缺口（取证）**：三端 `permissions` 此前只是**纯字符串数组**，落地成 `[{name}]`——撑不起真实工程：鸿蒙**用户授权权限必须声明 `reason` + `usedScene`**（否则上架/授权被拒，且 `reason` 须是 `$string:` 资源引用），Android 权限可带 `maxSdkVersion`（存储权限 Android 13+ 已废弃）。★**实现（penetration 向后兼容）**：`permissions` 类型从 `string[]` → **`Array<string \| AndroidPermission>` / `Array<string \| HarmonyPermission>`**（字符串简写 = 仅 name）；新增 `usesFeatures`（`<uses-feature>`）/ `queryPackages`（`<queries>`，Android 11+ 包可见性）/ iOS `appTransportSecurity`（NSAppTransportSecurity 放宽，联调常用）。★**关键增量（鸿蒙 reason 资源自动化）**：`reason` 写**普通文案** ⇒ 框架**自动生成 `$string:` 资源键**（`permission_<name>_reason`）并写入 **entry 三语言 string.json**（base/en_US/zh_CN，幂等）；写 `$string:xxx` 则原样引用。`usedScene` 缺省 `{ abilities: [EntryAbility], when: inuse }`。★**落地**：`native-config.ts` 归一（`normAndroidPermissions`/`normAndroidFeatures`/`normHarmonyPermissions`）+ apply（android `maxSdkVersion` attr / uses-feature / queries 幂等替换；ios `setPlistAts`；harmony 结构化 requestPermissions + reason 资源写入）；`config-validate` 新增 `permEntries`（字符串或含 name 的对象）+ ATS/三者校验；schema（oneOf 字符串/对象）。★**纪律不变**：只写声明字段（declared）+ 幂等 + 保留其余内容。★**验证**：native-config 单测扩到 **14 例**全绿（结构化权限/特性/queries/ATS/reason 资源 + 幂等）；**端到端 apply 真实模板**（android perm-max/feature/queries · ios ats · harmony reason-ref/scene/res 逐条命中）；`resolveNativeConfigFromProject` 读回结构化权限；根 vue-tsc 零错误；`generate types --check` 无漂移；`config:check` 三 config 全过；**全量 `pnpm test` 5368/5368 全绿**；website 十门禁（含 check:config-ref 重生 → 权限条目展开为 `permissions.<entry>.name/reason/usedScene` 锚点）+ build:website。★**教训**：① 权限不是字符串——真实工程要「逐权限原因/场景」；② **平台要求的资源引用要会「生成」**（鸿蒙 reason 须 `$string:`，框架自动建资源键 + 三语言写入，用户只写文案）；③ 生成器要能**展开引用的辅助接口**（`AndroidPermission`/`HarmonyPermission` → `<entry>.xxx` 锚点），否则联合类型在参考页是黑盒。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二九〇）· ★★★扩充 targets 各端字段支持度（原生工程能力全量）· 决策 #644**——用户「targets 平台字段支持度还是不够，继续扩充」。★**取证**：v4 各端仅基本身份字段（android 9 / ios 7 / harmony 9），真实 App 上架/配置所需字段缺失。★**扩充（三端共 +22 字段）**：`targets.android` +`launchPage`（manifest `ProteusHomePage` meta-data）/`theme`/`allowBackup`/`largeHeap`/`hardwareAccelerated`/`supportsRtl`/`usesCleartextTraffic`/`networkSecurityConfig`/`appCategory`；`targets.ios` +`launchPage`/`userInterfaceStyle`/`statusBarStyle`/`statusBarHidden`/`urlSchemes`（CFBundleURLTypes 深链）/`privacyUsageDescriptions`（NSXxxUsageDescription·★上架必需）/`appCategory`/`requiresFullScreen`/`developmentRegion`；`targets.harmony` +`icon`/`appCategory`/`orientation`（入口 Ability）。★**实现**：类型（config.ts 三端接口）+ schema + validate（新增 `optStr`/`optBool`/`optEnum` + privacyUsageDescriptions 键名形如 `NS…UsageDescription` 校验）+ `native-config.ts` 落地（新 helper：`setPlistStringOrAdd`/`setPlistBoolOrAdd`/`setPlistUrlSchemes`[嵌套 array 括号配平] / `setJson5StringOrAdd`；android application 属性 set-or-add、ios 字符串/布尔存在则改缺失则插、harmony app.json5 插入与 module.json5 abilities[0].orientation）。★**纪律不变**：**只写声明过的字段**（`declared` 逐字段标记）+ **幂等** + 保留工程其余内容。★**验证**：`native-config` 单测扩到 **11 例**全绿（含三端新字段 + 幂等）；**端到端 apply 真实模板**（android largeHeap/theme/launchPage · ios scheme/privacy/style · harmony icon/类别/方向 逐条命中）；`resolveNativeConfigFromProject` 从真实 `proteus.config.ts` 读回全部新字段；根 vue-tsc 零错误；`generate types --check` 无漂移；`config:check` 三 config 全过；**全量 `pnpm test` 5365/5365 全绿**；website 十门禁（含 check:config-ref 重生 → 新字段进参考页 zh+en）+ `build:website` 绿。★**教训**：① 补字段要**四处同步**（类型 / schema / validate / applyNativeConfig）——本次四条同改；② 「存在则改、缺失则插」是「补丁只写声明字段」的实现前提（不能因为模板没那个键就静默跳过——真实工程本就可能没有该键）；③ **JSDoc 里的 `*/` 会破坏块注释**（`resources/*/media/` 触发 TS1131——本仓第二次踩，注释里避免 `/*` 序列）。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二八九）· ★★★清掉全量测试 4 处存量红（registry-drift / golden / emoji / hmr 时序）· 决策 #643**——用户「清掉」（承 #642 轮末如实上报的 4 处 pre-existing 失败）。★**逐处归因 + 处置**：① **`registry-drift`**——`packages/compiler/src/script.ts` 用了 `page/nav-global`（`$nav` 页方法注入 · 决策 #616 的 MP 腿）却**未在 transforms 注册表登记**（反向漂移门禁正是拦这个）⇒ 补登记 `page/nav-global` AI 说明书（title/why/when/example/verify/source/decision，zh+en）。② **`golden`** 4 快照缺 `$nav` 助手——同一决策 #616 的产物增量（`$nav(target){…}` 页方法），快照未同步 ⇒ `-u` 重生（**diff 确认仅 +4 行 `$nav`**，无他变）。③ **`fluid-formfactor-render` emoji**——`website/src/pages/CssEngine.vue` 的两个字符是**文本标记**不是 emoji（`✕` = 已允许 `✓` 的「未胜出」配对，同一 `decl-mark` span；`▼` = 管线流程箭头，与已允许 `▸/▾` 同类）⇒ 按类收编进 `ALLOW` 集（**照 `◐` 先例，加注释说明为什么不是图标**）。④ **`hmr-dev-server`** ——唯一一处**真·时序 flake**：`★真实增量编译` 用例是文件里**唯一没用 `ensureWatchActive` 预热**的 fs.watch 用例（2026-09-19 已为其余 4 个加过预热——漏了它）⇒ 满负载下 macOS FSEvents 首投递延迟 → 45s 超时。修：接同一预热 helper（先写一次等首事件到达 → 清空 → 再断言唯一 payload）。★**连带（新增规则引发的计数/产物同步）**：规则数 118→119 ⇒ 更新 `tests/compiler-ir-m5` 的 `COUNT_SNAPSHOT`（并把重复的 phase 字面量改为引用该常量）+ `website/src/stats.ts` 118→119 + 重跑 `gen:reference`（`content/reference/rules.md` + en）。★**验证**：**全量 `pnpm test` 5362/5362 全绿**（此前 4 红 → 0）；hmr 用例连跑 3 次稳定（1.4s）；门禁 stats/docs/docs-stats/content/en-drift/doc-links/reference/script-compile/safe-edit/deps/gates-sync 全绿。★**教训**：① 实现里加了转换决策**必须同步三处**（注册表 AI 说明书 / 快照 / 官网规则数）——`registry-drift` + `compiler-ir-m5` + `check:stats` 三条门禁各守一角（这次全被逮住）；② **flake 修法要成对**：`ensureWatchActive` 预热是既定方案，**新增同类用例必须一并接入**（漏一个就是一处满负载假红）；③ **测试里别放「第二份常量」**（phase 字面量重复导致改一处漏一处——已改为引用 `COUNT_SNAPSHOT`）。★新会话以此为准。

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

