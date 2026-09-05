---
title: Native capabilities
order: 20
group: 渲染与能力
---

# Native capabilities

In traditional cross-platform frameworks, "native capabilities" means writing your own bridges: one Swift implementation, one Kotlin implementation, maintained year after year. Proteus generalizes the render backend's SPI methodology to every native implementation — **a native capability is also one line of semantic mapping**. Scanning a QR code or getting a location is not an `if (platform)` branch; it is a `capability.*` row in a mapping table, sharing one table and one source with `ui.*` and `shell.*`.

> **Business code calls semantics; the backend provides the implementation.**
> NativeBackend's three-platform mapping tables — `SEMANTIC_NATIVE_MAPS` — hold 52 rows per platform, covering six families: layout / ui / shell / capability / gesture / engineering.

## Three-platform semantic mapping

`createNativeBackend(adapter, platform)` picks the mapping table per platform (iOS UIKit baseline / Android Jetpack / Harmony ArkUI), and `createElement` maps `semantic` to a native view type:

| Semantic | iOS (UIKit) | Android (Jetpack) | Harmony (ArkUI) |
|---|---|---|---|
| `layout.box` | UIView | FrameLayout | Stack |
| `layout.stack` | UIStackView | LinearLayout | Flex |
| `layout.grid` | UICollectionView | GridLayoutManager | Grid |
| `layout.scroll` | UIScrollView | ScrollView | Scroll |
| `ui.text` | UILabel | TextView | Text |
| `ui.button` | UIButton | Button | Button |
| `ui.input` | UITextField | EditText | TextInput |
| `ui.list` | UITableView | RecyclerView | List |
| `shell.tabbar` | UITabBar | BottomNavigationView | Tabs |
| `shell.modal` | UIAlertController | Dialog | CustomDialog |
| `layout.split` | UISplitViewController | SlidingPaneLayout | SideBarContainer |
| `ui.nav` | UINavigationController | NavigationRail | Navigation |
| `gesture.draggable` | UIPanGestureRecognizer | GestureDetector | PanGesture |
| `capability.scan-qr` | AVCaptureSession | CameraX | ScanKit |
| `capability.location` | CLLocationManager | FusedLocation | geoLocationManager |

The table is an excerpt. Every row shares its source with the per-target columns of `SEMANTIC_BACKEND_MAP` in component-ir — the mapping table is the SSOT, and both backend implementations and the conformance reference table align to it; maintaining separate copies is not allowed.

## The artifact is a platform descriptor tree (honest boundary)

NativeBackend maintains a `NativeViewDescriptor` tree (`type` is already the native view name) and syncs every change to the host adapter — this is the entire interface a host must implement:

```ts
export interface NativeViewAdapter {
  createView(descriptor: NativeViewDescriptor): unknown // host handle: UIView / View / ArkUI Node
  updateView(handle: unknown, key: string, prev: unknown, next: unknown): void
  insertView(child: unknown, parent: unknown, anchor?: unknown): void
  removeView(child: unknown): void
  setViewText(handle: unknown, text: string): void
}
```

The current state of the code, graded honestly:

- ✅ **Semantic mapping + descriptor tree + wiring verification**: `semantic → native view type` genuinely takes effect; the default adapter `createMockNativeAdapter()` asserts the create / update / insert / remove / setText call sequence via an ops log in a host-free environment.
- 📋 **On-device rendering (bridge)**: swapping the adapter for an iOS / Android / Harmony SDK bridge is enough to run on real devices — `NativeViewAdapter` is isomorphic to `NativeAdapter` in `@proteus-vue/renderer-app`. Until a host project lands, the artifact stops at the **descriptor tree**, not at real on-device views.

On the rendering side, this single interface is the only seam: a self-developed cross-platform shell integrates by implementing these five methods and syncing the descriptor tree into its own view system. The mock adapter is the first "host" written against exactly this surface.

```ts
import { createNativeBackend, createMockNativeAdapter, renderIRTree } from '@proteus-vue/render-backend'

const adapter = createMockNativeAdapter()
renderIRTree(createNativeBackend(adapter, 'ios'), ir) // ir = p-grid > p-text
adapter.ops
// ['create:UICollectionView', 'create:UILabel', 'insert:UILabel', …] — the wiring sequence is assertable
```

## Capability semantics live in the same table

The `capability.*` rows show that **rendering and native capabilities share one semantic model**: scan → `AVCaptureSession` / `CameraX` / `ScanKit`, pick photo → `UIImagePicker` / `PhotoPicker` / `PhotoViewPicker`, location → `CLLocationManager` / `FusedLocation` / `geoLocationManager`.

The two consumption paths converge on the same catalog (the 136-primitive SSOT; 50 items in the capability family):

- **In the template** it is the capability-entry semantic — `capability.scan-qr` renders as `button.proteus-scan-qr` on the vue-dom target (the capability implementation is injected by a Hook);
- **In the script** it is a Hook — `createCapabilityHooks()` returns 50 `useXxx()` hooks (`useCamera()` / `useLocation()` / `useQRCode()` …).

See [Capability system](/docs/18-capability-system) and [Platform API](/docs/19-platform-api).

## It is not a wx.xxx global object

G-31 reworks the API surface from the same source as the component surface: **API = Hook / Promise** (`useCamera()` / `useLocation()` / `router.push()`) — there is no `wx.xxx` global object. Capability calls land in the binding layer instead of scattering through business code, so the compiler can scan them, the type system can check them, and conformance can verify them. This is exactly the precondition for the mapping table to serve "one table, three targets": only when the entry point is a semantic can the implementation be taken over by a backend.

## How to verify that the mapping has not drifted

Component-snapshot conformance (G-31, render layer) runs a **control readback** for every backend and compares it node by node against the reference table — the control a backend actually produces must match what `SEMANTIC_BACKEND_MAP` declares:

```ts
import { createNativeBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'
import { checkComponentSnapshot } from '@proteus-vue/component-ir'

const backend = createNativeBackend(undefined, 'android')
const snap = renderComponentSnapshot(backend, ir, createControlReader(backend.id))
// snap.control === 'GridLayoutManager' (when the ir root is p-grid) — the readback is the real artifact
const result = checkComponentSnapshot(backend.id, snap) // does the control readback == the reference table?
```

The CI gate covers 6 backends × L1 fixtures (`tests/component-conformance.test.ts`) — a wrong mapping turns the gate red, and `unverified` honestly flags combinations the reference table does not cover instead of passing them. For the full picture of the verification system, see [Conformance](/docs/framework/29-conformance).

## Next steps

- [Render backend](/docs/framework/23-render-backend): the SPI contract and the panorama of the six backends
- [Flutter backend](/docs/framework/24-flutter-backend): another mapping table over the same semantics
- [Conformance](/docs/framework/29-conformance): the gate over semantic-control mapping
