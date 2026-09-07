---
title: HMR dual-channel
order: 41
group: 运行期
---

# HMR dual-channel

Cross-target hot updates run on two channels, each aimed at a different artifact shape:

| Channel | Target | Mechanism |
|---|---|---|
| **Web HMR** | web | **Native Vite HMR** — components live inside the Vite module graph, so `@vitejs/plugin-vue` hot-swaps them at zero cost (see [Web runtime](/docs/framework/runtime-web)) |
| **MP HMR** | Mini Program | **A custom dev-server from `@proteus-vue/hmr`** — Mini Program pages are **not in the Vite module graph** (transform never fires; `vite dev` / `build --watch` are useless), so a custom file watcher is required |

## MP HMR: the `@proteus-vue/hmr` system

Package layering (`@proteus-vue/hmr` main entry + `dev-server` subpath):

| Module | Export | Role |
|---|---|---|
| `@proteus-vue/hmr/dev-server` | `createHmrDevServer(options)` | **Server side**: file watching + WS broadcast (used by the examples `scripts/dev-mp.ts`) |
| `@proteus-vue/hmr` | `createHmrClient` | **Client side**: connects to WS, dispatches events |
| `@proteus-vue/hmr` | `createVueHotAdapter` | Vue component hot-swap adapter (`accept` / state-preservation semantics) |
| `@proteus-vue/hmr` | `createHmrRuntime` | Runtime unification: batch events → apply safely |
| `@proteus-vue/hmr` | `createSafeReload` | **Safe reload** (a reload strategy that preserves the running state) |
| `@proteus-vue/hmr` | `HmrPayload` | The payload type: `{ id, file, type, action, timestamp, code }` |

## dev-mp dual-channel practice (examples/scripts/dev-mp.ts)

```
monitor pages/subpackages/src/config/framework components
  → debounce → ① artifact rebuild (gen-routes + vite build → dist/mp-weixin; WeChat DevTools auto-refreshes)
           ② HMR broadcast (changed .vue → compileVueSfc incremental compile → HmrPayload pushed over WS)
```

```ts
import { createHmrDevServer } from '@proteus-vue/hmr/dev-server'

const hmr = createHmrDevServer({
  port: Number(process.env.PROTEUS_HMR_PORT ?? 5174),
  watchRoots: [...],     // pages / subpackages / shared modules / config / framework components
  debounceMs: 300,
  compile: incrementalCompile,  // changed .vue → compileVueSfc → HmrPayload[]
  appInfo: () => ({ routes }),  // route table for the DevTools panel
})
```

- When the watcher starts: `[dev-mp] HMR dev server ready: ws://127.0.0.1:5174 (PROTEUS_HMR_PORT is configurable)`
- **Artifact rebuild and HMR broadcast run in parallel as dual channels**: the former for WeChat DevTools (simulator refresh), the latter for the connected HMR Runtime / DevTools panel
- Non-`.vue` changes go through the rebuild channel only; a failed `.vue` incremental compile → warn, never blocks

## Connection surface (HMR client → DevTools)

`HmrPayload` is pushed over WS to the client (`createHmrClient`) → `createHmrRuntime` applies it safely in batches; `type: 'vue', action: 'update'` goes through the Vue hot adapter. The DevTools panel consumes update events over the same channel (visualizing HMR activity).

## Honest boundaries

- MP artifact rebuild is a **whole-bundle recompile** (vite build); the HMR broadcast only targets the changed `.vue`'s **logic-layer code segment** (the js output of `compileVueSfc`) — WXML/WXSS changes take effect through a DevTools refresh
- `@proteus-vue/hmr` is dev-channel infrastructure; production artifacts exclude it (devDeps)

## Next steps

- [Mini Program runtime](/docs/framework/runtime-mp): the setData bridge and artifact shapes
- [Debugging & observability](/docs/framework/debugging): DevTools consuming HMR events
