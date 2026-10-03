# 三层挂载指令表达规格（GP1-a）

> 配套：《Proteus_全局挂载点与App根组件方案.md》·《Proteus_页面层级规范与多端一致性方案.md》
> 任务卡：《Proteus_全局挂载点任务卡清单.md》卡 GP1-a（+ GP1-b 层级编码）
> 契约落地：`packages/contracts/src/mount-layers.ts`（本规格的机器可读形态）
> 日期：2026-10-03　状态：**已定案**（GP1-b 一并收口）

---

## 0 结论（先看这个）

| 问题 | 结论 |
|---|---|
| 用**新指令**还是**层标记**表达三层？ | ★**零新指令**——层间顺序**用树序表达**（内核已理解的语义）；`mountLayer` 是**编译期标记** |
| 为什么不是新指令 | 新增 `SET_MOUNT_LAYER` 要三端内核 + 全部宿主跟着改，而它想表达的"顺序"内核**已经理解**（树序真源）——为已有语义造新指令 = 架构冗余 |
| 层间顺序（Global < Page < Overlay）怎么保证 | **编译期固定**：编译器把三层内容按序拼进同一棵树（Global 在最前） |
| 与层内四层（content/navigation/mask/popout）什么关系 | ★**两个正交维度**，**不得混用同一套数值**（GP1-b 硬要求） |
| 需要数值吗 | **只在 CSS 场景**（web/mp）：有效 z-index = **层域偏移** + 层内原语值（防跨层比较颠倒） |
| 参与批处理吗 | ✅ **同一棵树同一批**（跨边界次数 = 帧数不变）——**禁止**为"层"引入额外跨边界调用 |
| Host ABI 边界 | **本批零新增**（宿主按树序渲染）；独立表面（Android 子窗口/iOS UIWindow/鸿蒙子窗口）才需新 API——**那是 GP6 例外通道**，不在本规格 |

---

## 1 两个正交维度（★本规格最容易搞错的地方）

```
┌─ 层间（mount layer）—— 本规格定义 ────────────────────────────────┐
│   global  <  page  <  overlay      （编译期固定，不可配置）        │
│   回答："这一坨节点属于哪个挂载区"                                 │
└──────────────────────────────────────────────────────────────────┘
┌─ 层内（layer primitive）—— 《页面层级规范》+ contracts/layers.ts ──┐
│   content(1) < navigation(10) < mask(100) < popout(1000+栈深)      │
│   回答："同一挂载区内谁在谁之上"                                    │
└──────────────────────────────────────────────────────────────────┘
```

**典型误用（必须避免）**：把 `Global 层的 navigation` 与 `Page 层的 content` 放进同一套
数值里比较——`10 > 1` ⇒ 全局导航浮在页面之上，但层间语义要求 **Page 盖住 Global** ⇒
**顺序颠倒**（且静默、跨端不一致）。⇒ CSS 场景必须加**层域偏移**（§3）。

---

## 2 指令表达：零新指令 + 编译期标记

### 2.1 依据（为什么树序就够了）

本仓内核的 z-order **真源 = 树序（声明顺序）**（`contracts/layers.ts` 的 `LAYER_MAPPING`
注释原文："`android.translationZ` 与 `ios.zPosition` 的**真源**当前是**树序**"）。
⇒ 层间顺序**用树序表达**即可：**Global 节点在最前、Page 居中、Overlay 最后**——内核零改动。

### 2.2 `mountLayer` 标记（编译期事实，不是运行时操作）

```ts
// packages/contracts/src/mount-layers.ts
export const MOUNT_LAYERS = ['global', 'page', 'overlay'] as const
export const MOUNT_LAYER_ORDER = { global: 0, page: 1, overlay: 2 }
```

消费方（**三处，都不改内核**）：

| 消费方 | 用途 |
|---|---|
| **编译期校验** | C1/C2/C3（层声明位置 / 节点上限 / 禁业务 API）——见 §5 |
| **宿主**（未来） | 需要分容器/独立表面时按标记分组（**当前不需要**：树序已够） |
| **诊断/调试** | `proteus explain` 显示"这个节点属于 Global 层" |

### 2.3 声明形态（App.vue 的模板标签）

```vue
<!-- App.vue —— 唯一允许声明挂载点的文件（C1） -->
<template>
  <app-root>
    <global-layer>       <!-- → mountLayer: 'global'（逻辑容器：自身不产元素） -->
      <theme-provider />
    </global-layer>
    <overlay-layer>      <!-- → mountLayer: 'overlay' -->
      <toast-host />
    </overlay-layer>
  </app-root>
</template>
```

**标签语义**（`MOUNT_LAYER_TAGS`）：

