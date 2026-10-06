# Proteus 内置组件体系重评估方案

> 代号 **Koine**（κοινή，"共同语"——希腊化时代统一希腊世界的通用语）。**定名前须做正式商标与包名检索。**
> 版本 v1 · 关联：**Proteus UI**（OS 级组件库，代号 Charites——本方案与它定位正交）、Themis（G-61）、`mp-spec-coverage`（官方规格标尺）、`compiler/tags.ts`、`built-in-components`
> **核心判断前置：引擎没有乱，是词汇没有立法。** 三种词形（HTML 标签 / 小程序标签 / p-\*）在引擎里各自有通路且全部可用——缺的不是支持，是**一张写明"什么场合用哪种词形、两种词形是否等价"的契约**。

---

## §0 结论摘要（30 秒读完）

| 问题 | 结论 |
|---|---|
| 内置组件层的定位（与 Proteus UI 的区别） | **Koine = 平台词汇层（契约）**：与小程序官方 84 组件对齐、写明每枚的三端通路与降级，追求"完备 + 可对拍"；**Proteus UI = 设计语言层（品质）**：追求美、无障碍、token。Koine 管"说得通"，Proteus UI 管"说得漂亮" |
| examples 与 css-conformance 为什么"体系不一样" | 两者写的是**同一语义的两种词形**：examples 混用三种（`<text>`×290 + `<div>`×195 + `<p-text>`×92），css-conformance 几乎纯 MP 词形（`<text>`×196 + `<view>`×193 + `<div>`×2）——引擎都支持，但**没有等价性门禁**证明它们同义 |
| 立法建议 | **一套语义、两套词形**：SSOT = PRIMITIVE_CATALOG（187 条）；HTML 词形 = 业务推荐写法（编译器 `TAG_MAP` 已实现），MP 词形 = 对齐/测试语言；**新增词形等价门禁**——`<div>` 与 `<view>` 必须产出**逐字节相同的 IR** |
| 要落地哪些 | 以官方标尺清账：84 组件中 covered 51 确权、planned 6 排期、gap 3 棘轮清零、private 14 收敛宿主桥、na 9 维持；**核心 30 项**立"内置基准集"（§5），每项五列契约（HTML 词形/MP 标签/Web shim/App 引擎通路/对拍） |
| 最大发现 | 官方规格快照（84 组件 + 495 API）+ 五箱分类 + gap 棘轮**已经存在**（`mp-spec-coverage.ts`，自证反复的教训已修）——本方案不新造标尺，只把"组件词形契约"接到这把已有的尺子上 |

---

## §1 命名

**Koine**（κοινή ἡ διάλεκτος，"共同的语言"）——希腊化时代让操各地方言的希腊世界共享同一书面语的通用语。内置组件层正是框架的**共同语**：业务开发者写 HTML、对齐测试写 MP 标签、组件库写 p-\*——三种角色，同一套语义契约。查重：同领域未见占用（零星小项目不在前端/跨端领域）；与既有万神殿（Proteus/Morpheus/Themis/Hephaestus/Charites/Keryx/Mnemosyne/Janus）不冲突。备选无需——本层是"语"不是"神"，破例用语言学名词反而准确标示它的定位差异。

---

## §2 现状诊断：三种词形并存，引擎三面支持，唯独没有契约

### 2.1 三种词形在两个工程里的真实分布

| 工程 | MP 标签词形 | HTML 词形 | p-\* 词形 | 特征 |
|---|---|---|---|---|
| **examples** | `<text>`×290 · `<view>`×226 · `<button>`×151 | `<div>`×195 · `<span>`×23 | `<p-text>`×92 · `<p-button>`×37 · … | **三种词形混用**（同一页面内并存） |
| **css-conformance** | `<text>`×196 · `<view>`×193 | `<div>`×2 | —（刻意不用） | **几乎纯 MP 词形**（对齐测试的合理选择，但与文档教的 HTML 面脱节） |

### 2.2 引擎侧的三面支持（都做了，且各有来头）

| 支持面 | 实现 | 证据 |
|---|---|---|
| **HTML 词形 → MP 标签** | `TAG_MAP` 全量映射表（div→view、span→text、img→image……含外部实战补的 details/summary/table/select 等逃生舱修复） | `packages/compiler/src/tags.ts` |
| **MP 原生标签的 Web 端模拟** | 13 个 shim（view/text/image/button/input/textarea/picker/slider/switch/progress/icon/navigator/scroll-view，1,094 行）——含大量真机级 bug 修复沉淀（open-type kebab 兼容、布尔三态、按下态挂载点） | `packages/built-in-components/src/components/` |
| **官方规格标尺** | 84 组件 + 495 API 逐项五箱分类（covered 51 / planned 6 / private 14 / na 9 / gap 3），gap 有棘轮预算，"矩阵不登记即 100%"的自证教训已修 | `packages/component-ir/src/mp-spec-coverage.ts`、`docs/generated/miniprogram-official-spec.json` |

