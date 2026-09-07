---
title: Platform API
order: 19
group: 渲染与能力
---

# Platform API

Storing state, navigating between pages, popping a Toast, firing a request — the few things every application needs are exactly where platform branching first pollutes business code: `wx.setStorageSync` or `localStorage`? `wx.navigateTo` or `history.pushState`? Proteus's answer is one contract `PlatformAPI` plus one factory `createPlatformAPI` (`@proteus-vue/api`): the business layer depends only on the type contract and the factory, and **no bare `wx.` / `window.` calls appear**.

> **Four domains unified: request / storage / router / ui.**
> Platform detection is contained inside the factory; target differences are an implementation detail of the adapter, and the business stays unaware.

## PlatformAPI contract

The contract is defined in `@proteus-vue/types` (`platform-api.ts`); the implementation belongs to `@proteus-vue/api` — a single source of truth for both types and runtime:

```ts
interface PlatformAPI {
  request: <T = unknown>(config: RequestConfig) => Promise<RequestResponse<T>>
  storage: StorageAPI // get / set / remove / clear (synchronous form; the least common denominator)
  router: RouterAPI   // push / replace / switchTab / reLaunch / back
  ui: UIAPI           // showToast / showLoading / hideLoading / showModal / showActionSheet
}
```

`RouterAPI` aligns with WeChat semantics (`push` corresponds to `navigateTo`, `replace` to `redirectTo`), and `showModal` / `showActionSheet` align with WeChat's high-frequency fields, with results uniformly promisified (`ModalResult { confirm, cancel }` / `ActionSheetResult { tapIndex }`; cancelling yields `tapIndex = -1`).

## Adapters per target

Inside `createPlatformAPI()`, detection runs automatically with a **wx-first** rule (`globalThis.wx` present and storage/navigation/UI methods existing), and each domain has its own adaptation path:

| Domain | wx target (Mini Program / Skyline) | Web | Node / SSR fallback |
|---|---|---|---|
| storage | the `wx.setStorageSync` family | `localStorage` (JSON serialization round trip) | in-memory Map |
| router | `navigateTo` / `redirectTo` / `switchTab` / `reLaunch` / `navigateBack` | `history.pushState` + `popstate` (`switchTab` / `reLaunch` map to replace; tab semantics are handled by the routing layer) | —— |
| ui | `wx.showToast` / `showLoading` / `showModal` / `showActionSheet` | DOM toast / DOM modal / action menu (inline styles, zero CSS dependencies) | `console` fallback when there is no `document` (test / SSR safe) |
| request | `wx.request` | `fetch` (AbortController timeout, 15s by default) | same path as Web |

Honest boundary: **the runtime currently covers the wx and web targets**. The App target in api-plan's three-target matrix (native HTTP / native navigation / a native login SDK) is a planned slot at the L2 adapter layer; once wired in, business code changes not at all — exactly the payoff of leading with the contract.

## Business code with zero platform branching

The same business code walks each target's own native implementation (real usage sharing its source with `tests/platform-api.test.ts`):

```ts
import { createPlatformAPI } from '@proteus-vue/api'

const api = createPlatformAPI()

// storage: wx.setStorageSync on the wx target, localStorage on Web
api.storage.set('cart', { items: [1, 2] })
const cart = api.storage.get<{ items: number[] }>('cart')

// router: wx.navigateTo({ url: '/pages/user?id=7' }) on the wx target; pushState on Web
api.router.push('/pages/user', { id: '7' })

// ui: a native dialog on the wx target, a DOM dialog on Web — same signature, same return value
const { confirm } = await api.ui.showModal({ title: 'Confirm', content: 'Delete?' })

// request: forwarded to the platform request adapter (wx.request / fetch auto-detected by default)
const res = await api.request<{ ok: boolean }>({ url: '/api/submit', method: 'POST', data: cart })
if (confirm && res.data.ok) api.ui.showToast('Submitted')
```

## request forwarding and injection

The `request` domain does no business processing; it forwards `RequestConfig` as-is to `IRequestAdapter`. By default it auto-detects (`createRequestAdapter`: `wx` present → `wx.request`, otherwise `fetch`); a custom adapter can also be injected, so mock / gateway / record-replay switch with a single change:

```ts
import { createPlatformAPI } from '@proteus-vue/api'
import type { IRequestAdapter, RequestConfig, RequestResponse } from '@proteus-vue/types'

const replay: IRequestAdapter = {
  name: 'web',
  request: async <T>(config: RequestConfig): Promise<RequestResponse<T>> => ({
    data: { echoed: config.url } as T,
    status: 200,
    headers: {},
    config,
  }),
}

const api = createPlatformAPI(replay) // inject to replace; the business stays unaware
const res = await api.request<{ echoed: string }>({ url: '/ping', method: 'GET' })
```

Unit tests can therefore run entirely in Node, fully detached from the `wx` global — one of api-plan's acceptance criteria is precisely "grep the business layer and find no `wx.` `fetch(` `localStorage.`".

## Relationship to the semantic primitives (G-31/32)

The platform API and the semantic primitives are two faces of the same goal:

| Facet | Form | Coverage |
|---|---|---|
| Imperative (this page) | method calls over the four domains of `createPlatformAPI()` | the high-frequency domains: request / storage / router / ui |
| Declarative (G-31/32) | `p-*` semantic components + the 136-primitive SSOT + 50 Capability Hooks | layout / UI / device / system / communication / extension |

The dividing rule: what carries clear UI semantics goes through `p-*` components (compiled into `ComponentIR` and mapped by the render backend); imperative actions go through PlatformAPI / `useXxx` Hooks. Every hook on the capability layer (G-32: `useLocation` / `useNetwork` / `useBattery`…) returns `Promise<Result<T>>` — when the platform does not support it, it returns `Err('<cap>.unsupported')` instead of throwing, in line with the degradation semantics of the [Capability system](/docs/18-capability-system). Platform-exclusive capabilities (Bluetooth, biometric authentication, etc.) are **not stuffed into PlatformAPI**; they are declared through the capability system.

## Next steps

- [Capability system](/docs/18-capability-system): declaration, probing, and degradation of platform-exclusive capabilities
- [State management](/docs/15-state-management): how Pinia and the Storage adapter cooperate
- [Conformance](/docs/framework/29-conformance): machine verification of the platform contract
