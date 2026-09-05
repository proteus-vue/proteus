---
title: Containers & hosts
order: 28
group: 宿主与内存
---

# Containers & hosts

Containers, host runtimes, and execution carriers are the three runtime layers of “sole ownership”: **containers (G-42)** govern the page lifecycle and resource reclamation, **host runtimes (G-39)** govern processes, threads, and the native bridge, and **execution carriers (G-40)** govern which path the JS code runs on. All three layers are pluggable SPIs — business code depends only on page semantics and never perceives the implementation.

> **Containers govern “how a page is destroyed”; ownership (G-43) governs “who the resources belong to”** — only the two combined make up complete runtime memory governance (see [Ownership engineering](/docs/framework/34-ownership)).

## Six container forms

A container is not bound to one form: six strategies cover every host scenario, from single-page apps to super apps, all built on the same page-lifecycle contract:

| Container | Scenario | Key capability declaration | Status |
|---|---|---|---|
| `singlepage` | Single-page apps / landing pages | Single-slot replace, no page stack | ✅ |
| `stack` | Regular multi-page apps | pageStack + keepAlive (LRU) + quota | ✅ |
| `superapp` | Super apps with multiple businesses | multiBusiness + crash isolation L2 + sandbox / security gateway | ✅ |
| `miniprogram` | Mini Program host semantics | 10-layer navigation stack + tab keep-alive + crash isolation L1 + sandbox | ✅ |
| `window` | Desktop multi-window | windowManagement, each window holds its own independent stack | ✅ |
| `embedded` | A mount point embedded in an existing host | Single-slot embed, following the host lifecycle | ✅ |

```ts
import { createStackContainer } from '@proteus-vue/render-backend'

const container = createStackContainer({ quotaLimitBytes: 512 * 1024 * 1024 })
await container.initialize()
const page = await container.push({ irId: 'home' }) // page stack / keepAlive / quota apply per the declared capabilities
```

All six containers ship runnable implementations (stack / superapp / the four basic containers — conformance zero FAIL); large-scale validation in real host apps 🟡 is ongoing.

## Page lifecycle: state machine + five-atomic-step destroy

Page state is constrained solely by the state machine; illegal transitions are rejected outright:

- `created → mounted ⇄ hidden → destroyed → recycled`
- `mounted → crashed → destroyed` (a crashed page can only be destroyed — the container restart policy takes over)

Destruction is fixed as a **five-atomic-step sequence**; both the step count and the order are machine-verified by `assertAtomicDestroy`, and any violation throws:

1. `unmount` — unmounts the component tree
2. `unbindEvents` — unbinds every event (forcibly invalidating borrows included)
3. `releaseResources` — fully clears the ResourcePool, delegating the force-drop to the ownership Drop protocol
4. `destroyIR` — destroys the IR instance (the IR has a single Owner)
5. `releaseQuota` — returns the entire quota

The `resourcePool` carried by `PageHandle` spares business code from hand-written cleanup: resources registered in the pool are released in one shot with the page's destruction; conformance uses “pool total after destruction = 0” as the machine evidence for leak detection.

## Conformance: capability gating

Container conformance totals 38 checks (C-01 ~ C-08), built on the core mechanism of **capability gating** — a container declares its `capabilities` truthfully (CMP065): capability groups that are not declared are honestly SKIPped, while declared ones must all pass:

| Group | Coverage | Checks | Gate condition |
|---|---|---|---|
| C-01 | Container identity & capability declaration | 4 | Always run |
| C-02 | Page lifecycle state machine | 5 | Always run |
| C-03 | Five-atomic-step destroy | 6 | Always run (core) |
| C-04 | Page stack governance | 4 | `pageStack` |
| C-05 | Leak detection (resource pool = 0 after destroy) | 5 | Always run (core) |
| C-06 | Quota management | 4 | `resourceQuota` |
| C-07 | Sandbox & crash isolation | 6 | `multiBusiness` |
| C-08 | Security gateway + anti-fork repository scan | 4 | Gateway per `_security` declaration |

The fork scan under C-08 (`proteus conformance --repo <dir>`) machine-checks whether a host repository has forked the framework's internals (G-42.6 forbids forking — any hit is an immediate FAIL and blocks CI).

## Host runtime (G-39)

The host runtime is the sole owner of the L4 layer, and its SPI has the same shape as the render / compiler backend SPIs (15 + 3 optional methods):

- **Lifecycle**: `bootstrap` / `suspend` / `resume` / `destroy` — the four-state machine (bootstrapping / running / suspended / destroyed) is exclusively owned by the Runtime; backends only subscribe to events and must not determine foreground / background on their own
- **Thread model**: `createWorker` / `postMessage` / `runOnThread` — the thread pool and task priorities belong to a single owner
- **JS engine**: `createEngine` / `evalInEngine` — the execution-carrier slot (see the next section)
- **Native bridge**: `invokeNative` / `registerNativeHandler` — unified serialization + thread switching
- **Event loop**: `enqueue` / `nextTick` / `setInterval` and more — task priorities belong to a single owner

Status: 📋 the SPI is finalized (conformance 42 checks), the Web / Terminal reference implementations are checked in, and real host projects on iOS / Android / Harmony are being onboarded in batches.

## Execution carrier (G-40)

The compiler's emit artifacts decide the execution path; carrier switching is transparent to business code:

| Carrier | Artifact | Characteristics |
|---|---|---|
| JSI (default) | JS bundle / bytecode | Full JS ecosystem + hot updates; bytecode optimizes startup |
| AOT | Native code | No JS boundary + true concurrency — the endgame for real-time capability; loses dynamism |
| WASM | wasm module | The sandboxed-isolation path |

Companion iron rules: **business code must not assume a JS runtime exists** (G-40.1: no `eval`, no relying on the precise timing of `setTimeout`, no `Proxy` runtime interception, etc.); the same source stays semantically equivalent across the three paths (G-40.2); chunks of data larger than 4KB are forced through ArrayBuffer zero-copy, degrading explicitly when the target end does not support it (G-40.4).

Status: 📋 the plan is checked in — the JSI / AOT dual reference implementations and the real-time escape closed loop are runnable; the production AOT path lands together with the compiler backend.

## Tier declarations for combinations

Every host × engine combination is declared per **Tier** and machine-verified (Tier 1 = verification promised / Tier 3 = mixing is viable but not promised / Tier 0 = not legal across ecosystems); see [Conformance](/docs/framework/29-conformance) for details.

## Next steps

- [Conformance](/docs/framework/29-conformance): the Tier matrix and the conformance suite
- [Routing & navigation](/docs/16-router): navigation semantics on top of the page stack
- [Ownership engineering](/docs/framework/34-ownership): how page destruction is made leak-proof
