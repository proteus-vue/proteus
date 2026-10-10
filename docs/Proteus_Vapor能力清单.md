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
| 6 | 动态绑定 `:width` / `:show` / `:class` | ✅ | 槽位 `style:layout.width` / `prop:attr.show`。★**动态 `:class` 的布局字段（B3a/B3b/B3c/B3d，2026-10-10）**：**数值**（width/margin*/padding*/flex*/gap/top/left/right/bottom/aspectRatio…）+ **枚举**（display/flexDirection/flexWrap/position/overflow/alignItems/justifyContent/alignContent/alignSelf）经**内核二进制 SET_STYLE**（数值=f32 / 枚举=索引编码，host-agnostic）+ **字符串**（gridTemplateColumns/Rows/Areas · gridAutoColumns/Rows/Flow）经**新 opcode SET_STYLE_STR（0x06，字符串池）** **端上真重排**（三端判据 ㉕/㉖/㉗）；其余（whiteSpace / wordBreak / overflowX-Y / lineClamp）仍诊断（内核无对应字段）。 |
| 7 | 动态 `:style` 对象 | ✓ 半 | 模板不解析（**由订阅表 `SET_STYLE` 逐键下发**——设计如此，非缺陷） |
| 8 | 动态属性 `:[k]` | ⚠️ **静默** | 无诊断，槽位错标成 `prop:attr.fn`（**把表达式源码当属性名**） |
| 9 | **v-show** | ✅ | 走 `visibility:visible` 槽位（与 v-if 同通道，语义不同） |
| 10 | **v-model** | ✓ 半 | ◐ **下行支持 + 回写诊断（P2-4）**：值→文本槽位可用；**无回写通道**（App 输入未接）⇒ 出现即诊断（修饰符一并标注）。修饰符 `.trim/.number/.lazy` 的**真语义**在 MP 路径（回写端转换） |
| 11 | v-html / v-text | ◐ | v-text ✅ **已支持（P2-6）**：与插值同槽位（覆盖子节点语义）；v-html ❌ 仍不支持——**富文本通道缺失**（内核文本单串、宿主单次 drawText），诊断写明真实原因 |
| 12 | v-once | ✅ | ✅ **已支持（P2-5）**：槽位带 `once` 标记 ⇒ 首次写入后**永久冻结**（真机判据 ⑪）；行内 v-once（官方共享缓存槽语义）如实诊断 |
| 13 | v-memo | ✅ | ✅ **已支持（P2-5）**：`v-memo="[a,b]"` ⇒ 依赖编成 `memoGroups`，运行时**按组比较**（依赖净 ⇒ 跳过子树更新；脏 ⇒ 放行）。非数组字面量形态如实诊断 |
| 14 | 事件 `@click / @tap / @longpress` | ✅ | `events:[{nodeId,event:tap,handler}]` + 动作表 |
| 15 | 事件修饰符 | ◐ **部分支持（P2-3）** | `.stop` / `.self` / `.once` = **真语义**（产物置位 + 运行时共享派发器，真机判据 ⑨）；`.prevent`/`.passive`/`.capture`/按键=**诊断但不阻碍 handler**（无对应语义，忽略是忠实的） |
| 16 | 事件多语句块 / 调用表达式 / **方法引用·方法体** | ✅ **已支持（#740 T1+T2+T3，2026-10-10）** | ✅ **多语句**（`a++; b++` ⇒ 多动作按序）· ✅ **方法引用 / 调用**（`@click="handleTap"` / `handleTap(2)` ⇒ **编译期内联** `<script setup>` 方法体并降级为动作；ref `.value` 自动解包）· ✅ 方法体内的 `$emit` / `$nav` · ✅ **T2**：**带实参调用**（`add(2)`，实参绑为 `let` 形参）· **方法形参** · **方法内局部变量**（`const y = …` ⇒ `let`）· **`if/else`**（⇒ `if` 条件动作，两臂子动作列表）· ✅ **T3**：**`console.{log,info,warn,error,debug}(…)`** ⇒ `log` 动作（端上→面板 Console）· **方法调方法**（递归内联，已可用）· **模板串**（`compileExpr` 已支持）。❌ **仍拒绝**（带修法）：循环 / async·await / 其余 `console.*`（table/time…）/ 任意函数（`foo()`）——守"封闭集、无 eval"纪律。判据：`vapor-events`/`handler-actions` 单测 + 三端真机判据 ㉓ |
| 17 | 动态事件 `@[ev]` | ⚠️ **静默** | 无诊断无事件（**静默丢失**——比 15 更危险） |
| 18 | **组件标签** | ⚠️ **建节点但无语义** | 节点 `tag:"MyComp"`、props 进 `prop:attr.p`；**无组件边界/生命周期/插槽传递** |
| 19 | 具名插槽 `<slot>` | ⚠️ **建节点无语义** | 节点建了，无插槽内容分发机制 |
| 20 | **作用域插槽** `<template #bar="sp">` | ⚠️ **建节点无语义** | 内层文本走普通订阅（**非按 sp 作用域求值**） |
| 21 | **动态组件** `:is` | ⚠️ **静默** | 节点 `tag:"component"` 原样落产物（宿主无法解析） |
| 22 | **Teleport** | ⚠️ **静默** | 当普通容器处理（**无传送语义**） |
| 23 | **KeepAlive** | ⚠️ **静默** | 当普通容器处理（**无缓存语义**） |
| 24 | **Transition** | ✅ **已支持（P3-3）** | 编译成预设动画（见 P3-3；判据 ⑬ 三端全过）·TransitionGroup 仍不支持 |
| 25 | Suspense | ⚠️ **静默** | 同上 |
| 26 | 自定义指令 `v-focus` | ⚠️ **静默** | 无诊断无处理 |
| 27 | **混合文本** `a{{ x }}b` | ✅ **已支持（P2-2）** | 编译期切分为段表（静态段 + 表达式段）⇒ 运行时求值拼接；首帧与更新都完整（真机判据 ⑩/⑩b） |
| 28 | **绘制声明**（glow/clip-path/mask/svg-path/fill-gradient） | ✅ **独有** | 属性式 JSON 声明 → 内核通道（官方 vapor 无此概念，属我方扩展） |
| 29 | 表达式：算术/三元/逻辑/成员链/数组长度/模板串 | ✅ | `ExprProgram` 编译通过 |
| 30 | 表达式：**函数调用** | ◐ **白名单内支持（P2-8）** | 内建纯函数 `Math.*`（除 `Math.random`）/ `String` / `Number` / `parseInt` / `Number.isFinite`… **可用且进 L1**（语言级静态可证）；★**白名单外**（含业务函数）仍诊断。**纯方法**（P2-8 续）：`arr.join/slice/concat/indexOf/includes`、`s.trim/toUpperCase/slice…`、`n.toFixed`（**非变异**）可用；**变异方法**（`sort/reverse/push/splice`）与正则 `replace` 仍拒绝 |
| 31 | 表达式：**宽松相等 `==`** | ❌ 诊断（**保持**） | `"不支持宽松相等…请改用 ===/!=="`——JS 语义微妙（`null==undefined`、字符串转数字），实现错会**静默算错值**；结论：**不放宽** |
| 32 | 表达式：**可选链 `?.`** | ✅ **已支持（P2-9）** | 编译期**降级为 cond 程序**（`a?.b` ⇒ `(a===null\|\|a===undefined) ? undefined : a.b`）；空值渲染为空串（不是 `"undefined"`）。★同时修掉**幽灵源**（属性名曾被当独立依赖） |
| 33 | 表达式：赋值/自增（在渲染表达式里） | ❌ 诊断 | `"表达式含赋值/自增（模板表达式应为纯求值）"` |
| 34 | `<script setup>` 源识别（ref/reactive/computed/props） | ✅ | 槽位源 `[a,b]` 正确识别 |
| 35 | 组件边界强制 L0（方案坑位 #4） | ◐ **设计约定** | 模板不展开组件（但**无运行时组件系统**，见 #18） |

