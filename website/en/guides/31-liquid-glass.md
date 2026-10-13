---
title: Liquid glass engine: pg-glass
order: 31
group: 专题深入
---

# Liquid glass engine: pg-glass

Liquid glass (glassmorphism blur + tint + highlight + edge refraction) has a single entry in Proteus: `<pg-glass>` (the G-07 unified entry, engine codename **Aether**). You declare the **semantics** (navigation bar / card / floating layer), and the component maps to the **strongest implementation** per terminal, degrading gracefully to a solid color when a capability falls short.

> **Why writing raw `backdrop-filter` is forbidden: CSS017 (error level) + GLS001-006 (`proteus audit glass`).**
> Raw usage means carrying all three burdens yourself: per-terminal implementation differences (iOS Metal self-drawn / Android AGSL / HarmonyOS Vulkan / Web · Mini Program `backdrop-filter`), accessibility (nobody handles `prefers-reduced-transparency`), and crash-free degradation (a white block when unsupported). Glass semantics belong to the component — pages write zero raw code.

## One declaration, every end's strongest glass

The same `<pg-glass>` declaration maps to the strongest implementation per terminal:

| End | Implementation | Look |
|---|---|---|
| iOS / Android | host self-drawn glass pass (Metal / AGSL, from one Rust WGSL) | **real edge refraction** |
| HarmonyOS | host offscreen Vulkan (same-source SPIR-V) | **real edge refraction** |
| Web / Mini Program | CSS `backdrop-filter` | blur + tint + highlight edge (**no refraction**) |

## Three tiers of commitment

| Tier | Content | Commitment |
|---|---|---|
| L1 base glass | blur + tint + radius + border | must-hit, consistent across all ends |
| L2 texture | noise layer + highlight edge | Web / Mini Program (CSS) |
| L3 real refraction | beveled slab: refraction + frost + Fresnel highlight | native ends (self-drawn glass pass) |

## Quick start

`<pg-glass>` is a **framework built-in component** — no installation. How the three kinds of project use it:

```vue
<!-- any .vue: just write the tag (Web / Mini Program resolve it automatically; App folds it at build time) -->
<pg-glass preset="card" :radius="16">
  <view class="card-body">…</view>
</pg-glass>
```

- **Web**: `<pg-glass>` is auto-registered by the framework registry (`@proteus-vue/components`) — no manual import.
- **Mini Program (Skyline)**: `gen-routes` resolves framework components automatically (`/proteus/pg-glass`) — no `usingComponents`.
- **App (iOS/Android/HarmonyOS)**: at build time the compiler folds `<pg-glass …>` into a plain box carrying a `glass` field; the host self-draws the glass surface (artifact: `dist/app/<platform>/glass-manifest.json`). Folding only accepts **statically evaluable** values — literals, and `v-for` over a **literal array / constant**, which is **expanded per item and folded** (`v-for="p in presets" :preset="p"` ⇒ each item folds to that preset; `presets` must be statically obtainable). Runtime-dynamic values (reactive variables) are not folded and fall back to the preset default.

## Props

| prop | Type / default | Description |
|---|---|---|
| `preset` | String, `'custom'` | Preset: `navigationBar` / `tabBar` / `modal` / `card` / `floating` / `sidebar` / `custom` |
| `intensity` | String \| Number, default from preset | Step `none` / `thin` / `regular` / `thick` / `ultra`; or a number scaling blur directly |
| `tint` | String, `''` | Tint (overrides the preset tint) |
| `radius` | Number, `0` | Corner radius, px (`0` = no override; radius stays under page control) |
| `border` | Boolean, default from preset | Highlight edge (0.5px inner stroke, L2) |
| `noise` | Number, default from preset | Noise intensity 0-1 (L2; `0` = off) |
| `fallback` | String, `'solid'` | Degradation strategy: `solid` (semi-transparent solid) / `flat` (no background, border only) |

## Preset values table

Final `blur = round(base preset blur × intensity step)`; steps: `none` 0 / `thin` 0.6 / `regular` 1.0 / `thick` 1.4 / `ultra` 1.8.

| preset | Base blur | Default tint | Typical use |
|---|---|---|---|
| `navigationBar` | 20 | rgba(255, 255, 255, 0.15) | top nav bar (sticky) |
| `tabBar` | 20 | rgba(255, 255, 255, 0.15) | bottom tab bar |
| `modal` | 24 | rgba(255, 255, 255, 0.15) | modal panel |
| `card` | 16 | rgba(255, 255, 255, 0.08) | content card |
| `floating` | 28 | rgba(255, 255, 255, 0.18) | floating control |
| `sidebar` | 20 | rgba(255, 255, 255, 0.12) | sidebar |
| `custom` | 20 | rgba(255, 255, 255, 0.12) | custom (override with props) |

