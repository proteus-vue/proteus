// tests/dist-freshness.test.ts —— ★★★CLI 启动期「陈旧 dist」守卫（2026-10-08 · 决策 #663）
//
// 【本项修的是什么】用户实测：改了 `packages/cli/src` 后 `npx proteus dev --target android`
//   **仍启动 web**——因为 `npx proteus` 走 `packages/cli/dist/index.js`（旧产物），而手测 `tsx src` 正常
//   （假绿）。守卫在从 dist 运行时检查「有 build 脚本的包是否 dist 存在且 newest(src) ≤ newest(dist)」，
//   陈旧则 stderr 告警（不阻断）。
//
// 判据（纯逻辑，零工具链）：用临时 fixture 复现四种形态（新鲜 / src 新 / dist 缺失 / 纯源码包）。
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { findStalePackages, formatStaleWarning, isRunningFromDist, repoRootFromHere, assertDistFreshForDeviceBuild } from '../packages/cli/src/dist-freshness'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-distfresh-'))
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

/** 造一个 workspace 包：pkgName + buildScript? + src 文件 mtime + dist 文件 mtime */
function mkPkg(root: string, pkg: string, opts: { build?: boolean; srcMtime?: number; distMtime?: number | null }) {
  const dir = path.join(root, 'packages', pkg)
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: `@proteus-vue/${pkg}`, scripts: opts.build === false ? {} : { build: 'echo build' } }),
  )
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const x = 1\n')
  if (opts.srcMtime) fs.utimesSync(path.join(dir, 'src', 'index.ts'), opts.srcMtime / 1000, opts.srcMtime / 1000)
  if (opts.distMtime !== null) {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'export const x = 1\n')
    if (opts.distMtime) fs.utimesSync(path.join(dir, 'dist', 'index.js'), opts.distMtime / 1000, opts.distMtime / 1000)
  }
}

describe('★陈旧 dist 守卫 · 判据', () => {
  const root = path.join(TMP, 'repo-a')
  mkPkg(root, 'fresh', { srcMtime: 1_000_000, distMtime: 2_000_000 })   // dist 更新 → 新鲜
  mkPkg(root, 'stale', { srcMtime: 2_000_000, distMtime: 1_000_000 })   // src 更新 → 陈旧
  mkPkg(root, 'nobuild', { build: false, srcMtime: 2_000_000, distMtime: 1_000_000 }) // 无 build → 不参与
  mkPkg(root, 'nodist', { srcMtime: 2_000_000, distMtime: null })       // dist 缺失 → 不算（import 会 loud 报错；如 cargo 型包）

  it('只挑出「src 比 dist 新」；dist 更新的、无 build 脚本的、dist 缺失的不报', () => {
    const stale = findStalePackages(root)
    const byName = Object.fromEntries(stale.map((s) => [s.pkg, s.reason]))
    expect(Object.keys(byName)).toEqual(['stale'])
    expect(byName.stale).toContain('src 比 dist 新')
    expect(byName.fresh).toBeUndefined()
    expect(byName.nobuild).toBeUndefined()
    expect(byName.nodist).toBeUndefined()
  })

  it('全新鲜 → 空数组（无告警）', () => {
    const root2 = path.join(TMP, 'repo-b')
    mkPkg(root2, 'a', { srcMtime: 1_000_000, distMtime: 2_000_000 })
    expect(findStalePackages(root2)).toEqual([])
    expect(formatStaleWarning([])).toBeNull()
  })

  it('发布形态（无 packages/ 目录）→ 空数组、不报错', () => {
    const emptyRoot = path.join(TMP, 'no-packages')
    fs.mkdirSync(emptyRoot, { recursive: true })
    expect(findStalePackages(emptyRoot)).toEqual([])
  })

  it('告警文本含包名 + 修复命令（可直接照做）', () => {
    const w = formatStaleWarning([{ pkg: 'cli', reason: 'src 比 dist 新（改了源码未重建）' }])
    expect(w).toContain('cli')
    expect(w).toContain('node scripts/build-packages.mjs')
  })
})

