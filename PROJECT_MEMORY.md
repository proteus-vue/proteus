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

## 当前状态速览（最近一次更新：**2026-10-05·（一九九）· **G-61 B0 契约冻结达成：StyleIR v1 落地 + 三表合一 + SApp SPI + 基准 manifest + 跨语言规范编码 golden**（决策 #547）——用户「换个思路，先实现框架自己的多端一致性 CSS 引擎」（承 #544 立项 / #546 基准口径）。★**交付（全部可 grep）**：① `packages/contracts/src/style-ir-registry.generated.ts` **77 字段**（semantic 50 / engine-only 27）——由 `gen-style-ir-registry.mjs` 从三张既有表**机器推导**（不新增第四张手写表）+ 棘轮基线；② `style-ir-values.ts`（ResolvedLength 三态等值类型闭集）；③ `style-applier.ts`（**SApp SPI**：capabilities/applyStyleIR/applyDiff/measure? + FieldSupport native|rewritten|degraded|absent + ApplyResult.skipped 必可见）；④ **基准 manifest** `docs/generated/style-baseline/manifest.json`（B-a/B-b/B-c 三样本）+ **真采集器** `collect-style-baseline.mjs`（Playwright 真产物 390×844/DPR2/light，锚点校验拒采错误页）+ 门禁（指纹**从产物机器读**不手抄）；⑤ **跨语言规范编码**（★最大工程发现）：逐字节契约不能靠语言默认行为——实测 **`1e21` JS 指数记法 vs Rust 定点**、**serde_json 默认快速解析对 `123456789012345680000` 低 1 ULP**（修：开 `float_roundtrip`）⇒ 编码三条写死（键 UTF-8 字节序 / 数组保序 / 数值定点十进制去尾零拒 NaN）+ TS⇄Rust 双实现（CLI 新子命令 `canon-style-ir`）。★**判据全绿**：check:app-css-surface（未登记分歧 0）· check:style-ir-schema 0 error（7 判据，含"生成器重算"交叉判据防陈旧 dist 假绿）· **IR Golden 14/14**（含驱动**真二进制**对拍 + 真实折叠面数据段）· check:baseline-manifest 0 error · gates-sync（三新门禁已接 CI + verify）· vue-tsc 全绿。★**破坏性验证**：Rust 键序反转 ⇒ 7 条红；TS 精度坍缩 ⇒ 3 条红；篡改基准 env ⇒ rc=1（恢复 rc=0）。★**诚实边界**：B0 冻结的是**编码层**等价（SFC 级"两后端各自产 StyleIR"属 **B1 CSE**）；基准样本当前 1 页；D5 写入守卫在 B5。★**收尾 `pnpm verify` 清账 5 类既有债务**（**均非 B0 引入**——每处都用 `f02fa0c2` worktree 取证"改动前同样红"）：① `check:profile-baseline`（批次 41 grid 演示未登记 ⇒ 钉住 + 生成器加"逐条理由/陈旧登记"判据）；② `check:en-drift`（**CI 红自 10-04**——4 个 GP4 宿主组件漏 `COMP_EN` 登记 ⇒ 补登记重生成，EN 79/79）；③ `check:vapor-capability`（3 类增长经评审 = **新增的如实诊断** ⇒ 重定基线 + note 写依据）；④ `check:host-rounding` 9 处（7 处 chrome 尺寸登记 `I2-ALLOW` + **2 处真修**：视口 fallback 的 dp→px 往返 + 已废弃的减 tab 栏旧口径）；⑤ `check:shell-i18n-vars` 15 处（`$VAR<全角>` → `${VAR}<全角>`，10 文件）。**verify 全链分段跑完均绿**（含 showcase e2e 121/121）· 官网部署已触发（`[deploy]` `8d9eed94`）。★**下一批**：**B1 CSE 内核**（匹配/五级层叠/继承/计算值；判据 = IR vs getComputedStyle 100 例 100% + `proteus explain` 可 trace）。★**★目标口径 + A→B 升级准则（2026-10-05 追加，决策 #548）**：用户「我们的目标不是打造通用浏览器标准 CSS 引擎，是**只属于我们框架特色的多端一致性引擎**，只是目前以 CSS 为基准；若这路子做不到多端一致性，就要考虑 **IR 统一（含 Web 端）**」⇒ 两处口径修正：① **CSS 只是当前基准载体、不是目标本身**（Profile 取舍标准随之明确：进不进 Profile 看"**能否多端一致落地**"，不能的宁可 lint 全端禁用，不许各端各自近似）；② **B 档（IR 生成 Web CSS）从"可选优化"升格为"升级路径"**——A 档被证明结构上不可收敛时切 B 档（IR 成为含 Web 的全端唯一标准）。**触发准则 E1–E4（可判定·需证据包·非感觉）**：E1 判据①封顶（IR≡Web 计算样式无法收敛 100% 且残差归因"浏览器语义编译期不可复现"）· E2 判据②原地打转（≤0.5dp 覆盖率多轮不再升，残差归因**布局算法语义差** Taffy⇄Blink）· E3 基准自身不稳（Web 重采不可复现/多环境 Web 不一致 ⇒ 真值不唯一）· E4 降级不可收敛（Skyline 刚性 ⇒ degraded 面持续扩大）。**双向防误用**：未触发前不得提前切（B 档=自担 Web 布局语义）。B0 冻结的**规范编码/golden 正是 B 档的候任"标准"本体**。落库：README §2.1/新增 §2.4 + 03 §1 提示块 + 04 风险 **R8**。★新会话以此为准。

