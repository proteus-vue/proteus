---
title: 请求层使用手册
order: 14
group: 柔性系统
---

# 请求层使用手册

从零到第一个能跑的请求。每一节都能独立对照，遇到问题可以直接跳到对应小节。

本手册对应 `@proteus-vue/request`（Vue 产品层）。内核的**设计理由**（为什么这样设计、边界在哪）见 [请求治理层](/docs/system/13-request-governance)。

## 一、安装与最小可用

```bash
npm i @proteus-vue/request @proteus-vue/api
```

`vue` 是 peer dependency（你已经有了）。

**三步跑通：**

```ts
// ① main.ts —— 一处配置，全应用共用一份实例
import { provideRequestClient } from '@proteus-vue/request'

provideRequestClient({ baseURL: import.meta.env.VITE_API })
```

```vue
<!-- ② 页面里直接用 -->
<script setup lang="ts">
import { useQuery } from '@proteus-vue/request'
const users = useQuery<User[]>('/api/users')
</script>

<template>
  <div v-if="users.loading.value">加载中…</div>
  <div v-else-if="users.error.value">{{ users.error.value.message }}</div>
  <ul v-else>
    <li v-for="u in users.data.value" :key="u.id">{{ u.name }}</li>
  </ul>
</template>
```

到这一步请求已经在跑了。下面的内容是**按需查阅**，不是必读。

> **为什么 `data.value` 要写 `.value`**：`useQuery` 返回的是 Vue ref。模板里 Vue 会自动解包 `setup` 返回的顶层 ref，但**对象的属性不会自动解包**，所以 `users.data` 是个 ref 对象、要读 `.value`。如果你更习惯解构：

```ts
const { data, loading, error, outcome, refresh } = useQuery<User[]>('/api/users')
// 模板里就可以写 data.value / loading.value
```

## 二、选对 composable

选错是常见的时间浪费，先看这张表：

| 你要做的事 | 用哪个 | 为什么 |
|---|---|---|
| 进页面就加载列表 / 详情 | `useQuery(url)` | 自动发起 + 竞态裁决 |
| 点"搜索"才查 | `useRequest()` | 不自动发起，每次可换 url |
| 提交表单 / 删除 / 改状态 | `useMutation(url)` | 乐观更新 + 三态回滚 |
| 需要在非组件代码里发请求 | 直接 `useRequestClient()` | 拿实例调用，不受生命周期约束 |

**判断口诀**：读用 Query，写用 Mutation，用户点了才发的读用 Request。

## 三、`useQuery`：进页面就拉的读

### 基本用法

```ts
const list = useQuery<Post[]>('/api/posts', {
  request: { params: { page: 1, size: 20 } },   // 透传给内核的请求选项
  onSuccess: (data) => console.log('拿到', data.length, '条'),
  onError: (err, outcome) => console.warn(err.code, outcome),
})
```

### 常用的返回值

| 成员 | 类型 | 说明 |
|---|---|---|
| `data` | `ref<T \| undefined>` | 数据。**失败时保留上一次成功的值** |
| `loading` | `ref<boolean>` | 在飞中 |
| `error` | `ref<{ code, message } \| undefined>` | 失败信息 |
| `outcome` | `ref<'success' \| 'failed' \| 'unknown' \| undefined>` | 三态结局（见第五节） |
| `refresh()` | `() => Promise<Result>` | 重新拉 |
| `mutate(v)` | `(v: T) => void` | 本地改写（不发请求） |
| `abort(reason?)` | `(s?: string) => void` | 取消在飞请求 |

### 什么时候不该自动发起

依赖前面数据才能确定的请求：

```ts
const detail = useQuery<Detail>(`/api/items/${id}`, { immediate: false })
watch(id, () => detail.refresh())
```

或者用计算出的 url + `immediate`：

```ts
const q = computed(() => `/api/items/${id.value}`)
watch(q, (url) => detail.refresh())   // ★ url 变了要自己触发
```

### 分页 / 筛选

