---
'@proteus-vue/compiler': minor
'@proteus-vue/create-proteus': patch
---

Vapor 事件处理器「方法引用 / 方法体」支持（T1）——编译期内联方法体 → 动作表

背景（承接 #740 立项）：App 端（Vapor）事件编译 `compileEvents` 此前**只接受内联单语句**
（`@click="count++"`），**拒绝方法引用** `@click="handleTap"`——而真实业务页面几乎都写方法。
于是同一份 `.vue`，Web/小程序能跑、**App 端点不动**（`runtime-content.json` 的 `events` 为空），
属**三端分叉的劝退级缺口**。

- **编译期降级（不引入 JS 解释器，守「纯数据 / 无 eval / 封闭集」纪律）**：
  `packages/compiler/src/vapor/events.ts` 的 `compileStatement` 由「只认单条赋值/自增」升级为
  **babel 解析整串 → 逐语句降级为动作**：
  - ✅ **方法引用 / 无参调用**（`@click="handleTap"` / `handleTap()`）⇒ 在 `<script setup>`
    里**内联方法体**并降级（`function` 与 `const fn = () => {}` 都识别）；
  - ✅ **多语句**（`a++; b++`）⇒ 多动作**按序**（运行期本就按序执行）；
  - ✅ 方法体内的 `$emit` / `$nav`（与内联模板**同一套 action，单点实现**）。
- **ref `.value` 解包**（关键正确性）：方法体写 `count.value++`，而 Vapor 端上 `count` 就是值
  ⇒ 原样编成 `mem(root('count'),'value')` 会**静默算错**（undefined）。`expr.ts` 增 `refNames`
  注入 ⇒ 已知 ref 源（`ref/shallowRef/computed/customRef/toRef/defineModel`）上的 `.value`
  解包为裸源；非 ref 的 `.value` **不受影响**。新增 `compileExprNode` 免二次解析。
- **整条拒绝纪律**：任一语句降级失败 ⇒ **整条 handler 不产出动作**（绝不「部分动作」用错值静默跑）。
- **仍拒绝（精确诊断 + 修法，T2 待做）**：带实参调用 `add(2)`、方法形参 `$event`、
  方法内**局部变量声明**、`if/else`、循环 / async / 任意函数。
- **验证**：`tests/vapor-events.test.ts` +14（含端到端 runHandler 语义）· 真实 App 管线
  `tests/app-runtime-content.test.ts` ③（方法引用 ⇒ 真产出 `events` + `add` 动作）·
  `test:coupled` 全绿 · golden 全绿（**既有内联产物逐字节不变**）。
- **文档**：能力清单 #16「❌ 诊断拒绝」→「◐ 部分支持（#740 T1）」；guides 09（zh + EN）
  事件写法段列出支持/仍不支持边界。

去端：改动**只在编译期**，端上执行的动作集不变（`set/add/emit/nav`）⇒ 共享设备夹具产物**逐字节不变**
（已用 clean-tree 复算取证），三端 `results/vapor.json` 不失效。