**统计**：✅ **18 项**（+混合文本）· ✓ 半 **5 项**（+事件修饰符：三个有真语义）· ⚠️ **静默风险 12 项 → 0 项**（2026-10-03 全部补诊断）· ❌ **诊断拒绝 7 项**（均带修法提示）。

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
`scripts/vapor-capability-probe.mts`（调研探针转正，可复现）。P2-1 新增 4 组嵌套判据
（`tests/vapor-sfc-to-tree.test.ts`）。**172 项 Vapor 测试全过**（11 文件）。

### P1 · 组件系统（**"写页面组件"的核心**）

| # | 缺口 | 影响 | 状态 |
|---|---|---|---|
| **P1-1** | **组件边界标记**：原先只有 `tag:"MyComp"` 字符串（当普通元素） | 宿主无法识别"这里是组件位" | ✅ **已完成（第一批，2026-10-03）**：`LayoutNode.component` 字段（PascalCase 判据，与 Vue 约定同）；template.ts 与 deps.ts **两处判据同源** |
| **P1-2** | **组件 props 响应式通道** | 父→子传值无通路 | ✅ **已完成（第一批）**：props 走 `component.<name>` propKey → `component-prop` 槽位 → **`CALL_COMPONENT_UPDATE` 指令**（opcode/编解码**早已存在**，缺的只是发射端）；内核明确拒收并上报（"需组件边界调度"——**预期形态**：组件指令归宿主/组件运行时，不归内核几何） |
| **P1-3** | **组件内部渲染** / 生命周期 / 插槽分发 / emits | 组件无法真正"跑起来" | ✅ **全项已完成（2026-10-03 · 三端同步）**：① 内部渲染（判据 ⑭）② 插槽分发（⑮）③ 作用域插槽（⑰）④ emits 子→父（⑯）⑤ **生命周期**——`@vue:mounted` 成为**一等产物**（`lifecycle` 绑定 + 动作表；挂载完成后触发 → 订阅链 → 内核几何，判据 ⑱ 四证）；★修出静默缺陷：`@vue:mounted` 此前落成"永不触发的 componentEmit 监听"。★**脚本级钩子（B5，2026-10-10）已支持**：`onMounted`/`onUnmounted` 回调体**编译期降级为动作表**（`scriptLifecycle`），端上在「首帧 mount 后」/「宿主卸载时」执行（判据 ㉔ 三端全过）；运行期 `instance.markMounted()/markUnmounted()`。**其余脚本钩子**（`onBeforeMount`/`onUpdated`/`onActivated` 等）仍产 `VAPOR_SCRIPT_LIFECYCLE_NOT_RUN` 可见化。**`@vue:unmounted` / v-if 结构摘除为后续批次**（各有精确诊断） |

**★P1 增量说明（本批做/不做，如实标注）**

| 做 | 依据 |
|---|---|
| 组件边界标记（`component` 字段） | 方案 §7.3 "组件边界强制 L0"——标记是 L0 语义的载体 |
| props 通道（`component-prop` → `CALL_COMPONENT_UPDATE`） | opcode/编码/解码/发射点**全部已存在**（`buffer.ts`/`slot.ts`），只缺编译期发射 ⇒ 本批补齐 |
| **组件内部渲染（P1-3 主体，2026-10-03）** | 注册表 + 偏移展开 + 子运行时装配 + props 双向——判据 ⑭ 三端同步全过（见 `docs/Proteus_Vapor三端能力对照.md`） |
| **插槽分发（P1-3，2026-10-03）** | 出口溶解 + 后备三态 + 孤儿摘除；判据 ⑮ 四条证据（同上） |
| **emits 子→父（P1-3，2026-10-03）** | `$emit` 动作 + `componentEmit` 绑定 + 桥路由（不冒泡）；判据 ⑯ 三证（同上） |
| **作用域插槽（P1-3，2026-10-03）** | 出口 props 子作用域求值 + 内容文本段重求值 + 作用域样式（`slotScopedSlots`）；判据 ⑰（文本/字段/内核一致） |
| 判据（3 组：边界标记 / props 路由 / style 并存 + 反向不误标） | 本仓"能力 + 判据 + 端上验证"三件套 |

