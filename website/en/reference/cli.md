---
title: CLI command reference
order: 40
group: 工程命令
generated: true
---

# CLI command reference

> Generated from the CLI command registry (`packages/cli/src/args.ts` HELP_GROUPS, `website/scripts/gen-reference.mjs`) — do not hand-edit.

## Build & development

### `proteus build`

```bash
proteus build <dir> [--out <dir>] [--debug] [--no-px2rpx] [--rpx-ratio <n>] [--rules <json>] [--compiler <node|rust>] [--target <web|skyline|all>]
```

Scan all .vue files under <dir> and compile them into the mini-program four-file set (.wxml / .js / .wxss) to <out>
      --debug    inject source line-number comments into the artifacts + write the decision trace to disk (.transform-debug/)
      --rules    JSON rule override file (disabled / mapping / customTags)
      --compiler compiler backend (G-29): node (default) / rust (per-page Node/Rust dual-compile semantic equivalence check, G-29.1)
      --target   project build (G-33 M2): spawn the project build:web / build:mp scripts (reusing the Vite pipeline); default = standalone compilation

### `proteus dev`

```bash
proteus dev [--target <web|skyline>]
```

Development server (G-33 M1): web → vite --mode web; skyline → dev-mp watch build (the app side awaits M3 native sync)

## Checks & gates

### `proteus gate`

```bash
proteus gate ls [--group=<family>] | gate run <id|preset> [dir]
```

