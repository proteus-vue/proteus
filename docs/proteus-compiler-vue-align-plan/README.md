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
- `06-mp-true-device-acceptance.md`：**Vue 能力对齐真机验收专项栏目**——矩阵只给编译期状态，本栏目把每个能力映射到真机运行时断言（wechatide skill-CLI + console 零错门禁），配套 `tests/e2e-vue-compat.test.ts`（`PROTEUS_MP_E2E_WXIDE=1` 运行，`e2e-*` 被排除不进全量）。

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

## P1 校准（2026-09-08）：nextTick 转 aligned + partial 诚实性修正

- **`nextTick` → aligned**：编译器新增翻译——`nextTick(cb)` → `wx.nextTick(cb)`；`nextTick()`/`await nextTick()` → `new Promise(r => wx.nextTick(r))`（wx.nextTick 不做 Promise，await 需包装）。命中「Vue API 但产物裸标识符 → not defined」的同类坏产物，现已修。黄金断言 `tests/vue-compat-aligned.test.ts`（cb/await 形态）。
- **partial 诚实性校准**（多数 partial 项之前标「降级」但产物是**裸调用/undefined** = 假降级）：
  - 转 `unsupported`·error：`toRef`/`toRefs`/`toValue`/`unref`/`shallowReactive`/`shallowReadonly`/`useModel`/`defineOptions`/`defineModel`/`version`（产物 `this.x=fn(…)` 裸标识符或 `data.x=undefined`）。
  - 保留 `partial`：`readonly`（字面量→data 可用降级）、`defineSlots`（宏剥离）、`onBeforeUnmount`/`onErrorCaptured` 等生命周期（干净剥离+警告）、`v-text`/`v-pre`/`v-once`（模板剥离+警告）。
- 校准依据：全部经最小 fixture 实测分类（诚实降级 vs 假降级），且这些能力在 MP `.vue` 中均未被使用（无生产破坏）；转 error 反黑盒安全。
- **验证**：全量 2571/2571 绿；build:mp / build:web 通过。

## P1 第二批（2026-09-08）：`withDefaults` 宏转 aligned

- **`withDefaults` → aligned**：编译器原把它当函数调用（`const p = withDefaults(...)` 落 data/语法错误），现识别为宏——
  - `handleConstToData` 将 `withDefaults(` 纳入宏早退（不落 data、不裸调用）；
  - `extractProps` 全树扫描收集 `withDefaults(defineProps<T>(), D)` 并读取第二参默认值对象 D，**合并默认值到 `properties.value`**（字面量有效；函数默认仍忽略+警告）。
  - 实测：`withDefaults(defineProps<{a;b?}>(), {b:'hi'})` → `b: { type: String, value: "hi" }`。
- 黄金断言：`tests/vue-compat-aligned.test.ts`（组件模式，宏剥离 + 默认值合并）。
- **验证**：全量 2572/2572 绿；build:mp / build:web 通过。

## P1 第三批（2026-09-08）：`defineComponent` 宏转 partial（no-op 剥离 + 警告）

- **`defineComponent`**：`<script setup>` 里为**冗余包装**（SFC 已自动组件化）。此前被当顶层副作用裸注入 onLoad → 产物 `defineComponent(...)` 无 import → 运行时 ReferenceError（getCurrentInstance 同类），属编译器缺口；Step2 曾因此降 `unsupported`。
- **修复**：`handleConstToData` 宏早退 + `extractTopLevelCalls` 跳过 `defineComponent`——编译器识别并**剥离为 no-op** + 矩阵 `partial`（警告：包装 options/setup 不编译，请用 `<script setup>`）；不落 data、不裸调用。
- 注：不强行转 `aligned`——`defineComponent({ setup(){} })` 内 setup 逻辑非 SFC 范式、不翻译；`partial`（警告）比 `unsupported`（error 阻断）更诚实（可识别但包装未编译）。
- 黄金断言：`tests/vue-compat-compile.test.ts`（partial 警告 + 不裸调用 + 不落 data）。
- **验证**：全量 2573/2573 绿；build:mp / build:web 通过。

> ⚠️ 待办：`version` 内联（可对齐）、`defineModel`/`useModel` v-model 组件契约（可对齐，较复杂）、computed 一次性派生是否需响应式二次求值（框架语义既定，暂按现状锁定）。

## 副产：发现的架构债（全端目标 → 编译器需平台化拆分）

对齐过程中确认：编译器当前**无平台参数**（`compileVueSfc` 无 target/renderer），把「目标=MP」写死进单一后端；平台选择发生在构建编排层（plugin-vite/cli），Skyline 特判散点硬编码。框架是**全端目标**（Web/MP(Skyline·WebView)/App(iOS·Android·Harmony)），此架构需**后续拆分平台抽象**。详见 **[proteus-compiler-platform-plan/README.md](../proteus-compiler-platform-plan/README.md)**（记录+立项输入，非当前实施）。Vue 对齐专项不受影响（对齐对象=MP 后端行为，Web 用真 Vue 无需对齐）。

## 关联
- 既定基线：`docs/vue-compat-plan.md`（§1 ✅/⚠️/❌ 实测）、`docs/vue-compat-advance.md`（Batch 1-7）、`docs/roadmap.md`（#2 编译能力）、L0 规约（原则 #0 第五投影 / #10.8 / 反黑盒 / 降级铁律）。
- **Vue 全集权威来源**：`node_modules/.pnpm/@vue+runtime-core@3.5.42/.../runtime-core.d.ts` + `@vue/reactivity` + `@vue/shared`（版本随 vue pkg 演进）。
