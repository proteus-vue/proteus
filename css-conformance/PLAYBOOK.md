# CSS 逐项全端对齐 · PLAYBOOK（下一项照抄这份）

> 来源：`white-space` 首项全端对齐（`7217e9b5`）的**五轮复评复盘**。第一项跑了 5 轮独立视觉评审
> （约 17 分钟/轮）才收敛；复盘发现**第 3–5 轮抓到的全是页面级几何/底色缺陷**——这些**不需要人看**。
> 本手册把「机器能判的」全部前移，目标：**下一项复评 ≤ 2 轮**（一轮机器 + 至多一轮子代理终评）。

## 0.5 首项实测耗时分解（复盘的原始数据）

| 环节 | 实测 | 说明 |
|---|---|---|
| **五轮子代理评审** | **~87 分钟（占 ~85%）** | 单轮 931s / 1000s / 1605s / 780s / 100s ≈ 15–27 分钟；**这才是大头** |
| 三端真机全链重跑 | ~8 分钟（5 次 × ~2–3 分钟/端） | 每轮修完都要重跑所有改动端 |
| Web/MP 采集 | ~1 分钟 | collect-web + shot-mp |
| 并发探针 | **1.5 秒** | 新装置；**它抢下的正是第 3–5 轮那三类缺陷** |

**结论**：省时的关键是**减少子代理轮次**（把机器能判的从人手里拿走），其次是**只重跑受影响的端**。
按本手册操作，第二项起预计：机器判 + **1 轮**子代理终评（≈ 20 分钟 vs 首项 ~100 分钟）。

---

## 0. 核心纪律（三条，勿违背）

0. **★铁律：不得以「别批次未落地」为由跳过端（2026-10-07 用户明令）**——一个能力项**四端全过**才算完成；
   「pre-existing / 属别批次 / 具名边界」**不是免死金牌**。遇到端侧缺口**就地补齐**（实证：鸿蒙 app-content
   补 `grad` 通路 · iOS 用栅格化 tile 实现 repeat）。唯一允许具名的是**引擎锁死改不动**的端（且须先穷尽
   「主流端怎么做」）；「本端能实现、只是没接线」**必须本项补齐**。详见 AGENTS.md《CSS 逐项全端对齐红线》。

1. **机器判据先行**：页面级缺陷（底色/白带/黑块/缝隙/边距/系统栏遮挡）一律先过
   `probe`（**1.5 秒**）——红了**不要**交子代理（省一轮 ~17 分钟往返）。
   子代理只补**文本语义级**（折行点/省略号/裁切/缩进/字面转义）——那是像素探针判不了的。
2. **一轮收齐、一次全修、一次重跑**：拿到缺陷清单后**先全部修完**再重跑；
   禁止「修一处 → 重跑 → 再修一处」（white-space 因此多花 2 轮）。
3. **共性缺陷一次修全部端**：缺省语义/空 tab 栏/页面铺满这类问题**通常多端同源**——
   先按「根因」归类再动手（本轮三端缺省语义、三端空 tab 栏、两端铺满都是同源）。

---

## 1. 新增一项的七步（可复制）

```bash
# ① 写页面（真实业务形态；每案例一个稳定 id `case-*`）
#    css-conformance/pages/<域>.vue  —— 页面 SFC，案例容器 id="case-<特性>-<值>"
#    （文本类案例用 script 常量插值保真实换行——Vue 模板会压缩文本节点空白）

# ② Web 基准（真 Chromium；含逐案例裁剪图 + getComputedStyle 读数）
node scripts/css-conformance.mjs collect-web

# ③ 机器判据（该项的实现/parity/三端可表达 + 验收包）
pnpm run css:verify <feature-id>

# ④ 四端真机截图（各自全链；App 端用 PROTEUS_APP_PROJECT=css-conformance 注入）
node scripts/css-conformance.mjs shot-mp
export PROTEUS_APP_PROJECT=css-conformance
node hosts/android/bridge/build-batch.mjs && bash hosts/android/build-and-run.sh --no-install && bash hosts/android/run-superapp-launcher.sh
node hosts/ios/bridge/build-app-stack.mjs && bash hosts/ios/run-selfdraw.sh --superapp --drive
bash hosts/harmony/build-host-app.sh && bash hosts/harmony/run-superapp.sh
# 归位：cp hosts/<端>/results/superapp*.png css-conformance/results/<端>/<page>.png

# ⑤ 并排图（左半恒为 Web 基准）
node scripts/css-conformance.mjs side-by-side

# ⑥ ★像素探针（机器判页面级；全绿才进下一步）
node scripts/css-conformance.mjs probe          # 1.5 秒；任一端 FAIL ⇒ 先修再重跑 probe

# ⑦ 一次子代理终评（文本语义级）+ 登记验收包
#    探针全绿后，把 side-by-side 图交给独立子代理做**一次**文本语义评审
node scripts/css-acceptance-record.mjs <feature-id> <verdicts.json>
```