| 不做（后续批次） | 原因 |
|---|---|
| 生命周期（setup/mounted/unmounted） | 与 `app-stack` 的屏生命周期机制可协同——独立批次 |
| 作用域插槽**解构形态**（`#x="{ count }"`） | 需把出口 props 展开成别名——精确诊断（不静默半支持） |
| 作用域插槽**动态重分发**（出口源变化 ⇒ 内容重求值） | 需"内容随出口更新"协议；当前只做初始分发（文档+note 如实标注） |
| 子组件内部状态（handler 里的 set/add） | 子组件无响应式状态（data 是构建期快照）——桥如实 note（不静默） |

### P2 · 语法完整性（对标官方 24 个 transform）

| # | 缺口 | 官方支持 | 建议 / 状态 |
|---|---|---|---|
| P2-1 | **v-for 嵌套** | ✅ | ✅ **已完成（2026-10-03）**：模板递归展开（`parentListId`/`outerScope`/`sourceField`）+ 运行时递归实例化（`cloneRow` 递归 + `parentOverrideId` + list-data 兜底）。任意层（含 3 层）实测通过，见 `tests/vapor-sfc-to-tree.test.ts` 嵌套块 4 组判据 |
| P2-2 | **混合文本** `a{{x}}b` | ✅ | ✅ **已完成（2026-10-03）**：段表切分（`textSegments`：静态段 + 表达式段）+ 实例化段求值 + 订阅表**合成一条**槽位（多插值不再互相覆盖）。判据：编译切分 / 首帧完整 / 行内行作用域 / 更新仍完整（真机 ⑩/⑩b） |
| P2-3 | **事件修饰符** | ✅ | ◐ **已完成（2026-10-03）**：`.stop`/`.self`/`.once` 真语义（`slot-runtime/dispatch.ts` 共享派发器，三端同一份）；`.prevent`/`.passive`/`.capture`/按键 = 诊断（无对应语义）+ 断言修法。★真机抓出一个真缺陷（B 路 `withModifiers` 只在 runtime-dom ⇒ 见下） |
| P2-4 | **v-model 修饰符** `.lazy/.number/.trim` | ✅ | ◐ **已完成（2026-10-03）**：MP 路径真语义（`.trim` ⇒ `String(v).trim()`；`.number` ⇒ **looseToNumber**（parseFloat+NaN 回退，不是 `Number()`）；`.lazy` ⇒ 事件通道换 `bindblur`）；组件形态/未知修饰符 ⇒ 诊断。Vapor 路径 **v-model 无回写通道 ⇒ 显式诊断**（不静默半支持） |
| P2-5 | **v-once / v-memo 真语义** | ✅ | ✅ **已完成（2026-10-03）**：`v-once` 槽位带标记、运行时首次写入后冻结；`v-memo` 依赖程序化（`memoGroups`）+ 帧感知组门（同帧一次判定 ⇒ 组内槽位整体放行）。★行内 v-once 与官方"共享缓存槽"语义如实诊断（不照抄反直觉行为） |
| P2-6 | **v-html / v-text** | ✅ | ◐ **已完成（2026-10-03）**：v-text ✅ 真支持（与插值同槽位）；★v-html **仍不支持**——能力清单此前写"可映射"**与实现不符**，经查内核/宿主均无富文本能力（单串 + 单次 drawText）⇒ 修正如实标注 |
| P2-7 | **动态属性 `:[k]`** | ✅ | ◐ **已完成（2026-10-03）**：字符串字面量形态（`:['width']`）**降级为静态属性名**（可用）；真动态（`:[k]`）⇒ 诊断 + **不建垃圾槽位**（此前建 `attr.k` 永不生效） |
| P2-8 | **表达式：函数调用**（受控） | ✅（任意 JS 表达式） | ✅ **已完成（2026-10-03）**：`PURE_CALLS`（内建纯函数，**语言级静态可证** ⇒ 进 L1 且 explain 显示"内建白名单"而非"人工担保"）+ `PURE_METHODS`（非变异方法）；`Math.PI` 等**全局常量编译期内联**（★修掉"静默渲染成空"） |
| P2-9 | **表达式：可选链 / 宽松相等** | ✅ | ✅ **可选链已完成（2026-10-03）**：编译期降级为 `cond`；宽松相等**保持拒绝**（语义陷阱，不冒险） |

### P3 · 内置组件与进阶（可延后但需**可见**）

| # | 缺口 | 说明 |
|---|---|---|
| P3-1 | Teleport | ◐ **透传已完成（2026-10-03）**：**不产包裹盒**（Vue 语义：逻辑容器不渲染元素）⇒ 几何与 Vue 等价；**传送语义未做**（需宿主多渲染面）⇒ 诊断带边界说明（内容渲染在**原位置**） |
| P3-2 | KeepAlive | ◐ **透传已完成（2026-10-03）**：不产包裹盒；**组件级缓存未做**（需组件实例系统 P1-3）。★**修正不实表述**：早先写"可复用 app-stack 保活"——那是**页面级**（`meta.branch.keepAlive` 三档），与**组件级** `<KeepAlive>` 不是同一件事，诊断里已分开说 |
| P3-3 | Transition / TransitionGroup | ✅ **Transition 已完成（2026-10-03 · 三端同步）**：编译期编成**预设动画规格**（`fade`/`slide-*`/`zoom`/`fade-slide-up` 闭集）、`<Transition>` **透传**（不产包裹盒 ⇒ 与 Vue 几何等价）、运行时在可见性**真的翻转**时交宿主动画入口（三端 14/14 · 判据 ⑬）。**TransitionGroup 未做**（需列表差异/move 过渡） |
| P3-4 | Suspense | ◐ **透传已完成（2026-10-03）**：不产包裹盒 + **只渲 `#default`**（`#fallback` 不建节点——否则内容双份）；**异步边界未做**（需异步组件系统） |
| P3-5 | 自定义指令 | ◐ **宿主指令注册表已完成（2026-10-03 · 三端同步 · 判据 ⑳）**：Vue 的指令是**用户脚本**（端上不执行 script）⇒ 不能"支持任意指令"，改为**闭集注册表**（`HOST_DIRECTIVE_SPECS`，唯一事实来源在运行时包）：表内名字 → 映射**已有宿主能力**；首批 `v-animate`（预设 → 通道规格，与 `<Transition>` **同一份表**；值语义 = mounted/updated 三态，判据 ⑳ 核宿主回执）。表外指令产精确诊断（说明"指令体不会运行" + 列出可用名字）；未知预设/修饰符/行内/值编不出**四类各有诊断**。**任意用户指令体（真执行 script）不做**（架构分工） |
| P3-5a | **动态组件 `<component :is>`** | ✅ **首帧解析已完成（2026-10-03 · 三端同步 · 判据 ⑲）**：`:is` 进 `SubscriptionTable.componentIs`（此前**完全消失**——无槽位无诊断 ⇒ 空壳静默）；实例化期求值 → 名字符串 → 走静态组件**同一条展开链**（子树/偏移/props）；静态 `is="Name"` 等价静态组件；假值 ⇒ 整节点摘除（Vue 同）。**运行时切换未做**（结构变更——编译期诊断 + 给替代路径 v-if/v-show） |
| P3-5b | **kebab 形态内置组件**（`<keep-alive>` 等） | ✅ **已修（2026-10-03 · 静默缺陷）**：Vue 官方两种写法都收（实证：官方编译器把 `<keep-alive>` 也解析成 `_KeepAlive`），此前判据只认 PascalCase ⇒ 小写写法**多建盒 + 零诊断**。现经 `normalizeBuiltinTag` **唯一入口**规范化（template/deps/events 三处 id 同源）⇒ 小写与 PascalCase 完全等价（测试含反向：非内置 kebab 标签不误伤） |
| P3-6 | 异步组件 `defineVaporAsyncComponent` | 同 P3-4 |
| P3-7 | `defineVaporCustomElement` | 我方有原生组件混用（#10 已验）——可考虑 |

