# 动态组件 `<component :is>` 的小程序（MP）兼容落地方案 · 调研稿

> 状态：**📋 调研稿（2026-10-12）——待用户拍板，尚未立项**
> 未登记 `docs/board-inventory.md`（立项时按决策 #177/#315 纪律补登记）
> 范围：**只做调研 + 方案设计，不改代码**。相关既有资产：`docs/vue-compat-plan.md`（Batch A 警告）·
> `docs/compiler-platform-alignment.md`（glass-easel 官方 WXML 语义模型）· `tests/vapor-dynamic-component.test.ts`（App 端 P3 判据）

---

## 0. 结论速览（TL;DR）

1. **三端现状**：Web 走 Vue 运行时原生支持；**App/Vapor 已落地**（P3 首帧组件名解析，决策 #843 前批 · 判据 ⑲）；
   **MP 只做编译期警告 + 产物保留无效标签**（`packages/compiler/src/template.ts:760`）——缺的不是"警告"，
   而是**降级路径**。
2. **平台事实**：WXML 没有 `<component :is>`；可用机制只有三个——`wx:if` 条件渲染、
   `<template is="{{...}}">`（官方明说 is 支持 Mustache 动态）、抽象节点 generic（**调用方静态指定**）。
3. **推荐主方案 A**：**编译期候选集穷举 → `wx:if` 分支组**。语义最完整（真自定义组件：props/事件/生命周期与静态组件
   走**同一条序列化链**），且**天然支持运行时切换**——MP 侧能力反而**强于** App 端当前的首帧限制。
4. **落地切面四处同源**（缺一即半失效、真机「未找到组件」整块不渲染——F-30 同型缺陷）：
   compiler 模板降级 + vue-compat 矩阵状态 + plugin-vite（usingComponents + 按需输出）+ 规则注册表/文案。
5. **核心决策点**：候选集**必须编译期可知**，且必须显式声明（源码可静态扫描）——推断不出就**编译期报错**，
   不静默、不产物爆炸。三种声明语法待拍板（§4.1）。
6. **附带收益**：`<KeepAlive><component :is>` 的 MP 落地路径**天然出现**（候选常驻 + `hidden` 切换）。

---

## 1. 现状盘点

### 1.1 三端对照（含代码位置）

| 端 | 状态 | 实现位置 | 语义能力 |
|---|---|---|---|
| Web | ✅ 原生（Vue 运行时） | 不走 Proteus 编译链 | 字符串/组件对象/KeepAlive 全支持 |
| App / Vapor | ✅ 已落地（**首帧解析**） | 编译：`packages/compiler/src/vapor/template.ts:4286` + `vapor/build.ts:437`（进 `SubscriptionTable.componentIs`）；实例化：`packages/slot-runtime/src/instantiate.ts:798`（求值→查注册表→走静态组件同一条展开链） | 首帧解析；**运行时切换不支持**（静态树模型无结构变更）；假值⇒整节点摘除；非字符串/未注册⇒note |
| **MP（小程序）** | ⚠️ **仅警告** | 规则 `template/is-component`（`packages/compiler/src/template.ts:828-842`）+ 序列化分支 `template.ts:760`；能力矩阵 `packages/compiler/src/vue-compat.ts:123`（`resolveDynamicComponent` = `unsupported`） | 编译期警告「小程序无动态组件」+ **原样输出 `<component>` 无效标签**（该分支不 return，继续走通用序列化） |

### 1.2 缺口性质（不是"忘了做"）

- 这是一条**反黑盒警告**（vue-compat Batch A，决策 #116）——设计目标就是"不静默"，**不是**实现动态组件。
- 连带缺口（本方案要一并面对的）：
  - `packages/plugin-vite/src/tag-scan.ts:161` 的诚实边界明写「**仅识别静态模板标签**；MP 本就无 `<component :is>`」；
  - 逃生门 `components.emit: 'all'`（决策 #177 族）只保证**组件文件被输出**，**不解决 wxml 里的无效标签**；
  - KeepAlive 在 MP 也是 `unsupported`（`vue-compat.ts`）——而 `<KeepAlive>` + `<component :is>` 正是 Vue 里最常见的搭档。