```ts
const page = ref(1)
const list = useQuery<Post[]>('/api/posts', {
  immediate: false,
  request: { params: { page: page.value } },
})
watch(page, () => {
  // ★params 在创建时求值，翻页要重建 query 或用下面的写法
})
```

**更稳的写法**：把参数作为 composable 的依赖传进去，让它跟着变：

```ts
const page = ref(1)
const list = useQuery<Post[]>(computed(() => `/api/posts?page=${page.value}`))
```

> `useQuery` 的第一个参数接受 `string`。需要动态参数时，用 `computed` 生成 url 是当前最省事的方式 —— 或者用下面这个模式：把 `refresh` 拉到事件里。

```ts
const list = useQuery<Post[]>('/api/posts', { immediate: false })
async function goPage(n: number) {
  await list.refresh()   // ★注意：refresh 用的是创建时的 url
}
```

**目前没有"响应式 url"的自动重拉**（需要 `watch` 手动接），这是已知的能力边界，见第十一节。

## 四、`useMutation`：写操作

```ts
const save = useMutation<Todo, { title: string }>('/api/todos', {
  optimistic: (v) => ({ id: 'tmp', title: v.title, done: false }),
  rollback: (previous) => previous,
  onSuccess: (data) => list.refresh(),
  onError: (err, outcome) => {
    if (outcome === 'unknown') {
      toast('结果未知，请刷新列表确认')   // ★不要写"保存失败"
    } else {
      toast(`保存失败：${err.message}`)
    }
  },
})

await save.mutate({ title: '买菜' })
```

### 动态 url

```ts
const remove = useMutation<void, { id: number }>((v) => `/api/todos/${v.id}`, {
  method: 'DELETE',
})
await remove.mutate({ id: 42 })
```

### 三态回滚规则（这是最容易出错的点）

| 结局 | 乐观值怎么处理 | 界面应该 |
|---|---|---|
| `success` | 用服务端返回值覆盖 | 显示成功 |
| `failed` | **回滚**到提交前 | 提示失败，可重试 |
| **`unknown`** | **保留**（不回滚） | **提示"结果未知，请确认"** |

**为什么 `unknown` 不回滚**：`unknown` 意味着"请求可能已经到了服务端并生效，只是响应没回来"。回滚等于把一个**可能真成功**的操作在界面上撤销 —— 用户看到"失败了"，实际数据库里已经改了。下一步他会再提交一次，就是重复写入。

## 五、`outcome` 三态：本层最重要的一件事

大多数请求库只有"成功 / 失败"。这一层有三态：

```
success  ── 确定成功
failed   ── 确定失败（请求没被处理），可以重试
unknown  ── 结果未知（可能已生效），必须去确认
```

`unknown` 的典型来源：请求超时、连接中断、App 被切到后台。

**处置原则：**

```ts
const r = await client.post('/order', data)
if (r.ok) { /* 成功 */ }
else if (r.outcome === 'failed') {
  // 确定没下单 ⇒ 可以安全重试（带幂等键）
  retry()
} else {
  // ★unknown ⇒ 绝对不要重试
  await refreshOrderList()          // 去查单
  routeTo('/orders?pending=1')
}
```

**为什么不能当失败处理**：对支付/下单来说，超时后重试就是重复下单。这是整层的设计起点。

## 六、错误处理

### 错误对象长什么样

```ts
{ code: 'fetch.timeout', message: '请求超时（15000ms）' }
```

`code` 是机器码，用它分支；`message` 是给人看的。**不要**拿 `message` 做判断（文案会变）。

### 常见 code

| code | 含义 | 该怎么办 |
|---|---|---|
| `fetch.timeout` | 单轮超时 | 看 `outcome`：`unknown` 就查单，`failed` 才重试 |
| `fetch.unknown` | 结果未知 | 同上 |
| `fetch.unsupported` | 本端没这个能力 | 降级或提示不支持 |
| `fetch.tooLarge` | 响应体超限 | 改用流式 / 落盘 |
| `fetch.deadline` | 总时限耗尽 | 业务层给更长的 deadline，或接受失败 |
| `request.forbidden` | 域名不在白名单 | 检查平台配置 |
| `websocket.quotaExceeded` | 业务配额满了 | 检查是否有连接泄漏 |

