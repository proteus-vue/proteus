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

## 当前状态速览（最近一次更新：**2026-10-05·（二〇九）· **CSS 逐项全端对齐 · 边框族收口批（线型 dashed/dotted + 逐角圆角）——「旧图交子代理」事故固化为 `fresh` 门禁**（决策 #558）——用户：「不错，继续把边框后续未收口的也收到边框里面，比如边框样式等等」+ **中途严厉批评**「你截图都不看是不是旧版的就直接扔给子代理了吗？子代理是最后一关，使用成本是非常昂贵的……子代理每次使用都是至少 10 分钟起步」。★**事故→机制**：上轮只重截鸿蒙、Android/iOS 旧图（含已删 F 段）被交子代理 ⇒ 白烧一轮；修复=**新子命令 `fresh`**（截图 mtime ≥ max(页面源/壳/宿主源/构建产物)，stale 即红点名）+ **`side-by-side` 前置拒绝**（stale ⇒ rc=2）+ 两次破坏性验证；上线当天再拦一次（Android 重截图被 **MIUI 安全中心悬浮窗**污染——靠内容区逐像素比对发现并重截）。★**交付**：`border<Side>Style` 进 semantic 读数链路（注册表 63 semantic · 快照键 70）；`border-width/color/style` **1–4 值简写**；**逐角 radius** 就地累积+合成；三端宿主线型绘制（Android 封角块+DashPathEffect / iOS lineDashPattern / 鸿蒙 ArkUI 原生）；**dashed 节距对齐 Chrome 真值 {3w,2w}**；鸿蒙滚动接线（scrollRoot + 范围钳制）。★**★★用户拍板「UA 未定义处自定标准」（决策 #559）**：「CSS 标准里没规定的我们可以自己定标准，点状边框统一为圆点」⇒ **dotted 统一圆点**（W3C 原文即 "round dots"；MP/鸿蒙本即圆点；Chrome 方点属自由区不再是基准）——Android/iOS 宿主**圆点网格**（首末点圆心距端 w/2 贴边、中段等距、无封角块；★首版 ROUND-cap 被独立复评抓出端点外溢 w/2+合并斑块，改网格后 bbox 精确=布局盒 spill 全 0、四角 9×9dev 单点——第四轮复评五端全 pass）；**标准分级**：有 Web 真值 ⇒ 照 Web；规范/主流端一致 ⇒ 定标准照改；引擎锁死 ⇒ 具名。★**事故（同日两次）**：Android 重截图两次被 MIUI 系统浮窗污染——**立即彻底删除**（仓库+/tmp）+ 右上区主色自检确认；纪律：截图自检**每次重截后立即做**。★**顺手清债**：逻辑属性 70 条具名 excluded · curated 源 4 字段 · I2 补登记 5 处（上批遗留）· M1 65.1% 变难看但更诚实（已归因）。★**判据**：fresh 15 张全绿 · probe 四端全绿 · `test:coupled` 311 绿 · 样式/一致性/台账/桩测/零设备编译/vue-tsc 全绿。★**下一项**：按 `css:next` 取。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-05·（二〇八）· **CSS 逐项全端对齐 · 逐边 border 族（border-bottom/top/left/right 四项一次完成，五端 pass）**（决策 #557）——用户「不错，继续」（承 #556 PLAYBOOK 复用方案）。★**首个按 PLAYBOOK 推的项**（目标：复评 ≤2 轮，实测 2 轮）。★**交付**：`border-<side>` 四边族全链——**契约层**（矩阵 +12 健 + 新级别 `BorderStyle`，四同步：contracts/runtime×2/compiler/注册表映射，照 TextWrap 先例）；**折叠器**（`border-<side>: <w> solid <color>` 简写 + 长手 + `none` 重置语义；非 solid 诊断跳过不冒充实线）；**三端宿主**（Android 逐边线+虚线 PathEffect / iOS 四子层边框（厚度编码进 name——首版存 bounds 被 frame 覆写 ⇒ 上下边丢失）/ 鸿蒙 ArkUI 原生逐边方向）；**applier**（App/Skyline 直传逐边——原收敛 uniform 逻辑删）；**curated 源** 4 条 + 覆盖映射（含补 `whiteSpace` 快照债务：`SEMANTIC_FIELD_SNAPSHOT_KEYS`/`STYLE_KEYS`/web 探针三处）。★**★★验收两轮（PLAYBOOK 见效）**：**第 1 轮机器**（probe 1.5s 抓出 MP 顶部带误报——探针 top 采样带切过标题文字 ⇒ 改**阈值分层** L/R 3% + T 15%，并**破坏性验证**（白带/黑条/正常三注入）；顺带**探针自身削弱**被抓出：首版修法把 top 带挪到 12% ⇒ 注入的顶部黑条漏报 ⇒ 改「加高到 40px + 分层阈值」）；**第 2 轮子代理终评**（1 次）抓出 **3 处真缺陷**：① Android 边框未乘 DPR（`LEN_SCALARS` 漏登记 4 个逐边宽度——**本表注释原文即"新增长度字段必须登记"**，我自己漏了）⇒ 复评 8/8 线厚精确 = CSS×3；② 鸿蒙「单位修正」**改错了方向**（除以 density 反而细 3 倍；真因是 ArkUI 需 **border-style** 才绘制）⇒ 撤销换算 + 补 `SetBorderStyle(SOLID)`；③ iOS 上下边不显示（厚度存 `sub.bounds.width` 被 `frame=` 覆写）⇒ 厚度编码进子层 name。★**判据**：四项验收包 `docs/generated/css-acceptance/border-{bottom,top,left,right}.json`（三段机器判据全过 + visual 五端 pass）；全量单测 **5344/5345**（1 红为新加断言与实现的既有差异，提交前修）；`test:coupled` 269 项绿；7 门禁 + 两端零设备编译全绿。★**诚实边界**：a) case-right 竖线位置比基准偏左 9px —— 属**既知 `box-sizing` 类议题**（决策 #508 已登记，非 border 项引入）；b) Android 截图饱和色整体 gamut 偏移（采集链路色彩配置，非渲染缺陷）；c) 虚线线型（dashed/dotted）编译期诊断跳过——`border-<side>-style` 属独立项。★**PLAYBOOK 校准**：本轮「机器 1.5s + 子代理 2 次（终评+复评）」vs 首项 5 轮——且复评的两处 major 都是**机器判不出的单位/绘制语义**（探针只管页面级几何），符合 PLAYBOOK 的判据分工。★新会话以此为准。
## 当前状态速览（最近一次更新：**2026-10-05·（二〇七）· **CSS 逐项全端对齐 · white-space 首项收官 + 效率复盘（PLAYBOOK 复用方案）**（决策 #556）——用户「这个我看了下质量非常高，可以总结下刚才的经验教训，因为现在的四轮复验太耗时了，需要提高效率，看看 white-space 族能不能有一个高效率复制方案，给下一项复用」。★**white-space 首项已收官**（`ca05f818` + `7217e9b5` 已推送）：**五端全对齐、独立复评五端 pass、零残余缺陷**——编译器 `white-space` no-op→真字段 + `vh`→Pct；Android/iOS/鸿蒙三端宿主绘制分流（折行/省略/裁切）+ 两遍测量；**MP 编译器自动注入 `space="nbsp"`**（Skyline 不支持 pre 系 white-space 的正规替代）；鸿蒙另修「JSON 转义字面 n / 截断式 1px 右缘缝 / 状态栏遮挡」；页面级同源修「空 tab 栏 / 页根 width:100% / **缺省 white-space = CSS 标准 normal**（此前 nowrap——鸿蒙副标题「寻址」丢失根因）/ Web 壳背景覆盖」。★**★★效率复盘（用户点名）**：五轮复评 **~100 分钟**实测分解 = **子代理五轮 ~87 分钟（85%）** + 三端真机重跑 ~8 分钟 + 采集 ~1 分钟；**归因 = 第 3–5 轮缺陷全是页面级几何/底色（不需要人看）**。★**交付的复用方案三件**：**① `probe` 子命令**（程序化像素探针，**1.5 秒**判 4 条页面级判据：深色边带/边缘主色 vs Web/右缘缝/卡片边距对称；**破坏性验证过**：注入白带或右缘黑条 ⇒ rc=1；★探针自身抓到一次假绿：量化 `>>3` ⇒ 改 `>>1`）；**② `css-conformance/PLAYBOOK.md`**（下一项照抄七步 + **缺陷分类→重跑范围表** + 已验证坑清单）；**③ 耗时台账** `results/timings.jsonl`（每次运行自动记档）。★**预期**：下一项 **机器判（秒级）→ 一轮子代理终评（~20 分钟）**，vs 首项 ~100 分钟。★**诚实边界**：探针只覆盖页面级几何/底色（文本语义仍需子代理）；CHROME 跳过区是按端常量（换机型需复核）；耗时表待下一项实测校准。★**下一项**：`border-bottom`（13× 用法）—— 照 PLAYBOOK 走。★新会话以此为准。

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
| `docs/project-memory-archive/2026-10.md` | 里程碑详细叙事（三十九～一四五）+ 状态速览历史栈（约 4.5k 行） |
| `docs/project-memory-archive/2026-09.md` | 09 月全部叙事 + 柔性系统重组历史 + 2026-08 进度快照 + 已落地文件 + 09-19 验证状态（约 6.5k 行） |
| `docs/project-memory-archive/decisions.md` | 决策链全文 #1–#507——按号检索 |

