# @proteus-vue/pinia-sync

Proteus × Pinia 多端状态协同引擎（docs/proteus-pinia-plan M8.1）——"一处改、处处同步"（购物车 / 登录态 / 播放进度）。**可选子包**：不引入则无协同，零额外开销。

## 能力

- **LWW（默认，零依赖）**：op 带 `{ value, timestamp, clientId }`——取最新；时间戳相同 → clientId 字典序兜底
- **CRDT（`strategy: 'crgt'`）**：接口占位（动态加载 Yjs，未接入时 warn 降级 LWW）

## 行为约束

1. 参与协同的 store 必须声明 `sync: true`——避免误同步隐私数据
2. mutation → op → 本地应用 + 入队 → `transport.send`（用户自备 ws/socket.io）
3. 接收远端 op → LWW（per-path 时间戳 + clientId 兜底）→ 应用
4. 离线缓冲：断线 op 入队，重连 flush 重放
5. 边界：`encrypted` / `volatile` 字段（M7.6）不参与协同（密文无法合并）→ 跳过并告警

## 使用

```ts
import { createSyncEngine, MemoryOpStore } from '@proteus-vue/pinia-sync'
import type { SyncTransport } from '@proteus-vue/pinia-sync'

// 1. 传输通道（用户自备：ws / socket.io / 自研长连）
const transport: SyncTransport = {
  send(op) { ws.send(JSON.stringify(op)) },
  onReceive(cb) { ws.onmessage = (e) => cb(JSON.parse(e.data)) },
  onStatus(cb) { ws.onopen = () => cb(true); ws.onclose = () => cb(false) },
}

// 2. 引擎（pinia 实例 + 通道 + 可选离线缓冲）
const engine = createSyncEngine({
  pinia,
  transport,
  strategy: 'lww', // 'lww' | 'crgt'
  opStore: new MemoryOpStore(), // 离线缓冲（可选）
  clientId: 'device-A',
})

// 3. store 声明协同（store 内 sync: true 字段自动参与）
//    const cart = defineStore('cart', { state: ..., sync: { paths: ['items'] } })
```

## 设计要点

- **MP 产物安全**：全文件无 `??` / `?.` / 对象展开 / 数组解构（Skyline 产物约束）
- 传输通道与 op 存储均为注入式（结构类型），零硬依赖——用户自备长连设施
