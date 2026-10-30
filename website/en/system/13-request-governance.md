---
title: Request Governance
order: 13
group: Flexible System
---

# Request Governance

**When four teams in one app share a single network stack, can the platform answer: who connected where, who exhausted the quota, and did that order actually go through?**

Mainstream request libraries optimize "write fewer lines of business code". This layer optimizes a different problem — the one a platform team faces when payments, catalog, support and live-streaming all egress through the same network stack.

Mainstream libraries cannot answer those three questions. Not because they are badly built, but because those questions were never in their design space.

> **Product page: [Phylax Request Governance](/phylax)** (immersive product page with the three-lane gate and machine-read numbers).
> **Start coding:** [Cookbook](/docs/system/14-request-quickstart).
> This page explains **why it is designed this way** — a companion to those two, not the front door.

---

## 1. One timeout, three fates

A failed payment and a failed product listing look identical in most request libraries: one `error`, one `catch`.

But for a payment, a timeout **is not a failure** — it is a state that must be reconciled. The request may have reached the server, the order may exist, the money may already be gone. Treating it as a failure and retrying is how you charge someone twice.

So this layer splits results into three states:

```
              ┌──────────────────────────────────────────────┐
  request ───→│  success   definitely succeeded  → proceed    │
              │  failed    definitely failed     → retry safe │
              │  unknown   result unknown        → reconcile  │
              └──────────────────────────────────────────────┘
                        ▲
                        └── when we cannot tell, we err on unknown
```

**The trade-off**: better to make the business reconcile once more than to let it assume failure and resend.

Everything else follows from this — idempotency keys, retry gates, optimistic rollback, WebSocket audit. All of it exists so that `unknown` is **reliably reachable and never misread**.

```ts
const r = await client.post('/order', data)
if (r.ok) return done()
if (r.outcome === 'failed') return retryWithIdempotencyKey()
// unknown: do not retry, reconcile
await refreshOrders()
```

---

## 2. Where the capability lives

Three layers, split on purpose:

```
  @proteus-vue/request     ← your code lives here
  useQuery / useMutation / useRequest
         │  only: reactive container · race adjudication · unmount cancel
         ▼
  @proteus-vue/api/request ← policy kernel (platform-neutral · zero Vue)
  tri-state · idempotency · breaker · offline queue · audit · redaction · quota
         │
         ▼
  useFetch → bridge.request → OkHttp / URLSession / RCP
```

**Why reactivity is a separate layer**: the kernel must run in Mini Program logic layers, Node, and any non-Vue environment — embedding Vue would kill that. Template re-rendering is Vue-specific. So: two packages, Vue on top, kernel beneath.

Same pattern as `@proteus-vue/pinia-sync`: optional sub-package, `vue` as peer dependency, zero cost if unused.

---

## 3. Three composables, one line each

| | Scenario | Auto-fire | Optimistic update |
|---|---|---|---|
| `useQuery(url)` | **Reads** that load on page enter | ✅ | — |
| `useMutation(url)` | **Writes** triggered by user action | ❌ | ✅ |
| `useRequest()` | **Reads** triggered by user action | ❌ | — |

**Rule of thumb**: reads use Query, writes use Mutation, user-triggered reads use Request.

Choosing wrong costs real work: `useQuery` for "search on click" fires an unwanted request on page enter; `useRequest` for a list leaves the page blank and users think there is no data.

---

## 4. Three things the kernel does not do — and frontends always trip on

### 4.1 Failure must not clear data

The most common hand-written request state sets `data.value = null` somewhere in the error branch ("clean up the state"). Then a failed refresh takes the page from **having content** to **blank**. The user sees "the data is gone", not "the refresh failed".

→ This layer: **failure keeps the last successful data**, sets only `error` and `outcome`.

### 4.2 Stale responses must not overwrite fresh ones

```
User clicks "price ↑" → request A
User clicks "price ↓" → request B     (A still in flight)
B returns → UI shows descending
A returns → UI shows ascending        ← filter says descending, data is ascending
```

This is nearly impossible to reproduce (needs a specific network delay) but always happens in production. Almost nobody adds sequence adjudication by hand.

→ Built in: every dispatch increments `seq`; only the latest settlement is adopted.

### 4.3 Callbacks after unmount

On fast route switches, a previous page's response mutates destroyed component state. At best a warning, at worst a leak.

→ This layer hooks `onScopeDispose` and cancels in-flight requests on unmount.

---

## 5. Tri-state rollback for optimistic updates

