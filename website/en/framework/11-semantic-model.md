---
title: Semantic model
order: 3
group: 语义模型
---

# Semantic model

The semantic model answers one question: **how should business code be written so that it has zero awareness of the render backend?** The answer is — business code only declares "what it wants"; the framework compiles that into a platform-independent intermediate representation (IR), and the backend implements "how" according to the **semantic fields** on the IR.

> **Business code → semantic IR → any backend. Backends consume semantics, not tag strings.**

## Two contracts: CompilerIR and the semantic tree

The compiler's complete understanding of one SFC is frozen into `CompilerIR` (an excerpt of the real contract, defined in `@proteus-vue/compiler-backend`):

```ts
interface CompilerIR {
  version: 1            // IR contract version (backend version negotiation)
  render: RenderIR      // render tree: consumed by RenderBackend's nodeOps
  semantic: SemanticIR  // semantic tree: Component IR (C-IR)
  bindings: BindingIR   // capability entries / v-model / event bindings
  layout?: LayoutConstraintIR
}
```

- `render`: render-tree nodes carry an optional `semantic` field — nodes with semantics go through semantic mapping; those without (platform tags such as view / text) belong to the Layer 1 compatibility layer and are handled as-is
- `semantic`: the **semantic tree**, made up only of p-* semantic components. After `<p-grid :min-col-width="160" :max-cols="4">` is compiled:

```ts
{ tag: 'p-grid', semantic: 'layout.grid',
  props: { minColWidth: { expr: '160' }, maxCols: { expr: '4' } },
  children: [/* ... */] }
```

- `bindings`: the aggregation of capability entries (such as `p-scan-qr` → `capability.*`), v-model bindings, and event handlers, consumed by the capability system

The render tree and the semantic tree are **same-sourced and never drift**: conformance cross-checks that "the count of nodes carrying a semantic in the render tree == the node count of the semantic tree".

## One semantic → multi-target rendering

### Compile time: source becomes IR

Take one page as an example: the Mini Program pipeline (`@proteus-vue/compiler`, implemented as pure functions):

```
page.vue
├── <template> ── transformTemplateToWxml ──► .wxml   tag / directive mapping
├── <script>   ── transformScriptToPage ────► .js     Page() constructor
├── <style>    ── transformStyleToWxss ─────► .wxss   px→rpx + selector rewriting
└── <route>    ── gen-routes ───────────────► .json   app.json / page.json
```

- **The Web target does not run through this pipeline**: standard Vite + `@vitejs/plugin-vue` runs it directly with zero transforms
- The IR layer performs **compile-time validation**: p-* tags must be semantically named (G-31.1), props must declare their degradation behavior (CMP006), and logically conflicting layout constraints error out on the spot
- The Node and Rust compile backends must produce **semantically equivalent** CompilerIR for the same SFC (enforced by the IR Golden gate)

### Runtime: IR becomes the UI

- **Web**: the VueDom backend renders the DOM directly, and `ref` is Vue's real reactivity
- **Mini Program**: the `Page()` constructor + a setData bridge — ref writes are rewritten into `this.setData({ ... })`, batch-merged within a 16ms window, with dirty paths collected at component granularity; the logic layer and the view layer communicate only through the setData serialization channel (the Mini Program dual-thread model)
- **Dispatch iron rules**: a backend must dispatch rendering on the `semantic` field, never on tag-name strings (G-37.1); capability declarations must be honest — undeclared means unsupported (G-37.3); degradation must be visible, never silent (G-37.6)

## Semantic components and native tags

Proteus's components and APIs are **not translated from the component set of any existing platform** — the framework's own semantic IR defines them directly (G-31). Two layers share the work:

| Layer | What you write | Where it compiles to | Status |
|---|---|---|---|
| Layer 0 semantic components | `<p-grid>` / `<p-stack>` / `<p-switch>` … | component → C-IR semantic type → native control mapping on each target | ✅ 59 p-* components shipped on both targets |
| Layer 1 standard tags | standard HTML tags + a standard Vue SFC | TAG_MAP mapping (div→view, img→image…) + directive / event mapping | ✅ compatibility layer |

Standard tags are the **general fallback**; semantic components are the **precise expression**:

```vue
<!-- Layer 1: standard tags — mapped via TAG_MAP; layout comes from CSS -->
<div class="grid">...</div>

<!-- Layer 0: semantic components — the backend maps the layout.grid semantic -->
<p-grid :min-col-width="160" :max-cols="4">...</p-grid>
```

What the backend maps is the semantic, not the tag: `layout.grid` is a `UICollectionView` on iOS, a `GridView` on Flutter, and a `div.proteus-grid` on Vue DOM. Mini Program component names such as `view` / `scroll-view` / `swiper` belong to the compatibility layer and are explicitly barred from being promoted to framework standards (iron rule G-31.1). Real pages naturally mix both layers (excerpts from real pages in examples):

```vue
<p-heading :level="2">Basic controls</p-heading>
<p-switch v-model="switchOn" />
<p-slider v-model="sliderVal" :min="0" :max="100" :step="5" />
```

## How the semantic tree is validated

"Validation comes before running" — the semantic tree is not a comment; it is a machine-checkable contract:

- **Structural validation**: `validateComponentTree` recursively checks the semantic tree — illegal tags (CIR_INVALID_TAG), illegal semantics (CIR_INVALID_SEMANTIC), and capability props missing a degradation declaration (CMP006)
- **Constraint validation**: `validateGridConstraints` finds logical conflicts at the IR layer (GRID_CONFLICT) — e.g., `min-col-width: 200` × `max-cols: 4` can never be satisfied in a 375px container, erroring at compile time instead of degrading into a crash at runtime
- **Render consistency**: `checkComponentSnapshot` reads back the control of every backend and compares it against the reference table; `checkSemanticCoverage` forces every implemented semantic to have real mappings on ≥3 targets (G-31.4)
- **Compile equivalence**: the IR produced by the Node / Rust backends from the same SFC must be semantically equivalent (G-29.1); a conformance FAIL on either backend blocks the merge

The full validation system is described in [Conformance](/docs/framework/29-conformance).

## Next steps

- [Render backend](/docs/framework/23-render-backend): the RenderBackend SPI, the five official backends, and hybrid rendering
- [Compiler pipeline](/docs/framework/26-compiler-pipeline): the rule registry, the decision trace, and artifact self-validation
- [Conformance](/docs/framework/29-conformance): the conformance suite and the CI gate
