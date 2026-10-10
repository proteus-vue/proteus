---
'@proteus-vue/slot-runtime': minor
'@proteus-vue/compiler': minor
'@proteus-vue/render-backend': patch
---

Vapor 事件处理器 T2：带参调用 / 方法形参 / 方法内局部变量 / `if-else`（编译期降级 + 共享执行器）

承接决策 #740 T1（方法引用/无参）。T2 把**真实业务方法体**再补一档，四端行为对齐：

- **带实参调用** `@click="add(2)"`：实参（纯表达式）降级为 **`let` 形参绑定**（方法级作用域）；
- **方法形参**：`function add(n) {…}` 的形参在编译期绑为 `let n = <实参>`；
- **方法内局部变量** `const step = n * 2` ⇒ `let step`；
- **`if (cond) {…} else {…}`** ⇒ **`if` 条件动作**（两臂降级为动作子列表 + 条件程序）。

【★契约与执行器下沉到消费端（一处实现）】动作**契约**（`HandlerAction`，含 `let`/`if`）与
**执行器**（`runHandlerActions`）下沉到 `@proteus-vue/slot-runtime`（编译器 import 契约、
`render-backend/screen-runtime` 与 `entry-vapor` 共用执行器）——避免两处手写 set/add 循环漂移。
执行器用**作用域链**承接 `let`（方法级在外层、`if` 臂各成子层——与 JS 块级一致），
`$event` 由 `event` 注入（`read('$event')`）。

【仍「明确不做」（编译期诊断，不静默）】循环 / `async`·`await`（有微任务时序语义，同步执行器不建模）/
任意函数（`console.log(...)`）。

验证：
- 单测：`tests/handler-actions.test.ts`（执行器：set/add/let 遮蔽/if 两臂/$event/emit-nav，8 例）·
  `vapor-events`（+ T2 编译期 6 例：带参 let 绑定 / 局部 let / if 两臂 / 实参个数不符诊断 / 循环·async 拒）·
  `app-runtime-content` ④（真实 App 管线编出 `let`/`if`）。
- 三端真机判据 **㉓**（`check-vapor-device.py`）：t2 夹具连跑 3 次，源值 + **内核几何宽**走过
  `[0,6,12,0]`（else→else→then）——Android/鸿蒙/iOS **三端全过** + `check:vapor-three-end` 指纹一致。
- 全量 5646 通过；`test:coupled` 绿。
