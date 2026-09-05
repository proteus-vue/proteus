---
title: Capabilities overview
group: 总览
order: 0
---

# Capabilities overview

> 8 capability primitives — SSOT = `PRIMITIVE_CATALOG` (capability kind) + `CapabilityHooks` interface. **All hooks implemented** (API ready — target bridges/degradation in each page's compat table).

## Network & Communication (8)

| # | Capability | API | Returns | Mini Program equivalent |
|---|---|---|---|---|
| C26 | [capability.fetch](/docs/capability/fetch) | `useFetch()` | `Promise<T>` | wx.request |
| C27 | [capability.websocket](/docs/capability/websocket) | `useWebSocket()` | `WSConnection` | wx.connectSocket |
| C28 | [capability.socket-task](/docs/capability/socket-task) | `useSocketTask()` | `SocketTask` | wx.SocketTask |
| C29 | [capability.upload](/docs/capability/upload) | `useUpload()` | `Progress<Result>` | wx.uploadFile |
| C30 | [capability.download](/docs/capability/download) | `useDownload()` | `Progress<Result>` | wx.downloadFile |
| C31 | [capability.data-channel](/docs/capability/data-channel) | `useDataChannel()` | `Channel` | — |
| C36 | [capability.bluetooth](/docs/capability/bluetooth) | `useBluetooth()` | `BluetoothAPI` | wx.openBluetoothAdapter |
| C37 | [capability.nfc](/docs/capability/nfc) | `useNFC()` | `NFCAPI` | wx.getHCEState |
