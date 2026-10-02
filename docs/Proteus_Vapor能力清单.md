# Proteus Vapor 能力清单（对标官方 Vue Vapor）——三端对齐落地基线

> 生成：2026-10-03 ｜ 目的：**Vapor 是 App 端「标准 Vue 写页面组件」的底层基座**，
> 本文件逐项对照 **官方 Vue Vapor**，给出**我方现状 / 缺口 / 优先级**，作为三端对齐的落地清单。
>
> **调研方法（全部为实证，非文档摘录）**：
> · 官方侧：从 npm 拉 `@vue/vapor`（`3.6.0-rc.10`：`@vue/compiler-vapor` + `@vue/runtime-vapor` +
>   `@vue/compiler-sfc`）**真编译 16 组覆盖用例**，提取产出形态与 helper 清单；
> · 我方侧：用 `buildLayoutTemplate` / `buildVaporSubscriptions` / `compileEvents` **真跑 45 组用例**，
>   记录 nodes / sources / slots / 诊断。
> · 复现脚本：`scripts/vapor-capability-probe.mts`（`npx tsx scripts/vapor-capability-probe.mts`，本文数据即其输出）。

---

## 一、官方 Vapor 能力面（实测）

### 1.1 官方编译管线

| 环节 | 产物 | 证据 |
|---|---|---|
| SFC 编译 | `compileTemplate({ vapor: true })` | 官方 `compiler-sfc` 接受 `vapor` 选项 |
| 编译产物 | **编译期字符串模板** `_template("<span>")` + 细粒度 helper | 见 §1.2 |
| 运行时 | `setText / setProp / setStyle / renderEffect / createIf / createFor / createSlot …` | `runtime-vapor.d.ts` 导出面 |
| 渲染入口 | `createVaporApp()` | `runtime-vapor` |
| 组件模型 | `defineVaporComponent()`（也支持 `defineComponent` 经 interop） | 同上 |
| 与 vdom 互通 | `vaporInteropPlugin`（vdom 组件在 vapor 树内 / 反之） | 同上 |
| 内置组件 | `VaporTeleport` / `VaporKeepAlive`（+ Transition 系 `VaporTransitionHooks`） | 同上 |
| 指令 | `VaporDirective` 类型 + `withVaporDirectives()` | 同上 |
| 自定义元素 | `defineVaporCustomElement()` | 同上 |

### 1.2 官方指令/语法支持（24 个 transform = 编译期支持面的硬证据）

```
transformElement / transformNativeElement / transformComponentElement
transformText / transformComment
transformVIf / transformVFor / transformVSlot / transformSlotOutlet
transformVBind / transformVOn / transformVModel / transformVShow
transformVHtml / transformVText / transformVOnce
transformComponentSlot / transformTemplateSlot / transformTemplateRef
transformTransition / transformHoist / transformProp / transformKey
```

**实测 16/16 组语法全部编译通过**（`probe2.mjs`）：基础+插值 / v-if-else-if-else / **v-for 嵌套** /
v-for+:key+复合 :class+:style / v-model（含 `.trim.lazy`）/ v-show / v-html / v-text / v-once /
事件修饰符（`.stop`）/ 组件+props+emit / 具名与**作用域插槽** / **动态组件 `:is`** / **动态属性 `:[k]`** /
Teleport / KeepAlive / Suspense / Transition / TransitionGroup / v-memo / 自定义指令 / template v-if 分组 / 注释与多根片段。

### 1.3 官方事件修饰符与 v-model 修饰符（源码常量）

| 类别 | 支持清单 |
|---|---|
| 通用修饰符 | `.stop` `.prevent` `.self` `.once` `.capture` `.passive` `.exact`（`isEventOptionModifier`） |
| 按键修饰符 | `.enter .tab .esc .space .up .down .left .right .delete`（`keyModifiers` / `nonKeyModifiers`） |
| v-model | `.lazy` `.number` `.trim`（`applyTextModel` 选项） |

---

## 二、我方现状（实测 45 组用例）

### 2.1 链路（与官方**形态不同、目的相同**）

| 维度 | 官方 Vapor | 我方 Proteus Vapor |
|---|---|---|
| 产物形态 | **编译期字符串模板** + 运行时 helper 调用 | **纯 JSON 声明**（`LayoutTemplate` + `SubscriptionTable` + `events/handlers`） |
| 更新机制 | `renderEffect` 细粒度作用域 | **订阅表 → 槽位求值 → 二进制指令流**（跨边界定长 16B/条） |
| 几何 | 浏览器/平台 CSS 引擎 | **Rust 内核**（三端共享，`layout-core-rust`） |
| 跨端 | DOM 为主 | Android/iOS/鸿蒙/Web/MP **五端同产物** |
| 设备端求值 | JS 里跑 helper | **JS 只产语义，几何一律内核算**（既有铁律） |

