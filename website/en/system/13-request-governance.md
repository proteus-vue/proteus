---
title: Request Governance
order: 13
group: Flexible System
---

# Request Governance

**When four teams in one app share a single network stack, can the platform still answer: who connected where, who exhausted the quota, and did that order actually go through?**

Proteus's request layer is not "another axios". Mainstream request libraries optimize for **writing fewer lines of business code**. We optimize a different problem — the one a platform team faces when payments, catalog, support and live-streaming all egress through the same network stack.

Mainstream libraries cannot answer those three questions. Not because they are badly built, but because those questions were never in their design space.

## One timeout, three fates

A failed payment and a failed product listing look identical in most request libraries: one `error`, one `catch`.

But for a payment, a timeout **is not a failure** — it is a state that must be reconciled. The request may have reached the server, the order may exist, the money may already be gone. Treating it as a failure and retrying is how you charge someone twice.

Proteus splits the result into three states instead of two:

| Result | Meaning | What the business should do |
|---|---|---|
| `success` | Definitely succeeded | Proceed |
| `failed` | Definitely failed (never processed) | Safe to retry |
| **`unknown`** | **Result unknown** | **Reconcile — do not retry** |

When we cannot tell, we conservatively classify as `unknown`. Better to make the business reconcile once more than to let it assume failure and resend. Everything else in this layer follows from that starting point.

## Why WebSocket needs the same rules

Hardening only the HTTP layer is the most common vulnerability shape in the industry.

The platform configures a domain allowlist, an audit trail, per-business quotas — all on HTTP. The business switches one API call, `useWebSocket`, and bypasses all of it. And in the audit log a WebSocket looks like "just a connection" — cleaner than a pile of POSTs, yet it is a persistent bidirectional channel that can send and receive indefinitely. **It is the ideal shape for quietly exfiltrating data.**

So the policy chain here applies to both channels at once:

- **Domain allowlist** — configured once, enforced on both channels; switching APIs cannot escape it
- **Audit** — who opened a connection, to which host, how long it lived, how many messages — but **never the message content**
- **Quota** — allocated per business; a long-lived connection holds its slot until it actually closes

That last point is easy to get wrong: the quota must be released when the connection **closes**, not when `open()` returns. Otherwise a normal live-streaming connection holds its slot as "in flight" forever, and after a few hours no new page can connect.

## Deduplication leaks across tenants

Deduplication is standard request-library optimization: two identical in-flight requests collapse into one.

The question is what "identical" means. If the key is only `method + url + body`, then:

> Tenant A and Tenant B both call `GET /api/me`, each with its own `Authorization` header.
> The keys match. The requests merge. **A receives B's user profile.**

This is not hypothetical. The old implementation's dedupe key was exactly that, and the comment explained it: "auth headers are added by an interceptor, so the same resource should be shared." True **within a single auth domain** — and a data leak the moment multi-tenancy enters.

The fix is not "put every header in the key" — `x-request-id` and `traceparent` change on every request, and including them would make deduplication never hit, turning the feature off in the name of safety. We include only headers **that change the response**: identity, tenant, idempotency key, content negotiation.

Likewise, when request interceptors are configured, deduplication is **skipped entirely**. An interceptor can rewrite the URL and headers, and it runs after the key is computed — so the key cannot represent the final request identity. This lowers the hit rate, but it cannot leak across tenants. When skipped, the result says so explicitly, so nobody concludes "dedupe is broken".

## Retries will not resend your order

```ts
// The business writes this line
const r = await client.post('/order', data, { retry: { attempts: 3 } })
```

Most libraries retry three times here. If the first attempt actually succeeded and only the response timed out, the user just placed four orders.

In HTTP semantics only idempotent methods (GET / HEAD / OPTIONS / PUT / DELETE / TRACE) may be retried unconditionally. POST is not one of them. So the default here is: **refuse to retry**, and say why in the result.

Retrying a POST requires one condition: an idempotency key, so the server can deduplicate. The facade passes it through automatically when a key is present; calling `useFetch` directly requires opening the door explicitly.

When a retry is refused, the result carries `retryRefused` with the reason. That field is easy to add and easy to skip — but without it the business only sees `attempts: 1` and concludes the library is broken, sending everyone down the wrong path.

## Jitter must actually jitter

Retry backoff jitter exists so that clients which failed together do not all hammer a recovering service in the same millisecond.

If jitter is deterministic — alternating sign by attempt number, say — every client computes **exactly the same** backoff. They still retry in lockstep. The feature looks present and does nothing.

The jitter here is genuinely random.

## What you see when something goes wrong

Half the value of a request layer is in the failure path — what it can tell a human at 2am.

Every request, successful or not, produces an audit entry: business id, host, tri-state outcome, duration, attempt count, error code. URLs are redacted — paths keep only the first two segments, the query string is dropped entirely, because that is where tokens usually hide.

WebSocket audit entries have a different shape (a long-lived connection has no HTTP status, but does have open-to-close duration and a close code), but the redaction rules are the same implementation.

**No request bodies, and no WebSocket message content.** That is deliberate: writing payloads to logs copies the data to a second location — and logs are collected, exported and retained longer than business data. An audit answers "who, when, where, did it work", not "what was sent".

## Boundaries

Being explicit about what this layer does not do is more useful than listing what it does.

- **No payment SDK integration.** This layer owns reliability semantics only; WeChat Pay / Alipay / Apple IAP native integration is a separate concern.
- **No schema / OpenAPI code generation.** That infrastructure does not exist in this repository.
- **Circuit breaker and quota are in-process.** Cross-process sharing requires host support, which is not provided.
- **Redaction is field-name matching, not content detection.** A token placed in a custom header that nobody added to the blacklist will leak.
- **Whether code handles `unknown` correctly is the business's responsibility.** This layer guarantees the state is honest; it cannot guarantee the business acts on it.

That last one matters most: the tri-state model exists to make the need to reconcile **visible**, not to reconcile on the business's behalf. A business that treats `unknown` as `failed` will still double-charge with the best library in the world underneath.

## Related

- [Capabilities](/docs/system/capabilities) — how the host capabilities this layer depends on (OkHttp / URLSession / RCP) are graded per platform
- [`useFetch`](/docs/capability/fetch) — the single-request facade this layer is built on
