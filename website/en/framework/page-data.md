---
title: Data passing between pages
order: 35
group: 数据与状态
---

# Data passing between pages

There are three paths for passing data between pages — pick by the value's data lifecycle:

## 1. Navigation parameters (query / params) — one-off value passing

```ts
const router = createRouter(routes, { ... })

// named route + type safety: the params type is matched automatically via RouteParamsByName
await router.push({ name: 'user-profile', query: { id: '7' } })

// path + query (auto-encoded; params and query are merged into the query string)
await router.push({ path: 'pages/cart', query: { id: '7' } })
router.back()
```

- `query` is joined into a query string by `buildUrl` (auto-encoded)
- Router Inspector / the panel's route view shows navigation with parameters (`?id=1`) — navigation stays observable

## 2. Cross-page shared state — the Pinia store

Data that must survive across pages (login state, shopping cart) goes through a store: a single `stores/player.ts` — one `.ts` source shared across all four targets (see [State factories across targets](/docs/framework/state-factories)).

## 3. Page-stack relationships — communication between pages

The Mini Program page stack inherently has a "previous page → next page" relationship. Proteus keeps the parent chain at compile time (Skyline MPA flattens pages + `meta.__parent`), and data is passed at runtime through a combination of events and stores; scoped-slot-like "child → parent data" cases are replaced by receiving the data via props and sending it back with `triggerEvent` (a platform limitation — the compiler hints at the replacement pattern).

## Choosing a path

| Data | Passing method |
|---|---|
| One-off display on the target page (id, source) | navigation query |
| Shared by multiple pages, needs reactivity | Pinia store |
| Return value from the page stack | event callback + store relay |

## Next steps

- [Cross-target state sync](/docs/framework/state-sync)
