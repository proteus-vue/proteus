---
title: DevTools 面板与扩展
order: 44
group: 开发者工具
---

# DevTools 面板与扩展

> 概览见[调试与可观测](/docs/framework/debugging)（三层调试面 + 十视图）；本页讲**面板数据流与扩展接法**（`@proteus-vue/devtools` 包分层）。

## 架构：数据源 → 面板 / Vue DevTools

```
TraceBus / DevTools 事件
  ├─ createTraceBusWsBridge（远程 WS 桥——双通道：本地浮动面板 / 远程面板页）
  ├─ createDevtoolsWsSource / createTraceBusSource（DevtoolsSource 数据源抽象）
  └─ 面板消费：createDevtoolsPanel（本地浮动）或远程 WS 通道
```

| 模块（`@proteus-vue/devtools`） | 导出 | 角色 |
|---|---|---|
| `panel.ts` | `createDevtoolsPanel(options)` | 本地浮动面板（容器/路由/视图挂载） |
| `source.ts` | `createDevtoolsWsSource` / `createTraceBusSource` | 数据源抽象（WS 直连 / TraceBus 拉取） |
| `ws-bridge.ts` | `createTraceBusWsBridge` | TraceBus → WS 桥（远程通道） |
| `session-io.ts` / `snapshot-io.ts` | 会话/快照序列化 | 时间旅行导入导出（store 快照真实恢复：`restoreStores` → 逐 store `$patch`） |
| `vue-devtools.ts` | `installProteusTimeline` / `installProteusInspectors` / `PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR` | **接入 Vue DevTools 生态**（timeline 事件线 + 自定义检查器） |
| `views/` | `renderTimeline` 等 | 十视图渲染 |
| `plugins.ts` / `plugins/` | 插件扩展点 | 面板扩展（G-58 插件 API 的 devtools 侧） |

## Vue DevTools 生态接入

`@proteus-vue/devtools` 不是封闭面板——通过 `installProteusTimeline`（Vue DevTools timeline 时间线：路由导航/状态变更/错误事件）与 `installProteusInspectors`（自定义检查器：组件树/所有权图等语义视图）**寄生在 Vue DevTools 里**。`PROTEUS_DEVTOOLS_PLUGIN_DESCRIPTOR` 是插件描述符（App 侧识别）。

## 远程通道与时间旅行

- **双通道**：`installProteusDevtools`（本地浮动面板）或远程面板页（WS bridge——面板与页面跨设备查看）
- **时间旅行**：store 状态经统一序列化契约（`@proteus-vue/contracts` store 域）→ 快照导出/导入 → 逐 store `$patch` 真实恢复
- **安全**：远程 WS 仅本地回环 + 一次性 token（G-57 安全红线）

## 数据流示例（examples devtools-open-api-demo）

`examples/pages/devtools-open-api-demo.vue` 演示 open-api 收口链路：路由/状态事件 → TraceBus → bridge → 面板时间线与检查器消费。

## 诚实边界

- 面板是 dev-only 基建（`__PROTEUS_DEBUG__` 门控，生产零注入）
- 十视图的语义视图（graph/ownership）消费 Debug-only 数据源——release 构建对应视图为空

## 下一步

- [调试与可观测](/docs/framework/debugging)：三层调试面与 Inspector 叠加原则（G-57）
- [运行时 trace](/docs/framework/runtime-js)：TraceBus 事件面