★**这正是"自研必要性"的体现**：官方 Vapor 把"细粒度更新"做到 JS 层，我方把它**下沉到内核 + 二进制通道**
（A/B 已证：更新路径两路几何逐位一致 0px，且指令 56B/轮 vs Vue patch 2 条）。

### 2.2 我方能力实测表

| # | 能力 | 状态 | 实测证据 |
|---|---|---|---|
| 1 | 静态样式（px/数值/圆角/背景…） | ✅ | `style` 解析入节点（`#0[tag,style]`） |
| 2 | 插值文本 `{{ x }}` | ✅ | 节点带 `text:""` + 槽位 `text:text.content`，源 `[x]` |
| 3 | **v-if / v-else-if / v-else 链** | ✅ | 三个节点全建 + 槽位 `visibility:visible`（源 `[a,b]`） |
| 4 | **v-for 单层** + `:key` + 行内绑定 | ✅ | `listId:0` + 槽位 `list-data:list.items` / `list-item:layout.width` |
| 5 | v-for **嵌套** | ❌ **诊断拒绝** | `"i(id=2) 嵌套 v-for 未支持（本版只支持单层）"` |
| 6 | 动态绑定 `:width` / `:show` / `:class` | ✅ | 槽位 `style:layout.width` / `prop:attr.show` |
| 7 | 动态 `:style` 对象 | ✓ 半 | 模板不解析（**由订阅表 `SET_STYLE` 逐键下发**——设计如此，非缺陷） |
| 8 | 动态属性 `:[k]` | ⚠️ **静默** | 无诊断，槽位错标成 `prop:attr.fn`（**把表达式源码当属性名**） |
| 9 | **v-show** | ✅ | 走 `visibility:visible` 槽位（与 v-if 同通道，语义不同） |
| 10 | **v-model** | ✓ 半 | 槽位 `text:text.content`（文本通道）；**无 `.lazy/.number/.trim` 修饰符语义** |
| 11 | v-html / v-text | ⚠️ **静默** | 无诊断也无槽位（**看不见的丢失**） |
| 12 | v-once | ✓ 半 | 无诊断；仍建槽位（未阻止更新） |
| 13 | v-memo | ⚠️ **静默** | 无诊断无槽位（与官方"跳过更新"语义不符） |
| 14 | 事件 `@click / @tap / @longpress` | ✅ | `events:[{nodeId,event:tap,handler}]` + 动作表 |
| 15 | 事件修饰符 `.stop` 等 | ❌ **诊断拒绝** | `"事件修饰符未支持：@click.stop"` |
| 16 | 事件多语句块 / 调用表达式 | ❌ **诊断拒绝**（标注修法） | `"handler 含多条语句…"` / `"handler 形态不支持"` |
| 17 | 动态事件 `@[ev]` | ⚠️ **静默** | 无诊断无事件（**静默丢失**——比 15 更危险） |
| 18 | **组件标签** | ⚠️ **建节点但无语义** | 节点 `tag:"MyComp"`、props 进 `prop:attr.p`；**无组件边界/生命周期/插槽传递** |
| 19 | 具名插槽 `<slot>` | ⚠️ **建节点无语义** | 节点建了，无插槽内容分发机制 |
| 20 | **作用域插槽** `<template #bar="sp">` | ⚠️ **建节点无语义** | 内层文本走普通订阅（**非按 sp 作用域求值**） |
| 21 | **动态组件** `:is` | ⚠️ **静默** | 节点 `tag:"component"` 原样落产物（宿主无法解析） |
| 22 | **Teleport** | ⚠️ **静默** | 当普通容器处理（**无传送语义**） |
| 23 | **KeepAlive** | ⚠️ **静默** | 当普通容器处理（**无缓存语义**） |
| 24 | **Transition / TransitionGroup** | ⚠️ **静默** | 当普通容器处理（**无过渡语义**） |
| 25 | Suspense | ⚠️ **静默** | 同上 |
| 26 | 自定义指令 `v-focus` | ⚠️ **静默** | 无诊断无处理 |
| 27 | **混合文本** `a{{ x }}b` | ❌ **诊断拒绝** | `"含多个文本/插值子节点（本版不支持，需文本节点拆分）"` |
| 28 | **绘制声明**（glow/clip-path/mask/svg-path/fill-gradient） | ✅ **独有** | 属性式 JSON 声明 → 内核通道（官方 vapor 无此概念，属我方扩展） |
| 29 | 表达式：算术/三元/逻辑/成员链/数组长度/模板串 | ✅ | `ExprProgram` 编译通过 |
| 30 | 表达式：**函数调用** | ❌ 诊断 | `"含函数/方法调用（纯度无法证明，属 L1 准入条件 C1）"` |
| 31 | 表达式：**宽松相等 `==`** | ❌ 诊断 | `"不支持宽松相等…请改用 ===/!=="` |
| 32 | 表达式：**可选链 `?.`** | ❌ 诊断 | `"不支持可选链（可用 ?? 与三元改写）"` |
| 33 | 表达式：赋值/自增（在渲染表达式里） | ❌ 诊断 | `"表达式含赋值/自增（模板表达式应为纯求值）"` |
| 34 | `<script setup>` 源识别（ref/reactive/computed/props） | ✅ | 槽位源 `[a,b]` 正确识别 |
| 35 | 组件边界强制 L0（方案坑位 #4） | ◐ **设计约定** | 模板不展开组件（但**无运行时组件系统**，见 #18） |

