---
title: Headless 后端与语义快照
order: 21
group: 渲染层
---

# Headless 后端与语义快照

HeadlessBackend 是一棵**零 UI 依赖的内存节点树**——纯 TS、无 DOM、无平台调用。它是测试 / 验证 / CI 的基座：SSR 输出、测试断言、AI Agent 无设备回归（G-23）都跑在它上面，也是 conformance 的参考实现。

> **先在内存树里把语义验证对，再上真端。**
> 语义错误不该等到真机才被发现——Headless 让「同一份 IR 的结构正确性」在毫秒级单测里闭环。

## 零 UI 依赖的内存树

```ts
export interface HeadlessNode {
  id: number
  type: string // 语义化类型：page / grid / text / button…
  props: Record<string, unknown>
  children: HeadlessNode[]
  parent: HeadlessNode | null
  text: string
}
```

- **零依赖**：`createHeadlessBackend()` 不碰 `document`——Node / CI / Worker / 浏览器里行为完全一致。（对比：VueDom 在 SSR 环境会直接抛错，提示注入 documentLike 或改用 Headless。）
- **语义化视图**：`SEMANTIC_HEADLESS_MAP` 把 `ui.text` → `text`、`layout.grid` → `grid`、`shell.page` → `page`——SSR / debug / AI Agent 看到的是语义名，不是标签字符串。
- **能力诚实**：`ssr: true`、`layout: 'none'`（无布局器，走框架 IR 求解）、`glass` / `blur: 'none'`——无 UI 是设计使然，不是缺陷。
- **Vue 渲染链路的起点**：`createProteusRendererForBackend(createHeadlessBackend())` ——无浏览器也能在 Node 里跑通标准 Vue 渲染（`h()` / `render`），再换 VueDom / Native / Flutter 复验同一棵 VNode 树。

## 语义快照：toPlainTree

`toPlainTree` 把内存树序列化为纯对象树——测试断言、golden diff、Agent 快照的统一载体。快照形状即契约：字段固定为 `id / type / props / text / children`，对形状漂移零容忍。真实用法（与仓库测试同源）：

```ts
import { createNodeOpsDispatcher, createHeadlessBackend, toPlainTree } from '@proteus-vue/render-backend'

const d = createNodeOpsDispatcher(createHeadlessBackend())
const grid = d.nodeOps.createElement('p-grid', { minColWidth: 160 })
const text = d.nodeOps.createElement('p-text', { content: '商品 A' })
d.nodeOps.insert(text, grid)
const root = d.nodeOps.createElement('p-page', { title: 'Product' })
d.nodeOps.insert(grid, root)

const tree = toPlainTree(root as never)
// tree.type === 'page'
// tree.children[0].type === 'grid'
// tree.children[0].children[0].text === '商品 A'
```

`JSON.stringify(tree)` 即快照——进 golden 或直接断言都行。属性变更同样可断言：对 `p-image` 节点执行 `d.nodeOps.patchProp(el, 'src', 'a.png', 'b.png')` 后，`toPlainTree(el).props.src` 读回 `'b.png'`。

落到 vitest 里就是最小化的快照断言（与 `tests/dispatcher.test.ts` 同构）：

```ts
import { expect, it } from 'vitest'

it('语义快照：p-page > p-grid > p-text', () => {
  const tree = toPlainTree(root as never)
  expect(tree.type).toBe('page') // shell.page → page
  expect(tree.children[0].type).toBe('grid') // layout.grid → grid
  expect(tree.children[0].children[0].text).toBe('商品 A')
})
```

这个模式也是 H 套件的写法——`JSON.stringify(toPlainTree(root))` 作为机器证据参与 H-03 / H-04 / H-05 的逐项断言。

## 为什么「先验证语义，再上真端」

顺序反过来：先 Headless 全绿，再上真端——CI 里跑不起模拟器，但跑得起内存树。

- **组件快照门禁的第一列**：`renderComponentSnapshot(backend, ir, createControlReader('headless'))` 产出 `(type / semantic / control / props)` 快照树；6 后端 × L1 fixtures 的 CI 门禁里，Headless 是最便宜、最稳定的一列：

```ts
import { createHeadlessBackend, renderComponentSnapshot, createControlReader } from '@proteus-vue/render-backend'

const snap = renderComponentSnapshot(createHeadlessBackend(), ir, createControlReader('headless'))
// snap.control === 'grid'（ir 根为 p-grid 时）——readback 即语义名
```

- **组合矩阵的通用验证引擎**：G-41 宿主 × 引擎矩阵（6 × 6 = 36 组合）中，每个宿主都配一台 Headless 作通用验证引擎——组合级 conformance 从它起步，再扩展到真实引擎。
- **AI Agent 的无设备回归**：Agent 改完代码不必起模拟器——语义快照 diff 即回归证据（见[AI 原生开发](/docs/32-ai-agent)）。

工程化接入（测试命令、部署链路）见[测试与部署](/docs/27-testing-deploy)；验证体系全貌（结构层 / 约束层 / 渲染层三层验证与门禁清单）见[一致性验证](/docs/framework/29-conformance)。

## 下一步

- [渲染后端](/docs/framework/23-render-backend)：Headless 在六后端中的位置
- [一致性验证](/docs/framework/29-conformance)：语义快照如何变成门禁
- [测试与部署](/docs/27-testing-deploy)：接入 CI 工程链路
