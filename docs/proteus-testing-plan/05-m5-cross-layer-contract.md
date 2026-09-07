# M5 — 跨层契约测试（核心）

> 把 10 份计划的**接口联动**写成真实可跑的集成测试 —— 一处改接口，所有依赖层立刻报错

## 1. 为什么这是核心

单测只保证"自己对的"，但超级应用的 bug 多在**层间接缝**：
- Lifecycle `coreReady` 阶段 → Pinia store 是否已创建？
- Router 守卫 → 读的是 Auth store 的哪个字段？
- API request 拦截器 → 刷新 token 后 store 是否同步？
- Component 渲染 → capability 探测结果是否响应式？

**契约测试 = 用真实实现跑一遍完整链路**，Mock 只用在平台边界。

## 2. 契约清单（10 份计划 × 接口）

| # | 链路 | 验证点 |
|---|------|--------|
| C1 | Lifecycle → Pinia | `coreReady` 完成前 store 不可用 |
| C2 | Pinia → Router | 守卫读 `useUserStore().token` |
| C3 | Router → Module | 懒加载 chunk 触发模块 init |
| C4 | API → Pinia | 请求成功后 store 更新 |
| C5 | API → Auth | 401 刷新 token + 重试 |
| C6 | Component → Platform | capability 不支持 → fallback UI |
| C7 | Platform → Lifecycle | 探测耗时计入启动 trace |
| C8 | Compiler → Router | `<route>` → pages.json 映射 |
| C9 | Types → 全部 | Registry 推断无 `any` |
| C10 | Cli → Compiler | `proteus build` 产物可执行 |

## 3. 写法示例（C2）

```ts
import { createTestingApp } from '@proteus-vue/test-utils'
import { useUserStore } from '@/stores/user'
import { router } from '@/router'

it('guard blocks unauthenticated', async () => {
  const app = createTestingApp()
  const user = useUserStore(app.pinia)
  user.token = ''

  const result = await router.push('/trade/order')
  expect(result).toBe(false) // 守卫拦截
  expect(router.currentRoute.path).toBe('/login')
})
```

**要点**：用 `createTestingApp()` 装配完整 App（真实 Pinia + 真实 Router + mock wx），不 mock store/guard 本身。

## 4. 写法示例（C6）

```ts
it('share capability fallback', async () => {
  const app = createTestingApp({ capabilities: { share: false } })
  // 渲染含 <ShareButton> 的页面
  const { wrapper } = await app.render('/detail')
  // capability 不支持 → 显示降级 UI
  expect(wrapper.find('[data-fallback="share"]').exists()).toBe(true)
})
```

## 5. 契约变更检测

用 **TypeScript 编译** + **快照** 双保险：
- 接口改签名 → TS 报错（Types M1 推断）
- 行为改 → 契约测试失败

## 6. 组织

```
src/test/contracts/
  C1-lifecycle-pinia.test.ts
  C2-router-auth.test.ts
  ...
  helpers/createTestingApp.ts   ← 核心：装配完整 App
```

`createTestingApp()` 是关键资产 —— 它用真实实现组装 App，只 mock `wx`/`window`。

## 7. 验收

- [ ] C1-C10 全部覆盖
- [ ] 任一接口改动 → 对应契约失败
- [ ] `createTestingApp` 启动 < 500ms
- [ ] 契约测试 < 30s 全跑完