### P4 · 生态级（长期）

- **JSX 支持**（官方 `vue/jsx` + `vapor` 选项）
- **SSR / 水合**（官方 `createVaporSSRApp`；我方 App 端不需要，但 Web 端可能）
- **vdom ⇄ vapor 互通**（官方 `vaporInteropPlugin`；我方对应"Vapor 组件内用 Vue 组件"——与 P1-1 同批）
- ✅ **`proteus explain` 能力视图**（2026-10-03 完成 · 门禁 `check:vapor-capability`）：把本清单变成**机器可查**——
  `explain --vapor` 输出**能力缺口总账**（**模板侧 + 订阅侧诊断合并**；★修出"诊断工具自己吞模板侧诊断"的静默缺陷：
  v-html / 自定义指令 / 内置边界等**绝大多数缺口产生在模板侧**，此前一条都不显示）；
  `--json` 输出机器可读形态（`supported` 字段可作 CI 判据）；**棘轮门禁**（`examples/pages` 27 个真实页面：
  error 级零容忍 + 按 code 计数只减不增，`--update` 拒绝调高）。
  ★扫描实测分布（数据驱动优先级）：`v-model 无回写` 22 · `无 :key 的 v-for 标识` 22（info）· 脚本钩子 8 · 表外指令 6 · 表达式不支持 3 · 作用域解构 1 · 内置边界 1

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

**建议顺序（更新）**：~~P0~~ ✅ → ~~P1-1/P1-2（组件边界+props 通道）~~ ✅ →
~~P2-1~~ ✅ → ~~P2-2~~ ✅ → ~~P2-3~~ ✅ → ~~P2-4~~ ✅ → ~~P2-5~~ ✅ → ~~P2-6~~（v-text ✅ / v-html ❌ 诚实标注）→ ~~P2-7~~ ✅ → ~~P2-8~~ ✅ → ~~P2-9~~（可选链 ✅ / 宽松相等 保持拒绝）→ **P2 段收官**；余下为 P3 内置组件（Teleport/KeepAlive/Transition/Suspense/自定义指令）与 P4 生态级。

### ★P2-1 增量说明（2026-10-03，做/不做如实标注）

| 做 | 依据 |
|---|---|
| 模板侧：`pendingCollectors` 收集器**栈**（替换单变量——内层一压就覆盖外层）+ `parentListId`/`outerScope`/`sourceField` 三字段 | 单变量版嵌套直接错乱（本仓实测）；三字段是运行时递归求值的全部输入 |
| 模板侧：行子树**不合并**（各列表管各自的子树） | 首版把内层后代并入外层 `subtreeIds` ⇒ 外层克隆与内层展开对同一批模板 id **撞车**（实测：外层 li 全丢只剩 i） |
| 运行时侧：`cloneRow` **递归展开**内层列表（行根经 `parentOverrideId` 挂到外层行实例） | 内层行根的"模板父"在外层子树里 ⇒ 不 override 时第 2 行起内层节点全挂到第一行（实测"都挤在第一个 li"） |
| 运行时侧：主循环**跳过**带 `parentListId` 的列表（只由父行克隆递归展开） | 两层都从主循环展开 ⇒ 内层按全局扁平行集扩一次、父行克隆又扩一次 ⇒ 重复 + 撞 id |
| 运行时侧：行集解析**兜底 `list-data` 槽位**（外层行内无绑定时唯一线索）+ `sourceField` 逐段下钻 | 外层行只有 `:key` + 内层 v-for 时无 `list-item` 槽位 ⇒ 行集空 ⇒ 外层 li 整行不展开（实测） |
| 判据 4 组（结构齐备 / list-data 兜底 / parentOverride 归属 / 3 层 2×2×2 全对） | 本仓"能力 + 判据 + 端上验证"三件套；每组对应一个实测缺陷 |

| 不做（后续） | 原因 |
|---|---|
| 嵌套 + 虚拟化描述（`virtual.rows` 现只在单列表给出） | 多列表行号空间不同源 ⇒ 宿主按行号二分会错配；宿主应退回全量物化（宁可多建不可错配） |
| 嵌套列表的**动态增删递归更新**（relink 路径） | 运行时的嵌套行集解析已支持（`vapor-list-e2e` V4 块已验更新指令）；「行结构变化 ⇒ 整棵子树重建」归 L2 结构变更通道，独立批次 |

★**纪律**：每一批都要**同时**补「能力 + 判据 + 端上验证」（本仓既有三件套），
且**先让不支持可见**（P0）**再谈补齐**——否则开发者会在"以为支持"的前提下踩坑。