### 2.3 诊断结论

- **引擎层不乱**：三条通路各有职责（词形映射 / 端模拟 / 规格标尺），质量意外地高（shim 里的真机修复注释密度极高）；
- **乱在词汇契约**：① 没有任何文档/门禁规定"业务该写哪种词形"⇒ examples 三种混用；② **没有等价性证明**——`<div>` 与 `<view>`、`<p-text>` 与 `<text>` 是否产出相同 IR，全靠实现者自觉；③ Web shim 的 13 个与官方 84 之间没有显式的"这 13 个是核心集"的立法地位。

---

## §3 定位判定：三层栈，各司其职

```
┌─────────────────────────────────────────────────────┐
│  Proteus UI（设计语言层，代号 Charites）p-* 79 组件     │
│  追求：美 · token · 无障碍 · 动效 —— "说得漂亮"          │
├─────────────────────────────────────────────────────┤
│  Koine（平台词汇层）★本方案                             │
│  官方 84 组件语义契约 · HTML/MP 双词形 · 三端通路          │
│  追求：完备 · 等价 · 可对拍 —— "说得通"                  │
├─────────────────────────────────────────────────────┤
│  引擎层（Themis/StyleIR/svg_path/capabilities）        │
│  PRIMITIVE_CATALOG 187 条 = 全栈 SSOT                  │
└─────────────────────────────────────────────────────┘
（能力件 Hephaestus 与三层正交：相机/定位/扫码等原生能力）
```

**Koine 与 Charites 的分工铁律**：
- Koine 组件**不承载设计**——`<view>`/`<text>`/`<image>` 永远是"平台语义的裸词"，样式由开发者 CSS + Themis 门禁保证正确，视觉品质由上层 Charites 承担（这与小程序官方 `<button>` 和 WeUI 的关系同构）；
- Charites 组件**必须构建在 Koine 之上**——p-\* 不允许绕过词形层直接操作端私有标签（现状 `p-*` 与 `built-in` shim 双体系并存的根源正是缺这层约定）；
- 两层的**共享资产**只有一处：PRIMITIVE_CATALOG——三种词形（HTML/MP/p-\*）最终都落到目录条目上，audit 闭环是唯一的"同义"裁判。

---

## §4 立法建议：一套语义、两套词形

### 4.1 词形宪章（四条）

1. **业务代码推荐 HTML 词形**（`<div>/<span>/<img>/<button>`）——理由：`TAG_MAP` 已全量映射 + Web 端零转换 + 与 Vue 生态直觉一致（compiler 头注释"业务代码写标准 HTML 标签"是既定原则，本条只是把它**升格为立法**）；
2. **MP 词形是一等公民**（`<view>/<text>/<scroll-view>` 原样可用）——它是对齐测试、平台语义引用、迁移存量小程序代码的语言；
3. **两种词形必须同义**——新增**词形等价门禁**：`TAG_MAP` 每一条映射，两词形产出的 IR **逐字节相同**（接 IR Golden 管线，机制与 Node/Rust 双后端对拍同构）。这是"一套语义、两套词形"的安全带：等价有证明，混用才不是分叉；
4. **词形混用治理（存量）**：examples 风格守卫（`examples/style-guard.ts` 已存在，扩一条"同文件内 HTML 词形与 MP 词形混用 ⇒ warn"——允许单文件统一选形，禁止句内夹花）。

### 4.2 SSOT 归一

- `TAG_MAP`、`built-in-components` shim 清单、`PRIMITIVE_CATALOG` 三处**互相引用而非各自维护**：目录条目登记它的 HTML 词形、MP 标签、Web shim 位置、App 引擎通路——一处改，处处红；
- 官方规格快照（84+495）保持唯一标尺地位，Koine 不新造清单。

---

## §5 落地清单：核心 30 项内置基准集 + 官方标尺清账

### 5.1 官方标尺清账（不新造，只收账）

| 箱 | 数量 | 动作 |
|---|---|---|
| covered | 51 | **确权**：逐项补登记 Koine 契约五列（现状只有"covered"一个词，缺通路细节） |
| planned | 6 | 排期收编（随 Charites P0–P3 同批） |
| **gap** | **3** | **棘轮清零**（预算只能降不能升——这是 Koine 的第一张工单） |
| private | 14 | 收敛 `useMiniProgram`/宿主桥（既有归口，不动） |
| na | 9 | 维持分类 |

### 5.2 核心 30 项内置基准集（"框架保证三端语义"的最小集合）

