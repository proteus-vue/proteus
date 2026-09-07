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
| `model:xxx` | **官方双向绑定形态**（`model:value="{{x}}"`） | ⚠️ **关键对照**：官方 model:xxx 是**引擎双绑标记**（NormalAttributePrefix::Model 语义 + 属性名 dash_to_camel；官方测试 `model:a="{{b}}"` 字符串化保留）——**不是 bindinput 也不是普通透传属性**！我们的 v-model 产物 = input 形态 `value+bindinput`、组件形态 `prop + bind:update:arg`（#500，见 G5/G12）——组件形态的 `bind:update:*` 双冒号事件在官方语法下**不被识别**（见 1.7/G12） |
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

**已落地七项检查的官方级别对照（★2026-09-07 官方仓逐码核对 mod.rs L580-623）**：

| 我们已落地检查 | 官方错误码 | 官方级别 | 说明 |
|---|---|---|---|
| ①DataBindingNotAllowed | `DataBindingNotAllowed` | **Note** | 官方 Note 级（不阻断）——我们按编译 Error 拦截 = 收紧（官方语义：wx:key 含 {{}} 基本无效绑定，静默丢失；我们拒绝编译） |
| ②DuplicatedAttribute | `DuplicatedAttribute` | Warn | 同上收紧（重复属性官方只留其一） |
| ③AvoidUppercaseLetters | `AvoidUppercaseLetters` | **Note** | 官方 Note——标签名大写官方自动转小写并告警；属性名 camelCase 合法 |
| ④UnsupportedSyntax（`?.`） | `UnsupportedSyntax`（预留码）/ 实际 `?.` 触发路径 = 表达式解析失败 → `MissingExpressionEnd`/`UnexpectedExpressionCharacter` | **Error**（预留码）/ **Fatal**（实际路径） | 官方对绑定内不支持语法：值置空 + Fatal（阻断）；我们编译期拦截 = 语义同向 |
| ⑤InvalidAttribute（wx:key/for-item/for-index 无 for） | `InvalidAttribute` | Warn | 官方 ForList 提取仅 wx:for 存在时消费三者，否则告警 + 忽略（键/作用域语义丢失）；我们 Error 拦截（命中 = codegen 回归） |
| ⑥InvalidAttribute（wx:elif/wx:else 悬挂） | `InvalidAttribute` | Warn | 官方分支组 find_if_element_index 找不到前置 If → 告警 + 分支语义错位；我们 Error 拦截（Vue v-else 已保证配对，命中 = codegen 回归） |
| ⑦DuplicatedStylePropertyNames | `DuplicatedStylePropertyNames` | **Error** | 官方 tag.rs 仅对 Value::Static style 拆分查重（含 {{}} 动态值不静态分析——动态 base + style: 前缀 → IncompatibleWithStyleColonAttributes）；我们同范围（纯静态串）拦截；引号内分号不误拆 |

**收紧标准印证**：官方 Note/Warn 的处理 = 「告警 + 自动修正或丢弃」——丢弃即静默语义丢失；我们把 Note/Warn/Error 类都按编译 Error 拦截，宁可编译期报错也不让坏绑定进产物（呼应用户「校验器按平台标准，不是编译成功就行」）。

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

### 1.6 表达式语法（expr.rs——2026-09-07 官方仓深扒补充）

`parse/expr.rs`（75KB）定义平台表达式语言（我们 `{{ }}` 内嵌表达式的权威语法）：

**支持的运算符/语法**：静态成员 `.` / 动态成员 `[ ]` / **函数调用 `()`** / 一元 `! ~ + - typeof void` /
算术 `* / % + -` / 移位 `<< >> >>>` / 比较 `< <= > >= instanceof == != === !==` /
位 `& ^ |` / 逻辑 `&& ||` / **空值合并 `??`** / 三元 `?:` / 字面量（数字含指数、单双引号字符串含 \r\n\t\b\f\v\0 转义、数组、对象含 spread）/ 标识符含 `$`。