- `docs/compiler-platform-alignment.md` 现状表的「`generic:xxx` 泛型组件 ❌ 未用」一行说明：平台能力面我们**还没消费过**任何动态组件机制。

---

## 2. 平台能力取证（WXML 到底能给什么）

### 2.1 官方原文（关键三条）

| 机制 | 官方原文/事实 | 出处 |
|---|---|---|
| `<template is>` | 「**The is attribute can use the Mustache syntax to dynamically determine which template to render**」——官方示例：`<template is="{{item % 2 == 0 ? 'even' : 'odd'}}" data="{{...item}}"/>` | `developers.weixin.qq.com/miniprogram/en/dev/reference/wxml/template.html` |
| 模板作用域 | 「Templates have their own scope and can only use data passed in by `data` and modules defined in the template definition file」 | 同上 |
| `wx:if` | 惰性：初始 false **不渲染**；条件变化时**局部渲染/销毁重建**（`hidden` 相反：常驻 + 只切显隐，初渲成本高） | 官方条件渲染文档（腾讯云镜像同文） |
| 抽象节点 generic | 基础库 **1.9.6+**，「在使用 selectable-group 组件时**必须指定** selectable 具体是哪个组件」+ 需在使用方 `usingComponents` 声明 ⇒ **编译期固定** | `developers.weixin.qq.com/miniprogram/dev/framework/custom-component/generics.html` |

### 2.2 三机制对照（本方案的选型依据）

| 机制 | 运行时动态 | 能承载自定义组件 | props / 事件 | 产物成本 | 结论 |
|---|---|---|---|---|---|
| **`wx:if` 分支组** | ✅ | ✅ 真组件（兄弟节点） | ✅ 与静态组件**同一条序列化链**（零映射） | N 份分支 | **✅ 主方案** |
| **`<template is>` 动态** | ✅（官方明说） | ✅ 模板内可写组件标签 | ⚠️ 只能经 `data="{{...obj}}"` 传入（**作用域隔离**）；事件须落在**调用方**作用域 | N 份模板 + 1 分发点 | 🔶 备选（瘦身优化） |
| 抽象节点 `generic` | ❌ 编译期固定 | ✅ | ✅ | 低 | ❌ 排除（不覆盖运行时切换） |

### 2.3 glass-easel 语义模型佐证（本仓已登记，避免自造）

`docs/compiler-platform-alignment.md` §1.1（官方 `parse/tag.rs` 逐码核对）：
官方把 WXML 元素 parse 为 `ElementKind`——其中 **`If`（`wx:if/elif/else` 合并为「分支组」：`branches: Vec<(cond, children)> + else_branch`）**
与 **`TemplateRef`（`<template is>`：`target + data`）** 都是**一等节点语义**。

⇒ **方案 A 生成的分支组，正好落在官方 parser 认识的形态内**（不是自造语法）；而 §1.7③ 也印证 `wx:if/elif` = `Value`（可 `{{}}`），
即条件表达式是合法的动态位。

> ★诚实标注（方案 B 的前置未验证项）：`<template is>` 模板**不是组件**（无独立 json），模板内自定义组件的
> `usingComponents` **归属哪一份 json**（定义文件 vs 调用文件）我方**未实测**——若走方案 B 必须先做这一项真机取证。

---

## 3. 候选方案对比

### 方案 A（推荐）：编译期候选集 → `wx:if` 分支组

```wxml
<!-- 源码： <component :is="tab" :title="t" @pick="onPick" /> -->
<block wx:if="{{tab === 'panel-a'}}"><panel-a title="{{t}}" bind:pick="proteusPickX" /></block>
<block wx:elif="{{tab === 'panel-b'}}"><panel-b title="{{t}}" bind:pick="proteusPickX" /></block>
```

**优点**
- 语义最完整：候选是**真自定义组件**，props/事件/生命周期走**既有静态序列化链**（零新增运行时机制）。
- **天然支持运行时切换**（数据驱动 `setData` → 分支重建）；切换语义与 Vue 一致（Vue `:is` 默认也是卸载旧 + 挂载新）。
- 落在官方 `ElementKind::If` 语义内（§2.3）。
- 与 App 端「候选集」语义可收敛到**同一份 IR**（§4.3）。

