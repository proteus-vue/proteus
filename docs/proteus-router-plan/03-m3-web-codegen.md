# M3 — Web 端 codegen（vue-router）

> **里程碑**：M3（B3）
> **输入依赖**：`02-m2-route-tree.md`（RouteNode[]）
> **产出**：`packages/router/src/codegen/web.ts`、`createWebRouter()`
> **LLM 批次**：B3

---

## 1. 目标

把 `RouteNode[]` 编译为 **vue-router 4** 的 `RouteRecordRaw[]`，生成 `dist/.proteus/routes.generated.ts`，Web 入口 `main.web.ts` 一行接入。

## 2. 映射规则

| `<route>` 字段 | vue-router 对应 |
|-----------------|-----------------|
| `path` | `RouteRecordRaw.path` |
| `name` | `name` |
| `redirect` | `redirect` |
| `componentPath` | `component: () => import(...)`（lazy）或静态 import |
| `children` | `children`（递归）|
| `meta` | `meta` |
| `meta.transition` | **不直接映射**，交给 `<RouterTransition>` 包裹组件（见下）|

## 3. codegen 实现 `web.ts`

```ts
import type { RouteNode } from '../types'
import { generate } from '@vue/compiler-core'

export function generateWebRoutes(nodes: RouteNode[]): string {
  const records = nodes.map(n => nodeToRecord(n)).join(',\n  ')
  return `
import { defineAsyncComponent } from 'vue'
export const routes = [
  ${records}
]
`
}

function nodeToRecord(node: RouteNode): string {
  const comp = node.lazy
    ? `() => import(${JSON.stringify(node.componentPath)})`
    : `defineAsyncComponent(() => import(${JSON.stringify(node.componentPath)}))`

  const children = node.children.length
    ? `,\n  children: [${node.children.map(nodeToRecord).join(',\n  ')}]`
    : ''

  return `{
    path: ${JSON.stringify(node.path)},
    name: ${JSON.stringify(node.name)},
    component: ${comp},
    meta: ${JSON.stringify(node.meta)}${children}
  }`
}
```

输出产物 `dist/.proteus/routes.generated.ts` 被 `main.web.ts` 引用：
```ts
// main.web.ts
import { createWebRouter, createApp } from '@proteus/runtime'
import { routes } from '../.proteus/routes.generated'

const router = createWebRouter({ routes, history: createWebHistory() })
createApp(App).use(router).mount('#app')
```

## 4. 转场映射 `meta.transition`

Web 端用 `<RouterTransition>` 包裹 `<router-view>`，读 `route.meta.transition`：
```vue
<RouterTransition :name="$route.meta.transition">
  <router-view />
</RouterTransition>
```
`RouterTransition` 内置对应 `<Transition>` 动画（slideUp / halfScreen / scaleDown），**映射规则写在 `transforms/transform-transition.ts`**：
```
<route>.meta.transition = "slideUp"
  → Web: <Transition name="slide-up">
  → mp:  pages.json 的 "routeType": "slideUp"（M4）
  → app: native transition（M5）
```

## 5. `lazy` 处理

- Web 端 `<route>` 的 `lazy: true`（默认）→ `() => import()` 代码分割 ✅
- 小程序端固定 `lazy: false`（Skyline 包机制不同，见 M4）
- `routes.generated.ts` 里 `lazy` 字段保留，供三端各自解释

## 6. 嵌套路由

vue-router 原生支持 `children` + 命名 `<router-view>`，**无需额外处理**。`<route>` 的 `parent` / path 推导结果直接对应 `children` 树。

## 7. 测试

- 生成字符串快照对比（`routes.generated.ts` 内容稳定）
- 集成：mount vue-router，断言 `/home` 渲染对应组件
- `lazy`：`true` → 含 `() => import`

---

## LLM 执行提示（B3）

> 读 `00-overview.md` + `02-m2-route-tree.md` + 本文件。只实现 Web codegen，**先 mock RouteNode[] 输入**（不接真实 scan），跑通快照测试。