## 当前状态速览（最近一次更新：**2026-10-05·（一九八）· **G-61 css-engine 立项入库：跨端 CSS 引擎（PCE）——补齐「样式域」这条从未有过统一层的链路**（决策 #544；基准口径追加 #546）——用户点破：「感觉我们现在没有做自己的完整跨端 CSS 引擎，**不是逻辑层**，是**可以落地到每一个宿主**、要求**多端视觉一致性**的东西」。★**只读勘察证实判断成立**：今天存在**三套互不相干的样式实现**（Web 浏览器 CSSOM / Skyline 微信容器 / App **编译期字段折叠**——`docs/generated/app-css-surface.md:6-7` 原文「App 端**无 CSS 引擎**」）；编译期是**"字段折叠器"不是 CSS 引擎**（`template.ts:56-112` 折叠面 32 布局 + 17 绘制；`:1048-1063` 自述「**无特异性权重（只按源序）· 无继承 · 只静态类**」；解析分散三处不构成 CSSOM）；**宿主侧无统一样式应用器**（`render-backend/src/spi.ts` 仅 `patchProp`，`css-compat` **B2 未做**）；**量化缺口**：一致性 M1 **0.5877** · 布局字段层 L2 **2/38** · Profile **P4/P6 未实现** · **三张样式属性表已报红**（违反铁律 #9）。★**核心架构「一份引擎 + 四层可插拔 PCE」**：L-A `CSE` 编译期 CSS 引擎（唯一真源：匹配/五级层叠/继承/计算值/动态 class 预计算）→ L-B **`StyleIR` 契约**（**唯一样式通路**，字段闭集 38 语义子集 ∪ 49 引擎超集）→ L-C **`SApp` 宿主样式应用器**（每端一个、唯一样式落地点、可 conformance）→ L-D `Capability Registry`（**三表合一** + 编译期降级）；一致性 = **三层判据**（① IR 等价·编译期硬 ② 数值等价 ≤0.5dp·运行期硬 ③ 像素观察·非门禁承 G-56.7 逐端真截图 + 假绿防护）。★**本次已定调（用户逐条确认）**：**①Web 端 = A 档**（保浏览器原生 CSS，IR 只作影子真值基准，不由 IR 生成 Web CSS；一致性靠编译期 lint 前置）· **②入库占号 = G-61**（**自然接续号**，v3.18 已避让让出、无撞号无原则号顺延；G-62 为 svg-skyline 异常号）· **③App 端 = 新通路并行 + 逐字段切换**（禁一次性替换，每批 IR 等价兜底，切换期显式登记未覆盖字段）。★**登记（四路同步）**：新建 `docs/proteus-css-engine-plan/`（README + 01 现状勘察与证据索引 + 02 StyleIR 契约/Registry/SApp SPI + 03 三层判据 + 04 分批与边界）· facade 三文件 **v3.19** · `proteus-architecture.md` **原则 #13.84-88 + 铁律 G-61.1-9 + 规则 CMP228-238** · `board-inventory.md`（L2 核心引擎 +G-61 行 + §4 两行 + L0 行 #13.88）· `README.md` 计数 85→86、G-01~G-61。★**判据**：`node scripts/check-consistency.js` **✅ 全部通过**（G 表三文件同集合 · 序列完整 **G-01~G-61**）。★**★本 plan 的核心判断**：**「自研 CSS 引擎」与「运行期零解析」不矛盾，而是同一件事的两面**——引擎放编译期、宿主只放应用器；补的正是**四层可插拔里"样式域那一格"**（`css-compat-plan/06:14` 反的是**运行期** CSSOM，本 plan 立场一致，只改措辞）。★**诚实边界**：本 plan 为**规划、无落地实现**（可复用 `layout-core-rust` Taffy + `apply_style_key` 通道 / `pnode-style.ts::resolveLength` / `packages/consistency` 全套 / `Proteus_CSS_Profile规格.md` L0-L5 与七步算法）；是本规格 **P3–P7 的工程化落地**（不推翻）；**不占泛化序**（沿 G-08/G-22 先例，故 spi-first 映射表与 whitepaper 泛化计数不动——但其「G-01~G-60」边界文字留作白皮书专项口径刷新）。★**下一步**：**B0 契约冻结**（StyleIR v1 + 三表合一 + SApp SPI 签名 ⇒ `check:app-css-surface` **由红转绿**）。★新会话以此为准 **⑩ 基准口径追加（2026-10-05，决策 #546）**：用户「还有多端一致性校验以web视觉作为基准」——把「Web 基准」从**散落表述**收敛为**可判定 + 可守护**的规约。**基准三件套**：**B-a** 计算样式（`getComputedStyle`）/ **B-b** 几何（`getBoundingClientRect` → snapshot）/ **B-c** 视觉（Playwright 真渲染截图），判据① 用 B-a、② 用 B-a+B-b、③ 用 B-c ⇒ **三层判据的 `expected` 唯一来源 = Web**；**四条纪律**：**D1 单一**（端间互比只作**诊断**、不得定案——两端可同时偏且一致）/ **D2 冻结**（golden 快照入仓，比对不靠当场重跑；活体重采集只用于**基准腐化检测**）/ **D3 可复现**（登记浏览器版本·DPR·视口·字体栈·主题指纹，任一变化即基准变更须**审批 + diff 审计**）/ **D4 基准自身合法**（基准样本须先过 Profile lint）；**基准守护**（引入基准=引入新的可腐败资产）：清单可寻址（`docs/generated/style-baseline/manifest.json` + `check:baseline-manifest`）/ 变更须审批 / 腐化检测 / **基准不得由被测端自证**（App/Skyline 脚本**只读**基准）+ 字体敏感样本标 `baseline-sensitive: text`（走 `textMetrics` 容差）；**收敛既有资产**：`hosts/shared/check-cross-end-geometry.py` 的「三端 digest 逐字节一致」**收敛为「各端 vs Web 基准 digest」**（原判据在"三端同时偏且偏得一样"时判绿 = D1 缺陷）；`Proteus_CSS_Profile规格.md:400`「Web = 真值基准」是同立场**强化**；**A 档推论**：IR 只是 Web 基准的**规范化载体**，凡「IR 与 Web 计算样式不一致」**默认判 IR 错**，禁以"改基准"消差；**先例**：#542（App 与 Web 基准逐屏对比）/ #543（只看一端 ⇒ 验收失效）/ #545（独立子代理 + **Web 基准** + 逐端真截图）三轮 superapp 修复已按此实践——本批**制度化**。**落库**：`03-consistency-gates.md` **重写**（新增 §1 基准 + §6 基准守护、判据①更名「基准等价」、像素基线加 `vsBaseline: 'web'`）+ `README` **§2.3** 与 **INV-CE-09/10** + `02` 基准声明与设计约束 5 + `04` B0/B5 基准交付物与 R6/R7 与不做清单 + `01` 新增缺口 **G6（无基准资产）** + L0 原则 **#13.89-90** / 铁律 **G-61.10-11** / CMP **239-241** + board-inventory 与 facade **v3.20**（**G 表不变，仍 G-01~G-61**）。**判据**：`check-consistency.js` ✅ 全部通过（scope 0 非法 · G 表三文件同集合 · 序列完整 G-01~G-61 · contracts ✅，2 项包注册表差异为既有基线）/ `check-memory.mjs` ✅ / `check-gates-sync.mjs` ✅。**诚实边界**：基准 manifest / 腐化检测脚本 / 写入守卫**均为 B0/B5 新增交付物（❌ 未实现）**，现状只有 Web 探针与像素基线文件；本批**零代码、零运行时能力变更**（`hosts/**`、`packages/**`、`superapp/**` 一行未碰）；白皮书与 spi-first 映射表计数口径仍为旧值（本 plan 不占泛化序，留作专项刷新）。

