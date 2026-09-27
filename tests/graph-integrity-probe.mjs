// 快速验证：适配器产出的请求里，id 是否唯一、有无自环/成环
import { createSelfDrawAdapter } from '../packages/renderer-app/dist/adapters/selfdraw.js'
import { createRequire } from 'node:module'
const require_ = createRequire(new URL('../packages/renderer-app/package.json', import.meta.url))
const vuePath = require_.resolve('@vue/runtime-core/dist/runtime-core.cjs.js')
const { h } = await import(vuePath)

const adapter = createSelfDrawAdapter()
const container = adapter.createElement('p-view')
adapter.root.children.push(container)
container.parent = adapter.root
// 造一棵含嵌套的树
const App = { render: () => h('p-view', { style: { width: 100, height: 100 } }, [
  h('p-view', { style: { height: 20 } }, [h('p-text', { style: { fontSize: 12 } }, 'a')]),
  h('p-text', { style: { fontSize: 12 } }, 'b'),
]) }
const { createAppRenderer } = await import('../packages/renderer-app/dist/index.js')
createAppRenderer(adapter).createApp(App).mount(container)

const req = adapter.toRequest({ width: 390, height: 844 })
const ids = req.nodes.map(n => n.id)
const uniq = new Set(ids)
console.log(`节点数 ${ids.length}，唯一 id 数 ${uniq.size}`)
if (uniq.size !== ids.length) { console.log('✗ id 重复:', ids.filter((v,i)=>ids.indexOf(v)!==i)); process.exit(1) }
// 自环
const selfLoop = req.nodes.filter(n => n.parentId !== null && n.parentId === n.id)
if (selfLoop.length) { console.log('✗ 自环节点:', selfLoop.map(n=>n.id)); process.exit(1) }
// 成环检测
const byId = new Map(req.nodes.map(n => [n.id, n]))
for (const n of req.nodes) {
  let cur = n.parentId, steps = 0
  while (cur !== null) {
    if (++steps > req.nodes.length) { console.log(`✗ 节点 ${n.id} 上溯成环`); process.exit(1) }
    cur = byId.get(cur)?.parentId ?? null
  }
}
console.log('✓ 图完整：id 唯一、无自环、无环')
