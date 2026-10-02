# Proteus · 多端一致性标准 §13 待核实项 —— 核实报告

> 依据：《Proteus_多端一致性标准方案.md》§13（5 项待核实 + §5.2 四条案例）
> 闸门原文：「上表 5 项**未核实前禁止进入官网/对外材料**；核实后逐项标注结论与来源。」
> 核实日期：2026-10-02 · 核实方式：官方文档 / 上游仓库 API / 本机复现（**每条标注权威性**）
> 去重说明：§13 的五项与 §5.2 的四案例**有重叠**（案例1≈项1、案例2≈项2、案例4⊂项1/项2 的时间线），
>   故本报告合并为 **7 个独立核实目标（A–G）**，逐条给结论。

---

## 0. 结论汇总（对外可引用的判定）

| # | 核实目标 | 结论 | 权威性 | 对外可用性 |
|---|---|---|---|---|
| **A** | Flutter 宋体事件（Skia `a918c0e`） | ✅ **完全属实，且比原文更严重**（5 个月未修 → 3.43 预发布才修） | 🔴 **极高**（Skia 提交 + Flutter 团队成员复现 + 用户版本矩阵） | ✅ **可作为核心论据**（含修复版本与时间线） |
| **B** | iOS 苹方两版对西文影响 | ◐ **部分属实**：苹方确有多版本（含地区变体），但"iOS 18 改版致西文 2/y 不同"**未找到权威来源** | 🟡 中（本机字体清单支持"多版本"，不支持"具体到西文 2/y"） | ⚠ **降级表述**（只讲"存在多版本"，不讲具体字形） |
| **C** | `TextLeadingDistribution` 平台默认不同（iOS proportional / Android even） | ❌ **证伪**：Flutter 官方文档明说 **默认 proportional**（两端一致），非"iOS/Android 不同" | 🔴 极高（Flutter 源码 + API 文档） | ❌ **必须删除/改写**（原表述错误，引用会翻车） |
| **D** | 各端引擎切换不同步（Skia/Impeller） | ✅ **属实**：iOS 已"只剩 Impeller"（渲染后端选择代码已删）；macOS 移除 Skia **仍在进行中**（2026-02 立项，未完成） | 🔴 极高（官方 issue + 发布说明 + 引擎文档） | ✅ **可用**（"不同步"有硬证据） |
| **E** | 密度桶 / @Nx 对"像素一致"的量化影响 | ✅ **官方口径确认**：Android 以 mdpi(160dpi) 为**基准**，各桶有明确倍率（0.75/1/1.5/2/3/4；xxxhdpi 无对应 dpi） | 🔴 极高（Android 官方文档） | ✅ 可用（作为"像素级比对必须锁设备"的依据） |
| **F** | 广色域（P3/sRGB）对同色值视觉差异 | ◐ **方向成立、量化缺口**：CSS Color 4 定义了 `display-p3` 色空间（官方）；但**"同色值在三端的视觉差异幅度"无公开量化** | 🟡 中（标准定义有，量化数据无） | ⚠ 只讲"色空间不同是差异来源"，**不给数字** |
| **G** | 转场插值曲线差异幅度 | ◐ **有基线、缺跨端量化**：Flutter Cupertino 转场 `kTransitionDuration = 500ms`（注释自承 "relatively rigorous eyeball estimation"）+ 曲线族（`linearToEaseOut` 等）可查；但"各端曲线差多少"无官方数据 | 🟡 中（基线可查，差异幅度需自测） | ⚠ 只讲"曲线族不同"，A-4 容差**保持 provisional** |

**闸门处置（本报告结论）**：
- ✅ **可解除**：A（需带修复版本）、D、E —— 三项证据充分，可直接进对外材料
- ⚠ **有条件使用**（降级表述）：B、F、G —— 只讲"存在差异/来源"，**不给具体数字或字形断言**
- ❌ **必须修正**：C —— 原文表述**错误**（默认其实一致），若照原样引用会被懂行者当场指出

---

## A · Flutter 宋体事件（Skia `a918c0e`）

### 结论：✅ 完全属实，且比标准文档原文**更严重**

**标准文档原文**：「Flutter 3.38 升级 Skia，commit `a918c0e` 重构了 `find_family_style_character` 的
字体 fallback 逻辑……导致 NotoSerifCJK 先于 SECCJK 被命中，中文被渲染成宋体。且**只影响三星 / OPPO /
OnePlus**，小米与模拟器不中。（权威性较低）」

### 核实到的完整链条（四重证据）

**① Skia 提交存在且机制吻合**（来源：`api.github.com/repos/google/skia/commits/a918c0e...`）