### ★P2-2 / P2-3 增量说明（2026-10-03，做/不做如实标注）

**P2-2 混合文本（`a{{x}}b`）**

| 做 | 依据 |
|---|---|
| 模板侧切分为**段表**（`LayoutNode.textSegments`：静态段 + 表达式段；插值段在编译期即编成 `ExprProgram`） | 自绘树里文本是**元素属性**（无独立文本节点）⇒ 正解是段数组拼接，不是"建多个文本节点"；编译期编不出（如调用表达式）⇒ **诊断 + 不进段表**（否则源码会被当字面量，静默错值） |
| 订阅表**合成一条**文本槽位（源码 `'a' + (x) + 'b'`，走同一套表达式编译器） | 多个插值若不合成 = 多个 `text.content` 槽位指向**同一节点** ⇒ 运行时两条 SET_TEXT **后者覆盖前者**（只显示最后一个，静默）；静态段此前完全不参与更新 |
| 实例化**段求值**（`evalTextSegments`）+ 初值回填改走**求值器**（不再"取单字段/单源值"） | 组合表达式（段表 / `a + b`）用"取字段"回填会得到**半截文本**；首帧指令被调用方丢弃（既有假设），错值会一直显示 |
| 行内文本段走 **v-for 行作用域**（`makeScopedRead`，与 `VaporRuntime.makeRowCtx` 同一实现） | `前缀{{item.x}}` 在行内必须按行求值；用顶层 read 读到 undefined（实测） |

| 不做（后续） | 原因 |
|---|---|
| 「元素 + 文本」混排（`<p><b>x</b>尾{{y}}</p>`） | 需**文本节点结构化**（自绘树里文本是元素属性）——是节点模型问题，与本批（表达式问题）不同域；仍诊断拒绝 |
| 富文本 / `v-html` | 同域问题（P2-6） |

**P2-3 事件修饰符**

| 做 | 依据 |
|---|---|
| `.stop` / `.self` / `.once` **真语义**：产物置位（`EventBinding.stop/self/once`）+ 运行时**共享派发器**（`@proteus-vue/slot-runtime` 的 `dispatchGesture`） | 此前语义只**内联在 Android 桥**里且不支持任何修饰符 ⇒ `@click.stop` 失效形态是**静默多派发**（点按钮祖先 handler 也跑）。语义下沉到消费端包 ⇒ 三端同一份（本仓纪律） |
| `.prevent` / `.passive` / `.capture` / 按键修饰符 ⇒ **诊断 + 仍执行 handler** | 自绘 UI 无浏览器默认动作 / 无捕获阶段 / 无键盘事件 ⇒ 忽略修饰符是**忠实**的（不是"没实现对"）；但必须可见（诊断带修法），且**不阻碍**绑定（否则一个 `.prevent` 就把按钮点不动了） |
| 修饰符**链式**（`.stop.once`）与未知修饰符处理 | 旧 `MODIFIER_RE` 只看**末尾一个** ⇒ `.stop.prevent` 的第二个会被当过事件名（落到"事件未支持"，修法误导） |

**★真机抓出的一个真缺陷（B 路 / Vue 对照路径）**：模板一旦用 `@click.stop`，Vue 官方编译器产出
`_withModifiers(...)`——而 `withModifiers` **只在 `@vue/runtime-dom`**（它调 DOM 事件的
`stopPropagation`/`preventDefault`），本仓 A/B 的 B 路接的是**自绘宿主**（`runtimeModuleName` 指
`@vue/runtime-core`，该包不导出它）⇒ 挂载时抛 `withModifiers is not a function`；而 **QuickJS 无
`console`** ⇒ 错误上报自身又炸，设备侧只看到 `'console' is not defined`（**把真因盖住**——查了三轮）。
修法：生成的 render 里带一份**同语义 shim**（守卫表与官方逐条对应；`.stop` ⇒ 事件对象的
`stopPropagation` ⇒ 适配器派发循环在本跳跑完后 break），并**摘掉那条 import** + 绑别名
`_withModifiers`（首版只定义函数、引用处仍是 undefined ⇒ 第二轮实测才修对）。
★教训：**"跨宿主复用官方编译器产物"必须核对它的运行时依赖面**——`runtime-core` 是 DOM-free 的，
编译器的 `runtimeModuleName` 也不能凭空把它变成全功能运行时。

**验证**：单测 **+16**（`vapor-events` 修饰符 5 组 · `slot-runtime-dispatch` 7 组 · `vapor-sfc-to-tree`
混合文本 6 组含反向 + `vapor-v3-e2e` 闭环 2 组）；**真机**：`run-vapor` 判据 **11/11**
（新增 ⑨ `.stop` 终止冒泡 / ⑩+⑩b 混合文本首帧与更新完整）· `run-vapor-ab` 全过（文本序列对齐回归修复）·
`run-vapor-list` 6/6 无回归。**破坏性验证**：`.stop` 改"先停后跑" ⇒ 2 条红；`.self` 判据反转 ⇒ 红（基线先确认绿）。

### ★P2-4 / P2-5 增量说明（2026-10-03，做/不做如实标注）

**P2-5 v-once / v-memo（Vapor + MP 两路）**

| 做 | 依据 |
|---|---|
| `v-once`：槽位带 `once` 标记，运行时**首次写入后冻结**（`onceWritten` 集合） | 官方语义 = 只渲染一次。不建槽位会让首帧没值（回填走同一张表）⇒ "建槽+只写一次"观测等价且复用回填链。状态在**运行时实例**（重挂载 ⇒ 重新生效，与官方一致） |
| `v-memo`：依赖编译成 `memoGroups`（`ExprProgram`，可序列化），运行时**按组比较**（`Object.is` 逐项） | 官方 `withMemo` 的等价物；依赖程序化复用**同一套表达式执行器**（跨端禁 eval 纪律） |
| ★**帧感知组门**（`SlotRuntime.frameId`）：同一帧内一次判定 ⇒ 组内槽位**整体放行** | 组语义 = 子树整体更新；若无帧边界，一帧内多个源变化会只放行第一个槽位（其余被误跳过） |
| ★**memo 依赖的根必须进订阅图**（`depRoots` 并入 `roots`） | 否则"依赖变了"不触发求值 ⇒ 该子树**静默漏更新**（组语义的反面） |
| 诊断：非数组字面量 `v-memo` / 行内 `v-once`（官方共享缓存槽语义）| "优化没生效"必须可见；行内 once 的官方语义反直觉（首项冻结后复用给所有行）——不照抄、不静默 |

