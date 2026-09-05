---
title: CLI & project commands
order: 28
group: 架构与工程
---

# CLI & project commands

The `proteus` CLI (`@proteus-vue/cli`, bin name `proteus`) is the framework's developer entry point: create, develop, build, gate, and observe along one command chain. Its design principles match the framework's — every command works standalone, failures come with guidance, and **FAIL > 0 means exit 1**, ready for CI to consume directly as a gate.

> The `dev:web` / `build:mp` scripts in the repo root's `package.json` reuse the same Vite pipeline as the CLI; the CLI additionally offers standalone compilation outside Vite and the four-domain gate aggregate.

## Project lifecycle

| Command | Purpose | Key flags |
|---|---|---|
| `npm create @proteus-vue/proteus <name>` | copies the template project (Web + Skyline dual-target scripts + CI template) with the project name substituted | — |
| `proteus dev` | starts the dev server (reuses the project's Vite) | `--target web` or `skyline` (defaults to web) |
| `proteus build <dir>` | standalone compile: every `.vue` under the directory → the Mini Program trio (wxml / js / wxss) | `--out` · `--debug` (decision trace written to `.transform-debug/`) · `--rules <json>` · `--no-px2rpx` · `--rpx-ratio <n>` · `--compiler node` or `rust` |
| `proteus build --target` | project build: spawns the project's `build:web` / `build:mp` scripts | `--target web` or `skyline` or `all` |
| `proteus test` | test orchestration (see [Testing & deployment](/docs/27-testing-deploy)) | `unit` (default) / `e2e:web` / `e2e:mp [root]`; `--ide` / `--port` / `--debugger <module>` |

With `--compiler rust` enabled, every page first runs a **Node/Rust dual-compile semantic-equivalence check** (G-29.1); any mismatch turns the build red — the safety net that makes the compiler pluggable.

## Quality gates

```bash
proteus check [dir]   # the one-command full gate: css + style + router + config aggregated across four domains
                      # all on by default; --no-strict-css and the like disable per domain; any domain failing → exit 1
```

**Unified gate system (#453)**: `proteus gate` is the single entry point for gates — `gate ls` lists the full catalog (grouped by family: fast aggregate / deep aggregate / dedicated checks / framework self-checks, each annotated with its scope and wiring state), and `gate run <id|preset> [dir]` executes them uniformly.

```bash
proteus gate ls                  # the gate registry (single source — new gates registered here automatically join the catalog)
proteus gate run check [dir]     # preset: fast aggregate (css / style / router / cli — same as check)
proteus gate run audit [root]    # preset: deep aggregate (ten domains — same as audit all)
proteus gate run d2 [dir]        # dedicated: D-2 page gate (same engine as audit d2)
```

> Zero duplication in gate logic: presets reuse the existing aggregation engines, wired gates reuse their own standalone runners, and unwired gates (○) run through their independent commands.

Dedicated commands can run on their own, or be aggregated by `proteus audit all` across ten domains (route / module / config / i18n / capabilities / components / **d2 (D-2 page gate — opt-in: only runs when `proteus.config` declares `audit`)** / **api-check (CMP007)** / **fluid (layout rules)** / devtools-budget + the CI time budget):

| Command | What it checks |
|---|---|
| `css:check` | cross-end CSS compatibility (CSS001-012) + byte / selector budget gates (`--fix` auto-repairs, `--report` writes to disk) |
| `style:check` | `:style` runtime-safety whitelist (STS001-006; `--platform` selects the target) |
| `fluid:check` | fluid layout rules (FLD series: no hand-written `@media`, no hardcoded breakpoints, …) |
| `api-check` | CMP007 gate: callback-style platform APIs / sync storage / raw global calls → migrate to `useXxx()` Hooks |
| `capabilities:manifest` / `capabilities:check` | capability inventory scan / platform native-module conventions (business directories ban `wx.*`) |
| `router:check` / `config:check` / `app-config:check` / `i18n:check` | route blocks / project config / app config / hardcoded copy |
| `module:check` / `module:duplicates` / `audit module` | module contracts / duplicate subpackage dependencies / comprehensive audit |
| `health` | project environment checkup: Node version / structure / dependencies / artifacts / appid / IDE — one-shot diagnostics |

## Compiler observability

```bash
proteus explain src/pages/index.vue   # every compile-rule decision that file actually fired (decision trace)
proteus explain <rule ID>             # rule → AI explainer (what / why / when / example / verify)
proteus rules                         # compiler rule catalog (each rule ships an AI explainer)
proteus conformance                   # 42 compiler conformance items (FAIL > 0 → exit 1)
proteus conformance --repo .          # repo-governance scan: forking framework internals is forbidden (a hit → FAIL)
```

## Migration & CI

| Command | Purpose |
|---|---|
| `proteus migrate mp <file or dir> [--dry-run]` | Mini Program → Proteus semantic codemod (`view→p-box` auto-replacement + direct rewrites of sync storage + manual items flagged) |
| `proteus migrate types <file>` | legacy type patterns → the consolidated types |
| `proteus gen config` | generates a type-safe `app.config.ts` skeleton |
| `proteus init module [dir]` | generates a module-contract skeleton |
| `proteus generate types [--out <path>] [--check]` | generates global type artifacts (JSON Schema + d.ts; `--check` verifies for drift) |
| `proteus ci:init` | generates a CI/CD pipeline template (check gate → build per target → artifact archive) |
| `proteus host push <module-dir>` | pushes a plugin module to the debug host (preflight checks + push envelope) |

## Typical workflow

```bash
# ① scaffold the project (the template ships dual-target scripts; route .json files are generated automatically by gen-routes)
npm create @proteus-vue/proteus my-app && cd my-app && npm install

# ② develop both targets in parallel
npm run dev:web     # vite --mode web
npm run dev:mp      # gen-routes + vite --mode mp-weixin

# ③ build
npm run build:mp    # dist/mp-weixin/ (import in WeChat DevTools; replace the appid in proteus.config.ts)
npx proteus build --target all    # or build both targets in one pass via the CLI

# ④ gates + tests
npx proteus check && npx proteus test e2e:web
```

`dev` / `build --target` for the native targets (iOS / Android / Harmony) and the five-target artifact orchestration roll out in batches together with the native projects (📋 planned; `--target` currently supports web / skyline).

## Next steps

- [Create your first project](/docs/05-create-project): Web + Mini Program both up in two minutes
- [Testing & deployment](/docs/27-testing-deploy): the test matrix and CI gates
- [Compiler pipeline](/docs/framework/26-compiler-pipeline): the compiler behind build / explain
