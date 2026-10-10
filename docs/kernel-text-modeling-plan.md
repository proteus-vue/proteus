# 内核文本建模补齐方案（v1）

> 类型：plan（`layout-core-rust` 文本建模族 + 分批）
> 触发：用户 2026-10-10「我看我们的内核还有尚未落地的，先把内核补齐」→ 方向选定「内核文本建模（换行/空白）」
> 关联：`packages/layout-core-rust/src/{engine,taffy_engine,node,style,ffi}.rs` · `docs/vapor-vue-alignment-plan.md`（B3 余项）· `docs/proteus-superapp-css-expansion-plan.md`（F3 排版族）
> 状态：**立项（含一处对本仓既有论断的更正，见 §1）**

---

## 0. 结论先行

**① 一处更正（必须先说清）**：本仓多份文档（含决策 #757）把 `whiteSpace`/`wordBreak`/`lineClamp` 记作
「App 文本是**单行模型**、属内核缺口」。**取证后此论断不成立**——**换行/空白/断词/截断三端宿主都已实现**：

| 端 | 实现（证据） |
|---|---|
| Android | `ProteusTextPlatform.measureWrapped` + `VaporRenderHost.applyWrapRemeasure`（`whiteSpace` nowrap/pre、`wordBreak` break-all/break-word、`lineClamp`） |
| iOS | `SelfDrawView.isWrapStyle` / `effectiveWrap`（CoreText `byWordWrapping`）+ `lineClamp` 预截断 |
| 鸿蒙 | `proteus_bench.cpp` wrap 测量（`WORD_BREAK_TYPE_NORMAL` 同语义） |

内核通过**注入的 `TextMeasurer`**（`engine.rs`）收**已折行**的尺寸——文本度量按设计**平台注入**（文本是唯一无法平台无关的一块，方案 §5.2）。

**② 内核文本上真正的缺口只有两条**（都在内核这一层，非宿主重复）：
- **基线（baseline）度量缺失**：内核 `<text>` 叶子只有 `{text, style_key}`，**无基线** ⇒
  `align-items/align-self/align-content: baseline` 在编译器白名单里、内核也映射到 taffy `BASELINE`，
  但叶子基线恒缺失 ⇒ **"允许了但算错"（静默偏差）**；`vertical-align`（文本基线对齐）**全链路零处理**。
- **文本策略未进内核树**：内核 `LStyle`/`NodeDto` **无** `white_space`/`word_break`/`line_clamp`/`text_align`
  ⇒ 内核树不是文本策略 SSOT；**动态 `:class` 改这些字段无内核通道**（B3 余项的真因——**不是"内核缺字段"，
  而是"这些是宿主消费字段、动态类没有回灌宿主的通道"**）。

**③ 因此本方案的定位是**：把文本建模的**内核那一半**补齐（**基线 + 文本策略 SSOT**），
让内核树承担「文本需要什么」的声明，宿主承担「怎么画」。**不重做换行**（已实现）。

---

## 1. 现状取证（对齐清单口径）

- **内核文本模型**：`LNode.text: Option<TextMeasureRequest{ text, style_key }>`（`node.rs`）。`style_key` = 字体签名哈希，**不含** white-space/word-break/line-clamp 维度。
- **度量契约**：`TextMeasurer::measure(&LNode, &str, max_width) -> Size`（`engine.rs`）——**已传 `max_width`**，返回折行后尺寸。**无基线出参**。
- **度量缓存键**：`(text_hash, max_width)`（`taffy_engine.rs`）——`text_hash = 文本 ⊕ style_key`。**white-space 等策略未进键**（同文案同字体同宽、策略不同的两节点会**错误共用缓存项**——潜在正确性缺口，见 §2 B-T3）。
- **编译期**：`APP_LAYOUT_FIELDS` 含 `whiteSpace`/`wordBreak`/`lineClamp`；宿主读数（`spec.optString("whiteSpace")`）——**编译器发、宿主收**，内核不经手。
- **动态 `:class`**：这三字段走 `VAPOR_DYNCLASS_LAYOUT_UNSUPPORTED` 诊断（无内核通道）。
- **`vertical-align`**：编译期/kernel/宿主**全无**（连诊断都无——静默丢弃）。

---

## 2. 分批设计

> 通用判据：① 契约（内核结构 + FFI DTO）② 编译期（App 折叠 + 动态类通道）③ 内核实现 ④ 三端宿主 ⑤ 真机 + 独立终评。
> 铁律不变：**Web 为基准**；端侧缺口就地补齐（不得以"别批次未落地"跳过端）。

