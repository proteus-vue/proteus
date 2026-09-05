---
title: Storage
order: 31
group: 基础能力
ends: storage
---

# Storage

Cross-end storage rests on two rules: **persistence through configuration** (never call the storage API directly) and **reactive enhancement** (`createReactiveStorage`). (Per-target carriers are listed in the “Terminal rollout” table above — store persistence can additionally pick its carrier through the platform factory, see [State factories across targets](/docs/framework/state-factories).)

## `useStorage` (the capability handle)

```ts
const storage = useStorage()
storage.set('key', value)
storage.get('key')
```

- The handle throws when the platform bridge is missing (the host has not installed the storage capability)
- Bridge implementations: Mini Program `wx` sync storage / Web `localStorage` / test mock (the remaining ends come online one by one as their bridge lines are wired)

## The iron rule: never call the storage API directly

Business code and stores must never contain `localStorage.setItem` / `wx.setStorageSync` — persistence goes through two layers:

1. **Store persistence**: `persistence: persisted({...})` as `defineStore`'s 3rd argument; the platform factory picks the carrier automatically (Web localStorage / MP wx storage with debounced writes to disk)
2. **Capability handle**: scattered reads/writes outside stores go through `useStorage()` (normalized by the bridge)

The CI hard gate: the stores-purity test case scans for direct platform access (see [State factories across targets](/docs/framework/state-factories)).

## `createReactiveStorage` (reactive enhancement)

`createReactiveStorage(storage, reactive?)`: upgrades plain reads/writes into a reactive mirror — `set` always syncs state (adding and updating), `remove`/`clear` clean it up; reactivity is injected by the consumer (the api package has zero vue dependency).

## Honest boundaries

- Test environments without a storage bridge: in-memory fallback (a memory storage is built into `createMockContext`)
- Cookie semantics (`useCookie`) are implemented differently on the two ends (Web document.cookie / MP storage as the fallback jar); no same-semantics promise is made

## Next steps

- [Subpackages & on-demand injection](/docs/framework/subpackages)
