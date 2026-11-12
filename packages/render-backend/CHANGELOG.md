# @proteus-vue/render-backend

## 0.3.0-beta.34

### Minor Changes

- 037281a: Vapor B5：脚本级生命周期钩子 `onMounted` / `onUnmounted` 降级为动作表（端上真执行）

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

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
  - `@proteus-vue/api`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/consistency`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/devtools`
  - `@proteus-vue/glass`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/types`

- c9d830b: 补齐运行期事件/产物契约的两个字段（修根 `vue-tsc` 长期 11 条红 · 类型面漂移）

  背景：根 `npx vue-tsc --noEmit` 长期 11 条红（CI「类型检查（vue-tsc 全项目）」步骤恒失败），
  非新改动引入。根因是**决策 #712/#713（source map）给运行期加了字段、却没同步**该字段所在的**类型面**：

  - `@proteus-vue/slot-runtime` `EventBinding` 缺 `loc?`：编译器 `compileEvents` **发射** `loc`
    （模板源位置），运行期 `screen-runtime` 也**读取**它（`locByHandler`）；消费方（测试）读
    `ev.loc` 报 `Property 'loc' does not exist`。⇒ 补 `loc?: { line: number; column: number }`。
  - `@proteus-vue/render-backend` `ScreenRuntimeArtifact` 缺 `file?`：CLI `app-runtime-content.ts`
    产该字段（dev 屏源路径），本接口注释写"与 CLI 同形"却漏了它 ⇒ 消费方读 `art.file` 报
    `Property 'file' does not exist`。⇒ 补 `file?: string`。

  （另修 3 处测试自身的类型问题：`cli-doctor` 假 ctx 补 `findIosProfile`（`DoctorContext` 的
  required 原语，`#688` 加入）；`mcp-stdio` 的 `resultText` 收窄 + `process.env` 过滤 undefined；
  `vapor-events` 一处 `as unknown as` 中转。）

  验证：根 `vue-tsc --noEmit` 0 error（原 11）；examples/showcase/css-conformance 三个 typecheck
  域 0 error；全量 5620 通过；`test:coupled` 绿。

- 90cdec6: Vapor 事件处理器 T2：带参调用 / 方法形参 / 方法内局部变量 / `if-else`（编译期降级 + 共享执行器）

  承接决策 #740 T1（方法引用/无参）。T2 把**真实业务方法体**再补一档，四端行为对齐：

  - **带实参调用** `@click="add(2)"`：实参（纯表达式）降级为 **`let` 形参绑定**（方法级作用域）；
  - **方法形参**：`function add(n) {…}` 的形参在编译期绑为 `let n = <实参>`；
  - **方法内局部变量** `const step = n * 2` ⇒ `let step`；
  - **`if (cond) {…} else {…}`** ⇒ **`if` 条件动作**（两臂降级为动作子列表 + 条件程序）。

  【★ 契约与执行器下沉到消费端（一处实现）】动作**契约**（`HandlerAction`，含 `let`/`if`）与
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

- fe645a6: Vapor 事件 T3：`console.*` 转面板日志（新 `log` 动作）+ 补齐方法调方法/模板串判据

  承接 T1/T2（方法引用/方法体）。T3 收口「事件-方法」这条线向 Vue 对齐：

  - **`console.{log,info,warn,error,debug}(…)`** —— 编译期降级为 **`log` 动作**（`programs` 各实参
    的求值程序，运行期求值交 `onLog` 出口）。真实方法体几乎都带 `console` 调试，而 App 端不执行
    script ⇒ 此前整条调用被拒（**点了没反应**）。
    - `screen-runtime` / `superapp-runtime` 增 `onLog` 出口（缺省转 `onNote`——面板可归类；dev 面板
      可另接到 Console 页，保留 level）。
    - 其余 `console.*`（`table`/`time`/…）⇒ 明确诊断（封闭集）。
  - **方法调方法 / 模板串**：核验后**本已可用**（递归内联 / `compileExpr`），补判据锁定（不再只靠"没有诊断"）。

  验证：`tests/handler-actions.test.ts` ⑦（log 求值交 onLog）· `vapor-events` T3 组（log 动作 / 各级别 /
  `console.table` 诊断 / 方法调方法）· **三端真机判据 ㉓**（T2 夹具方法体加 `console.log`；`t2_probe.logs`
  逐次 3 条，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）· 全量 5651 · vue-tsc 0。
  文档：能力清单 #16 / guides 09（中英）/ 计划（T3 收口）。

