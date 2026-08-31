# 附录 A：参考实现对标 —— NativeScript-Vue 可借鉴点清单

> **目的**：在「Vue 自定义渲染器 + 原生直调」这条无人区路线上，NativeScript-Vue 是**唯一一个已经被工程验证能跑通的开源参照**（`nativescript-vue/nativescript-vue`，Apache 2.0 / MIT 系宽松协议）。本章逐项对照其源码，提取「可借鉴的接口形态」与「Proteus 刻意不做/要做得更好的部分」，作为 App Renderer M1-M3 的实现依据。
>
> **结论先读**：NS-Vue 验证了「Vue 自定义渲染器 + 原生 FFI 直调」在工程上**完全可行、可上生产**；但它**没有验证** Proteus 路线独有的三块——① IR 骨架统一三端、② AOT + 静态首帧 IFR、③ Web/Skyline/App 三端同源。因此正确姿势是：**NS-Vue 当「JSI binding + Vue Renderer 适配」的参考实现读，不当基座。**

---

## A.1 NS-Vue 渲染管线总览（对标对象）

NS-Vue 用 Vue 官方 `createRenderer` API 起自定义渲染器，把 Vue VNode 操作翻译成 NativeScript 原生 View 操作：

```ts
// src/renderer/index.ts（简化）
export const renderer = createRenderer({
  patchProp,   // 属性/事件/style/class → Native View
  ...nodeOps,  // createElement / insert / remove / createText ...
})
```

调用链路（**这是我们要借鉴的主干**）：

```
Vue VNode
  └─ renderer.patchProp + nodeOps        ← Vue 官方 RendererOptions 接口
       └─ NSVElement / NSVNode（Custom DOM 中介层）
            └─ NativeScript View (UILabel / TextView / ...)
                 └─ FFI / Marshalling 直调 Native API  ← 等价于 JSI，无 JSON bridge
```

**关键事实（已核实）**[citation:2][citation:6][citation:14]：

| NS-Vue 层 | 源码位置 | 职责 |
|-----------|---------|------|
| 渲染器入口 | `src/renderer/index.ts` | `createRenderer({ patchProp, ...nodeOps })` |
| 属性补丁 | `src/renderer/patchProp.ts` | `class`/`style`/`@tap`/`v-model` → Native |
| 节点操作 | `src/renderer/nodeOps.ts` | `createElement` 等 → `new UILabel()` |
| 事件 | `src/renderer/modules/events.ts` | 事件名归一（`onTap` → `tap`） |
| Custom DOM | `src/dom/index.ts` | `NSVNode / NSVElement / NSVText / NSVRoot` |
| 元素注册 | `src/registry/index.ts` | `elementMap` + `registerElement` |
| 内置元素 | `src/nativescript/elements.ts` | 预注册 Label/Button/Layout 等 |
| 应用入口 | `src/index.ts` | `createApp` + `mount` + `registerElement` |

**官方定位（直接引述）**[citation:2]：

> - *"it's a custom renderer for Vue that renders to NativeScript views"*
> - *"No, it runs your JavaScript/Vue code in an embedded JavaScript runtime ... that exposes bindings to all native APIs automatically (discovered at build-time)"*
> - *"all `<template>` blocks are rendered via NativeScript Views ... will render a UILabel on iOS and an android.widget.TextView on Android"*
> - *"both NativeScript and NativeScript-Vue are built in a way that it's easy for plugins ... to register new elements"*

**这四句话正好覆盖了 Proteus App 端要解决的四个问题**：自定义渲染器、原生 API 全可达、标签自动映射、插件可注册新元素。**方向已被 NS-Vue 证真。**

---

## A.2 开源合规边界（务必先明确）

NS-Vue / NativeScript 整体为 **Apache 2.0**（部分 runtime 子仓 MIT），属宽松协议[citation:12]：