| 标签 | 语义 |
|---|---|
| `<app-root>` | App.vue 的根（等价于页面模板的根元素）；**不属任何挂载层**（它是层的父） |
| `<global-layer>` / `<page-layer>` / `<overlay-layer>` | **逻辑容器**（自身**不产元素**——与 `Transition`/`KeepAlive` 同族）：层是"挂载区"不是"盒子"；要布局容器请自己包 `<view>` |
| （页面模板里的无标记节点） | 缺省 = `page` 层（**既有行为零变化**） |

---

## 3 层级编码（GP1-b）：域偏移，不是新数值体系

**原则**：层间顺序与层内顺序是**两个独立维度**，**不得混用同一套数值**。

```ts
export const MOUNT_LAYER_DOMAIN = 1_000_000        // 每层域宽
export function mountLayerDomainOffset(layer) {    // 层域偏移
  return MOUNT_LAYER_ORDER[layer] * MOUNT_LAYER_DOMAIN
}
```

**有效 z-index（仅 CSS 场景）= `mountLayerDomainOffset(层)` + `layerValueFor(原语, 端)`**：

| 层 | 偏移 | 层内 content | 层内 popout | 结论 |
|---|---|---|---|---|
| global | `0` | 1 | 1000 | Global 的 popout（1000）**低于** Page 的 content（1_000_001）✓ |
| page | `1_000_000` | 1_000_001 | 1_001_000 | — |
| overlay | `2_000_000` | 2_000_001 | 2_001_000 | Overlay 永远最上 ✓ |

**域宽 1_000_000 的依据**：层内最大是 `popout(1000)` + 弹层栈上限 16 ≈ 1016 ⇒ 留四个数量级余量。

★**诚实边界（与 `layers.ts` 同款）**：App 自绘端**不用**这个偏移——它的真源是**树序**
（内核尚无 zOrder 字段）。域偏移服务 ① web/mp 现状 ② 未来内核接入 zOrder 时的**既定契约**。

---

## 4 生命周期与批处理

### 4.1 生命周期（★**分端诚实**——方案 §1.2-bis）

| 层 | 自绘端（Android/iOS/鸿蒙） | MP 端 |
|---|---|---|
| **global** | 随 App（永不随页面销毁） | ★**每页一份实例**（N = 页面栈深度）——`custom-tab-bar` 同模式；**状态共享、实例不共享** |
| **page** | 随路由栈 | 随页面 |
| **overlay** | 显式控制（弹层栈） | 显式控制（当前页内的 `root-portal`） |

### 4.2 批处理（红线一致性）

- 三层在**同一棵树**里 ⇒ **同一批**提交（跨边界次数 = 帧数，不变）；
- **禁止**为"层"引入额外跨边界调用（如"每层一次 submit"）——那会直接违反批处理红线；
- 层标记**不随帧下发**（编译期事实，宿主启动时读一次即可）。

---

## 5 编译期校验（C1/C2/C3 的机器判据）

| # | 约束 | 判据 | 落点 |
|---|---|---|---|
| **C1** | 层声明只能出现在 **App.vue** | `isMountLayerDeclarableFile(filename)`（契约已备）；页面模板里出现 `*-layer` ⇒ 编译期 error | GP2-b |
| **C2** | Global 层节点数 ≤ **32** | `GLOBAL_LAYER_NODE_LIMIT`（契约已备）；超限 ⇒ error + 提示拆分/改用 Overlay | GP2-c |
| **C3** | Global 层不得含**页面级业务** | 引用 `useRoute` / 调 `navigateTo` ⇒ error；持有大集合（数组/Map 字面量）⇒ warning | GP2-d |

★**C1 是"架构能力"与"新逃生口"的分界**（方案 §3.2 原话）：开放运行时 `insertGlobal(vnode)`
会让 conformance 与 AI 可校验**同时失效且静默**。⇒ **不提供运行时 `insertGlobal` API**。

---

## 6 Host ABI 边界（与《Proteus_HostABI宿主抽象层设计方案》交叉确认）

**本批零新增**：宿主按**树序**渲染即可（层间顺序已由编译期拼接表达）；`mountLayer` 标记对
当前宿主**不必消费**（只服务诊断与未来演进）。

**何时才需要新 ABI**（明确划界，避免"提前造 API"）：

| 场景 | 需要的机制 | 归属 |
|---|---|---|
| 应用退到后台仍显示 | Android `TYPE_APPLICATION_OVERLAY` / 鸿蒙全局悬浮窗 | **GP6-a/c**（例外通道） |
| 系统键盘之上 | iOS 独立 `UIWindow` + `windowLevel` | **GP6-b**（例外通道） |
| 跨 UIAbility 显示 | 鸿蒙全局悬浮窗 | **GP6-c** |
| 同窗口内分层 | **无需新 ABI**（树序已表达） | 本规格 |

