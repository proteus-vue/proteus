---
title: Full-target adaptation
order: 21
group: 渲染与能力
---

# Full-target adaptation (G-24 desktop primitives + G-25 full-target)

## Desktop interaction primitives (G-24, shipped)

When one codebase adapts to the PC, what is missing is not layout but **interaction semantics**. `@proteus-vue/desktop` provides 21 modules + directives:

| Primitive | Semantics | Platform convention |
|------|------|---------|
| `p-hover` | Hover state | Auto-degrades to tap highlight on touch |
| `p-shortcut` | Keyboard shortcut | `mod+s` → Mac ⌘S / Win Ctrl+S |
| `p-focus-trap` | Focus trap | Tab cycling inside popups + Shift+Tab reverse |
| `p-context-menu` | Context menu | Overflow-proof positioning + long-press normalization |
| `p-notify` / `p-permission` / `p-deeplink` / `p-command` (⌘K) | System-integration quartet | PRIM semantics |

```vue
<article v-p-hover class="card">…</article>
<input v-p-shortcut="'mod+s'" @shortcut="save" />
```

## Three-dimensional breakpoint model (G-25, planned)

Three dimensions — W (width) × H (height) × F (input form) — characterize the device:

| F | Device | Key capabilities |
|---|------|---------|
| touch | Phone / tablet / in-vehicle system | Basic |
| cursor | PC / in-vehicle secondary display | Mouse & keyboard |
| remote | TV | Focus engine (UIFocusSystem / Leanback) |
| dial | Watch | Crown + complications |
| voice | In-vehicle system | Voice navigation |

Iron rule: in-vehicle driving-safe (VEH001) / TV focus mode (TV001) / watch single-column (WATCH001).

## Degrade without crashing (Principle #4)

Capabilities are declared across three tiers — L1 (required) / L2 (best-effort) / L3 (system-level) — and when a high-end capability is missing, fallback walks the degradation chain L3→L2→L1→solid: **visible at compile time, crash-free at runtime**.