**不在表中**：**可选链 `?.`**（无此运算符——`?` 仅三元；`a?.b` 会被解析为三元 `?` 后跟非法序列）、
`in` 运算符、模板字符串（反引号）、正则字面量、赋值/自增类语句——均不是平台表达式语法。

**对照现状（关键）**：我们产物把模板表达式**原样透传**进 `{{ }}`——若 Vue 源码模板用 `a?.b`，
产物即含官方不支持的语法（Skyline/glass-easel parse 失败；devtools 老引擎同源风险）→ **已落地平台校验**：
`validate/wxml-platform` 增第四项 `UnsupportedSyntax`（扫描 `{{ }}` 内 `?.`，命中即编译报错，提示改守卫写法）。
另 `=`/`+=` 等赋值符明确不允许（产物不应含）。

### 1.7 属性/事件/值语法细节（tag.rs Element::parse——2026-09-07 二轮深扒实证）

**① 前缀白名单**：官方只认一组白名单前缀（AttrPrefixKind，见 1.2 表 + `wx:` 六项 + `data-`）。
**未知前缀**（如 `foo:bar`、未知 `wx:xxx`）→ `InvalidAttributePrefix`（Warn）+ **属性整体丢弃**（AttrPrefixKind::Invalid 分支 `{}`）；
`wx:for-items`（旧写法）→ `DeprecatedAttribute`（Warn）按 for 处理。

**② 事件名 = 单段标识符**：`bind:update:visible` 类**双冒号事件名在官方语法下不被识别**——切三段落
（bind/update/visible）→ 前缀判定 Invalid → Warn + 属性丢弃（add_element_event_binding 只收单段名）。
事件合法形态：`bind:name`/`catch:name`/`mut-bind:name`/capture 三态（name 可为 `my-event` 类含连字符标识符）。

**③ wx:* 取值约束**（parse_kind 表）：`wx:if/elif/for` = Value（可 {{}}）；`wx:else`/`wx:key` = StaticStr（含 {{}} → DataBindingNotAllowed；else 非空值 → InvalidAttributeValue）；
`wx:for-item/index` = ScopeName（非法 → InvalidScopeName）。

**④ wx:key/for-item/for-index 悬挂**：元素无 `wx:for` 时带上这三者任一项 → 官方 `InvalidAttribute`（Warn）逐项警告
（ForList 提取仅 for 存在时消费）。

**⑤ model:xxx**：属性名 dash_to_camel 后以 NormalAttributePrefix::Model 标记入普通属性表（引擎双绑语义面，非纯透传）。

**⑥ 值语法**：属性值 = 纯静态串 或 静态+多段 `{{}}` 混合（多段与静态混合编译为 `+` 拼接表达式，合法）；
`{{ }}` 空 → EmptyExpression（Warn）；表达式解析失败/缺 `}}` → 绑定置空 + MissingExpressionEnd（Fatal）。

**⑦ 节点属性禁区**：`<block>`（Pure）/For/If 上普通属性与事件绑定 → `InvalidAttribute`（Warn）——block 只承载 slot/slot:x/let:x；
`slot:`/`let:` 与 wx:* 同元素 → `IncompatibleWithWxAttribute`（Error）。

**⑧ class:/style: 互斥**：class 串为动态（含 {{}}）+ `class:xxx` → `IncompatibleWithClassColonAttributes`（Error）；
style 同理 `IncompatibleWithStyleColonAttributes`；静态 class/style 与 class:/style: 拼接时查重（DuplicatedClassNames /
DuplicatedStylePropertyNames——均 Error 级）。

---

## 2. 对齐差距清单（现状 vs 官方 → 处置）