Per-terminal preset specs for `radius` / `border` / `noise` are planned items; in the Web L1 implementation the corner radius and noise are passed in explicitly through props, while `border` enables the highlight edge by default.

## Real examples

The official site's sticky nav bar (`pg-glass` + the page handles positioning only):

```vue
<!-- website/src/App.vue -->
<pg-glass preset="navigationBar" class="nav-shell" :class="{ 'is-scrolled': scrolled }">
  <header>
    <p-stack direction="row" :gap="8" wrap class="nav">…</p-stack>
  </header>
</pg-glass>
```

```css
/* The page keeps only positioning and the hairline — blur / tint / highlight edge / noise all belong to the component */
.nav-shell { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--line); }
```

App side (the superapp "Mine" page, folded at build time into a self-drawn `style.glass` surface):

```vue
<pg-glass preset="card" :radius="12" style="height: 64px; margin: 0 12px 12px">
  <view class="mine-glass-in"><text class="mine-glass-t">Liquid glass · self-drawn material</text></view>
</pg-glass>
```

## Positioning and layout belong to the consumer

The root element **does not write `position` / `display`** — sticky, absolute, width/height, and padding are all declared by page classes (the component never overreaches); the noise layer and highlight edge anchor to the inner container, so they do not affect your positioning context.

## Degradation: the crash-free rule

| Scenario | Behavior |
|---|---|
| `prefers-reduced-transparency: reduce` | blur off; background becomes solid (accessibility first — Iron rule 4) |
| `backdrop-filter` unsupported (`@supports` probe) | degrades to the solid color the same way |
| low-tier device (`tier: low`) | drops to L1 |
| Mini Program logic layer | no `matchMedia` → always glass (the probe goes through `globalThis`; the rendering side decides) |

When degraded, the noise layer and the highlight edge are turned off as well, while copy and content stay readable as usual — glass is an enhancement, not a dependency. The degradation decision comes from the pure function `resolveGlassLevel()` (`@proteus-vue/glass`).

## Before you ship: `proteus audit glass`

Any hand-written `backdrop-filter` on any page is blocked by the audit rule **GLS001 (error)**:

```bash
proteus audit glass src        # scan raw backdrop-filter / nesting depth > 2 / glass nodes per page > 10
```

Rules: **glass goes through the single `<pg-glass>` entry only**; nesting ≤ 2, glass nodes per page ≤ 10 (performance budget). To keep one deliberately (it is itself the glass entry), use a named exemption via `// d2-exempt: reason` or a directory named `pg-glass`. CI gate: `check:glass-audit`.

## Glass system-shell components (Aether · planned)

Business writes `<pg-glass>`; the framework also has a **glass system-shell component set** (codename **Aether**, `lg-*`, e.g. `lg-nav-bar` / `lg-tab-bar` / `lg-sheet`) that **renders `<pg-glass>` internally**, providing system-level shell semantics (safe area, scroll pinning, status-bar integration). **This is currently a planned item (`docs/Proteus_液态玻璃系统组件库方案.md`), not yet landed** — once it is, you can use system shells directly instead of assembling `pg-glass` yourself.

## FAQ

**Q: Why is there no edge refraction on Web like on App?**
A: Web / Mini Program use CSS `backdrop-filter` (the browser compositor's native fast path) — **blur only**; real refraction needs a self-drawn glass pass, which is native-only (decision #877, honest boundary).

**Q: What if the presets are not enough?**
A: Prefer the closest `preset` (validated, best-tuned combinations), then fine-tune with `preset="custom"` + props; do not hand-write `backdrop-filter`.

**Q: Does the glass block clicks / affect layout?**
A: The `pg-glass` root writes no position/display — positioning, size and stacking are controlled by your page classes; glass is a pure visual enhancement.

**Q: The corner radius does not apply?**
A: `radius` defaults to `0` (no override) — pass `:radius="16"` explicitly, or put the radius on the page class (consumer-owned).

## Next steps

- [Liquid glass engine product page](/liquid-glass): live demos (presets / interactive / per-end matrix / degradation)
- [Desktop primitives](/docs/30-desktop-primitives): cursor glow + glass = the desktop ambience layer
- [Semantic components overview](/docs/12-components-intro): the full component landscape and category tables
