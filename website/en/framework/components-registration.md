---
title: Component references & registration
order: 19
group: 组件框架
---

# Component references & registration

p-* components are wired up differently on the two targets — yet business code reads exactly the same.

## Web target: import on demand

```ts
// main.ts (or inside a page)
import { PView, PGrid, PStack } from '@proteus-vue/components'
```

The component library `@proteus-vue/components` (`src/components/index.ts`) aggregates and exports all the semantic components. **Framework components (p-*) are imported on demand on the Web target** — there is no global-registration magic, and components you do not use never enter the bundle.

## Mini Program target: automatic scanning & artifacts

The Mini Program target needs no manual registration — the build completes it automatically:

1. **Automatic scanning**: plugin-vite scans the component directories; each component outputs a four-file set at `proteus/<tag>/index` (isolated from app components under `/components/<tag>/` — framework components carry the `proteus/` prefix)
2. **Component declaration**: a `component.json` is generated for each component (`usingComponents` is written into the page json automatically by the compiler)
3. **Shared modules**: logic shared across components compiles into standalone artifacts + require conversion (e.g. `_proteus/gesture.js`)

> Just write `<p-grid>` directly in your business template — references, registration, and artifact paths are all handled by the compiler.

## Component aggregation

`src/components/index.ts` also exports runtime extensions (`installFluidLayout` / the fluid directive / the desktop directive factory) for `main.ts` to install on demand — the component library is not only template components; it also contains directives and runtime extensions.

## Audit linkage

Component aggregation and the directory structure are machine-audited by `components:audit` (see [Componentization & semantic naming](/docs/framework/components-model)), so the aggregate exports never drift from the directory / semantic mapping.

## Next steps

- [Component lifecycle & events](/docs/framework/components-lifecycle)
