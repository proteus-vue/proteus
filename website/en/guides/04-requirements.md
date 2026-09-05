---
title: Environment requirements
order: 4
group: 开始
---

# Environment requirements

Before you start, prepare the following environment:

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | ≥ 18 | Build toolchain (Vite 5 / esbuild / tsx) |
| npm | ships with Node | Dependency management (installing `@proteus-vue/*`) |
| Vue / Vite / TypeScript | Vue ≥ 3.4 / Vite ≥ 5 / TS ≥ 5.4 | Framework baseline (locked in the template's package.json) |
| WeChat DevTools | latest stable | Mini-program debugging (needs a real AppID) |
| WeChat base library | ≥ 2.29.2 | Enables Skyline rendering and `wx.router` custom routing |

> Without a real AppID you can use a test account in DevTools (Details → Basic info), but for Skyline capabilities a real AppID is recommended.

## Dependency matrix by target

| What you want to do | Install | Not needed |
|---|---|---|
| Web only (`dev:web` / `build:web`) | Just Node.js | WeChat DevTools / AppID |
| Debug Mini Program (`dev:mp`) | + WeChat DevTools + AppID (test account OK) | — |
| Build Mini Program artifacts (`build:mp`) | + base library ≥ 2.29.2 (switch inside DevTools) | — |
| Release | + real AppID (replace template placeholder `wx0000000000`) | — |

If you only run the Web side, Node.js is enough — install WeChat DevTools only when you start debugging the Mini Program.

## Version rationale

- **Base library ≥ 2.29.2**: minimum for the Skyline render engine and `wx.router` custom routing (below it, skyline pages fall back to WebView and custom transitions are unavailable)
- **Vue ≥ 3.4**: baseline AST shape consumed by the compiler via `@vue/compiler-sfc`
- **Node ≥ 18**: runtime baseline for the build scripts (tsx / esbuild)

## Next steps

- [Create your first project](/docs/05-create-project)
