---
title: Worklet runtime
order: 111
group: Rendering primitives
---

# Worklet runtime

Skyline UI-thread runtime — wraps the official `wx.worklet`, degrades honestly to the JS thread elsewhere

> Source module `@proteus-vue/worklet` (**Skyline UI-thread animation** — wraps the official `wx.worklet`; off Skyline it **degrades honestly** to JS-thread rAF interpolation instead of pretending to have UI-thread isolation. See the [Skyline pitfalls ledger](/docs/framework/skyline-pitfalls)).

**★Skyline line closure (2026-09-11): the worklet runtime — a wrapper over the official wx.worklet plus honest degradation off Skyline.**
Official surface: wx.worklet.shared/derived/timing/spring/decay/sequence/delay/repeat/Easing/runOnJS/runOnUI + component `applyAnimatedStyle(selector, workletFn)` (binds UI-thread-driven styles).
Degradation: off Skyline (WebView / Web / SSR) → JS-thread requestAnimationFrame interpolation — the capability is declared honestly (no pretending).
Principle: never reference wx bare (read from globalThis); the capability matrix SSOT is `detectMpRenderer` in @proteus-vue/shared.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| WeChat Mini Program (Skyline) | ✅ | Official `wx.worklet` (shared/derived/timing/spring/decay/runOnJS/runOnUI) + `applyAnimatedStyle` binding; the compiler pass-through for `worklet:xxx` is verified |
| WeChat Mini Program (WebView) | ✅ | **Honest degradation**: JS-thread rAF interpolation (same API, reported truthfully: `hasWorklet() === false`, no UI-thread isolation) |
| Web SPA | ✅ | Same degradation path (rAF interpolation) — usable for local preview and unit tests; `hasWorklet()` reports `false` truthfully |
| Headless (SSR/testing) | ✅ | Pure logic runs on Node (`resetWorklet` for test resets) |
| iOS native | 🟡 | Mapping planned — native animation driver not started |
| Android native | 🟡 | Mapping planned — native animation driver not started |
| HarmonyOS | 🟡 | Mapping planned (ArkUI animateTo) not started |
| Flutter hybrid | 🟡 | Widget animation mapping not started |
| Quick App | ⬜ | target not started |

> Status scale: ✅ target shipped & this primitive usable · 🟡 prototype mapping — wiring not started · ⬜ target not started. Family-level mechanism coverage (not a per-target on-device verification matrix); target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).

## Core exports (SSOT: `packages/worklet/src/runtime.ts`)

| Export | Kind | One-liner (source comment) |
|---|---|---|
| `hasWorklet` | function | Whether real Skyline worklets are available (real Mini Program + Skyline renderer + wx.worklet present) |
| `createWorkletRuntime` | function | Create the worklet runtime (lazy singleton) |
| `getWorklet` | function | Read the current runtime (undefined before first creation) |
| `workletRuntime` | const | Lazy singleton instance |
| `resetWorklet` | function | Reset for tests |

## Usage (from the package README / source signatures — verifiable in-repo; no runtime screenshot attached)

```ts
import { shared, timing, spring, applyAnimatedStyle, hasWorklet, getWorklet } from '@proteus-vue/worklet'

// 1) shared values (UI-thread on Skyline; the same API holds plain values elsewhere)
const offset = shared(0)
const scale = shared(1)

// 2) describe animations (same semantics as the official timing/spring)
const a = timing(offset, 120, { duration: 300, easing: 'easeOut' })
const s = spring(scale, 1.06, { stiffness: 180, damping: 14 })
a.start?.(); s.start?.()

// 3) bind to component styles (returns an unbind fn; UI-thread driven on Skyline, applied once elsewhere)
const unbind = applyAnimatedStyle(this, '.card', () => ({
  transform: `translateX(${offset.value}px) scale(${scale.value})`,
}))

// 4) capability probe (never fail silently — report honestly when unavailable)
if (hasWorklet()) {
  // real Mini Program + Skyline: UI-thread isolation (frequent scroll/gesture work won't block JS)
} else {
  // honest degradation: `getWorklet().real === false`; animation runs on the JS thread via rAF (correct, no isolation)
}
onUnmounted(() => unbind())
```
> Origin: `packages/worklet/README.md (usage) + src/runtime.ts:hasWorklet/getWorklet`

```ts
<!-- template side: the official WXML prefix is passed through by the **compiler** — no runtime API import -->
<view worklet:style="{{animatedStyle}}">…</view>
```
> Origin: `packages/worklet/README.md (template side) + docs/skyline-pitfalls.md:227 (pass-through verified)`

## Usage & degradation

- **entry**: `shared(initial)` / `derived(fn)` create shared values → `timing/spring/decay` describe the animation → `applyAnimatedStyle(scope, selector, updater, config)` binds it to component styles (returns an unbind function)
- **zero runtime API in templates**: `worklet:style="{{animatedStyle}}"` is passed through by the **compiler** as the official WXML prefix (no import needed)
- **honest degradation**: off Skyline (WebView / Web / SSR) → the same API interpolates on the JS thread via rAF; `hasWorklet() === false` / `real === false` — it never pretends to have UI-thread isolation
- **capability probe**: `hasWorklet()` requires all three (real Mini Program + Skyline renderer + `wx.worklet`); the component-level capability matrix SSOT lives in `@proteus-vue/shared` (`detectMpRenderer`)
- real consumer: the `hasWorklet()` probe in `packages/components/runtime/capability.ts`; Skyline limits → [Skyline pitfalls](/docs/framework/skyline-pitfalls)

<!-- generated by website/scripts/gen-primitives.mjs (en overlay) · SSOT：packages/worklet/src -->