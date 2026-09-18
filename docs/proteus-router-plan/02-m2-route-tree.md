# M2 — 路由表构建（嵌套树 + path 推导 + meta 合并）

> **里程碑**：M2（B2）
> **输入依赖**：`01-m1-route-parser.md`（RouteBlock[]）
> **产出**：`packages/router/src/tree.ts`、`merge.ts`、`routes.generated.ts` 类型
> **LLM 批次**：B2

---

## 1. 目标

把扁平的 `RouteBlock[]` 转为**嵌套路由树**，并合并全局默认值，输出与端无关的 `RouteNode[]`，供三端 codegen 消费。

## 2. 嵌套规则（两条路径，显式优先）

### 规则 A：path 自动推导（推荐）
```
/home          → 根
/home/profile  → /home 的子节点
/user
/user/order    → /user 的子节点
```
**算法**：按 `/` 分段，逐段匹配已有节点；前缀完全匹配即父子。

### 规则 B：显式 `parent`（覆盖 A）
```json
{ "path": "/order/detail", "name": "orderDetail", "parent": "user" }
```
`parent` 指向某节点 `name`，强制挂为其子，**忽略 path 前缀推导**（用于"路径不反映层级"的场景）。

### 优先级
`parent` 存在 → 用 B；否则用 A。两者冲突时 B 胜，并打印 `--trace-router` 说明。

## 3. 数据结构

```ts
export interface RouteNode {
  loc: RouteBlock['loc']
  path: string
  name?: string
  redirect?: string
  componentPath: string
  meta: RouteMeta
  lazy: boolean
  children: RouteNode[]   // 嵌套结果
}
```

## 4. 构建算法 `tree.ts`

```ts
export function buildRouteTree(
  blocks: RouteBlock[],
  defaults: GlobalRouteDefaults = {}
): RouteNode[] {
  const nodes = blocks.map(b => ({
    ...b,
    children: [],
    meta: mergeMeta(defaults.meta, b.meta),  // 见 merge.ts
    lazy: b.lazy ?? defaults.lazy ?? true,
  }))

  const byName = new Map(nodes.filter(n => n.name).map(n => [n.name!, n]))
  const roots: RouteNode[] = []

  for (const node of nodes) {
    if (node.parent) {
      const p = byName.get(node.parent)
      if (!p) throw new RouteValidationError(
        `parent "${node.parent}" 未找到`, node.loc)
      p.children.push(node)
    } else {
      const parentByPath = findParentByPath(nodes, node)
      if (parentByPath) parentByPath.children.push(node)
      else roots.push(node)
    }
  }

  return sortByPath(roots)  // 稳定排序，保证产物可复现
}
```

- **两遍扫描**：第一遍建 `byName`，第二遍挂父子 → 避免"先遇到子、父还没解析"
- **可复现**：排序保证 codegen 输出稳定 diff（对 git / AI 友好）

## 5. meta 合并 `merge.ts`

```ts
// 全局默认 < 页面 < 显式
export function mergeMeta(global: RouteMeta, page: RouteMeta): RouteMeta {
  return { ...global, ...page }
  // 浅合并；嵌套对象（如 { transition: {...} }）需深合并（递归，限深度 3）
}
```

合并优先级（**透明、可追踪**）：
```
router.defaults.meta  (proteus.config.ts)
        ↓ 覆盖
<route>.meta          (页面)
```

`--trace-router` 输出每条 meta 字段的最终来源：
```
meta.title  ← src/pages/home/Home.vue:2 (page)
meta.transition ← proteus.config.ts router.defaults (global)
```

## 6. 全局配置 `proteus.config.ts`

```ts
export default defineConfig({
  router: {
    defaults: {
      meta: { transition: 'slideUp', needLogin: false },
      lazy: true,
    },
    tabBar: { ... },          // M6
    guards: { ... },          // M6
  }
})
```

`GlobalRouteDefaults` 类型 → 由 `createProteusApp` 注入，不写死在 scan 里。

## 7. 产出物

`dist/.proteus/routes.generated.ts`：
```ts
export const routes = [
  {
    path: '/home',
    name: 'home',
    component: () => import('/abs/path/Home.vue'),  // lazy
    meta: { title: '首页', needLogin: true, transition: 'slideUp' },
    children: [...],
  },
  // ...
]
```

三端 codegen **都消费这棵 `RouteNode[]`**（或此 `.ts` 文件），保证一致性。

## 8. 测试要点

- path 推导：`/a`、`/a/b`、`/a/c` → `/a` 有 2 个子
- `parent` 覆盖：显式 `parent` 打破 path 前缀
- 循环引用：`parent` 成环 → 报错 + 定位
- meta 合并：全局 + 页面 → 页面胜；嵌套对象深合并

---

## LLM 执行提示（B2）

> 读 `00-overview.md` + `01-m1-route-parser.md` + 本文件。实现 `tree.ts` + `merge.ts`，**先不接 codegen**，单测用 `RouteBlock[]` 直接构造。
