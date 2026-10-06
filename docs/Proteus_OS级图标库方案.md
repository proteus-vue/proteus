# Proteus OS 级图标库方案

> 代号 **Keryx**（κῆρυξ，传令官——图标是设计系统向用户传令的使者）。备选：Angelia（信使女神）、Semeion（σημεῖον，符号）。**定名前须做正式商标与包名检索。**
> 版本 v1 · 关联：**Proteus UI**（OS 级组件库，内部代号 Charites——本方案是它的"方言层"）、Themis（G-61）、Morpheus（strokeProgress 画线动画）、`p-svg-canvas`（G-62 Canvas 通道）、内核 `svg_path.rs`
> 验收标准：沿用 Charites OS 级四判定 + Hephaestus 超级应用口径。

---

## §0 结论摘要（30 秒读完）

| 问题 | 结论 |
|---|---|
| 为什么必须有图标库 | Charites 八大能力里唯一的"视觉词汇"没有真源：**同一个 `<icon>`，三端三种实现**——p-icon 用 unicode 字形（✓★♥⌕）、Web 端手绘 SVG 仿微信（字面 hex）、App 端另有 `svg_path` 内核通路却无图标集 |
| 核心架构决策 | **图标即数据（SVG path 单一真源），不是字体**——内核 `svg_path.rs` 已做单一解析（M/L/C/Q/Z 归一化 + 弧长 + 路径变形 + FFI），Web/MP/App 三条渲染通路全部现成，缺的只是一套图标集和一条构建管线 |
| 与 emoji/unicode 字形的关系 | **淘汰关系**：unicode 字形跨端字体依赖、可渲染成 tofu、无法保证视觉一致——与"KAGS 拒绝 emoji 风格图标"同一纪律，本方案给出淘汰棘轮 |
| 与 Charites 的关系 | Charites 宪法的第一个"方言"：token 着色（禁字面 hex）、A11y 必填（aria-label 门禁）、原语目录登记、treeshake 内联零运行时请求 |
| 规模分期 | P0 起步 **24 个**（覆盖 Charites 组件自用）→ P1 **96** → P2 **200+**；命名进 PRIMITIVE_CATALOG 审计闭环 |

---

## §1 命名

### 1.1 命名逻辑

图标库的神职是**传令**：组件有话要说，图标是把语义送达用户的使者。 Hermes 是希腊神话里的传令神，但已被 JS 引擎占用（Morpheus 方案 §1.3 裁定）；本仓命名体系取 Hermes 职能的另一个名字——**Keryx**（κῆρυξ，传令官）。发音 /ˈkɛrɪks/，单音节尾，短、可寻址。

### 1.2 候选与查重结论

| 候选 | 语义 | 查重结果 | 评估 |
|---|---|---|---|
| 🥇 **Keryx** | 传令官（Hermes 的信使职能承担者）；图标 = 设计系统的传令官 | ⚠️ 零星占用（Keryx 离线包管理器，未维护项目；**均不在同领域**） | **推荐**。职能最贴、发音短 |
| 🥈 **Angelia** | 信使女神（Ἀγγελία） | ✅ 未见同领域占用 | 干净但生僻，且易读作 "Angela" |
| 🥉 **Semeion** | σημεῖον，"符号/记号"——图标语义的字面命中 | ✅ 未发现占用 | 非神名破例；希腊语原词学者味重 |

### 1.3 必须排除的名字

| 名字 | 排除原因 |
|---|---|
| ~~**Iris**~~ | **本仓已裁定排除**（Morpheus 方案 §1.3：iris-engine 是 Rust + Vue 3 动画引擎，领域高度重合）——本方案同为 Rust + Vue3 语境，撞名风险加倍 |
| ~~**Hermes**~~ | JS 引擎重名（既有裁定） |
| ~~**Nike**~~ | 商标强占用 |
| ~~**Logos**~~ | Logos Bible Software 强占用 + 泛词不可寻址（虽与 logo 双关诱人） |

**主推 `Keryx`，备选 `Angelia`。** 下文统一以 **Keryx** 指代。

---

## §2 现状诊断：一个 `<icon>`，三套实现，全部违宪

