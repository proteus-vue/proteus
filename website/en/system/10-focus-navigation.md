---
title: Focus navigation engine
order: 10
group: 柔性系统
---

# Focus navigation engine

> **A remote has exactly one d-pad.** In-car rotary knobs, TV remotes, keyboard tabbing — these forms have no freedom to "point and click", so they need dependable **spatial navigation**: press a direction and the focus moves to the geometrically most reasonable target. The Flex System ships that logic as zero-dependency pure functions (`navigateFocus` in `@proteus-vue/fluid`), auto-enabled by capability declarations.

## Why DOM order is not enough

The browser's tab order follows DOM source order, and **visual order ≠ source order** (they diverge under grids, wrapping and multi-column layouts). A remote user pressing "right" expects the focus to reach the card on the right — geometric spatial navigation exists for exactly that (the same thinking as tvOS `UIFocusSystem` and Android `FocusFinder`).

## The solving algorithm

```ts
navigateFocus(
  current: FocusRect | null,        // the focused rect (null = first entry)
  candidates: FocusRect[],          // all candidates (pure data, no DOM dependency)
  direction: 'up' | 'down' | 'left' | 'right',
  opts?: { preferredFirst?: string; crossWeight?: number },
): string | null
```

Solve order (`packages/fluid/src/focus-nav.ts`):

1. **Direction filter** — keep only candidates in the requested direction (pressing "right" keeps `x > current.x`)
2. **Primary distance + cross-axis offset weighting** — primary distance first, smaller cross-axis deviation wins (`crossWeight` defaults to 2: alignment matters more than distance)
3. **Same-line priority** — same-row/column candidates beat diagonal ones
4. **Deterministic tie-break** — on a perfect tie the first in stable order wins (no "random jumping" feel)

Boundaries always **clamp** (never wrap): `clampOrWrap(index, total, wrap)` keeps wrap capability but leaves it off by default — tvOS / Leanback do not wrap, and wrapping makes "press again on the last card" jump somewhere unpredictable.

Nine unit tests accompany it (direction filtering / same-line priority / cross-axis weight / determinism / empty candidates / single candidate / boundaries).

## When the engine turns on (capability-driven)

```ts
// inside p-formfactor
const focusEnabled = computed(() => capsEnabled(caps.value.dpad))   // remote forms only
```

| Form | Takes over arrow keys? | Why |
|---|---|---|
| `car` / `tv` | ✅ | Remote/rotary input — the d-pad is the only way to move |
| `pc` | ❌ | Keyboard users expect the **native tab order**; taking over violates WCAG 2.1.1/2.4.3 (it was wrongly included once, now fixed) |
| Touch forms | ❌ | Arrow keys should scroll the page, not move focus |

When enabled (remote forms) the framework wires everything up, **zero business changes**:

| Behaviour | Description |
|---|---|
| Roving tabindex | The focused item is `tabindex=0`, the rest `-1` (a single tab stop inside the container) |
| Initial focus | Settled on the first focusable element as soon as the form enters (the TV / in-car convention: arrive and operate), and `focusedId` is initialised immediately (no "first Enter does nothing") |
| Candidate set | `button` / `[role=button]` / `.pf-focusable` / `.pf-rec-card` / `.fp-sku` / `.fp-rail-item` / tab items — covering what is genuinely clickable in the content slots |
| Keys | ↑↓←→ geometric movement; Enter / Space trigger `click()` |
| Robustness | Stable candidate ids (not array indices, so inserts/removals cannot collide); `focusin` synchronisation (after an outside click the d-pad starts from the real focus); focus is rebuilt when the candidate set or posture/form changes; an **editable guard** (arrow keys inside an input belong to the caret, never hijacked) |
| Lifecycle | Attached/detached with `focusEnabled` — switching forms in one session starts and stops the engine correctly (it used to be decided once at mount) |

## Visuals: focus must be visible

Remote forms (`visual.focus: 'ring'`) drive the focus ring from `--pf-focus-ring`:

```css
.has-dpad :deep(*:focus-visible),
.has-focus-tree :deep(*:focus-visible) {
  outline: var(--pf-focus-ring, 3px) solid var(--pf-accent, #ffb13d);   /* 3px accent ring */
  outline-offset: -2px;                                                 /* inset: the poster row's overflow must not crop it */
  filter: brightness(1.07);                                             /* brightness assist */
  box-shadow: 0 0 0 1px …, 0 6px 18px rgba(0,0,0,.45);
}
```

> Discipline: focus emphasis **never uses `transform: scale`** — a full-row-height cockpit hit area enlarged by 4% overflows and gets cropped (a measured defect). The replacement is "ring + shadow + brightness", which leaves layout geometry untouched.

## Honest boundaries

- **`clampOrWrap`'s wrap has no production caller**: everything clamps today (matching platform conventions); if a TV poster row ever gets "wrap within the row", it must be wired explicitly with tests.
- **`crossWeight` lacks targeted tests**: the nine cases do not cover that parameter's marginal effects (known gap).
- The crown (`crown`) currently has visual hints and hit-area semantics only; **continuous adjustment input** (rotate to step a value) is planned — see the [OS-level roadmap](/docs/system/01-overview).

## Next steps

- [p-formfactor](/docs/system/11-formfactor-composition): the container component the engine attaches to
- [Capability tri-state](/docs/system/08-capabilities): where the `dpad` declaration comes from
