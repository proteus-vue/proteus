---
title: Modularity & subpackage governance
order: 43
group: 模块化
---

# Modularity & subpackage governance

Proteus's modularity = **business domains declaring their own metadata (`proteus-module.config.ts`) + a compile-time dependency graph → driving Web manualChunks and subpackage governance** (`@proteus-vue/module`). Iron rule: **the public contract (types/interfaces/events/configSchema) is the only thing allowed to be imported across modules**.

## Module contract: proteus-module.config.ts

```ts
// examples/proteus-module.config.ts
import { defineModule } from '@proteus-vue/module'

export default defineModule({
  name: 'app',            // module identifier (globally unique, kebab-case)
  version: '1.0.0',       // semver (used for version negotiation)
  dependencies: {},       // dependency modules: key = module name, value = semver range
  exports: {              // public contract exposed outward (types/interfaces/events/configSchema only)
    types: ['./types'],
    events: ['./events'],
  },
  chunk: 'app',           // subpackage strategy (aligned with Router M7.1 chunk)
})
```

## Compile time: module graph → Web manualChunks

`@proteus-vue/module` pipeline (consumed async via the `vite` field of the examples `proteus.config.ts`):

```
scanModuleConfigs(root) → DependencyGraph.fromConfigs(module list)
  → generateRollupOptions(graph).rollupOptions   // auto-applies when a modules/ dir is present
```

During Web builds, files under module directories are grouped by `chunk` (manualChunks) — with no modules the output is an empty config with zero side effects.

## Subpackage size governance

| API (`@proteus-vue/module`) | Description |
|---|---|
| `scanSubPackages(outDir, roots)` | per-subpackage size statistics (pure function) |
| `evaluateSubPackageSizes(stats)` | threshold evaluation (aggregate) — returns violation descriptions |
| `SUBPACKAGE_LIMITS` | `warnKB: 1536` / `errorKB: 2048` (WeChat per-package hard limit) / `totalErrorKB: 16384` |

bundle-report and the CLI audit share this pure-function layer (single source of truth for size accounting).

## CLI toolchain

| Command | What it checks |
|---|---|
| `proteus module:check [dir] [--graph]` | missing contracts / **dependency cycles** / duplicate names / version conflicts; `--graph` appends a Mermaid dependency graph |
| `proteus module:duplicates [distDir]` | duplicate detection of shared dependencies across subpackages (same-hash file in ≥2 subpackages → reported) |
| `proteus audit module [root] [--dist]` | composite gate: contract validation + graph (cycles / duplicate names / version conflicts) + optional artifact size / dedup |

## Next steps

- [Size budget](/docs/framework/perf-budget): the main-package budget and the Top-N largest files
- [Subpackages & on-demand injection](/docs/framework/subpackages): the mp subpackage form
