---
title: Create your first project
order: 5
group: 开始
---

# Create your first project

One scaffold command creates a **Web + WeChat Mini Program dual-target project**. Everything below is sourced from `packages/create-proteus` and its templates.

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
3. **Prints next steps**: `npm run dev:web` for Web, `npm run build:mp` for the Mini Program

## Template artifact list

```
my-app/
├─ proteus.config.ts            # the single framework config (vite assembly is built in)
├─ package.json                 # dual-target scripts (proteus CLI commands) + @proteus-vue/* deps
├─ tsconfig.json
├─ index.html                   # Web entry
├─ .github/workflows/proteus.yml # CI template (check gates → dual build → artifact archive)
└─ src/
   ├─ main.ts / main.mp.ts      # Web / Mini Program dual entries
   ├─ App.vue                   # root component
   ├─ pages/index.vue           # example home page (p-* components + @tap + interpolation)
   ├─ router/
   │  ├─ index.ts               # router instance
   │  ├─ auto-routes.ts         # gen-routes output (generated; do not edit)
   │  └─ RouterView.vue
   └─ shims/                    # mp / events / vue type declarations
```

> **#418 config convergence**: the template has **no vite.config.ts and no scripts/** — vite config is assembled by the framework (`resolveProteusViteConfig` from `@proteus-vue/plugin-vite`); gen-routes and Mini Program entries are built into the CLI. You only need `proteus.config.ts` + CLI commands. To extend vite, use the `vite` passthrough field (plugins/server/resolve… fully vite-compatible).

## The template proteus.config.ts (compiles as generated)

```ts
const config: ProteusConfig = {
  platform: 'mp-weixin',
  skyline: true,
  appid: 'wx0000000000',        // ← replace with your real AppID
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: {
    registerPresets: true,
    builders: {                  // built-in transition presets (shipped with @proteus-vue/router)
      halfScreen: 'node_modules/@proteus-vue/router/src/presets/halfScreen.ts',
      slideUp:     'node_modules/@proteus-vue/router/src/presets/slideUp.ts',
      scaleDown:   'node_modules/@proteus-vue/router/src/presets/scaleDown.ts',
    },
  },
  rules: { disabled: [], mapping: {}, customTags: {} }, // e.g. { 'my-widget': 'view' }
  setDataBridge: { batchWindow: 16, perComponent: true },
  style: { px2rpx: true, rpxRatio: 2 },
}
```

Field docs: [global config](/docs/10-config).

## Template scripts (dual-target commands)

| Command | What it does |
|---|---|
| `npm run dev:web` | `proteus dev --target web` (Web dev server) |
| `npm run build:web` | `proteus build --target web` (vue-tsc typecheck + vite build) |
| `npm run dev:mp` | `proteus dev --target skyline` (gen-routes + vite dev) |
| `npm run build:mp` | `proteus build --target skyline` (gen-routes → vue-tsc → Mini Program artifacts) |
| `npm run debug:mp` | `PROTEUS_DEBUG=1` — artifacts with source line comments + decision trace |
| `npm run proteus` | CLI entry (same as `npx proteus`) |

> Scripts are just aliases of CLI commands — `npx proteus dev --target web` is equivalent. The CLI is the single driver: load `proteus.config.ts` → assemble the vite config → start/build; npm scripts and vite.config are never in the path.

## When npm packages are unavailable

If `@proteus-vue/*` packages fail to install (version not yet published to npm), the scaffold README documents the transition: install the matching `packages/*` from the repository path, or use npm link.

## Next steps

- [Run & preview](/docs/06-run-preview): bring up both targets
- [Global & page configuration](/docs/10-config): full field reference for proteus.config.ts
