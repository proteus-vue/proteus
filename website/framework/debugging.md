---
title: 调试与可观测
order: 16
group: 运行期
ends: debugging
---

# 调试与可观测

Proteus 的调试面由三层组成：**编译期决策链**（为什么产物长这样）、**运行时 trace**（发生了什么）、**DevTools 面板**（可视化消费）。各端落地状态见上方「终端落地进度」（遵循 G-57 Inspector 叠加原则：L0 用宿主已有调试器，语义增强在 L1/L2）。
Proteus 的调试面由三层组成：**编译期决策链**（为什么产物长这样）、**运行时 trace**（发生了什么）、**DevTools 面板**（可视化消费）。各端落地状态见上方「终端落地进度」（遵循 G-57 Inspector 叠加原则：L0 用宿主已有调试器，语义增强在 L1/L2）。

## 编译期：决策链

```bash
npm run debug:mp                        # 全链路调试构建（PROTEUS_DEBUG=1）
npx proteus explain src/pages/index.vue # 单文件编译决策 trace
npx proteus rules                        # 规则能力清单（每条带 AI 说明书）
```

- debug 构建产物注入 `[proteus][环节]` 日志与**决策链文件**（每条转换规则 before/after + 行号）
- `.transform-debug/` 转盘携带完整 trace（决策链落盘，可审计可回放）

## 运行时：TraceBus

路由导航、状态变更、错误事件统一进 **TraceBus**（环形缓冲 + 脱敏 + 采样 + 零开销门控）：

- Web 端非 push 导航（站内链接 / 浏览器前进后退）自动补发 trace——route 回溯完整
- DevTools route 视图消费 start / point / end 事件
- 生产零开销：traceBus 不注入则事件不产生

## DevTools 面板（十视图）

| 视图 | 内容 |
|---|---|
| timeline / flamegraph | 运行时时间线与火焰图 |
| state | Pinia 状态（时间旅行滑块 + 快照导入导出） |
| route | 路由回溯（含带参导航） |
| errors | 错误聚合 |
| components / pages | 组件树与页面栈 |
| graph | 所有权图 |
| device / ownership | 设备面板 / 所有权视图 |

接入：`installProteusDevtools`（本地浮动面板）或 DevTools 面板页（远程 WS 双通道）；远程时间旅行支持 store 快照真实恢复（`Proteus.restoreStores` → 逐 store `$patch`）。

## 状态快照与序列化

store 状态序列化走统一契约（`@proteus-vue/contracts` store 域）——DevTools 导入导出、pinia-sync 协同、审计共用同一层。

## 下一步

- [组件化与语义命名](/docs/framework/components-model)
