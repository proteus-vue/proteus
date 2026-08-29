# M7 — 超级应用加固

> 对应全局"超级应用"档位：把 DevTools 自身做成可长期运行、可灰度、可降级的基础设施。

## M7.1 缓冲持久化

- 环形缓冲满时，旧事件写入 IndexedDB（Web）/ `wx.setStorage`（小程序，分片 ≤ 1MB）
- 面板连接后回放历史，避免"打开 DevTools 时已错过关键事件"
- 配额策略：默认 10MB，LRU 淘汰；关键错误事件（`phase:'error'`）永不淘汰

## M7.2 大数据集渲染

- 万级 span 虚拟滚动（对齐 M3 性能预算）
- 快照导入导出使用 StreamSaver（浏览器）/`wx.getFileSystemManager`（小程序），不一次性读进内存
- stateBefore/stateAfter diff 用结构共享，避免深拷贝整棵 store

## M7.3 权限最小化

- 面板连接需确认（`proteus.config.ts.devtools.allowFrom` 白名单 origin）
- 敏感 store 导出需二次确认弹窗（列出将被导出的字段）
- 远程调试（M8）默认关闭，开启时打印警告"敏感数据可能被传输"

## M7.4 性能预算

| 指标 | 预算 |
|------|------|
| `bus.emit` 单条 | < 0.1ms |
| 万级 span 首屏 | < 200ms |
| 火焰图 5000 span | < 100ms |
| DevTools JS 体积 | < 80KB gzip（按需加载后） |

CI 跑 `proteus audit devtools-budget`，超线阻断（对齐 CLI M3 audit 体系）。

## M7.5 降级策略

- 采集层异常 → 关闭该 source，保留其余（不整体崩）
- 面板断连 → Runtime 继续缓冲，重连后同步
- 内存压力（`onMemoryWarning`）→ 丢弃非错误事件，保留错误 + 快照

## M7.6 生命周期对接

- 面板生命周期挂到 Lifecycle 阶段：`coreReady` 后才激活采集
- `onHide` → 暂停 flush；`onShow` → 恢复并回放缓冲

## 验收

- 连续运行 30 分钟，缓冲 + 持久化稳定，无内存泄漏（heap 增长 < 5MB）
- 模拟采集层抛错，其余 source 正常，面板显示降级提示
- 性能预算在 CI 中全部通过
