---
title: Compiler & page configuration
order: 10
group: 代码构成
---

# Compiler & page configuration

Proteus configuration is split into **two orthogonal surfaces**, their boundary drawn by **when they are consumed** (decision #211): fields consumed at build time go in `proteus.config.ts`; fields consumed at runtime go in `app.config.ts`.

| Config surface | File | Timing | What it governs | Consumers |
|---|---|---|---|---|
| **Compiler config** | `proteus.config.ts` | **Build time** | How it's built: target / compile rules / style conversion / route scanning / native project identity | Compiler, CLI, Vite plugin |
| **Runtime config** | `app.config.ts` | **Runtime** | How it behaves: app identity / API base URL / feature flags / theme & font | Business code (`useAppConfig`) |

> In short: **`proteus.config` = the compiler config (frozen at build time — a change needs a rebuild); `app.config` = the runtime config (read at launch + optional remote hot update)**.

This page covers the **compiler config** and the **page config** (the page `<route>` block — it governs one page's metadata and is likewise consumed at **compile time** by `gen-routes`); for the runtime config see [Runtime config (app.config)](/docs/11-app-config).

## Compiler config: `proteus.config.ts`

The type contract `ProteusConfig` (`@proteus-vue/types/config` is the single source of truth). **6 required fields**: `platform` / `skyline` / `appid` / `pagesDir` / `setDataBridge` / `style` + the **route fields** (`routesOutput` / `customRoute` — declared in the `router` section since #492; the top-level spelling remains as a compatibility alias); everything else is optional.

### Top-level fields

| Field | Type | Required | Ownership layer | Description |
|---|---|---|---|---|
| `platform` | `'mp-weixin' or 'web'` | Yes | compiler | Target platform |
| `skyline` | `boolean` | Yes | compiler | Whether Skyline rendering is enabled (takes effect only on mp-weixin) |
| `appid` | `string` | Yes | build | Mini Program AppID (template placeholder `wx0000000000`; must be replaced before going live). Written into project.config.json at build time / IDE import / automator health check. **≠ `app.id` in app.config** (that one is the runtime app identifier) |
| `pagesDir` | `string` | Yes | compiler | Pages root directory (the starting point of main-package route scanning); defaults to `src/pages` |
| `routesOutput` | `string` | No | router | Collected into `router.routesOutput` since #492 — the top-level spelling remains as a compatibility alias |
| `customRoute` | `object` | No | router | Collected into `router.customRoute` since #492 — the top-level spelling remains as a compatibility alias |
| `subPackages` | `array` | No | router | Collected into `router.subPackages` since #492 — the top-level spelling remains as a compatibility alias |
| `setDataBridge` | `object` | Yes | build | Reactivity → setData bridge strategy — see the table below |
| `style` | `object` | Yes | compiler | Style conversion strategy — see the table below |
| `globalStyle` | `string` | No | compiler | The global style entry (the only global entry on MP): a CSS file path relative to root (defaults to `app.wxss` in the root/app dir) — see below |
| `compiler` | `object` | No | compiler | Compiler backend swapping — see the table below |
| `skylineLayout` | `object` | No | compiler | Skyline layout-alignment switches (consuming the official alignment table) — see the table below |
| `profileBoundary` | `object` | No | compiler | Compile-time profile-boundary checks (a style unsupported on a target is reported) — see the table below |
| `layout` | `object` | No | compiler | Fluid-layout compile parameters (p-fluid clamp generation) — see the table below |
| `rules` | `object` | No | compiler | Compile rule overrides — see the table below |
| `page` | `object` | No | compiler | Page mode (auto scroll container / WebView fallback) — see the table below |
| `budget` | `object` | No | build | Bundle-size budget — see the table below |
| `router` | `object` | No | router | **Project-level route management** (#492: the unified routing config surface — structure + tabBar + meta) — see the table below |
| `vite` | `object or function` | No | build | **vite passthrough** (#418): the vite config is assembled by the framework (vue / mpTransform / aliases / build options are built in); this field is for developer extensions — see the table below |
| `audit` | `object` | No | build | **D-2 page gate rules** (#447): pick `off`/`warn`/`error` per rule — see the table below |
| `gates` | `object` | No | build | **Unified gate switches** (#456): optionally disable gates / aggregate domains via `gates.disabled` — see the table below |
| `native` | `object` | No | build | **Native project config** (#635): package name / Bundle ID / version / SDK / orientation / permissions / icon — rendered by the CLI into the three targets' native project files; see the table below |

### `vite` (passthrough — fully vite-compatible)

| Form | Description |
|---|---|
| Object | `{ plugins, server, resolve, build… }` — field semantics are fully identical to vite (`plugins` are appended after the framework plugins; the other keys override framework defaults) |
| Function | `({ command, mode }) => object` — returns different extensions per command / mode |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …required fields…
  vite: {
    server: { port: 5173, open: true },          // dev server preferences
    resolve: { alias: { '@lib': './src/lib' } }, // extra alias
    plugins: [myVitePlugin()],                    // any vite plugin
  },
}
```

> If a legacy project still holds a `vite.config.ts`, the CLI automatically takes the old compatibility path (it still runs); new projects neither need nor should create a vite.config.ts again.

### Subfield details

**`compiler` (compiler backend swapping)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `backend` | `'node' or 'rust'` | No | With `'rust'`, the build runs Node/Rust **dual-compile semantic-equivalence checks** on every .vue file (G-29.1 — a mismatch turns the build red); artifacts are still generated by the Node engine. Defaults to `'node'` (zero overhead); the CLI can temporarily override via `proteus build --compiler rust` |

**`skylineLayout` (Skyline layout alignment)**

Consumes the five alignment switches from the official *Skyline WXSS style support & differences* table (version requirements in `docs/generated/css-capability-alignment.json`) — **only `defaultDisplayBlock` defaults to `true`** (verified on real devices in this repo); the rest default to **not injected** (a switch unverified here is not decided on the project's behalf):

| Subfield | Type | Required | Description |
|---|---|---|---|
| `defaultDisplayBlock` | `boolean` | No | Nodes default to block layout, aligned with WebView/Web (form elements are no longer stretched to fill and centered); **default true** |
| `defaultContentBox` | `boolean` | No | Defaults to the `content-box` box model, aligned with Web |
| `tagNameStyleIsolation` | `boolean` | No | Tag selectors match globally, aligned with WebView (★rejected by the devtools — a platform limit) |
| `enableScrollViewAutoSize` | `boolean` | No | `scroll-view` sizes itself automatically |
| `keyframeStyleIsolation` | `boolean` | No | `@keyframes` styles are shared globally |

**`profileBoundary` (compile-time profile-boundary check)**

A compile-time static check for "a style unsupported on a target is used" — sourced from the pure enumeration of the official Skyline property support table (VC2-b). **It also runs on the Web build** (otherwise the problem surfaces late on the App targets). Escape hatch: a `proteus-allow-profile: <reason>` comment inside the style block (a non-empty reason is required; exemptions are counted).

| Subfield | Type | Required | Description |
|---|---|---|---|
| `level` | `'error' or 'warn' or 'off'` | No | Violation severity (defaults to `'error'` — blocks the build) |

**`layout` (fluid-layout compile parameters)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `designWidth` | `number` | No | Design mockup width (the base for p-fluid clamp generation) |
| `fluidViewport` | `{ min?, max? }` | No | Viewport range (clamp upper/lower bounds) |

**`customRoute` (top-level compatibility alias — collected into `router.customRoute` since #492; wx.router custom routes)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `registerPresets` | `boolean` | No | Whether the built-in preset builders are registered (defaults to `true`) |
| `builders` | `Record<string, string>` | No | Preset builders registry: name → preset source file |

**`setDataBridge` (setData bridge strategy)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `batchWindow` | `number` | Yes | Batch window (ms) — reactive changes inside the window are pushed in batches (see the runtime docs for the 16ms window) |
| `perComponent` | `boolean` | Yes | Whether to setData at component granularity (component-level isolation, avoiding whole-page pushes) |

**`style` (style conversion)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `px2rpx` | `boolean` | Yes | px → rpx conversion switch (**compile-time only**; the Web target never converts — Web keeps standard CSS and the compiler absorbs the difference) |
| `rpxRatio` | `number` | Yes | Conversion ratio (defaults to 2:1 on a 375 design mockup — see [style conversion](/docs/framework/compile-style)) |

**`globalStyle` (global style entry)**

The **only global style entry** on MP: a CSS file path relative to root (defaults to `app.wxss` in the root/app dir). Compiled at build time (px→rpx) into the artifact-root `app.wxss` (WeChat applies it globally automatically) — for design tokens / global resets; the Web target imports the same file at its entry (single source). ★Page-level wxss is scoped per page, so variables cannot be inherited across pages — **hence this global channel**.

**`subPackages` (top-level compatibility alias — collected into `router.subPackages` since #492)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | Yes | Subpackage root directory (an independent scan tree) |
| `name` | `string` | No | Subpackage name (for display in app.json) |

**`rules` (compile rule overrides — rules rewritten or disabled by AI/humans)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `disabled` | `string[]` | No | List of disabled rule IDs (see `npx proteus rules` for rule IDs) |
| `mapping` | `object` | No | Tag mapping overrides |
| `customTags` | `object` | No | Custom tag registration |

**`page` (page mode)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `autoScrollContainer` | `boolean` | No | Pages are automatically wrapped in a scroll container (Skyline pages do not scroll by themselves — scrolling requires a scroll-view; defaults to `true`) |
| `webviewPages` | `string[]` | No | ★Skyline iOS white-screen fallback: list the high-risk pages to force those pages onto WebView rendering (no global downgrade) — see the note below |

> **`page.webviewPages` (page-level WebView fallback channel)**: the Skyline renderer has a known intermittent white screen on iOS devices (a WeChat platform issue, more frequent with animations/canvas). Listing the high-risk pages makes their `page.json` omit `renderer: skyline`, leaving other pages unaffected. Key matching is lenient (page name `home` / `pages/home` / a subpackage-relative path all work); enable it only for pages that **actually reproduced** the white screen — do not downgrade preemptively.

**`budget` (bundle-size budget)**

| Subfield | Type | Required | Description |
|---|---|---|---|
| `mainPackageKB` | `number` | No | Main package size limit in KB (warns / blocks when exceeded) |
| `strict` | `boolean` | No | Strict mode: exceeding the limit fails the build outright (not just a warning) |

**`router` (project-level route management — since #492, the single declaration surface for all routing config)**

> The three route-structure fields (`routesOutput` / `subPackages` / `customRoute`) have been collected here from the top level; the top-level spelling remains as backward-compatible aliases (`router.*` wins; declaring both is flagged at build time for convergence). Consumers (gen-routes / the app skeleton) read the effective config via `resolveRouterConfig()`.

| Subfield | Type | Required | Description |
|---|---|---|---|
| `routesOutput` | `string` | No | Route output file (generated by gen-routes at compile time; defaults to `src/router/auto-routes.ts`) — declare here or at the top level (at least one) |
| `subPackages` | `array` | No | Subpackage config: `root` (an independent scan tree) / `name` (for display in app.json + module mapping), see the table below |
| `customRoute` | `object` | No | wx.router custom routes, see the table below — declare here or at the top level |
| `tabBar` | `object` | No | tabBar declaration: `color` / `selectedColor` / `list` (`{ name, text, icon? }[]`, `name` refers to the route name). **When omitted, it is derived from meta.isTab** (the declared list takes precedence for order and labels) |
| `meta` | `Record<string, RouteMeta>` | No | Centralized meta (decision #113): match priority — exact path > directory prefix > default |

**`audit` (D-2 page gate — developer picks the rule severity)**

> D-2 (05-dogfooding-conformance) automated gate: pages must not raw-write platform APIs / hand-write `@media` / pull in third-party UI libraries — wrapping lives only in framework packages, pages keep zero raw writes. The official site, as the proving ground, runs every rule at `error`; developer projects can downgrade any rule to `warn` (reported without blocking) or `off` (not enabled) as needed. **Rules turned off or downgraded are called out in the audit report** — PASS = the enabled rule set has zero violations; any undeclared rule defaults to `error` (fail-closed, no silent disabling).

| Subfield | Type | Required | Description |
|---|---|---|---|
| `dir` | `string` | No | Directory of the pages under audit (relative to the project root; defaults to `src`) |
| `rules` | `object` | No | rule → severity (rules not listed default to `error`) |

The four rule IDs in `rules` (single source of truth: `AUDIT_RULE_IDS` from `@proteus-vue/types`):

| Rule ID | What it blocks | Report tag |
|---|---|---|
| `no-third-party-ui` | Importing third-party UI libraries (element-plus/vant/antd/naive-ui/quasar…) | `[D2-UI]` |
| `no-media-query` | Hand-written `@media` breakpoints (responsiveness belongs to v-p-fluid clamp + the fluid grid) | `[W-6/C8]` |
| `no-platform-api` | Direct Mini Program platform API calls (`wx.request` and so on) | `[D2-PLATFORM]` |
| `no-web-platform-api` | Raw Web platform API calls (`window.`/`document.`/`navigator.`/`location.`/`fetch` and so on) | `[D2-PLATFORM-WEB]` |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …required fields…
  audit: {
    dir: 'src',
    rules: {
      'no-media-query': 'warn', // allow hand-written @media? downgrade to warn — reported but not blocking
      'no-web-platform-api': 'off', // turn off the raw Web platform call check entirely
      // the other two are undeclared → default error
    },
  },
}
```

> Exemption registration still applies: the Web platform rule allows per-line `// d2-exempt: <reason>` and whole-file annotations (native visual-asset pages) — exemption reasons are emitted with the audit report. How to run: `proteus audit d2` (inside a project, omit the directory argument → it scans `audit.dir ?? src`, with rules from this config); the official-site gate is `npm run audit:website`.

**`gates` (unified gate switches — #456, every gate behind one config surface)**

> The gate catalog = `proteus gate ls` (the registry is the single source of truth). `gates.disabled` lists the gate IDs / preset IDs / aggregate-domain IDs to turn off — it takes effect uniformly across `proteus gate run`, `proteus check`, and `proteus audit all` (all enabled by default; disabled gates are skipped and noted, without blocking — exit 0).

| Subfield | Type | Required | Description |
|---|---|---|---|
| `disabled` | `string[]` | No | Disable list: gate / preset IDs (from the `proteus gate ls` catalog: check/audit/d2/fluid/api-check/capabilities/i18n/router/module/css/style/config/components/coverage/devtools-budget…) + aggregate-domain IDs (audit's ten domains: route/module/config/i18n/capabilities/components/d2/api-check/fluid/devtools-budget · check: css/style/router/cli/app-config) |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …required fields…
  gates: {
    disabled: ['capabilities', 'devtools-budget'], // demo-page violation domain and performance smoke test — kept out of the gates for now
  },
}
```

> Semantic layering: `audit.rules` controls **D-2 internal rule severity** (`off`/`warn`/`error`); `gates.disabled` controls **gate / aggregate-domain switches** (skip a whole domain) — the two layers stack.

**`native` (native project config — #635, passing native project identity to the build chain)**

Passes the **native project identity** (package name / Bundle ID / version / SDK / orientation / permissions / icon) from the project to the build chain — the CLI **renders it into** the host project's native files at `proteus create host` and `proteus build --target <target> --package` (these values used to be hardcoded in the host project, editable only by hand on the project side):

| Field | Target file | Description |
|---|---|---|
| `native.app.{name,version,buildNumber}` | All targets · shared | Falls back to app.config's `app.*` (the runtime identity; the two can mirror each other) |
| `native.android.{applicationId,label,versionName,versionCode,minSdk,targetSdk,orientation,permissions,icon}` | `AndroidManifest.xml` | applicationId defaults to the host runtime's package; the activity uses the FQN so the package can change |
| `native.ios.{bundleId,displayName,version,buildNumber,minimumOSVersion,deviceFamily,orientations}` | `Info.plist` | |
| `native.harmony.{bundleName,label,vendor,versionName,versionCode,compatibleSdkVersion,targetSdkVersion,deviceTypes,permissions}` | `AppScope/app.json5` + `entry/module.json5` + `string.json` | bundleName is also the **signing-bound** key (changing it means changing the profile) |

```ts
// proteus.config.ts
const config: ProteusConfig = {
  // …required fields…
  native: {
    app: { name: 'MyApp', version: '1.2.3', buildNumber: '45' },
    android: { applicationId: 'com.acme.myapp', orientation: 'portrait', minSdk: 26, permissions: ['android.permission.INTERNET'] },
    ios: { bundleId: 'com.acme.myapp', deviceFamily: [1], orientations: ['portrait'] },
    harmony: { bundleName: 'com.acme.myapp', deviceTypes: ['phone'] },
  },
}
```

> **Responsibility boundary (G-35.1)**: `native` = **build time** (consumed by the CLI, written into the native files); app.config's `app.*` = **runtime** (read/reported by business code). Values fall back, but the boundary does not change. **Field-level patch**: only the identity fields change; the rest of the project is preserved (hand-edited layout/capabilities are untouched); **idempotent** (re-applying yields the same result).

### Validation & tooling

```bash
proteus config:check proteus.config.ts   # required fields + cross-layer dependencies (CONFIG_LAYER_VIOLATION) + version-migration hints
proteus generate types                    # generates the JSON Schema (.proteus/proteus.config.schema.json — IDE autocomplete)
```

> Migration of existing projects since #492: the top-level `routesOutput` / `subPackages` / `customRoute` spelling keeps working (backward compatible; when both are declared, `router.*` wins and the build logs a convergence hint); new projects declare inside the `router` section (the create-proteus template already ships the unified form). Config schema version is now v3: projects with an explicit `version: 2` are collected into the router section by the migration chain automatically.

The field-ownership table (compiler / router / build / pinia…) is driven by `CONFIG_FIELD_LAYERS` as its single source of truth: **new top-level fields must declare their ownership layer**; cross-layer semantics (e.g., writing a pinia key inside a router field) raise `CONFIG_LAYER_VIOLATION`.

## Page configuration: the `<route>` block

Each page declares its metadata locally in a `<route>` custom block, which `gen-routes` reads at compile time:

```vue
<!-- src/pages/user/profile.vue -->
<route>
{
  "name": "user-profile",
  "meta": { "title": "Profile", "requiresAuth": true, "transition": "slideUp" }
}
</route>
```

### `meta` fields (RouteMeta, single source `@proteus-vue/contracts`)

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | No | Navigation bar title |
| `isTab` | `boolean` | No | Whether it is a tab page (tabBar.list is declared by `router.tabBar` in proteus.config) |
| `requiresAuth` | `boolean` | No | Login guard (checked before route navigation) |
| `permissions` | `string[]` | No | Permission guard (format `resource:action`; security M3) |
| `transition` | `'slideUp' or 'slideDown' or 'halfScreen' or 'scaleDown' or 'none'` | No | Transition animation |
| `[key: string]` | `unknown` | No | Arbitrary extension fields (JSON-serializable only — read by business custom guards) |

Centralized meta (`router.meta` in `proteus.config.ts`) and the per-page `<route>` declaration **can coexist**: match priority — exact path > directory prefix > default; explicit declarations always win.

## Omitting it is also valid

The `<route>` block is entirely optional — `path` / `name` are derived from the file location (`pages/user/profile.vue` → path `pages/user/profile`, name `user-profile`; `index.vue` collapses into the directory path), and pages without a block are still registered. **Explicit declarations always win.**

## Next steps

- [Runtime config (app.config)](/docs/11-app-config): the full field table of runtime config and useAppConfig
- [Routing & navigation](/docs/16-router): the complete model of the route tree and per-target codegen
- [CLI & project commands](/docs/28-cli): the full `proteus` command-line family
