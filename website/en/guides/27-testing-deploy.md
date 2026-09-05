---
title: Testing & deployment
order: 27
group: 架构与工程
---

# Testing & deployment

> Write once, test on both targets: state assertions are fully shared across targets, while DOM / WXML are each asserted on their own side.

## Testing layers

| Layer | Tool | What it verifies |
|---|---|---|
| Unit tests | vitest | pure logic (stores / utility functions / compiler) |
| Dual-target component mounting | `@proteus-vue/test-core` | the same SFC behaves consistently on Web and Mini Program |
| E2E | `createDriver` (playwright / automator) | real user paths in a real browser and a real Mini Program |
| Conformance gate | test-ir / conformance | the semantic tree renders consistently across the six render backends (see [Conformance](/docs/framework/29-conformance)) |

## Dual-target mounting: @proteus-vue/test-core

The core idea: **the same SFC source is mounted on Web (real rendering) and Mini Program (logic layer + WXML dual assertions), and the assertions are reused**.

```ts
// @vitest-environment happy-dom  ← required (esbuild's TextEncoder instanceof check crashes across jsdom realms)
import { describe, it, expect } from 'vitest'
import { mountComponent, stateOf, textOf, tap } from '@proteus-vue/test-core'

const COUNTER = `<script setup lang="ts">
import { ref } from 'vue'
const count = ref(1)
function increment() { count.value++ }
</script>
<template><view><text>{{ count }}</text><button @click="increment">+1</button></view></template>`
```

| API | Description |
|---|---|
| `mountComponent(sfc, { platform: 'web' or 'mp' })` | Unified mounting: Web renders for real through @vue/test-utils; MP goes through the logic layer's normalized host (instance flattened + WXML exposed at the top level) |
| `stateOf(host)` / `textOf(host)` | Unified assertions: state reads (Web setupState / MP data) and text reads (Web `wrapper.text()` / normalized MP wxml) — **iron rule 06: state is shared across targets** |
| `tap(el, selector?)` | Unified event dispatch (Web `trigger('click')` / MP automator `tap()`) |
| `mountMpComponent(sfc)` | MP-specific: actually compiles the SFC → runs the logic layer → returns `{ instance, wxml, js, context }` for logic + WXML dual assertions |
| `createMockContext(options?)` | The **single source of `wx`** for Mini Program tests: global `wx` mock + in-memory storage + Page/Component capture; call `cleanup()` in `afterEach` |
| `createDriver({ platform })` | Unified E2E API: web (playwright + optional CDP) / mp (automator + optional debugger) behind one capability interface |

### Environment conventions

- Test files with Web-mounting cases must start with `// @vitest-environment happy-dom` (esbuild's `TextEncoder` instanceof check crashes across realms in jsdom)
- Cases that need localStorage / history can use `@vitest-environment jsdom`

## Running tests

```bash
npm test                # full unit run (e2e excluded)
npm run test:e2e:web    # builds Web first, then runs browser E2E
npm run verify          # tests + dual-target builds + whole-workspace build + package health check
```

## Build artifacts

```bash
npm run build:web       # → dist/web/ (standard Vite SPA)
npm run build:mp        # → dist/mp-weixin/ (WeChat Mini Program artifacts)
```

| Artifact | How to deploy |
|---|---|
| `dist/web/` | any static hosting (nginx / OSS / CDN); `npm run preview:web` for a local preview |
| `dist/mp-weixin/` | point WeChat DevTools "Import Project" at this directory; real-device preview → upload → submit for review — the standard WeChat flow |

## Pre-deployment checklist

- [ ] `npm run verify` all green (tests + dual-target builds + package health)
- [ ] Mini Program base library ≥ 2.29.2 (Skyline rendering)
- [ ] capability declarations match the target platform (see [Capability system](/docs/18-capability-system))

## Next steps

- [Conformance](/docs/framework/29-conformance): the machine gate for consistent rendering across the six render backends
- [CLI & project commands](/docs/28-cli): the full command landscape
- [State management](/docs/15-state-management): cross-target testing patterns for stores
