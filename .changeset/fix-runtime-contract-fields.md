---
'@proteus-vue/slot-runtime': patch
'@proteus-vue/render-backend': patch
---

补齐运行期事件/产物契约的两个字段（修根 `vue-tsc` 长期 11 条红 · 类型面漂移）

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
