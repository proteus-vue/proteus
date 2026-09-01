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

- ✅ 面板连接确认（`devtoolsRelayPlugin({ allowFrom })` WS Origin 白名单——非白名单来源 upgrade 前拒绝；缺省空数组全放）
- ✅ 敏感 store 导出二次确认（`findSensitiveKeys` 递归检测 password/token/authorization/idcard/phone → 导出前 confirm 列出字段，拒绝不下发）
- ✅ 远程调试（remote: true）需显式开启（install 选项），dev 工具定位

## M7.4 性能预算

| 指标 | 预算 | 烟测 |
|------|------|------|
| `bus.emit` 单条 | < 0.1ms | ✅ tests/devtools-budget.test.ts（万次平均 < 1ms 宽松上界） |
| 万级 span 首屏 | < 200ms | ✅ ingest 烟测 < 1000ms（渲染侧虚拟滚动已落地） |
| 火焰图 5000 span | < 100ms | ✅ ingest + roots 烟测 < 1000ms |
| DevTools JS 体积 | < 80KB gzip | ⬜ 待按需加载评估 |

CI 跑 `proteus audit devtools-budget`（CLI audit 体系，超线阻断）——✅ `audit devtools-budget` 子命令 + `audit all` 第七域（10 倍余量上界；node 直测 devtools-runtime）。

## M7.5 降级策略

- ✅ 采集层异常 → 单订阅者 try/catch 隔离（console.warn 记录，不阻断其余订阅者/缓冲/不向外传播——devtools 订阅者异常不得崩应用）
- ✅ 面板断连 → Runtime 继续缓冲（enable 回放 + 2s 重发已落地）
- ✅ 内存压力（`createTraceBus({ memory: () => performance.memory 的 used/limit, memoryThreshold })`）→ 超阈值丢非 error 事件（计数 getMemoryDrops），error 恒保留；探针异常/缺省不启用

## M7.6 生命周期对接

- 面板生命周期挂到 Lifecycle 阶段：`coreReady` 后才激活采集
- `onHide` → 暂停 flush；`onShow` → 恢复并回放缓冲

## 验收

- 连续运行 30 分钟，缓冲 + 持久化稳定，无内存泄漏（heap 增长 < 5MB）
- 模拟采集层抛错，其余 source 正常，面板显示降级提示
- 性能预算在 CI 中全部通过
