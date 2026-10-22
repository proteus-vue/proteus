---
title: useUpload (capability.upload)
group: 网络与通信
order: 4
---

# useUpload

**What it does**: Upload a file to a server with progress.

**When to use it**: Uploading avatars, documents, videos.

> 技术标识：能力原语 C29 · `capability.upload` · 返回 `Progress<Result>` · **Hook implemented** (per-end support in the table below)

useUpload: upload files (wx.uploadFile / web fetch FormData)

## Signature

```ts
useUpload(options: UploadOptions, onProgress?: ProgressCallback): Promise<CapResult<UploadResult>>
```

## Parameters

Param,Type,Required,Doc
|---|---|---|---|
| `options` | `UploadOptions` | Yes | C29 upload options (wx.uploadFile / web fetch FormData) |
| `onProgress` | `ProgressCallback` | No | Progress callback (0-100; optional) |

#### Properties of `options`

| Property | Type | Required | Doc |
|---|---|---|---|
| `url` | `string` | Yes | Upload target URL (HTTPS) |
| `filePath` | `string` | No | wx temporary file path (produced by wx.chooseMedia/chooseImage, etc.) |
| `file` | `Blob` | No | Web file object |
| `name` | `string` | No | Form field name (defaults to 'file') |
| `formData` | `Record<string, string>` | No | Additional form fields |
| `headers` | `Record<string, string>` | No | Custom request headers |
| `timeout` | `number` | No | Timeout in ms (timeout → Err) |

## Returns

`Promise<CapResult<T>>` — iron rule: no callbacks, no try/catch duty; branch on `res.ok`:

| Property | Type | Doc |
|---|---|---|
| `ok` | `boolean` | Succeeded `true` / failed `false` |
| `data` | `UploadResult` | Success payload (structure below) |
| `error` | `CapError` | Present on failure: `code` (machine code) / `message` (human-readable reason) / `cause` (original exception) |

## Props

| Prop | Type | Required | Doc |
|---|---|---|---|
| `status` | `number` | Yes | HTTP status code |
| `data` | `unknown` | Yes | Response body (text/JSON is decided by the server) |
| `progress` | `number` | No | Progress (0-100, if the platform supports onProgressUpdate) |

## Error codes

| code | Doc |
|---|---|
| `upload.unsupported` | The bridge does not provide upload (useUpload unavailable) |
| `upload.failed` | — |

> Platform unsupported → the `*.unsupported` family; business branches on `code`, no try/catch needed.

## Compat rollout

| Target | Status | Notes |
|---|---|---|
| Web SPA | ✅ | vue-dom · webBridge implementation (direct platform API) |
| WeChat Mini Program | ✅ | skyline (WebView fallback) · wx bridge → wx.uploadFile |
| Headless (SSR / testing) | ✅ | headless · mock bridge injected (testing / SSR tier) |
| iOS native | ✅ | native-ios (UIKit + CoreAnimation) · App host bridge (capability-app.ts) · bridge method wired |
| Android native | ✅ | native-android (self-drawn Canvas) · App host bridge (capability-app.ts) · bridge method wired |
| HarmonyOS | 🟡 | native-harmony (ArkUI RenderNode) · App bridge ready (platform-neutral TS) — Harmony host shell not wired |
| Flutter hybrid | 🟡 | flutter · same JS logic layer — capability bridge not wired |
| Quick App | ⬜ | Quick App engine (TBD) · target not started |

> Status scale: ✅ target shipped & this capability usable · ⚠️ target shipped but the bridge is missing **or is a pure shell** → explicit `Err` degradation · 🟡 render core shipped — capability bridge not wired · ⬜ target not started. ★**Strictness differs by target**: WeChat/Web require the bridge method to exist **and do real platform work** (a body returning `unsupported` on every path counts as ⚠️); iOS/Android require the method in the App bridge factories; HarmonyOS requires **both** the JS bridge and host dispatch. Target architecture matrix → [Ends & maturity](/docs/framework/ends-matrix).

> Iron rule: every capability primitive returns `Result<T>` (no callbacks / no global objects); platform unsupported → explicit `Err` degradation, zero platform branches in business code.

## Referenced types

### `UploadOptions`

C29 上传选项（wx.uploadFile / web fetch FormData）

| Prop/Method | Type | Doc |
|---|---|---|
| `url` | `string` | 上传目标 URL（HTTPS） |
| `filePath` | `string` | wx 临时文件路径（wx.chooseMedia/chooseImage 等产出） |
| `file` | `Blob` | web 文件对象 |
| `name` | `string` | 表单字段名（缺省 'file'） |
| `formData` | `Record<string, string>` | 附加表单字段 |
| `headers` | `Record<string, string>` | 自定义请求头 |
| `timeout` | `number` | 超时（ms；超时 → Err） |

### `ProgressCallback`

C29/C30 传输进度回调（0-100）

| Prop/Method | Type | Doc |
|---|---|---|
| `call` | `(pct: number): void` | — |

### `UploadResult`

C29 上传结果

| Prop/Method | Type | Doc |
|---|---|---|
| `status` | `number` | HTTP 状态码 |
| `data` | `unknown` | 响应体（文本/JSON 由服务端决定） |
| `progress` | `number` | 进度（0-100，若平台支持 onProgressUpdate） |

### `CapError`

| Prop/Method | Type | Doc |
|---|---|---|
| `code` | `string` | — |
| `message` | `string` | — |
| `cause` | `unknown` | — |

## Usage

```ts
const res = await useUpload({ url: 'https://api.example.com/upload', filePath })

if (res.ok) {
  console.log('uploaded:', res.data.status, res.data.progress ?? 100)
} else if (res.error.code.endsWith('.unsupported')) {
  // platform unsupported → degradation path
}
```

<!-- generated by website/scripts/gen-content.mjs (en overlay) · source SSOT: packages/component-ir/src/primitives.ts + packages/api/src/capability.ts -->