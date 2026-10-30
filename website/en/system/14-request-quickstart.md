---
title: Request Layer Cookbook
order: 14
group: Flexible System
---

# Request Layer Cookbook

From zero to your first working request. Each section stands alone — jump to whatever you need.

This is the `@proteus-vue/request` guide (the Vue product layer). For **why it is designed this way**, see [Request Governance](/docs/system/13-request-governance).

## 1. Install and the minimum that works

```bash
npm i @proteus-vue/request @proteus-vue/api
```

`vue` is a peer dependency (you already have it).

**Three steps to a running request:**

```ts
// ① main.ts — configure once, one instance for the whole app
import { provideRequestClient } from '@proteus-vue/request'

provideRequestClient({ baseURL: import.meta.env.VITE_API })
```

```vue
<!-- ② Use it directly in a page -->
<script setup lang="ts">
import { useQuery } from '@proteus-vue/request'
const users = useQuery<User[]>('/api/users')
</script>

<template>
  <div v-if="users.loading.value">Loading…</div>
  <div v-else-if="users.error.value">{{ users.error.value.message }}</div>
  <ul v-else>
    <li v-for="u in users.data.value" :key="u.id">{{ u.name }}</li>
  </ul>
</template>
```

The request is already running. Everything below is reference, not required reading.

> **Why `.value`?** `useQuery` returns Vue refs. Templates auto-unwrap top-level refs returned from setup, but **not properties of an object** — so `users.data` is a ref object and you read `.value`. Prefer destructuring?

```ts
const { data, loading, error, outcome, refresh } = useQuery<User[]>('/api/users')
```

## 2. Pick the right composable

| What you're doing | Use | Why |
|---|---|---|
| Load a list/detail on page enter | `useQuery(url)` | Auto-fires + race adjudication |
| Query only when the user clicks search | `useRequest()` | No auto-fire, url can vary |
| Submit a form / delete / change state | `useMutation(url)` | Optimistic update + tri-state rollback |
| Send a request outside a component | `useRequestClient()` | Grab the instance, no lifecycle |

**Rule of thumb**: reads use Query, writes use Mutation, user-triggered reads use Request.

## 3. `useQuery`: reads that load on page enter

```ts
const list = useQuery<Post[]>('/api/posts', {
  request: { params: { page: 1, size: 20 } },
  onSuccess: (data) => console.log('got', data.length),
  onError: (err, outcome) => console.warn(err.code, outcome),
})
```

| Member | Type | Notes |
|---|---|---|
| `data` | `ref<T \| undefined>` | **Keeps the last successful value on failure** |
| `loading` | `ref<boolean>` | In flight |
| `error` | `ref<{ code, message } \| undefined>` | Failure info |
| `outcome` | `ref<'success' \| 'failed' \| 'unknown' \| undefined>` | Tri-state (see §5) |
| `refresh()` | `() => Promise<Result>` | Re-fetch |
| `mutate(v)` | `(v: T) => void` | Local write, no request |
| `abort(reason?)` | `(s?: string) => void` | Cancel in-flight |

### When not to auto-fire

```ts
const detail = useQuery<Detail>(`/api/items/${id}`, { immediate: false })
watch(id, () => detail.refresh())
```

## 4. `useMutation`: writes

```ts
const save = useMutation<Todo, { title: string }>('/api/todos', {
  optimistic: (v) => ({ id: 'tmp', title: v.title, done: false }),
  rollback: (previous) => previous,
  onSuccess: (data) => list.refresh(),
  onError: (err, outcome) => {
    if (outcome === 'unknown') toast('Result unknown — refresh to confirm')
    else toast(`Save failed: ${err.message}`)
  },
})

await save.mutate({ title: 'Buy milk' })
```

### Dynamic url

```ts
const remove = useMutation<void, { id: number }>((v) => `/api/todos/${v.id}`, { method: 'DELETE' })
await remove.mutate({ id: 42 })
```

### Tri-state rollback rules