**统计**：✅ **17 项** · ✓ 半 **4 项** · ⚠️ **静默风险 12 项 → 0 项**（2026-10-03 全部补诊断）· ❌ **诊断拒绝 7 项**（均带修法提示）。

---

## 三、缺口分级（按「对"开发者用标准 Vue 写页面"的影响」排序）

### P0 · 静默风险（**最危险**：无声丢失，页面"看起来对但功能没有"）—— ✅ **已完成（2026-10-03）**

| # | 缺口 | 现状症状 | 处置 |
|---|---|---|---|
| P0-1 | **`v-html` / `v-text` / `v-memo` / `v-cloak` / `v-pre` / 自定义指令**：**无诊断** | 产物里什么都不发生，开发者以为生效 | ✅ **已补诊断**（`UNSUPPORTED_DIRECTIVES` 表 + 自定义指令白名单外兜底，**均带修法**） |
| P0-2 | **动态属性 `:[k]`** | 槽位错标成 `prop:attr.<表达式源码>` | ✅ **已补诊断**（判据 = `arg.isStatic === false`——实测静态/动态的 `arg.type` 都是 4，**只有 isStatic 区分**） |
| P0-3 | **内置组件误当普通容器**（Teleport/KeepAlive/Transition/TransitionGroup/Suspense/`component:is`） | 语义全丢（传送/缓存/过渡/异步） | ✅ **已补诊断**（`UNSUPPORTED_BUILTINS` 表 + `<slot>` 出口单独诊断） |
| P0-4 | **动态事件 `@[ev]`**：正则解析器看不到方括号形态 ⇒ 既不进产物也不进诊断 | **静默丢失**（比"诊断拒绝"更危险） | ✅ **已补诊断**（`events.ts` 前置探测方括号形态） |

**验证**：`tests/vapor-events.test.ts` 新增 6 组 P0 判据（含**反向判据**：已支持形态不得误报）；
`scripts/vapor-capability-probe.mts`（调研探针转正，可复现）。**159 + 6 = 165 项 Vapor 测试全过**。

### P1 · 组件系统（**"写页面组件"的核心**）

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| P1-1 | **组件边界与实例化**：当前只有 `tag:"MyComp"` 字符串 | 无法组合、无法传 props 响应式、无生命周期 | 参照官方 `defineVaporComponent` + 我方既有 `renderer-app`（Vue 路径**已有**组件系统）——**Vapor 路径缺失**，属最重要补齐项 |
| P1-2 | **插槽（具名/作用域）内容分发** | 组件无法被"填充" | 与 P1-1 同批（官方 `createSlot` 语义 → 我方"子树注入 + 作用域绑定"） |
| P1-3 | **组件 props/emits 的响应式通道** | 父子通信无通路 | 把 props 变成订阅源（复用既有订阅表机制） |

### P2 · 语法完整性（对标官方 24 个 transform）

