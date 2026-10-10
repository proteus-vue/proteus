---
title: Page anatomy
order: 9
group: 代码构成
---

# Page anatomy

A page is a **standard Vue SFC** (a `.vue` file) with up to four parts: `<template>`, `<script setup>`, `<style>`, and the `<route>` block unique to Proteus.

The `src/pages/index.vue` shipped with the scaffold is a **ready-to-run showcase page** (brand area + key numbers + interactive demo + next steps, with four-end-identical styling). Below is its skeleton (trimmed; the real file is fuller):

```vue
<route>
{
  "meta": { "title": "Home", "isTab": true }
}
</route>

<script setup lang="ts">
import { ref } from 'vue'

// The only dynamic state: the demo counter (updates live on click, identical across ends)
const count = ref(0)
</script>

<template>
  <div class="page">
    <h1 class="hero-title">Write once, run on every end</h1>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">5</div>
        <div class="stat-label">targets</div>
      </div>
      <div class="stat">
        <div class="stat-value">1</div>
        <div class="stat-label">source</div>
      </div>
    </div>

    <button class="btn" @click="count++">Tap me +1</button>
    <div class="counter">Tapped {{ count }} times</div>
  </div>
</template>

<style>
.page { width: 100%; min-height: 100vh; background-color: #f5f6f8; padding: 20px 16px; }
.hero-title { display: block; font-size: 28px; font-weight: 800; color: #16181d; }
.stats { display: flex; flex-direction: row; gap: 12px; }
.stat { flex: 1; background-color: #ffffff; border-radius: 14px; padding: 16px; }
.btn { display: block; width: 100%; font-size: 16px; color: #ffffff; background-color: #4f46e5; border-radius: 12px; padding: 13px; }
</style>
```

> ★**Cross-end-consistent style** (following the repo's `css-conformance` acceptance baseline): **use plain tags** (`div / h1 / p / button`, without depending on built-in components) + **static classes and design tokens** (`var(--x)` pointing at `global.css`'s `:root`, expanded to literal values for App at compile time). Avoid `:hover` / pseudo-classes, which the App end does not support yet; values Skyline rejects (`inline-block`, etc.) are blocked by a gate. Reusable baseline styles live in `src/styles/global.css` (Mini Program via `globalStyle`, Web via an import in `main.ts`, App folded at compile time — one file, four ends).
>
> ★**Event form** (affects App interactivity): the App event compiler supports **inline actions** (`@click="count++"` / `@click="count = count + 1"` / `@click="show = !show"`) and **method references / no-arg calls** (`@click="handleTap"` / `@click="handleTap()"` — the method body is **lowered at compile time** into an action table, supporting assignments / increments / compound assignment / `$emit` / `$nav`, with refs written as `.value`). Still **unsupported** (App emits a compile-time diagnostic and no event): calls with arguments (`add(2)`), methods with parameters (`$event`), local variables and `if/else` inside a method body, loops / async / arbitrary functions. The starter template uses the simplest inline form.

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

- [Compiler & page configuration](/docs/10-config): what the compiler config and the page config each handle
- [Semantic model](/docs/framework/11-semantic-model): understand the IR behind this set of mappings
