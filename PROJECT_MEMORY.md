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

## 当前状态速览（最近一次更新：**2026-10-08·（二九八）· ★★★超应用 CSS 扩展 · 批 A②(1/3)：iOS `position:fixed` 脱离内容滚动 · 决策 #652**（承 #651 批 A①）——`position:fixed` 语义 = 相对视口固定、**不随内容滚动**；iOS 滚动用「根层 `sublayerTransform` 全局平移内容」实现 ⇒ fixed 层须脱离该变换。★**交付**：`styleOf` 透传 `position`（此前白名单丢弃，同 #650 整类缺陷）+ `buildLayers` 建层后把 `position:fixed` 层**重挂到视图层**（不在内容变换下 ⇒ 不随滚动）+ `zPosition=2000` 浮起。★**判据**：iOS swiftc -typecheck 绿 + check:ios-style-keys 绿（透传 61）+ **真机 superapp 全屏渲染正常**（fixed 底栏在底部、内容/卡片零回归）。★**诚实边界**：frame 用内核绝对 rect；**命中测试**仍按内容坐标 ⇒ fixed 元素滚动后 tap 会偏 contentOffset（具名）。★**批 A 剩余**（同批分步，非跳过端）：**Android/鸿蒙固定绘制循环的 fixed 补偿** + **sticky（全端吸附）** + **z-index→语义层映射**。★**教训**：全局内容变换式滚动（iOS sublayerTransform / Android·鸿蒙画布平移）下 fixed 必须抵消该变换。★**方案** `docs/proteus-superapp-css-expansion-plan.md`（5 族 F1-F5，A→E）。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二九七）· ★★★超级应用 CSS 能力扩展 · 方案 + 批 A①（position fixed/sticky 入内核 · 修「fixed 静默改写为 absolute」）· 决策 #651**——用户「CSS 能力不足以支撑超级应用，文本/排版太简单……按超级应用真正需要的刚需落地新的一批 CSS 能力，需要很多新的族」。裁定：**五族全做（A→B→C→D→E）**；z-index 用**数值→语义层映射**。★**方案**（`docs/proteus-superapp-css-expansion-plan.md`）：按超级应用刚需核对，缺 **5 个整族**——**F1 定位与层叠**（fixed/sticky/z-index）· **F2 视觉特效**（filter/backdrop-filter，Skyline 官方已支持）· **F3 排版增强**（font-style/font 简写/text-transform/font-variant-numeric/decoration-color/text-indent/word-spacing/overflow-wrap）· **F4 交互态与伪元素**（状态伪类 + ::before/::after）· **F5 滚动增强**（scroll-snap/overscroll/scroll-behavior）。取证 = superapp 真实语料 + Skyline 官方属性表（109 项）+ 真 Chromium。★**批 A①（IR 正确化）**：旧**批次 45** 曾把 `position: fixed` **静默改写为 `absolute`**（理由「App 单全屏视口，两者等价」）——**内容滚动落地后不成立** ⇒ **移除改写**；内核 `Position` 枚举加 `Fixed`/`Sticky` + `ffi.rs` 解析 + `taffy_engine.rs`（Fixed→absolute 布局 / Sticky→静态）+ 编译器 `APP_ENUM_VALUES.position` 加 fixed/sticky；CSE 天然透传。★**判据**：cargo test 211+（新 `position_fixed_sticky` 2 断言）+ test:coupled 388 + 定向 vitest 162（同步「sticky 不支持」旧断言 + 新增 fixed）+ **superapp 产物实测含 `position:"fixed"`** + app-screen-content/host-kernel-keys/style-ir-schema 全绿。★**诚实边界**：本步=IR 正确化（内核布局就绪、编译器不再撒谎）；**宿主「fixed 不随滚动 / sticky 吸附」与 z-index→语义层映射为批 A 后续步**（本步无视觉回归——fixed 暂同 absolute 行为，仅 IR 不再撒谎）。★**教训**：**「当时等价」是时效性判断**——批次 45 的 `fixed→absolute` 在「单全屏无滚动」时为真、内容滚动一落地就变假；此类「为解决当时问题引入的改写」必须随能力演进复核（同 #597「引擎边界有时效」）。★**下一项**：批 A② 宿主「fixed 不随滚动 / sticky 吸附」（iOS sublayerTransform 补偿 / Android 画布平移补偿）→ 批 A③ z-index→语义层映射 → 批 B/C/D/E。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-08·（二九六）· ★★★iOS 宿主 `styleOf` 透传覆盖门禁 + 抓修 2 处静默降级 · 决策 #650**——CSE 特性清单已清空（无 P0、无「语料在用未实现」），转收记忆标注「**跨 6+ 次复发**」的 iOS 长期欠账。★**缺口**：iOS 自绘宿主 `SelfDrawView.styleOf(_:)` 是**建层必经之路**（`buildLayers`/`insertLayers` 都经它，产物同进 `metaByNodeId`=度量真源），用**白名单**只透传绘制/布局键。**被消费者读、却没进白名单的键 = 请求树里有值、宿主永远读 nil ⇒ 静默不生效**（无报错/无日志）。`check:host-kernel-keys` 明说**不覆盖 iOS**。★**交付（门禁 · 机器推导）**：新 `scripts/check-ios-style-keys.mjs`——**透传集**（styleOf 内写进 style 的键：`for k in [..]`/`n["X"]`/`style["X"]=` 三形态）vs **消费集**（全文件 `style["X"]` 读），判据 `消费−透传−外部写入 ⊆ EXCUSED`（带理由）+ 陈旧豁免检测 + **解析护栏**（函数被改名 ⇒ 红，防门禁自身假绿）。接线 package.json + verify 链 + gates-sync LOCAL_ONLY（与 host-kernel-keys 同族）。★**首跑即抓出 2 处真实静默降级并修复**：`borderRadiusPct`（`applyRadiusPct` 读却未透传 ⇒ `border-radius:50%` 在 iOS **静默不生效**）+ `animation`（`startCssAnimations` 读却未透传 ⇒ CSS keyframes **静默不启动**）；两者 Android 读原始 spec 故只 iOS 漏。★**判据**：门禁绿（透传 60·消费 44·豁免 0）+ **破坏性验证**（删键 ⇒ 当场红 rc=1）+ iOS swiftc -typecheck 绿 + **真机 animation 页**（.spin 画成圆 + 新增 `CSS_ANIM nodes=1 anims=4`，修前恒 0）+ 全量 `pnpm test` 5375/5375。★**诚实边界**：门禁覆盖 `style["X"]` 直读形态（143 处；别名变量读不在内，当前无此形态）；`animation-name/-duration` 等**长手**编译器侧未折（batch 42 只折简写）⇒ App 不启动，**但已诊断**（`不在引擎字段表内（已忽略）`）= 具名边界非静默。★**下一项候选**：animation 长手折叠（新能力，走 CSS SOP）或 css-conformance 逐页多端视觉验收。★新会话以此为准。

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
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#652——按号检索（`grep -n "^652\." …`）|

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#652 → 归档速查）

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

