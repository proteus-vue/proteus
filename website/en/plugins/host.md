---
title: host (v0.1.0)
order: 92
group: 插件 API
generated: true
source_hash: 1511dee1
---

# host

> This page is auto-generated from WIT (since_v0_1_0.wit) — please do not edit by hand.
> For "why / how" content, write it in the guide and link to it here.

Plugin host (PluginHost) — lifecycle + capability probing + runtime invocation + governance.

## activate

Activates a plugin. The host decides the timing per activationEvents (activation timing is a contract, not an optimization).

```ts
activate(plugin-id: `string`) -> result<string, string>
```

| Parameter | Type |
|---|---|
| plugin-id | `string` |

## suspend

Suspends a plugin. deactivate must clean up resources symmetrically (un-cleaned items are recorded in the audit and lower the trust score).

```ts
suspend(plugin-id: `string`) -> 
```

| Parameter | Type |
|---|---|
| plugin-id | `string` |

## uninstall

Uninstalls a plugin.

```ts
uninstall(plugin-id: `string`) -> 
```

| Parameter | Type |
|---|---|
| plugin-id | `string` |

## supports

★ Capability probing: a pure metadata query — zero side effects, zero network, zero kernel calls. "Send a request and see whether it crashes" is strictly forbidden — probing a capability with side-effecting calls is a design error.

```ts
supports(cap: `string`) -> bool
```

| Parameter | Type |
|---|---|
| cap | `string` |

## invoke

Runtime invocation. An unauthorized call returns denied (a normal output of the permission system, not an error — the host records it and continues).

```ts
invoke(plugin-id: `string`, call: `string`) -> result<string, string>
```

| Parameter | Type |
|---|---|
| plugin-id | `string` |
| call | `string` |

## get-usage

Governance: queries a plugin's resource usage (memory / CPU / timeout).

```ts
get-usage(plugin-id: `string`) -> string
```

| Parameter | Type |
|---|---|
| plugin-id | `string` |

## kill-plugin

Governance: terminates a runaway plugin (forcefully enforced when resource limits are exceeded — only that plugin is killed, others are unaffected).

```ts
kill-plugin(plugin-id: `string`, reason: `string`) -> 
```

| Parameter | Type |
|---|---|
| plugin-id | `string` |
| reason | `string` |

## api-surface

★ Architecture touchstone: a snapshot of the kernel API surface. Adding your own host or built-in plugins must not change this snapshot.

```ts
api-surface() -> list<string>
```
