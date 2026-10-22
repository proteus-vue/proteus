// tests/knowledge-kernel.test.ts
// ★★G-54 M0（决策 #1153）：FrameworkKnowledgeProvider ② checkLayering + ④ buildGraph 的判据。
//
// 【判据设计原则（本仓反复踩过的坑）】
//   ① **只断言关系，不硬编码数字**：包数 / 边数会随迭代变化，写死 48 只会制造维护噪音；
//      真正的不变量是「磁盘集合 === 映射表 key 集合」「依赖图无环」「无越层」。
//   ② **UNKNOWN 必须红**：新增包漏登记时，若静默当 L0 ⇒ 越层永远发现不了
//      （#1139「索引过期比没有更糟」的同族）。
//   ③ **环检测必须有独立 oracle**：只验「首尾相同 + 节点集合」时，错误实现 `[a,c,b,a]`
//      也能通过。故用 `isValidCycle`（相邻边必须真实存在）复核。
//   ④ **口径必须显式**：devDeps 不入图，但**不能失明**——用 `diagnoseDevDeps` 单列（不判红）。
//   ⑤ ★独立验证（异会话）打回首版的三处，各留一条回归用例：
//      · 裸 DFS 漏报交叉边环 ⇒ SCC 完备性用例
//      · findCycles 对「节点子集 + 全量边」静默丢边 ⇒ 子集用例
//      · 自环被 continue 吞掉 ⇒ selfLoops 用例

import { describe, expect, it } from 'vitest'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  PACKAGE_LAYERS,
  LAYER_RANK,
  ARCH_LAYERS,
  checkLayering,
  resolveLayer,
  buildGraph,
  loadManifests,
  findCycles,
  analyzeCycles,
  isValidCycle,
  createKnowledgeProvider,
  parseCapabilityManifest,
  affectedDevicesOf,
  summarizeCapabilities,
  KNOWN_DEVICE_CLASSES,
  type PackageManifest,
} from '../packages/cli/src/knowledge/index'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

/** 磁盘上真实存在的 npm 包目录名（有 package.json；Rust crate 不算） */
function diskPackages(): string[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(PACKAGES_DIR, e.name, 'package.json')))
    .map((e) => e.name)
    .sort()
}

/** 包名 → 目录名（与 loadManifests 同口径；测试里不假设两者相等） */
function nameToDir(): Map<string, string> {
  const m = new Map<string, string>()
  for (const dir of diskPackages()) {
    const pj = JSON.parse(readFileSync(path.join(PACKAGES_DIR, dir, 'package.json'), 'utf8')) as { name?: string }
    if (pj.name) m.set(pj.name, dir)
  }
  return m
}