- ✅ **允许**：阅读源码、借鉴架构思路、改写后用于自有项目（含闭源商用）
- ✅ **条件**：保留原许可声明、标注修改、不冒充 NativeScript 品牌
- ❌ **不允许**：把 `nodeOps.ts` / `dom/index.ts` 整文件复制进 Proteus（属衍生作品，需带 notice）
- ✅ **推荐**：参考**接口划分方式**（函数签名、注册表结构、view flags 语义），自行重写实现

> **Proteus 准则**：`p-*` 映射表、`ProteusElementRegistry`、`createApp` 扩展形态可以**对标 NS-Vue 的接口形状**，但具体实现走 Proteus 自己的 IR + JSI 路径，**不复制源码**。

---

## A.3 十项代码级借鉴点清单

> 每条格式：`[NS-Vue 源码锚点]` → **借鉴点** → `Proteus 落地位置`

### ① RendererOptions 接口划分 —— `src/renderer/index.ts`
NS-Vue 把 `patchProp` 与 `nodeOps` 拆成两个模块再展开传入。
**借鉴**：Proteus App Renderer 同样将 `createRenderer` 的 `RendererOptions` 拆为 `patchProp.ts` + `nodeOps.ts` + `event.ts`，保持 Vue 官方约定，便于社区迁移。
→ `proteus-app-runtime/src/renderer/index.ts`（M1）

### ② patchProp 分发策略 —— `src/renderer/patchProp.ts`
NS-Vue 用 `switch(key)` 分发 `class`/`style`/事件/model，未知 key 走默认 `patchAttr`[citation:10]。
**借鉴**：完全复用该分发结构，但**默认分支不直写 Native，而是生成 IR 指令**（`SET_PROP`）——这是 Proteus 相对 NS-Vue 的核心差异（见 A.4 ③）。
→ `renderer/patchProp.ts`（M1）

### ③ nodeOps 的节点生命周期 —— `src/renderer/nodeOps.ts`
`createElement` → `insert` → `remove` 三件套对应 Native View 的 `initNativeView / addChild / removeChild`。
**借鉴**：nodeOps 签名形态 1:1 对齐 Vue 官方 `RendererOptions`；但内部把调用转译为 **IR 指令序列**而非立即操作 NSVElement。
→ `renderer/nodeOps.ts`（M1）

### ④ Custom DOM 中介层 —— `src/dom/index.ts`
NS-Vue 定义 `NSVNode / NSVElement / NSVText / NSVRoot`，每节点带 `nodeId` + 父子引用[citation:17]。
**借鉴**：保留 `nodeId` + 父子链概念（DevTools TraceBus 要用的**稳定 ID 正是这个**），但**把 NSVElement 从"直接包 Native View"改为"持有 IR 节点 + 延迟落 Native"**，为 AOT 首帧预留空间。
→ `renderer/dom/`（M2，与 DevTools plan TraceBus 对齐）

### ⑤ View Flags —— `src/dom/index.ts`（`SKIP_ADD_TO_DOM` / `CONTENT_VIEW` / `LAYOUT_VIEW` / `NO_CHILDREN`）[citation:14][citation:17]
**这是 NS-Vue 里最值得抄的一块**：用位标记区分「内容容器 / 布局容器 / 叶子」三种插入语义，解决了 `Frame/Page/ActionBar` 这类非标准父子关系。
**借鉴**：**直接等价迁移**为 IR 的 **node kind 标记**（`layout / content / leaf / portal`），但**在编译期（Compiler IR）固化，而非运行时判断**——性能更好，且三端共用同一份标记。
→ `Component plan` 的 `p-*` tag schema + `Compiler plan` IR node flags（M2）

### ⑥ 元素注册表 —— `src/registry/index.ts`（`elementMap` + `registerElement`）[citation:13][citation:17]
注册流程：归一化名称（去连字符、转小写）→ 查 `elementMap` → 调 resolver 取 View 类 → 关联 view meta。
**借鉴**：**接口形态几乎原样复用**，但做两处升级：
- resolver 返回的不再是 Native 类，而是 **`p-*` 映射条目**（含 iOS/Android/鸿蒙三端 View 描述 + view flags）
- 注册发生在**构建期（AOT）**，运行时 `elementMap` 为**只读冻结对象**，启动零开销
→ `registry/elementRegistry.ts`（M1，对齐 Component plan 的 `defineSlice` 风格）

