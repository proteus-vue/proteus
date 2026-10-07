---
title: Build & release
order: 7
group: 开始
---

# Build & release

## Full command reference

| Command | Purpose |
|---|---|
| `npm run dev:web` | Web dev (`proteus dev --target web` — full HMR + devtools) |
| `npm run build:web` | Web build (`proteus build --target web`: vue-tsc + vite build) → `dist/web/` |
| `npm run dev:mp` | Mini Program dev (`proteus dev --target skyline`: gen-routes + vite dev; for day-to-day iteration use build:mp) |
| `npm run build:mp` | Mini Program production build (`proteus build --target skyline`: gen-routes → vue-tsc → vite build) → `dist/mp-weixin/` |
| `npm run debug:mp` | Full-chain debug build (`PROTEUS_DEBUG=1`; artifacts get `[proteus][stage]` logs and decision-chain files) |
| `npx proteus build --target ios\|android\|harmony` | Compile the screen-content IR for each App target → `dist/app/<target>/` |
| `npx proteus create host <target> <dir>` | Generate a minimal host project (shell + runtime) |
| `npx proteus build --target <target> --package --host-dir <dir>` | Compile + package via the platform toolchain (hvigorw / swiftc / javac+d8) |
| `npx proteus explain src/pages/index.vue` | Show every compile-rule decision that file actually fired |
| `npx proteus rules` | Compiler rule catalog (each rule ships an AI explainer) |

> All commands run through the CLI — it loads `proteus.config.ts` and the framework assembles the vite config (`vite.config.ts` is not a project file). npm scripts are aliases of CLI commands.

> This monorepo's root also has `npm run preview:web` (preview the Web build) and `npm run verify` (one-shot full validation: test + multi-target build).

## Releasing per target

| Target | Artifact | How to release | Status |
|---|---|---|---|
| Web | `dist/web/` (standard static SPA) | any static host / CDN / container | ✅ |
| WeChat Mini Program | `dist/mp-weixin/` | DevTools "Upload code" → review → release (WeChat flow) | ✅ |
| App (iOS / Android / HarmonyOS) | screen-content IR + a minimal host project | `create host` + `build --package` (hvigorw / swiftc / javac+d8) | ✅ shipped on device |
| Flutter | embedded Flutter project | Flutter release flow | 🟡 |
| Quick App | TBD | TBD | ⬜ |

- **Debugging**: on odd behavior run `npm run debug:mp` first — artifacts carry `[proteus][stage]` logs and decision-chain files; `npx proteus explain <file>` queries a single file's compile decisions. More: [CLI & project commands](/docs/28-cli)
- **Size gate**: `build:mp` prints a size report at the end (main-package budget `budget.mainPackageKB`; subpackages hard-limited to 2048KB by WeChat) — see [size budget](/docs/framework/perf-budget)

## Next steps

- [Directory structure](/docs/08-structure): what each directory in the project is for