| 项 | 实测值 |
|---|---|
| SHA | `a918c0e08500c26ff2252f93e499400360034dd0` |
| 日期 | **2025-08-04** |
| 标题 | `Allow fallback to named fonts in SkFontmgr_android` |
| 文件 | `src/ports/SkFontMgr_android.cpp`（+34 −14） |
| 关键改动 | 空 `familyName` 时**跳过** `fFallbackFor` 检查，改为遍历 named fonts |
| 逃生口 | `SK_FONTMGR_ANDROID_IGNORE_FALLBACK_FIX`（用于 opt-out） |

★ 与原文描述的机制**逐点吻合**：原文说"当 familyName 为空时跳过 `fFallbackFor` 检查" ——
提交 diff 里正是 `- if (familyName != family->fFallbackFor)` → `+ if (!familyName.isEmpty())`。

**② Flutter 团队成员复现并精确定位**（来源：`flutter/flutter#178533` 评论）

`jason-simmons`（Flutter 团队，2026-02-05）原文：

> Reproduced this on a Samsung Galaxy A06. This started with a change made in
> `skia.googlesource.com/skia/+/a918c0e...`. The Samsung device has two CJK fonts:
> `NotoSerifCJK-Regular.ttc` (a serif font) / `SECCJK-Regular.ttc` (a sans serif font).
> After that Skia change `find_family_style_character` is returning the **serif** font instead of the
> **sans serif** font.

⇒ 原文的"NotoSerifCJK 先于 SECCJK"**被官方确认**，且给出了设备级的根因解释。

**③ 影响机型与"小米不中"也被确认**（同 issue 的用户报告）

| 报告人 | 设备 | OS | 中招版本 | 最后正常版本 |
|---|---|---|---|---|
| zhiye1995 | Samsung **S21** | Android 15 | 3.38.1 | — |
| timmy-gzw | **OnePlus 13T** | Android 16 (ColorOS 16) | 3.38.1 | 3.35.7 |
| aguowork | **OPPO X8** | Android 16 (ColorOS 16) | 3.38.3 | 3.35.7 |
| jason-simmons | Samsung **A06** | — | — | — |

⇒ 原文"只影响三星/OPPO/OnePlus"**与用户报告完全一致**；"小米与模拟器不中"也在首帖
（"It does not appear on the emulator or on Xiaomi and other devices"）中得到印证。

**④ 修复时间线（原文缺失的关键信息）**

| 日期 | 事件 |
|---|---|
| 2025-08-04 | Skia `a918c0e` 合入 |
| 2025-11-14 | `flutter/flutter#178533` 报告（Samsung S21） |
| 2026-02-05 | Flutter 团队复现并定位到该提交 |
| 2026-03-02 | `jason-simmons` 确认 Skia `2636871a` **修复**（A06 验证） |
| 2026-03-06 | 社区追问"何时进 stable、是否 cherry-pick" |
| **2026-05-08** | 用户版本矩阵：**3.38.1 ❌ / 3.38.10 ❌ / 3.41.9 ❌ / 3.42.0-0.4.pre ❌ / 3.43.0-0.3.pre ✅** |
| 2026-06-02 | issue 关闭（修复进入预发布通道） |
| 2026-07-14 | 线程自动锁定 |

⇒ **从引入（2025-08）到修复进预发布（2026-05）跨度约 9 个月**；原文说"3.38 升级 Skia"不够准确——
准确说法是 **"2025-08 的 Skia 提交经 engine roll 进入 Flutter 3.38，影响持续到 3.42，3.43 预发布修复"**。

### 对外表述建议（修正后）

> **被假定的一致性，一次底层字体 fallback 改动就崩**：2025-08 一个 Skia 提交（`a918c0e`）
> 让空 familyName 路径跳过 fallback 检查，导致**三星 / OPPO / OnePlus** 设备（**仅这些**，
> 小米与模拟器不中）的中文被渲染成宋体；**从 3.38 持续到 3.42（约 9 个月）**，
> 直到 3.43 预发布才修复。**受影响用户只能自己发现、自己上报、自己降级**——
> 这正是"没有可验证一致性标准"的代价。

---

## B · iOS 苹方两版对西文（2 / y）的影响

### 结论：◐ 部分属实 —— "苹方存在多版本"确认；"iOS 18 改版导致西文 2/y 变化"**未核实到**

**标准文档原文（案例 2）**：「iOS 18 苹果改了苹方设计，系统里现在存在两套苹方
（"苹方"与"新苹方"）——同一份 Flutter 代码，西文的"2"和"y"在不同 iOS 版本上显示不同。（权威性中等）」

