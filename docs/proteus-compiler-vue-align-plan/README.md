# 编译器 Vue 能力对齐（proteus-compiler-vue-align-plan）

> **立项：2026-09-08**。框架级专项——**以「Vue 全能力」为基准线**（开发者写标准 SFC 去跨端），逐能力对齐（aligned / partial / unsupported）+ 机器门禁，对齐 G-29/G-31/G-32 conformance 基线模式。
> 起因：p-popover 用 `getCurrentInstance()` 在 MP 编译产物 not defined——暴露「编译器对标准 Vue 能力的对齐没有权威基准线 + 逐能力状态门禁」的根因。

## 一句话

开发者写的是**标准 Vue SFC**（期望标准 Vue 能力全对齐），但编译器对 Vue 能力的处理是**需求驱动打地鼠**（`vue-compat-plan` §1 有一次性实测基线，但**没固化为「Vue 全集基准线 + 逐能力状态 + 编译断言门禁」**）。`getCurrentInstance` 只是「基准线内能力未兜底（静默输出未定义引用）」的首个暴露点。

## 基准线 = Vue 全能力（SSOT，权威拉取）

从 `@vue/runtime-core@3.5.42` + `@vue/reactivity` + `@vue/shared` + SFC 模板/指令/内置组件面拉取（`02-api-gap.md` A-D）：响应式 / 组件 API / 生命周期 / 模板指令+内置组件+SFC 特性——**全集**，非自选子集。

**每个能力必须给出三类之一**：`aligned`（正确翻译）/ `partial`（受限 + 编译期警告）/ `unsupported`（明确报错）——**绝不静默**。

## 目录

- `01-problem.md`：症状 + 铁证（getCurrentInstance not defined）+ 为什么是"缺基准线/门禁"而非"补翻译"。
- `02-api-gap.md`：**Vue 全能力基准线**（A-D 权威清单）+ 三类状态定义。**附权威拉取来源**。
- `03-root-cause.md`：根因（逐 API 白名单翻译 + 缺 Vue 全集基准线 + 不留 vue import）。
- `04-fix-direction.md`：修复 = ①固化 Vue 全集基准线 SSOT ②逐能力标状态+编译断言门禁 ③运行时/模板 API「三类之一」兜底反黑盒。
- `05-priority.md`：优先级（先 SSOT + 状态表 + 门禁 → 逐能力对齐 / 反黑盒兜底）。

## 进展（2026-09-08）

- **P0 Step 1-3 已落地**：
  - `packages/compiler/src/vue-compat.ts`（`VUE_COMPAT_MATRIX` + `vueCompatStatus`/`vueCompatLevel` + `VUE_COMPAT_UNKNOWN` 反黑盒兜底）→ 导出到 `index.ts`。
  - `tests/vue-compat-matrix.test.ts`（完整性/规则/代表性状态/漂移护栏）。
  - compiler 接线（`packages/compiler/src/script.ts`）：vue 命名导入逐 API 查矩阵 → aligned 静默 / partial·unsupported+degrade 警告 / **unsupported 无降级抛 CompilerError**。
  - `tests/vue-compat-compile.test.ts`（aligned 正常 / getCurrentInstance·h·createApp·useSlots 抛错 / partial 警告 / provide 正常）。
- **P0 Step 2（逐能力标状态）+ 黄金断言 已落地**：
  - **修复关键运行时回归**：`onMounted`/`onUnmounted` 预先是「生命周期正确映射到 onReady/onUnload」+「顶层副作用裸调用泄漏进 onLoad」（产物 `onMounted(...)` 无 import → ReferenceError，与 getCurrentInstance 同类）。已在 `extractTopLevelCalls` 跳过正则补 `onMounted`/`onUnmounted`（根因修复，`dist/mp-weixin` 验证无裸调用）。
  - **校准 16 项假 aligned**（仍为 `unsupported`·error / `partial`·warning）：运行时守卫 `isRef/isReactive/isReadonly/isProxy/isShallow`、内部渲染助手 `resolveComponent/renderSlot/mergeProps/toHandlers/withCtx/withScopeId`、`defineComponent/withDefaults`（产物裸标识符或抛错）、`version`（data=undefined）、`v-text/v-pre/v-once`（剥离不执行/语义丢失）。
  - **新增 `tests/vue-compat-aligned.test.ts`**（11 用例）：核心 aligned（ref/computed/watch/onMounted/v-if/v-for/v-model/v-html/:class/:style/<transition>/defineProps）黄金断言——锁「标 aligned = 产物是正确翻译」。
- **验证**：全量 **2564/2564 绿**；`build:web`/`build:mp` 通过；`dist/mp-weixin` 无裸生命周期调用。