---

## 2. ★缺陷分类 → 重跑范围表（省时的核心）

| 缺陷类别 | 典型现象 | 改动面 | **重跑范围**（只跑这些） | 预计耗时 |
|---|---|---|---|---|
| **页面级**（底色/边距/缝隙/系统栏） | 黑块、白带、白框、右缘缝、卡片贴边 | 项目样式 / 宿主 chrome | 受影响端**只重截图** → `probe <end>` | **~2 分钟/端** |
| **文本语义级** | 折行点、省略号、裁切、缩进、字面 `\n` | 编译器 / 宿主文本绘制 | 受影响端**全链**（构建+装机+截图）→ `probe` → 子代理 | ~10 分钟/端 |
| **内核级**（测量/布局契约） | 文本高/宽与 Web 不符、不折行 | `layout-core-rust` / 宿主测量 | 全部端 + `test:coupled` | ~30 分钟+ |

> 判据：改的东西**影响不影响其他端**。只改一个端就只重跑那个端——不要习惯性全端重跑。

---

## 3. 已验证的坑清单（照着避）

**工具**
- `sips` **不做图片拼接**（只缩放/转换）⇒ 并排图用 `ffmpeg hstack`（已封装）
- `ffmpeg crop=w:1` 在部分尺寸下报 "Error reinitializing filters" ⇒ 取 2 行读首行（已封装）
- `wechatide simulator_screenshot` 前必须 `open_project_window`（否则静默 `mcp_business_fail`）

**语义（本轮真缺陷，都会重现）**
- **★★页面级滚动锁定：页根 `overflow-y: hidden` ⇒ 整页不滚**（2026-10-08 用户点名「昨天 overflow 族没验证长页面 hidden 是否真锁滚」）：
  · **Web 真值（逐值实测）**：落在**固定高根**（height:100vh）+ `overflow-y:hidden` ⇒ 不滚（scrollY 恒 0）；
    落在**内容高根**（min-height:100vh）+ hidden ⇒ **照样滚**（根不形成滚动容器）。
  · **App 端曾真缺陷**：三端宿主算页面滚动范围**只看内容高、忽略页根 overflow** ⇒ 声明了 `overflow-y:hidden`
    的长页面**照样能滚**（真机实测：页根加 hidden 仍 `range=20`）。修：**页根 `overflowY:hidden` ⇒ 滚动范围置 0**
    （App「页面滚动」=整树滚动 ⇒ 页根 overflow 即页面滚动开关；三端同改）。
  · ★**验收纪律**：这类「页面级行为」页**内容必须用静态高块**（非 `v-for`）——App 屏内容是静态结构，
    `v-for` 不展开（实测只折 1 行 ⇒ 无真溢出、测不出锁滚）。
- **缺省值必须查 Web 标准**：`white-space` 缺省 = `normal`（可折行），不是 nowrap——
  实现成 nowrap 会让未声明该属性的文本在 App 端被裁（本轮鸿蒙副标题「寻址」丢失的根因）。
  ★同源纪律：**任何 CSS 特性的缺省值/继承性/初始值，动手前先查 Web 真值**。
- **壳容器不得声明页面观感属性**（背景/前景）：scoped 规则特异性高于页面类 ⇒ 会覆盖页面底色
  （本轮 Web 基准 `.page{background:transparent}` 压掉 `.cc-page` 的 bg 的根因）。
- **页根要显式 `width:100%`**：App 内核按 fit-content 解析无宽度声明的块 ⇒ 卡片右边界错位。
- **★靠 flex 两轴对齐的容器必须显式 `display:flex`**（2026-10-06 justify-self 项用户抓出）：
  `<view>` 在 Web 侧默认 **block**（`align-items`/`justify-content` 对 block 无效 ⇒ 子内容贴左上），
  而 App/Skyline 的 `<view>` 默认 **flex**（两键生效 ⇒ 居中）⇒ 不声明会让五端「容器内对齐」不一致。
  ★同源纪律（与"缺省值必须查 Web 标准"一致）：**凡依赖非缺省 `display` 的布局，先确认各端默认 display 是否一致**——
  `<view>`/`div` 的 block↔flex 默认分歧是本仓跨端差异的一个常见源。
