---
title: Route transitions
order: 4
group: Usage
---

# Route transitions

The same `meta: { transition: 'halfScreen' }` in the source is honoured three different ways — but the **enum is one and the same**.

## One enum, three targets

| Target | Honoured as | Implementation |
|---|---|---|
| Web | CSS transition name (`slide-up` / `slide-down` / `halfscreen` / `scale`) | `WEB_TRANSITION_MAP` |
| WeChat Mini Program | `navigateTo({ routeType })` platform identifier | `MP_ROUTE_TYPE_MAP` |
| App | **Morpheus drives it directly** (no name is handed to the platform) | `APP_TRANSITION_MAP` → kernel animation |

The key sets of the three tables are **cross-checked per target** (a test loads all three and compares them) — if the enum grows and any target misses a member, the gate turns red immediately.

## Direction semantics: push and pop are a mirror pair

`routeTransitionBatches()` compiles the enum into two-screen batches the executor can play, and it **builds the direction semantics in**:

| Direction | Incoming screen | Outgoing screen |
|---|---|---|
| `forward` (push / replace) | plays `spec.enter` (as declared) | plays `spec.exit` (as declared) |
| `back` (pop / return) | plays **`reverse(spec.exit)`** | plays **`reverse(spec.enter)`** |

`reverse` swaps `from` / `to` — the “`800 → 0` push-in” of `slideUp` becomes “`0 → 800` slide-out”. The device assertion for this is a **mirror-pair** check:

```ts
// forward.incoming's from/to is exactly back.outgoing's to/from
forward:  incoming 800 → 0    outgoing 0 → -240
back:     incoming -240 → 0   outgoing 0 → 800
```

The two sets of numbers are exactly inverse for the same transition — **direction semantics have a single implementation**, and executors no longer write their own.

## Executor: command stream → real tree ops + real animation

The route stack (M5 virtual stack) only produces a **command stream**; the executor orchestrates it:

```
stack commands (mount / enter / exit / unmount)
    ↓  createScreenExecutor (order / visibility / direction / transaction)
ports: ScreenTreeHost (tree ops) + ScreenAnimHost (animation playback)
    ↓  production impl via host channel → real kernel trees + real frame-loop animation
```

**Two orchestration decisions** (not frozen by the contract, decided by the executor, both recorded in code comments):

- **Deferred destruction after the transition** — on `exit` the outgoing screen is not destroyed immediately, otherwise the old screen would **vanish mid-slide** (a flash); it is destroyed after the transition completes, while tree retention is unchanged;
- **Three-value direction table** — mounted in this transaction and not a rebuild ⇒ `forward`; everything else (including the rebuild when returning to a frozen screen) ⇒ `back`. Returning to a frozen screen uses the reversed spec, which is what makes it read as a “return”.

## Device readings (both targets)

| Assertion | Reading |
|---|---|
| push command order | `mount(detail) → visible(detail) → visible(home,off)` (3 steps · tree retained, zero destroys) |
| Direction classification | first screen and push = `forward` · pop = `back` |
| Mirror pair | `forward.in 800→0` ↔ `back.out 0→800` (independently recomputed by the checker) |
| Destroy timing | `visible(home) → destroy(detail)` (destroyed after the transition finished) |
| Host really acted | `mount=2 · visible=4 · destroy=1 · anim=3/completed 3 · zero missing hooks` |

The checker `check-app-stack.py` is **shared by both targets** (Android QuickJS / iOS JavaScriptCore); host-side actions are evidenced by **the host’s own accounting**, never by the bridge’s self-report.

## Next

- [Evidence & honest boundaries](/docs/animation/04-boundaries) — device readings and the not-done list