| 实现 | 现状 | 违宪点 | 证据 |
|---|---|---|---|
| `p-icon`（components 包） | **unicode 字形表**：`success:'✓' star:'★' heart:'♥' search:'⌕'`，约 18 个字形，注释自述"扩展走 slot/字体图标后续批次" | ① 字形渲染**依赖端上字体**——`⌕`/`◷` 在部分 Android 字体下渲染成 tofu ② 视觉无法对拍（字体不同=像素不同）③ **正是"emoji 风格图标"反模式**（KAGS UI 纪律明确拒绝） | `packages/components/p-icon/index.vue` GLYPHS 表 |
| `built-in-components/icon.ts`（Web shim） | 手绘 SVG path 仿微信图标集（彩色圆底 + 毛笔对勾），约 12 个 | ① **字面 hex**（`#09BB07` 微信绿硬编码）——Charites OS-1 裸值禁令的直接违例 ② 第二套图标视觉体系，与 p-icon 语义同名不同形 | `packages/built-in-components/src/components/icon.ts` |
| `p-svg` / `p-svg-canvas` | 底层矢量通路：path d 渲染（Web-first）/ SVG→离屏 Canvas 引擎（G-62，Path2D 缓存 + rAF） | 不是图标库（无语义集、无命名、无着色规范），但**证明管线可用** | `packages/components/p-svg-canvas/engine.ts` |
| App 内核 | **`svg_path.rs`：内核单一解析**——`d` 归一化为绝对段序列（M/L/C/Q/Z）+ 每段弧长（画线动画前提）+ 路径变形（`svg_path_to`）+ FFI；宿主只翻译成 CGPath / android.graphics.Path | 不缺引擎，缺图标集 | `packages/layout-core-rust/src/svg_path.rs`、`ffi.rs:212-239` |

> **一句话诊断**：渲染通路三端齐备、却**没有一套图标**——于是 p-icon 退回 unicode 字形、Web 端手绘仿制。缺的不是技术，是**词汇表的立法**。

---

## §3 定位：Charites 宪法的"方言层"

图标是组件的词汇——Charites 四条 OS 判定在图标上的投影：

| Charites 判定 | Keryx 投影 |
|---|---|
| OS-1 设计语言成法 | 图标**全部来自一套 path 数据**：`@proteus-vue/icons` 单一包，组件源码零内联 path（现状 built-in icon.ts 的手绘 path 即违例形态） |
| OS-2 品质默认项 | 着色走 token（`currentColor` → `--sa-*`）、`aria-label` 必填（装饰图标显式 `aria-hidden`）、光学网格对齐 |
| OS-3 一致性可证明 | 三端渲染同一份 path 数据——App 端归一化段序列在**内核唯一解析**（`svg_path.rs` 的"为什么在内核"注释即是本判定）；对拍 = path 归一化一致 + 截图并排 |
| OS-4 平台融合 | stroke 图标天然接 Morpheus `strokeProgress`（内核弧长已备）；彩色/duotone 图标走 token 双色 |

---

## §4 关键架构决策：图标即数据，不是字体

**为什么不用 icon font**（三条，全部有仓内证据）：

1. **字体基础设施本仓明确不自建**——Themis/CSE 诚实边界写明"不自研文本基础设施（字体/BiDi/RTL/OpenType，Profile L4）"；icon font 恰好踩在放弃区里。
2. **内核已经解析 SVG path**——`svg_path.rs` 的单一实现纪律（"Swift 与 Java 各写一份解析器就会分叉"）直接适用于图标；icon font 则引入**第二套字形渲染路径**（各端字体渲染器分叉——与 emoji/unicode 问题同构）。
3. **Path2D 引擎已在 MP 端验证**——`p-svg-canvas` 实证 `createPath2D(svgD)` + rAF 可用（含真机 workaround），复杂图标（动画/多路径）有兜底通路。

**结论：图标的单一真源 = SVG path 数据（`d` + `viewBox` + 语义名 + 可选双色槽），编译期内联进 IR，零运行时请求、零字体依赖。**

---

## §5 架构：一条构建管线 + 三条渲染通路