**交叉确认结论**：Host ABI 设计方案的 HA0 八接口**不含**任何"层"概念——与本规格的
"零新增"一致；GP6 的独立窗口通道若落地，才需要新增 ABI（届时按 HA0 的扩展流程走）。

---

## 6.5 各端落地对照（GP3 系列实做后的收敛表）

| | **Web**（GP3-a ✅） | **MP**（GP2-a / GP3-b1 ✅） | App 自绘（GP3-c ⬜） |
|---|---|---|---|
| 层标签本质 | 运行时组件（App.vue 是真根组件） | 编译期解壳（无渲染层 App） | 待定（我们定义根节点） |
| Global 跨路由 | ✅ **天然存活**（同一实例，在 RouterView 之外） | 🔴 **每页一份实例**（N；状态共享） | ✅ 单实例（我们定义根） |
| 层间顺序表达 | 容器 z-index = **契约域偏移** | **树序**（注入时前缀）——零新指令 | 树序 |
| Overlay 承载 | 渲染树内节点（**不用 Teleport**） | `root-portal`（teleport 编译产出） | 同窗口内分层（预期） |
| C1 校验时机 | **运行时软校验**（开发模式警告） | **编译期 error** | 待定 |
| 声明形态 | `<app-root>` / `<*-layer>` | **相同** | 同左 |

★**读法**：**声明形态统一、落地机制分端**——这正是"一套源码跨端"在本议题上的兑现方式；
上表每一行的差异都是**平台约束**（不是实现偷懒）：MP 无渲染层 App ⇒ 只能每页注入；
Web 有真根组件 ⇒ 天然存活。★**内存口径**：Web 与自绘端 Global 层是 **1 份**；MP 是 **O(N)**。

## 7 验收（GP1-a/GP1-b 的机器判据）

- [x] 契约落地：`packages/contracts/src/mount-layers.ts`（封闭集 / 顺序 / 域偏移 / 语义 / C1 辅助 / C2 上限）
- [x] 单元判据：域偏移不重叠 + 层间顺序不可配置 + 与层内四层正交（见 `tests/mount-layers.test.ts`）
- [x] GP2-a 编译支持（App.vue 模板 → 层标记 → 回收每页）——见 `tests/mp-mount-layers-compile.test.ts`
- [x] GP2-b/c/d 三条校验接进编译链（error 级，`compileVueSfc` 内）
- [x] **GP3-b1 MP 端 Global 层注入**（2026-10-03）——本规格的"零新指令 + 树序表达"结论在 MP 端的落地形态：
      · 外壳编译（`appShell: true`）→ `GlobalLayerSnippet`（与外壳产物**同源**，不从文本反解）
      · 每页注入：wxml **前缀**（树序 ⇒ Global 在下，**零指令**兑现）+ data/methods 合并 + wxss 并入
      · 状态共享：`_proteus/global-layer.js`（require 缓存 = 同实例；写镜像 + onShow 拉取两个方向）
      · 判据：`tests/mp-global-layer-inject.test.ts`（19 组）+ `tests/e2e-mp-global-layer.test.ts`（真机）
      · ★诚实边界：每页一份实例（N = 页面栈）——**不是**单实例跨页存活（方案 §1.2-bis）
- [x] **GP3-a Web 端挂载**（2026-10-03）——本规格在 Web 端的落地：
      · 三层 = 运行时组件（`packages/web/src/mount-layers.ts`），内容**原地渲染**（零 Teleport）
      · `<app-root>` 解壳（与 MP 编译器同款 ⇒ 两端 DOM 同构）
      · 层叠域偏移**取自契约**（`mountLayerDomainOffset`，不硬编码数值）
      · 判据：`tests/web-mount-layers.test.ts`（16 组）+ `tests/e2e-web-mount-layers.test.ts`（5 组真浏览器）
      · ★诚实边界：Global 层 Web 端是 **1 份**（天然跨路由存活）——与 MP 的 N 份**不同**，勿混述
- ⚠ **层内四层原语（`layer="layer-navigation"` 等）当前不产 z-index**（2026-10-03 GP3-a 实测取证）：
      MP 属性原样透传进 wxml 且 WXSS 无 z-index、Web 插件不处理、全仓 `layerValueFor()` 零消费者
      ⇒ **层间（本规格主体）已生效；层内今天只有校验、没有效果**。
      ⇒ 见《页面层级规范》§13.3 的 LY2（已就地更正其"web/mp 由 CSS 生效"的不实表述）。
      ★**推论**：不得假设 `layer="..."` 带来任何遮挡效果——既有弹层组件用的是**自带裸 z-index**。
