---
title: FAQ
order: 36
group: 参考
---

# FAQ

This page collects answers to the ten questions most often asked when choosing a framework. Every answer is grounded in repository documentation or shipped code; anything that cannot yet be verified is clearly marked 📋.

> Proteus answers with **honest grading**: ✅ shipped and verifiable · 🟡 partially shipped · 📋 planned and recorded. Framework-selection decisions deserve to be built on real boundaries.

## What is the difference between Proteus and uni-app / Taro?

Different routes: uni-app / Taro take the "shared logic across targets / DSL translation" route — converting a single DSL into each target; Proteus is **semantic convergence** — defining a platform-independent semantic core, with every platform difference sinking into backend implementation details. The concrete differences:

| Aspect | uni-app / Taro 3 | Proteus |
|---|---|---|
| Development paradigm | Non-standard DSL (`view`/`text`) + conditional compilation / runtime DOM emulation | Standard Vue 3 SFC + standard tags; differences absorbed at compile time |
| Web target | Translated artifacts | **Zero-transformation** standard Vite SPA |
| Rendering base | WebView (locked) | Pluggable (VueDom / Native / Flutter / Headless) |
| Compiler | Locked | Pluggable SPI (Node / Rust — one flag) |
| Multiple backends in one App | ❌ | ✅ Per-page switching + hybrid rendering |

In one sentence: plain DSL mapping means "writing native code in a different syntax"; Proteus means "defining semantics and letting any backend implement it" — this is the generational gap between syntax translation and an architectural methodology.

## What is the difference between Proteus and Flutter?

Flutter takes the **self-drawn engine** route: it computes layout itself (Skia draws the pixels itself), pursuing pixel-level consistency. Proteus picks a third route: **unified semantics + native implementation** — the framework only defines the semantic contract, and each target maps onto its strongest native implementation (iOS follows HIG, HarmonyOS follows the HarmonyOS guidelines, Android follows Material). Key differences between the two:

- **Pixel consistency vs. semantic consistency**: Flutter demands pixel-identical output across five targets; Proteus demands an identical understanding of the semantics, with the visual result following that platform's specification
- **New OS features**: the self-drawn route lags behind the OS; the semantic-mapping route is usable immediately (e.g. system-level glass maps directly to UIGlassEffect)
- **The relationship is not mutually exclusive**: Flutter itself can become one of Proteus's render backends (a Flutter widget-mapping backend has already landed as a prototype) — Flutter locks in Skia; Proteus locks in no engine

## Why use p-* semantic components instead of writing HTML / wx tags directly?