## 当前状态速览（最近一次更新：**2026-10-05·（一九七）· **superapp 多端视觉对齐 · 7 轮独立子代理外部验收（决策 #545）——用户「视觉验收还是不行，尤其 iOS 页面能一直拖着来回动…先解决这个」+「多端对齐不要自己看，交给单独子代理（外部视角）」+「基准是 Web」。★**iOS 无限拖拽真根因**：`applyContentOffset` **只钳 y、从不钳 x**（且 superapp 场景从未开启内容滚动钳制——只有 stress 场景开）⇒ 修 x=0 钳制 + 场景开启 + 加**滚动探针**（纵横各 ±100000 ⇒ 全 0）进报告可回归。★**7 轮外部验收抓出并修**（逐项像素级证据，含证伪我的"已修"声称）：① **iOS 完全无 Tab 栏**（自绘层每次重绘盖住它 ⇒ 改挂 superview + bringToFront）；② **iOS/鸿蒙整屏偏绿**（8 位 hex 按 AARRGGBB 解，应为 CSS4 序 #RRGGBBAA；Android 本已正确）；③ **鸿蒙 tab 图标彩色 emoji**（FE0E/字体族无效 ⇒ 改 **SymbolGlyph 系统矢量** + 字号对齐 Web）；④ **鸿蒙 tab 栏**深底/蓝选中 ⇒ 改 Web token（白底/顶线/#5b5bd6/#5f6673/#d64545）；⑤ **Android 高亮错位**（highlightTab 只认直接 TextView 子节点）；⑥ **Android tab 栏上方深色块**（contentHost 缺浅色底）；⑦ **三端缺 `›` 与版本值**（箭头改文本字形；`versionText` 是非 ref 的 const ⇒ extractRefLiterals 增补）；⑧ **客服球跑到顶部**（`calc()含 env()` 不被折叠 ⇒ bottom 丢弃）⇒ 编译器给 env(safe-area-*) 取 fallback；三端视口改**全屏**（Tab 栏纯 overlay + 页面 padding 让位，与 Web 同构）；⑨ **Android 光晕暖米色**（**阴影色 32 位存 float[] 丢低位** ⇒ 高/低 16 位拆存）；⑩ **鸿蒙光晕 ≈2.5–3×**（alpha 施加两次 + shadow radius 单位是 vp）；⑪ **Android 证据竞态**（报告先写、末帧未画 ⇒ 等末帧）；⑫ 页头压状态栏 / 鸿蒙 tab 栏下灰带。★**★★方法论**：**"自己看"会系统性放过**（我只看了 Android）；**独立子代理连抓 7 轮**（含证伪我的声称）；**但它也会误判**（把 MIUI 侧边把手当应用缺陷——我用"设置 App 同位置同样存在"证伪）⇒ 纪律：**多端视觉验收 = 独立子代理 + Web 基准 + 逐端真截图 + 每条结论归因复核（含证伪）**。★**独立子代理终验（第八轮）：`VERDICT: pass`**（A–F 六项全过；余 6 条低优先细节记入诚实边界）。★**判据**：test:coupled 绿 · check:app-screen-content 绿 · gates-sync/no-blind-wait 绿 · 三端零设备编译绿 · 全量测试绿。★**诚实边界**：仍是**构建期静态快照**（非实时 slot/Vapor 运行时）；App CSS 仍限类/元素/通配/结构伪类。










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