- Updated dependencies
- Updated dependencies [3492f53]
- Updated dependencies [c9d830b]
- Updated dependencies [6d737f1]
- Updated dependencies [0245809]
- Updated dependencies [c5a6e5f]
- Updated dependencies [90cdec6]
- Updated dependencies [fe645a6]
  - @proteus-vue/animation@0.3.0-beta.34
  - @proteus-vue/component-ir@0.3.0-beta.34
  - @proteus-vue/contracts@0.3.0-beta.34
  - @proteus-vue/router@0.3.0-beta.34
  - @proteus-vue/slot-runtime@0.3.0-beta.34

## 0.3.0-beta.31

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/slot-runtime`

- Updated dependencies
  - @proteus-vue/slot-runtime@0.3.0-beta.31
  - @proteus-vue/component-ir@0.3.0-beta.31

## 0.3.0-beta.28

### Patch Changes

- 全量重发（scripts/release.mjs --all）：把全部包的 `latest` tag 归位到当前版本。
  动机——npm 强制每包须有 `latest`，而事后改 tag（npm dist-tag）属包管理操作、
  会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。

  - `@proteus-vue/agent`
  - `@proteus-vue/animation`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compat-miniprogram`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/consistency`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/desktop`
  - `@proteus-vue/dev-host`
  - `@proteus-vue/devtools`
  - `@proteus-vue/devtools-runtime`
  - `@proteus-vue/docs`
  - `@proteus-vue/fluid`
  - `@proteus-vue/gesture`
  - `@proteus-vue/glass`
  - `@proteus-vue/hmr`
  - `@proteus-vue/i18n`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/module`
  - `@proteus-vue/pinia-sync`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/security`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-core`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/animation@0.3.0-beta.28
  - @proteus-vue/component-ir@0.3.0-beta.28
  - @proteus-vue/contracts@0.3.0-beta.28
  - @proteus-vue/router@0.3.0-beta.28
  - @proteus-vue/slot-runtime@0.3.0-beta.28

## 0.3.0-beta.26

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/cli`
  - `@proteus-vue/render-backend`

## 0.3.0-beta.23

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/devtools`
  - `@proteus-vue/fluid`
  - `@proteus-vue/layout-core`
  - `@proteus-vue/mcp`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/shared`
  - `@proteus-vue/slot-runtime`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.23
  - @proteus-vue/contracts@0.3.0-beta.23
  - @proteus-vue/router@0.3.0-beta.23
  - @proteus-vue/slot-runtime@0.3.0-beta.23
  - @proteus-vue/animation@0.3.0-beta.23

## 0.3.0-beta.21

### Patch Changes

- 自动补 bump（scripts/release.mjs）：以下包有本地源码变更但版本号未提升，
  不 bump 会被 npm 静默跳过——依赖方声明的旧版本号拿到的仍是旧内容。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/devtools`
  - `@proteus-vue/fluid`
  - `@proteus-vue/mcp`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/shared`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.21

## 0.3.0-beta.11

### Patch Changes

- @proteus-vue/component-ir@0.3.0-beta.11
- @proteus-vue/contracts@0.3.0-beta.11

## 0.3.0-beta.10

### Patch Changes

- @proteus-vue/component-ir@0.3.0-beta.10
- @proteus-vue/contracts@0.3.0-beta.10

## 0.3.0-beta.9