```
  submit
   ├─ success → overwrite with server response (server is authoritative)
   ├─ failed  → roll back (definitely did not take effect)
   └─ unknown → ★ keep the optimistic value, do NOT roll back
                 because it may have succeeded
```

**Not rolling back on `unknown` is the most counter-intuitive and most important rule here.**

Rollback looks "safe" (return to pre-submit), but its premise is "the submit did not succeed" — and `unknown` means exactly that premise **does not hold**. Rolling back visually undoes a write that may have succeeded. The user sees "failed", the database already changed, and they submit again: a duplicate write.

So on `unknown` the UI must show "result pending", not success and not failure.

---

## 6. Why WebSocket needs the same rules

Hardening only the HTTP layer is the most common vulnerability shape in the industry.

The platform configures a domain allowlist, audit, per-business quota — all on HTTP. The business switches one API call, `useWebSocket`, and bypasses all of it. And in the audit log a WebSocket looks like "just a connection" — cleaner than a pile of POSTs, yet it can send and receive indefinitely. **It is the ideal shape for quietly exfiltrating data.**

So the policy chain applies to both channels:

| | HTTP | WebSocket |
|---|---|---|
| Domain allowlist | ✅ | ✅ same implementation |
| Business isolation (bizId) | ✅ | ✅ |
| Audit | ✅ | ✅ open and close, with lifetime and **counts** |
| Quota | ✅ | ✅ held until disconnect |
| Message content in logs | — | ❌ **never** |

**Not logging message content is deliberate**: writing payloads to logs copies data to a second location — and logs are collected, exported and retained longer than business data. Audit answers "who, when, where, did it work", not "what was sent".

**Quota release point is easy to get wrong**: release when the connection **actually closes**, not when `open()` returns. Otherwise a normal live-streaming connection holds its slot as "in flight" forever, and after a few hours no new page can connect.

---

## 7. Deduplication leaks across tenants

Deduplication is standard: two identical in-flight requests collapse into one. The question is what "identical" means.

If the key is only `method + url + body`:

```
Tenant A: GET /api/me  Authorization: Bearer tenant-a
Tenant B: GET /api/me  Authorization: Bearer tenant-b
                       ↑ same key → merged → A receives B's profile
```

Conversely, putting **every** header in the key fails too: `x-request-id` and `traceparent` change per request, so deduplication would **never hit** — the feature would be off in the name of safety.

→ Include only headers that change the response: identity, tenant, idempotency key, content negotiation. **Correctness first, but not to the point of breaking the feature.**

**Second layer**: when request interceptors are configured, deduplication is **skipped entirely**. Interceptors run after the key is computed and can rewrite url and headers — the key cannot represent final identity. Lower hit rate, but no cross-tenant leak. The result says why.

---

## 8. Retries will not resend your order

```ts
const r = await client.post('/order', data, { retry: { attempts: 3 } })
```

Most libraries retry three times. If the first attempt actually succeeded and only the response timed out, the user just placed four orders.

In HTTP semantics only idempotent methods (GET / HEAD / OPTIONS / PUT / DELETE / TRACE) may be retried unconditionally. POST is not one of them.

→ POST retries are **refused by default**, with the reason in the result (`retryRefused`).

To retry a POST, supply an idempotency key — the server deduplicates on it. The facade passes it through automatically.

---

## 9. What you see when something goes wrong

Half the value of a request layer is in the failure path — what it can tell a human at 2am.

Every request produces an audit entry: business id, host, tri-state outcome, duration, attempt count, error code. URLs are redacted — paths keep two segments, the query string is dropped, because that is where tokens hide.

**No request bodies, and no WebSocket message content.**

---

## 10. Boundaries

- **No payment SDK integration** (WeChat Pay / Alipay / Apple IAP). This layer owns reliability semantics only.
- **No schema / OpenAPI code generation.** That infrastructure does not exist here.
- **Circuit breaker and quota are in-process.** Cross-process sharing requires host support.
- **Redaction is field-name matching, not content detection.** A token in an unlisted custom header will leak.
- **Whether code handles `unknown` correctly is the business's responsibility.** This layer keeps the state honest; it cannot decide for you.

That last one matters most: the tri-state model exists to make the need to reconcile **visible**, not to reconcile on the business's behalf. A business that treats `unknown` as `failed` will still double-charge with the best library underneath.

---

## Related

- [Request Layer Cookbook](/docs/system/14-request-quickstart) — zero to first request, with paging/errors/cancellation/troubleshooting
- [Capabilities](/docs/system/08-capabilities) — how the host capabilities this layer depends on are graded per platform
- [`useFetch`](/docs/capability/fetch) — the underlying single-request facade
