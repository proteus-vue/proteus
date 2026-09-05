---
title: Try the Playground
order: 3
group: 起步
---

# Try the Playground

Don't want to set up an environment yet? Open the [Playground](/playground) and experience Proteus's compilation live in your browser — write a standard Vue SFC on the left and watch, side by side, **what it becomes on each target** on the right.

## Use this minimal example

Paste the following into the left editor:

```vue
<template>
  <div class="hello">
    <h1>Hello Proteus</h1>
    <button @click="count++">tapped {{ count }} times</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<style>
.hello { text-align: center; }
</style>
```

## Watch the five tabs

| Tab | What you see |
|---|---|
| **Skyline** | Mini-program output preview |
| **IR** | The Compiler IR produced by the compiler — semantic tree (only `p-*` semantic nodes) + render tree |
| **Web** | The Web result: this SFC is just a standard Vue component — zero transformation |
| **WXSS** | Style conversion result (px→rpx) |
| **Trace** | Every rule decision the compiler fired (rule ID + line + before/after) |

## Two things worth noticing

1. **The Web tab is identical to what you wrote** — Web is zero-transform; that is "standard SFC, runs as is".
2. **The Trace tab shows decision chains** — every compile rule is explainable and queryable (`npx proteus explain` does the same in a local project).

## Next steps

- [Create your first project](/docs/05-create-project): move from the browser to a local dual-target project
- [Semantic model](/docs/framework/11-semantic-model): read the semantic tree inside the IR tab
