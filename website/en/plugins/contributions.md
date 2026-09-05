---
title: contributions (v0.1.0)
order: 91
group: 插件 API
generated: true
source_hash: 1511dee1
---

# contributions

> This page is auto-generated from WIT (since_v0_1_0.wit) — please do not edit by hand.
> For "why / how" content, write it in the guide and link to it here.

Plugin contribution points (ContributionPoints) — Tier 0 data is applied directly by the host, while Tier 1/2 requires the runtime.

## command-def (record)

Command contribution: a behavior entry point triggered from panels/menus (Tier 1+).

- **id**: `string`
- **title**: `string`
- **icon**: `option<string>`

## panel-def (record)

Panel contribution (Studio-specific: the mount point for framework-semantic panels).

- **id**: `string`
- **title**: `string`
- **where**: `string`

## theme-def (record)

Theme contribution (Tier 0: pure data; the host reads it and applies it directly).

- **id**: `string`
- **name**: `string`
- **css**: `string`
