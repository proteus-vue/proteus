---
title: Ownership engineering
order: 29
group: 宿主与内存
---

# Ownership engineering

In across-target applications, the resources most likely to leak are exactly the kind **GC does not cover**: native View handles, zero-copy ArrayBuffers, timers, event subscriptions, audio/video streams… Conventional code relies on manual “acquire–release” pairing — any exception, early return, or intermediate path during a route jump skips a release; resources still held by a store after the page is destroyed are the most common memory incident.

> **G-43 does not replace GC — it governs GC's blind spot**. GC governs “reachability”; ownership governs “intent”: every boundary resource must have a unique Owner, and who acquires, who transfers, and who releases are all explicitly registered and 100% observable.

## Default path: framework-managed

99% of scenarios need no manual management. A page provides an ownership context and a managed resource pool; timers / listeners / requests / subscriptions register into the `ResourcePool` (`timer` / `interval` / `on` / `bus` / `fetch` / `subscribe`), and framework-managed resources hang on `page.managed` (ManagedRegistry):

```ts
import { createPageOwnership, getProteusOwnershipGraph } from '@proteus-vue/render-backend'

const page = createPageOwnership('pageA', {
  graph: getProteusOwnershipGraph(),
  quotaBytes: 32 * 1024 * 1024, // per-page quota ceiling (over-limit allocations throw directly)
})

const buf = page.alloc({ byteSize: 8 * 1024 * 1024 }) // registered into the page scope + ownership graph + quota
```

Page destruction (step 3 of the container's five-atomic-step destroy, `releaseResources`) delegates to the ownership Drop protocol: **force-drop every Owned of the page, invalidate all borrows, return the entire quota**:

```ts
const report = page.destroy() // force defaults to true
// { freedCount, freedBytes, invalidatedBorrows, managedDisposed, quotaRemaining }
```

Page destruction **cannot leak**: even if business code forgets to release, at that moment the resources are inevitably returned.

## Owned / Borrow: the explicit path

Large resources and across-page scenarios force release handling through the type system. `Owned<T>` is the unique-owner handle:

| API | Semantics |
|---|---|
| `read()` | reads the resource (moved / dropped states throw directly, e.g. `UseAfterMoveError`) |
| `transferTo(targetOwner)` | **Move**: transfers ownership, returning the target side's `Owned<T>`; the original handle is inaccessible afterwards |
| `borrow(scopeName?)` | **Borrow**: temporary borrowing, returns `Borrow<T>` (`valid` / `get()` / `release()`), counted into active borrows |
| `weak()` | weak reference `Weak<T>` (`alive` / `upgrade()`), breaks circular references |
| `drop({ force? })` | **Drop**: deterministic release (five-phase protocol), returns `{ ok, freedBytes, freedHandles, invalidatedBorrows }` |
| `subscribe(cb)` | subscribes to state changes (`alive` / `moved` / `dropped`) |

```ts
const buf = pageA.alloc({ byteSize: 8 * 1024 * 1024, transferable: true })

const view = buf.borrow('preview') // temporary borrow
view.get() // read
view.release() // return it once done

const buf2 = buf.transferTo('pageB') // Move: pageB takes over
buf.read() // ❌ throws UseAfterMoveError — the original handle is dead
```

## Compile-time borrow checking (B-01 ~ B-08)

Beyond the runtime fallback, the borrow checker runs a state-lattice analysis over `Owned` variables at compile time (Uninit / Alive / Moved / Dropped), reporting by the severity tier of the PSS mode:

| ID | Rule | strict | loose |
|---|---|---|---|
| B-01 | Use-after-move / use-after-drop | error | error |
| B-02 | Double-move | error | error |
| B-03 | Borrow escape (closure capture / written into a longer-lived container) | error | warning |
| B-04 | Borrow lifecycle out of bounds | error | error |
| B-05 | Active borrows present at drop / transfer | error | error |
| B-06 | Owned left undisposed at scope end | warning | warning |
| B-07 | Cross-page strong reference (stored into a cross-page container) | error | warning |
| B-08 | Circular references (break the cycle with Weak) | warning | warning |

**In strict mode, any error blocks the build**; in off mode everything falls back to the runtime fallback + DevTools observability (diagnostic messages carry the `G4001`~`G4008` error codes, one per rule ID).

## PSS: the three-tier safe subset

Complete borrow checking over arbitrary JS is undecidable (closure capture, `eval`, dynamic properties). Proteus's solution shares its origin with HarmonyOS ArkTS — **limitations in exchange for capability**: the module file header declares the Proteus Safe Subset (PSS), trading restricted expressiveness for static analyzability.

```ts
// @proteus-pss: strict
// ↑ module-level declaration within the first 20 lines of the file (strict / loose / off; default off)

const buf = pageContext.alloc(8 * 1024 * 1024)
buf.transferTo('pageB')
buf.read()
// ▲ strict reports a compile-time error G4001: use after move
```

| Mode | Restrictions | Guarantees |
|---|---|---|
| `off` | none | runtime fallback + ownership-graph observability |
| `loose` | P1 bans `any`, P2 bans dynamic property writes | compile-time checks on the main path |
| `strict` | full P1~P9 (bans `eval` / `delete` / `with` / prototype-chain modification / `Owned` escaping to globals or captured by closures, etc.) | compile-time completeness |

strict additionally performs **automatic drop insertion**: for an `Owned` left undisposed within a function scope, the compiler automatically inserts `x.drop()` before the function closes — business code releases correctly even without writing drop. The whole pipeline (B rules + P restrictions + autoDrop + build blocking) runs in one pass via `runPss`, wired in as an independent step of the compile pipeline.

## Vue reactivity integration

`Owned` is by default forbidden from being wrapped in `ref` / `reactive` — a Proxy would break ownership semantics (CMP071, a compile-time error in strict mode). Reactive needs go through a dedicated hook (`createOwnershipEngineering`, created via injection; the api package carries zero Vue runtime dependency):

```ts
const { useOwned, useBorrow } = createOwnershipEngineering({ reactivity: { ref } })

const view = useOwned(buf) // { state: Ref<'alive'|'moved'|'dropped'>, byteSize, borrow(), stop() }
const handle = useBorrow(buf) // Ref<Borrow | undefined> — automatically becomes undefined when the owner releases
```

`useOwned` exposes only state metadata, never the resource reference; `useBorrow`'s invalidation is reactive, and templates can consume it directly.

## Honest boundaries

- `transferToDevice()` cross-device ownership transfer: interface defined + reference implementation verified by simulation (📋 B6 awaits a real device)
- Dynamic JS outside PSS cannot receive complete compile-time checking — an inherent limitation of decidability; the runtime fallback + ownership-graph observability fill the gap
- Gradual adoption of existing code: off collects the ownership graph → frequently-leaking modules upgrade to loose → core modules upgrade to strict

## Next steps

- [Containers & hosts](/docs/framework/33-containers-hosts): how the five-atomic-step destroy delegates to the Drop protocol
- [State management](/docs/15-state-management): the boundary between stores and page-level resources
- [Conformance](/docs/framework/29-conformance): the full ownership conformance suite
