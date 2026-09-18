---
title: Compile rules & decision chain
order: 11
group: 编译期
---

# Compile rules & decision chain

Proteus compilation is **anti-black-box**: every transform rule ships its own AI explainer, and every firing is traceable.

## Rule registry

Compile rules are registered by phase (`transforms/registry.ts`):

| Phase | Rule count | Examples |
|---|---|---|
| template | 32 | `tag/div-to-view`, `tag/router-link` |
| script | 23 | computed derivation, watch emulation, importing shared modules |
| style | 8 | px→rpx, selector rewriting |
| validate | 3 | output self-validation |

Every rule carries: `id` / `description` / `when` (when it fires) / `example` (before → after) / `why` (why it exists) / `verify` (which test guards it).

## Decision trace

While transforming, the compiler collects **decision events** (rule ID + line number + before/after):

```bash
npx proteus explain src/pages/index.vue   # every rule decision this file fired
npx proteus rules                         # the full rule capability catalog
npm run debug:mp                          # end-to-end debug build (a decision-chain file is injected into the output)
```

- `--trace-transform` shares its origin with the official-site Playground's Trace tab (the same decision-event structure)
- The trace is written to `.transform-debug/` (the decision chain is persisted, and thus auditable)

## Why it matters

1. **Anti-black-box**: the output is enumerable, queryable, and traceable back to source — "why was this rewritten" always has an answer
2. **AI explainer**: when agents write or debug code, they query rule IDs for constraints instead of improvising
3. **Regression guard**: every rule is bound to a test (the `verify` field points to the case file)

## Next steps

- [Web runtime](/docs/framework/runtime-web)
