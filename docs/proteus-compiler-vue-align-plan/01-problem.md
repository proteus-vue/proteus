# 01 · 问题：MP 编译产物会因未对齐的 Vue API 运行时崩溃

## 症状

`<script setup>` 使用**未被编译器翻译的 Vue API** 时，MP 编译产物**引用未定义符号 → 运行时 ReferenceError**（页面/组件崩溃或逻辑失效）。Web 端正常（真 Vue 运行时）。

## 铁证：`getCurrentInstance is not defined`

2026-09-08 p-popover 方案 A（measureRect 定位）实测：

- 源码：`<script setup>` 里 `import { ref, watch, onMounted, getCurrentInstance } from 'vue'`，`const __scopeInst = getCurrentInstance()`。
- MP 编译产物（`proteus/p-popover/index.js`）：
  ```js
  Component({
    ...
    attached() {
      this.__scopeInst = getCurrentInstance()   // ← getCurrentInstance 未定义
      ...
    },
    methods: { async openMeasure() { ... } }
  })
  ```
  **产物顶部无 `const { getCurrentInstance } = require(...)`，也无任何 `vue` import**（编译器把 ref/watch/onMounted 内联翻译，不留 vue）。
- 运行时（`simulator_open_page` + `get_simulator_console`）：
  ```
  [error] ReferenceError: MiniProgramError
  getCurrentInstance is not defined
      at di.attached (weapp:///proteus/p-popover/index.js:36:3)
  ```

**结论**：`getCurrentInstance`（Vue 基础 API）未被编译器对齐 → 组件 `attached` 崩溃 → 后续逻辑（measureRect scope）全失效 → 静态检查（vitest/happy-dom）抓不到（它们在 Web Vue 运行时下正常）。

## 为什么静态测试抓不到

- vitest / happy-dom / `tests/*.test.ts` 在**真实 Vue 运行时**下跑（`getCurrentInstance` 存在）→ 通过。
- 只有 MP 产物真机/模拟器运行才暴露（`get_simulator_console` error 级抓到）——**这是静态测试盲区**，需要「产物可执行验证」或「MP 运行时门禁」才能拦。

## 影响面（不只是 getCurrentInstance）

见 [02-api-gap.md](02-api-gap.md)——一整套 Vue 公共 API 未对齐，任一组件的 `<script setup>` 用到就会 MP 崩/失效。
