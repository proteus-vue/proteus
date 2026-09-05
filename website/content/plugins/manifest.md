---
title: manifest（v0.1.0）
order: 90
group: 插件 API
generated: true
source_hash: 1511dee1
---

# manifest

> 本页由 WIT 自动生成（since_v0_1_0.wit），请勿手工编辑。
> 需要补充「为什么 / 怎么做」，请写到指南并链接过来。

插件清单（PluginManifest）——Tier 0/1/2 三层形态的声明入口。

## tier（enum）

三层插件形态：Tier 0 纯数据（零代码）/ Tier 1 声明式 WASM / Tier 2 完整 WASM。

- **declarative**
- **wasm**
- **full**

## capability（variant）

能力授权单元（默认零权限：未声明 = 拒绝）。 网络能力强制 host 白名单——禁止不带 hosts 的 network 声明。

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

## limits（record）

资源限额（Tier 1/2 必填，缺省值由宿主强制：64MB / 50ms / 5000ms）。

- **memory-mb**: `option<u32>`
- **cpu-ms-per-call**: `option<u32>`
- **timeout-ms**: `option<u32>`
