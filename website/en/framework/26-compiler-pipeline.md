---
title: Compiler pipeline
order: 5
group: 编译期
---

# Compiler pipeline

The Mini Program compile pipeline (`@proteus-vue/compiler`, implemented as pure functions) turns one standard Vue SFC into the Mini Program four-file set. The Web target does **not** run through this pipeline (standard Vite + Vue, zero transformation); native/Flutter render backends likewise skip WXML compilation — they consume the same SFC's semantic IR directly (see [Render backend](/docs/framework/23-render-backend)).

## The pipeline at a glance

```
page.vue
├── <template> ── transformTemplateToWxml ──► .wxml   tag / directive mapping
├── <script>   ── transformScriptToPage ────► .js     Page() constructor
├── <style>    ── transformStyleToWxss ─────► .wxss   px→rpx + selector rewriting
└── <route>    ── gen-routes ───────────────► .json   app.json / page.json
```

The four transforms are each independent and testable in isolation; every rule ships an AI explainer (id / description / before / after / why).

## Entry point: compileVueSfc (the actual main compile function)

The Playground and the CLI share the same entry point, `compileVueSfc(source, options)` (runnable in the browser — zero Node built-in dependencies). The flow:

1. **sfcParse**: `@vue/compiler-sfc` parses out the descriptor (template / scriptSetup / styles / route blocks)
2. **styleOpts normalization**: `px2rpx` (default true) / `rpxRatio` (default 2) / the rules override set
3. **Style grouping**: `<style global>` is explicitly global (not scoped); the remaining style blocks are treated as scoped — **an unmarked `<style>` is also treated as scoped + a compile-time warning** (2026-08 user decision: local scope by default; the Vue standard is global, which on Web leaks into every page)
4. **Template transform**: transformTemplateToWxml — beyond tag/directive mapping it also collects `vModelBindings` (for the script to generate write-back handlers) / `selfHandlers` (.self semantics) / `inlineHandlers` (inline-expression hoisting) / `pageScrollWrapped` (auto-wrapped scroll-view) / p-fluid clamp parameters
5. **Script transform**: transformScriptToPage — takes the linked information collected on the template side (v-model binding names, navigation usage, the self/once/inline handler roster) to generate the Page constructor
6. **Style transform**: the global group is concatenated first, then the scoped group (class-name suffix); when a page is auto-wrapped in a scroll container, `.proteus-page-scroll { height: 100vh }` is appended (it takes no part in the scope suffix)
7. **Trace — the three chains merge into one**: the Trace events from template / script / style all flow into the decision chain (`proteus explain` reverse lookup)

Page-scroll lifecycle detection (the presence of `onPageScroll` / `onReachBottom` / `onPullDownRefresh` / `wx.pageScrollTo`) is scanned at compile time, deciding whether to inject the scroll container and the event bridge.

## Compile-time validation

The IR layer performs **compile-time validation** — problems error out on the spot instead of crashing after release:

- p-* tags must be semantically named (iron rule G-31.1)
- props must declare their degradation behavior (CMP006)
- logically conflicting layout constraints (e.g., min-col-width × max-cols > design width) error out on the spot

## Semantic equivalence of the two compile backends

The Node and Rust compile backends must produce **semantically equivalent** CompilerIR for the same SFC — enforced by the IR Golden gate (81 real-page cases); setting `compiler.backend = 'rust'` turns on dual-compile validation.

## In this group

- [Template transform](/docs/framework/compile-template): tag and directive mapping
- [Script transform](/docs/framework/compile-script): reactivity rewritten into setData
- [Style transform](/docs/framework/compile-style): px→rpx and selector rewriting
- [Route generation](/docs/framework/compile-routes): per-target config via gen-routes (Web route table / Mini Program `app.json`)
- [Compile rules & decision chain](/docs/framework/compile-rules): anti-black-box and explain
