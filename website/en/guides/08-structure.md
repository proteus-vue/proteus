---
title: Directory structure
order: 8
group: 代码构成
---

# Directory structure

Here is what a scaffolded project looks like, and what each path is for:

| Path | Purpose |
|---|---|
| `proteus.config.ts` | **The single config file**: platform / skyline / appid / pagesDir / rules / setDataBridge / style + `vite` passthrough fields (the vite config is assembled by the framework, so no `vite.config.ts` is needed); read at build time — rerun `npm run build:mp` after changes |
| `src/main.ts` | Web entry |
| `src/main.mp.ts` | Minimal Mini Program entry: no `App()` call — the app skeleton is generated automatically by the framework |
| `src/pages/` | Page directory (`pagesDir`): every `.vue` here is one page |
| `src/router/` | RouterView / router instance / `auto-routes.ts` (generated at build time — do not hand-edit) |
| `src/shims/` | wx / events / Vue type declarations |
| `.github/workflows/proteus.yml` | CI template (check gate → build for both targets → archive artifacts) |

> Directories the template does not include but creating them is recommended: `src/components/` (business components — plugin-vite scans and writes them into usingComponents automatically), `src/stores/` (Pinia stores — pure logic, hard-gated by the stores-purity CI), `src/capabilities/` (capability declarations — consumed by the audit gate).

## Three key conventions

1. **A page is a file**: every `.vue` under `src/pages/` is a page, and its route path is derived from the directory structure (see [Routing & navigation](/docs/16-router))
2. **Config comes in two layers**: global config lives in `proteus.config.ts`; page config lives in each page's `<route>` block (see [Global & page configuration](/docs/10-config))
3. **Generated output — do not hand-edit**: `src/router/auto-routes.ts`, `app.json`, etc. are generated at build time; rebuilding refreshes them

## Next steps

- [Page anatomy](/docs/09-page-anatomy): what the SFC of a single page contains
