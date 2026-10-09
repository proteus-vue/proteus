---
title: Environment requirements
order: 4
group: 开始
---

# Environment requirements

## Create a project in 30 seconds

Once the environment is ready, one command scaffolds the project skeleton (the generator produces a Web / WeChat Mini Program project; the three App targets — iOS / Android / HarmonyOS — consume the same semantic IR directly: `proteus build --target ios|android|harmony` compiles screen content and the host project packages it. Progress in [Ends & maturity](/docs/framework/ends-matrix); see [Create your first project](/docs/05-create-project)):

```bash
npm create @proteus-vue/proteus my-app
cd my-app && npm install
npm run dev:web     # run the Web side in a browser
```

> Want to see what it can do first? Open [Playground](/playground) to edit code in the browser and watch the compiled output live — zero install.

## Environment checklist

Before you start, prepare the following environment:

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | Web/MP: ≥ 18 · App targets / framework repo: ≥ 22.12 | Build toolchain (Vite 5 / esbuild / tsx); App packaging and framework-repo tests need `require(ESM)` |
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
| Build iOS (`build --target ios`) | + Xcode ≥ 15 (with iOS SDK + `devicectl`) + **Rust toolchain (cargo)** | Mini Program tooling / Android SDK |
| Build Android (`build --target android`) | + Android SDK (platforms + build-tools) + JDK 17 | Xcode (bundled prebuilt runtime AAR — no cargo needed) |
| Build HarmonyOS (`build --target harmony`) | + DevEco Studio (with hvigor + hdc) | Mini Program tooling |
| Release | + real AppID (replace template placeholder `wx0000000000`) | — |

If you only run the Web side, Node.js is enough — install WeChat DevTools (Mini Program) and each native toolchain (the three App targets) only when you build that target.

## Version rationale

- **Base library ≥ 2.29.2**: minimum for the Skyline render engine and `wx.router` custom routing (below it, skyline pages fall back to WebView and custom transitions are unavailable)
- **Vue ≥ 3.4**: baseline AST shape consumed by the compiler via `@vue/compiler-sfc`
- **Node ≥ 18 (Web/MP) · ≥ 22.12 (App targets / framework repo)**: `require(ESM)` is stable from Node 22.12, which the framework-repo test suite (jsdom 27) and the App packaging chain rely on. A user project's Web/MP side runs on Node 18; `proteus doctor` treats it as blocking inside the framework repo and downgrades it to a hint in a user project.
- **Rust toolchain (`cargo`) · iOS only**: iOS packaging cross-compiles the layout kernel (`packages/layout-core-rust` + `packages/host-abi`) with `cargo build --target aarch64-apple-ios`; Android and HarmonyOS use a bundled prebuilt runtime and need no cargo.

## Next steps

- [Create your first project](/docs/05-create-project)