```
源 SVG（设计工具导出）
   │  ① 归一化（构建期）
   │    · A/S/T 命令 → C/Q 转换（★内核 svg_path.rs 明确拒绝 A/S/T——
   │      转换器在本包实现，正好补上内核"消息给修法"的工具端）
   │    · 网格对齐 24×24 · 数值去噪 · stroke→fill 决策
   ▼
@proteus-vue/icons   —— 语义名 → { d, viewBox, 类别, 双色槽? }
   │  ② 编译期：treeshake（按需）→ 内联进组件 IR（零运行时请求）
   ▼
┌─────────────────────┬──────────────────────┬────────────────────┐
│ Web                  │ 小程序/Skyline        │ App（Rust 内核）     │
│ 内联 <svg><path>     │ Path2D + 离屏 canvas  │ 内核 svg_path 归一化 │
│ （现 p-svg 通路）     │ （G-62 引擎已实证）    │ → CGPath / Path     │
└─────────────────────┴──────────────────────┴────────────────────┘
p-icon 重写 = Keryx 渲染器（保留 name/type 官方别名 API——p-icon 既有调用方零迁移）
```

**分层职责**：
- `@proteus-vue/icons`：**数据包**（path 集 + 元数据 + 转换器），无渲染逻辑；
- `p-icon`：**唯一渲染组件**（三端分流已由组件层承担），API 沿用 `name/size/color/spin` + 官方 `type` 别名（向后兼容）；
- `p-svg-canvas`：**动画兜底**（SMIL 级复杂图标动画，G-62 通路），静态图标不走它（避免 toDataURL 开销）。

---

## §6 图标集设计规范（词汇表的"宪法"）

| 维度 | 规范 |
|---|---|
| 网格 | 24×24 基准网格 + 光学修正（圆形图标溢出 0.5px 网格——HIG/Material 惯例，落进转换器自动校验） |
| 描边 | 线性图标 stroke 双档：**1.5px**（默认）/ **2px**（强调态）——端上不可写第三档（lint） |
| 双体系 | **outline**（线性，默认）与 **filled**（填充，选中/激活态）成对发布——命名 `search` / `search-filled` |
| 彩色 | 状态彩色图标（success/warn/error）**只允许 token 引用**（`--sa-ok` 等）——禁止 hex（现状 built-in icon.ts 的 `#09BB07` 即反面教材） |
| 双色槽 | duotone 图标两个 fill 槽绑定 `--sa-brand` / `--sa-brand-soft`——品牌定制的图标侧出口 |
| 类别 | action / communication / media / status / file / navigation / form——每枚登记类别，供目录页与 treeshake 分析 |
| 命名 | kebab-case 语义名（`chevron-right` 非 `arrow3`）；官方小程序 `type` 别名表保留（`success/cancel/clear…`） |

**规模分期**：
- **P0 · 24 枚**：Charites 组件自用闭环（chevron×4 / close / check / error / info / warn / search / loading / star / heart / eye / plus / minus / more / share / delete…）——组件库先"吃自己的狗粮"；
- **P1 · 96 枚**：覆盖六类别常用面 + filled 对（48×2）；
- **P2 · 200+**：业务高频面 + duotone 槽 + 品牌定制流程。

---

## §7 与三大引擎的接线

- **Charites（宪法）**：图标着色禁字面值（CHARITES-001 lint 覆盖 path 属性）；`aria-label` 门禁（交互图标缺语义名 ⇒ E，装饰图标须显式 `aria-hidden`）；新图标先登记 `PRIMITIVE_CATALOG` 语义键（audit 闭环扩展）。
- **Themis（一致性）**：图标几何对拍 = **path 归一化一致性**（三端消费同一份归一化数据，App 端由内核保证）+ 每图标截图并排（Web 基准）；深色模式截图成对留证。
- **Morpheus（动效）**：线性图标接 `strokeProgress`（内核弧长已实现）——下载/加载/成功打勾等"画线"图标动效走声明，零手写 keyframes；`spin` 沿用现有 view 盒旋转（真机修复已沉淀）。

---

## §8 分期

