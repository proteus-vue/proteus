---
title: Cross-target state sync
order: 36
group: 数据与状态
---

# Cross-target state sync

In multi-target / multi-instance scenarios, state consistency between Pinia stores is handled by `@proteus-vue/pinia-sync` — the **sync engine is decoupled from the transport**, and business code only declares "which stores to sync and with which strategy".

## Core contract

```ts
const sync = createSyncEngine({
  pinia,                     // the Pinia instance
  transport: wsTransport,    // SyncTransport: websocket / broadcast / custom
  stores: ['cart'],          // the stores participating in sync
  strategy: 'lww',           // the conflict strategy
})
```

## Two built-in strategies

| Strategy | Semantics | Use case |
|---|---|---|
| `lww` | last-write-wins: the newer timestamp overwrites the older | general shared state (default) |
| `crgt` | CRDT counter semantics: concurrent increments merge | counters / accumulators |

## Key contracts (the store domain of `@proteus-vue/contracts`)

- `SyncOp`: the unit of a sync operation (serializable across targets)
- `SyncTransport`: the transport abstraction (send / onMessage) — websocket, BroadcastChannel, and the DevTools relay can all implement the same interface
- `MemoryOpStore`: an in-memory op log (for tests and offline buffering)

## Relationship to DevTools time travel

DevTools state snapshots / time travel reuse the same **store-state serialization contract** (`applyState` semantics): the panel's `Proteus.restoreStores` command → the app restores each store one by one via `$patch`. Sync is "multi-target consistency"; time travel is "single-target history replay" — the two share the serialization layer.

## Next steps

- [Render backend](/docs/framework/23-render-backend)