Because framework standards must **not bind to any single platform** (Principle #0, fifth projection): component names, attribute names, and API shapes from any existing platform are forbidden from being promoted directly to framework standards. Landing in rules:

- `p-*` prefix + semantic naming; the Mini Program component set such as `view` / `scroll-view` / `swiper` belongs to the Layer 1 compat layer, not to the standard (G-31.1)
- Every component property must declare its Tier downgrade behavior; missing declarations are blocked at compile time (G-31.2)
- Every Layer 0 API must be Promise / Hook-ified — no `wx.xxx`-style global objects (G-31.3)
- Even AI agents must not generate Mini Program component names — they must go through semantic primitives (G-36.2)

On the business side the experience does not become more complex — it becomes simpler: write standard Vue SFCs with zero conditional compilation; migrate existing `wx.*` code progressively with `@proteus-vue/compat-miniprogram` + `proteus migrate mp`.

## Which targets are supported right now? (the honest version)

- **✅ Fully featured Web + WeChat Mini Program** (Skyline-first; the WebView fallback only guarantees it can run); Alipay / Douyin / Kuaishou Mini Programs are not targets
- **🟡 Native / Flutter**: of the five official render backends, Native×3 and Flutter already have widget-level prototype mappings (their descriptor trees are visible in the Playground on the official site); native project wiring awaits the phased rollout under G-37
- **📋 Automotive / TV / watch** (G-25), **any-target access** (G-30), and the host runtime and execution carrier (G-39/40) are planned and recorded, rolling out in phases along the roadmap

## How is the performance?

The framework has an iron rule: **performance data must be measured; unmeasured numbers are forbidden from being claimed**. So there are no benchmark scores here — only verifiable mechanisms:

- **Compile-time-first**: on the Mini Program side — dirty-path collection + 16ms batched setData, compile-time px→rpx, automatic subpackage declarations written into app.json; on the Web side — a zero-transformation standard Vite SPA with no cross-end bridge
- **Benchmark gate**: performance baselines are pinned into the repo; a regression beyond 5% blocks the merge (G-44.5), reproducible with `npm run bench`
- **Native targets today**: still at the prototype-mapping stage; performance numbers await benchmark baselines (📋)
- **v1.0 quantified targets** (📋 goals, not promises): main package ≤ 1.2MB, high-frequency setData ≤ 60 times/second, cold start ≤ 1.5s, a 100-page project compiles in ≤ 30s

## What about TypeScript support?

TypeScript is a first-class citizen, not "supported as an afterthought":

- The whole repo is written in TypeScript 5.4+, for environments of Vue 3.4+ / Vite 5+; `vue-tsc` at zero errors is a CI gate
- `@proteus-vue/types` provides the global Registry + a Platform discriminated union; the convention's iron rules require an "any-free" runtime model
- Full-chain TS type inference for the route table: the argument types of `router.push({ name, params })` are inferred automatically from the route table
- i18n's type-safe `t()`, compile-time validation of the app.config schema, and the `api-check` capability gate are all tools within the TS ecosystem

## Is the learning curve steep? What is the mental model?

In one sentence: **learn only the semantic components, not each target**. The mental model is a single formula — semantic definition (done by the framework) + backend implementation (done by the platform): business code only consumes semantic interfaces (p-* components + 50 Capability Hooks) and has zero awareness of render backends, compile backends, or hosts. Teams that already know Vue 3 SFC have almost no new syntax to learn; methodological details can be picked up from the five pillars of Unified Semantic Convergence — the officially designated first onboarding lesson.

## What if a target doesn't support a capability?

**Downgrade without crashing** (Principle #4): unsupported capabilities are handled along the L3→L2→L1→solid downgrade chain, never crashing. Companion mechanisms keep a downgrade from turning into silent degradation:

- Backends must declare capabilities honestly; undeclared = unsupported (G-37.3)
- Downgrades must be visible: dev-time warnings + production-time logs, silence forbidden (G-37.6)
- Capability Hooks (such as `useCamera` / `usePayment`) downgrade honestly when the bridge is missing — zero platform branches in business code
- The Mini Program Platform Adapter declares a compatibility level (L0-L3) for every capability; L2/L3 must have explicit downgrade paths, no silent failure

## I have existing Mini Program code — how do I migrate?

Migration is gradual, not a rewrite. `@proteus-vue/compat-miniprogram` provides the wx compat bridge; the `proteus migrate mp` codemod scans `wx.*` APIs and generates a mapping log (tag/api × automatic/manual) plus a coverage report; on the Agent side a migrate-miniprogram Skill reuses the same chain. Existing pages first run on the compat layer, then converge onto semantic components step by step — the Mini Program component set is positioned as the Layer 1 compat layer precisely to serve this migration path.

## How do I contribute / see the roadmap?

- **Roadmap**: `docs/board-inventory.md` is the single authoritative index of all plans (the master status table) 📋; the version line is in `docs/roadmap.md` (v0.1→v2.0), and the M1-M3 milestone line is in roadmap-2
- **Currently in progress**: the render-backend SPI spec (G-37), host runtime (G-39), execution carrier (G-40), testing framework B1, and the seven newly planned B-batch items G-46~G-52 (all 📋, awaiting kickoff)
- **Contributing**: the repo provides CONTRIBUTING.md (including the convention to keep rule changes in sync); licensed Apache-2.0 (permissive, commercially usable + patent grant)

## Related pages

- [What is Proteus?](/docs/01-intro): the core formula and design philosophy
- [Pluggable architecture](/docs/framework/22-architecture): the G-series layering and the SPI-First trio
- [Conformance](/docs/framework/29-conformance): the machine-verdict mechanism behind every promise above
