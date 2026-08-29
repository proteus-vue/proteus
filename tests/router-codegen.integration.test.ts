// tests/router-codegen.integration.test.ts
// 路由规划 B7 L2 集成：scan → tree → codegen 全链路（fixtures 驱动，快照 = 可审计产物契约）
// ★透明化：改 codegen 逻辑 → 快照 diff → 人工 review（对齐"透明编译"）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanRoutes } from '../packages/router/src/scan'
import { buildRouteTree } from '../packages/router/src/tree'
import { generateWebRoutes, generateMpConfig } from '../packages/router/src/codegen'

const FIX = fileURLToPath(new URL('./fixtures/router-plan', import.meta.url))

describe('L2 集成：scan → tree → codegen 全链路', () => {
  const blocks = scanRoutes(path.join(FIX, 'pages'))
  const tree = buildRouteTree(blocks, {
    meta: { transition: 'slideUp' }, // 全局默认（merge 测试）
    lazy: true,
  })

  it('scan 提取 + tree 嵌套 + codegen 三端产物快照（可审计契约）', () => {
    // Web：vue-router 形态（嵌套 children + lazy import）
    const web = generateWebRoutes(tree)
    expect(web).toMatchFileSnapshot('./__snapshots__/router-codegen.web.txt')
    // MP：平铺 pages（meta.__parent 降级 + transition 映射）
    const mp = generateMpConfig(tree, {
      color: '#999',
      selectedColor: '#007AFF',
      list: [
        { name: 'home', text: '首页' },
        { name: 'user', text: '我的' },
      ],
    })
    expect(JSON.stringify(mp, null, 2)).toMatchFileSnapshot('./__snapshots__/router-codegen.mp.json')
  })

  it('快照契约一致性：产物包含关键结构（防快照静默空转）', () => {
    const web = generateWebRoutes(tree)
    expect(web).toContain('path: "/home"')
    expect(web).toContain('children: [') // 嵌套
    const mp = generateMpConfig(tree)
    const pages = mp.pages.map((p) => p.path)
    expect(pages).toContain('home/profile')
    const profile = mp.pages.find((p) => p.path === 'home/profile')
    expect(profile?.__parent).toBe('home') // 嵌套降级
  })
})