**必须解决的实现点**
1. **props/事件透传复制到每个分支**：`:title` / `@pick` / `v-bind="obj"` 对象透传 / `:class` / `:style` 都要逐分支复制（复用 `serializeElement` 既有属性序列化器，**不新写映射**）。
2. **分支内节点 id 与 handler 名唯一化**：现有 handler 名按组件路径/模型路径派生（`componentModelHandler(model)`）——N 个同源分支会撞名 ⇒ 需按分支下标派生（`...__dyn0`）。
3. **假值 / 未注册名**：与 Vue 对齐（假值 ⇒ 全分支 false ⇒ 不渲染）；未注册名 ⇒ 编译期 error（不静默）。
4. **候选名 → 组分文件解析**：走 `tag-scan.ts` 同源规则（**应用组件优先，再框架组件**）——不能另造一套（F-30 的教训就是"两处口径漂移"）。

**成本**：产物体积 ∝ 候选数 × 分支子树（需阈值 + 警示，§4.5）。

### 方案 B（备选）：`<template is="{{...}}">` 动态分发

```wxml
<template name="__dyn0_panel_a"><panel-a title="{{t}}" bind:pick="onPick" /></template>
<template name="__dyn0_panel_b"><panel-b title="{{t}}" bind:pick="onPick" /></template>
<template is="{{__dyn0Name}}" data="{{...__dyn0Data}}" />
```

- **优点**：官方一等动态能力（§2.1）；主 wxml 只有一个分发点，可读性好。
- **代价**：模板作用域隔离 ⇒ 父作用域用到的每个值都要打包进 `data` 再 spread（属性绑定变"数据传递"）；事件处理函数须位于调用方的作用域；`usingComponents` 归属待实测（§2.3 注）。
- **定位**：适合"候选结构简单、无事件回传"的场景，可作为 A 之后的**瘦身优化**（候选多 + props 少时）。

### 方案 C（排除）：抽象节点 `generic`

`generic:x="Comp"` 由**调用方静态指定**，且需在使用方 json 声明 ⇒ **无法运行时切换**，只覆盖"容器决定子组件类型"的场景，不覆盖 `:is`。

### 方案 D（过渡）：维持 unsupported，但把警告升级为"可执行的降级指引"

保持现状语义，仅把文案升级为：① 指出候选集声明入口（方案 A 的语法）② 附 v-if/v-else 手写迁移片段。
作为 A 落地前的过渡态（若本轮不实现 A）。

**推荐**：A 为主；B 作后续瘦身；C 排除；D 仅作过渡。

---

## 4. 落地设计（工程切面）

### 4.1 候选集从哪来（★核心决策点，需拍板）

**硬约束**：`gen-routes.collectComponents` 与 `tag-scan.collectUsedFrameworkComponents` **都基于源码静态扫描**（`extractTemplateBody` + `extractTags`），
所以候选集**必须能从源码静态识别**，否则 usingComponents 与按需输出必然漏（→ 真机 `usingComponents 未找到组件`、模拟器启动失败）。

| 选项 | 写法 | 优点 | 缺点 |
|---|---|---|---|
| **(a) 显式属性** | `<component :is="tab" :is-candidates="['PanelA','PanelB']" />` | 就地声明、扫描器直接可见、无歧义 | 非 Vue 标准属性（需编译器**剥离**，不进产物/不传给组件） |
| (b) 扩展宏 | `defineOptions({ proteus: { dynamicCandidates: [...] } })` | 组件级集中声明、可复用 | 与本仓 `defineOptions` 现状（partial/剥离）耦合 |
| (c) 静态推断（兜底） | 从 `:is` 取值域推断：`ref('PanelA')` 字面量 / `const map = { a: PanelA, b: PanelB }` 的静态表 / 字符串字面量赋值 | 零标注、贴近 Vue 习惯 | 覆盖面有限（纯运行时拼名不可推断）；组件对象→标签名需路径解析 |

