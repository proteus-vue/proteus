// packages/request/src/index.ts
// @proteus-vue/request —— ★★★#1394 **请求库的 Vue 产品层**。
//
// 【一句话定位】把 `@proteus-vue/api` 里那套请求治理内核（三态 · 幂等 · 断路器 · 离线队列 ·
//   审计 · 脱敏 · 配额）变成**Vue 里能直接用的响应式 composable**，模板可以绑。
//
// 【为什么单独成包（不是塞进 api）】
//   `packages/api` 刻意**零 vue 依赖**（它的 request/ 要能跑在 MP 逻辑层、Node、以及任何非 Vue 环境）。
//   而"响应式"是 Vue 特有的东西 ⇒ 放进 api 会把 vue 变成 api 的硬依赖，
//   破坏"内核平台中立"这条架构约束（已有先例：`@proteus-vue/pinia-sync` 就是这么分的，
//   vue 是它的 peerDependency）。⇒ 本包 = 产品层，内核仍是 api。
//
// 【与前端的三种用法（选哪个看场景）】
//   · `useQuery(url)`    —— 进页面就拉的**读**（列表/详情）。自动发起 + 竞态裁决。
//   · `useMutation(url)` —— 用户动作触发的**写**（提交/删除）。乐观更新 + 三态回滚。
//   · `useRequest()`     —— 用户动作触发的**读**（点搜索才查）。
//
// 【这一层**不**做的事（诚实边界）】
//   ❌ 不重实现任何请求策略（重试/去重/缓存/断路器/幂等/审计全在内核）
//   ❌ 不做 SWR 后台刷新调度（需要定时器 + 可见性感知，属独立能力）
//   ❌ 不做全局错误弹窗（那是 UI 决策，交给业务的 `onError`）
//   ✅ 只做三件内核不做的事：响应式容器 · 竞态裁决 · 组件卸载取消

export { provideRequestClient, useRequestClient, hasProvidedClient } from './client'
// ★仅供测试：重置零配置兜底单例（生产代码不该调它）
export { __resetFallbackClient } from './client'
export { useQuery } from './use-query'
export type { UseQueryOptions, UseQueryHandle } from './use-query'
export { useMutation } from './use-mutation'
export type { UseMutationOptions, UseMutationHandle } from './use-mutation'
export { useRequest } from './use-request'
export type { UseRequestOptions, UseRequestHandle } from './use-request'
export { createAsyncState, applyResult, createRaceGuard } from './support'
export type { AsyncState } from './support'
