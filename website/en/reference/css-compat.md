---
title: CSS cross-target compatibility rules
order: 42
group: 工程参考
generated: true
---

# CSS cross-target compatibility rules

> 12 rules — SSOT = `packages/css-compat/src/rules.ts` `CSS_RULES` (data-driven registry, executed in order by a postcss AST walk), same source as `proteus css:check`.

## Rule list

| code | Rule | Severity | Checked dimension | Auto-fixable | Description |
|---|---|---|---|---|---|
| CSS001 | float forbidden | error | declaration | — | float has no equivalent on Skyline/native renderers — cannot unify across all five targets |
| CSS002 | display: inline forbidden | error | declaration | — | inline/inline-block is Web-only semantics (except nesting inside text) |
| CSS003 | Universal selector forbidden | error | selector | — | No selector concept for * on Skyline/native renderers |
| CSS004 | Attribute selector forbidden | error | selector | — | No equivalent for [attr] on Skyline/native renderers |
| CSS005 | Element selector forbidden | error | selector | — | Element selectors such as div{} / span{} rely on UA styles, which native renderers lack |
| CSS006 | Deep descendant combinator forbidden | error | selector | — | More than 2 levels of descendant/child combinators (.a .b .c) |
| CSS007 | z-index depends on stacking context | warn | declaration | — | Cross-parent stacking contexts cannot be unified across all five targets (B1 conservative hint — precise judgement needs IR context) |
| CSS008 | calc()/vh/vw need compile-time rewriting | error | declaration | ✅ | Early ArkUI lacks calc() support; vh/vw do not shrink when the keyboard pops up |
| CSS009 | Bare backdrop-filter forbidden | error | declaration | ✅ | Must go through the <p-glass> semantic component |
| CSS010 | Complex :nth-child expressions | warn | selector | — | Only the :first/:last forms are cross-platform (B2 expansion) |
| CSS011 | box-shadow rgba needs ARGB rewriting | warn | declaration | ✅ | Advanced shadow parameters are consumed as ARGB on every target |
| CSS012 | Non-whitelisted @media | warn | @rule | — | Only dark + breakpoint presets (sm/md/lg) |

## Rule-by-rule details

### CSS001 float forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: float has no equivalent on Skyline/native renderers — cannot unify across all five targets

### CSS002 display: inline forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: inline/inline-block is Web-only semantics (except nesting inside text)

### CSS003 Universal selector forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: No selector concept for * on Skyline/native renderers

### CSS004 Attribute selector forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: No equivalent for [attr] on Skyline/native renderers

### CSS005 Element selector forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: Element selectors such as div{} / span{} rely on UA styles, which native renderers lack

### CSS006 Deep descendant combinator forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: More than 2 levels of descendant/child combinators (.a .b .c)

### CSS007 z-index depends on stacking context

- **Severity**: warn (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: Cross-parent stacking contexts cannot be unified across all five targets (B1 conservative hint — precise judgement needs IR context)

### CSS008 calc()/vh/vw need compile-time rewriting

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: Yes
- **Description**: Early ArkUI lacks calc() support; vh/vw do not shrink when the keyboard pops up

### CSS009 Bare backdrop-filter forbidden

- **Severity**: error (blocks in strict mode / warns otherwise)
- **Auto-fixable**: Yes
- **Description**: Must go through the <p-glass> semantic component

### CSS010 Complex :nth-child expressions

- **Severity**: warn (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: Only the :first/:last forms are cross-platform (B2 expansion)

### CSS011 box-shadow rgba needs ARGB rewriting

- **Severity**: warn (blocks in strict mode / warns otherwise)
- **Auto-fixable**: Yes
- **Description**: Advanced shadow parameters are consumed as ARGB on every target

### CSS012 Non-whitelisted @media

- **Severity**: warn (blocks in strict mode / warns otherwise)
- **Auto-fixable**: No
- **Description**: Only dark + breakpoint presets (sm/md/lg)

## Size budgets (CSS_BUDGETS)

| Metric | Limit | Direction |
|---|---|---|
| Total style bytes (gzip) | 60000 | ≤ |
| Above-the-fold critical CSS bytes | 14000 | ≤ |
| Style IR runtime objects | 1500 | ≤ |
| Selector count (pre-compile) | 800 | ≤ |
| Semantic component ratio | 0.7 | ≥ |
| --strict-css violations (CSS001-007) | 0 | ≤ |

> Enforcement: `proteus css:check [dir|file]` (executed in order by a postcss AST walk; `--report` writes a structured report)

<!-- generated by website/scripts/gen-css-compat.mjs (en overlay) · source SSOT: packages/css-compat/src/rules.ts CSS_RULES + budget.ts CSS_BUDGETS -->