### 核实过程与结果

| 检索路径 | 结果 |
|---|---|
| 本机 macOS 系统字体清单（`system_profiler SPFontsDataType`） | ✅ **找到 `PingFangUI.ttc` 且含多个地区变体**（`PingFangMO-Ultralight` / 显示名 **"苹方-澳"** / 样式"极细体"） |
| Flutter issues 搜 `PingFang`（24 条） | ❌ **无"iOS 18 两版苹方致西文变化"** 的条目；最接近的是 #180113（CupertinoSystemText 在 fontFamilyFallback 被忽略）与 #179104（Flutter 中文字重比原生轻） |
| 通用搜索（Bing / DDG） | ❌ 无可引用来源（搜索结果与主题无关） |

★ **本机字体清单的发现（直接证据）**：macOS 的 `PingFangUI.ttc` **确实包含地区化变体**
（"苹方-澳" 等）——这支持"**苹方存在多版本**"这一半；但**不支持**"iOS 18 新增第二个版本"、
更不支持"西文 `2`/`y` 字形改变"这一具体断言。

### 处置（对标准文档）

| 断言 | 处置 |
|---|---|
| "系统里存在多套苹方（含地区变体）" | ✅ **保留**（本机字体清单直接证据） |
| "iOS 18 苹果改了苹方设计（第二版）" | ⚠ **降级为"未核实"**（标注：需 iOS 18/26 真机对比） |
| "西文 2 / y 在不同 iOS 版本显示不同" | ⚠ **降级为"未核实"**（无来源；且属字形细节，对外引用风险高） |

### 对外表述建议（降级后）

> **字体的版本与地区变体本身就是差异源**：系统字体并非单一实体——以苹方为例，同一字体族在
> 系统内即存在**多个地区化变体**（本机字体清单可直接验证）。这意味着"同一份代码"在不同
> 系统版本 / 地区配置下，字形选择本身就可能不同。（**不引用具体到某个字符的字形差异**。）

---

## C · `TextLeadingDistribution` 平台默认不同 —— ❌ **证伪**

### 结论：❌ 原文表述**错误**，必须修正

**标准文档原文（案例 3）**：「`TextLeadingDistribution` **iOS 默认 proportional、Android 默认 even**
→ 16sp 文本行高差 2px。（权威性中等）」

### 核实（Flutter 官方源码 + API 文档）

**① Flutter 引擎源码**（`flutter/engine` `lib/ui/text.dart`）：

```dart
/// All properties default to true (height modifications applied as normal).
const TextHeightBehavior({
  this.applyHeightToFirstAscent = true,
  this.applyHeightToLastDescent = true,
  this.leadingDistribution = TextLeadingDistribution.proportional,   // ← 默认值
});
```

**② Flutter 框架文档**（`packages/flutter/lib/src/painting/text_style.dart` 注释）：

> * Configuration 1: **The default**. `leadingDistribution` is set to
>   `TextLeadingDistribution.proportional`.

**③ API 文档**（`api.flutter.dev/flutter/dart-ui/TextLeadingDistribution.html`）：

> 该页**未提及** iOS / Android 的平台默认差异；只说明 `even` 是 CSS 的策略（half-leading）。

⇒ **三点一致**：`TextLeadingDistribution` 的默认值是 **`proportional`**（**与平台无关**），
不存在"iOS proportional / Android even"这回事。

### 正确的认知（替换原断言）

- `TextLeadingDistribution` 默认 **proportional**（两端相同——**不是**差异源）；
- 但 **`even` 是 CSS 的策略**（官方文档原话："This is the default strategy used by CSS"）
  ⇒ **真正有平台差异的是"Flutter 默认 vs CSS/浏览器默认"**（Flutter proportional vs CSS even），
  而不是"iOS vs Android"。
- ⇒ **这条恰好可以反用**：即使 Flutter 统一了默认值，它**与浏览器/CSS 的默认策略仍然不同**
  ——这才是 `leadingDistribution` 带给 Proteus 的真实启示（**必须显式声明，不能依赖默认**）。

### 对外表述建议（改写后）

> **连 Flutter 自己的默认值都说明了这个问题的本质**：Flutter 把行高分配默认统一为
> `proportional`，而 **CSS/浏览器的默认策略是 `even`（half-leading）**——
> 同一段文本在 Flutter 与 Web 上的行高分配规则**从默认值层面就不同**。
> **Proteus 的做法：不依赖任何默认值，把行高分配显式声明进快照格式**（见 VC3-b 的 `fontSize`/`lineHeight`）。

---

