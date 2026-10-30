# @proteus-vue/request

Proteus 请求库的 **Vue 产品层** —— 把 `@proteus-vue/api` 里那套请求治理内核变成 Vue 里能直接用的 composable，模板可以绑。

**内核**（三态 · 幂等 · 断路器 · 离线队列 · 审计 · 脱敏 · 配额）在 `@proteus-vue/api` 的 `request/`，
平台中立、零 Vue 依赖。本包只做三件内核不做的事：**响应式容器 · 竞态裁决 · 卸载取消**。

## 三个 composable，怎么选

| 用哪个 | 场景 | 自动发起 | 乐观更新 |
|---|---|---|---|
| `useQuery(url)` | 进页面就拉的**读**（列表 / 详情） | ✅ | — |
| `useMutation(url)` | 用户动作触发的**写**（提交 / 删除） | ❌ | ✅ |
| `useRequest()` | 用户动作触发的**读**（点搜索才查） | ❌ | — |

## 三步接入

```ts
// ① main.ts（或根组件 setup）—— 一处配置，全应用共用一份实例
import { provideRequestClient } from '@proteus-vue/request'
provideRequestClient({
  baseURL: import.meta.env.VITE_API,
  bizId: 'shop',                       // 多业务隔离轴（配额 / 审计 / 白名单都按它分）
  retry: { attempts: 2, backoff: 'exponential' },
  tenant: { allowedDomains: ['api.example.com'] },
  circuitBreaker: { threshold: 5, cooldownMs: 30_000 },
})
```

```vue
<!-- ② 页面里直接用 -->
<script setup lang="ts">
import { useQuery } from '@proteus-vue/request'

const users = useQuery<User[]>('/api/users')
</script>

<template>
  <div v-if="users.loading.value">加载中…</div>
  <ul v-else>
    <li v-for="u in users.data.value" :key="u.id">{{ u.name }}</li>
  </ul>
</template>
```

```ts
// ③ 写操作：乐观更新 + 三态回滚
import { useMutation } from '@proteus-vue/request'

const create = useMutation<Todo, { title: string }>('/api/todos', {
  optimistic: (v) => ({ id: 'tmp', title: v.title, done: false }),
  onError: (_e, outcome) => {
    if (outcome === 'unknown') toast('结果未知，请刷新列表确认')  // ★不要写"创建失败"
    else toast('创建失败')
  },
})
await create.mutate({ title: '买菜' })
```

## 拦截器

```ts
provideRequestClient({
  interceptors: {
    request: [(ctx) => ({ url: ctx.url, config: { ...ctx.config, headers: { ...(ctx.config.headers ?? {}), 'X-Client': 'web' } } })],
    response: [(res, ctx) => { if (!res.ok) console.warn(ctx.url, res.error.code); return res }],
  },
})
```

请求按注册序、响应按**逆序**（洋葱）。请求拦截器返回 `null` ⇒ 短路（`fetch.intercepted`）。
★配了请求拦截器会**跳过去重**（拦截器可改身份，合并有串号风险），原因写在 `meta.dedupeSkipped`。

## 三个必须知道的语义

**① 失败不清空数据。** 刷新失败时 `data` 保留上一次成功的值 —— 否则页面从"有内容"变成"空白"，用户以为数据没了，实际只是刷新失败。

**② `unknown` 不等于 `failed`。** 这是整个请求层的设计起点：超时可能意味着"服务端已经处理了但响应没回来"。
- `failed` ⇒ 确定没生效 ⇒ 回滚 / 可重试
- `unknown` ⇒ **可能已成功** ⇒ **不回滚**、**不重试**，界面必须让用户去确认

`useMutation` 在 `unknown` 时**故意保留乐观值**，因为回滚等于把一个可能真成功的写入在界面上撤销掉。

**③ 竞态裁决是内建的。** 快速切筛选 / 连点刷新时，先发后到的旧响应不会覆盖新响应。手写请求状态最常翻的就是这个车。

## 边界

- **不重实现任何请求策略** —— 重试 / 去重 / 缓存 / 断路器 / 幂等 / 审计全在 `@proteus-vue/api`
- **不做 SWR 后台刷新调度** —— 需要定时器 + 页面可见性感知，属独立能力
- **不做全局错误弹窗** —— 那是 UI 决策，交给你的 `onError`
- **零配置也能跑**（不调 `provideRequestClient` 时用兜底单例），但 **SSR 场景必须显式 provide** —— 否则配额/断路器计数会跨请求累积

## 相关

- **产品主页**：[Phylax 请求治理层](/phylax)（沉浸式产品页）
- 内核与设计理由：[官网 · 请求治理层](/docs/system/13-request-governance)
- 逐个场景的教程：[使用手册](/docs/system/14-request-quickstart)