**推荐组合**：**(a) 为主 + (c) 兜底；都取不到 ⇒ 编译期 `error` + 修法示例**（不静默、不产物爆炸——与本仓"校验器按平台标准、
不让坏产物进产物"的纪律一致，见 `docs/compiler-platform-alignment.md` §1.3）。

### 4.2 改动切面（四处同源，缺一即半失效）

| # | 位置 | 改动 |
|---|---|---|
| ① | `packages/compiler/src/template.ts`（`serializeElement` 的 `node.tag === 'component'` 分支，L760） | 由"警告 + 原样输出"改为**分支组降级**（候选集从 (a)/(c) 取；逐分支复用既有序列化器）；产物**不得**再出现 `<component>` 标签 |
| ② | `packages/compiler/src/vue-compat.ts`（L123 `resolveDynamicComponent`） | 矩阵状态 `unsupported` → `partial`（说明 MP 为"编译期候选集分支组"降级），文案双语同步 |
| ③ | `packages/plugin-vite/src/gen-routes.ts`（`collectComponents`）+ `packages/plugin-vite/src/tag-scan.ts` | **候选集并入静态标签集合**（→ usingComponents 声明 + 组件本体按需输出）；★两处必须与 ① 候选集同源 |
| ④ | 规则注册表（`template/is-component`）+ `website` 双语文案 + `gen:reference` | 规则标题/描述/example 更新（防漂移：`tests/vue-compat.test.ts:63` 的登记断言） |

> ★"四处同源"是本仓既有铁律（F-30 / G12 的教训原话：**声明、本体、产物三处必须同源**）。

### 4.3 与 App 端语义的统一（架构收敛路径）

- 现状：App 侧 `componentIs` 表 = `{ nodeId, evaluatorId, expr }`——**只有选择表达式，没有候选集维度**；
  MP 侧要穷举，就必须多一个 `candidates[]`。
- 建议：语义层（`SubscriptionTable.componentIs` / `LayoutNode` 或 C-IR）把动态组件统一表达为 `{ selector, candidates[] }`：
  - App 端：用 `selector` 做首帧解析（`candidates` 仅用于诊断/未来切换）；
  - MP 端：用 `candidates` 做分支组穷举，`selector` 做分支条件。
  ⇒ **同一份语义、两端不同落地**（对齐原则 #10 / 架构方向 #290：语义统一 + 后端实现）。
- **分两步走**（降低风险）：**步骤 1** 只在 MP 编译链落地（不动 IR，改动面小、可独立验证）；
  **步骤 2** 再把 `candidates` 提升到语义层做跨端收敛。

### 4.4 附带收益：KeepAlive 在 MP 的落地路径

Vue 里 `<KeepAlive><component :is="x"/></KeepAlive>` = 切换**不重建**。MP 映射**天然存在**：
- 候选分支**全部常驻** + `hidden` 切换（官方：`hidden` 常驻、`wx:if` 销毁重建）；
- 与官方指导一致（"频繁切换用 hidden，否则 wx:if"）。

⇒ 建议规则：**KeepAlive 显式包裹 ⇒ `hidden` 常驻；未包裹 ⇒ `wx:if` 分支**。这同时给 KeepAlive 的 MP 状态（现为 `unsupported`）
找到了落点（可同批或紧随其后）。★诚实成本：`hidden` 模式下 N 个候选**同时挂载**，初渲成本高（需诊断提示）。

### 4.5 诊断清单（全部不静默）

| 场景 | 级别 | 说明 |
|---|---|---|
| 有 `:is` 但候选集推断不出 | **error** | 附三种声明语法示例（§4.1） |
| 候选集含未注册/不可解析名 | **error** | 列出可解析组件集合（走 tag-scan 同源解析） |
| `:is` 值为**组件对象**（非字符串） | **error** | MP 无运行时组件解析；给"字符串名映射"改法（App 侧同为受限） |
| 候选数 > 阈值（如 8） | warn | 产物膨胀预警（附实际体积估算口径） |
| 与 `<KeepAlive>` 组合 | info | 走 `hidden` 常驻路径（初渲成本提示） |
| `:is` 为**原生标签名**（`:is="'view'"`） | 待定 | 映射 WXML 原生标签 or error（需拍板） |
| 运行时拼名（`'Panel' + i`） | **error** | 候选集不可静态枚举 —— 编译期拦下（不给"看起来能跑"的假象） |