## D · 各端引擎切换不同步（Skia / Impeller 时间线）

### 结论：✅ 属实，且有**当前时点的硬证据**

**标准文档原文（案例 4）**：「Flutter 3.29 才在 iOS 移除 Skia、3.38 才在 Android 废弃 opt-out
——各端引擎切换本身就不同步。（权威性极高）」

### 核实结果

**① 官方文档口径**（`docs.flutter.dev/perf/impeller`，页面自述 "reflects Flutter 3.47"，更新于 2026-08-21）：

| 平台 | 官方原话 | 结论 |
|---|---|---|
| iOS | "Impeller is the **only supported rendering engine** on iOS with **no ability to switch to Skia**" | ✅ Skia 已移除 |
| Android | "Impeller is available and enabled by default on Android API 29+"；低版本/无 Vulkan "falls back to the legacy OpenGL renderer" | ◐ 仍是"默认+回退"，**非唯一** |
| macOS / Linux / Windows | "Impeller is available and enabled by default **as of Flutter 3.47**. In a future release, the ability to opt out of using Impeller will be removed." | ◐ **切换仍在进行** |
| Web | "Flutter on the web **currently uses Skia**" | ◐ 未切 |

**② 版本事实**：官方页明确 **3.27** = Impeller 成为 iOS + Android API 29+ 的默认；**3.47** = 桌面端默认。

**③ 移除动作的时间点**（GitHub issues，可查）

| 日期 | issue | 内容 |
|---|---|---|
| 2026-02-27 | `#183031`（open） | **Remove Skia from macOS**（umbrella issue）—— 仍在进行 |
| 2026-08-06 | `#190636`（closed，同日） | **iOS: Remove the IOSRenderingAPI selection code**——正文原话：<br>"Flutter iOS requires Metal. **Skia support has been removed.** Impeller has no software fallback." |
| 2026-08-05 | `#190590` / 2026-07-26 `#190041` | iOS 移除软件渲染回退 |

### 对原文的修正

原话说"Flutter 3.29 才在 iOS 移除 Skia、3.38 才在 Android 废弃 opt-out" —— **版本号需更新/更精确**：
- **3.27**：Impeller 双端（iOS + Android API29+）**成为默认**（官方口径）；
- **iOS 移除 Skia 的代码级证据在 2026-08-06 的 `#190636`**（删除了 `IOSRenderingAPI` 枚举与选择管道；
  正文明确 "Skia support has been removed"）；
- **桌面端（macOS）移 Skia 至 2026-02 才立项，至今未完成**。

⇒ **结论不变（"不同步"），但证据链更新为"iOS 唯一引擎 / Android 默认+回退 / 桌面进行中 / Web 仍用 Skia"
—— 这是 2026-08 时点的四平台不一致状态**。

### 对外表述建议

> **引擎切换从来不是同步的**：截至 2026-08，Flutter 的四个平台处在**四种不同状态**——
> iOS"只剩 Impeller，无法切回 Skia"、Android"默认 Impeller 但低端回退 OpenGL"、
> 桌面端"3.47 才默认，opt-out 待移除"、**Web 仍用 Skia**。
> ⇒ 一份 Flutter 代码在不同平台跑在**不同的渲染引擎**上，这正是"同一份代码 ≠ 同一份像素"的根源。

---

## E · 密度桶 / @Nx 对"像素一致"的量化影响

### 结论：✅ 官方口径确认（**这是 §8 观察模式"必须锁设备"的直接依据**）

**来源**：Android 官方 `developer.android.com/training/multiscreen/screendensities`

### 官方密度桶倍率表（原文引用）

| 限定符 | 说明 | 相对基准倍率 |
|---|---|---|
| `ldpi` | ~120 dpi | 0.75× |
| **`mdpi`** | **~160 dpi，原文 "This is the baseline density"** | **1.0×（基准）** |
| `hdpi` | ~240 dpi | 1.5× |
| `xhdpi` | ~320 dpi | 2.0× |
| `xxhdpi` | ~480 dpi | 3.0× |
| `xxxhdpi` | ~640 dpi（原文注："**uses** ~640 dpi"——是启动图标专用，非通用屏） | 4.0× |
| `nodpi` | "density-independent resources. The system **doesn't scale** resources tagged with this qualifier" | 不缩放 |

### 对"像素一致"的量化含义（本仓推导，需标注为推导）

- **同一 dp 值在不同桶上对应不同物理像素数**（1dp = 桶倍率 个 px，mdpi 基准）；
- ⇒ **"像素级比对"必须先锁定设备/密度桶**，否则比的是"物理像素"而代码写的是"逻辑像素"——
  这正是标准 §8.1「锁定设备、DPR、测试字体」的**官方依据**；
