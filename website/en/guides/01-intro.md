---
title: What is Proteus?
order: 1
group: 起步
---

# What is Proteus?

Proteus is a **semantic-convergent cross-platform app framework**: you write your business code once as **standard Vue SFCs + standard HTML tags**, and it renders across multiple targets—

- **Web** (✅ shipped): standard Vite + Vue, runs directly with zero transformation; devtools / HMR / code-splitting all work
- **WeChat Mini Program** (✅ shipped): the compiler turns the same source into native Skyline artifacts (WXML / WXSS / `Page()` JS / JSON)
- **App (iOS / Android / HarmonyOS)** (🟡 prototype mapping): RenderBackend SPI native controls — wired per roadmap
- **Flutter / Quick App** (🟡 / ⬜): same semantic model, per-target implementations follow the roadmap

> See [Ends & maturity](/docs/framework/ends-matrix) for the full 8-target status table; component/capability pages carry per-terminal compatibility tables.

> **One semantic model. Any render engine. Zero native glue.**

## What problem does it solve

Teams shipping both Web and Mini Programs today maintain two mental models:

| Pain point | Traditional approach | Proteus |
|---|---|---|
| Two syntaxes | HTML on Web; WXML + `setData` in Mini Programs | Write standard Vue SFC once; the compiler does the mapping |
| Two configs | A vue-router table plus an `app.json` page config | Declare per-page `<route>` blocks; the compiler generates both configs |
| Two style worlds | Manually keep CSS and WXSS in sync | One style sheet transformed at compile time (px→rpx configurable) |

## The core mechanism (in one paragraph)

The page you write is a **standard Vue SFC**. On Web it is simply a Vue component; in Mini Programs the compiler transforms it into the four native artifacts — tag mapping (`div→view` etc.), reactive rewriting (`ref` → batched `setData`), and style conversion are all automatic. There is no `wx.` in your business code, and no conditional compilation.

## Who it fits — and who it doesn't

**Fits:**

- Teams that need **Web + WeChat Mini Program delivery** (full Web; Skyline-first Mini Program; App/Harmony wired per roadmap)
- Teams that want **AI agents to participate in development** (AI produces standard code that conforms to the IR contract; enforced at compile time)
- Teams with **existing Mini Programs** to migrate gradually (compat layer + `proteus migrate mp` codemod)

**Doesn't fit** (honest boundaries):

- Target platforms include Alipay / Douyin / Kuaishou Mini Programs — explicitly out of scope
- You need native rendering on real iOS / Android devices today — native backends are prototype mappings, advancing per roadmap
- You rely on runtime dynamic page/route registration — Proteus declares statically at compile time

## Why the name Proteus

Proteus is the sea god of Greek myth: one being that shifts between many forms while its essence stays constant — exactly as the same business semantics can render to DOM, native controls, or Mini Programs while your business code never changes.

## Next steps

- [How Proteus differs from traditional cross-platform frameworks](/docs/02-difference): design trade-offs in a minute
- [Try the Playground](/docs/03-playground): run your first page in the browser, no install
- [Create your first project](/docs/05-create-project): scaffold and run both targets end to end
