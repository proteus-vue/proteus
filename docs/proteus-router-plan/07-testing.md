# 测试策略 — 四层测试 + 跨端矩阵

> **里程碑**：M6（B7）
> **配套**：`proteus-pinia-plan/07-testing.md`（沿用同一测试分层）
> **LLM 批次**：B7（与 08-migration 一起）

---

## 1. 四层测试（对齐 Pinia 计划）

| 层级 | 内容 | 工具 | 时机 |
|------|------|------|------|
| **L1 单元** | scan / tree / merge / codegen 纯函数 | vitest | 每批 |
| **L2 集成** | scan → tree → codegen 全链路 | vitest + fixtures | B2、B7 |
| **L3 端到端** | 三端真实运行时导航 | Web: happy-dom + vue-router；mp: skyline mock；App: NativeBridge mock | B7 |
| **L4 跨端矩阵** | 同 `<route>` → 三端产物一致 + 行为一致 | vitest matrix | B7 |

## 2. L1 单元（示例）

```ts
// scan.test.ts
describe('scanRoutes', () => {
  it('提取 path/name/meta 并定位行号', () => {
    const routes = scanRoutes('fixtures/basic')
    expect(routes[0]).toMatchObject({ path: '/home', name: 'home' })
    expect(routes[0].loc).toEqual({ file: 'Home.vue', line: 2, column: 1 })
  })

  it('path 重复时报错并指向两个 loc', () => {
    expect(() => scanRoutes('fixtures/duplicate-path'))
      .toThrow(RouteValidationError)
  })
})

// tree.test.ts
describe('buildRouteTree', () => {
  it('path 前缀自动推导父子', () => {
    const tree = buildRouteTree([
      block('/home'), block('/home/profile'), block('/user'),
    ])
    expect(tree).toHaveLength(2)  // /home, /user
    expect(tree[0].children).toHaveLength(1)
  })

  it('parent 显式覆盖 path 推导', () => {
    const tree = buildRouteTree([
      block('/a'), block('/x', { parent: 'a' }),
    ])
    expect(tree[0].children).toHaveLength(1)
  })
})
```

## 3. L2 集成（快照测试，核心）

```ts
// codegen.integration.test.ts
it('Home + User 路由 → 三端产物快照', () => {
  const blocks = scanRoutes('fixtures/basic')
  const tree = buildRouteTree(blocks, defaults)

  expect(generateWebRoutes(tree)).toMatchFileSnapshot('snapshots/web.txt')
  expect(generateMpConfig(tree)).toMatchFileSnapshot('snapshots/mp.json')
  expect(generateAppNavigation(tree)).toMatchFileSnapshot('snapshots/app.txt')
})
```

**快照 = 可审计的产物契约**：改 codegen 逻辑 → 快照 diff → 人工 review。对齐"透明编译"。

## 4. L3 端到端

### Web
```ts
it('导航到 /home 渲染 Home 组件', async () => {
  const router = createWebRouter({ routes, history: createMemoryHistory() })
  const app = createApp(App).use(router)
  await router.push('/home')
  expect(app.container.querySelector('.home')).toBeTruthy()
})
```

### mp（mock Skyline）
- 无真实 Skyline 环境 → mock `wx.navigateTo` / `Page` / `App`
- 断言：`<route>.meta.transition: slideUp` → 调用 `wx.navigateTo({ routeType: 'slideUp' })`

### App（mock NativeBridge）
```ts
it('push 调用原生桥并传 transition', () => {
  const bridge = { pushScreen: vi.fn() }
  const router = createAppRouter({ screens, bridge })
  router.push('user')
  expect(bridge.pushScreen).toHaveBeenCalledWith('user', {}, 'slide')
})
```

## 5. L4 跨端矩阵

```ts
describe('跨端一致性矩阵', () => {
  const cases = [
    { transition: 'slideUp', web: 'slide-up', mp: 'slideUp', app: 'presentModal' },
    { transition: 'halfScreen', web: 'half-screen', mp: 'halfScreen', app: 'pageSheet' },
    // ... 枚举全覆盖
  ]

  it.each(cases)('transition=$transition 三端映射一致', ({ transition, web, mp, app }) => {
    const node = makeNode({ meta: { transition } })
    expect(webTransition(node)).toBe(web)
    expect(mpTransition(node)).toBe(mp)
    expect(appTransition(node)).toBe(app)
  })
})
```

**矩阵 = "同一份 `<route>` 三端语义一致" 的硬证明**，对齐框架总原则。

## 6. CI 门禁（对齐 Pinia M8.4）

- `pnpm test` 全绿才合并
- `--trace-router` 输出纳入 CI artifact（产物追溯可查）
- **`stores/` 同类规则**：`grep -r "wx\.navigateTo\|window\.location" packages/router/src/` → 路由差异不得泄漏进 `codegen/` 之外的文件
- 快照变更需人工 approve（防止 AI 批量改 codegen 时静默改产物）

---

## LLM 执行提示（B7）

> 读 `00-overview.md` + `01-06` + 本文件。测试与实现**交替写**（TDD）：每实现一个模块，立即补对应 L1/L2 测试，避免最后堆积。
