---
title: Network
order: 30
group: 基础能力
ends: network
---

# Network

Cross-end network requests live on two layers: the **platform bridge** (`useFetch` — normalizing the platform's request capability) and the **strategy layer** (`createRequestEngineering` — cache / dedupe / queue as pure functions with no end coupling). Business picks the layer it needs. (Bridge rollout status per end is in the “Terminal rollout” table above — the strategy layer is an injectable pure function: pass in any end's client and the strategies take full effect on that end.)

## The platform bridge: `useFetch` (migration entry)

```ts
// Migration target: wx.request → await useFetch(url)
const res = await useFetch('/api/player')
if (res.ok) console.log(res.data)
```

- Two-end bridge (currently shipped): Mini Program `wx.request` / Web `fetch` — the same signature; the remaining ends come online one by one as their bridge lines are wired
- A bridge missing the request capability returns `Err('fetch.unsupported')` instead of throwing (G-32.3)

## The strategy layer: `createRequestEngineering` (R1-R4)

The fifth injectable factory (client + reactivity + cache + concurrency):

```ts
const req = createRequestEngineering({ client, reactivity, cache })

// R1 request: TTL cache + in-flight dedupe + optional queueing
const r = await req.request({ method: 'GET', url: '/api/list', ttl: 30_000 })

// R2 useQuery: SWR semantics (serve on cache hit + refresh/mutate/invalidate)
const q = req.useQuery({ url: '/api/list' })
q.refresh()      // force refresh
q.mutate(next)   // optimistic write

// R3 enqueue: FIFO concurrency cap + failure isolation
// R4 runOnce: merge same-key concurrent calls
```

## How the two layers relate

`useFetch` is the bare version of the bridge; when wiring in the strategy layer, use `createCapabilityRequestClient(bridge)` to turn the capability bridge into a `RequestExecutor` — **upgrade by swapping the entry point, not the bridge** (G-31 B7 convergence).

## Next steps

- [Storage](/docs/framework/storage)