★Unified gate system (★#453/#454 Gate registry as the single source of truth): ls = full gate directory (family/scope/● wiring state); run = unified execution
      preset: check (fast) / audit (deep ten domains, domain set same as audit all); wired: d2/fluid/api-check/capabilities/i18n/router/module/css/style/config/components/devtools-budget/coverage
      unwired (○: write/diagnostic/multi-flag tools) are invoked as standalone commands — register a new gate in the registry before wiring it

### `proteus check`

```bash
proteus check [dir] [--no-strict-css|--no-strict-style|--no-strict-router|--no-strict-cli]
```

★One-click full gate (G-33 M1): aggregates css:check + style:check + router:check + config:check, four domains
      failure in any domain → exit 1 (all enabled by default; --no-* disables the corresponding domain)

### `proteus conformance`

```bash
proteus conformance [--backend <spec>] [--only <C-xx>] [--demo] [--repo <dir>]
```

★G-38 42-item conformance (C-01~C-10, compiler-backend-spi-plan 02) — G-38 Node reference implementation by default
      --backend  external backend: module path[#named export] (default/#named factory returns a G-38 backend instance)
      --only     run only a certain group (e.g. C-03)
      --demo     Terminal reference + FallbackBackend degradation demo (rust unavailable → node)
      --repo     ★G-42 B5 repository governance scan (G-42.6 strictly forbids forks — a fork hit in the host repository → FAIL, CI blocked)
      FAIL>0 → exit 1 (CI blocked)

### `proteus host`

```bash
proteus host push <module-dir>
```

★G-45 B3 debugging base: pre-flight validation of plugin modules (proteus.plugin.json integrity/signature sig-*/conformance coverage CMP084/087)
      + push envelope generation (manifestHash/bundleHash — G-45.8 integrity)
      FAIL → exit 1; devices/logs/serve land with the B4 transport adapter

### `proteus health`

```bash
proteus health [dir]
```

★Project/environment health check (orthogonal to the check domain gates): Node version / project structure / dependencies / build artifacts / appid / pagesDir / workspace links / IDE
      one-shot diagnostics (✅/⚠/✗); error level → exit 1 (warn does not block)

### `proteus css:check`

```bash
proteus css:check [dir|file] [--no-strict] [--fix] [--report <path>]
```

★CSS cross-platform compatibility check (G-21): CSS001-012 + budget gates (bytes/selectors/semantic ratio/forbidden items)
      --no-strict  downgrade violations to warn; --report writes css-compat-report.json to disk (consumed by check-css-report.mjs)

### `proteus style:check`

```bash
proteus style:check [dir|file] [--platform <web|skyline|ios|android|harmony>]
```

★Style runtime safety (G-31): template :style whitelist STS001-006 + static-derivation coverage (constant folding)

### `proteus config:check`

```bash
proteus config:check <proteus.config.ts>
```

★Configuration validation (types-plus B2/B5): required fields + cross-layer dependencies (CONFIG_LAYER_VIOLATION) + version-migration hints

### `proteus i18n:check`

```bash
proteus i18n:check [root] [--catalog <path>]
```

★i18n usage check (i18n-plan B1): hardcoded-text detection + catalog key alignment

### `proteus router:check`

```bash
proteus router:check [dir]
```

Validates <route> blocks against the centralized meta (source registration + the basis for parent-route derivation)

### `proteus module:check`

```bash
proteus module:check [dir] [--graph]
```

Validates the proteus-module.config.ts module contract (missing fields/cycles/duplicate names/version conflicts)
      --graph  append a Mermaid dependency graph

### `proteus module:duplicates`

```bash
proteus module:duplicates [distDir]
```

Deduplication check for shared dependencies across subpackages (reads subPackages in dist/mp-weixin/app.json; files with the same hash in ≥2 subpackages → reported)

### `proteus audit`

```bash
proteus audit module [root] [--dist <dir>] [--graph-json <path> | --no-graph-json]
```

★Comprehensive audit gate (M8.6, all hard-blocking): contract validation + graph (cycles/duplicate names/version conflicts) + optional artifacts (--dist: subpackage size/duplication)
      --dist         artifact directory (subpackage size thresholds + deduplication check)
      --graph-json   write module-graph.json to disk (defaults to .proteus/module-graph.json)

### `proteus audit`

```bash
proteus audit d2 [dir]
```

★D-2 dogfooding gate (mechanized 05-dogfooding-conformance D-2): pages must not write platform APIs directly (wx.*/window.*, etc.) / hand-write @media / pull in third-party UI libraries
      rule-level configurable (proteus.config audit.rules: off/warn/error; default all error, fail-closed)
      dir defaults to reading audit.dir ?? src (must run inside a project); per-line // d2-exempt and whole-file d2-exempt-file exemption registration
      FAIL (error level) → exit 1 (warn does not block)

### `proteus audit`

```bash
proteus audit all [root]
```

★Full audit gate (test-framework B6 + M10 + ★#450/#458 D-2/api-check/fluid): aggregates route / module / config / i18n / capabilities / components / d2 / api-check / fluid / devtools-budget, ten domains
      + CI time budget (<12s, blocks when over budget); domains with a missing config file / audit not declared are skipped (standalone-compilation mode; D-2 is opt-in — declaring audit enables it)

### `proteus audit`

```bash
proteus audit devtools-budget
```

★DevTools performance-budget smoke test (M10/M7.4): bus.emit / flame graph 5000 spans / ten-thousand-scale timeline ingest latency
      plan budget 0.1/100/200ms → CI 10x margin upper bound; exceeding the limit blocks (catches pathological regressions)

### `proteus audit`

```bash
proteus audit coverage
```

★Full semantic-coverage audit (G-32 B1 / G-32.1 gate): 100% mini-program capability coverage + closed-loop consistency (catalog ↔ enum ↔ tag ↔ render-map, no drift across all four directions) + 128-item checklist self-check

### `proteus capabilities:manifest`

```bash
proteus capabilities:manifest [dir] [--platform <web|skyline|app>]
```

★Scans capabilities/*.capability.ts → capability-manifest.json (B1 capability-manifest audit)
      --platform   capability-missing report (B3 compile-time branching: capabilities without an adapter on that platform + business-reference warnings)

### `proteus capabilities:check`

```bash
proteus capabilities:check [dir]
```

★Static check of platform native-module conventions (B5 §6 forbidden list: business directories must not use wx.*/window.*; platform files guard against API leakage)

### `proteus api-check`

```bash
proteus api-check [dir]
```

★CMP007 gate (G-31 B7 / G-32.4): callback-style platform APIs (wx.request({ success })) / synchronous storage / bare global-capability calls → rewrite to useXxx() hooks (Promise/Result); platform bridge files are exempt

### `proteus components:audit`

```bash
proteus components:audit [dir]
```

★Component audit: p-* component registry vs actual usage (unregistered/unused/tag drift)

### `proteus fluid:check`

```bash
proteus fluid:check [dir|file]
```

★Strict fluid-layout rules (G-22): FLD001 forbids hand-written @media / FLD002 forbids hardcoded breakpoints / FLD003 p-fluid requires min·max / FLD004 p-grid requires min-col-width / FLD006 forbids Dimensions.get
      (FLD005 fixed-dead-size heuristics are too noisy; not enabled in MVP)

## Testing

### `proteus test`

```bash
proteus test [unit|e2e:web|e2e:mp] [--ide <cli path>] [--port <n>] [--debugger <module>]
```

★Test entry point (test-framework): unit → L1-L3 + compile snapshots; e2e:web → Playwright (build --target web first)
      e2e:mp → automator (B5): IDE path configurable (PROTEUS_IDE_CLI env var / --ide flag / platform-default detection)
      + auto-starts WeChat DevTools (auto --auto-port) → port ready → runs e2e-mp-smoke (missing IDE reports an error with guidance)
      + --debugger <module>: injects an MpDebuggerLike adapter module (console/network/clearCache/refresh — wechatide tool capabilities, see docs 13 §6.5)

## Generation & migration

### `proteus init`

```bash
proteus init module [dir]
```

★Generates a proteus-module.config.ts skeleton (module-plan B9: zero-friction modular onboarding for new projects)

### `proteus generate`

```bash
proteus generate types [--out <path>] [--check]
```

★Generates global type artifacts (types-plan B3): JSON Schema + global d.ts (--check validates drift)

### `proteus migrate`

```bash
proteus migrate types <file>
```

★Migration helper: old type idioms → new consolidated types (types-plan 10 type consolidations)

### `proteus migrate`

```bash
proteus migrate mp <file|dir> [--dry-run]
```

★G-31 B6 mini-program migration codemod: automatic tags (view→p-box, etc.) + direct synchronous-storage rewrites (→useStorage)
      + callback-style APIs / semantically recognized tags are marked manual (idempotent; --dry-run only reports, never writes back)

### `proteus gen`

```bash
proteus gen config [file]
```

★Generates an app.config.ts skeleton (G-35 M5): type-safe defineAppConfig form; defaults to app.config.ts

### `proteus ci:init`

```bash
proteus ci:init [--platform <github|gitlab|circleci>] [--targets <a,b>] [dir]
```

★CI/CD template generation (G-33 M4): .github/workflows/proteus.yml, etc. (proteus check gates → per-target builds → artifact archiving)
      default platform=github targets=web,skyline; writes into the current directory (or <dir>)

## Diagnostics & tools

### `proteus explain`

```bash
proteus explain <vue file | rule ID>
```

vue file → decision trace (all transform rules actually triggered by that file)
      rule ID → the AI manual for that rule (what/why/when/example/verify/source)

### `proteus rules`

```bash
proteus rules [template | script | style | validate]
```

Lists all compile rules (AI-manual directory)

### `proteus version`

```bash
proteus version
```

Version number

### `proteus help`

```bash
proteus help
```

This help

<!-- generated by website/scripts/gen-reference.mjs (en overlay) · source SSOT: packages/cli/src/args.ts HELP_GROUPS -->