describe('分层映射表（layer-map）', () => {
  it('磁盘每个包都有层（漏登记 ⇒ 红）', () => {
    const missing = diskPackages().filter((d) => resolveLayer(d) === null)
    expect(missing, `未登记分层的包：${missing.join(', ')}`).toEqual([])
  })

  it('表里每个条目都在磁盘存在（防改名/删除后条目腐化）', () => {
    const disk = new Set(diskPackages())
    const ghost = Object.keys(PACKAGE_LAYERS).filter((d) => !disk.has(d))
    expect(ghost, `映射表里的幽灵条目：${ghost.join(', ')}`).toEqual([])
  })

  it('层号严格递增且覆盖六档', () => {
    expect(ARCH_LAYERS.map((l) => LAYER_RANK[l])).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('每个层都有包（空层 = 分层失效）', () => {
    for (const layer of ARCH_LAYERS) {
      const n = Object.values(PACKAGE_LAYERS).filter((l) => l === layer).length
      expect(n, `层 ${layer} 没有任何包`).toBeGreaterThan(0)
    }
  })
})

describe('checkLayering（② 分层守护）', () => {
  it('向下依赖合法（cli L3 → types L0）', () => {
    const r = checkLayering('cli', 'types')
    expect(r.verdict).toBe('OK')
    expect(r.diff).toBe(-3)
    expect(r.sameLayer).toBe(false)
  })

  it('同层合法但标记 sameLayer（compiler L1 → component-ir L1）', () => {
    const r = checkLayering('compiler', 'component-ir')
    expect(r.verdict).toBe('OK')
    expect(r.diff).toBe(0)
    expect(r.sameLayer).toBe(true)
  })

  it('相邻向上依赖 = UPWARD（contracts L0 → compiler L1）', () => {
    const r = checkLayering('contracts', 'compiler')
    expect(r.verdict).toBe('UPWARD')
    expect(r.diff).toBe(1)
  })

  it('★跨级向上依赖 = SKIP_LAYER（contracts L0 → components L2）', () => {
    const r = checkLayering('contracts', 'components')
    expect(r.verdict).toBe('SKIP_LAYER')
    expect(r.diff).toBe(2)
    expect(r.message).toContain('跨越 2 层')
  })

  it('★未登记的包 = UNKNOWN（不得静默当 L0）', () => {
    const r = checkLayering('contracts', 'ghost-package')
    expect(r.verdict).toBe('UNKNOWN')
    expect(r.diff).toBeNull()
    expect(r.toLayer).toBeNull()
  })

  it('判定只依赖层、不依赖图上是否有这条边（IDE 即时反馈）', () => {
    // contracts 在图上并不依赖 components；若有边，结论应与"无此边"时完全一致
    const g = buildGraph(loadManifests(PACKAGES_DIR))
    expect(g.edges.some((e) => e.from === 'contracts' && e.to === 'components')).toBe(false)
    expect(checkLayering('contracts', 'components').verdict).toBe('SKIP_LAYER')
  })
})

describe('buildGraph（④ SPI 拓扑）', () => {
  it('真实仓库：节点 = 磁盘包集合，边 > 0，无环无自环，无越层', () => {
    const provider = createKnowledgeProvider(loadManifests(PACKAGES_DIR))
    const g = provider.buildGraph()

    expect(g.nodes).toEqual(diskPackages())
    expect(g.edges.length).toBeGreaterThan(0)
    expect(g.cycles, `依赖图出现环：${JSON.stringify(g.cycles)}`).toEqual([])
    expect(g.sccs, `依赖图出现强连通分量：${JSON.stringify(g.sccs)}`).toEqual([])
    expect(g.selfLoops, `依赖图出现自环：${g.selfLoops.join(', ')}`).toEqual([])

    // 每条环都必须过独立 oracle（相邻边真实存在）——真实仓库无环，此处额外保证 findCycles 不撒谎
    for (const c of g.cycles) expect(isValidCycle(c, g.edges)).toBe(true)

    const violations = provider.diagnoseLayering()
    expect(
      violations.map((v) => `${v.verdict} ${v.from}>${v.to}`),
      `存在越层依赖（修复方式：调整 layer-map.ts 的分层或消除该依赖，**不要放宽判定**）`,
    ).toEqual([])
  })

  it('反向依赖表与正向边严格互逆', () => {
    const g = buildGraph(loadManifests(PACKAGES_DIR))
    const forward = new Set(g.edges.map((e) => `${e.from}>${e.to}`))
    for (const [to, froms] of Object.entries(g.reverseDeps)) {
      for (const from of froms) {
        expect(forward.has(`${from}>${to}`), `reverseDeps 里 ${from}>${to} 在正向边中不存在`).toBe(true)
      }
    }
    expect(g.edges.every((e) => (g.reverseDeps[e.to] ?? []).includes(e.from))).toBe(true)
  })

  it('★人造 3 节点环必被检出，且相邻边真实存在', () => {
    const manifests: PackageManifest[] = [
      { dir: 'a', name: '@x/a', deps: ['b'], devDeps: [] },
      { dir: 'b', name: '@x/b', deps: ['c'], devDeps: [] },
      { dir: 'c', name: '@x/c', deps: ['a'], devDeps: [] },
      { dir: 'd', name: '@x/d', deps: [], devDeps: [] },
    ]
    const g = buildGraph(manifests)
    expect(g.sccs.length).toBe(1)
    expect(new Set(g.sccs[0])).toEqual(new Set(['a', 'b', 'c']))
    expect(g.cycles.length).toBe(1)
    const cycle = g.cycles[0] ?? []
    expect(new Set(cycle.slice(0, -1))).toEqual(new Set(['a', 'b', 'c']))
    expect(isValidCycle(cycle, g.edges), `环里存在实际不存在的边：${cycle.join(' -> ')}`).toBe(true)
  })

  it('人造两节点环只报一次（SCC 天然唯一）', () => {
    const g = buildGraph([
      { dir: 'a', name: '@x/a', deps: ['b'], devDeps: [] },
      { dir: 'b', name: '@x/b', deps: ['a'], devDeps: [] },
    ])
    expect(g.cycles.length).toBe(1)
  })

  it('★SCC 完备性：交叉边的环也要报（首版裸 DFS 漏报 9.5% 的回归用例）', () => {
    // 真实环：b↔c、c↔e、e↔c（{b,c,e} 同一 SCC）；a→e 只是入边，不在环内
    const edges = [
      { from: 'a', to: 'e' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'b' },
      { from: 'c', to: 'e' },
      { from: 'e', to: 'b' },
      { from: 'e', to: 'c' },
    ]
    const analysis = analyzeCycles(['a', 'b', 'c', 'e'], edges)

    // ★完备性由 SCC 保证（不要求代表回路覆盖分量全部节点——有向图里那不一定存在）
    expect(analysis.sccs.length).toBe(1)
    expect(new Set(analysis.sccs[0])).toEqual(new Set(['b', 'c', 'e']))

    // 代表回路只需真实可打印 + 起点落在分量内
    expect(analysis.cycles.length).toBe(1)
    const cycle = analysis.cycles[0] ?? []
    expect(isValidCycle(cycle, edges)).toBe(true)
    expect(['b', 'c', 'e']).toContain(cycle[0])
  })

  it('★节点子集 + 全量边不得丢边（首版对子集入参全漏的回归用例）', () => {
    const edges = [
      { from: 'a', to: 'x' },
      { from: 'x', to: 'b' },
      { from: 'b', to: 'a' },
    ]
    const cycles = findCycles(['a', 'b'], edges) // x 不在 nodes 里
    expect(cycles.length).toBe(1)
    expect(isValidCycle(cycles[0] ?? [], edges)).toBe(true)
  })

  it('★自环单独报告（不得被 continue 吞掉）', () => {
    const g = buildGraph([
      { dir: 'a', name: '@x/a', deps: ['a'], devDeps: [] },
      { dir: 'b', name: '@x/b', deps: [], devDeps: [] },
    ])
    expect(g.edges).toEqual([]) // 自环不入边表（方向诊断无意义）
    expect(g.selfLoops).toEqual(['a'])
    expect(findCycles(['a'], [{ from: 'a', to: 'a' }])).toEqual([['a', 'a']])
  })

  it('悬空依赖不产生边（不伪造拓扑）', () => {
    const g = buildGraph([{ dir: 'a', name: '@x/a', deps: ['not-exist'], devDeps: [] }])
    expect(g.edges).toEqual([])
  })

  it('纯函数：不改动输入清单', () => {
    const input: PackageManifest[] = [
      { dir: 'a', name: '@x/a', deps: ['b'], devDeps: [] },
      { dir: 'b', name: '@x/b', deps: [], devDeps: [] },
    ]
    const snapshot = JSON.stringify(input)
    buildGraph(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('findCycles 对无环图返回空数组', () => {
    expect(findCycles(['a', 'b'], [{ from: 'a', to: 'b' }])).toEqual([])
  })
})

describe('依赖口径（prod vs dev，口径必须显式）', () => {
  it('★devDeps 不入图，但向上引用被 diagnoseDevDeps 单列', () => {
    const manifests: PackageManifest[] = [
      // types 是 L0；它 devDeps 里引用 cli（L3）= 向上 3 层
      { dir: 'types', name: '@x/types', deps: [], devDeps: ['cli'] },
      { dir: 'cli', name: '@x/cli', deps: ['types'], devDeps: [] },
    ]
    const provider = createKnowledgeProvider(manifests)
    const g = provider.buildGraph()

    // 图里没有 types→cli 这条边（devDeps 不参与架构方向）
    expect(g.edges).toEqual([{ from: 'cli', to: 'types' }])
    expect(provider.diagnoseLayering()).toEqual([])

    // 但口径不静默失明：devDeps 的向上引用单独报告，且 kind='dev'
    const dev = provider.diagnoseDevLayering()
    expect(dev.map((d) => `${d.kind} ${d.from}>${d.to} ${d.verdict}`)).toEqual(['dev types>cli SKIP_LAYER'])
  })

  it('真实仓库：devDeps 口径扫描可运行且全部为 kind=dev（不判红）', () => {
    const provider = createKnowledgeProvider(loadManifests(PACKAGES_DIR))
    for (const v of provider.diagnoseDevLayering()) {
      expect(v.kind).toBe('dev')
      expect(v.message).toContain('[dev]')
    }
  })

  it('loadManifests 收集的 devDeps 只含内部包，且不与 deps 混淆', () => {
    const map = nameToDir()
    const manifests = loadManifests(PACKAGES_DIR)
    for (const m of manifests) {
      const pj = JSON.parse(readFileSync(path.join(PACKAGES_DIR, m.dir, 'package.json'), 'utf8')) as {
        devDependencies?: Record<string, string>
      }
      const expected = Object.keys(pj.devDependencies ?? {})
        .map((n) => map.get(n))
        .filter((d): d is string => Boolean(d))
        .sort()
      expect(m.devDeps, `${m.dir} 的 devDeps 与 package.json 不符`).toEqual([...new Set(expected)].sort())
    }
  })
})

// ── ⑤ affectedDevices（决策 #1178）────────────────────────────────────
// 【为什么这组要单列】⑤ 的最大风险不是"算错"，而是**三种状态被读混**：
//   未加载清单 / 查无此能力 / 有定义但无端实现 —— 三者都会给出空数组，
//   但含义完全不同（"没数据" / "数据里没有" / "确实不影响任何端"）。
describe('⑤ affectedDevices：能力 → 设备等价类影响面', () => {
  const manifest = {
    capabilities: [
      { id: 'clipboard', tier: 2, name: '剪贴板', platforms: ['skyline', 'web'], source: 'capabilities/clipboard.capability.ts' },
      { id: 'camera', tier: 3, name: '相机', platforms: ['app'], source: 'capabilities/camera.capability.ts' },
    ],
  }
  const { entries } = parseCapabilityManifest(manifest)

  it('① 正常查询：返回端集合，且**稳定排序**（顺序不随清单书写顺序变）', () => {
    const r = affectedDevicesOf(entries, 'clipboard')
    expect(r.loaded).toBe(true)
    expect(r.known).toBe(true)
    expect(r.deviceClasses).toEqual(['skyline', 'web'])
    expect(r.entry?.source).toBe('capabilities/clipboard.capability.ts')
  })

  it('② ★未知 id 返回**空**，绝不返回"全部端"（把"不知道"说成"影响所有"是最危险的假数据）', () => {
    const r = affectedDevicesOf(entries, 'not-a-capability')
    expect(r.known).toBe(false)
    expect(r.deviceClasses).toEqual([])
    expect(r.entry).toBeNull()
    // 反证：如果实现成"查不到就返回所有端"，这里会红
    expect(r.deviceClasses).not.toEqual(KNOWN_DEVICE_CLASSES)
  })

  it('③ ★"未加载清单"与"查无此能力"必须可分（两者都空数组，但语义不同）', () => {
    // 两种"空"：清单没加载 / 清单里没有这个 id
    const notLoaded = affectedDevicesOf([], 'clipboard', false)
    const unknown = affectedDevicesOf(entries, 'not-a-capability')
    expect(notLoaded.deviceClasses).toEqual(unknown.deviceClasses) // 都空
    expect(notLoaded.known).toBe(false)
    expect(unknown.known).toBe(false)
    // 但 loaded 必须不同 —— 这是"没数据"与"数据里没有"的唯一区分点
    expect(notLoaded.loaded).toBe(false)
    expect(unknown.loaded).toBe(true)
    // ★关键：调用方声明"未加载"时，**即便手里有数据也不许拿它回答**——
    //   否则调用方的一次加载失败会得到"看起来正常"的答案（最坏的那种错）。
    const suppressed = affectedDevicesOf(entries, 'clipboard', false)
    expect(suppressed.known).toBe(false)
    expect(suppressed.deviceClasses).toEqual([])
  })

  it('④ 有定义但 platforms 为空 ⇒ 空数组（事实），不是数据缺失', () => {
    const { entries: e } = parseCapabilityManifest({ capabilities: [{ id: 'x', tier: 1, platforms: [], source: 'x.ts' }] })
    const r = affectedDevicesOf(e, 'x')
    expect(r.known).toBe(true)
    expect(r.deviceClasses).toEqual([])
  })

  it('⑤ 坏数据不静默：platforms 非数组 ⇒ 归一为 [] 且记 malformed；缺 id ⇒ 丢弃并记录', () => {
    const { entries: e, malformed } = parseCapabilityManifest({
      capabilities: [
        { id: 'bad-platforms', tier: 1, platforms: 'web', source: 'a.ts' },
        { tier: 2, platforms: ['web'], source: 'b.ts' },
      ],
    })
    expect(e.map((x) => x.id)).toEqual(['bad-platforms'])
    expect(e[0]!.platforms).toEqual([])
    expect(malformed.length).toBe(2)
    expect(malformed.join('\n')).toContain('bad-platforms')
  })

  it('⑥ 摘要按端计数，并点名未登记端（web/skyline/app 之外的端不静默吞）', () => {
    const s = summarizeCapabilities([
      { id: 'a', tier: 1, platforms: ['web', 'desktop'], source: '' },
      { id: 'b', tier: 2, platforms: ['web'], source: '' },
    ])
    expect(s.total).toBe(2)
    expect(s.byDeviceClass).toEqual({ web: 2, desktop: 1 })
    expect(s.unknownDeviceClasses).toEqual(['desktop'])
    expect(s.ids).toEqual(['a', 'b'])
  })

  it('⑦ provider 集成：不传清单 ⇒ loaded=false（不假装"无影响面"）；传了才可查', () => {
    const p0 = createKnowledgeProvider([])
    expect(p0.affectedDevices('clipboard').loaded).toBe(false)
    const p1 = createKnowledgeProvider([], manifest)
    expect(p1.affectedDevices('clipboard').deviceClasses).toEqual(['skyline', 'web'])
    expect(p1.capabilitiesSummary().total).toBe(2)
  })
})
