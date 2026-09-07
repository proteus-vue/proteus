---
title: Developing a p-* component
order: 22
group: 自定义组件
---

# Developing a p-* component

The complete flow of writing a semantic component from scratch — with a minimal, usable `p-badge` as the example.

## 1. Directory & naming

```
src/components/p-badge/index.vue   ← one directory per component; index.vue is the entry
```

Naming iron rule G-31.1: `p-` prefix + a semantic name (badge expresses the "badge intent"); structural names like `p-div` are banned, and sharing a name with HTML / Mini Program tags is banned too.

## 2. The component itself

```vue
<!-- src/components/p-badge/index.vue -->
<template>
  <view class="p-badge" :class="['p-badge--' + tone]">
    <slot />
  </view>
</template>

<script setup lang="ts">
// ★Object-form defineProps (statically extracted by the compiler); the BaseProps contract is laid down literal by literal
defineProps({
  pid: { type: String, default: '' },          // BaseProps: cross-target unique identifier
  disabled: { type: Boolean, default: false }, // BaseProps
  ariaLabel: { type: String, default: '' },    // BaseProps
  tone: { type: String, default: 'brand' },    // business prop (the object form is what enables static extraction)
})
</script>

<style scoped>
.p-badge { display: inline-flex; }
</style>
```

**MP compilation safety discipline** (matching the compiler MVP's constraints):

- No `as` assertions or arrow-parameter type annotations inside function bodies — lift callbacks into function declarations
- `computed` uses the arrow shorthand + an expression body
- Rewrite non-null assertions `x!` as `x ?? fallback`

## 3. Aggregated export

Append to `src/components/index.ts`:

```ts
import PBadge from './p-badge/index.vue'
export { PBadge }
```

## 4. Audit & semantic registration

```bash
npx proteus components:audit src/components   # platform API / sync storage / manifest completeness
```

- Platform API red line: direct calls to `document.*` / `window.*` / `wx.*` inside a component are forbidden
- Semantic registration: append `p-badge → ui.badge` to `TAG_SEMANTIC_MAP` (when the semantic enum has no matching value, extend the enum first — never invent one)

## 5. Verification

- Web: a page renders `<p-badge>New</p-badge>`
- MP: after `npm run build:mp`, the `proteus/p-badge/index` four-file set is emitted + `usingComponents` is written automatically

## Next steps

- [Component unit testing](/docs/framework/components-test)
