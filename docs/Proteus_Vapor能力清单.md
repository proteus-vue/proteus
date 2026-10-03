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
| 15 | 事件修饰符 | ◐ **部分支持（P2-3）** | `.stop` / `.self` / `.once` = **真语义**（产物置位 + 运行时共享派发器，真机判据 ⑨）；`.prevent`/`.passive`/`.capture`/按键=**诊断但不阻碍 handler**（无对应语义，忽略是忠实的） |
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
| 27 | **混合文本** `a{{ x }}b` | ✅ **已支持（P2-2）** | 编译期切分为段表（静态段 + 表达式段）⇒ 运行时求值拼接；首帧与更新都完整（真机判据 ⑩/⑩b） |
| 28 | **绘制声明**（glow/clip-path/mask/svg-path/fill-gradient） | ✅ **独有** | 属性式 JSON 声明 → 内核通道（官方 vapor 无此概念，属我方扩展） |
| 29 | 表达式：算术/三元/逻辑/成员链/数组长度/模板串 | ✅ | `ExprProgram` 编译通过 |
| 30 | 表达式：**函数调用** | ❌ 诊断 | `"含函数/方法调用（纯度无法证明，属 L1 准入条件 C1）"` |
| 31 | 表达式：**宽松相等 `==`** | ❌ 诊断 | `"不支持宽松相等…请改用 ===/!=="` |
| 32 | 表达式：**可选链 `?.`** | ❌ 诊断 | `"不支持可选链（可用 ?? 与三元改写）"` |
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
| **P1-3** | **组件内部渲染 / 生命周期 / 插槽分发 / emits** | 组件无法真正"跑起来" | ⏳ **后续批次**（本批只交边界与通道——见下方"增量说明"） |

**★P1 增量说明（本批做/不做，如实标注）**

| 做 | 依据 |
|---|---|
| 组件边界标记（`component` 字段） | 方案 §7.3 "组件边界强制 L0"——标记是 L0 语义的载体 |
| props 通道（`component-prop` → `CALL_COMPONENT_UPDATE`） | opcode/编码/解码/发射点**全部已存在**（`buffer.ts`/`slot.ts`），只缺编译期发射 ⇒ 本批补齐 |
| 判据（3 组：边界标记 / props 路由 / style 并存 + 反向不误标） | 本仓"能力 + 判据 + 端上验证"三件套 |

| 不做（后续批次） | 原因 |
|---|---|
| 组件内部渲染（用 `renderer-app` 实例化子组件） | 需要"组件注册表 + 实例化时机 + 与 L0/L1 边界协同"——独立批次 |
| 生命周期（setup/mounted/unmounted） | 同上（与 `app-stack` 的屏生命周期机制可协同） |
| 插槽分发（具名/作用域） | 需子树注入协议（`INSERT_BLOCK` 已被官方设计为对应指令） |
| emits（子→父） | 需反向事件通道（可复用 `events/handlers` + 冒泡链） |

### P2 · 语法完整性（对标官方 24 个 transform）

| # | 缺口 | 官方支持 | 建议 / 状态 |
|---|---|---|---|
| P2-1 | **v-for 嵌套** | ✅ | ✅ **已完成（2026-10-03）**：模板递归展开（`parentListId`/`outerScope`/`sourceField`）+ 运行时递归实例化（`cloneRow` 递归 + `parentOverrideId` + list-data 兜底）。任意层（含 3 层）实测通过，见 `tests/vapor-sfc-to-tree.test.ts` 嵌套块 4 组判据 |
| P2-2 | **混合文本** `a{{x}}b` | ✅ | ✅ **已完成（2026-10-03）**：段表切分（`textSegments`：静态段 + 表达式段）+ 实例化段求值 + 订阅表**合成一条**槽位（多插值不再互相覆盖）。判据：编译切分 / 首帧完整 / 行内行作用域 / 更新仍完整（真机 ⑩/⑩b） |
| P2-3 | **事件修饰符** | ✅ | ◐ **已完成（2026-10-03）**：`.stop`/`.self`/`.once` 真语义（`slot-runtime/dispatch.ts` 共享派发器，三端同一份）；`.prevent`/`.passive`/`.capture`/按键 = 诊断（无对应语义）+ 断言修法。★真机抓出一个真缺陷（B 路 `withModifiers` 只在 runtime-dom ⇒ 见下） |
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

**建议顺序（更新）**：~~P0~~ ✅ → ~~P1-1/P1-2（组件边界+props 通道）~~ ✅ →
~~P2-1（嵌套 v-for）~~ ✅ → ~~P2-2（混合文本）~~ ✅ → ~~P2-3（事件修饰符）~~ ✅ → P2-4（v-model 修饰符）/ P2-5（v-once/v-memo）→ 其余按需。

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
