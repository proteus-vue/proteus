---
title: Component unit testing
order: 23
group: 自定义组件
---

# Component unit testing

Write dual-target mount assertions with `@proteus-vue/test-core`: **the same SFC source** is mounted to Web (real rendering) and Mini Program (logic layer + WXML), and assertions are reused (iron rule G-44.6: state is shared across targets).

## Dual-target mounting

```ts
// @vitest-environment happy-dom  ← required for Web mounting (esbuild's TextEncoder check breaks across realms)
import { describe, it, expect } from 'vitest'
import { mountComponent, stateOf, tap } from '@proteus-vue/test-core'

const BADGE = `<script setup lang="ts">
defineProps({ tone: { type: String, default: 'brand' } })
</script>
<template><view class="p-badge">{{ tone }}</view></template>`

describe('p-badge', () => {
  it('renders consistently on both targets', async () => {
    const run = async (host: unknown) => {
      expect(stateOf(host as never)).toMatchObject({ tone: 'brand' })
    }
    await run(await mountComponent(BADGE, { platform: 'web' }))
    await run(await mountComponent(BADGE, { platform: 'mp' }))
  })

  it('dispatches events uniformly', async () => {
    const host = await mountComponent(BADGE, { platform: 'web' })
    // tap / stateOf / textOf are the unified assertion surface (Web wrapper / MP data+WXML dual channel)
  })
})
```

## The unified API surface

| API | Description |
|---|---|
| `mountComponent(sfc, { platform })` | Unified mounting: Web goes through @vue/test-utils real rendering; MP goes through compilation → logic-layer instance + WXML |
| `stateOf(host)` / `textOf(host)` | Unified state/text reading (Web setupState / MP data + normalized WXML) |
| `tap(el, selector?)` | Unified event dispatch (Web trigger / MP automator) |
| `mountMpComponent(sfc)` | MP-specific: real compilation + logic-layer instance + WXML dual assertion |
| `createMockContext()` | The sole wx source for Mini Program tests (wx mock + in-memory storage + Page/Component capture) |

## Environment conventions

- Web mounting test files must carry `// @vitest-environment happy-dom` at the top
- MP mounting needs no browser — logic-layer + WXML assertions run directly in Node

## Next steps

- [Third-party component distribution](/docs/framework/components-distribution)
