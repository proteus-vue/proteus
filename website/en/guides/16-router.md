---
title: Routing & navigation
order: 16
group: 基础概念
---

# Routing & navigation

Cross-platform routing is awkward: on the Web it is an SPA route table (history); in a Mini Program it is a page stack (`app.json` pages + tabBar) — two mental models and two configurations, and changing one page means touching several places. Proteus routing (`@proteus-vue/router`) answers with a **build-time page table + per-target codegen**: the `<route>` block on a page is the single source of truth; scanning folds everything into one route tree, from which every target gets its own form — Web (route table) and Mini Program (page configuration) are wired today; iOS / Android / HarmonyOS / Flutter consume the same tree's target semantics (implemented per backend in the rendering layer — see [Render backend](/docs/framework/23-render-backend)).

> **`<route>` declared next to the page → scan + validate → nested tree → per-target codegen (Web / Mini Program wired today; other targets consume the same tree semantics).**
> Zero hand-written configuration, no drift across targets, and the artifacts can be traced back to their source (every record carries a `loc`).

## Route model: one tree, two forms

At build time, the CLI scans `<route>` blocks in page files (reusing `@vue/compiler-sfc` parsing, so file and line numbers come for free), validates the schema, de-duplicates, and resolves nesting (path prefixes are inferred automatically, with an explicit `parent` override), producing a `RouteNode[]`. It is then dispatched per target:

| Target | Form | Artifact |
|---|---|---|
| Web | SPA route table | `generateWebRoutes(nodes)` → vue-router `RouteRecordRaw` code (lazy → `() => import()` code splitting; nesting → recursive `children`) |
| Mini Program | Page stack | `generateMpConfig(nodes)` → `app.json` page configuration (Skyline is an MPA: nesting degrades to a flat list, with `meta.__parent` keeping the parent chain; `meta.transition` → `routeType`) |

> Native / Flutter targets do not generate `RouteRecordRaw` / `app.json` — each render backend adapts the same route tree to its target (navigation semantics / transition mapping; see [Render backend](/docs/framework/23-render-backend) and [Containers & hosts](/docs/framework/33-containers-hosts)).

Page declarations take the **zero-boilerplate** route: the `<route>` block is entirely optional — `path` / `name` can be derived from the file location (`pages/user/profile.vue` → path `pages/user/profile`, name `user-profile`; `index.vue` collapses into the directory path). Pages without the block are included too, with `meta` injected centrally from configuration; an explicit declaration always takes precedence:

```vue
<!-- src/pages/user/profile.vue -->
<route>
{
  "name": "user-profile",
  "meta": { "title": "Profile", "requiresAuth": true, "transition": "slideUp" }
}
</route>

<template><p-text>Profile</p-text></template>
```

`RouteRecord` is centrally defined by the cross-layer contracts package `@proteus-vue/contracts` (`name` / `path` / `component` / `parent` / `meta` / `subPackage` / `params`); `meta` supports fields such as `requiresAuth`, `permissions`, `title`, `isTab`, `transition`.

## Runtime: createRouter

The route table is injected by the caller (factory-based, no global singleton — testable, and friendly to multiple instances / micro-frontends):

```ts
import { createRouter } from '@proteus-vue/router'
import routes from './router/auto-routes' // generated at build time by gen-routes

const router = createRouter(routes, {
  auth: () => Boolean(getToken()),            // checker for the requiresAuth auto guard
  permissions: registry,                      // hasAll checker for meta.permissions
  onAuthFail: () => router.push({ name: 'login' }),
})

// Named routes + type safety: params types are augmented by the RouteParamsByName module and matched automatically
await router.push({ name: 'user-profile' })
await router.push({ path: 'pages/cart', query: { id: '7' } })
router.back()
```