- **★★★`flex-direction` 的初值 = `row`（2026-10-08 · 框架级归一，决策 #579）**：CSS 里 flex 容器的 `flex-direction` **初值是 `row`**；
  而 App 内核只有 flex、无 block 流 ⇒ 未声明 `display` 的节点被当 **`column`**（block-like 近似）。
  ⇒ 开发者按 **Web 标准**写 `display:flex; justify-content:center`（期望**水平**居中），若引擎不补 row 就会**竖直**居中——
  必须在 App 补 `flex-direction:row`（=**胶水对齐代码**，违背"开发者不感知多端差异"原则）。
  ★**已修**：编译器**级联后归一**——`display===flex` 且未显式写 `flex-direction` ⇒ 补 `row`（两路径：`vapor/template.ts`
  的 `normalizeFlexDirection` + CSE `compute.ts`）；未声明 display 的保持 column（不破坏块级堆叠）；grid 不补。
  ★同源纪律：**规则里声明了 flex 布局能力（display:flex）却没写方向时，必须按 CSS 初值补 row**——这是"缺省值必须查 Web 标准"在 flex 轴上的实例。
- **★★★文本「测量」与「绘制」必须用同一断词/换行策略（2026-10-08 鸿蒙真机抓出）**：
  鸿蒙 `OH_Drawing` 的**默认断词类型**会在**数字/字母边界**断开（`"1fr"` → `"1"`/`"fr"`），
  即便整词放得进盒也折行。**测量侧**（`measureTextWrappedTypoPx`）与**绘制侧**（`drawChannelsAndText`）各有自己的 typography 配置 ⇒
  两处都按默认断词 ⇒ 文本节点被算成**2 行高（98px）**而字形只占 1 行（49px）⇒ 表现为**顶对齐（不垂直居中）**。
  修：**两处都显式设** `WORD_BREAK_TYPE_NORMAL`（非 break-all 分支）。★同源纪律：**一行文本的"量"与"画"必须同源**
  ——测量与绘制若各自配置（字号/字距/断词/行高/对齐），任一处不同步 ⇒ 盒高错 ⇒ 对齐/裁切/命中全偏。
  ★**同一纪律的通用形态**：本仓 Android `mkCmd`（绘制）vs `remeasure`（测量）也是"两处消费同一语义"——改一处必核另一处。
- **★★★解析 CSS 值优先用**引擎官方解析器**，别手写（2026-10-08 grid 轨迹升级）**：`layout-core-rust` 早期手写 `parse_grid_tracks`（只认 `fr`/`px`）——
  结果语料 22 处 `minmax()` / `repeat(auto-fill,…)` **整条被丢弃**（真实 grid 在 App 端消失）。
  ⇒ 启用 taffy 的 `parse` feature（仅引 cssparser），改用 **官方 `GridTemplateComponent::from_str` / `TrackSizingFunction::from_str`**
  ——一行拿到 minmax/fr/px/%/auto/min-content + repeat 的正确语义。★**踩坑**：taffy 只认**带单位的 0**（`0px`）
  ⇒ 解析前把**独立数值 0** 改写为 `0px`（CSS `minmax(0, 1fr)` 是最高频写法）；且组件级解析器只吃**单个组件**，整串要先**paren-aware 切分**。
  ★同源纪律：**引擎/库已提供的官方解析器 > 手写子集**——手写省事的代价是"验收端与语料脱节"（手写只覆盖想象到的形态）。
- **★★★折叠面"只做了数字这一类"⇒ 语义类（span/auto/命名）整类被静默丢弃（2026-10-08 grid 轨道项）**：
  `grid-row: span 2`（案例 D 卡跨 2 行）在 App 三端**整条丢失** ⇒ 卡片 y 位置错（`parseGridLine` 只认纯数字线号 `1` / `1 / 3`，
  `span` 值 ⇒ null ⇒ 诊断跳过**不落字段**）；而 **Web/MP 透传原生关键字**（浏览器/Skyline 原生支持 span）⇒ 只有 App 端错。
  ★**判据（先查产物，别猜）**：编译 `dist/app/<端>/screen-content.json` 看该子项**有没有 `gridRow` 字段**——没有即折叠面丢了。
  ★修法：IR 加 `span` 维度（`GridLine{start?,end?,span?}`）+ 内核 `GridPlacement::Span`（**引擎本就支持——是折叠面挡在门外**）。
  ★同源纪律：**一个 CSS 属性的取值常有"数字/关键字/函数"多个语义类——折叠面必须逐类处理**，
  只做"数字"这一类 ⇒ 其余类**静默丢弃**（不报错、只在 App 端看上去"没生效"）。
  同类前科：grid 轨迹（只认 fr/px、丢 minmax）/ justify-self（漏登记）——**"折叠面覆盖不完整"是本项最多发的 App 端偏差源**。
  ★第二个同源纪律：**"Web 对 ≠ App 对"**——Web/MP 把 CSS 原样交给浏览器/小程序引擎（关键字全支持），
  而 App 走**自研折叠链**（每类值都要我们显式接）⇒ 多端一致性问题先问「这条链**每端各自**怎么走」。
