---
title: Headless backend & semantic snapshots
order: 27
group: 渲染层
---

# Headless backend & semantic snapshots

HeadlessBackend is an **in-memory node tree with zero UI dependencies** — pure TS, no DOM, no platform calls. It is the foundation for testing / verification / CI: SSR output, test assertions, and AI Agent device-free regression (G-23) all run on it, and it is also the reference implementation of conformance.

> **Validate semantics in the in-memory tree first, then go to real targets.**
> Semantic errors should not wait until a real device finds them — Headless closes the loop on "the structural correctness of the same IR" in unit tests that run in milliseconds.

## The in-memory tree with zero UI dependencies

```ts
export interface HeadlessNode {
  id: number
  type: string // semantic type: page / grid / text / button…
  props: Record<string, unknown>
  children: HeadlessNode[]
  parent: HeadlessNode | null
  text: string
}
```

- **Zero dependencies**: `createHeadlessBackend()` never touches `document` — its behavior is identical in Node / CI / Worker / the browser. (For contrast, VueDom throws directly in an SSR environment, telling you to inject a documentLike or switch to Headless.)
- **Semantic view**: `SEMANTIC_HEADLESS_MAP` maps `ui.text` → `text`, `layout.grid` → `grid`, `shell.page` → `page` — SSR / debug / AI Agents see semantic names, not tag strings.
- **Honest capabilities**: `ssr: true`, `layout: 'none'` (no layout engine — resolution goes through the framework IR), `glass` / `blur: 'none'` — having no UI is by design, not a defect.
- **The start of the Vue rendering chain**: `createProteusRendererForBackend(createHeadlessBackend())` — standard Vue rendering (`h()` / `render`) runs in Node even without a browser; then swap in VueDom / Native / Flutter to re-verify the same VNode tree.

## Semantic snapshots: toPlainTree

`toPlainTree` serializes the in-memory tree into a plain object tree — the unified carrier for test assertions, golden diffs, and Agent snapshots. The snapshot shape is the contract: the fields are fixed at `id / type / props / text / children`, with zero tolerance for shape drift. Real usage (same source as the repo tests):

```ts
import { createNodeOpsDispatcher, createHeadlessBackend, toPlainTree } from '@proteus-vue/render-backend'

const d = createNodeOpsDispatcher(createHeadlessBackend())
const grid = d.nodeOps.createElement('p-grid', { minColWidth: 160 })
const text = d.nodeOps.createElement('p-text', { content: 'Product A' })
d.nodeOps.insert(text, grid)
const root = d.nodeOps.createElement('p-page', { title: 'Product' })
d.nodeOps.insert(grid, root)

const tree = toPlainTree(root as never)
// tree.type === 'page'
// tree.children[0].type === 'grid'
// tree.children[0].children[0].text === 'Product A'
```

`JSON.stringify(tree)` is the snapshot — drop it into a golden file or assert on it directly. Property changes are equally assertable: after running `d.nodeOps.patchProp(el, 'src', 'a.png', 'b.png')` on a `p-image` node, `toPlainTree(el).props.src` reads back `'b.png'`.

In vitest this becomes a minimal snapshot assertion (isomorphic to `tests/dispatcher.test.ts`):

```ts
import { expect, it } from 'vitest'

it('semantic snapshot: p-page > p-grid > p-text', () => {
  const tree = toPlainTree(root as never)
  expect(tree.type).toBe('page') // shell.page → page
  expect(tree.children[0].type).toBe('grid') // layout.grid → grid
  expect(tree.children[0].children[0].text).toBe('Product A')
})
```

This pattern is also how the H suite is written — `JSON.stringify(toPlainTree(root))` serves as machine evidence in the item-by-item assertions of H-03 / H-04 / H-05.

## Why "verify semantics first, then go to real targets"

Run it in this order: Headless fully green first, real targets second — CI cannot run simulators, but it can run an in-memory tree.

- **The first column of the component-snapshot gate**: `renderComponentSnapshot(backend, ir, createControlReader('headless'))` produces a `(type / semantic / control / props)` snapshot tree; in the 6 backends × L1 fixtures CI gate, Headless is the cheapest and most stable column:

```ts
import { createHeadlessBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'

const snap = renderComponentSnapshot(createHeadlessBackend(), ir, createControlReader('headless'))
// snap.control === 'grid' (when the ir root is p-grid) — the readback is the semantic name
```

- **The universal verification engine for the combination matrix**: in the G-41 host × engine matrix (6 × 6 = 36 combinations), every host is paired with a Headless as its universal verification engine — combination-level conformance starts there, then extends to real engines.
- **Device-free regression for AI Agents**: after an Agent edits code, no simulator needs to boot — a semantic-snapshot diff is the regression evidence (see [AI-native development](/docs/32-ai-agent)).

For engineering integration (test commands, the deployment chain), see [Testing & deployment](/docs/27-testing-deploy); for the full verification picture (the three verification layers — structure / constraints / rendering — and the gate list), see [Conformance](/docs/framework/29-conformance).

## Next steps

- [Render backend](/docs/framework/23-render-backend): where Headless sits among the six backends
- [Conformance](/docs/framework/29-conformance): how semantic snapshots become a gate
- [Testing & deployment](/docs/27-testing-deploy): the engineering chain for wiring into CI
