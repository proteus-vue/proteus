---
title: Pluggable architecture
order: 2
group: 总览
---

# Pluggable architecture

Proteus's architecture has only one theme: **not binding**. “Not binding to any single platform” is not a slogan — it is the same design move applied repeatedly across every architectural dimension:

> Any cross-target problem = semantic definition (done by the framework) + backend implementation (done by the platform)
>
> The framework defines “what you want” (the semantic interface / IR) and “how to verify it was done right” (conformance); the platform provides “how” (a backend implementation). Business developers consume only the semantic interface and have zero awareness of backends.

## The “not binding” master table (G series)

| Dimension (G series) | Semantic-layer interface (framework-defined) | Backend SPI (pluggable implementation) | Status |
|---|---|---|---|
| Platform API (G-31/32) | p-* semantic components + the 136-primitive SSOT + 50 Capability Hooks | Per-target semantic implementations; the Mini Program component set = the Layer 1 compatibility layer | ✅ |
| Render engine (G-27/37) | VNode / Component IR / LayoutConstraint IR | RenderBackend: VueDom / Native×3 / Flutter / Headless | ✅ |
| Compiler (G-29/38) | CompilerIR: `SourceFile → ProgramIR → IRModule` | CompilerBackend: Node ✅ / Rust ✅ / WASM | 🟡 |
| Fluid layout (G-22) | The p-fluid / p-grid / p-stack / p-fit / p-adaptive declarative primitives | `@proteus-vue/fluid` + the FLD001-013 gate | ✅ |
| Desktop & system primitives (G-24) | p-hover / p-shortcut / p-notify / p-master-detail — 21 modules in total (★#449 +scroll observation / cross-window messaging / anchor positioning / page URL) | `@proteus-vue/desktop` (pure-logic wiring on both targets) | ✅ |
| AI generation (G-36) | IR contract + three layers of guardrails (IR Schema / style / conformance) | MCP Server / Agent Kit / Skill | ✅ |
| Host onboarding (G-41) | Three-way orthogonality (framework × render engine × host) + the nodeOps Dispatcher | 6 hosts × 6 engines = the 36-combination matrix | ✅ |
| Container forms (G-42) | Page lifecycle state machine + the IR's single Owner | Six-container strategy: Stack / SuperApp / Window / MiniProgram / Embedded / SinglePage | ✅ |
| Resource ownership (G-43) | Owned / Borrow / Weak + the five-phase Drop protocol | The borrow checker (PSS, compile-time complete) | ✅ |
| Testing (G-44) | Test IR (serializable assertions, reusable across backends) | TestBackend × 5: Node / JSI / AOT / Host / Device | 🟡 |
| Host runtime (G-39) | ProteusHostRuntime SPI (lifecycle / threads / sole owner of the native bridge) | Web / Terminal reference implementations ready | 📋 |
| Execution carrier (G-40) | ExecutionCarrier SPI (batched diffing / zero-copy / real-time native round-trip) | JSI (default implementation) / AOT — the two reference implementations | 📋 |
| Native capabilities (G-28) | NativeBackend SPI + the Top-30 capability catalog | Official iOS / Android / HarmonyOS backends | 📋 |
| Any-target access (G-30) | Platform = the (R, C, J) triple + Tier 1-4 | Any target that provides one of a render host / a capability host / a JS runtime | 📋 |

Status scale: **✅** shipped & verifiable · **🟡** partially shipped · **📋** planned (recorded) — a plan + reference implementation, no runnable integration. Of the render backend's five official implementations, Native×3 / Flutter are currently prototype mappings (widget level); native project wiring proceeds in phases under G-37 — see [Conformance](/docs/framework/29-conformance) for the upgrade cadence.

## The SPI-First trio

Every “pluggable” dimension is built from the same trio; missing one piece makes it a fake SPI:

1. **Semantic interface**: the interface describes “what it does” in business language — vendor / technical nouns are forbidden. Glass is `<pg-glass>`, not `backdrop-filter`; ownership is `Owned<T>`, not `Rc` — swap the backend and the interface itself does not change a single word.
2. **Backend implementations (≥2)**: at least two backends, and one of them must be Headless / Mock. **A single-backend SPI is a fake SPI** — substitutability never verified is an interface bound to miss something when the real swap finally comes.
3. **Conformance verification**: any backend implementation must pass the same contract tests before joining. The tests never probe implementation details, only the semantic contract — the same suite runs against every backend, and the result is machine-decidable.

This is exactly what Principle #13 demands: any layer that claims to be “pluggable” must provide **SPI + Conformance + ≥2 reference implementations** all at once. Conversely, it doubles as an anti-pattern self-check — an interface carrying vendor terms, a single implementation, no conformance, business code bypassing the interface to call the low level directly: hit any one and the abstraction is only hiding the coupling point deeper.

## Deep dive: the host-layer trio (G-41/42/43)

The host layer is where “pluggable” is showcased most densely; three iron rules, one per layer:

**Host onboarding (G-41) — three-way orthogonality.** Framework × render engine × host evolve independently, with responsibility boundaries drawn by iron rules: the framework never touches threads / native Views / platform SDKs; the host never parses the IR or interferes with diffing; the engine has no awareness of Vue (it imports no frontend framework); business code has no platform branches. The nodeOps Dispatcher makes “switching the render engine = one assignment” — hot switching / hybrid rendering / the combination matrix are all verified by host-conformance (H-01~H-08).

**Host containers (G-42) — the six-container strategy.** Page organization is a pluggable strategy, not hardcoded:

| Container | Used for |
|---|---|
| Stack | The regular page stack |
| SuperApp | Super apps: business sandbox + crash isolation + auto-restart + signature / allowlist gateway |
| Window | Multiple windows (PC / foldables) |
| MiniProgram | Mini-program hosts |
| Embedded | Embedding into the host App |
| SinglePage | Single pages |

The IR is a page's only truth (single Owner); page teardown runs the five-step atomic protocol — unmount→unbindEvents→releaseResources→destroyIR→releaseQuota — never partially executable. Host repositories are **forbidden from forking the framework source**; `proteus conformance --repo` scans them in one command.

**Resource ownership (G-43) — the GC manages reachability, ownership manages intent**:

```ts
const file = new Owned(openFile(path))   // boundary resource registers in the ownership graph at creation
file.transferTo(pool)                    // Move semantics: the old owner accesses it again → blocked at compile time
```

The borrow checker (PSS strict — compile-time complete) blocks use-after-move / double-move / borrow escapes entirely at compile time; the five-phase Drop protocol keeps release timing deterministic without relying on the GC; the ownership graph is 100% observable, and DevTools' ownership view can locate leak paths.

## Architecture decision principles

| Principle | In one sentence | Where it lands |
|---|---|---|
| Unified semantic convergence (#0) | No cross-target translation — platform differences all sink into backend implementation details | The four projections + the G-31/32 writing surface |
| Semantic convergence, native implementation (#2/#10) | The framework defines what, the backend decides how | p-* primitives + the Backend SPI |
| Semantic consistency ≠ pixel consistency | Every target reads the semantics identically; visuals follow that platform's specification | `p-flex justify="space-between"` → UIStackView / ArkUI Flex / ConstraintLayout |
| Validation before running (#7) | What compile time can catch must never be left for runtime | IR + conformance + Golden Test |
| Downgrade without crashing (#4) | Unsupported capabilities ride the L3→L2→L1→solid degradation chain instead of crashing | BackendCapabilities capability negotiation |
| Explicit declaration > implicit assumption (#9) | Capabilities must be declared honestly; undeclared = unsupported | The capabilities table + compile-time interception |
| Determinism (G-38.6 et al.) | The same input yields behaviorally identical artifacts from any backend | IR Golden Test + reproducible builds |

## Dogfooding: the official site is the proof

The Proteus official site (the one you are reading right now) is built with the framework itself — competitor sites are usually not written with their own frameworks, so their capabilities can only be “described”. The official Proteus site's capability is **the thing rendering the page in front of you**:

- **The `@proteus-vue/docs` documentation engine**: it compiles every guide on this site into Docs IR at Vite build time, then renders — docs are compile output too, with zero parsing at runtime
- **Fluid framework first**: the site's responsiveness runs on `v-p-fluid` clamp expressions + a fluid grid, with **zero @media breakpoints** (machine-gated); the sidebar / two-column layout use `p-sidebar` / `p-split`, solved against the container
- **Mini Playground**: the same `@proteus-vue/compiler` compiles live in the browser (proof that the compiler has zero Node dependencies), and genuinely renders the same semantic tree across the five official render backends with real switching
- **System-level glass `<pg-glass>`**: the nav bar and cards use the glass primitive, and `prefers-reduced-transparency` degrades to solid color automatically

The honest boundaries are public too: routing still uses vue-router (the gap is registered for evaluation), SSG/sitemap belong to a later batch, and where primitives such as p-table / p-code-block are not implemented yet, semantic HTML bridges the gap.

## Related pages

- [Semantic model](/docs/framework/11-semantic-model): the core formula of semantic definition + backend implementation
- [Render backend](/docs/framework/23-render-backend): the RenderBackend SPI and the five official backends
- [Conformance](/docs/framework/29-conformance): how conformance anchors every layer's pluggability
