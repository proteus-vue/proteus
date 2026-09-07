# 平台语义对齐参考（glass-easel 官方 WXML 语义模型）

> **★#505 参考文档（2026-09-07）**：草案 `docs/compiler-ir-contract-draft.md` 的附录——CompileIR 的「平台侧语义真相」。
> 动机（用户定调）：**不再自己猜造小程序 IR 语义——微信官方开源了 glass-easel（新一代组件框架）及其
> template-compiler（Rust，WXML → 渲染代码），它就是平台对 WXML 语义模型的权威定义。**
> 我们的编译 IR 语义若与官方 parser 冲突，即为自造错误——引用官方标准可规避。
> 来源：`https://github.com/wechat-miniprogram/glass-easel`（核心 TS 包 + glass-easel-template-compiler Rust 包），
> 关键文件 `glass-easel-template-compiler/src/parse/tag.rs`（WXML 语义模型主体）。

> ⚠️ 注意边界：glass-easel 尚不是小程序可用的运行时（官方 FAQ：「no MiniProgram code can use any
> glass-easel submodules currently, checking interface stability」）；template-compiler/stylesheet-compiler
> 已属「MiniProgram compiler」一部分。因此本参考的用途是**语义模型对齐**（我们的产物应落在官方 parser
> 认识的形态内），不是运行时对接。我们的产物仍走微信开发者工具编译（WXML/JS 四件套）。

---

## 1. 官方 WXML 语义模型摘录（tag.rs）

### 1.1 节点分类（ElementKind）——TemplateIR 节点模型的平台参照

官方把 WXML 元素 parse 为以下分类（而非「标签 + 一堆属性」）：

| 官方 ElementKind | 含义 | 承载 |
|---|---|---|
| `Normal` | 普通元素 | tag_name + attributes + **class: ClassAttribute**（None/String/Multiple）+ **style: StyleAttribute** + change_attributes + worklet_attributes + children + generics + extra_attr + let_vars + common（id/slot/slot_value_refs/event_bindings/data/marks） |
| `Pure` | `<block>` 纯容器（不产节点） | children + let_vars + slot |
| `For` | `wx:for` **提升为独立节点** | list/item_name/index_name/key + children |
| `If` | `wx:if/elif/else` **合并为分支组** | branches: Vec<(cond, children)> + else_branch |
| `TemplateRef` | `<template is>` | target + data |
| `Include` | `<include/import>` | path |
| `Slot` | `<slot>` 一等节点 | name + values + common |

**对照现状**：我们的 TemplateIR 目前是「15 字段平铺」（vModelTargets/styleBindings/semanticGrids…）+
产物 wxml 文本里 v-for/v-if 仍是属性。官方把 For/If/Slot 提升为**节点级语义**——草案 M3/M4 codegen 收敛时
节点化方向应对齐（尤其 v-if/elif/else 分支组合并、wx:for 提升——我们现在 wx:for 是属性粘贴，多分支
v-if 链在产物里仍是平铺 view，未像官方 If 那样建「分支组」语义）。

### 1.2 属性前缀体系——平台能力面清单（★最重要的参考）

官方 parse 识别的前缀全集（AttrPrefixKind 枚举）：

