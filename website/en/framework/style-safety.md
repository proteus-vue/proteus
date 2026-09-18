---
title: Style runtime safety
order: 42
group: 质量与兼容
---

# Style runtime safety

Dynamic `:style` is the last gate at runtime — **runtime dynamic values** that compile-time rules cannot reach (API responses / user input spliced into style) can pass straight through to native rendering. `@proteus-vue/style-safety` provides **layer ③ of the three-layer defense** (① ② are in [Style transform](/docs/framework/compile-style) and `proteus style:check`):

```
① Compile-time static checks (style:check STS001-006) — template / static styles
② Style-transform pipeline (px→rpx / selector rewriting) — compiled artifacts
③ createStyleGuard (this page) — the last runtime gate for dynamic :style
```

## Whitelist property categories

Dynamic style only allows declared properties, grouped into four categories by value type:

| Category | Properties | Value validation |
|---|---|---|
| **Length** | `width/height/min/max*`, `padding*`, `margin*`, `borderRadius`, `top/left/right/bottom`, `gap`, `fontSize/lineHeight/letterSpacing` | Finite numbers / `px·rem·%` strings / `auto` |
| **Color** | `color`, `backgroundColor`, `borderColor` | Strings (hex / rgba / theme tokens — already expanded at compile time; the runtime string check is the fallback) |
| **Numeric** | `opacity` (0-1 finite number), `flex`, `zIndex`, `fontWeight` | Finite numbers |
| **Transform** | `transform` | Only `translate/scale/rotate/skew` functions |

**`p-*` semantic-component properties pass** — inside components they are a safe path (`prop.startsWith('p-')`).

## ❌ Forbidden properties (CSS-matrix ❌ level)

| Property | Reason |
|---|---|
| `display` / `float` / `position` / `overflow` | Bypass the semantic layer straight to native — **must be wrapped in a `p-*` semantic component** (`p-view` / `p-stack` / `p-page` carry the layout semantics) |
| `backdropFilter` / `boxShadow` / `filter` | Capability gaps across targets are large — go through semantic components such as `pg-glass` |

## Degradation semantics (invalid values never reach the render pipeline)

`validateStyleValue` returns `{ ok: false, reason, fallback }` for invalid values — `createStyleGuard.patch()` strips the invalid entries and replaces them with **degradation defaults** (`width/height/padding/margin/borderRadius → 0`, `opacity → 1`, `flex/zIndex/fontSize/lineHeight/gap → 0`, colors → dropped, so they inherit).

## createStyleGuard (modes)

| mode | Behavior | Use case |
|---|---|---|
| `strict` | Strip invalid + record + **warn** | Strong validation during development |
| `loose` | Strip invalid + record (no warn) | Development default (when `__PROTEUS_DEBUG__`) |
| `off` | Pass through unchanged — **zero overhead** | Production default |

```ts
import { createStyleGuard } from '@proteus-vue/style-safety'

const guard = createStyleGuard({
  mode: 'loose',
  onReject: (r) => console.log('[style-safety]', r.reason), // forwarded per record
})
const safe = guard.patch({ width: dynamicW, opacity: 1.5, display: 'flex' })
// opacity 1.5 → stripped + fallback 1; display → forbidden, stripped; width valid, kept
guard.records() // interception records (ring buffer of 500) — data source for the DevTools style-safety Inspector
```

## Audit wiring

- **Runtime**: `createStyleGuard` interception records are the data source of the DevTools style-safety view ([Debugging & observability](/docs/framework/debugging))
- **Compile time**: `proteus style:check [dir] --platform` (STS001-006 static rules + `:style` whitelist inference) — see [CLI & project commands](/docs/28-cli)

## Honest boundaries

- The `transform` value check is the basic four functions (validation of composed transform matrices is left for later); styles already intercepted at compile time do not pay the runtime validation cost a second time
- Unknown properties under loose / strict semantics: unknown properties outside the whitelist **pass** (compile time already covers them; the runtime only backstops known-risk properties) — under strict you can tighten further with explicit configuration beyond `FORBIDDEN_PROPS` (a later batch)

## Next steps

- [Style transform](/docs/framework/compile-style): the two compile-time rules
- [CLI & project commands](/docs/28-cli): full `style:check` options
