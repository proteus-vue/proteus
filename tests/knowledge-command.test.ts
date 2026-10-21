// tests/knowledge-command.test.ts
// ★★G-54 M0 命令面判据（决策 #1153）：`proteus knowledge <layers|graph|check|why>`
//
// 【为什么单列一个测试文件（而不是塞进 knowledge-kernel.test.ts）】
//   内核判据（23 条）测的是**算法**（分层判定 / 环检测 / 反向依赖）；
//   本文件测的是**命令面契约**（退出码 / `--json` 纯管道 / 缺登记必须红 / 未实现能力不假装）。
//   两类失效模式不同，混在一起会让"算法绿"掩盖"CLI 静默返回空结果"。
//
// 【本文件重点防的四种假绿】
//   ① 在非仓库目录跑出空图 ⇒ 报"0 违规"（空集恒真）——必须抛错，不是绿；
//   ② `--json` 里混进人类提示 ⇒ `JSON.parse(全部 stdout)` 失败（CI/IDE 管道断）；
//   ③ 新包漏登记 ⇒ 命令仍绿（对越层诊断失明）；
//   ④ 未实现的四个能力被当成"未知子命令"（用户以为拼错了）——必须明说"未实现"。

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, afterAll, describe, expect, it, vi } from 'vitest'
import { runKnowledgeCommand, resolvePackagesDir } from '../packages/cli/src/knowledge/command'

const REPO_ROOT = path.resolve(__dirname, '..')

/** 捕获 stdout（console.log）——命令面唯一的输出通道 */
function capture(): { logs: string[]; restore: () => void } {
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })
  return {
    logs,
    restore: () => {
      spy.mockRestore()
      errSpy.mockRestore()
    },
  }
}

const tmpDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
})

/** 造一个人造 packages/ 目录（每个元素 = 目录名，无内部依赖） */
function makePackagesDir(dirs: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'proteus-knowledge-cmd-'))
  tmpDirs.push(root)
  const pkgs = path.join(root, 'packages')
  mkdirSync(pkgs)
  for (const d of dirs) {
    const p = path.join(pkgs, d)
    mkdirSync(p)
    writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: `@proteus-vue/${d}`, version: '0.0.0' }))
  }
  return pkgs
}

describe('proteus knowledge · 仓库定位', () => {
  it('★非仓库目录下不返回空图（空集会输出"0 违规"的假绿），而是抛错并给 --packages 修法', () => {
    // ★不 chdir（vitest worker 不支持）；直接注入起点目录——resolvePackagesDir 为此显式收 startDir
    const nowhere = mkdtempSync(path.join(tmpdir(), 'proteus-knowledge-nowhere-'))
    tmpDirs.push(nowhere)
    expect(() => resolvePackagesDir(undefined, nowhere)).toThrow(/--packages/)
  })

  it('★向上查找要能命中真实仓库根（从任意子目录启动都能定位）', () => {
    const sub = path.join(REPO_ROOT, 'packages', 'cli', 'src')
    expect(resolvePackagesDir(undefined, sub)).toBe(path.join(REPO_ROOT, 'packages'))
  })

  it('--packages 指向不存在的目录 ⇒ 抛错（不静默降级）', () => {
    expect(() => resolvePackagesDir('/nonexistent/proteus/packages')).toThrow(/不存在/)
  })
})

