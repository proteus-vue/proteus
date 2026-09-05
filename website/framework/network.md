---
title: 网络
order: 30
group: 基础能力
---

# 网络

跨端网络请求有两层：**平台桥**（`useFetch`——平台 request 能力归一）与**策略层**（`createRequestEngineering`——缓存/去重/队列，纯函数端无关）。业务按需选层。

## 终端落地进度

| 端 | 状态 | 桥实现说明 |
|---|---|---|
| 微信小程序 | ✅ | wx.request（wxBridge.request） |
| Web SPA | ✅ | fetch（webBridge.request——webBridge 已实现） |
| Headless（SSR / 测试） | ✅ | mock 桥注入 |
| iOS / Android / 鸿蒙 | 🟡 | 端原型映射——原生网络栈桥待接线 |
| Flutter 混合 | 🟡 | 同一 JS 逻辑层——桥待接 |
| 快应用 | ⬜ | 端未开始 |

> 策略层（R1-R4）是注入式纯函数：只要传入任意端的 client（RequestExecutor），策略即在对应端全量生效。端架构对照见 [端与成熟度](/docs/framework/ends-matrix)。

## 平台桥：useFetch（迁移入口）

```ts
// 迁移目标：wx.request → await useFetch(url)
const res = await useFetch('/api/player')
if (res.ok) console.log(res.data)
```

- 双端桥（当前落地）：小程序 `wx.request` / Web `fetch`——同一签名；其余端随桥接线逐个启用
- 桥缺 request 能力 → `Err('fetch.unsupported')` 非抛异常（G-32.3）

## 策略层：createRequestEngineering（R1-R4）

注入式第五工厂（client + reactivity + cache + concurrency）：

```ts
const req = createRequestEngineering({ client, reactivity, cache })

// R1 request：TTL 缓存 + in-flight 去重 + 可选排队
const r = await req.request({ method: 'GET', url: '/api/list', ttl: 30_000 })

// R2 useQuery：SWR 语义（缓存命中即用 + refresh/mutate/invalidate）
const q = req.useQuery({ url: '/api/list' })
q.refresh()      // 强制刷新
q.mutate(next)   // 乐观写

// R3 enqueue：FIFO 并发上限 + 失败隔离
// R4 runOnce：同 key 并发合并
```

## 双层关系

`useFetch` 是桥的裸版；接策略层时用 `createCapabilityRequestClient(bridge)` 把能力桥变成 RequestExecutor——**升级换入口不换桥**（G-31 B7 收口）。

## 下一步

- [存储](/docs/framework/storage)