- **★★App/MP 文本引擎「长词默认断开」——Web `word-break: normal` 的"任其溢出"不可表达**（2026-10-06 word-break 项实锤）：
  Android `StaticLayout` / iOS CoreText / 鸿蒙 Typography / Skyline 的**自然行为**都是"长不可断词按盒宽折断"
  （= 相当于 `break-all`）；而 Web `normal` 是"词边界断、超长词整体溢出"。
  ⇒ 长串在五端：`break-all`（= 语料 7× 的值）**一致折行**；`normal` 则 **App/MP 折行、Web 溢出**（具名引擎边界）。
  ★同源纪律：**凡涉及"文本是否折断/溢出"的特性（word-break / overflow-wrap / hyphens），
  先假设 App/MP 默认即断词，再逐端核对**——Web 的"不折断"类语义在这些端往往不可表达。
- **★★★`-webkit-line-clamp` 的宿主多行截断：测量与绘制两处必须**同源封顶**，且验收页不能用 `align-items:flex-start`（2026-10-08 line-clamp 项）**：
  `-webkit-line-clamp` 在 Web/MP 由浏览器/Skyline 原生消费（三件套使能），**App 端是新能力**——三端宿主各自实现：
  Android `StaticLayout.setMaxLines(N)+setEllipsize(END)`（**绘制** `drawTextMultiline[Offset]` 与**测量** `applyWrapRemeasure` 两处同款）·
  iOS 适配器 `truncateToLines`（CTFramesetter 找可见行 → 自建截断串；CATextLayer **无 numberOfLines**）+ `measureTextWrapped(maxLines)` ·
  鸿蒙 `OH_Drawing_SetTypographyTextMaxLines + EllipsisModal(TAIL)`（测量侧同样 `min(自然行数, clamp)` 封顶）。
  ★★同源纪律第二次实例（与 word-break 同）：**测量封顶必须 = 绘制截断**，否则盒高（N 行）与墨迹（全段）打架。
  ★★**验收页布局坑**：截断宿主盒用 `display:flex; flex-direction:column` 时**不可写** `align-items:flex-start`——
  那会让文本子项取 **max-content 宽**（= 单行不折行，Android 端实测：整段冲出盒外，与 Web 的"块级子项按容器宽折行"不符）；
  应**用缺省 align-items（stretch）** ⇒ 文本子项宽 = 容器内宽 ⇒ 正确折行（与 Web flex 同名同义）。
  ★同源纪律：**列向 flex 容器里要"按容器宽折行"的文本块，交叉轴必须 stretch**（flex-start 会退化成 max-content）。

- **★MP 截图到达判据：`automation_runtime_info` 现须显式 `--action`（2026-10-08 修）**：
  缺 `--action` 时该工具返 `INPUT_ERROR`（此前可无参调用）⇒ 旧探针 `grep "currentPage 名"` **永不命中** ⇒ 每页白等 30s 超时后才截图。
  改 `--action currentPage` 并按 **`"route": "/pages/<name>"`** 判到达。★同源：**外部 CLI 的参数契约会演进**——探针命中不了先查工具自身用法（`-h`），别默认页面没到。
- **★★★CSS 数学函数 `min()/max()/clamp()` 常量化只在「全参数可绝对化」时成立（2026-10-08 数学函数项）**：
  `clamp(MIN,VAL,MAX) = max(MIN, min(VAL, MAX))`。全参数为**编译期绝对长度**（`<n>px`/裸 0/`calc(...)`/嵌套数学）⇒ 可折单 px；
  含 `%`/`vw`/`vh`/`em`/unitless ⇒ 浏览器在 **used-value 阶段**按容器/视口求解，编译期**无上下文**（本仓 App/MP 的相对长度模型是**运行时 ratio**）⇒ **不折**（诊断，不静默近似）。
  ★**两路径必须同口径**：CSE（`computeLength`/`resolveWinner`）与 App 折叠面（`numOf`/`parseLineHeight`）若一处折、一处不折 ⇒ App/Web 分叉。
  ★★踩坑：`resolveWinner` 里**先做了 `foldCalc`**（`calc(N op M)` 常量化）——`min(calc(...),X)` 含 `calc(` 但非纯 calc ⇒ 被判 UNSUPPORTED。**数学函数必须在校验前拦截**（先折数学，再折 calc）。
  ★同源纪律：**"编译期可求"的判据是"有没有上下文"**——`calc`/`min`/`max`/`clamp` 同阶段；相对单位（%/vw/em）一律留运行时（本仓 ratio 通道）。
