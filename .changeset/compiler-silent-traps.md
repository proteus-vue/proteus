---
'@proteus-vue/compiler': minor
---

编译器静默陷阱治理 + 事件名单段归一（真机驱动）

- **静默陷阱告警**：顶层 `let x = <非 null 初值>` 被丢弃（→ 方法体引用抛 `ReferenceError`）、模板表达式内函数调用（WXML 不支持，崩事件链）、`:class` 通道漏后缀等此前**完全静默**的失败，现编译期告警并全仓扫修。
- **事件名单段归一**：父级手写 `@update:{arg}` 归一为 `bind:update-{arg}`（与子组件 `triggerEvent('update-{arg}')` 同口径）——此前产出双冒号 `bind:update:show`，与子组件**永不匹配**（真机弹层遮罩点击关不掉的根因）。
- 新规则登记：`script/element-probe`（元素探针注入，见对应 changeset）。