### ⑦ 自定义原生组件接入 —— `src/nativescript/elements.ts` + `View.createNativeView`[citation:9][citation:16]
接入范式：`registerElement('Checkbox', () => Checkbox)`，自定义 View 只需 `extends View` 并实现 `createNativeView / initNativeView / disposeNativeView`。
**借鉴**：**完整保留此范式**（这是 NS-Vue 生态扩展性的来源），但把生命周期钩子**同时注册到 IR 指令表**，使自定义组件的创建也能被 AOT 预编译 + `--trace-app` 追踪。
→ `registry/defineNativeComponent.ts`（M3）

### ⑧ FFI / 元数据生成 —— NativeScript Runtime（`metadata-generator` + `LibFFI`）[citation:12]
构建期：iOS 用 **Clang `HeaderSearch` + `RecursiveASTVisitor`** 扫 Obj-C/Swift 头 → 二进制 metadata；Android 用 **Apache BCEL** 扫 Java/Kotlin 字节码 → JNI 签名；运行时加载 metadata 建立双向绑定，**无反序列化开销**。
**借鉴**：**这套「构建期扫 SDK 头 → 生成绑定 + `.d.ts`」的机制直接复用思路**（即 Types plan §类型自动生成的参照实现），三端各自生成器：
- iOS：`clang` AST → `NativeBindingIOS`
- Android：BCEL/ASM → `NativeBindingAndroid`
- 鸿蒙：ArkTS 声明 → `NativeBindingHarmony`
→ `08-type-generation.md`（已存在，本节为其实现锚点）+ M2

### ⑨ 元数据过滤（`native-api-usage.json`，whitelist/blacklist）[citation:18]
NS 用 `whitelist-plugins-usages` + `whitelist/blacklist` 通配符控制 metadata 体积与安全性。
**借鉴**：**直接等价**为 Proteus 的 `app.config.ts → nativeApiUsage` 配置，配合 Glass plan 的「能力探测」做**摇树**：未用的 Native API 不进元数据，控制包体积（对齐 Lynx 的小体积思路）。
→ `Compiler plan` 的摇树配置（M3）

### ⑩ Vue DevTools 集成 —— `devtools.js` + `--vueDevtools` flag[citation:14]
NS-Vue 复用标准 Vue DevTools（起独立 server、bridge 注入）。
**借鉴**：Proteus DevTools plan 的 **TraceBus** 应**优先对接 Vue DevTools 协议**（组件树、状态、事件），再叠加自有的 transform/IR/JSI 追踪层——**避免重复造组件调试器**。
→ `DevTools plan` M4（M4 对齐 App Renderer M3）

---

## A.4 Proteus 刻意不照搬的三处（差异化来源）

| # | NS-Vue 做法 | Proteus 改进 | 收益 |
|---|------------|-------------|------|
| ① | Custom DOM（NSVElement）**运行时中介** | **跳过 NSVElement，VNode diff → IR 指令 → JSI** | 少一跳，diff 成本在 JS 侧、落 Native 同步批处理 |
| ② | 无 AOT、无 IFR，**启动走完整 Vue 引导** | AOT codegen（IR 二进制）+ 静态首帧 IFR | 首帧 <200ms，追平 Lynx（详见 `proteus-performance-plan`） |
| ③ | **仅 iOS/Android**，无 Web / 小程序 | **同一份 IR 三端共用**，Renderer 只是 IR 消费者 | Web+Skyline+App 三端同源（本方案核心卖点） |

**一句话总结改进 ① 的架构意义**（这是整个 App Renderer 最锋利的一点）：