- **★★★宿主长度字段的"物理化"必须覆盖**字符串 token**（不止数值字段）——`lineHeight` 曾漏（2026-10-08 用户抓出「安卓 view 不随内容自动增高」）**：
  Android `VaporRenderHost.physicalizeSpec` 有 `LEN_SCALARS`（数值长度字段清单，×density）——但 **`lineHeight` 是字符串 token**（``"20px"`` / 无单位 ``"1.5"``），
  不在该清单 ⇒ 字号已 ×density（42）而行高仍留在**逻辑**空间（20）⇒ 文本节点**测量高度只有真实的 1/density** ⇒ 内核盒被算小、`<view>` 不随内容增高、文字溢出盒外。
  ★判据（实测）：`WRAPMEAS` 打点 5 行 × 20 = 100px（应 ≈300）；iOS 几何是**逻辑点**（无需换算）、鸿蒙 `lineHeightDesignPx` 显式 ×density ⇒ **三端仅 Android 有此缺口**。
  ★修法：与 grid 轨迹串同轴——把 token 里每个 `<n>px` 乘 `lengthScale`（无单位倍数不含 px ⇒ 不动，其高度随 fontSize 自然物理）。
  ★同源纪律：**"新增长度字段必须登记"这条纪律要覆盖两种形态**——数值字段（`LEN_SCALARS`）**和**字符串长度 token（grid/background/lineHeight 的 `scalePxInCssLengths` 分支）。只登记前者 ⇒ 字符串 token 静默留逻辑空间。

- **★★★CATextLayer 对多行文本忽略段落 `line-height`（`minimum/maximumLineHeight`）——需走 CoreText（2026-10-08 用户抓出「iOS 行高比其他端矮」）**：
  真机 + 本机复现：CATextLayer 渲染多行文本时**恒用字体自然行高**，显式 `\n`、`CTParagraphStyle`、`lineSpacing`、"textLayerString 建 NSAttributedString + NSMutableParagraphStyle.min/maximumLineHeight"
  **全不生效**；而 `boundingRect(with: NSPS)` **计算**却遵守 ⇒ 宿主"量得对、画得不对"（盒高对、行距小）。
  ★修法：新增 `CATextLayer` 子类，重写 `draw(in:)` 用 **CoreText `CTFrameDraw`** 渲染（本机实测 pitch 精确 = 声明值）；**仅**"多行 + 声明 line-height"形态启用（其余走原生，零行为变化）。
  ★★踩坑：CALayer 的 `draw(in:)` 上下文是 **y 向下**（CA 坐标系）⇒ `CTFrameDraw` 前需 `ctx.translateBy(0, h); ctx.scaleBy(1, -1)` 翻转——**不翻则整段镜像**（真机实测；而在**独立 CGContext** 上恰好相反，不能照搬现成结论）。
  ★同源纪律：**"量"与"画"用同一个引擎才可能一致**——iOS 文本的测量走 CoreText（`boundingRect`），绘制却走 CATextLayer，两者对行高的处理不同 ⇒ 声明行高时必然分叉。
- **★★★闭合路径上的周期图案（dotted/dashed）必须让周期整除周长（2026-10-08 outline/border 圆角跟随批）**：
  dash 间距固定为 `2·线宽` 时，若它不整除环的周长，起点/终点处会**多出一个间距过近的点**
  （三端独立评审逐像素都抓到：Android/鸿蒙 = 两个点间距 0.55× 正常值（"双点"）；iOS = 两圆**融合成一个
  2× 面积的大点**；而 Web 均匀）。**修法**：周期 = 周长/N（N = round(周长/目标间距)）——
  周长按圆角矩形解析式 `2(W+H) − 8r + 2πr`（r 钳到 min(W,H)/2）。三端同源（Android/iOS/鸿蒙 evenDashPeriod）。
  ★**判据**：凡在**闭合轮廓**上画周期图案，先算周长、再均分——不要用"目标间距"直接当 dash 周期。
  ★本缺陷**人眼在整图上看不出**（要放大 + 逐点量间距）——**只有像素探针/子代理能抓**：这也说明
  "机械判据"必须能覆盖到"接缝重影"这类局部缺陷（探针的 blob 面积比 / 最近邻间距两栏是有效的）。