- iOS 侧 `@1x/@2x/@3x` 是同类机制（同一逻辑尺寸对应不同物理像素）。

★ **诚实边界**：本节确认的是**机制与倍率**（官方），**未做**"密度桶导致的像素差异量化实验"
（那需要真机截图对比，属 L4 观察模式的后续采样）。

---

## F · 广色域（P3 / sRGB）对同色值视觉差异

### 结论：◐ 方向成立（色空间定义有官方依据），**量化缺口**

| 检索路径 | 结果 |
|---|---|
| W3C **CSS Color 4** 规范 | ✅ 官方定义了 `display-p3` / `display-p3-linear` 等色空间（"10.4 The Predefined Display P3 Color Space"），**与 sRGB 并列为预设色空间** |
| Apple 官方（`developer.apple.com` 两条路径） | ❌ 均为 JS 渲染页，抓不到正文；HIG 颜色页亦无静态可读内容 |
| Flutter 仓库 | ❌ 未找到"同色值跨端视觉差异"的量化数据 |

### 可对外表述的部分（有依据）

> **同一色值在不同色空间下不是同一个颜色**：CSS Color 4 把 `display-p3` 与 `sRGB` 列为**并列的预设色空间**
> ——声明色空间不同，同一组 RGB 数值经色彩管理后**映射到不同的物理颜色**。
> 而各端（iOS 广色域屏 / Android 多厂商 / 浏览器）的默认色空间与色彩管理策略并不统一。

### 不可对外表述的部分（量化缺失）

❌ **不给**"P3 与 sRGB 下同色值差 ΔE = X"这类数字——无来源。
⇒ §2 差异来源 ④（光栅化/色彩空间）**保留为"来源之一"**，不升级为量化断言。

---

## G · 转场插值曲线差异幅度

### 结论：◐ 有基线可查，**跨端差异幅度仍需自测**（A-4 容差保持 provisional）

**查到的基线**（Flutter `packages/flutter/lib/src/cupertino/route.dart`）：

| 项 | 值 |
|---|---|
| Cupertino 页面转场时长 | `kTransitionDuration = Duration(milliseconds: 500)` |
| 该常量自注 | "**A relatively rigorous eyeball estimation**"（官方自承：目测估计） |
| 曲线族 | `Curves.linearToEaseOut` / `Curves.easeInToLinear` / `Curves.fastEaseInToSlowEaseOut` + 反向用 `.flipped` |
| 其它时长 | 350ms（barrier 相关）/ 335ms（offscreen 偏移）/ 250ms（sheet） |

### 对 A-4（转场插值中间态）的处置

- ✅ **确认 A-4 登记是对的**：曲线族存在、且**官方承认时长是"目测估计"** ⇒ 跨端插值必然不同；
- ⚠ **容差保持 `provisional: true`**：A-4 当前只登记"差异存在"（定性），**不给容差数值**——
  理由：本文档查到的都是**Flutter 侧**基线，**"Proteus 各端曲线差多少"无数据**（需真机采样）；
- ⇒ 与 `docs/consistency-tolerance.json` 中 `textMetrics.provisional` 同款纪律：**标定前不给数字**。

---

## 附：核实方法说明（可复现）

| 手段 | 用途 | 本报告中的证据 |
|---|---|---|
| **上游仓库 API**（GitHub REST） | 提交/issue/PR 原始数据 | Skia `a918c0e` diff；`#178533` 评论；`#183031` / `#190636` |
| **官方文档直取**（curl + 正文提取） | 版本时间线、密度桶、色空间 | `docs.flutter.dev/perf/impeller`；Android screendensities；W3C CSS Color 4 |
| **Flutter 源码**（raw.githubusercontent） | 默认值/常量的**唯一事实源** | `text.dart` 的 `leadingDistribution` 默认；`cupertino/route.dart` 的 500ms |
| **本机系统信息** | 字体版本/变体的直接证据 | macOS `PingFangUI.ttc` 含 "苹方-澳" 等变体 |

★ **诚实边界**：
1. §13 的**项 3（密度桶量化）与项 4（广色域量化）在"量化"意义上未完成**——
   本文档确认了**机制与官方口径**，**未做**真机像素采样（那属 L4 观察模式）；
2. **项 2（苹方西文）与项 5（转场曲线幅度）明确标注"未核实到量化数据"**——
   对外表述已相应降级（只讲来源，不给数字）；
3. 所有引用均带**日期与可复现入口**，便于第三方复核（"可验证的一致性"同样适用于本文档自身）。