describe('proteus knowledge layers', () => {
  it('真实仓库：磁盘包数与表内登记一致，且每层非空（分层表不是空壳）', async () => {
    const c = capture()
    const rc = await runKnowledgeCommand(['layers', '--json', '--packages', path.join(REPO_ROOT, 'packages')])
    c.restore()
    expect(rc).toBe(0)
    const j = JSON.parse(c.logs.join('\n'))
    expect(j.onDisk).toBeGreaterThan(40)
    expect(j.onDisk).toBe(j.registered)
    expect(j.missing).toEqual([])
    expect(j.ghosts).toEqual([])
    expect(j.layers.map((l: { layer: string }) => l.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'])
    for (const l of j.layers) expect(l.packages.length, `${l.layer} 是空层`).toBeGreaterThan(0)
  })

  it('★漏登记必须红：磁盘多出一个未定层的包 ⇒ exit 1 且点名它', async () => {
    const pkgs = makePackagesDir(['contracts', 'zzz-unregistered'])
    const c = capture()
    const rc = await runKnowledgeCommand(['layers', '--packages', pkgs])
    c.restore()
    expect(rc).toBe(1)
    const out = c.logs.join('\n')
    expect(out).toContain('zzz-unregistered')
    expect(out).toMatch(/漏登记/)
  })

  it('★幽灵条目必须红：分层表里有、磁盘上已不存在的包 ⇒ exit 1（过期索引比没有更糟 · #1139）', async () => {
    // 只放 contracts：表里另外 47 项全部成为幽灵
    const pkgs = makePackagesDir(['contracts'])
    const c = capture()
    const rc = await runKnowledgeCommand(['layers', '--packages', pkgs])
    c.restore()
    expect(rc).toBe(1)
    expect(c.logs.join('\n')).toMatch(/幽灵条目/)
  })
})

describe('proteus knowledge graph', () => {
  it('真实仓库：48 节点 / 78 边 / 无环无自环（与内核测试同源，但走命令面）', async () => {
    const c = capture()
    const rc = await runKnowledgeCommand(['graph', '--json', '--packages', path.join(REPO_ROOT, 'packages')])
    c.restore()
    expect(rc).toBe(0)
    const j = JSON.parse(c.logs.join('\n'))
    expect(j.nodes).toBe(48)
    expect(j.edges).toBe(78)
    expect(j.cycles).toEqual([])
    expect(j.selfLoops).toEqual([])
    expect(j.inDegreeTop[0].pkg).toBe('contracts')
  })

  it('--reverse 反查被依赖者（改动波及面）；未知节点 ⇒ exit 1', async () => {
    const pkgs = path.join(REPO_ROOT, 'packages')
    let c = capture()
    let rc = await runKnowledgeCommand(['graph', '--json', '--reverse', 'contracts', '--packages', pkgs])
    c.restore()
    expect(rc).toBe(0)
    const j = JSON.parse(c.logs.join('\n'))
    expect(j.reverseOf.pkg).toBe('contracts')
    expect(j.reverseOf.dependents.length).toBeGreaterThan(0)

    c = capture()
    rc = await runKnowledgeCommand(['graph', '--reverse', 'no-such-pkg', '--packages', pkgs])
    c.restore()
    expect(rc).toBe(1)
  })

  it('人造成环 ⇒ exit 1（命令面不听信内核，独立判红）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'proteus-knowledge-cycle-'))
    tmpDirs.push(root)
    const pkgs = path.join(root, 'packages')
    mkdirSync(pkgs)
    for (const [dir, dep] of [
      ['contracts', 'types'],
      ['types', 'contracts'],
    ] as const) {
      mkdirSync(path.join(pkgs, dir))
      writeFileSync(
        path.join(pkgs, dir, 'package.json'),
        JSON.stringify({ name: `@proteus-vue/${dir}`, version: '0.0.0', dependencies: { [`@proteus-vue/${dep}`]: 'workspace:*' } }),
      )
    }
    const c = capture()
    const rc = await runKnowledgeCommand(['graph', '--packages', pkgs])
    c.restore()
    expect(rc).toBe(1)
    expect(c.logs.join('\n')).toMatch(/成环/)
  })
})

describe('proteus knowledge check', () => {
  it('真实仓库：0 越层；--json 的 stdout 必须能被 JSON.parse 整体解析（纯管道）', async () => {
    const c = capture()
    const rc = await runKnowledgeCommand(['check', '--json', '--packages', path.join(REPO_ROOT, 'packages')])
    c.restore()
    expect(rc).toBe(0)
    const j = JSON.parse(c.logs.join('\n')) // ★整体解析：混进任何提示语都会在这里炸
    expect(j.kind).toBe('knowledge.check')
    expect(j.ok).toBe(true)
    expect(j.prod).toEqual([])
    expect(j.missing).toEqual([])
  })

  it('★人造向上越层 ⇒ exit 1 并点名两边（判据不是恒真：换入错误数据必须变红）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'proteus-knowledge-up-'))
    tmpDirs.push(root)
    const pkgs = path.join(root, 'packages')
    mkdirSync(pkgs)
    // contracts(L0) 依赖 cli(L3) —— 典型向上越层
    for (const [dir, dep] of [
      ['contracts', 'cli'],
      ['cli', null],
    ] as const) {
      mkdirSync(path.join(pkgs, dir))
      writeFileSync(
        path.join(pkgs, dir, 'package.json'),
        JSON.stringify({
          name: `@proteus-vue/${dir}`,
          version: '0.0.0',
          ...(dep ? { dependencies: { [`@proteus-vue/${dep}`]: 'workspace:*' } } : {}),
        }),
      )
    }
    const c = capture()
    const rc = await runKnowledgeCommand(['check', '--packages', pkgs])
    c.restore()
    expect(rc).toBe(1)
    const out = c.logs.join('\n')
    expect(out).toMatch(/越层/)
    expect(out).toContain('contracts')
    expect(out).toContain('cli')
  })

  it('--dev 只报告 devDeps 向上引用、不判红（口径显式，与生产边分开）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'proteus-knowledge-dev-'))
    tmpDirs.push(root)
    const pkgs = path.join(root, 'packages')
    mkdirSync(pkgs)
    for (const [dir, dev] of [
      ['contracts', { '@proteus-vue/cli': 'workspace:*' }],
      ['cli', undefined],
    ] as const) {
      mkdirSync(path.join(pkgs, dir))
      writeFileSync(
        path.join(pkgs, dir, 'package.json'),
        JSON.stringify({ name: `@proteus-vue/${dir}`, version: '0.0.0', ...(dev ? { devDependencies: dev } : {}) }),
      )
    }
    const c = capture()
    const rc = await runKnowledgeCommand(['check', '--dev', '--packages', pkgs])
    c.restore()
    expect(rc, 'devDeps 上升不应判红（测试框架引 CLI 是正常的）').toBe(0)
    expect(c.logs.join('\n')).toMatch(/信息位|devDeps/)
  })
})