### Patch Changes

- @proteus-vue/component-ir@0.3.0-beta.9
- @proteus-vue/contracts@0.3.0-beta.9

## 0.3.0-beta.8

### Patch Changes

- @proteus-vue/component-ir@0.3.0-beta.8
- @proteus-vue/contracts@0.3.0-beta.8

## 0.3.0-beta.7

### Patch Changes

- 全量重发（scripts/release.mjs --all）：把全部包的 `latest` tag 归位到当前版本。
  动机——npm 强制每包须有 `latest`，而事后改 tag（npm dist-tag）属包管理操作、
  会被要求交互式 2FA；发布时设置 tag 不受此限，故重发是零手工的归位路径。

  - `@proteus-vue/agent`
  - `@proteus-vue/api`
  - `@proteus-vue/app-config`
  - `@proteus-vue/built-in-components`
  - `@proteus-vue/capabilities`
  - `@proteus-vue/cli`
  - `@proteus-vue/compat-miniprogram`
  - `@proteus-vue/compiler`
  - `@proteus-vue/compiler-backend`
  - `@proteus-vue/compiler-backend-rust`
  - `@proteus-vue/component-ir`
  - `@proteus-vue/components`
  - `@proteus-vue/contracts`
  - `@proteus-vue/create-proteus`
  - `@proteus-vue/css-compat`
  - `@proteus-vue/desktop`
  - `@proteus-vue/dev-host`
  - `@proteus-vue/devtools`
  - `@proteus-vue/devtools-runtime`
  - `@proteus-vue/docs`
  - `@proteus-vue/fluid`
  - `@proteus-vue/gesture`
  - `@proteus-vue/glass`
  - `@proteus-vue/hmr`
  - `@proteus-vue/i18n`
  - `@proteus-vue/mcp`
  - `@proteus-vue/module`
  - `@proteus-vue/pinia-sync`
  - `@proteus-vue/plugin-vite`
  - `@proteus-vue/render-backend`
  - `@proteus-vue/renderer-app`
  - `@proteus-vue/router`
  - `@proteus-vue/runtime`
  - `@proteus-vue/security`
  - `@proteus-vue/shared`
  - `@proteus-vue/style-safety`
  - `@proteus-vue/test-core`
  - `@proteus-vue/test-ir`
  - `@proteus-vue/types`
  - `@proteus-vue/web`
  - `@proteus-vue/worklet`

- Updated dependencies
  - @proteus-vue/component-ir@0.3.0-beta.7
  - @proteus-vue/contracts@0.3.0-beta.7

## 0.1.1-beta.1

### Patch Changes

- 发布同步：修复「同版本号、内容不同」的发布漂移

  上述包在 npm 上的最新版本与本地源码**内容不一致**（版本号相同）——根因是
  `scripts/publish-all.sh` 旧逻辑「registry 已有该版本 → 跳过」无法区分「幂等重跑」与
  「改了源码但忘了 bump 版本号」，后者会让新内容永远发不出去。已实测：41 包中 36 个存在该漂移。

  后果（真实事故）：`@proteus-vue/cli@0.3.0-beta.2` 顶层 import `createFlamegraphCollector`，
  而 npm 上的 `devtools-runtime@0.1.0` 是旧构建（只有 8 个导出）→ 使用方**启动即崩**
  （`SyntaxError: ... does not provide an export named 'createFlamegraphCollector'`）。

  本次 bump 为**发布同步**（不含破坏性变更）；防复发改造见 `scripts/check-publish-drift.mjs`
  与 `publish-all.sh` 的内容校验（发布前自动拦截同类漂移）。

- Updated dependencies
- Updated dependencies
  - @proteus-vue/component-ir@0.2.0-beta.1
  - @proteus-vue/contracts@0.1.1-beta.0

## 0.1.1-beta.0

### Patch Changes

- Updated dependencies
  - @proteus-vue/component-ir@0.1.1-beta.0
