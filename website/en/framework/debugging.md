---
title: Debugging & observability
order: 16
group: 运行期
ends: debugging
---

# Debugging & observability

Proteus's debugging surface is made up of three layers: the **compile-time decision chain** (why the artifact looks this way), the **runtime trace** (what happened), and the **DevTools panels** (visual consumption). Each target's rollout status is in the “Terminal rollout” table above (following the G-57 Inspector overlay principle: L0 uses the host's existing debugger, semantic enhancement lives in L1/L2).
Proteus's debugging surface is made up of three layers: the **compile-time decision chain** (why the artifact looks this way), the **runtime trace** (what happened), and the **DevTools panels** (visual consumption). Each target's rollout status is in the “Terminal rollout” table above (following the G-57 Inspector overlay principle: L0 uses the host's existing debugger, semantic enhancement lives in L1/L2).

## Compile time: the decision chain

```bash
npm run debug:mp                        # full-chain debug build (PROTEUS_DEBUG=1)
npx proteus explain src/pages/index.vue # single-file compile decision trace
npx proteus rules                        # compiler rule catalog (each rule ships an AI explainer)
```

- The debug build injects `[proteus][stage]` logs and **decision-chain files** into the artifacts (each transform rule's before/after + line numbers)
- The `.transform-debug/` rotating dump carries the full trace (the decision chain lands on disk — auditable and replayable)

## Runtime: TraceBus

Route navigation, state changes, and error events all flow into **TraceBus** (ring buffer + redaction + sampling + zero-overhead gating):

- Non-push navigation on the Web (in-page links / browser back & forward) emits a trace automatically — route backtracking stays complete
- The DevTools route view consumes start / point / end events
- Zero production overhead: if traceBus is not injected, no events are produced

## DevTools panels (ten views)

| View | Content |
|---|---|
| timeline / flamegraph | runtime timeline and flamegraph |
| state | Pinia state (time-travel slider + snapshot import/export) |
| route | route backtracking (including parameterized navigation) |
| errors | error aggregation |
| components / pages | component tree and page stack |
| graph | ownership graph |
| device / ownership | device panel / ownership view |

Integration: `installProteusDevtools` (a local floating panel) or the DevTools panel page (remote WS dual-channel); remote time travel supports real restoration from store snapshots (`Proteus.restoreStores` → `$patch` per store).

## State snapshots & serialization

Store state serialization follows a unified contract (the store domain of `@proteus-vue/contracts`) — DevTools import/export, pinia-sync collaboration, and auditing all share the same layer.

## Next steps

- [Componentization & semantic naming](/docs/framework/components-model)