| 期 | 内容 | 判据 |
|---|---|---|
| **P0 立词** | 转换器（A/S/T→C/Q、网格校验）+ `@proteus-vue/icons` 数据包 + 24 枚起步集 + p-icon 重写为 Keryx 渲染器（API 兼容） | 24 枚三端截图并排；p-icon 既有调用零迁移（`name`/`type` 全通） |
| **P1 收口** | built-in Web 手绘集**淘汰**（对齐面改用 Keryx 渲染同一数据——消灭第二套视觉体系）；unicode GLYPHS 表标记 deprecated（warn 棘轮）；96 枚 | Web shim 与主组件**同源同形**；GLYPHS 命中即 warn |
| **P2 品质** | strokeProgress 画线动效接入 Morpheus；duotone 双色槽；200+ 枚；品牌定制流程（token → 图标双色） | 画线动效真机 62fps（Path2D 引擎既有实测口径）；duotone 深浅两套截图 |
| **P3 生态** | 图标目录页（类别/搜索/复制）+ 业务自定义集接入同一转换器（企业图标进宪法而非绕过宪法） | 自定义集过同一 lint/门禁 |

---

## §9 验收标准（OS 级四判定 + 超级应用口径）

1. **三端同源**：每图标三端截图与 Web 基准并排；path 归一化在内核单一实现（禁宿主第二解析器——`svg_path.rs` 既有纪律）。
2. **真机矩阵**：多品牌多版本真机（含 Android 低端字体环境——**tofu 零容忍**：path 渲染不依赖端上字体，结构上排除）。
3. **静态失败必有单测**：未知 `name` → 显式占位 + dev 警告（沿用 p-icon "未知 → '?'" 语义但不复用 unicode 字形）。
4. **A11y 门禁**：缺 `aria-label`/未标 `aria-hidden` ⇒ 编译期 E。
5. **裸值门禁**：图标数据与组件源码零字面 hex（CHARITES-001 棘轮）。
6. **弧长精度**：内核折线近似误差 ~1e-3 相对量（`svg_path.rs` 既有口径）——画线动效视觉不可辨为验收线。
7. **允许差异显式登记**（`allow-differences.json` 追加）：如 Skyline 下 Path2D 兜底通路的帧率差。

---

## §10 不做清单（诚实边界）

- **不自建字体基础设施**（icon font 路线整体排除——CSE L4 既有边界）；
- **不做位图/emoji 图标**（与 KAGS "拒绝 emoji 风格图标"同一纪律的框架层落实）；
- **不做图标编辑器/设计工具**——源 SVG 由设计工具导出，本方案只管"入库合规"；
- **v1 不承诺**：A/S/T 原生支持（内核明确拒绝——转换器转 C/Q 是唯一路径）、SMIL 全语义动画（`p-svg-canvas` 诚实边界：回传 18ms/次，仅限 ≤512px + 30fps 场景）、彩色图标全量 duotone（P2 起）。

---

## §11 证据索引（每条可 grep）

| 本文表述 | 证据 |
|---|---|
| p-icon unicode 字形表 / ~18 枚 / 未知→'?' | `packages/components/p-icon/index.vue` GLYPHS |
| Web shim 手绘 SVG 仿微信 / 字面 `#09BB07` | `packages/built-in-components/src/components/icon.ts` |
| 内核单一 path 解析 / 弧长 / 路径变形 / FFI | `packages/layout-core-rust/src/svg_path.rs`、`ffi.rs:212-239` |
| A/S/T 明确拒绝（转换器工具端缺口） | `svg_path.rs` 头注释"诚实边界" |
| MP 端 Path2D 可用（含真机 workaround）/ 62fps / toDataURL 2ms / 回传 18ms | `packages/components/p-svg-canvas/engine.ts`、`path-parser.ts` 头注释 |
| p-svg Web-first / fill=currentColor | `packages/components/p-svg/index.vue` |
| 宪法四判定 / 裸值 lint / A11y 门禁 | `docs/Proteus_OS级组件库方案.md` §4、§8 |
| 字体基础设施不自建（icon font 排除依据） | `docs/proteus-css-engine-plan/README.md` §7"诚实边界" |
| 超级应用验收 / 真机矩阵 / 数字不粉饰 | `docs/Proteus_高频原生能力组件方案.md` 头部 |
| Iris 排除先例 | `docs/Proteus_声明式动画引擎Morpheus方案.md` §1.3 |

---

> **Keryx**——每个图标都是一句被精确传达到三端的话：同一份 path，同一个像素，同一种语气。