- **★★宿主对象名用 `split("-")` 承载多字段 ⇒ 负号会被吞（2026-10-08 独立评审抓出 iOS outline-offset 失效）**：
  iOS 轮廓子层名 `proteus-outline-<宽>-<线型>-<offset>` 用 `name.split("-")` 解析——
  ① 读到 `parts[3]`（线型码）当 offset（**索引错位**）；② 负 offset 的 `--3` 被 split **合并**成 `3`
  ⇒ 丢符号（实测：案例 D「offset -3 内缩」画成和案例 A「+2 外扩」**一模一样**——环宽 420=420）。
  **修法**：符号编进**无连字符令牌**（`op2` 或 `om3`），或改用 JSON/结构化传递。
  ★同源纪律：**凡是拼在 name/id 里用分隔符承载多字段的，解析端必须先确认分隔符不会出现在字段值里**
  （负号、小数点的 `.`、路径里的 `/` 都是同类坑）。
- **★★★App 宿主的「结构化绘制对象」里的长度也必须逐个物理化（2026-10-08 text-shadow 真机抓出）**：
  Android `physicalizeSpec` 的 `LEN_SCALARS`（扁平数值键表）**只缩扁平键**；
  `boxShadow`/`glow`/`textShadow` 是**嵌套对象** ⇒ 必须在 `physicalizeSpec` 里**另行逐个缩**。
  漏登记 `textShadow` ⇒ dx/dy/blur 停在 CSS 逻辑 px（约物理的 1/density）⇒ 安卓「**投影太轻 / 光晕太小**」
  （字号已 ×density ⇒ 相对字号显得小 ~3 倍；Web/iOS/鸿蒙正确）。★同源纪律：**新加一个"结构化长度对象"字段，
  必须同时登记进 physicalizeSpec 的嵌套缩放入口**（与 LEN_SCALARS 是同一张"新字段必须来登记"的表，只是分扁平/嵌套两层）。
- **★★★子代理并排图必须**等宽**（2026-10-08 text-shadow 复评漏判的教训）**：`side-by-side` 按**等高**缩放拼接——
  两端原图宽比不同时，右半（App 1200px）比左半（Web 780px）**宽** ⇒ 字形看起来更大、投影/光晕"看起来"成比例，
  **实际强度差异被掩盖**（round2 把"安卓投影太轻/光晕太小"判成 PASS，用户当场纠正）。⇒ 视觉评审要**按同一倍率（等宽）**比对，
  强度类缺陷要**量**（光晕像素面积/半径），不能只看拼图"感觉差不多"。★探针（blob 面积/边缘色）也测不到"强度"——这类**必须靠等宽并排 + 量值**。
- **整像素取整宁多勿少**：`(int32_t)` 截断丢 1px（鸿蒙右缘缝）；画布 `ceil`、视口钳到精确宽。
- **模块级常量会静默失效**：ESM 只求值一次 ⇒ 按环境/参数变化的白名单要**函数内求值**。
- **两处消费同一语义必须同步**：如「wrap 判据」在 `mkCmd`（绘制）与 `remeasure`（测量）各一份 ⇒
  改一处必漏另一处——优先抽成单函数。
- **★宿主侧样式字段的完整消费链是「三处」，缺一处即静默偏差**：① **白名单透传**（iOS `styleOf`
  是建层必经之路——漏透传则该字段根本到不了宿主）② **注入/存储**（`injectRadiusCorners` → map）
  ③ **每个绘制分支各自消费**——★同一个字段可能有**多条绘制路径**（如圆角：**填充**走
  `drawPathCorners`、**边框描边**走 uniform 分支，是两条！）。实证（2026-10-05，子代理逐角剖面
  拟合抓出）：`borderRadiusCorners` 在 iOS 连①都没有（机制建了 3 个月**从未生效**）；Android
  ②③只接了填充、描边没接 ⇒ 声明「仅 TL/BR 圆」的盒描边画成**四角全圆**。
  ★同源：`LEN_SCALARS`（DPR 换算登记表）与 `styleOf` 白名单都是"**新字段必须来登记**"的表——
  加字段时顺着「透传 → 存储 → **每条绘制分支**」走一遍，别只看主路径。

**流程**
- 一条命令内**不并行**跑两件写同一产物的事（构建 APK vs 验证）。
- 改宿主代码先跑零设备编译检查（`check:android-host-compile` / `check-selfdraw-compile.sh`）再上真机。

---

## 4. 判据口径（探针 4 条 + 子代理清单）