| Outcome | Optimistic value | UI should |
|---|---|---|
| `success` | Overwritten by server response | Show success |
| `failed` | **Rolled back** | Show failure, retry is safe |
| **`unknown`** | **Kept (not rolled back)** | **"Result unknown — please confirm"** |

**Why `unknown` is not rolled back**: it means the request may have reached the server and taken effect, with only the response lost. Rolling back would visually undo a write that **may have succeeded** — the user sees "failed", the database already changed, and they submit again. That is a duplicate write.

## 5. The tri-state `outcome`

```
success  ── definitely succeeded
failed   ── definitely failed (never processed), safe to retry
unknown  ── result unknown (may have taken effect), must reconcile
```

Typical sources of `unknown`: timeout, connection drop, app backgrounded mid-request.

```ts
const r = await client.post('/order', data)
if (r.ok) { /* done */ }
else if (r.outcome === 'failed') retryWithIdempotencyKey()
else {
  // unknown — never retry
  await refreshOrderList()
  routeTo('/orders?pending=1')
}
```

## 6. Error handling

```ts
{ code: 'fetch.timeout', message: 'Request timed out (15000ms)' }
```

`code` is machine-readable — branch on it. `message` is for humans; **never** branch on it.

| code | Meaning | What to do |
|---|---|---|
| `fetch.timeout` | Single-attempt timeout | Check `outcome`: reconcile if `unknown`, retry if `failed` |
| `fetch.unknown` | Result unknown | Same |
| `fetch.unsupported` | Platform lacks the capability | Degrade or inform |
| `fetch.tooLarge` | Response body limit | Use streaming / save-to-file |
| `fetch.deadline` | Total budget exhausted | Give a longer deadline or accept failure |
| `request.forbidden` | Domain not allowlisted | Check platform config |
| `websocket.quotaExceeded` | Business quota full | Check for connection leaks |

## 7. Auth and common headers

```ts
provideRequestClient({
  baseURL,
  auth: createAuth({ /* your token manager */ }),
  headers: { 'X-Client': 'web' },
})
```

Per-request override:

```ts
useQuery('/api/me', { request: { headers: { 'X-Request-Domain': 'vip' } } })
```

Credentials never reach logs — redaction happens in the transport layer (headers/query/body, on by default). You also never see the raw token; it comes from `auth`.

## 8. Interceptors: one place to add and to settle

The most-used extension point in this layer. Two kinds, opposite directions:

| | When it runs | Typical use |
|---|---|---|
| **Request interceptor** | **Before** the request leaves (registration order) | Add common headers, sign, instrument, rewrite by host |
| **Response interceptor** | **After** the response arrives (**reverse** order) | Central error handling, refresh token on 401, unwrap envelope |

```ts
provideRequestClient({
  baseURL: import.meta.env.VITE_API,

  interceptors: {
    request: [
      // ① Tag every request with a client header
      (ctx) => ({
        url: ctx.url,
        config: {
          ...ctx.config,
          headers: { ...(ctx.config.headers ?? {}), 'X-Client': 'web' },
        },
      }),
    ],
    response: [
      // ② Central logging — observe, do not alter the result
      (res, ctx) => {
        if (!res.ok) console.warn('[api]', ctx.url, res.error.code)
        return res
      },
    ],
  },
})
```

### Short-circuit: a request interceptor returning `null`

Returning `null` means "do not send this request". The result carries `fetch.intercepted` —
the business can tell it was blocked on purpose, not an ambiguous failure.

```ts
interceptors: {
  request: [
    (ctx) => {
      if (!navigator.onLine && ctx.url.includes('/pay')) return null
      return { url: ctx.url, config: ctx.config }
    },
  ],
}
```

### The order is an onion, not a queue

Request interceptors run in **registration order**; response interceptors run in **reverse order** —
the last one in is the first one to see the response.

```ts
interceptors: {
  request:  [A, B],   // runs A → B
  response: [X, Y],   // runs Y → X
}
```

### ⚠️ One trade-off you must know: request interceptors disable dedupe