### 4.6 与既有告警的兼容

- 现有 `tests/vue-compat.test.ts:14`（"动态组件 → 警告（无效标签不再静默）"）**必须改写**为"降级产物断言"。
- 反向锁（防回归）：**无 `:is` 的模板产物逐字节不变**（照 App 侧 P3 的 `tests/vapor-dynamic-component.test.ts:120` 同型断言）。

---

## 5. 判据与门禁（拟）

| 层 | 判据 | 落点 |
|---|---|---|
| 编译单测 | 分支组存在 / 每个候选一套分支 / 假值全 false / 无候选集报错 / props+事件逐分支复制 / handler 名不撞 | 新增 `tests/mp-dynamic-component.test.ts` |
| 矩阵与规则 | `resolveDynamicComponent` 状态 = partial；规则登记不漂移 | `tests/vue-compat.test.ts`（改写）+ `vue-compat-matrix.test.ts` |
| 产物级 | `collectComponents` 返回值含候选（usingComponents 断言）；按需输出含候选本体 | plugin-vite 侧测试 |
| 门禁 | `pnpm build:mp` 绿 + 产物无 `<component` 残留（可加一条扫描） | 建议随批加 |
| 真机 | Skyline + WebView **双渲染器**各跑一次 tab 切换页（含事件回传 + 假值分支） | `build:mp` → 开发者工具/真机 |
| 记忆/登记 | 立项时登记 `board-inventory.md`；完成后按《收纳规范》写当月归档 + 决策条目 | `pnpm check:memory` |

> ★注意：MP 侧**不走** App 的三端真机回路（`check:vapor-three-end` / `hosts/*`），走 `pnpm build:mp` + 小程序侧验收。

---

## 6. 风险与诚实边界

1. **产物膨胀**：分支数 = 候选数；需阈值 + 警示 + 体积口径（本仓有 607KB 全量输出的前车之鉴）。
2. **候选集必须编译期可知**：`'Panel' + i` 这类运行期拼名无法覆盖 ⇒ 编译期 error（App 端同样受限，属跨端一致的诚实边界）。
3. **对象透传成本**：`v-bind="obj"` / `:class` / `:style` 逐分支复制，需与既有序列化器对齐（不做第二套逻辑）。
4. **语义差异（不可消除，只可记录）**：Vue `:is` 支持**组件对象**（非字符串）；MP 只能编译期映射到**标签名**。
5. **方案 B 的前置未验证项**：`<template is>` 内自定义组件的 usingComponents 归属（§2.3 注）——走 B 前必须真机取证。
6. **本方案对 Web/App 零影响**：只改 MP 编译链分支（反向逐字节锁）。
7. **未做**：动态组件与**异步组件**（`defineAsyncComponent`）的组合——MP 无运行时组件加载，仍维持 unsupported。

---

## 7. 待拍板项（3 个）+ 后续动作

1. **候选集声明语法**：(a) 显式属性 `:is-candidates` / (b) `defineOptions` 宏 / (c) 推断优先——**推荐 (a)+(c) 兜底**。
2. **是否本轮就支持运行时切换**：`wx:if` 分支**天然支持**（建议"是"——MP 侧因此强于 App 端当前首帧限制，可作为 App 端后续切换能力的语义参照）。
3. **是否同批解 KeepAlive**（`hidden` 常驻映射，§4.4）。

后续动作（拍板后）：
- 立项 → 登记 `docs/board-inventory.md`（决策 #177/#315 纪律）+ 决策条目（号 +1，追加 `docs/project-memory-archive/decisions.md`）；
- 按 §4.2 四处同源改动 + §5 判据；完成后写当月归档 + 主文件速览一行。

---

*调研稿完。凡引用外部事实均标注来源；凡未实测项均显式标注（不臆断平台行为）。*