**探针（机器、1.5s、`probe` 子命令）**
| 判据 | 抓什么 |
|---|---|
| `darkEdges` | 页面区四边深色占比（黑块/深色线/系统栏遮挡） |
| `edgeColor` | 边缘主色 ≈ Web 边缘主色（白带/白框） |
| `seam` | 最右 2 列深色占比（右缘 1px 缝） |
| `cardMargins` | 卡片行左右边距存在且对称（贴边/失衡） |

各端 chrome（系统/模拟器装饰）在 `CHROME` 常量里显式声明跳过，并在输出中如实注明。

**★探针自身也要做破坏性验证**（首版实测假绿）：注入「底部白带 / 右缘黑条」后跑
`probe` 必须**rc=1**；正常图 **rc=0**。已知教训：主色量化过粗（`>>3`）会把
「白 255 vs 页底 244」压到阈值边缘 ⇒ 假绿——量化用 `>>1`（现版）。改探针后**必跑**
这两条注入用例（`ffmpeg drawbox` 注入 + 还原）。

**耗时台账**：跑器每次运行自动追加 `css-conformance/results/timings.jsonl`
（`{cmd, ms, rc}`）——下一项结束时可直接回答"哪一步最贵"（`cat results/timings.jsonl`）。

**子代理（一次；文本语义级）**：折行点数/断点、省略号有无、裁切形态、缩进保留、字面转义、
文字内容完整性。要求其输出结构化 JSON（`verdict` + `caseIssues[severity,status]`），
可直接喂 `css-acceptance-record.mjs`。

### ★★交子代理前的两道硬门（2026-10-05 用户点名「子代理成本昂贵，不能随便启用」后固化）

1. **`node scripts/css-conformance.mjs fresh`（新鲜度门禁）**：逐张断言"截图 mtime ≥
   页面源 / 该端宿主源 / 该端构建产物"。**stale（旧图）≠ 可评审**——实测踩过两次：
   ① 鸿蒙图不是 css-conformance 应用的产物；② Android/iOS 图含已删除的案例段（只重截了鸿蒙）。
   旧图交子代理 = 白烧一整轮（≥10 分钟）。`side-by-side` 已内置该门禁（stale 直接拒绝生成）。
2. **AI 自检画面**（看一眼每端新图：版本正确、无残留段、案例齐全）——机器判门后仍要做，
   这是"人对图"的最后一眼，不是审美判断。
3. **判据边界——UA-defined 项不判 fail，但★要升级成"自定标准"**：dashed/dotted 的**节距与点形**
   不受 CSS 规范控制（CSS Backgrounds 3 原文："There is no control over the spacing of the dots
   and dashes, nor over the length of the dashes."；Chrome 节距不是跨实现真值）。
   ★★**用户 2026-10-05 立的标准**（决策 #559）：「如果 CSS 标准里面没有规定的我们可以自己定标准，
   点状边框就统一为圆点吧」——**UA 自由区不是"各端随便"**，而是：
   · 有 Web 真值可对的（如 dashed {3w,2w} 取 Chrome 实测）⇒ 照 Web 对齐；
   · **规范文字/主流端都指向同一实现的（如 dotted = W3C 原文 "round dots"、MP/鸿蒙均圆点）
     ⇒ 定为项目标准，自研宿主照改**（Android ROUND cap + 零长段 / iOS lineCap .round）；
   · 唯有"被引擎锁死改不动"的（MP Skyline 内建节距）才具名登记。
   ★纪律：碰到未定义项，**先问"主流端怎么做"再拍板**（别停在"具名"就收工）；定下来的标准
   写进本条（PLAYBOOK）与决策，作为后续项的统一判据。语义层（线型出现 / 颜色宽度 / 角部行为）
   永远对齐 Web；差异项按上述三级处理。**

**★已定项目标准清单（未定义区的自定取值）**
| 项 | 标准 | 依据 |
|---|---|---|
| dotted 点形/落点 | **圆点（直径 = 线宽）+ 圆点网格**：首末点圆心距端 **w/2（贴边，圆缘=盒边）**、中段等距 step=(len−w)/round((len−w)/2w)；**不画封角块** | W3C 原文 "round dots"；mp/鸿蒙引擎均贴边单圆点（决策 #559 + 修复轮） |
| dotted 实现纪律 | ★**不得用 ROUND-cap 虚线**（cap 圆头以线段端点为圆心外伸 w/2 ⇒ 端点外溢盒外 + 与封角块叠成合并斑块——实测 bbox 超盒 1.3-1.7 CSS px）| 第 3 次独立复评逐像素 profile 抓出（决策 #559 ⑧） |
| dashed 节距 | {3w, 2w}（封角块 + 中线虚线，BUTT cap） | Chrome 实测真值（有真值可对 ⇒ 照 Web） |

