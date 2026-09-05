---
title: Ends & maturity
order: 6
group: 总览
---

# Ends & maturity

> This page is driven by the end registry (`website/src/ends.ts`, the W-7 SSOT principle). **Onboarding a new end = one added registry row + status advancement** — the end matrix in the docs must not hand-write a second end list.

## The end registry

| End | Render engine | Logic-layer runtime | Persistence | State factory | Status |
|---|---|---|---|---|---|
| Web SPA | vue-dom | Vue 3 (same thread) | localStorage | `createWebPinia()` | ✅ shipped |
| WeChat Mini Program | skyline (WebView fallback) | Separate JS runtime | wx storage (debounced) | `createMpPinia()` | ✅ shipped |
| Headless (SSR/testing) | headless | Node | memory | `createSsrPinia()` | ✅ shipped (tool tier) |
| iOS native | native-ios (UIKit) | JSI carrier (G-40) | NativeKVAdapter (not yet onboarded) | `createAppPinia()` | 🟡 prototype mapping |
| Android native | native-android (Jetpack) | JSI carrier (G-40) | NativeKVAdapter (not yet onboarded) | `createAppPinia()` | 🟡 prototype mapping |
| HarmonyOS | native-harmony (ArkUI) | JSI carrier (G-40) | TBD | `createAppPinia()` | 🟡 prototype mapping |
| Flutter hybrid | flutter | Same JS logic layer | TBD | `createAppPinia()` | 🟡 widget-level mapping |
| Quick App | Quick App engine (TBD) | TBD | TBD | TBD | ⬜ not started |

> The four status tiers follow the repo-wide discipline: ✅ shipped & verifiable · 🟡 partially shipped · 📋 planned (recorded) · ⬜ not started — **end-specific claims must carry a status** (W-4: proof before claims).

## The full engine set (registered via the RenderBackend SPI)

`vue-dom` · `flutter` · `native-ios` · `native-android` · `native-harmony` · `skyline` · `skia` · `canvas2d` · `headless` — the SSOT for semantic→engine mapping is `SEMANTIC_BACKEND_MAP` (component-ir); the end matrix in the docs and the code share one registry.

## Onboarding a new end (W-7 §4)

1. **⬜→📋** Add a registry row + link the related plan
2. **📋→🟡** Extend the affected end-matrix tables with a column (lifecycle / artifact comparison / capability degradation)
3. **🟡→✅** Add the end pages (`runtime-{end}.md`) + extend the quick-start journey (only once the end actually runs end-to-end)

## Next steps

- [Pluggable architecture](/docs/framework/22-architecture): the SPI panorama
- [Conformance](/docs/framework/29-conformance): the cross-target semantic gate