> NS-Vue 的 `nodeOps.createElement` **立即** `new UILabel()`；Proteus 的 `nodeOps.createElement` **产出一个 IR 节点**，`flush()` 阶段再把**整棵子树的差量指令**通过 JSI **批量**下发 Native。
>
> 效果：跨 JS↔Native 边界的调用次数从 **O(节点数)** 降到 **O(commit 次数)**，高频更新场景下这一项 alone 就能换来数倍 fps 提升——且**天然兼容 AOT**（AOT 产物就是预序列化的 IR 指令流）。

---

## A.5 可行性论证（为什么这条路线能做成）

NS-Vue 已经证明前两件事可行；剩下三件是 Proteus 独有、且**无已知不可行项**：

| 命题 | 状态 | 依据 |
|------|------|------|
| P1：Vue 自定义渲染器可输出到 Native View | ✅ **已被 NS-Vue 证真** | 生产可用，尤雨溪公开推荐[citation:7][citation:11] |
| P2：JS 可直调 100% Native API（无 bridge 序列化） | ✅ **已被 NativeScript Runtime 证真** | FFI + 构建期 metadata，含 `.d.ts` 生成[citation:4][citation:12] |
| P3：IR 骨架统一 Web/Skyline/App | 🔶 **待 M1 验证**（设计无阻塞项） | Compiler plan IR + Component `p-*` 已定义 |
| P4：AOT + IFR 首帧直出 | 🔶 **待 Performance plan B1 验证** | 详见 `proteus-performance-plan/03-aot-codegen.md` |
| P5：`<pg-glass>` preset 收敛 L3 系统级质感 | 🔶 **待 App Renderer M3 + Glass plan** | JSI 直调 `UIGlassEffect`/fractal |

> **风险声明（诚实）**：P1/P2 已被开源实现证真，Proteus 不承担这两项的探索风险；**真正的未知只在 P3-P5**，且三者互不阻塞（P3 失败不影响 P1/P2 单独可用）。这意味着 App 端**可以先只做「P1+P2」（M1-M2）交付一个可弹 Native View 的 demo，再增量叠加 P3-P5**——符合「最小验证优先」原则。

---

## A.6 与 uni-app / RN / Lynx 的定位对照（重申独创性）

| 方案 | Vue 自定义渲染 | JSI/FFI 直调 | IR 骨架 | Web+小程序+App 同源 |
|------|:---:|:---:|:---:|:---:|
| uni-app 传统 | ✅（WebView） | ❌ JSBridge | ❌ | ✅ |
| uni-app x | ❌（放弃 JS） | n/a | ✅ UTS | ⚠️ 各端独立编译 |
| **RN** | ❌ | ✅ JSI | ❌ | ❌ |
| **Lynx** | ❌ | ✅ 自研通道 | ✅ 字节码 | ✅（无小程序） |
| **NS-Vue** | ✅ | ✅ FFI | ❌ | ❌（仅 iOS/Android） |
| **Proteus** | ✅ | ✅ JSI | ✅ | ✅ |

**NS-Vue 是「Vue 渲染 + 直调」这一角的唯一开源实现参照；Proteus 在其基础上叠加「IR + 三端同源 + AOT/IFR」，构成前述「无人区」路线。**

---

## A.7 参考来源

- `nativescript-vue/nativescript-vue`（GitHub）—— `src/renderer/`、`src/dom/`、`src/registry/`、`src/nativescript/elements.ts`、`src/index.ts`、`devtools.js`
- `NativeScript/NativeScript`（GitHub）—— `metadata-generator/`、`LibFFI`、运行时 FFI（MIT/Apache 2.0）
- NativeScript 官方文档：`Metadata`、`Android Runtime / Execution Flow`、`Creating Custom Native Elements`
- 官方站点：nativescript-vue.org（架构定位、API 可达性说明）

> 所有「借鉴点」均对应上述公开源码的具体文件/符号；**实现时需自行重写、不复制源码**，并保留原许可声明。