### 全局错误处理

没有内建的全局 error toast（那是 UI 决策）。典型接法：

```ts
// 在 provideRequestClient 里挂 trace，统一上报
provideRequestClient({
  baseURL,
  trace: (e) => {
    if (e.phase === 'error') reportToSentry({ code: e.errorCode, url: e.url })
  },
})
```

## 七、认证与公共 header

```ts
provideRequestClient({
  baseURL,
  auth: createAuth({ /* 你的 token 管理 */ }),   // 内核会注入 Authorization
  headers: { 'X-Client': 'web' },                // 每请求默认带
})
```

单请求覆盖：

```ts
useQuery('/api/me', { request: { headers: { 'X-Request-Domain': 'vip' } } })
```

**凭证不会进日志**：内核在通道层做脱敏（header / query / body 三层，默认开）。你也拿不到明文 token —— 它只从 `auth` 取。

## 八、拦截器：统一加料与统一收口

拦截器是这一层最常用的扩展点。两种，方向相反：

| | 什么时候跑 | 典型用途 |
|---|---|---|
| **请求拦截器** | 请求发出**之前**（按注册序） | 加公共 header、拼签名、打埋点、按域名改写地址 |
| **响应拦截器** | 响应回来**之后**（按注册**逆序**） | 统一错误处理、401 刷新 token、解包业务包体 |

```ts
provideRequestClient({
  baseURL: import.meta.env.VITE_API,

  interceptors: {
    request: [
      // ① 每个请求加一个追踪头
      (ctx) => ({
        url: ctx.url,
        config: {
          ...ctx.config,
          headers: { ...(ctx.config.headers ?? {}), 'X-Client': 'web' },
        },
      }),
    ],
    response: [
      // ② 统一错误处理：只做记录，不改变结果
      (res, ctx) => {
        if (!res.ok) console.warn('[api]', ctx.url, res.error.code)
        return res
      },
    ],
  },
})
```

### 短路：请求拦截器返回 `null`

返回 `null` 表示"这个请求不发出去"。结果码是 `fetch.intercepted` ——
业务测得出"被自己拦了"，而不是一个含糊的失败。

```ts
interceptors: {
  request: [
    (ctx) => {
      // 离线时直接拦下发钱的请求，交给其他机制处理
      if (!navigator.onLine && ctx.url.includes('/pay')) return null
      return { url: ctx.url, config: ctx.config }
    },
  ],
}
```

### 顺序是洋葱，不是队列

请求拦截器**按注册序**进入，响应拦截器**按逆序**出来 —— 和洋葱一样，最后进去的最先看到响应。

```ts
interceptors: {
  request:  [A, B],   // 执行 A → B
  response: [X, Y],   // 执行 Y → X
}
```

这条顺序很实用：如果你有两个响应拦截器，**后注册的那个**能看到更"原始"的响应。

### ⚠️ 一个必须知道的取舍：配了请求拦截器就不去重

请求拦截器可以改 URL 和 header，而它在**去重键算好之后**才执行 ——
键代表不了最终请求身份。继续合并就有跨租户串号的风险（A 拿到 B 的响应）。

所以只要配了请求拦截器，去重会**整体跳过**，并在结果的 `meta.dedupeSkipped` 里写明原因：

```ts
if (r.meta?.dedupeSkipped) {
  // 不是你配错了 —— 是"有拦截器时合并有风险"这个设计决定
  console.info('去重已跳过：', r.meta.dedupeSkipped.reason)
}
```

**正确性优先于效率**：宁可少一次合并，也不冒险串号。

### 不要同时传 `hooks` 和 `interceptors`

```ts
// ❌ 会抛 request.interceptors.conflict
createRequestClient({
  hooks: myHooks,
  interceptors: { request: [fn] },
})
```

原因：`hooks` 是**已经建好的**管线，这一层拿不到它的配置，没法把拦截器塞进去。
（曾经的行为是**静默忽略** —— 拦截器一次都不跑，也没有任何提示。现在改成显式报错。）

