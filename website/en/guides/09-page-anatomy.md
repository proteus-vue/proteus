---
title: Page anatomy
order: 9
group: 代码构成
---

# Page anatomy

A page is a **standard Vue SFC** (a `.vue` file) with up to four parts: `<template>`, `<script setup>`, `<style>`, and the `<route>` block unique to Proteus.

The `src/pages/index.vue` shipped with the scaffold is complete and ready to run:

```vue
<route>
{
  "meta": {
    "title": "Home",
    "isTab": true
  }
}
</route>
<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)

function handleTap() {
  count.value++
}
</script>

<template>
  <div class="home">
    <h1>Hello Proteus</h1>
    <p class="tapped-count">tapped {{ count }} times</p>
    <button @click="handleTap">tap</button>
  </div>
</template>

<style>
.home {
  text-align: center;
  padding: 48px 0;
}
</style>
```

## Four parts, one semantic set → artifacts per target

| SFC part | On Web | On Mini Program |
|---|---|---|
| `<template>` | Renders the DOM directly | WXML (tag mapping `div→view`, `h1/p→text`, `img→image`, `a→view`, etc.) |
| `<script setup>` | Runs Vue's real reactivity directly | `Page()` constructor; `ref` reads/writes rewritten to `setData` (batch-merged within a 16ms window) |
| `<style>` | CSS as-is | WXSS (px→rpx conversion configurable) |
| `<route>` block | Web route table | `app.json` / `page.json` |

> The table above illustrates where one SFC goes using the **two compiled forms: Web / Mini Program**. Native targets (iOS / Android / HarmonyOS / Flutter) skip WXML-like intermediate forms — each render backend **consumes the same SFC's semantic IR directly** (see [Render backend](/docs/framework/23-render-backend)), business code unchanged.

## Three key points

1. **Zero conditional compilation in business code**: no `#ifdef` anywhere — tag mapping, reactive rewriting, and style conversion are all done by the compiler.
2. **The `<route>` block is optional**: page metadata such as `title` / `isTab` is declared on the page itself; the page runs fine without it — the route is derived from the file location.
3. **Creating a new page**: add a `.vue` file under `src/pages/` and re-run `npm run build:mp` — it takes effect on **every target at once**: Web renders DOM directly, Mini Programs get compiled artifacts, and native/Flutter render backends consume the same semantics (business code never branches on the target).

## Next steps

- [Global & page configuration](/docs/10-config): what each of the two config layers handles
- [Semantic model](/docs/framework/11-semantic-model): understand the IR behind this set of mappings
