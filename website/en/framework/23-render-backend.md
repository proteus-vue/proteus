---
title: Render backend
order: 25
group: 渲染层
---

# Render backend

Proteus does not build its own rendering engine. The last step of the rendering pipeline — plugging nodes into the engine's nodeOps — is defined as an SPI: `ProteusRenderBackend` (G-27). Any rendering engine that implements this single interface can render the same semantic model; business code and the framework core have zero awareness of the engine.

> **One semantic model. Any render engine.**
> Backends consume `IRNode.semantic` (e.g. `layout.grid`), not tag strings — switching engines = switching to a different semantic mapping table.

## The SPI contract

The interface has only 5 required methods (deliberately aligned with the de-facto Vue nodeOps standard — `createRenderer(nodeOps)` is a zero-cost backend); everything else is optional:

```ts
export interface ProteusRenderBackend {
  readonly id: BackendId // 'vue-dom' | 'flutter' | 'native-ios' | ...
  readonly version: string
  readonly capabilities: BackendCapabilities // capability declaration — the framework degrades by capability, never by if/else on the platform

  // —— required nodeOps (aligned with Vue) ——
  createElement(node: IRNode): NodeHandle
  insert(child: NodeHandle, parent: NodeHandle, anchor?: NodeHandle): void
  remove(child: NodeHandle): void
  patchProp(el: NodeHandle, key: string, prev: unknown, next: unknown): void
  setText(el: NodeHandle, text: string): void

  // —— optional: layout / frame scheduling / input / lifecycle / texture sharing (excerpt) ——
  measure?(node: NodeHandle, constraints: LayoutConstraints): Size
  scheduleFrame?(task: () => void): void
  dispatchInput?(event: NormalizedInputEvent): void
  onMount?(root: NodeHandle): void
  registerExternalTexture?(id: string, texture: ExternalTexture): void
}
```

- **`IRNode`**: `{ type, semantic?, props, children }`. `semantic` is what the backend maps on (`layout.grid` → `UICollectionView` / `GridView` / `div.proteus-grid`); when absent it falls back to `type` (the Layer 1 compat layer).
- **`capabilities`**: eight fields declared honestly — layout / glass / blur / animation / textureSharing / remoteRendering / ssr / input; not declared means unsupported.
- Every backend must pass the interface-completeness self-check of `runBackendConformance(backend)` (RND002).

## Six official backends

`@proteus-vue/render-backend` ships six switchable backends — the RENDER BACKEND switcher on the official site's Playground calls them for real (zero fakes):

| Backend (id) | Target | Artifact | Maturity |
|---|---|---|---|
| `vue-dom` | Web / H5 | Real DOM element tree (rendered by the browser) | ✅ |
| `headless` | In-memory (no UI) | `HeadlessNode` in-memory tree (serializable via `toPlainTree`) | ✅ |
| `native-ios` | iOS (UIKit) | `NativeViewDescriptor` platform descriptor tree | ✅ descriptor tree / 📋 on-device bridge |
| `native-android` | Android (Jetpack) | Descriptor tree (`TextView` / `GridLayoutManager`…) | ✅ descriptor tree / 📋 on-device bridge |
| `native-harmony` | Harmony (ArkUI) | Descriptor tree (`Text` / `Grid`…) | ✅ descriptor tree / 📋 on-device bridge |
| `flutter` | Flutter | `FlutterWidgetDescriptor` widget tree | ✅ mapping spike / 📋 Embedder bridge |

Maturity is graded honestly: **✅ = code shipped and machine-verifiable** (descriptor trees / in-memory trees / real DOM all genuinely run); **📋 = needs a host project** (native SDK bridges, the Flutter Embedder — see [Native capabilities](/docs/20-native-backend) and [Flutter backend](/docs/framework/24-flutter-backend)). The SPI also reserves three `BackendId`s — `skyline` / `skia` / `canvas2d` — whose engine instances are not implemented yet.

Each backend's capability declaration differs — precisely the data source behind "degrading by capability":

| Backend | layout | glass | blur | animation | ssr | input |
|---|---|---|---|---|---|---|
| `vue-dom` | native | L1 | approximate | js | — | touch · cursor |
| `headless` | none | none | none | js | ✅ | touch |
| `native-*` | native | L3 | true | native | — | touch · cursor · remote |
| `flutter` | yoga | L3 | true | native | — | touch · cursor · remote |

> `native` and `flutter` both declare `textureSharing: true` (PlatformView / Texture mixing); `remoteRendering` is `false` for all four backends.

## Rendering and switching

All of these are real APIs (consistent with the official site's Playground and the runtime source):

```ts
import { createFlutterBackend, renderIRTree, toWidgetTree } from '@proteus-vue/render-backend'

// render an IR directly: recursive createElement + insert, returns the root handle
const root = renderIRTree(createFlutterBackend(), ir)
const widget = toWidgetTree(root as never) // { widget: 'Scaffold', children: [...] }
```

Hot switching is carried by the Dispatcher (the global forwarding layer) — **switching engines = retargeting the nodeOps forwarder, with zero awareness in Vue or business code**:

```ts
import {
  createNodeOpsDispatcher,
  createBackendSwitcher,
  createVueDomBackend,
  createNativeBackend,
} from '@proteus-vue/render-backend'

const dispatch = createNodeOpsDispatcher(createVueDomBackend())
const switcher = createBackendSwitcher(dispatch)
switcher.mount(ir) // first mount
switcher.switchBackend(createNativeBackend(undefined, 'ios'), {
  strategy: 'rehydrate', // rebuild the same IR on the new engine, preserving business state
})
```

Three strategies: **rebuild** (destroy and rebuild — DevTools during development) / **rehydrate** (rebuild the same IR — route switching in production) / **hybrid** (multiple engines on one page — region routing). A standard Vue app lands on any backend the same way:

```ts
import { createProteusRendererForBackend } from '@proteus-vue/render-backend'

const { renderer, dispatch } = createProteusRendererForBackend(createVueDomBackend())
renderer.createApp(App).mount(containerNode) // Vue code stays unchanged; the engine can be swapped
```

## The rendering driver is engine-independent (H-03)

The Dispatcher records every nodeOps call (`trace`). Rendering the same IR under two engines yields **traces identical call for call** — the machine evidence that "the rendering driver is engine-independent"; `semanticSequence(ir)` is the engine-independent input fingerprint:

```ts
semanticSequence(ir)
// ['shell.page', 'layout.grid', 'layout.box', 'ui.text', 'layout.box', 'ui.button']
```

Two more weapons sit on top of this:

- **Hybrid rendering**: `createHybridRenderer` routes backends by region (video regions go to native, the rest to vue-dom) + texture sharing (`registerExternalTexture`) + route traces for DevTools visualization.
- **Conformance gate**: the interface-completeness self-check + the G-31 component-render snapshot (6 backends × L1 fixtures, with control readbacks compared against the reference table) — see [Conformance](/docs/framework/29-conformance).

**One app picks its engine per page**: product detail → Native, brand motion → Flutter, H5 landing pages → VueDom, tests/SSR → Headless — the business code is exactly the same. Flutter locks you to Skia, React Native locks you to native; only the "semantic model on top + pluggable backends" route buys back rendering-engine freedom.

## Next steps

- [Native capabilities](/docs/20-native-backend): three-platform semantic mapping and the honest boundary
- [Flutter backend](/docs/framework/24-flutter-backend): the semantic → widget-tree mapping layer
- [Conformance](/docs/framework/29-conformance): the gate over backends and semantic mapping