两条出路，任选：

```ts
// ① 不传 hooks，让 client 自建（推荐）
createRequestClient({ interceptors: { request: [fn] } })

// ② 自己建 hooks，把拦截器放进 fetch 选项
const hooks = createCapabilityHooks(undefined, {
  fetch: { requestInterceptors: [fn] },
})
createRequestClient({ hooks })
```

## 九、重试与幂等（写操作必读）

```ts
provideRequestClient({
  retry: { attempts: 2, backoff: 'exponential', respectRetryAfter: true },
})
```

**默认不会重试 POST。** 这是故意的 —— HTTP 语义上只有幂等方法能无条件重试。

要让 POST 能重试，给幂等键：

```ts
useMutation('/api/order', {
  request: { idempotencyKey: orderDraftId },   // 同一逻辑请求复用同一个 key
})
```

门面层看到幂等键就会放行重试，服务端按 key 去重。

**注意**：`idempotencyKey` 必须是**稳定的** —— 同一次下单的所有重试要复用同一个值。用草稿 id / 客户端生成的 uuid，不要每次重试重新生成。

## 十、离线队列

```ts
provideRequestClient({
  offlineQueue: {
    enabled: true,
    maxEntries: 100,
    autoFlush: true,              // 网络恢复自动重放
    store: myPersistentStore,     // 不传则只内存排队
  },
  onNetworkStatusChange: (cb) => {
    const on = () => cb({ isConnected: navigator.onLine })
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  },
})
```

**只有幂等请求能进队列**（带幂等键的 POST / 所有 GET/PUT/DELETE）。非幂等且无 key 的请求会被拒 —— 重放它等于重复提交。

## 十一、取消请求

```ts
const q = useQuery('/api/slow')
q.abort('用户切页')          // 主动取消

// 或者用 AbortSignal（与 fetch 语义一致）
const ctl = new AbortController()
useQuery('/api/slow', { request: { signal: ctl.signal } })
ctl.abort()
```

组件卸载时**自动取消**（`useQuery` / `useMutation` / `useRequest` 都接管了 `onScopeDispose`）。不用手动管。

## 十二、已知边界

写清楚不做什么，比列功能更有用。

- **没有响应式 url 的自动重拉**。`useQuery(url)` 的 url 在创建时求值，之后变 `page` / `keyword` 需要自己 `watch` + `refresh`，或用 `computed` 生成 url 当作新 query 创建。这是当前实现的能力边界，不是 bug。
- **不做 SWR 后台刷新调度**。需要定时器 + 页面可见性感知，属独立能力。内核有 HTTP 层的 RFC 5861 SWR（缓存语义），但那不是"进入页面时静默刷新"。
- **不做全局错误弹窗**。你自己在 `onError` 里决定。
- **SSR 必须显式 provide**。零配置时用的是进程级兜底单例，多请求共享会让配额/断路器计数跨请求累积。
- **`unknown` 之后怎么处置是业务的责任**。这一层保证状态诚实，不能替你决定"去查单还是忽略"。

## 十三、从零排查清单

请求不工作时，按顺序看这五项：

1. **`loading` 有没有从 `true` 变回 `false`** —— 一直是 `true` 说明请求没结算（网络挂起 / 端不支持）。
2. **`outcome` 是什么** —— `undefined` 说明压根没发起（`immediate: false` 忘了调 `refresh`）；`unknown` 说明结果不确定（不要重试，去查）。
3. **`error.code`** —— 对照第六节的表。`fetch.unsupported` 是端的问题，不是代码问题。
4. **`provideRequestClient` 有没有调** —— 没调用的是兜底单例（无 baseURL，相对路径会打到当前域名）。
5. **baseURL 拼对没** —— `joinUrl` 会处理斜杠，但 `/api` + `api/users` 会拼成 `/api/api/users`。

## 相关

- [请求治理层](/docs/system/13-request-governance) —— 为什么这样设计，以及这层的边界
- [`useFetch`](/docs/capability/fetch) —— 底层的单请求门面（不需要三态/幂等/审计时可以直接用）
