---
title: manifest (v0.1.0)
order: 90
group: 插件 API
generated: true
source_hash: 1511dee1
---

# manifest

> This page is auto-generated from WIT (since_v0_1_0.wit) — please do not edit by hand.
> For "why / how" content, write it in the guide and link to it here.

Plugin manifest (PluginManifest) — the declaration entry point for the three Tier 0/1/2 forms.

## tier (enum)

Three plugin forms: Tier 0 pure data (zero code) / Tier 1 declarative WASM / Tier 2 full WASM.

- **declarative**
- **wasm**
- **full**

## capability (variant)

Capability authorization unit (zero permissions by default: undeclared = denied). The network capability enforces a host allowlist — a network declaration without hosts is forbidden.

- **read-workspace**
- **write-workspace**: `list<string>`
- **network**: `list<string>`
- **spawn-process**: `list<string>`
- **kernel-spi-topology**
- **kernel-layer-rules**
- **kernel-conformance**
- **kernel-device-impact**
- **device-attach**: `list<string>`
- **device-input**
- **run-external-process**

## limits (record)

Resource limits (required for Tier 1/2; default values are enforced by the host: 64MB / 50ms / 5000ms).

- **memory-mb**: `option<u32>`
- **cpu-ms-per-call**: `option<u32>`
- **timeout-ms**: `option<u32>`
