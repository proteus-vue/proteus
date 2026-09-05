---
title: 跨端状态协同
order: 27
group: 数据与状态
---

# 跨端状态协同

多端 / 多实例场景下，Pinia store 之间的状态一致性由 `@proteus-vue/pinia-sync` 解决——**协同引擎与 transport 分离**，业务只声明「同步哪些 store、用什么策略」。

## 核心契约

```ts
const sync = createSyncEngine({
  pinia,                     // Pinia 实例
  transport: wsTransport,    // SyncTransport：websocket / broadcast / 自定义
  stores: ['cart'],          // 参与协同的 store 名单
  strategy: 'lww',           // 冲突策略
})
```

## 两个内置策略

| 策略 | 语义 | 适用 |
|---|---|---|
| `lww` | last-write-wins：时间戳新的覆盖旧的 | 一般共享状态（默认） |
| `crgt` | CRDT 计数器语义：并发增量可合并 | 计数 / 累计类 |

## 关键契约（`@proteus-vue/contracts` store 域）

- `SyncOp`：同步操作单元（跨端可序列化）
- `SyncTransport`：传输抽象（send / onMessage）——websocket、BroadcastChannel、DevTools relay 都可实现同一接口
- `MemoryOpStore`：内存操作日志（测试与离线缓冲）

## 与 DevTools 时间旅行的关系

DevTools 的状态快照 / 时间旅行复用同一套 **store 状态序列化契约**（`applyState` 语义）：面板 `Proteus.restoreStores` 命令 → 应用侧逐 store `$patch` 恢复。协同是「多端一致性」，时间旅行是「单端历史回放」——两者共享序列化层。

## 下一步

- [渲染层：RenderBackend SPI](/docs/framework/23-render-backend)