| 前缀 | 官方语义 | 对照我们的现状 |
|---|---|---|
| `wx:if/elif/else` | 条件分支 | ✅ v-if/else-if/else → wx:if/elif/else（形态对齐） |
| `wx:for/for-item/for-index` | 列表 | ✅ 形态对齐 |
| `wx:key` | **StaticStr**（`wx:key="*this"` 或属性路径 `wx:key="id"`；**含 `{{}}` → DataBindingNotAllowed 错误**） | ⚠️ **自造限制实证**：我们 `:key` 只接受 `/^[\w$]+$/` 简单标识符，`t.id` 点路径被丢（build 警告实证）——而官方 StaticStr 接受点路径（仅禁 {{}}）。**应放宽为「合法属性路径或 *this」** |
| `bind: / catch: / mut-bind: / capture-bind: / capture-mut-bind: / capture-catch:` | **事件六态**（含捕获/互斥绑定） | ⚠️ 我们只产出 bind/catch 两态；`mut-bind`（防止冒泡冲突的互斥绑定）与 capture 三态未用——Vue `@click.capture`/`.mut` 语义将来可对齐 |
| `model:xxx` | **官方双向绑定形态**（`model:value="{{x}}"`） | ⚠️ **关键对照**：官方有 `model:` 前缀，不是 bindinput！我们的 v-model 产物是 `value+bindinput`（input 形态）与 `prop+bind:update:arg`（组件形态，见 #500）——组件形态本质是向官方事件体系靠拢；若微信开放 glass-easel 属性面，input 形态校准方向 = 产出 `model:value` 而非 bindinput |
| `change:xxx` | 值变化触发（change 事件绑定） | ❌ 未用（slider/switch 变更场景，官方专用） |
| `worklet:xxx` | **Skyline worklet 属性**（样式动画 worklet） | ⚠️ Skyline 专属能力面，我们的转场走自定义 routeType，未用官方 worklet 属性通道 |
| `class:xxx` | **条件 class**（`class:active="{{cond}}"`） | ⚠️ **自造差异**：我们 `:class="{active: on}"` → 三元拼接 `{{(on?'active ':'')}}`——官方有条件 class 机制，产物形态可更接近（但需微信开发者工具接受 class: 前缀；当前拼接形态工作正常，列为「官方机制替代候选」非缺陷） |
| `style:xxx` | 逐属性 style 绑定（`style:color="{{c}}"`） | ⚠️ 同 class：我们对象 :style → `color:{{c}}` 拼接；官方有 style: 前缀机制 |
| `data:xxx` / `data-xxx` | data 透传（data: 显式 / data- 连字符自动 camelCase） | ✅ 我们组件 props 走 usingComponents 属性通道；页面 data- 场景未用官方前缀（MP 组件通信是 props 非 data 属性） |
| `mark:xxx` | 事件 mark 数据（bindtap 事件里 e.mark） | ❌ 未用（与 dataset 类似的另一通道，官方推荐 mark 做跨组件事件传数） |
| `generic:xxx` | 泛型组件（generic 传组件） | ❌ 未用 |
| `extra-attr:xxx` | 额外属性（透传原生属性） | ❌ 未用 |
| `slot:xxx` | **slot 值引用**（`slot:name="{{val}}"` 声明作用域值 + slot 内容引用） | ⚠️ 我们组件插槽走 `<view slot="name">` 内容标记（#498）——官方另有 slot: 值引用面（类似作用域插槽方向，可对照我们「作用域插槽无对等机制」的警告是否可解） |
| `let:xxx` | **let 变量声明**（`let:item="{{x}}"` 块级作用域） | ❌ 未用（Vue 无对应；但官方用它做 slot 内容取父数据——我们作用域插槽替代方案的潜在官方通道） |
| `id` / `slot="name"` / `class` / `style`（无前缀） | 常规属性 | ✅ |

### 1.3 错误分级体系——wxml 平台标准校验的官方范本（呼应 #505「按平台标准收紧」）

```rust
ParseErrorLevel: Note(1) < Warn(2) < Error(3) < Fatal(4)
prevent_success() = level >= Error   // Error/Fatal 阻断编译；Note/Warn 可继续
ParseErrorKind: 40+ 具名错误码（带静态消息 + 位置）
```

代表性错误码（平台判定「什么是错的」的权威清单）：

| 错误码 | 语义 | 与我们的关联 |
|---|---|---|
| `InvalidAttributePrefix` | 未知前缀（如 `a:mark`） | 产物合法性校验项 |
| `AvoidUppercaseLetters` | 标签/属性大写（`<Div>`） | Note 级；我们源码可能有大写组件（Pascal 组件名——MP 产物是 kebab，需确认不冲突） |
| `DuplicatedAttribute` | 重复属性 | 产物自校验项（我们现在 validateWxml 只查配对） |
| `DataBindingNotAllowed` | 静态属性位出现 `{{}}`（如 `wx:key="{{x}}"`） | **wx:key 形态校验的直接依据** |
| `IncompatibleWithClassColonAttributes` | `class:` 与动态 class 串互斥 | 若用 class: 前缀则要守此约束 |
| `IncompatibleWithStyleColonAttributes` | 同 style | 同上 |
| `InvalidInlineStyleString` / `DuplicatedStylePropertyNames` | style 串解析失败/重复属性 | :style 拼接产物校验 |
| `InvalidScopeName` / `UninitializedScope` | slot:/let:/for-item 作用域名非法/未初始化 | 作用域分析校验 |
| `UnmatchedBracket` / `UnmatchedParenthesis` | 表达式括号不匹配 | 表达式产物校验 |

**落地意义**：validate 阶段下一步 = wxml 平台标准校验（草案 M5 的「wxml 平台标准」候选），
直接以官方错误码为蓝本登记规则（`validate/wxml-platform` 族），比我们自想校验清单可靠得多。

