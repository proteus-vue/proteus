# 03 · 根因：逐 API 白名单翻译 + 不留 vue import

## 1. 编译器是「逐 API 白名单语义翻译」

`packages/compiler/src/script.ts` + `transforms/script.ts` 对 `<script setup>` 做**结构化语义翻译**（不是保留 Vue 语义、由 runtime 解释）：

- `ref(0)` → data 字段（初始值静态求值）
- `computed(() => expr)` → `proteusCalcX()` 派生方法
- `watch(...)` → `proteusWatchX` 方法 / observers
- `onMounted(fn)` → `onReady()` 方法
- `defineProps(...)` → `properties`
- `provide/inject` → `getApp().__proteusProvides` 注册表

**关键**：每一类都是**显式注册**（SCRIPT_RULES）的翻译规则。**没注册的 Vue API 没有任何处理路径** → 源码里保留 `getCurrentInstance()` 调用，但产物里该符号不存在。

## 2. 编译器不留 vue import

MP 组件产物**不 `require('vue')`**（如 `p-popover/index.js` 顶部只有 `require('../../_proteus/shared.js')`、`require('../runtime/popover-position.js')`）——Vue 响应式被**内联编译**进 data/方法/setData，产物是「纯 MP Component()」。

因此任何「需要 Vue 运行时」的 API（`getCurrentInstance`/`useSlots`/`watchEffect`/`nextTick`/computed setter）在产物里**无运行时来源** → 必然 ReferenceError。

## 3. 反黑盒边界缺失（次因）

对「框架明确不支持」的 Vue API（动态渲染 `h`/`createApp`/`render`，见 LLM GUIDE §0.4 非目标），目前**没有编译期显式报错**——它们会静默输出成垃圾引用。应像 `script/svg-no-peer`、`event/click-to-tap` 那样，登记「未支持 Vue API → 编译期显式警告/报错」规则（反黑盒红线）。

## 4. 结构性影响

这是**框架立身之本**（"标准 Vue API"卖点）与「MP 编译期语义翻译」路线的**结构性张力**：
- 编译期翻译（省包体/透明/产物可读）vs Vue API 全集（标准性）。
- 当前倾向翻译，但**翻译面 = 白名单**，白名单外的标准 Vue API 用户一旦使用就崩——最伤「标准 Vue SFC 直接编译」的卖点。

**修复方向**见 [04-fix-direction.md](04-fix-direction.md)。
