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
- **缺省值必须查 Web 标准**：`white-space` 缺省 = `normal`（可折行），不是 nowrap——
  实现成 nowrap 会让未声明该属性的文本在 App 端被裁（本轮鸿蒙副标题「寻址」丢失的根因）。
  ★同源纪律：**任何 CSS 特性的缺省值/继承性/初始值，动手前先查 Web 真值**。
- **壳容器不得声明页面观感属性**（背景/前景）：scoped 规则特异性高于页面类 ⇒ 会覆盖页面底色
  （本轮 Web 基准 `.page{background:transparent}` 压掉 `.cc-page` 的 bg 的根因）。
- **页根要显式 `width:100%`**：App 内核按 fit-content 解析无宽度声明的块 ⇒ 卡片右边界错位。
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

---

## 5. 收尾（每项做完）

```bash
pnpm run test:coupled                 # 内核改动配套断言（~5s）
pnpm run check:android-host-compile   # 改了 hosts/android 才跑
bash hosts/ios/check-selfdraw-compile.sh
PROTEUS_ALLOW_FULL_SUITE=1 npx vitest run --exclude "tests/e2e-*.test.ts"   # 收尾一次全量
git add -A && git commit && git push  # 提交 ≠ 交付
```
