---
title: Plugin development guide
order: 1
group: 插件 API
---

# Plugin development guide

> [host](/docs/plugin/host) / [manifest](/docs/plugin/manifest) / [contributions](/docs/plugin/contributions) are **WIT-generated API references** (field/method level); this page covers the "why / how" — how a plugin runs safely.

## Security model: capability-based security (not review-based)

The VSCode extension host's permission model is structurally flawed (per the original Tanium research): **an extension host's permissions = the IDE's permissions** — installing a theme plugin means handing over full file/network/process permissions. Proteus swaps the model:

```
VSCode model:   plugin ⊂ IDE process ⇒ plugin permissions = user permissions
Proteus model:  plugin ⊂ WASM sandbox ⇒ zero permissions by default + capability allowlist
```

- **Zero permissions by default**: what a plugin can do is determined by the capabilities declared in its manifest (an unauthorized call → denied, without terminating the process)
- **Permissions rest on data sensitivity, not API dangerousness** (G-59: a clipboard could steal mnemonics — modeled as a finite set)
- **WASM crash isolation**: a plugin crash does not affect the host (resource limits are enforced)

## Lifecycle (driven by the host's activation-timing contract)

| Stage | host API | Contract |
|---|---|---|
| Install | (manifest registration) | code hash + signature registration (sig-*) |
| **Activate** | `activate(plugin-id)` | the host decides the timing per **activationEvents** — **activation timing is a contract, not an optimization** (G-59: wildcard events are forbidden) |
| Invoke | `invoke` | through the capability gateway (unauthorized → denied) |
| Suspend | `suspend` | **deactivate must clean up symmetrically** (un-cleaned items are recorded in the audit and lower the trust score) |
| Uninstall | `uninstall` | symmetric cleanup and reclamation |

## Writing a plugin (skeleton)

```ts
// proteus.plugin.json (manifest) — the capability allowlist declaration
{ "name": "my-panel", "version": "0.1.0", "apiVersion": "0.1.0",
  "activationEvents": ["studio:onPanelOpen"],   // precise events; wildcards forbidden
  "capabilities": ["studio:panel.render"],       // zero permissions by default → a minimal allowlist
  "entry": "plugin.wasm" }
```

- **api-surface** (`host.api-surface`): a plugin queries the host's current capability set — **the API only grows, never changes**; stable versions are frozen and never modified
- **Version coexistence**: WIT versioning (`since_v0_1_0`) — plugins with different apiVersion can coexist without being force-upgraded along with the host
- Panel/view extensions go through `contributions` (contribution point declarations)

## Trust and governance (G-59 ecosystem red lines)

- **Trust is not inheritable**: a code-hash change revokes and re-authorizes — it does not detect "malice"; it severs the "trust inheritance" assumption
- **Symmetric deactivation audit**: suspend/uninstall leave un-cleaned items → audit + trust downgrade
- **Resource limit enforcement**: exceeding the budget refuses loading (not a warning)
- **Read-only first**: read-only capabilities by default; write capabilities require explicit authorization
- Ecosystem quality surface (breakage-rate dashboard / version deprecation): see the plugin ecosystem plan

## Honest boundaries

- The plugin API's target host is **Studio** (panel extensions / toolchain extensions); business-project reuse goes through [component distribution](/docs/framework/components-distribution) (source-level)
- The current WIT v0.1.0 is the API-freeze baseline — new types evolve via version coexistence

## Next steps

- [host (v0.1.0)](/docs/plugin/host): method-by-method signatures for activate/suspend/invoke/api-surface
- [manifest (v0.1.0)](/docs/plugin/manifest): the complete field set