| 不做（后续） | 原因 |
|---|---|
| 行内 v-once 的官方"共享缓存槽"语义 | 反直觉（首项内容给所有行）；已诊断，静态内容建议去掉插值 |
| v-memo 在 v-for 行内（行作用域依赖比较） | 需按行建依赖快照（本版诊断 + 照常更新） |

**P2-4 v-model 修饰符**

| 做 | 依据 |
|---|---|
| MP 路径：`.trim` / `.number` 在**回写 handler** 端转换（`castValue` 语义）；`.lazy` ⇒ 事件通道换 `bindblur` | 官方 `vModelText`：先 trim 再 looseToNumber；`.lazy` = change 事件（MP 无 change，bindblur 是失焦提交语义最接近的） |
| ★`.number` 用 **looseToNumber**（`parseFloat` + `isNaN` 回退原值），**不是** `Number()` | `Number('') === 0` 会把空输入**静默清空**为 0——与官方不同（判据里显式锁死：产物不得含 `Number(e.detail.value)`） |
| 诊断：组件上的修饰符（官方走 `modelModifiers` prop，MP 无该通道）/ 未知修饰符 / 同模型多组修饰符（首见为准） | 三条都是"会静默失效或冲突"的形态 |
| **Vapor 路径**：`v-model` ⇒ 显式诊断（**无回写通道**，修饰符一并标注） | 此前静默半支持（"页面看着对、输入不生效"）——最危险一类；双向绑定请走 L0 或等 App 输入通道批次 |

**★真机 + 本地实测抓出的两个真缺陷（都已修 + 记入注释）**
1. **`v-memo` 元素在 B 路（Vue 对照）触发块级替换**：`withMemo` 复用缓存 vnode 时，父级 `dynamicChildren`
   长度在两个块间不一致 ⇒ Vue 走全量 `patchChildren`（而非块级快路径）⇒ 适配器报**结构变更**
   （removes/inserts）⇒ A/B 判据 ⑥ 按 `takePatches() === null` 判红。修法：夹具的 v-memo 元素加
   **静态 `:key`**（对齐稳定）。★这不是 Vue 的 bug（无 key 的同级替换本就可能重建），而是**夹具形态**
   问题——但它是 A/B 判据的**真实约束**，已写进夹具注释。
2. **`:key` 在非列表元素上会建槽位**（`attr.key`，kind='prop'）⇒ 运行时 `toF32('memo')` **抛错**
   （或数值 key 时发一条无意义 SET_PROP）。`:key` 在任何位置都只是 **diff 提示**、不是可渲染属性
   ⇒ `build.ts` 统一跳过（此前只跳列表内的 `isKeyBinding`）。
3. **`gen-vapor-fixture.mjs` 的文本级改写器丢裸属性**（`v-once` 这类**无 `=值`** 的属性被 attrRe
   忽略）⇒ A/B 的 B 路**丢了 v-once**（两侧语义不等价却"判据全绿"）。修法：补裸属性扫描
   （先挖掉带引号的值再扫，防值内 token 被误认成属性——首版实测注入过伪属性 `"color:": ""`）。

**验证**：单测 **+25**（`vapor-sfc-to-tree` once/memo 编译+运行时 6 组 · `mp-transform` 修饰符 7 组 ·
`vapor-events` 反向更新）；**真机**：`run-vapor` 判据 **12/12**（新增 ⑪ 逐节点核对：
`once-frozen=38B→节点[14]` / `plain-updated=42B→节点[8]` / `memo-clean=0B（跳过）` / `memo-dirty=38B→节点[16]`）；
`run-vapor-ab` 全过（B 路 v-once/v-memo 语义补齐后仍逐项等价）· `run-vapor-list` 6/6。
**破坏性验证**：once 门失效 ⇒ 红；memo 门失效（永远脏）⇒ 红（均先确认基线绿）。

### ★P2-6~P2-9 增量说明（2026-10-03 · **P2 段收官**）

**做（按能力清单顺序）**

| 项 | 做法 | 依据 |
|---|---|---|
| **P2-6 v-text** | 与插值**同槽位**（`text.content`）+ 覆盖子节点语义（与子元素并存 ⇒ 诊断） | 官方 `v-text` = 设置 textContent；与插值同通道 ⇒ 下游（订阅表/运行时/回填）**零改动** |
| **P2-6 v-html** | ❌ **仍不支持**，但**诊断改写为真实原因**（内核文本是单串、宿主单次 `drawText`，无分段字形/内联样式） | ★**修正能力清单的不实标注**：原文写"我方文本通道已支持样式串——可映射"，经查内核与宿主**都没有**富文本能力 ⇒ 如实标注（"可映射"是错的） |
| **P2-7 动态属性名** | 字符串字面量（`:['width']`）⇒ **降级为静态属性名**（等价 `:width`，零诊断）；真动态（`:[k]`）⇒ 诊断 + **不建槽位** | 首版把键名表达式当属性名 ⇒ 产物里出现 `attr.k` 之类**永不生效**的槽位（静默） |
| **P2-8 白名单纯函数** | 新 `PURE_CALLS`（`Math.*` 除 random / `String` / `Number` / `parseInt` / `isFinite` / `Number.isFinite`…）+ `call` 节点；**语言级静态可证** ⇒ 进 L1 且 explain 标"内建白名单"（与 `@proteus-pure` **人工担保**区分开——首版混为一谈，误导） | 官方任意表达式；我方取"**枚举可证的**"（与方案 §5.3 C1 一致），其余仍拒绝（不猜） |
| **P2-8 续 · 纯方法** | 新 `PURE_METHODS`（**非变异**）：`arr.join/slice/concat/indexOf/includes`、`s.trim/toUpperCase/toLowerCase/slice/substring/padStart/...`、`n.toFixed`；`mcall` 节点（接收者参与求值） | ★**真实项目驱动**：showcase 三个生命周期页写 `{{ phases.join(" → ") || "（暂无）" }}`——修 `hasCall` 漏记成员链调用后它们会掉 L0 ⇒ 正解是把这些可证纯的方法纳入白名单（而不是退回去装作没看见）。**变异方法**（`sort/reverse/push/splice`）与正则 `replace` 仍拒绝 |
| **P2-8 全局常量** | `Math.PI` / `Number.MAX_SAFE_INTEGER` 等 **编译期内联为字面量**（`GLOBAL_CONST_MEMBERS`）；已知全局的非白名单成员（`Math.foo`）⇒ 诊断 | ★修**静默错值**：`Math.PI` 此前编成 `mem(root('Math'))` ⇒ 运行时 `read('Math')` 恒 undefined ⇒ **渲染成空**且零报错 |
| **P2-9 可选链** | 编译期降级：`a?.b` ⇒ `(a===null \|\| a===undefined) ? undefined : a.b`（`cond` 程序）；`?.` 的**计算形态**（`arr?.[0]`）同样支持 | ★**不能**用 `==` 降级（`a == null` 语义正确但宽松相等是拒绝项）⇒ 显式用 `===` 双判（正是 JS [[Get]] 对可选链的定义）；空值渲染为**空串**（`String(undefined)` 会把字面量 "undefined" 写上屏） |
| **P2-9 依赖修正** | `OptionalMemberExpression` 是 babel 独立节点类型——此前不在 switch 里 ⇒ 走 default **遍历全部子节点** ⇒ 属性名被当**独立源**（幽灵依赖） | 修复后 `a?.b` 的 roots 只有 `a` |

