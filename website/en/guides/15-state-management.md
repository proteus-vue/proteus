---
title: State management
order: 15
group: 基础概念
---

# State management

Proteus's state management is built on **Pinia**: state / getters / actions / `storeToRefs` share the same `.ts` source across all four targets. Platform differences — persistence storage, DevTools wiring, SSR instance isolation — all converge in the four-target factories of `@proteus-vue/runtime`; business stores have zero awareness of the target.

> **Iron rule**: no platform branching is allowed in `stores/` (`window.` / `wx.` / `getPlatform()` must never appear). Platform differences may live only in the factories and the storage adapter layer; the `stores-purity` test case in `npm test` is the hard CI gate.

## Four factories, one store

Application entries pick the factory per target; business code stays unchanged:

| Factory | Target | Persistence backend | Status |
|---|---|---|---|
| `createWebPinia()` | Web SPA | `LocalStorageAdapter` (localStorage) | ✅ |
| `createMpPinia()` | WeChat Mini Program Skyline | `WxStorageAdapter` (`wx.setStorageSync`, debounced disk writes) | ✅ |
| `createAppPinia()` | App (Custom Renderer) | `NativeKVAdapter` (MMKV bridge landing in v0.6) | 🟡 |
| `createSsrPinia()` | SSR | `MemoryAdapter` (a separate instance per request) | ✅ |

```ts
// main.web.ts — the Web entry
import { createWebPinia } from '@proteus-vue/runtime'

app.use(createWebPinia())
```

On the Mini Program target, calling `createMpPinia()` once in the full entry (`main.mp.ts`) makes `useStore()` directly usable inside pages. On Web, Vue DevTools hooks in natively; Mini Programs have no browser DevTools, so the development build (`PROTEUS_DEBUG=1`) automatically attaches trace logs and a `__PROTEUS_STORES__()` state snapshot.

## Store purity conventions

- **Persistence is written only in `defineStore`'s 3rd argument** (`persistence: persisted({...})`); never assembled dynamically at runtime
- **No direct storage access**: `localStorage.setItem` / `wx.setStorage` must never appear — go through the persist config and let the platform pick the backend automatically
- **No persisting transient state**: runtime state such as playback progress and loading stays in memory; the persisted surface narrows down to `pick`

`examples/stores/player.ts` is the official real example — the same store behaves consistently across all four targets:

```ts
import { defineStore } from 'pinia'
import { persisted } from '@proteus-vue/runtime'

export interface Track {
  title: string
  durationSec: number
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    playing: false,
    current: null as Track | null,
    volume: 0.8,
    history: [] as string[],
  }),
  getters: {
    volumePercent: (s) => Math.round(s.volume * 100),
  },
  actions: {
    play(track: Track) {
      this.current = track
      this.playing = true
      if (this.history.indexOf(track.title) === -1) this.history.push(track.title)
    },
    toggle() {
      if (this.current) this.playing = !this.playing
    },
    setVolume(v: number) {
      this.volume = Math.max(0, Math.min(1, v))
    },
  },
  // Persistence declaration: volume/history restore across targets; playing/current are transient and never stored
  persistence: persisted({ pick: ['volume', 'history'], key: 'player-state' }),
})
```

## Persistence: one declaration, effective on all four targets

`persisted()` is a lightweight persistence marker: stores without it carry **zero overhead** (no subscription attached); once declared, the storage injected by the current target's factory auto-writes with debounce. Common options:

| Option | What it does |
|---|---|
| `pick` / `omit` | whitelist / blacklist fields (supports `a.b.c` nested paths) |
| `key` | storage key (defaults to `store.$id`) |
| `debounce` | debounced disk writes (default 50ms; pass `0` to disable) |
| `version` + `migrations` | schema version migration; on failure, falls back to initial values without crashing |
| `volatile` / `encrypted` | fields not written to storage / fields stored encrypted |
| `keys` + `eager: false` | sharded lazy hydration (`store.$hydrate()` restores manually) |
| `scope: 'page'` | page-level store, disposed in a batch on the page's `onUnload` |

Already have a project on `pinia-plugin-persistedstate`? The `persist: {...}` style is supported as-is by a compatibility layer (`createPersistedStatePlugin`) — when `persist.storage` is omitted, an Adapter is picked automatically per platform; an explicit `localStorage` also gets wrapped into an Adapter. Zero store changes.

## SSR isolation

SSR state leakage is a cross-request security incident; three constraints close it off:

1. **A separate instance per request**: `createSsrPinia()` must be called inside the request handler — module-top-level `createPinia()` is forbidden
2. **Persistence is skipped automatically**: on the `ssr` platform the persistence plugin simply returns — the server only creates empty state, avoiding hydration mismatch
3. **Client hydration**: restore the state first, then `app.use(pinia)` (see `examples/ssr/`)

## Migrating from plain Pinia

Goal: an existing Vue + Pinia project joins Proteus multi-target in **≤ 10 lines of changes** (the stores themselves: 0 lines):

1. Swap the entry: `app.use(createWebPinia())` (identical behavior on Web, zero risk); add `createMpPinia()` to the Mini Program entry
2. Remove `persist.storage` from stores (the platform picks the backend automatically; leaving it also runs fine)
3. Run `npm test` to confirm the cross-platform matrix is all green; optionally swap `persist` for `persistence: persisted({...})` incrementally

## Next steps

- [Routing & navigation](/docs/16-router): page navigation and route checks
- [Ownership engineering](/docs/framework/34-ownership): deterministic reclamation of page-level resources
- [Testing & deployment](/docs/27-testing-deploy): cross-platform matrix tests and CI gates
