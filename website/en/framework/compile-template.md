---
title: Template transform
order: 6
group: 编译期
---

# Template transform

The tag mapping of `<template>` is driven by the compile-rule registry (`transforms/template.ts`). You author standard HTML; the output is valid WXML.

> **Target scope**: this page describes the compile pipeline for the **mp-weixin** target (the Layer 1 compatibility layer). The Web target has no such pipeline — standard Vue runs as-is (p-* semantic components render natively); the remaining targets come online as their bridge lines are wired. For the target-architecture comparison see [Ends & maturity](/docs/framework/ends-matrix). The rules each compile fires can be observed one by one in the trace (`proteus explain <file>` / the Playground's transform panel).

## Tag mapping rules

| Rule ID | Mapping | Description |
|---|---|---|
| `tag/div-to-view` | `div → view` | Container atom |
| `tag/inline-to-text` | `span → text` | Inline text |
| `tag/heading-to-text` | `h1–h6 → text` | Headings become text with a **semantic class appended**: `<h1 class="title">` → `<text class="proteus-h1 title">` (the `.proteus-h1` style selector is injected as base WXSS by the style pipeline) |
| `tag/para-to-text` | `p → text` | Paragraph (appends `.proteus-p` as above) |
| `tag/link-to-view` | `a → view` | Links become tappable containers: `href` → `data-url` + `bindtap="proteusNavigateTo"` |
| `tag/image` | `img → image` | Images; `:src` → `src="{{url}}"` |
| `tag/router-link` | `router-link → view` | Declarative navigation: `to` → `data-url` + `bindtap="proteusNavigateTo"` (wx.router) |
| `tag/passthrough` | Same name preserved | `button` / `input` / `textarea` / `video` / `canvas` / `scroll-view` / `slot` pass straight through to the Mini Program's same-named tags, avoiding a second round of semantics |
| `tag/rich-text` | `v-html container → rich-text` | Rich text: `<div v-html="html">` → `<rich-text nodes="{{html}}" />` |
| `tag/unknown-kebab` | Unregistered tags emitted as-is | kebab-case passthrough (custom components) |

> The full mapping can be looked up in reverse: `npx proteus rules` prints every rule (each carrying its own before/after example and why), and `TAG_RULE_BY_TAG` provides an O(1) reverse lookup from tag → rule ID.

## Directive mapping

| Rule ID | Authoring | Output | Description |
|---|---|---|---|
| `directive/v-if` | `<p v-if="show">` | `wx:if="{{show}}"` | |
| `directive/v-else-if` | `v-else-if="b"` | `wx:elif="{{b}}"` | |
| `directive/v-else` | `v-else` | `wx:else` | |
| `directive/v-for` | `v-for="(item, idx) in list" :key="idx"` | `wx:for="{{list}}" wx:for-item="item" wx:for-index="idx" wx:key="idx"` | item/index names expanded explicitly |
| `directive/v-show` | `v-show="show"` | `hidden="{{!show}}"` | Note the negation semantics |
| `directive/v-bind` | `:src="url"` | `src="{{url}}"` | Interpolation binding |
| `directive/v-bind-class` | `:class="[a, { b: on }]"` | `class="{{…}}"` (ternary concatenation expression) | Array/object syntax is expanded into string concatenation at compile time |
| `directive/v-bind-style` | `:style="{ backgroundColor: bg }"` | `style="background-color:{{bg}}"` | camelCase → kebab-case |
| `directive/v-bind-key` | `:key="idx"` | `wx:key="idx"` | |
| `directive/v-model` | `<input v-model="name" />` | `value="{{name}}" bindinput="proteusOnNameInput"` | Mini Program custom-component `v-model` covers the native `input`/`textarea` only — an **explicit event contract** (`proteusOnXxxInput` writes back via setData) |
| `directive/v-html` | `v-html="html"` | `<rich-text nodes>` | Rich-text degradation |
| `directive/custom` | `v-focus` and other custom directives | Stripped + warning | The Mini Program has no equivalent mechanism — warned explicitly, never silently |

## Event mapping

| Rule ID | Authoring | Output | Description |
|---|---|---|---|
| `event/click-to-tap` | `@click="handleTap"` | `bindtap="handleTap"` | Simple method reference maps directly |
| `event/modifier-catch` | `@click.stop="stopFn"` | `catchtap="stopFn"` | `.stop` → catch (stops bubbling) |
| `event/modifier-self-once` | `@click.self` / `@click.once` | `bindtap="proteusSelfHandleTap"` | Wrapper methods generated in Page methods (self/once semantics implemented at runtime) |
| `event/inline-expression` | `@click="count++"` | `bindtap="proteusInlineIncCount"` | Inline expressions are hoisted into methods + `setData({ count: … })`; **complex expressions (ternary calls, etc.) warn at compile time and are kept as-is** — the output needs manual handling |

## Semantic component exceptions (p-* bypass tag mapping)

p-* semantic components do **not** go through tag mapping; instead they emit C-IR semantic nodes that the render backend implements by semantics:

| Rule ID | Description |
|---|---|
| `semantic/base-class` | Semantic class appended to the semantic component's root node (`.proteus-*`, the style anchor) |
| `layout/auto-flex-row` | row layout semantics auto-expanded |
| `fluid/p-fluid` | clamp expression generated at compile time (the design-mockup width comes from `layout.designWidth` in proteus.config) |
| `component/progress-degrade` | Components with no native equivalent (progress, etc.) degrade |
| `transition/component` / `transition/leave-state` | `<transition>` show/hide animation: `__tv0` / `__tl0` data fields + `proteusTransitionToggle0()` (keyframes injected by the style pipeline) |
| `slot/scoped-slot` | Scoped slots stripped + warning (MP has no template arguments — alternative pattern: pass props down to the child + triggerEvent callbacks) |
| `template/template-ref` | `ref="el"` stripped + warning (MP has no template refs) |
| `template/is-component` | `<component :is>` warned + kept as-is (invalid tag) |
| `nav/navigate-link` / `nav/route-type` | Route wiring for navigation-type tags (wx.router) |
| `node/interpolation` | `{{ }}` interpolations pass straight through to WXML |
| `annotation/line-note` | `--debug` output injects source line-number comments |

## Honest boundaries

- `event/inline-expression` **warns + outputs as-is** for complex expressions (method-call ternaries, etc.) rather than silently producing wrong output
- Custom directives / template refs / scoped slots / `<component :is>` are stripped with an explicit warning — see the honest boundaries in [Script transform](/docs/framework/compile-script)
- Every rule can be disabled via `rules.disabled` in `proteus.config.ts` and overridden via `rules.mapping`

## Next steps

- [Script transform](/docs/framework/compile-script)
- [Style transform](/docs/framework/compile-style)