## 决策 1（b）落地（组件内拿实例 → .in(组件) 测量）

- **场景**：p-popover `adapter.measureRect(TRIGGER_SELECTOR, scope)` 需 `.in(组件)` 下探到 p-* 自定义组件内部的 trigger（页面级 `wx.createSelectorQuery()` 查不到——glass-easel 隔离）。
- **根因**：旧实现用模板 ref `popoverRoot` 作 scope——**MP 模板 ref 永不赋值**（编译期警告「无对等绑定」）→ `this.data.popoverRoot` 恒 `undefined` → `.in(undefined)` 退化为页面级查询 → 测量失败。`getCurrentInstance` 也因 MP 编译 not defined 不可用。
- **方案**：**组件方法内直接用 MP 原生 `this`（组件实例）作 scope**——`adapter.measureRect(TRIGGER_SELECTOR, this)` → adapter `query.in(this)` 正确下探组件内部。`this` 是 MP 运行时时态（非 Vue 运行时 API），不违反「不翻译 Vue 运行时 API」红线。
- **编译器支撑**：`<script setup>` 方法允许声明 `this: T`（TS 伪参数声明方法 this 类型），但 JS 无此语法——编译器此前**未剥离 `this` 伪参数**（`astParamText`/`stripParamTypes` 对 `TSThisParameter`/`Identifier(name='this')` 保留 → 产物 `openMeasure(this) {` → `Unexpected token 'this'`）。已修：两者对 `this` 伪参数整体剔除（方法签名 `openMeasure()`，复用方法调用绑定的实例）。
- **验证**：`build:mp` 产物 `adapter.measureRect(TRIGGER_SELECTOR, this)`；探针 P8e4 断言同步；computed 一次性派生（框架既定，暂按现状）。

## 修复：partial 生命周期钩子「警告 + 干净剥离」（不再泄漏裸调用）

- **问题**：`onBeforeUnmount`/`onErrorCaptured`/`onUpdated` 等未映射 Vue 生命周期钩子在矩阵为 `partial`（警告），但 `extractTopLevelCalls` 的跳过正则只含 `onMounted|onUnmounted`——这些钩子被 `extractLifecycles` 打成「已剥离+警告」，又被当顶层副作用**裸注入 onLoad** → 产物 `onBeforeUnmount(...)` 无 import → 运行时 `ReferenceError`（getCurrentInstance 同类）。
- **修复**：`extractTopLevelCalls` 跳过正则补全全部 Vue 生命周期钩子（`onBeforeMount/onBeforeUpdate/onUpdated/onBeforeUnmount/onActivated/onDeactivated/onErrorCaptured/onRenderTracked/onRenderTriggered/onServerPrefetch`）——钩子现为「警告 + 干净剥离」，产物不再泄漏裸调用。
- **验证**：`render-backend-demo`（真实用 `onBeforeUnmount`）产物仅 `onReady()`（onMounted 映射）、无裸 `onBeforeUnmount(`；`examples/pages/render-backend-demo` 无裸调用；新增 1 断言 `vue-compat-compile.test.ts`（警告+不裸泄漏）。

> ⚠️ 待办：`withDefaults`/`defineComponent` 宏对齐（当前 unsupported）、computed 一次性派生是否需响应式二次求值（框架语义既定，暂按现状锁定）。

## 副产：发现的架构债（全端目标 → 编译器需平台化拆分）

对齐过程中确认：编译器当前**无平台参数**（`compileVueSfc` 无 target/renderer），把「目标=MP」写死进单一后端；平台选择发生在构建编排层（plugin-vite/cli），Skyline 特判散点硬编码。框架是**全端目标**（Web/MP(Skyline·WebView)/App(iOS·Android·Harmony)），此架构需**后续拆分平台抽象**。详见 **[proteus-compiler-platform-plan/README.md](../proteus-compiler-platform-plan/README.md)**（记录+立项输入，非当前实施）。Vue 对齐专项不受影响（对齐对象=MP 后端行为，Web 用真 Vue 无需对齐）。

## 关联
- 既定基线：`docs/vue-compat-plan.md`（§1 ✅/⚠️/❌ 实测）、`docs/vue-compat-advance.md`（Batch 1-7）、`docs/roadmap.md`（#2 编译能力）、L0 规约（原则 #0 第五投影 / #10.8 / 反黑盒 / 降级铁律）。
- **Vue 全集权威来源**：`node_modules/.pnpm/@vue+runtime-core@3.5.42/.../runtime-core.d.ts` + `@vue/reactivity` + `@vue/shared`（版本随 vue pkg 演进）。
