---
title: Logic & view layers
order: 4
group: 总览
---

# Logic & view layers

The first-order question a cross-platform framework faces: **where does your code run, and where is the UI rendered?** Proteus folds the answer into one sentence — the business writes “logic + view declarations”, and the execution model is left to the framework and the backends.

## The business view: two pieces of code

| Piece | Role | Where it runs |
|---|---|---|
| `<script setup>` | **Logic layer**: state, event handling, capability calls | The same JS logic layer — Web: Vue runtime on the same thread / Mini Program: a dedicated logic layer / App: via the JSI carrier / SSR: Node |
| `<template>` + `<style>` | **View layer**: UI structure & style declarations | Each target's own render engine: Web DOM (vue-dom) / Mini Program WebView or Skyline / iOS·Android·HarmonyOS native controls / Flutter Widget |

The only difference between targets is how the logic layer and the view layer are coupled (same-thread direct driving vs. the setData bridge), and it is absorbed into the render backends and the bridging layer — semantics and business code carry zero branches. See [Ends & maturity](/docs/framework/ends-matrix) for the status of every end.

## The Mini Program dual-thread model

On the Mini Program side, the logic layer and the view layer are **physically separated**: the logic layer runs in a separate JS runtime (no DOM / BOM), and the view layer is rendered natively by WebView or Skyline. The two sides communicate over the `setData` bridge — which is exactly why the compiler rewrites `ref` reads/writes into `setData` (batch-merged within a 16ms window).

The Web side has no such wall: Vue renders on the same thread. Proteus absorbs both models **at compile time**, and business code has zero awareness of it.

## View-layer declarations = semantics

The view layer is not free HTML — p-* semantic components declare “what” (a grid intent, a scan entry), and backends implement per the semantics. This is the fundamental difference from frameworks where “the template is HTML”, and the precondition for AI to generate code safely (constraints live on the IR).

## How this section is organized

- **Compile time** (5 parts): the concrete rules for logic-layer rewriting and view-layer mapping
- **Runtime** (incl. debugging): the actual execution models of the two targets
- **Component framework**: the lifecycle / events / styles machinery of p-* components

## Next steps

- [Semantic model](/docs/framework/11-semantic-model)