### 1.4 作用域分析 + binding map——templateRefs 采集不全的官方解法

官方 parse 第二轮 `init_scopes_and_binding_map_keys` 做：
- **显式作用域栈**：wxs module 名、slot 值引用名、`let:` 变量名、`wx:for` item/index 依次入栈；
- **binding_map_keys**：每个 `{{表达式}}` 内的**顶层数据引用**收集成 BindingMapKeys（动态树外才收集；
  include 全局禁用）——用于运行时数据键跟踪（类似 setData 精确更新）；
- **mangling**：嵌套 for/slot 冲突时变量重命名 `wx:for-item="_$0"`（check_with_mangling 测试实证）。

**对照现状**：我们 1.2 取证发现 `templateRefs` 采集不全（只经 rewriteStoreRefs 的两条路径采集插值
与 :prop，v-if/v-for/:class/:style 表达式漏采）→ #494 快照机制依赖它，漏采 = 真机 ReferenceError。
官方这套「作用域栈 + 全表达式绑定键收集」正是该缺口的完整模型——M4 表达式依赖面补齐可对齐
（尤其 wx:for 内层作用域变量不应算作组件状态依赖，官方用栈区分，我们目前是裸标识符全收）。

### 1.5 值模型（Value）

```rust
Value::Static { value: String }            // 纯静态串（含实体解码）
Value::Dynamic { expression, double_brace_location, binding_map_keys }  // {{表达式}}
// 文本节点混合静态+动态 → 编译为 Expression::Plus 链（ToStringWithoutUndefined 包裹防 undefined）
```

**对照**：我们插值 `{{x}}` 文本混合形态直接拼串；官方把「静态+动态混合」显式建模为 Plus 链且
**ToStringWithoutUndefined 包裹**（防 undefined 显示 "undefined"）——我们 v-show 复合加括号（#501）
同类思路，但防 undefined 的产物层语义官方已有标准形态，值得对照。

---

## 2. 对齐差距清单（现状 vs 官方 → 处置）

| # | 差距 | 现状证据 | 官方标准 | 处置建议 | 优先级 |
|---|---|---|---|---|---|
| G1 | **wx:key 自造限制**（只收简单标识符，`t.id` 被丢） | template.ts L841-842（build 警告实证） | StaticStr 接受属性路径/*this，只禁 {{}} | **放宽**：`[\w$.]+` 点路径或 *this；禁 {{}} 保持 | P0（低成本高正确性） |
| G2 | **wxml validate 无平台标准**（只查配对） | validate.ts validateWxml | 40+ 错误码 + 4 级 | 以官方错误码为蓝本登记 `validate/wxml-platform` 规则族 | P0（呼应 #505 收紧） |
| G3 | **templateRefs 采集不全** | template.ts rewriteStoreRefs L288 仅两路径 | 作用域栈 + binding_map_keys 全表达式收集 | M4 表达式依赖面按官方模型补齐 | P1 |
| G4 | **v-if/for 非节点化**（产物平铺属性） | wxml 产物 | For/If/Slot 提升为节点语义 | M3 TemplateIR 节点化对齐 ElementKind | P1（M3 输入） |
| G5 | **v-model input 形态走 bindinput** | #500 产物 | 官方 `model:value` 前缀 | 登记观察：微信开放 glass-easel 属性面后校准方向 | P2 |
| G6 | class:/style:/mut-bind/capture/mark/let/slot: 官方能力面未用 | — | 官方前缀体系 | 对齐表维护（需求出现才映射，不超前造） | P2 |
| G7 | 自造 vs 官方**语义冲突暂无系统性核查** | 本次抽查 1 处（G1）即命中 | — | 建「产物形态 → 官方 parser 验收」抽查门禁（可选跑官方 wasm parser 校验产物） | P2（远期） |

---

## 3. 与草案的关系

- 草案 §4.1 TemplateIR 节点结构：节点分类（M3）参考官方 ElementKind（见 G4）；
- 草案 §4.4 conformance 对准真实产物：产物形态对齐官方 parser 是「平台侧 conformance」的判定基准（G7 远期）；
- 草案 M5 规则治理 + #505 校验收紧：wxml 平台标准校验以官方错误码为蓝本（G2）；
- 方法论呼应：#504「不自研成熟工具链」——**IR 语义同样不自造，官方语义模型 = 现成标准**。

---

*本文档为对齐参考（评审稿）；新增/修订编译规则或 IR 结构前，先查本表对应行是否已有官方标准。*