describe('proteus knowledge why', () => {
  it('向上依赖 ⇒ UPWARD + exit 1；向下依赖 ⇒ OK + exit 0', async () => {
    let c = capture()
    let rc = await runKnowledgeCommand(['why', 'web', 'cli']) // L2 → L3
    c.restore()
    expect(rc).toBe(1)
    expect(c.logs.join('\n')).toContain('UPWARD')

    c = capture()
    rc = await runKnowledgeCommand(['why', 'cli', 'contracts']) // L3 → L0
    c.restore()
    expect(rc).toBe(0)
    expect(c.logs.join('\n')).toContain('OK')
  })

  it('★未登记包 ⇒ UNKNOWN（不兜底 L0 后报"合法"）', async () => {
    const c = capture()
    const rc = await runKnowledgeCommand(['why', 'web', 'ghost-pkg'])
    c.restore()
    expect(rc).toBe(1)
    expect(c.logs.join('\n')).toContain('UNKNOWN')
  })
})

describe('proteus knowledge · 入口契约', () => {
  it('无参数 / help ⇒ 打印帮助且 exit 0（不静默什么都不做）', async () => {
    for (const argv of [[], ['help'], ['--help']] as string[][]) {
      const c = capture()
      const rc = await runKnowledgeCommand(argv)
      c.restore()
      expect(rc).toBe(0)
      expect(c.logs.join('\n')).toMatch(/proteus knowledge/)
    }
  })

  it('★未实现的四个能力要明说"未实现"，不能当成"未知子命令"（否则用户以为拼错）', async () => {
    const c = capture()
    const rc = await runKnowledgeCommand(['call', 'foo'])
    c.restore()
    expect(rc).toBe(1)
    const out = c.logs.join('\n')
    expect(out).toMatch(/尚未实现/)
    expect(out).toContain('resolveCall')
  })

  it('随便一个乱写的子命令 ⇒ exit 1 且列出支持项', async () => {
    const c = capture()
    const rc = await runKnowledgeCommand(['nonsense'])
    c.restore()
    expect(rc).toBe(1)
    expect(c.logs.join('\n')).toContain('layers')
  })
})
