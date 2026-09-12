// tests/showcase-catalog.test.ts
// ★showcase 目录数据（data/catalog.ts）一致性门禁：
//   ① 快照与官网内容一致（`gen-showcase-catalog.mjs --check` 语义——此处直接重算比对）；
//   ② 每个非空 route 都能落到真实详情页文件（防「目录里可点击但页面不存在」幽灵链接）；
//   ③ 分组/条目数量与官网内容对账（防丢组/丢条目）。
// 背景（2026-09-13）：showcase 改为分包 + 分组目录，目录数据由官网内容生成——
//   若生成器不跑或 route 写错，目录页会出现死链或空组，故设此门禁。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { COMPONENT_GROUPS, CAPABILITY_GROUPS, CATALOG_STATS } from '../showcase/data/catalog'

const ROOT = path.resolve(__dirname, '..')

describe('★showcase 目录数据（catalog.ts）', () => {
  it('快照与官网内容一致（生成器 --check）', () => {
    // --check 在漂移时 exit 1；此处不应抛
    expect(() =>
      execFileSync('node', ['scripts/gen-showcase-catalog.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow()
  })

  it('每个非空 route 都指向真实存在的详情页（防幽灵链接）', () => {
    const all = [
      ...COMPONENT_GROUPS.flatMap((g) => g.items),
      ...CAPABILITY_GROUPS.flatMap((g) => g.items),
    ].filter((i) => i.route)
    expect(all.length).toBeGreaterThan(0)
    for (const it of all) {
      // route = /subpackages/<pkg>/pages/<name> → 文件 showcase/subpackages/<pkg>/pages/<name>.vue
      const rel = it.route.replace(/^\//, '').replace(/^pages\//, 'pages/')
      const file = path.join(ROOT, 'showcase', rel + '.vue')
      expect(fs.existsSync(file), `${it.name} 的 route "${it.route}" 无对应文件 ${file}`).toBe(true)
    }
  })

  it('分组与条目数量对账（6 组件域 / 10 能力域；条目 >0）', () => {
    expect(COMPONENT_GROUPS.length).toBe(6)
    expect(CAPABILITY_GROUPS.length).toBe(10)
    expect(CATALOG_STATS.componentGroups).toBe(COMPONENT_GROUPS.length)
    expect(CATALOG_STATS.capabilityGroups).toBe(CAPABILITY_GROUPS.length)
    const compTotal = COMPONENT_GROUPS.reduce((n, g) => n + g.items.length, 0)
    const capTotal = CAPABILITY_GROUPS.reduce((n, g) => n + g.items.length, 0)
    expect(compTotal).toBe(CATALOG_STATS.componentTotal)
    expect(capTotal).toBe(CATALOG_STATS.capabilityTotal)
    expect(compTotal).toBeGreaterThan(60)
    expect(capTotal).toBeGreaterThan(70)
  })

  it('全部条目都有名字与描述（目录页不出现空白行）', () => {
    for (const g of [...COMPONENT_GROUPS, ...CAPABILITY_GROUPS]) {
      expect(g.name, '组名非空').toBeTruthy()
      for (const it of g.items) {
        expect(it.name, `${g.name} 组存在空名字条目`).toBeTruthy()
        expect(it.desc, `${it.name} 描述为空`).toBeTruthy()
      }
    }
  })
})
