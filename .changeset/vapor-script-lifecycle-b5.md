---
'@proteus-vue/compiler': minor
'@proteus-vue/render-backend': minor
'@proteus-vue/cli': patch
---

Vapor B5：脚本级生命周期钩子 `onMounted` / `onUnmounted` 降级为动作表（端上真执行）

背景（对齐计划 B5，承接事件-方法线 T1/T2/T3）：App 端**不执行 script** ⇒ 此前 `<script setup>` 的
`onMounted(() => { … })` 里的逻辑**永不运行**（只产 `VAPOR_SCRIPT_LIFECYCLE_NOT_RUN` 诊断）。
真实页面用 `onMounted` 做初始化很常见 ⇒ 这是「点了/进了页面没反应」的一类。

- **编译期**（`compileEvents`）：`<script setup>` 顶层 `onMounted(() => {…})` / `onUnmounted(() => {…})`
  的**回调体降级为动作表**（复用事件-方法线同一降级器 `degradeStatements` + 同一执行器 `runHandlerActions`），
  发射新产物 **`scriptLifecycle`**（`{phase:'mounted'|'unmounted', handler}`；缺省省略 ⇒ 既有产物不变）。
  可降级体 ⇒ 端上真跑；**不可降级体**（循环 / async / 宿主 API）⇒ **精确诊断**（不静默）。空体 ⇒ 不产出、无诊断。
- **运行期**（`render-backend`）：`screen-runtime` 的 `ScreenRuntimeInstance` 增 `markMounted()`（首帧 mount 后，
  **幂等**）与 `markUnmounted()`；`superapp-runtime` 在 `mountScreen`/`mountScreenInto` 成功后自动 `markMounted()`，
  并暴露 `markUnmounted(screen?)`。同时**打通 App 壳的 `@vue:mounted`**（此前壳路径完全没接 lifecycle）。
- **产物**（`cli/app-runtime-content`）：`lifecycle` + `scriptLifecycle` 随 `runtime-content.json` 下发。
- **诊断修正**：`onMounted`/`onUnmounted` 从「不会运行」诊断列表移除（它们现在会运行）；其余钩子保留。

验证：`vapor-events` B5 组（mounted/unmounted 降级 / 空体 no-op / 循环诊断 / 与 `@vue:mounted` 同形态）·
`vapor-lifecycle`（不再报 NOT_RUN + 其余钩子仍报）· `screen-runtime` ⑤（markMounted 改数据 0→99、幂等、
markUnmounted 0）· **三端真机判据 ㉔**（b5 夹具 `b5x` 值/几何 `[0,88,0]`，Android/鸿蒙/iOS 全过 +
`check:vapor-three-end` 指纹一致）· 全量 5657 · vue-tsc 0。
