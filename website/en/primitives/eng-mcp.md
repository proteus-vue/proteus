---
title: WebMCP integration (E30: useMCP / capabilityToTool)
order: 82
group: Engineering semantic primitives
---

# WebMCP integration (E30: useMCP / capabilityToTool)

Expose framework capabilities as agent-callable tools in the browser — capability-derived tools normalize responses automatically (ok → result / Err → isError + error code); honest degradation on mini program

> Source module `@proteus-vue/api` (engineering primitive factories — **injection-based**: the consumer injects reactivity/driver/routerLike etc., the api package has zero vue dependency; MP artifact-safe subset: no `?.`/`??`/array destructuring).

**★E30 engineering.mcp (2026-09-19): WebMCP — the page registers tools for the in-browser agent.**
· Spec surface (verified 2026-09): the namespace is `document.modelContext` (★ NOT navigator); there is NO `unregisterTool` — unregistration goes through `AbortSignal.abort()`; detect support by checking the method is **callable** (a bare empty object would otherwise be misread as supported)
· Inspired by VueUse v15 `useWebMCP` (document namespace / signal-based unregistration / callable-method detection / `{ isSupported, isRegistered, error }` return)
· ★Framework delta (not a copy): every capability primitive returns the unified `CapResult<T>` contract (G-32.4), so capabilities can be derived into MCP tools automatically — `ok` → tool result, `Err` → `isError` + error code; thrown errors never leak into the agent channel
Honest degradation (G-32.3): no `document` (mini program / SSR) → `isSupported=false`, nothing registered, no throw — never silently pretends success
Zero vue dependency: scope disposal is **injected** via `onDispose` (this package ships into MP artifacts; same injection precedent as createEngineering)
MP artifact-safe (decisions #32/#36): no `?.` / `??` / array destructuring; the global `document` is never touched at module top level

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | Official demo wiring (examples/platform-api-demo — all factories called) |
| WeChat Mini Program | 🟡 | Injectable subset runs on the logic layer (MP artifact-safe); component-form wiring partially rolled out first |
| Headless (SSR/testing) | ✅ | Inject reactivity etc. on Node to run (tooling/testing tier) |
| iOS native | 🟡 | Native validation not started (E-series injection surface follows host batches) |
| Android native | 🟡 | Native validation not started |
| HarmonyOS | 🟡 | Native validation not started |
| Flutter hybrid | 🟡 | same JS logic layer — wiring not started |
| Quick App | ⬜ | target not started |

> Status scale: ✅ target shipped & this primitive usable · 🟡 prototype mapping — wiring not started · ⬜ target not started. Family-level mechanism coverage (not a per-target on-device verification matrix); target architecture matrix (engine / runtime / persistence) → [Ends & maturity](/docs/framework/ends-matrix).

## Core exports (SSOT: `packages/api/src/mcp.ts`)

| Export | Kind | One-liner (source comment) |
|---|---|---|
| `McpModelContextLike` | interface | — |
| `McpDocumentLike` | interface | — |
| `McpToolArgs` | type | — |
| `McpToolResponse` | interface | — |
| `McpToolDescriptor` | interface | Tool descriptor (spec subset: name / description / inputSchema / execute) |
| `McpCapabilityToolSpec` | interface | Capability tool spec (name / description / inputSchema / run) |
| `toToolResponse` | function | Value → tool response (empty payloads become a readable success marker, never the literal "undefined") |
| `toErrorResponse` | function | Error → tool response with `isError: true` |
| `capabilityToTool` | function | Capability → MCP tool: normalizes the `CapResult<T>` contract into a tool response |
| `UseMCPOptions` | interface | — |
| `UseMCPReturn` | interface | — |
| `useMCP` | function | ★E30: register tools (explicit + capability-derived) on `document.modelContext`; returns live getters `{ isSupported, isRegistered, error, toolNames, ready, dispose }` |

### API detail

#### `useMCP`

- Signature: `useMCP(options: UseMCPOptions): UseMCPReturn`
- `options`: `tools` (explicit) · `capabilities` (derived) · `prefix` (tool-name prefix) · `document` (injection, for tests) · `enabled` (probe without registering) · `onDispose` (scope disposal hook)
- Returns `{ isSupported, isRegistered, error, toolNames, ready, dispose }` — ★state is exposed as **getters** (async registration / disposal stay readable, not a snapshot frozen at creation time)
- `ready`: a Promise resolving when registration completes (including async `registerTool`) — `await` it when you need determinism

#### `capabilityToTool`

- Signature: `capabilityToTool(spec: McpCapabilityToolSpec, prefix?: string): McpToolDescriptor`
- `spec.run` returns `CapResult<T>` (or a Promise of it) → normalized automatically: `ok` → tool result; `Err` → `isError: true` + `code: message`
- Thrown errors are normalized the same way (exceptions never leak into the agent channel)

#### `toToolResponse`

- Value → tool response: strings pass through; **empty payloads (`undefined`/`null`) → `ok (no data)`** — ★never the literal `"undefined"` (most capabilities are `CapResult<void>`, and an agent would treat that string as valid data); everything else goes through `JSON.stringify`
- Circular references / BigInt and other serialization failures → degrade to a string (tool responses must be serializable, never throw at the agent)

#### `toErrorResponse`

- `Error` / non-Error values → `{ content, isError: true }` — so an agent retries or re-plans instead of parsing it as success

## Real usage (dogfooding provenance — the official site itself / example projects run it live, not illustrative)

```ts
const cap = createCapabilityHooks()

const mcp = useMCP({
  prefix: 'app_',
  capabilities: [
    { name: 'vibrate', description: 'Vibrate feedback', run: () => cap.useVibrate(30) },
    { name: 'clipboard_read', description: 'Read clipboard', run: () => cap.useClipboard() },
  ],
  onDispose: onScopeDispose, // or onUnmounted — lifecycle handed back to the caller (zero vue dependency)
})

mcp.isSupported  // whether this environment implements WebMCP (callable-method detection)
mcp.toolNames    // actually registered tool names (prefix included)
```
> Origin: `examples/pages/platform-api-demo.vue:836`

```ts
// Capability → tool: ok → result; Err → isError + error code (CapResult normalized automatically)
const t = capabilityToTool({ name: 'locate', description: 'Locate', run: () => capOk({ lat: 1, lng: 2 }) })
```
> Origin: `tests/use-mcp.test.ts:120`

## Usage & degradation

- **Two ways to register**: `useMCP({ capabilities | tools })` — `capabilities` goes through **capability derivation** (the framework normalizes responses from `CapResult`); `tools` are **explicit declarations** with a fully custom `execute`.
- **Capability derivation (the core delta of this primitive)**: you only write "tool name + description + arg schema" and the framework normalizes responses — `ok` → tool result, `Err` → `isError` + error code, and thrown errors never leak into the agent channel.
- **Lifecycle**: `onDispose` is **injected** (pass `onScopeDispose` / `onUnmounted` from Vue); this package has zero vue dependency — the same implementation runs in MP artifacts and Node tests.
- **Unregistration**: the spec has no `unregisterTool`; `dispose()` aborts the `AbortSignal` (idempotent).
- **Degradation**: without `document.modelContext` (mini program / SSR / browsers that have not implemented the standard) → `isSupported=false`, nothing registered, **no throw** — reported honestly instead of silently pretending success.
- **Detection discipline**: check that `registerTool` is **callable**, not merely that the object exists (a bare empty object would be misread as supported).

<!-- generated by website/scripts/gen-primitives.mjs (en overlay) · SSOT：packages/api/src -->