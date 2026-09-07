---
title: Flutter backend
order: 26
group: 渲染层
---

# Flutter backend

FlutterBackend is the mapping layer for "semantic convergence → Flutter rendering semantics" (G-27 B5 spike). For the same semantic IR, the Flutter backend produces a **widget tree**: `layout.grid` is no longer a div but a `GridView`; `ui.button` is a `FilledButton`; `shell.page` is a `Scaffold`.

> **Backends consume `IRNode.semantic`, not tag strings.**
> `SEMANTIC_FLUTTER_MAP`'s 52 rows of semantic mapping + the `WIDGET_MAP` compatibility layer — the same philosophy as the compiler's TAG_MAP: semantics converge, and the backend decides how.

## toWidgetTree: semantics → widget

`createFlutterBackend()`'s `createElement` looks up the mapping table by `semantic`; `toWidgetTree` serializes the handle tree into a plain widget tree (input to spike assertions / the Embedder bridge):

| Semantic | Flutter widget |
|---|---|
| `layout.box` | Container |
| `layout.stack` | Flex |
| `layout.grid` | GridView |
| `layout.fluid` | Wrap |
| `layout.safe` | SafeArea |
| `ui.text` | Text |
| `ui.button` | FilledButton |
| `ui.image` | Image |
| `ui.input` | TextField |
| `ui.list` | ListView |
| `shell.page` | Scaffold |
| `shell.modal` | showDialog |
| `ui.rich-text` | RichText |
| `ui.avatar` | CircleAvatar |
| `ui.canvas` | CustomPaint |
| `engineering.animate` | AnimationController |

A compatibility layer, `WIDGET_MAP`, also takes in legacy tags without a `semantic` (compat-layer / historical `p-*` tags):

| Compat-layer tag | Flutter widget |
|---|---|
| `view` | Container |
| `text` | Text |
| `button` | FilledButton |
| `input` / `textarea` | TextField |
| `scroll-view` | SingleChildScrollView |
| `switch` / `slider` / `icon` | Switch / Slider / Icon |
| `progress` | LinearProgressIndicator |
| `p-grid` / `p-stack` / `p-split` | Wrap / Flex / Row |

`mapWidgetType` **passes through** unmapped tags — a custom widget name goes straight through, never intercepted.

## A real end-to-end example

Same source as the repo tests (`tests/dispatcher.test.ts`); the `ir` is `shell.page > layout.grid > layout.box > (ui.text | ui.button)`:

```ts
import { createFlutterBackend, renderIRTree, toWidgetTree } from '@proteus-vue/render-backend'

const root = renderIRTree(createFlutterBackend(), ir)
const widget = toWidgetTree(root as never)
// Field excerpt (the full shape includes id/props/text/children):
// { widget: 'Scaffold', children: [{ widget: 'GridView', children: [
//   { widget: 'Container', children: [{ widget: 'Text', text: 'Product A' }] },
//   { widget: 'Container', children: [{ widget: 'FilledButton' }] }] }] }
```

The same IR also renders to Headless: the two engines' nodeOps call traces are identical call for call, and the semantic fingerprint is the same (`['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button']`) — machine evidence for H-03 "the rendering driver is engine-independent". Each engine maps to its own control language:

| Semantic | Headless | Flutter |
|---|---|---|
| `shell.page` | page | Scaffold |
| `layout.grid` | grid | GridView |
| `ui.text` | text | Text |
| `ui.button` | button | FilledButton |

## Relationship to Flutter engineering (honest boundary)

The current code stops at the **widget descriptor tree** (`FlutterWidgetDescriptor`: widget name + props + children) — it is not on-device rendering. A host bridge is still missing before it can truly run; graded honestly:

- ✅ **Shipped**: the 52-row semantic → widget mapping, nodeOps tree operations, `toWidgetTree` serialization, and the flutter column in the conformance snapshot gate (`GridView` / `Text` / `FilledButton`… consistent with the reference table).
- 📋 **Awaits a host project**: the Embedder C ABI bridge — `FlutterEngineRun` + `FlutterRendererConfig` (make_current / fbo_callback / present) — that hands the descriptor tree to a real Flutter engine. The output of `toWidgetTree` is the input to this bridge.

What `capabilities` declares — `layout: 'yoga'` (Flutter ships its own layout), `glass: 'L3'` (Skia/Impeller), `animation: 'native'`, `textureSharing: true` (Texture / PlatformView mixing) — describes the **targeted capabilities once integrated**: until the Embedder bridge lands, treat them as a roadmap, not the current state.

## The flutter column in the conformance gate

Widget mapping is not "written means done" — it is one column of the G-31 component-snapshot gate, where control readbacks are compared node by node against the reference table:

```ts
import { createFlutterBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'
import { checkComponentSnapshot } from '@proteus-vue/component-ir'

const backend = createFlutterBackend()
const snap = renderComponentSnapshot(backend, ir, createControlReader('flutter'))
// snap.children[0].control === 'GridView' (ir reused from the example above: page > grid)
checkComponentSnapshot('flutter', snap) // a wrong mapping turns the gate red
```

The repo gate (`tests/component-conformance.test.ts`) covers 6 backends × L1 fixtures — flutter is verified alongside native, vue-dom, and headless. See [Conformance](/docs/framework/29-conformance).

## Next steps

- [Render backend](/docs/framework/23-render-backend): the SPI contract and the switching panorama
- [Headless backend & semantic snapshots](/docs/framework/25-headless-backend): verify the same IR in the in-memory tree first
- [Conformance](/docs/framework/29-conformance): the snapshot gate on the flutter column