A request interceptor can rewrite the URL and headers, and it runs **after** the dedupe key is computed —
so the key can no longer represent the final request identity. Merging anyway risks cross-tenant leakage
(A receiving B's response).

So whenever request interceptors are configured, deduplication is **skipped entirely**, and the reason is
written into `meta.dedupeSkipped`:

```ts
if (r.meta?.dedupeSkipped) {
  // Not a misconfiguration — it is the deliberate "dedupe is unsafe with interceptors" decision
  console.info('dedupe skipped:', r.meta.dedupeSkipped.reason)
}
```

**Correctness over efficiency**: one fewer merge beats any chance of cross-tenant leakage.

### Do not pass both `hooks` and `interceptors`

```ts
// ❌ throws request.interceptors.conflict
createRequestClient({
  hooks: myHooks,
  interceptors: { request: [fn] },
})
```

Why: `hooks` is an **already-constructed** pipeline; this layer cannot reach into it to inject interceptors.
(The old behaviour was to **silently ignore** them — zero interceptor calls, no warning. It now throws.)

Two ways out:

```ts
// ① Do not pass hooks — let the client build its own (recommended)
createRequestClient({ interceptors: { request: [fn] } })

// ② Build hooks yourself and put interceptors in the fetch options
const hooks = createCapabilityHooks(undefined, {
  fetch: { requestInterceptors: [fn] },
})
createRequestClient({ hooks })
```

## 9. Retries and idempotency (read this before writing POSTs)

```ts
provideRequestClient({
  retry: { attempts: 2, backoff: 'exponential', respectRetryAfter: true },
})
```

By default POST is **not** retried — only idempotent methods may be retried unconditionally.

To allow it, supply an idempotency key:

```ts
useMutation('/api/order', {
  request: { idempotencyKey: orderDraftId },
})
```

The key must be **stable**: the same logical request reuses the same value across retries. Use a draft id or a client-generated uuid — never regenerate per attempt.

## 10. Offline queue

```ts
provideRequestClient({
  offlineQueue: { enabled: true, maxEntries: 100, autoFlush: true, store: myPersistentStore },
  onNetworkStatusChange: (cb) => {
    const on = () => cb({ isConnected: navigator.onLine })
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  },
})
```

Only idempotent requests enter the queue (GET/PUT/DELETE, or POST with a key). Non-idempotent requests without a key are rejected — replaying them would duplicate the write.

## 11. Cancellation

```ts
const q = useQuery('/api/slow')
q.abort('navigated away')
```

Components cancel automatically on unmount — you don't need to manage it.

## 12. Known boundaries

- **No reactive-url auto-refetch.** The url is evaluated at creation; changing `page`/`keyword` needs your own `watch` + `refresh`. A known boundary, not a bug.
- **No SWR background-refresh scheduler.** That needs timers plus visibility awareness — a separate capability. The kernel has HTTP-level RFC 5861 SWR (cache semantics), which is not the same thing.
- **No global error toast.** Decide in your `onError`.
- **SSR must call provide explicitly.** Without it you get a process-wide fallback singleton, and quota/breaker counters accumulate across requests.
- **What to do after `unknown` is the business's responsibility.** This layer keeps the state honest; it cannot decide whether to reconcile.

## 13. Troubleshooting checklist

1. **Did `loading` go back to `false`?** Stuck `true` means the request never settled (network hang, or the platform lacks support).
2. **What is `outcome`?** `undefined` means it never fired (`immediate: false` without `refresh`); `unknown` means the result is uncertain — reconcile, don't retry.
3. **What is `error.code`?** See §6. `fetch.unsupported` is a platform issue, not your code.
4. **Did you call `provideRequestClient`?** Without it you're on the fallback singleton (no baseURL).
5. **Is baseURL joined correctly?** `/api` + `api/users` becomes `/api/api/users`.

## Related

- [Request Governance](/docs/system/13-request-governance) — design rationale and boundaries
- [`useFetch`](/docs/capability/fetch) — the underlying single-request facade
