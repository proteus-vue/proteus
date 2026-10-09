---
title: Create your first project
order: 5
group: 开始
---

# Create your first project

One scaffold command creates a **Web + WeChat Mini Program dual-target template project** (the scaffold produces a Web / WeChat Mini Program project; the three App targets' rollout is tracked in [Ends & maturity](/docs/framework/ends-matrix)). Everything below is sourced from `packages/create-proteus` and its templates.

## Create

```bash
npm create @proteus-vue/proteus my-app
cd my-app
npm install
```

The scaffold asks no interactive questions: the project name is the command argument (normalized to lowercase letters / digits / hyphens — capitals and illegal characters become `-`, leading/trailing `-` are trimmed). It refuses when the target directory already exists and is not empty.

## What it does — three things

1. **Copies the built-in template project** (framework snapshot + compile pipeline + example home page; artifact list below)
2. **Replaces placeholders**: `{{name}}` in the template → your project name
3. **Prints next steps**: `npm run dev:web` for Web, `npm run build:mp` for the Mini Program (the three App targets build via `proteus build --target ios|android|harmony`)

## Template artifact list

```
my-app/
├─ .agents/skills/proteus-cobuild/SKILL.md  # framework co-build skill (for AI sessions; see AGENTS.md)
├─ AGENTS.md                    # this project's conventions for AI sessions (includes the co-build loop)
├─ proteus.config.ts            # the single framework config (vite assembly is built in)
├─ package.json                 # dual-target scripts (proteus CLI commands) + @proteus-vue/* deps
├─ tsconfig.json
├─ index.html                   # Web entry
├─ docs/                        # framework co-build ledger (battle report + issue ledger json)
├─ scripts/ledger_check.mjs     # ledger self-check (`node scripts/ledger_check.mjs --check`)
├─ .github/workflows/proteus.yml # CI template (check gates → dual build → artifact archive)
└─ src/
   ├─ main.ts / main.mp.ts      # Web / Mini Program dual entries
   ├─ App.vue                   # root component
   ├─ pages/index.vue           # example home page (p-* components + @tap + interpolation)
   ├─ router/
   │  ├─ index.ts               # router instance
   │  ├─ auto-routes.ts         # gen-routes output (generated; do not edit)
   │  └─ RouterView.vue
   └─ shims/                    # mp / events / import-meta / vue type declarations
```

> **#418 config convergence**: the template has **no vite.config.ts and no scripts/** — vite config is assembled by the framework (`resolveProteusViteConfig` from `@proteus-vue/plugin-vite`); gen-routes and Mini Program entries are built into the CLI. You only need `proteus.config.ts` + CLI commands. To extend vite, use the `vite` passthrough field (plugins/server/resolve… fully vite-compatible).

## The template proteus.config.ts (compiles as generated)

```ts
const config: ProteusConfig = {
  version: 4,                       // ★ config model v4 (#641): targets are top-level keys
  targets: {
    mp: {
      appid: 'wx0000000000',        // ← replace with your real AppID
      renderer: 'skyline',
      rules: { disabled: [], mapping: {}, customTags: {} }, // e.g. { 'my-widget': 'view' }
      setDataBridge: { batchWindow: 16, perComponent: true },
      style: { px2rpx: true, rpxRatio: 2 },
    },
    // ★ three App targets (optional): native project identity (package / bundle id / version),
    //   injected by `proteus build --package`
    // ios: { bundleId: 'com.example.app' },
    // android: { applicationId: 'com.example.app' },
    // harmony: { bundleName: 'com.example.app' },
  },
  pagesDir: 'src/pages',
  router: {
    routesOutput: 'src/router/auto-routes.ts',   // gen-routes output path
    customRoute: {
      registerPresets: true,                      // built-in transition presets (shipped with @proteus-vue/router)
      builders: {
        halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
        slideUp:     'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
        scaleDown:   'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
      },
    },
  },
}
```

> ★ **v4 is per-target** (#641): Mini-Program / Skyline-specific fields (`appid` / `renderer` / `rules` / `setDataBridge` / `style.px2rpx`…) move under `targets.mp` instead of the top level; the three App identities go under `targets.{ios,android,harmony}`. Old v3 configs (flattened shape) are **auto-migrated at load time** — no manual change needed. Full field list: [compiler config](/docs/10-config).

## Template scripts (per-target commands)

| Command | What it does |
|---|---|
| `npm run dev:web` | `proteus dev --target web` (Web dev server) |
| `npm run build:web` | `proteus build --target web` (vue-tsc typecheck + vite build) |
| `npm run dev:mp` | `proteus dev --target skyline` (gen-routes + vite dev) |
| `npm run build:mp` | `proteus build --target skyline` (gen-routes → vue-tsc → Mini Program artifacts) |
| `npx proteus build --target ios` | Compile the screen-content IR for iOS → `dist/app/ios/` |
| `npx proteus build --target android` | → `dist/app/android/` |
| `npx proteus build --target harmony` | → `dist/app/harmony/` |
| `npm run debug:mp` | `PROTEUS_DEBUG=1` — artifacts with source line comments + decision trace |
| `npm run proteus` | CLI entry (same as `npx proteus`) |

> Scripts are just aliases of CLI commands — `npx proteus dev --target web` is equivalent. The CLI is the single driver: load `proteus.config.ts` → assemble the vite config → start/build; npm scripts and vite.config are never in the path.

## When npm packages are unavailable

If `@proteus-vue/*` packages fail to install (version not yet published to npm), the scaffold README documents the transition: install the matching `packages/*` from the repository path, or use npm link.

## Next steps

- [Run & preview](/docs/06-run-preview): bring up every target
- [Compiler & page configuration](/docs/10-config): full field reference for proteus.config.ts