describe('★陈旧 dist 守卫 · 「是否从 dist 运行」判别（tsx src 下不该误报）', () => {
  it('dist/index.js ⇒ true；src/index.ts ⇒ false', () => {
    expect(isRunningFromDist(pathToFileURL('/x/packages/cli/dist/index.js').href)).toBe(true)
    expect(isRunningFromDist(pathToFileURL('/x/packages/cli/src/index.ts').href)).toBe(false)
  })
  it('repoRootFromHere：先取模块所在目录（<root>/packages/cli/★）再上三级 = 仓库根', () => {
    expect(repoRootFromHere(pathToFileURL('/x/repo/packages/cli/dist/index.js').href)).toBe('/x/repo')
    expect(repoRootFromHere(pathToFileURL('/x/repo/packages/cli/src/index.ts').href)).toBe('/x/repo')
  })
})

describe('★★设备产物命令硬化门（#801）：dev/build 从 dist 运行且陈旧 ⇒ 抛错阻断；其余命令/显式绕过放行', () => {
  /** 造 fixture 仓库：一个有 build 脚本的包，src 比 dist 新（陈旧） */
  function mkStaleRepo(tag: string): string {
    const root = path.join(TMP, 'devgate-' + tag)
    const dir = path.join(root, 'packages', 'cli', 'dist')
    fs.mkdirSync(dir, { recursive: true })
    mkPkg(root, 'somepkg', { srcMtime: Date.now() + 60_000, distMtime: Date.now() })
    return root
  }
  // assertDistFreshForDeviceBuild 用 metaUrl 推导 repoRoot：把 dist/index.js 摆进 fixture 再传其 URL
  function metaUrlOf(root: string): string {
    const f = path.join(root, 'packages', 'cli', 'dist', 'index.js')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, '// fixture\n')
    return pathToFileURL(f).href
  }

  it('dev（陈旧 + 从 dist 运行）⇒ 抛错（不再是告警级——产物会静默携带旧框架代码）', () => {
    const root = mkStaleRepo('dev')
    expect(() => assertDistFreshForDeviceBuild('dev', metaUrlOf(root))).toThrow(/dist 陈旧/)
  })

  it('build（同上）⇒ 抛错', () => {
    const root = mkStaleRepo('build')
    expect(() => assertDistFreshForDeviceBuild('build', metaUrlOf(root))).toThrow(/dist 陈旧/)
  })

  it('显式绕过 PROTEUS_ALLOW_STALE_DIST=1 ⇒ 放行', () => {
    const root = mkStaleRepo('bypass')
    const prev = process.env.PROTEUS_ALLOW_STALE_DIST
    process.env.PROTEUS_ALLOW_STALE_DIST = '1'
    try {
      expect(() => assertDistFreshForDeviceBuild('dev', metaUrlOf(root))).not.toThrow()
    } finally {
      if (prev === undefined) delete process.env.PROTEUS_ALLOW_STALE_DIST
      else process.env.PROTEUS_ALLOW_STALE_DIST = prev
    }
  })

  it('无关命令（doctor / help）⇒ 不检查、不抛', () => {
    const root = mkStaleRepo('other')
    const meta = metaUrlOf(root)
    expect(() => assertDistFreshForDeviceBuild('doctor', meta)).not.toThrow()
    expect(() => assertDistFreshForDeviceBuild('help', meta)).not.toThrow()
    expect(() => assertDistFreshForDeviceBuild(undefined, meta)).not.toThrow()
  })

  it('★从 src 运行（tsx 形态）⇒ 不检查（"src 比 dist 新"是预期，不是陈旧）', () => {
    const root = mkStaleRepo('srccase')
    const f = path.join(root, 'packages', 'cli', 'src', 'index.ts')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, '// fixture\n')
    expect(() => assertDistFreshForDeviceBuild('dev', pathToFileURL(f).href)).not.toThrow()
  })

  it('新鲜（dist 比 src 新）⇒ 放行', () => {
    const root = path.join(TMP, 'devgate-fresh')
    fs.mkdirSync(path.join(root, 'packages', 'cli', 'dist'), { recursive: true })
    mkPkg(root, 'somepkg', { srcMtime: Date.now() - 60_000, distMtime: Date.now() })
    expect(() => assertDistFreshForDeviceBuild('dev', metaUrlOf(root))).not.toThrow()
  })
})

describe('★陈旧 dist 守卫 · 真实仓库不崩（守卫生效但不阻断主流程）', () => {
  it('findStalePackages(真实仓库根) 返回数组（可为空，但不得抛错）', () => {
    const repoRoot = path.resolve(__dirname, '..')
    const stale = findStalePackages(repoRoot)
    expect(Array.isArray(stale)).toBe(true)
    // 每个条目结构正确
    for (const s of stale) {
      expect(typeof s.pkg).toBe('string')
      expect(typeof s.reason).toBe('string')
    }
  })
})
