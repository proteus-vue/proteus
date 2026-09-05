---
title: Style transform
order: 8
group: 编译期
---

# Style transform

`<style>` is handled by `transformStyleToWxss`: it **takes effect at compile time for the Mini Program target only** — the Web target never transforms it (Vite handles standard CSS natively). Four-step pipeline: tag-selector rewriting → px→rpx → Skyline compatibility warnings → scoped class-name suffixing.

## 1. px → rpx

Numeric px values in CSS are converted to rpx by `rpxRatio` (default 2, i.e., a 375 design mockup):

```css
/* before */        /* after (Mini Program) */
padding: 48px;  →   padding: 96rpx;
```

- rpx is the Mini Program's screen-proportional unit (750 design-mockup baseline); cross-target CSS consistency is absorbed at compile time (decision #9)
- The Web target keeps standard CSS — the same style declarations take effect natively on each target
- Config: `style.px2rpx` (switch) / `style.rpxRatio` (ratio) in `proteus.config.ts`
- Rule ID `style/px-to-rpx` (visible in the trace: `48 px → 48 rpx (rpxRatio=2)`)

## 2. Selector rewriting (two rules)

Mini Program WXSS selector capability is weaker than CSS, so the compiler performs two kinds of rewriting:

| Rule ID | Trigger | Rewrite |
|---|---|---|
| `style/selector-tag` | Selector contains an HTML tag | Mapped to the Mini Program tag (`div` → `view` — one-to-one with the template's tag mapping, so styles never miss an element that has already been mapped) |
| `style/selector-semantic` | Selector contains `h1-h6` / `p` / `a` | Mapped to `.proteus-*` class selectors (avoids same-specificity overrides) |

## 3. Semantic base style injection

`h1-h6` / `p` / `a` have no UA styles in WXSS — the compiler automatically injects the `.proteus-h1~h6 / .proteus-p / .proteus-a` base WXSS (injected before the user's styles), rule ID `style/semantic-base-wxss`.

`<transition>` pages additionally get transition keyframes injected (`proteus-fade-in` / `proteus-slide-up-*` / `proteus-scale-*`), rule ID `transition/animation-wxss`, fired on demand (only when a page uses transition).

## 4. Skyline-unsupported properties (compile-time warnings)

| Property | Handling |
|---|---|
| `float` | Compile-time warning (does not block the build) |
| `position: fixed` | Compile-time warning (does not block the build) |

Rule ID `style/skyline-unsupported` — warnings, not errors, but the D-2 / fluid-layout reviews follow them up.

## 5. scoped CSS → class-name suffix (conclusion from real-device Skyline tests)

How `<style scoped>` compiles went through a real-device rework (0.3 → 2026-08):

| Approach | Result |
|---|---|
| Attribute selector `[data-v-xxx]` | ❌ Not supported by Skyline |
| Compound class selector `.a.b` | ❌ Not supported by Skyline's glass-easel — real-device tests show that even a component's own wxss fails to match its own root node (p-button's padding disappears), with **no warning** |
| **Class-name suffix** (current) | ✅ `.box` → `.box-data-v-xxx` — a single class selector is the only path Skyline is certain to support |

Suffix concatenation details:

- `.box` → `.box-data-v-x`; pseudo-class suffixes go after the class name: `.box-data-v-x:hover`
- Descendant selectors, token by token: `.box .title` → `.box-data-v-x .title-data-v-x`
- `@keyframes` frames (`from` / `to` / `0%`) are left untouched
- Comma-separated selector lists are handled one by one; `:deep()` is unwrapped and then suffixed uniformly
- Attribute-selector content is masked (the inside of `[...]` may contain `.`); already-suffixed selectors are not suffixed again

Rule ID `style/scoped-css` (fires only for `<style scoped>` with a scopeId).

## Rule overrides

All the rules above can be disabled via `rules.disabled` in `proteus.config.ts` (IDs in `npx proteus rules`), or you can observe what each compile actually fired through the trace ([CLI & project commands](/docs/28-cli)).

## Relationship to fluid layout

px→rpx solves **unit proportionality**; fluid layout (`v-p-fluid` / p-grid auto-fill) solves **structural self-adaptation** — the latter is Proteus's actual layout proposition, and the style transform is only a compatibility layer. See the Flex System section for details.

## Next steps

- [Route generation](/docs/framework/compile-routes)
- [Template transform](/docs/framework/compile-template)
