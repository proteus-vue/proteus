---
title: useWebAssembly (capability.webassembly)
group: 应用与生命周期
order: 7013
---

# useWebAssembly

useWebAssembly: cross-platform WebAssembly — compile / instantiate / validate. ★Three runtime shapes differ substantively (dual-source evidence): mini program uses WXWebAssembly.instantiate(**package path**, .wasm/.wasm.br, base library v2.13.0+, no compile/validate); Web and App-iOS (JavaScriptCore) use the standard WebAssembly (bytes, compile/validate available); App-Android currently has no JS engine → unavailable. Branch on the capability flags (supportsStreaming / supportsPathLoad), never on platform name.

> Capability primitive C82 · `capability.webassembly` · returns `WebAssemblyAPI` · **Hook implemented** (API ready — target bridges in the table below)

## Signature

```ts
useWebAssembly(): CapResult<WebAssemblyAPI>
```

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `WebAssemblyAPI` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Methods

| Method | Doc |
|---|---|
| [`instantiate`](#instantiate) | — |

### `instantiate`

```ts
instantiate(source: WasmSource, options?: WasmInstantiateOptions): Promise<CapResult<WasmModuleHandle>>
```

| Param | Type | Required | Doc |
|---|---|---|---|
| `source` | `WasmSource` | Yes | — |
| `options` | `WasmInstantiateOptions` | No | — |

**Returns**: `Promise<CapResult<WasmModuleHandle>>`

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `supportsStreaming` | `boolean` | Yes | 能力位：是否支持流式/字节编译（Web/App-JSC true；MP **false**——只收路径） |
| `supportsPathLoad` | `boolean` | Yes | 能力位：是否支持从代码包路径加载（MP true；Web/App **false**） |

## Referenced types

### `WasmInstantiateOptions`

| Prop | Type | Default | Doc |
|---|---|---|---|
| `imports` | `Record<string, Record<string, unknown>>` | — | 导入对象（`{ module: { name: value } }`）；缺省无导入 |

### `WasmModuleHandle`

★C82 WebAssembly：跨平台 WASM 模块编译/实例化/校验。

【为什么有它】WASM 是"一次编译、三端执行"的计算载体（图像处理 / 编解码 / 加解密 /
物理引擎等 CPU 密集逻辑），与 Proteus 的「一份源码多端」定位同源。

★★**平台真实能力（已取证，非按标准 Web API 假设）**——三端形态**有实质差异**：

| 端 | 入口 | 首参 | compile/validate | 证据 |
|---|---|---|---|---|
| MP（微信） | `WXWebAssembly.instantiate(path, imports)` | **代码包路径**（.wasm / .wasm.br） | ❌ **无** | 官方文档 + `miniprogram-api-typings/lib.wx.wasm.d.ts` |
| Web | 标准 `WebAssembly` | `BufferSource \| Response \| URL` | ✅ 有 | 平台标准 |
| App-iOS | JSC 内建 `WebAssembly`（与 Web 同形） | 同上 | ✅ 有 | **本机实测**：`validate(minimalModule)===true`，8 个 API 齐备 |
| App-Android | 宿主 **wasm3**（QuickJS 无内建 WASM ⇒ 宿主侧运行时） | `{ bytes }`（宿主通道） | ✅ 有（宿主实现） | **真机实测**：`add(2,40)===42`，真跑 i32.add（wasm3 解释器，MIT/无 JIT ⇒ 兼容 W^X） |

【因此本原语的设计取舍（★不是"照抄 Web 标准"）】
· **入口归一为 `instantiate(source)`**，`source` 是**判别联合**（`{ bytes }` / `{ path }`）——
因为 MP 只收路径、Web/App-JSC 只收字节，**没有**一个共同的首参类型可表达；
若强行只暴露字节，MP 端会**结构性不可用**（无法把路径变成字节，见下）。
· **`compile` / `validate` 声明为可选**（`?`）：MP 端**客观没有**这两个方法；
声明为必需会让 MP 端实现要么撒谎、要么抛错。诚实做法 = 调用方 `if (wasm.compile)` 探测。
· **`supportsStreaming` / `supportsPathLoad` 两个能力位**把这个差异变成**可查询的数据**，
而不是让调用方按平台名分支（平台名分支是本仓 stores 铁律禁止的形态）。

【诚实边界（明确不支持的）】
· MP 端**无法**从网络/字节流加载：官方只接受代码包内路径 ⇒ 动态下载 wasm 需先落包
（`useFileSystem` + 重新分包），本原语**不假装**能做。
· ★App-Android 的 JS 引擎（QuickJS）**内建无 WebAssembly** ⇒ 由**宿主侧 wasm3** 提供
（`webassembly.instantiate/call/release` 通道，`hosts/android/wasm/`）；iOS 的 JSC 内建
⇒ 走引擎路径。同一份 JS 桥 **两条路径都被真机验证**（结果都是 add(2,40)=42）。
· MP 端 export 支持 函数 / Memory / Table，**iOS 平台暂不支持 Global**（官方原文）。
· 本原语**不做** WASM↔JS 的自动编组（那需要 IDL）；只负责"拿到 instance"，调用面归调用方。

| Prop | Type | Default | Doc |
|---|---|---|---|
| `exports` | `Record<string, unknown>` | — | 模块导出的符号（函数 / Memory / Table；Global 依平台而定——见接口头） |
| `fromPath` | `boolean` | — | 该实例是否由**路径**加载（MP 端恒 true；Web/App 端恒 false） |

| Method | Signature | Doc |
|---|---|---|
| `dispose` | `dispose(): void` | 释放（暂无资源需释放——预留：WASM 实例由 GC 回收，本方法供未来池化实现统一出口） |

## Error codes

| code | Doc |
|---|---|
| `webassembly.unsupported` | WASM is unavailable, or the source shape does not match the current runtime (mini program only accepts a package path; Web/App only accept bytes) |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → (wx-native equivalent; exact mapping in the zh version) |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | 🟡 | native-ios (UIKit + CoreAnimation) · render core shipped — capability bridge not wired |
| Android native | 🟡 | native-android (self-drawn Canvas) · render core shipped — capability bridge not wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · render core shipped — capability bridge not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but bridge missing → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Usage

```ts
const res = await useWebAssembly()

if (res.ok) {
  console.log(res.data)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

## Platform notes

### Mini Program (MP)

- **WXWebAssembly (path load)** — ★Loads only from **code-package paths** (.wasm / .wasm.br) — no byte/streaming compilation (capability flag supportsStreaming=false)

### Web

- **Standard WebAssembly (streaming)** — instantiateStreaming compiles while downloading (faster than download-then-compile); compile/validate fully available

### App (iOS / Android / Harmony)

- **WASM built into JSC / QuickJS** — App JS engines (JavaScriptCore on iOS / QuickJS on Android) ship WebAssembly — same shape as Web (byte loading; streaming flag follows the engine)

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->