| 族 | 组件（MP 词形） | 备注 |
|---|---|---|
| 容器/视图（7） | view / scroll-view / swiper / movable-area·view / cover-view / match-media | scroll-view 与 Charites ScrollKernel 的对齐面已定 |
| 文本（2） | text / rich-text | rich-text 是 p-rich-text 的地基 |
| 媒体（4） | image / video / camera / canvas | App 通路走内核（image 渲染计划 / svg_path / camera 能力件） |
| 表单（8) | input / textarea / button / checkbox(-group) / radio(-group) / switch / slider / picker | Web shim 已有 8/8 的地基，缺口在契约登记与对拍 |
| 导航（3） | navigator / navigation-bar / tabbar 语义 | 与 p-nav 族分层：Koine 管语义，Charites 管视觉 |
| 交互/反馈（6） | icon / progress / label / form / keyboard-accessory / editor（planned） | icon 即 Keryx 渲染器的对齐面 |

**每项五列契约**（登记进 PRIMITIVE_CATALOG 条目）：HTML 词形 ｜ MP 标签 ｜ Web shim（有无+位置）｜ App 引擎通路（引擎字段/能力件/内核模块）｜ 对拍状态（Themis 三层）。核心 30 项 = "框架敢承诺三端语义完备"的边界——**基准集之外不是不支持，是"支持但按规格标尺如实标注覆盖状态"**。

---

## §6 分期

| 期 | 内容 | 判据 |
|---|---|---|
| **K0 立法** | 词形宪章入文档 + **词形等价门禁**（TAG_MAP 全量对拍 IR 逐字节）+ 三处清单归一（TAG_MAP/shim/目录互相引用） | 等价门禁进 CI；现状映射若有不等价项→修复或显式登记 allow-differences |
| **K1 清账** | gap 3 清零 + covered 51 逐项补五列契约 + 核心 30 项基准集表格落地 | gap 棘轮归零；30 项每项有完整契约行 |
| **K2 治理** | examples 混用治理（style-guard 扩展）+ 文档站"词形指南"页 + css-conformance 与文档面互认（对齐工程测的词形 = 文档教的词形） | examples 新增代码零句内夹花（存量钉棘轮） |
| **K3 收编** | planned 6 随 Charites 分期落地；private 14 桥接审计 | mp-spec-coverage 分类随验收更新 |

---

## §7 验收标准

1. **词形等价**：TAG_MAP 每条映射双词形 IR 逐字节相同（新门禁，接 IR Golden）；
2. **规格标尺**：gap 棘轮只能降；每季度快照更新后未归类项即 CI 红（既有机制，Koine 顺着用）；
3. **核心 30 项三端对拍**：每项过 Themis 判据①②（样式/几何）；交互件加事件语义对拍；
4. **shim 质量红线**：Web shim 的真机级修复沉淀（kebab/布尔三态/按下态）作为"契约注释"范式推广——五列契约里的坑位必须写明；
5. **文档-对齐互认**：文档站词形指南与 css-conformance 测试面同源（引用同一份清单生成）。

---

## §8 不做清单（诚实边界）

- **不废弃任何一种词形**——三词形都是一等公民，治理的是"无意识混用"不是"多词形存在"；
- **不给 Koine 组件做设计**——任何"把 view 做得好看"的冲动都属于 Charites（p-view 已存在，别在 `<view>` 里长样式）；
- **不新造规格清单**——84+495 官方标尺是唯一尺子，Koine 只接尺子不造尺子；
- **不一次性重写 13 个 shim**——它们携带大量真机修复沉淀，重写 = 重交学费（Hephaestus 对账教训同源）；只做契约登记 + 增量修复。

---

## §9 证据索引（每条可 grep）

| 本文表述 | 证据 |
|---|---|
| examples 三词形混用（290/226/151 + 195/23 + 92/37…） | `find examples -name "*.vue" \| xargs grep -hoE "<(text\|view\|div\|p-…)"` 统计（2026-10-07 实测） |
| css-conformance 几乎纯 MP 词形（196/193/2） | 同法（2026-10-07 实测） |
| TAG_MAP 全量 HTML→MP 映射 + 逃生舱修复 | `packages/compiler/src/tags.ts` 头注释与映射表 |
| 13 shim / 1,094 行 / 真机修复沉淀 | `packages/built-in-components/src/components/*.ts` 行数与注释 |
| 官方标尺 84 组件 + 495 API / 五箱分类 51-6-14-9-3 / gap 棘轮 | `packages/component-ir/src/mp-spec-coverage.ts`、`docs/generated/miniprogram-official-spec.json` |
| PRIMITIVE_CATALOG 187 条 SSOT | `packages/component-ir/src/primitives.ts` |
| examples 风格守卫已存在（K2 扩展点） | `examples/style-guard.ts` |
| 词形等价机制先例（IR Golden 逐字节对拍） | `docs/proteus-css-engine-plan/README.md` §4 B0 |
| Charites 分工 / ScrollKernel 对齐面 | `docs/Proteus_OS级组件库方案.md` §3、§5 |

---

> **Koine**——方言可以共存，语义必须同源：`<div>` 与 `<view>` 写的是同一个词，框架拿得出逐字节的证明。
