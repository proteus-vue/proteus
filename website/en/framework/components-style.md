---
title: Component styles & slots
order: 21
group: 组件框架
---

# Component styles & slots

## Style scoping

WXSS on the Mini Program target has no style isolation — Proteus resolves it at the compile layer:

| Form | Behavior |
|---|---|
| `<style>` (unmarked) | **treated as scoped by default** (class-name suffix concatenation); a compile-time warning fires when unmarked |
| `<style scoped>` | explicit local scope |
| `<style global>` | **Proteus extension**: explicitly global (scoped isolation is off); scoped + global blocks in the same file are emitted as separate groups (global first) |

> Why scoped by default: Vue's standard `<style>` is global — real-device testing showed an unscoped background color bleeding into other pages (user decision, 2026-08). Cross-target consistency: the Web-side Vite plugin performs the same rewrite, `<style> → <style scoped>`.

**Known constraint**: scoped styles cannot reach slot children — a global rule that switches on the container class is the only clean path (the typical use of `<style global>`; see the p-grid fallback `.p-grid-fallback > *`).

## Slots

The `slot` compile rule (`slot/scoped-slot`) maps standard Vue slots to Mini Program slot syntax:

- The default slot passes straight through (`p-view`'s `<slot />` has identical semantics on both targets)
- Named slots / scoped slots are mapped by the compile rule
- **Known constraint**: scoped styles reaching slot children is limited (see above)

## Component props

- props use **object-form defineProps** (statically extracted by the compiler; the array form is not supported)
- On the MP target, props types are mapped into component.json properties
- When passing complex object / function props, mind the MP-side limits (the rule list `npx proteus rules` explains each one)

## Next steps

- [Semantic model](/docs/framework/11-semantic-model): the IR contract behind the components