**★本批抓出并修复的真缺陷（3 个，全部有实测证据）**

1. **`hasCall` 漏记成员链调用**（`deps.ts`）：只记"裸标识符调用"⇒ `Math.round(a)` / `arr.join()` 的 `hasCall=false`
   ⇒ C1 把它们当**静态可证纯** ⇒ 判 L1 但**求值器是 `expr` 形态（永不更新）** = **静默不更新**。
   修复：补记成员链调用名 ⇒ 顺带暴露了 showcase 三处真实用法（见 P2-8 续）。
2. **适配器缺 `textContent` 分支**（`renderer-app/selfdraw`）：Vue 对**非原生标签**上的 `v-text`
   产出 `textContent` **prop**（runtime-dom 有专门分支）——我方没有 ⇒ 该 prop 落进 `unknownKeys`
   ⇒ **文本整段丢失**。真机 A/B ②「文本数 A=17 vs B=16」当场抓到；修后两路各 17。
   ★这是"两条路等价"判据**又一次**抓住跨实现缺口（与 P2-3 的 `withModifiers` 同族）。
3. **`undefined` 结果被写成长字面量**（`instantiate.ts`）：回填把"求值器缺失"与"求值结果就是 undefined"
   混成一个返回值 ⇒ `{{ a?.b }}`（a 为空）会**误走源值兜底** ⇒ `String(null)` = `'null'` 字面量上屏。
   修复：求值结果分 `{ok,value}` 两态；文本写出统一"空值 ⇒ 空串"。

**验证**
- 单测 **+17**（`vapor-expr-p2` 15 组：白名单/常量内联/可选链语义与依赖/ v-text / 动态属性 + 适配器 `textContent` 2 组）；
  全量 **365 文件 / 4638 用例全绿**；
- **真机**：`run-vapor` 判据 **13/13**（新增 ⑫ 表达式能力逐前缀核对：`vt-→vt-3 · pi-→pi-3.14 · mx-→mx-7 · jn-→jn-a|b · oc-→oc-ok`）；
  `run-vapor-ab` 全过（含修 `textContent` 后的文本序列对齐回归）· `run-vapor-list` 6/6；
- **破坏性验证**：可选链 guard 写反 ⇒ 红；白名单校验失效 ⇒ 红；`join` 实现退化 ⇒ 红（均先确认基线绿）；
- 门禁：binding-matrix **重生成后覆盖率回到 99.1%**（L0 15 个——与改动前持平；说明白名单补全真的把三个
  "曾静默 L1 不更新"的绑定变成了 L1 可用）。

**诚实边界**
① `v-html` 富文本通道缺失（需内核分段文本 + 宿主分段绘制——独立批次）；
② 白名单是**闭集**：业务函数仍需 `@proteus-pure` 或 computed 预计算；
③ `Math.random` / `Date` 等不纯者刻意排除（模板渲染应为纯函数——否则更新不可预测）；
④ 可选链的**调用形态**（`fn?.()`）仍拒绝（`OptionalCallExpression`——需先决定"调用谁"）。

### ★★P3-3 `Transition` 增量说明（2026-10-03 · 三端同步）

**问题**：`<Transition>` 此前在 `UNSUPPORTED_BUILTINS` 表里（**当普通容器** ⇒ 无过渡语义、静默）。
而对齐官方时发现：Vue 的过渡靠 **CSS class**（`v-enter-from` → 浏览器自己过渡），我方**没有 CSS 引擎**——
但**内核有完整动画能力**（MA0-RT：`proteus_layout_anim_start` + 每帧 tick，曲线/弹簧/序列/循环齐备）。

| 做 | 依据 |
|---|---|
| **`<Transition>` 透传**（不占节点 id、不产包裹盒） | 与 Vue 语义一致（Transition 不渲染包裹元素）⇒ **与 Vue 路径几何等价**（多一层盒会让 A/B 判据红）。★template.ts 与 deps.ts **两处同一条判据**（id 空间同源） |
| **预设规格**（`fade` / `slide-up|down|left|right` / `zoom` / `fade-slide-up`） | `kind` 编号与内核 `AnimKind` **一一对应**（0=TranslateX/1=TranslateY/2=Scale/4=Opacity）——跨语言契约；离场 = 入场**反向**（与 Vue enter/leave 对称一致） |
| 运行时**可见性日志**（`takeVisibilityChanges`，取走即复位） | `v-show`/`v-if` 的切换在运行时表现为 `visible` 槽位写入；**去重**（relink 重写全部槽位不得误触发——单测锁定） |
| 桥 `drainTransitions`：查模板声明 → 组动画 → `proteusHost.animStart` | 两半信息在两处（声明在产物、翻转在运行时），桥正好两头都有 |
| 三端宿主帧循环（Android `driveKernelAnimFrames` / iOS `animStartFrameLoop` / 鸿蒙 `TransitionFrameCallback`） | 内核只做**求值**，"每帧推一次"是宿主职责（与几何同纪律）；**停判据 = 内核自报 `animActive()===0`**（权威）+ 3s 硬上限 |