| # | 差距 | 现状证据 | 官方标准 | 处置建议 | 优先级 | 状态 |
|---|---|---|---|---|---|---|
| G1 | **wx:key 自造限制**（只收简单标识符，`t.id` 被丢） | template.ts L841-842（build 警告实证） | StaticStr 接受属性路径/*this，只禁 {{}} | **放宽**：`[\w$.]+` 点路径或 *this；禁 {{}} 保持 | P0（低成本高正确性） | ✅ 已落地（wx:key 对齐批：v-for 项名预扫描 + *this + 禁 {{}} 警告；规则 directive/v-bind-key） |
| G2 | **wxml validate 无平台标准**（只查配对） | validate.ts validateWxml | 40+ 错误码 + 4 级 | 以官方错误码为蓝本登记 `validate/wxml-platform` 规则族 | P0（呼应 #505 收紧） | ✅ 已落地（DataBindingNotAllowed/DuplicatedAttribute/AvoidUppercaseLetters + ★深扒新增 UnsupportedSyntax——`?.` 可选链） |
| G3 | **templateRefs 采集不全** | template.ts rewriteStoreRefs L288 仅两路径 | 作用域栈 + binding_map_keys 全表达式收集 | M4 表达式依赖面按官方模型补齐 | P1 | ⬜ 开放 |
| G4 | **v-if/for 非节点化**（产物平铺属性） | wxml 产物 | For/If/Slot 提升为节点语义 | M3 TemplateIR 节点化对齐 ElementKind | P1（M3 输入） | ⬜ 开放（随 codegen 收敛专项） |
| G5 | **v-model 双绑形态未走官方 model: 通道**（input 走 bindinput；组件走 bind:update:*） | 87 文件产物普查：input → value+bindinput（#500）；13 种 p-* 组件 v-model → `bind:update:modelValue/visible/active/…`（p-input 用 kebab `update:model-value`） | 官方 model:xxx = 引擎双绑标记（NormalAttributePrefix::Model + dash_to_camel，1.2/1.7⑤）+ **lvalue 实证**（官方 tests/tmpl/lvalue.test.ts）：`model:value`/`model:checked` 用于原生 textarea/input(checkbox)，`model:prop-a` 用于自定义组件——**子组件 setData 自身 property 即自动回写父 lvalue 路径**（comp.setData({propA}) → 父 a.b[c] 自动更新，无需任何 update 事件） | **设计专项（登记观察，不擅自改产物）**：候选 A = p-* v-model 产物迁移官方 `model:xxx` 标记形态（组件侧改为 setData 驱动回写，契合 WeChat 模型；需真机验证开发者工具/Skyline 对 model: 属性面的实际支持与 p-* 组件侧改造量）；候选 B = 保持现形态 + G12 校验守事件名单段 | P1 | 🔶 设计专项（G12 联动） |
| G6 | class:/style:/mut-bind/capture/mark/let/slot: 官方能力面未用 | — | 官方前缀体系（深扒实证 slot 事件六态全支持：bind/catch/mut-bind/capture-bind/capture-catch/capture-mut-bind） | 对齐表维护（需求出现才映射，不超前造） | P2 | 维护中 |
| G7 | 自造 vs 官方**语义冲突暂无系统性核查** | 本次抽查 1 处（G1）即命中 | — | 建「产物形态 → 官方 parser 验收」抽查门禁（可选跑官方 wasm parser 校验产物） | P2（远期） | ⬜ 开放 |
| G8 | **绑定表达式含 `?.` 可选链**（官方 expr.rs 运算符表无 ?.——含 ??/函数调用/typeof/void/位运算但无可选链、无 in/模板字符串） | 模板 `{{ a?.b }}` 原样透传产物；87 文件普查零命中（存量全在 script 段，安全） | 官方 UnsupportedSyntax（预留 Error 级码；?. 实际触发 = 表达式解析失败 → MissingExpressionEnd Fatal） | **已落地**：validate/wxml-platform 第四项扫描 `{{ }}` 内 ?. → 编译报错提示守卫写法 | P1 | ✅ 已落地（本批） |
| G9 | **style 串重复属性名风险**（DuplicatedStylePropertyNames 官方 Error 级——用户 style 与 :style/派生拼接同键可能重复） | 87 文件产物普查：49 处 style 属性（纯静态 5/整串动态 34/混合 10）静态段重复**零**——编译器已用 G-22 静态缓冲合并 + p-grid 子项剥离警告避免同键；用户手写 style="a:1;a:2" 为残留入口 | 官方 Element::parse style 合并段（tag.rs）：静态 style 与 style:xxx 拼接时按 `;` 拆分查重（DuplicatedStylePropertyNames/InvalidInlineStyleString Error）；**查重仅限 Value::Static——含 {{}} 动态值官方不静态分析** | **已落地**：validate/wxml-platform 第⑦项 DuplicatedStylePropertyNames（纯静态 style 串重复键 → 编译报错；引号内分号不误拆——font-family:'A;B' 测试；含 {{}} 串跳过对齐官方范围） | P2 | ✅ 已落地（本批） |
| G10 | **wx:else/elif 悬挂形态**（无前置 wx:if 兄弟——Vue v-else 语义已保证配对，但产物人工改写/边缘形态可能悬挂） | 87 文件产物普查**零命中**（v-else 链恒配对） | 官方 If 分支组合并（find_if_element_index 找不到前置 If → InvalidAttribute Warn + 元素照常输出——悬挂不报 Fatal 但语义错位） | **已落地**：validate/wxml-platform 第⑥项 InvalidAttribute（wx:elif/wx:else 悬挂——栈模拟同层兄弟 if 态；配对链/注释夹链/自闭合零误报测试） | P2 | ✅ 已落地（本批） |
| G11 | **wx:key / wx:for-item / wx:for-index 悬挂**（元素无 wx:for 却带这三者——官方仅 for 存在时消费，否则 InvalidAttribute Warn） | 87 文件产物普查**零命中**（我们 wx:key 恒随 v-for 同元素发射） | 官方 ForList 提取（tag.rs）：wx_for 缺席时 for-item/index/key 逐项 InvalidAttribute | **已落地**：validate/wxml-platform 第⑤项 InvalidAttribute（同标签 wx:key/for-item/index 无 wx:for → 编译报错——防 codegen 收敛重构回归） | P2 | ✅ 已落地（本批） |
| G12 | **双冒号事件名 bind:update:\*（v-model 组件契约载体）**——官方事件名单段标识符语法，双冒号 → InvalidAttributePrefix（Warn）+ 属性丢弃 = 事件不注册 | 87 文件产物普查 **13 种 p-* 组件 v-model 全部发射双冒号事件**（semantic-primitives-demo/fluid-system-demo 实证：bind:update:modelValue/visible/active/group/model-value）；**官方全仓零双冒号事件测试**（grep 实证：事件测试全部单段名 customEv 等） | 官方 tag.rs：parse_colon_separated 切三段 → 前缀 Invalid → Warn + 属性丢弃；事件合法形态 = bind:name 单段（含 `my-event` 连字符）；官方双绑不走事件（model:xxx + setData 回写，见 G5 lvalue 实证） | **决策书见 §3**：步骤 1 = 用户 Skyline 复测（正常 → 决策 C 保持；失效 → 默认候选 B 单段归一）；A（迁 model:xxx）存远期官方对齐 | P1 | 🔶 设计专项（§3 决策书待拍板） |

---

## 3. G12 决策书：p-* v-model 双绑产物形态（2026-09-07，待用户真机复测后拍板）

**全链路现状取证**（三轮/四轮后补全）：

```
业务源码 <p-modal v-model:visible="show">
  → 页面产物：visible="{{show}}" bind:update:visible="proteusUpdateVisibleModel"   ← template.ts L947
       + js：proteusUpdateVisibleModel(e){ this.setData({ show: e.detail }) }（e.detail 直通）
p-* 组件自身（framework 组件，独立编译单元）：defineEmits(['update:visible', …]) + emit('update:visible', v)
  → 组件产物 js：this.triggerEvent('update:visible', v)（script.ts L1564 emit→triggerEvent 文本替换）
运行时：triggerEvent 名 ↔ bind:update:* 名匹配 → 父 setData（Vue v-model 契约的 MP 兼容桥）
范围：13 个框架组件 emit update:*（30 调用点；arg ∈ modelValue×8 / visible×2 / active×2 / group×1）
```

**官方语义面**（glass-easel template-compiler，本表 §1.7②）：事件名 = 单段标识符；双冒号 bind:update:* →
切三段 → InvalidAttributePrefix（Warn）+ **属性丢弃**；官方双绑不走事件（model:xxx + 子 setData property 自动回写父
lvalue，§1.7⑤ + G5 lvalue 实证）。**官方全仓零双冒号事件测试**。

**关键未知（只能真机/开发者工具实测，本机无法离线确证）**：我们产物走微信开发者工具编译链（非
glass-easel-template-compiler）——WebView 旧引擎已实测可用（#500 系列）；**Skyline 渲染下 bind:update:* 是否被微信
编译链接受未知**（开源 parser 拒绝 ≠ 微信生产编译链行为）。

**候选对比**（均不改变 Vue 源码层语义；Web 端零影响——真 Vue 编译不走此协议）：

| | 保持现状（C） | 候选 B：事件名单段归一 | 候选 A：迁官方 model:xxx |
|---|---|---|---|
| 产物形态 | prop + bind:update:* | prop + bind:update-\*（连字符单段） | model:{arg}="{{x}}"（无事件） |
| 组件侧改造 | 无 | script.ts emit→triggerEvent 对 'update:X' 字面量归一（update-\*）——13 组件/30 点自动 | emit('update:X',v) → this.setData({x:v})（组件自改 property 触发微信 model 回写） |
| 页面侧改造 | 无 | template.ts L947 事件名单段化（handler 不变） | template.ts 契约发射改 model: 前缀 |
| IR/规则 | 保持 | arg 语义保留（仅产物序列化名变） | vModel 契约语义变（arg→property 名） |
| 改动风险 | 零（若 Skyline OK） | 中（两端一致改名 + golden/87 重跑 + 真机重验） | 大（Vue prop 单向流语义桥接最远：子自改 prop 仅 MP 成立；properties setData 真机行为待验；与 Web 语义分化最深） |
| 官方语法面 | 不认（已知） | ✅ 兼容 | ✅ 完全对齐 |

**推荐路径（两步）**：
1. **步骤 1（用户，开发者工具 Skyline 模式复测）**：①p-modal v-model:visible 开合（semantic-primitives-demo「打开抽屉」/fluid-system-demo L149）；②p-input/p-switch/p-slider v-model（bind:update:model-value）；③若工作正常 → **决策 C（保持 + 登记观察，官方语法面风险存档）**，本决策书关闭；若事件不触发/控制台 InvalidAttributePrefix 警告 → 步骤 2。
2. **步骤 2（若失效，默认选 B）**：事件名归一 `update:{arg}` → `update-{arg}`（连字符单段——官方 ident 后续符含 '-'，测试 customEv 大写亦合法；比驼峰更贴合 wxml kebab 风格）；实施面 = script.ts 字面量归一 + template.ts 契约发射 + IR arg 语义保留 + 规则双语注记 + golden/87 重跑；真机重验 WebView + Skyline。
3. **A 存档为远期官方对齐候选**（Skyline 全面接管后 model: 是终局形态；届时 IR vModel 契约与组件协议一起迁，属独立专项）。

---

## 4. 与草案的关系

- 草案 §4.1 TemplateIR 节点结构：节点分类（M3）参考官方 ElementKind（见 G4）；
- 草案 §4.4 conformance 对准真实产物：产物形态对齐官方 parser 是「平台侧 conformance」的判定基准（G7 远期）；
- 草案 M5 规则治理 + #505 校验收紧：wxml 平台标准校验以官方错误码为蓝本（G2）；
- 方法论呼应：#504「不自研成熟工具链」——**IR 语义同样不自造，官方语义模型 = 现成标准**。

---

*本文档为对齐参考（评审稿）；新增/修订编译规则或 IR 结构前，先查本表对应行是否已有官方标准。*