| API | Description |
|---|---|
| `createRouter(routes, options?)` | Router factory; `options.auth` / `permissions` / `traceBus` are optional injections |
| `router.push(options)` | Navigate by name or path; options: `replace` / `reLaunch` / `switchTab` / `routeType` |
| `router.back(delta?)` | Go back (default 1) |
| `router.beforeEach(guard)` / `afterEach(guard)` | User guards (consistent across all three targets; returning false cancels the navigation) |
| `router.stackDepth` | Page stack depth (real stack depth on MP; always 1 on Web) |

The guard order along the navigation chain is fixed: the `requiresAuth` auto guard (reads `options.auth`) → the `permissions` auto guard (reads `options.permissions.hasAll`) → the user `beforeEach`. Platform details are absorbed by the adapter: on the Mini Program target, a stack depth ≥ 9 automatically degrades to `redirectTo` (a hard boundary at 10 layers), while Skyline custom-route transitions are taken over by an `isSkyline()` detection branch; once a `traceBus` is injected, every navigation emits start / point / end events (route tracing in DevTools; zero overhead in production).

## Transitions & navigation semantics

Transitions are a **declarative enum** (`RouteTransition`): `slideUp` / `slideDown` / `halfScreen` / `scaleDown` / `none` — the two shared maps `WEB_TRANSITION_MAP` and `MP_ROUTE_TYPE_MAP` translate them into Web CSS transition names and Skyline `routeType` respectively, so both ends animate identically without writing two copies:

```ts
import { webTransitionName, mpRouteType } from '@proteus-vue/router'

webTransitionName('slideUp') // Web-side CSS transition name
mpRouteType('halfScreen')    // Skyline custom-route routeType
```

On top of this, the navigation-stack semantics layer (G-32 M1) provides `NAVIGATION_MAP` (navigation semantics → the native API of each target) along with `computeRoutePatch` / `applyRoutePatch` (a diff of the page stack — the input to a transition transaction); deep links (B11) cover URL parsing, whitelist validation, and cold-start multi-level stack construction:

```ts
import {
  parseDeepLinkUrl,
  isDeepLinkAllowed,
  resolveDeepLink,
  buildColdStartStack,
} from '@proteus-vue/router'
import type { DeepLinkConfig } from '@proteus-vue/router'

// scheme + host whitelist + pattern → route mapping (the router.deepLink config in defineProteus)
const config: DeepLinkConfig = {
  scheme: 'deeplink',
  routes: [{ pattern: '/user/:id', path: 'pages/user/profile', stack: 'push' }],
}

if (isDeepLinkAllowed(parseDeepLinkUrl('deeplink://app/user/7'), config)) {
  const target = resolveDeepLink('deeplink://app/user/7', config) // → { path, params, stack }
  if (target) {
    // allPaths = every path in the app route table — the cold-start stack takes the ancestor chain of the target route
    const stack = buildColdStartStack('/' + target.path, allPaths) // ['/pages', '/pages/user', …]
  }
}
```

## Honest boundaries: the current state of this website

This website itself is **currently powered by vue-router** — the header note in `website/src/router.ts` says it honestly: `@proteus-vue/router`'s route model targets "a build-time page table + dual-end generation" (gen-routes page routing / the Mini Program page stack), whereas this website is a pure Web SPA with dynamic doc sections (`/docs/:slug`), so this batch of pages is carried by vue-router as a transition. The gap is a deliberately public dogfooding signal: the website does not dress up its own router as fully rolled out, and the replacement work is registered for evaluation (W-1, an auditable gap) — consistent with the "write the website to backfill the Router plan" expectation. The route framework's own three-target capabilities are genuinely shipped: scan / tree / codegen / guards / transition maps are all covered by tests, and the Mini Program side is carried by the build-time artifacts (`app.json` + the page stack).

## Next steps

- [Containers & hosts](/docs/framework/33-containers-hosts): how the page stack relates to container shapes
- [Testing & deployment](/docs/27-testing-deploy): validating the route table and the dual-end artifacts
- [Compiler pipeline](/docs/framework/26-compiler-pipeline): how the `<route>` block is consumed at build time