**★抓出的真缺陷（4 个，全有实测证据）**
1. **`:duration="300"` 被忽略**（静默回落 220）：`@vue/compiler-dom` 把它归一为
   **不带 arg 的 `bind`**（与 `v-bind="obj"` 同形）⇒ 判据要认两种形态（静态 + 无 arg 且值纯数字）。
2. **Android 宿主只加 `animStart` 不够**：JNI 侧**按方法对条件注入**（`animStart` 与 `animTick`
   **同时存在**才暴露）⇒ 首版 JS 侧 `typeof proteusHost.animStart` 为 undefined
   ⇒ 过渡静默不播（判据 ⑬ 精确报出"宿主未实现 animStart"）。补 `animTick`/`animStop`/`animActive`。
3. **`transition_started` 被覆盖回 0**：桥里有两处 drain 调用 ⇒ 后一处把前一处的结果**覆盖**
   （事件已被取走 ⇒ drain 返回 0）⇒ 判据误判"没驱动"。去掉重复调用。
4. **鸿蒙 ArkTS 的 `postFrameCallback` 要 `FrameCallback` 实例**（闭包编译期报错）
   + `.so` 导出需在 `index.d.ts` 声明（两处都补齐）。

**验证**：单测 5 组（透传/规格/未知预设/无触发源/**运行时去重**）·
**三端真机 14/14 零跳过**（`check:vapor-three-end` 指纹一致：23 模板节点 / L1 16 / 12 源 / 实例化 37）·
判据 ⑬ = "2 条动画交给宿主"（`fade-slide-up` 双通道）· 破坏性验证（抹掉 `transition_started` ⇒ ⑬ 红）。

**诚实边界**：① `TransitionGroup` 未做（需列表差异/move 过渡）；② `v-if` 的**离场**
（元素从树上摘除）不在此路径（结构级动画属 L2 通道——本批只驱动可见性切换）；
③ 预设是**闭集**（无 CSS 自定义过渡：`v-enter-from` 那套在我方无对应物）。

### ★★P3 逻辑容器透传增量说明（2026-10-03 · 三端同步）

**问题（本仓实测的几何等价缺陷）**：Vue 里 `KeepAlive` / `Teleport` / `Suspense` / `Transition`
都是**逻辑容器**（缓存/传送/异步/过渡）——**不渲染包裹元素**。此前除 `Transition`（P3-3 已修）外，
其余三个都**当普通容器建了节点** ⇒ 同一份 SFC 在 Vapor 链上**多一层盒**
⇒ 布局多一层、几何与 Vue 路径**不等价**（A/B 判据会红）。

| 做 | 依据 |
|---|---|
| 四者**统一透传**（不占节点 id、不产节点） | Vue 语义：逻辑容器不渲染元素。`template.ts` 与 `deps.ts` **同一条判据**（id 空间同源——分叉 ⇒ 指令写错节点且不报错） |
| `Suspense` 只走 `#default`，且**下钻 `<template #default>`** | ① `#fallback` 若也建 ⇒ 内容**双份**（我方无 pending 态 ⇒ fallback 永不隐藏 ⇒ 叠影）；② `<template>` 是**插槽声明**（Vue 不产元素）⇒ 它自身也不能产节点（本仓实测：首版多一层 `template` 节点 ⇒ 槽位 nodeId 偏 1） |
| 诊断**精确化**（能力边界 + 当前行为 + 替代路径） | 首版文案有**不实表述**：`KeepAlive` 写"可复用 app-stack 保活"——那是**页面级**（`meta.branch.keepAlive` 三档），与**组件级** `<KeepAlive>` 不是同一件事 ⇒ 已分开说明 |

**★顺带抓出的真问题（Vue 官方约束）**：夹具里 `<KeepAlive><p-view/></KeepAlive>` 被 Vue 编译器**当场拒绝**：
`SyntaxError: <KeepAlive> expects exactly one child component.` ⇒ `KeepAlive` 要求**恰好一个子组件**
（原生标签不行）——这条官方约束已写进诊断与夹具注释。

**★门禁补强：生成器语法护栏（`node --check`）**
- **为什么**：生成器把 SFC 夹具写成 **JS 模板串**；夹具注释里的**未转义**反引号 / 美元花括号会
  提前闭合模板串 ⇒ 生成器抛 `SyntaxError`，而症状离根因很远。**本仓为此踩了 5 次**。
- **口径演进（诚实记录）**：首版**自写词法扫描**——**漏报**：文件里含引号的**正则字面量**会让
  扫描器把正则里的引号当字符串开始 ⇒ 后续全部错位（实测：注入未转义反引号仍报 0 违规）。
  ⇒ 改用 **`node --check`**（"这个字符会不会破坏模板串"的权威判据：注入 ⇒ exit 1 + 精确行列；
  合法转义写法正常通过）。
- **★顺带补上真实覆盖盲区**：这些生成器**此前从未被任何门禁编译过**（`check:script-compile`
  只编译 `.vue` 产物；生成器只有跑构建时才被执行）。
- 破坏性验证：向真实生成器注入未转义反引号 ⇒ 门禁 rc=1 并报精确行列；还原后绿。

**验证**：单测 **7 组**（四容器透传 / Suspense fallback 不建 / id 同源 / 反向不误伤普通元素与组件边界）·
**三端真机 14/14 零跳过**（`check:vapor-three-end` 指纹一致：27 模板节点 / L1 16 / 12 源 / 实例化 41）·
**A/B 几何等价 17 样本 0px**（透传的直接验证）· 全量单测 4645+ 通过。