**★截图链路的"构建断点"纪律（2026-10-06 overflow 项实锤，独立复评用 md5 抓出）**
- 现象：global.css 修好后只跑了 `build-batch`（bundle 更新），**没跑 `build-and-run.sh --no-install`**
  （APK 未重打包）⇒ 装的还是旧包 ⇒ 截图与修复前逐像素一致。**`cp` 刷新 mtime 还能骗过 `fresh`**。
- 操作（每次重截前按其核一遍——三端各有断点）：
  · Android：`build-batch`（bundle）→ **`build-and-run.sh --no-install`（APK）** → install → 截图；
    进包凭据 = `unzip -p <apk> assets/bundle-superapp.js | md5` == `assets/bundle-superapp.js` md5。
  · iOS：`build-app-stack`（bundle）→ **`run-selfdraw.sh` 会重编译 .app**（含 bundle 拷贝）→ drive；
    凭据 = `.app/bundle-superapp.js` mtime ≥ 构建时刻。
  · 鸿蒙：**`build-rust-core.sh`（Rust 核——独立脚本！）→ `build-host-app.sh`（HAP）** → install；
    凭据 = HAP mtime ≥ 核 .a mtime；★`gen-fixtures` 的生成调用**必须显式传 `PROTEUS_APP_PROJECT`**
    （继承不可靠——缺省 superapp 会覆盖 rawfile）。
- ★**fresh 门禁的已知弱点**（独立复评指出，待整改）：按 mtime 判定 ⇒ `cp` 重拷旧图可绕过。
  下一轮实施：截图时记录「源产物 md5 + 图文件 md5」台账，fresh 改为比对台账指纹。

**★宿主侧的「静默漏登记」两处实锤（2026-10-06 justify-self 项，逐像素量测才抓到）**
- **a) 宿主键白名单漏项 = 内核静默用默认**：Android 自绘宿主 `VaporRenderHost.LAYOUT_KEYS` 是
  **白名单**（新内核字段不得把绘制属性静默塞进去）；但**漏登记**某个内核消费键 ⇒ 请求树不带它 ⇒
  内核静默用默认值（无报错、无日志）。本轮 `justifySelf` 就是漏登记 ⇒ 真机 center/end 全落 start
  （而内核/Web 都正确）。
  ★★**纪律升级（不再靠注释）**：新增门禁 `pnpm check:host-kernel-keys`——从内核 `style_from_dto`
  **推出**消费键，断言宿主白名单覆盖（或 `EXCUSED` 显式豁免）；**改内核字段/宿主白名单后必跑**。
  历史同类（都栽在白名单）：clipPath/glow/mask（2026-10-01/03）· borderRadiusCorners（iOS styleOf）·
  justifySelf + 批次 41 的 gridColumn/gridRow（2026-10-06）· **gridAutoFlow（2026-10-08 · grid-auto-flow 项）——
  本轮由 `check:host-kernel-keys` 门禁**在**上真机前**当场抓出，未再真机白跑**（门禁价值实证）。
- **b) 宿主物理化的「长度」必须连字符串里的 px 一起缩**：Android 宿主把数值长度乘密度（×density），
  但 `gridTemplateColumns: "240px"` 是**字符串**（不在数值白名单）⇒ track 未缩 ⇒ 子项（宽已缩）
  **恰好填满 track** ⇒ `justify-self` 无对齐空间（Web 端逻辑单位无此问题）。修法：物理化时把
  grid 轨迹串里的 `<n>px` 也乘密度。
  ★**判据**：`justify-self` 类**依赖"项 < 轨道"有空间**的特性，在密度≠1 的端必须确认 track 也缩放了。
- ★**排查心法（本轮有效顺序）**：真机现象与预期不符时，**先用宿主探针读内核返回值**（本轮在
  `mount` 后打 `readRects` 的 x）——一步就把"内核 bug"与"宿主转发/物理化 bug"分开
  （实测：内核返回三值相同 ⇒ 锁定宿主侧，而非 taffy）。别从现象直接猜内核。

---

## 5. 收尾（每项做完）

```bash
pnpm run test:coupled                 # 内核改动配套断言（~5s）
pnpm run check:android-host-compile   # 改了 hosts/android 才跑
bash hosts/ios/check-selfdraw-compile.sh
PROTEUS_ALLOW_FULL_SUITE=1 npx vitest run --exclude "tests/e2e-*.test.ts"   # 收尾一次全量
git add -A && git commit && git push  # 提交 ≠ 交付
```