检索示例：`grep -n "2026-09-29\|判据建错靶" docs/project-memory-archive/2026-09.md`

## 关键决策与文档偏差（#1–#507 → 归档速查）

**全文在 `docs/project-memory-archive/decisions.md`**（按号检索：`grep -n "^290\." docs/project-memory-archive/decisions.md`）。
决策号**只增不改号**（外部文档按号引用）；新决策追加到该文件末尾（号 +1）。
**锚点**：`#290` 架构方向定案（语义 IR + 可插拔渲染后端）· `#314` 后包地图见「会话恢复指引」。

## 待办 / 注意事项

- ⚠ **★CDP 视觉验收纪律（2026-09-04 晚用户强反馈「你懂什么叫居中吗」「上下间距不一致」）**：官网改完样式必须 CDP 截图 + **数值级核对**再提交——①「居中」要真居中（上下/左右间隙一致、偏差 <4px，不许目测）；② 上下间距对称（如按钮上下 padding 等值）；③ **布局壳禁用带默认布局语义的组件**（p-view 默认 flex-column 同特异性级联靠后会覆盖 justify-content:center——同源坑三次），只用语义中立容器；详见今晚速览首条 #390iii 记录
- ✅ **仓库目录重命名为 `proteus`**（用户本地执行）
- ✅ **文档体系**：根 `README.md` + `docs/`（getting-started / configuration / compiler / routing / roadmap / board-inventory）
- ✅ **开源协议**：Apache-2.0（LICENSE + package.json license 字段 + README 章节）
- ✅ **git 仓库**：已关联 https://github.com/proteus-vue/proteus（main 分支）
- **小程序真机/开发者工具实测（唯一剩余验收项）**：`npm run build:mp` 后用微信开发者工具导入 `dist/mp-weixin`（需真实 AppID + 基础库 ≥2.29.2）
- **Skyline iOS 真机白屏关注**：微信平台已知问题，已入 roadmap v0.5；真机实测时记录复现路径（决策 #69）
- **框架本体拆包（C 类）**：✅ 全部完成（决策 #98-#105，docs/packages.md 8 步）——14 个 @proteus-vue/* 包 + create-proteus 模板 npm 化；**npm 已发布**（2026-08-31：22/22 beta 上线，决策 #215，发布记录见 docs/packages.md）
- **组件库 P0（component-plan B1-B8）**：✅ 2026-08 全批收官——16 组件 + 4 runtime 共享模块 + components:audit + 编译器 4 增强（script/watch-props props 源 watch→observers / ref-write 多行 RHS 修复 / 组件 onUnmounted→detached / 未映射 onXxx 钩子警告）；业务组件（player-bar/payment-sheet/login-gate）标注依赖 appBar/支付（v0.6+）
- **i18n-plan（B1-B3）**：✅ 2026-08——@proteus-vue/i18n（ICU 子集：插值/复数/=N/select/#）+ i18n:check 门禁 + demo；分包加载/完整 ICU/Intl/RTL 标后续
- **devtools-plan（B1-B2）**：✅ 2026-08——@proteus-vue/devtools-runtime（TraceBus 协议/环形缓冲/脱敏/采样/零开销门控）+ lifecycle/component 两源接入（type-only 注入）；面板 B3-B8 标 v1.0+
- **npm 发布**：✅ 2026-08-31 完成——**22 包 beta 全部上线**（granular Automation token；create-proteus 收口 @proteus-vue scope，决策 #215）；**✅ 2026-09-04 pnpm 迁移后全量 38 包正式发布完成**（16 个此前缺失包补齐上架：docs/component-ir/fluid/render-backend/desktop/mcp/agent/test-ir/gesture/style-safety/hmr/devtools/compat-miniprogram/dev-host——publish-all.mjs 并发预检 + 串行发布；日后再发布直接复用该脚本）；正式版流程（pre exit → changeset:version → 同步 examples/templates → publish）见 docs/packages.md
- **security-plan（M1-M3）**：✅ 2026-08——@proteus-vue/security（M1 SecretStorage 加密存储：WebCipher/DemoCipher/volatile/redact/migrate；M3 PermissionRegistry + withPermission + PermissionDenied）+ M3 §3 Router 权限守卫自动生成（RouteMeta.permissions + createRouter options.permissions，与 requiresAuth 守卫同层）；M4-M8 标后续
- **app-plan（B1 核心）**：✅ 2026-08——@proteus-vue/renderer-app（Vue createRenderer + NativeAdapter 抽象 + mock adapter，无需真机验证渲染器接线）；B2-B5（原生视图/样式 rpx→dp/路由桥/能力桥/demo）标 v0.6 正式启动（需 npm 发布 + 原生工程）；Vapor 双模式标后续
- **build-plan M8 缓存**：✅ 2026-08——编译缓存（compileCacheKey 全入参哈希 + 磁盘/内存双层）+ esbuild bundle 缓存（输入快照 mtime+size 指纹）；examples 真实构建 100% 命中 + 产物逐字节一致 + 单文件精确失效；PROTEUS_NO_CACHE 关闭；详见 02-optimize-cache.md
- **types-plan（B3-B7 全批）**：✅ 2026-08——@proteus-vue/types 独立包（Platform/PlatformTarget + JSON Schema + generate types --check 防漂移）+ B4 平台守卫（matchPlatform/assertPlatform/exhaustiveCheck，铁律 #4）+ B5 validateConfig（config:check CLI 错误码）+ B6 加固（品牌类型 Brand/配置迁移 migrateConfig/Schema Registry extendConfigSchema）+ B7 migrate types codemod + CI 门禁；四层测试矩阵随批落地
- **组件类型齐全**：✅ 2026-08——GlobalComponents 模板标签类型注册（16 组件 Pascal+kebab 双名）+ @vue-expect-error 断言 fixture（防退化）；examples vue-tsc 0 错误
- **类型收口（T1-T4）**：✅ 2026-08——公共类型全部统一到 @proteus-vue/types（compiler-types/capabilities/router-types/api-types/config/index-shared），各实现包 types.ts 为 re-export 兼容层（消费方零改动）；runtime 值（ApiError/CapabilityError class、createTrace）留实现包；CapabilityPlatform = Platform alias；type-only 擦除验证 + 无环依赖；方案见 docs/proteus-types-plus-plan/11-type-consolidation.md
- ⚠ **根 vue-tsc 零错误**（2026-08-31 清理 web-button multiSelector 既有错误后清零；持续保持——见「当前状态速览」build:web vue-tsc 零错误）
- 文档版本号已到 v2.53（git 仓库关联）
- ⚠ **★已按用户要求整合（决策 #312/#313/#314）**：`docs/proteus-website-v3-plus/` + `docs/proteus-website-v3-final/`（未跟踪）中的**新内容 G-33（AI Agent）与 G-34（RenderBackend SPI）已抽离**，按编号避让纪律重编号为 **`docs/proteus-ai-agent-plan/`（G-36）** 与 **`docs/proteus-render-backend-spi-plan/`（G-37）** 入库（原 G-33=CLI、G-34=HMR 均已实现占用）；**同批还发现 `proteus-compiler-backend-spi.zip`（内含原稿 G-35，与 app-config 冲突）与 `docs/proteus-host-runtime-plan/`（未跟踪，原稿 G-36 与 AI Agent 冲突 + 兄弟 G-34/G-35）——一并抽离为 G-38/G-39 plan**；两份未跟踪目录 + zip 已删（其余 01-06 内容与已跟踪 `proteus-website-v3/` 重复，无独家内容）；`docs/proteus-website-v3.zip` 先前用户已删，尊重偏好未跟踪；另按用户指示删除冗余文档：`proteus-types-plan`（v1.0 并入 types-plus v2.0）+ `proteus-llm-rules-plan`（并入 website-v3）+ 3 个 `.DS_Store`（决策 #313）。详情见「后续规划」#312-#314。

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