### B-T1 · 内核**基线度量**（`align-items: baseline` 正确化 + `vertical-align` 地基）
**★spike 结果（2026-10-10，已取证）**：taffy 0.14 的 `compute_leaf_layout` 度量回调**只返回 `Size<f32>`**
（`taffy-0.14.0/src/compute/leaf.rs:24`），且叶子节点基线恒为 `Baselines::NONE`（`leaf.rs:105/177`）
⇒ **taffy 0.14 不支持"让度量回调提供基线"**。`baseline` 对齐在 flexbox 里对"无基线子项"回退到
**下边缘**语义（对盒子成立、对**文本错误**——文本基线是"顶部下来的 ascent"）。
⇒ **B-T1 形态修正**：内核必须在 **taffy 之外**做基线对齐：
  ① 首次布局（taffy 以 baseline≈下边缘近似）后，内核**后处理**：对 `align-items/self: baseline` 的
     flex 行，用各文本叶的**真实基线**重算交叉轴偏移；② `vertical-align`（文本叶内/行内）同批。
**内核**：`TextMeasurer::measure` 增出参或用 `measure_baseline(...) -> f32`（缺省 0 ⇒ 与旧行为等价）；
`LNode` 存 `baseline`；布局后处理消费。**FFI**：`rects` 出参附 `baseline`（仅文本叶）。
**编译期**：`align-items: baseline` 去诊断（现已映射但算错）；`vertical-align` 入集。
**宿主**：三端度量补基线（Android `Paint.FontMetrics.ascent` / iOS `CTFont` ascent / 鸿蒙字体 metrics）。
**验收**：一行内两不同字号文本 `align-items: baseline` ⇒ 基线对齐（Web 真值比对）；`vertical-align: middle` 生效。
**估时上修**：≈ 3–4 人日（taffy 不支持 ⇒ 需内核后处理 + 三端度量 + 真机）。

### B-T2 · 内核**文本策略 SSOT**（white_space/word_break/line_clamp/text_align 进内核树）
**内核**：`LStyle`（或 `TextMeasureRequest`）加 `text_align: Option<String>` + 文本策略（wrap/break/clamp 紧凑编码）；
`ffi.rs` 的 `NodeDto`/`StyleDto` 加对应字段 + 映射。**这是 B-T3 的前置**（内核要先"知道"策略，才能进缓存键）。
**编译期**：App 折叠路径把这三字段**同时**写进内核 DTO（SSOT）；**动态 `:class`**：复用 B3d 的 **`SET_STYLE_STR`**
字符串 op 通道（或新增文本策略 op）⇒ **闭合 B3 的"内核无文本字段"具名边界**。
**宿主**：宿主**改从内核树**读文本策略（单一来源）——或保留现状 + 动态类改由宿主通道回灌（spike 定，后者零宿主改动但 SSOT 仍在宿主）。
**验收**：动态 `:class` 切 `white-space`/`line-clamp` ⇒ 三端折行/截断随之变（判据扩展）。

### B-T3 · 度量缓存键修正（潜在正确性，依赖 B-T2）
**问题**：键 `(text_hash, max_width)`，`text_hash = 文本 ⊕ style_key`；若 `style_key` **不含** white-space/word-break/line-clamp
（现证 `style_key` 在编译期**无生产方** ⇒ 恒 0）⇒ 同文案同字体同宽、策略不同 ⇒ **错误命中同一缓存项**（后者取其尺寸）。
**修**：内核把文本策略并入 `style_key`（B-T2 落地后即可哈希）。**破坏性验证**：两节点同文案同宽、一 wrap 一 nowrap ⇒ 几何必须不同。

### B-T4（边界·不推进）
- **CSS 内联富文本**（`<span>` 分段字形 / `v-html`）：内核分段文本 + 宿主分段绘制——**独立大课题**，见能力清单 #11/#168。
- **文本换行本身**：已实现（宿主），**不在本方案**。

---

## 3. 建议顺序

1. **B-T1 基线度量**（`align-items: baseline` 静默偏差是"允许了但算错"，最高价值；`vertical-align` 的地基）。
2. **B-T2 文本策略 SSOT**（闭合 B3 动态类边界；复用 B3d 字符串 op 通道）。
3. **B-T3 缓存键修正**（随 B-T2 一并，破坏性验证）。

**估时**：B-T1 ≈ 2–3 人日（跨三端宿主 + spike taffy 基线）· B-T2 ≈ 2 人日 · B-T3 ≈ 0.5 人日。

---

## 4. 诚实边界

- 本方案**不声称**"App 文本单行"——**该论断已被取证推翻**（§0①）。若文档他处仍如此表述，逐处更正。
- `vertical-align` 的**行内多区间**语义（同一 `<text>` 内不同 vertical-align 的 run）不在本批——App 文本是**单串单样式**（内核单串 + 宿主单次 drawText）。
- taffy 0.14 的 measure 基线支持度**未核实**（B-T1 先 spike）。