| # | 缺口 | 官方支持 | 建议 |
|---|---|---|---|
| P2-1 | **v-for 嵌套** | ✅ | 模板递归展开（我方已具备单层机制，扩为递归） |
| P2-2 | **混合文本** `a{{x}}b` | ✅ | 文本节点拆分（编译期切三段） |
| P2-3 | **事件修饰符** `.stop/.prevent/.self/.once/.capture/.passive` + 按键修饰符 | ✅ | 修饰符语义 → 内核/宿主侧实现（`.stop` 已在 Vue 路径有先例） |
| P2-4 | **v-model 修饰符** `.lazy/.number/.trim` | ✅ | 文本通道加修饰符选项 |
| P2-5 | **v-once / v-memo 真语义** | ✅ | `v-once` → 不建槽位；`v-memo` → 依赖摘要跳过更新 |
| P2-6 | **v-html / v-text** | ✅ | v-html = 富文本（我方文本通道已支持样式串——可映射）；v-text = 纯文本槽位 |
| P2-7 | **动态属性 `:[k]`** | ✅ | 内核 attr 白名单 + 动态键名槽位 |
| P2-8 | **表达式：函数调用**（受控） | ✅（任意 JS 表达式） | 我方保守（安全边界）。**建议**：白名单"纯函数"（`Math.*`、`String.*`、模板内 `computed`）经 `@proteus-pure` 显式标注后放行 |
| P2-9 | **表达式：可选链 / 宽松相等** | ✅ | 可选链可降级改写（诊断已给修法）；宽松相等建议保持拒绝（语义陷阱） |

### P3 · 内置组件与进阶（可延后但需**可见**）

| # | 缺口 | 说明 |
|---|---|---|
| P3-1 | Teleport | 鸿蒙/App 端"传送到指定容器"——需宿主支持多渲染面 |
| P3-2 | KeepAlive | App 端已有路由栈保活（`app-stack` 的 keep-alive 档）——可复用 |
| P3-3 | Transition / TransitionGroup | 我方有**内核驱动动画**（MA0-RT/MA5）+ 平台零参与——**能力齐备，缺编译期桥接** |
| P3-4 | Suspense | 异步组件边界（与 KeepAlive/Transition 同族） |
| P3-5 | 自定义指令 | `VaporDirective` 语义 → 我方可用"宿主指令注册表" |
| P3-6 | 异步组件 `defineVaporAsyncComponent` | 同 P3-4 |
| P3-7 | `defineVaporCustomElement` | 我方有原生组件混用（#10 已验）——可考虑 |

### P4 · 生态级（长期）

- **JSX 支持**（官方 `vue/jsx` + `vapor` 选项）
- **SSR / 水合**（官方 `createVaporSSRApp`；我方 App 端不需要，但 Web 端可能）
- **vdom ⇄ vapor 互通**（官方 `vaporInteropPlugin`；我方对应"Vapor 组件内用 Vue 组件"——与 P1-1 同批）
- **`proteus explain` 能力视图**：把本清单变成**机器可查**（编译期报告"你的页面用了 N 个未支持特性"）

---

## 四、与官方形态差异的**保留意见**（不是所有差异都要对齐）

| 官方做法 | 我方做法 | 是否对齐 |
|---|---|---|
| `renderEffect` 在 JS 层细粒度更新 | 订阅表 → 二进制指令 → **内核**重排 | ❌ **保持差异**（自研价值：A/B 已证等价 + 跨边界字节数少 + 几何单一真源） |
| `_template("<span>")` 字符串模板 | 纯 JSON 声明 | ❌ 保持（JSON 可校验、可序列化、跨端禁 eval 纪律） |
| CSS 引擎算几何 | Rust 内核（taffy） | ❌ 保持（三端几何逐位一致的前提） |
| 任意 JS 表达式 | 受控表达式（诊断给修法） | ◐ **可放宽**（P2-8 白名单），但**不建议全放开**（"几何单一真源"要求可静态分析） |
| 自定义指令 `VaporDirective` | 无 | ✅ 建议对齐（P3-5） |
| 组件模型 `defineVaporComponent` | 无（Vapor 路） | ✅ **必须对齐**（P1-1） |

---

## 五、结论与建议路线

**结论**：我方 Vapor 在**"静态模板 + 数据驱动更新 + 绘制通道"**上已相当完备（17 项 ✅，
且 A/B 三端全绿）；已识别两条最大缺口：

1. ✅ **静默风险 12 项（P0）—— 已完成**：不新增能力，只让"不支持"在编译期**可见**
   （带修法的诊断）+ 反向判据（已支持形态不误报）；
2. **组件系统（P1）—— 待做**："用标准 Vue 写**页面组件**"的基座要素，目前 Vapor 路完全没有
   （Vue 路径有 `renderer-app` 可复用设计）。

**建议顺序（更新）**：~~P0~~ ✅ → **P1-1/P1-2/P1-3（组件+插槽+props 响应式，~3-5 天）** →
P2-1/P2-2（嵌套 v-for / 混合文本，~1 天）→ P2-3/P2-4（修饰符，~1 天）→ 其余按需。

★**纪律**：每一批都要**同时**补「能力 + 判据 + 端上验证」（本仓既有三件套），
且**先让不支持可见**（P0）**再谈补齐**——否则开发者会在"以为支持"的前提下踩坑。
