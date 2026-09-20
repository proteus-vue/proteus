// tests/publish-contents.test.ts
// ★2026-09-20 事故的回归锁：`@proteus-vue/components@0.3.0-beta.7` 全量发布时
//   丢了**全部 74 个 p-* 组件**（registry tarball 只有 17 个文件）——任何工程 import 组件库
//   构建立即失败（`Could not resolve "./p-view/index.vue"`），而四道既有门禁全部放行。
//
//   根因两层：① `files` 里写纯目录通配 `"p-*"`，**npm 打包器不展开它**（pnpm 才展开）；
//             ② 各门禁查的都是「我声明的」，没有一道查「实际打出去的包里有什么」。
//
// 本测试锁三件事（前两件是事故的直接成因，第三件是防腐）：
//   ① `files` 不得出现「纯目录通配」（须 `dir/**`）——该写法在 npm 打包器下静默丢件；
//   ② 本仓发布链固定用 **pnpm** 打包（scripts/lib/pack-package.mjs），且发布器不再直接 npm publish 目录；
//   ③ 内容门禁（check-publish-contents）对本仓真实包的实际输出为「全绿」。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKGS = path.join(ROOT, 'packages')

function pkgDirs(): Array<{ dir: string; name: string; files: string[]; version: string }> {
  const out = []
  for (const d of fs.readdirSync(PKGS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    const f = path.join(PKGS, d.name, 'package.json')
    if (!fs.existsSync(f)) continue
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (!j.name?.startsWith('@proteus-vue/')) continue
    out.push({ dir: path.join(PKGS, d.name), name: j.name, files: j.files ?? [], version: j.version })
  }
  return out
}

/** 纯目录通配（如 `p-*`）：不带 `/` 后的内容、也不带 `**` —— npm 打包器不会展开它 */
function isBareDirGlob(entry: string): boolean {
  if (!entry.includes('*')) return false
  if (entry.includes('**')) return false
  return !entry.slice(entry.indexOf('*')).includes('/')
}

describe('发布物打包（2026-09-20 组件全丢事故的回归锁）', () => {
  it('所有包的 files 不含「纯目录通配」——npm 打包器不展开它（事故直接成因）', () => {
    const offenders: string[] = []
    for (const p of pkgDirs()) {
      for (const entry of p.files) if (isBareDirGlob(entry)) offenders.push(`${p.name}: "${entry}"`)
    }
    expect(offenders, `这些 files 项在 npm 打包器下会静默丢件，须写成 "dir/**"：\n${offenders.join('\n')}`).toEqual([])
  })

  it('components 的 files 用 p-*/**（74 个组件必须真的进包）', () => {
    const c = pkgDirs().find((p) => p.name === '@proteus-vue/components')
    expect(c, '未找到 components 包').toBeTruthy()
    expect(c!.files).toContain('p-*/**')
    expect(c!.files).not.toContain('p-*')
  })

  it('发布器（publish-all.sh）用 pnpm 打包 + npm 上传 tarball，不再 npm publish 包目录', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-all.sh'), 'utf8')
    // ① 打包走本仓唯一实现（内部 pnpm pack）
    expect(sh).toContain('scripts/lib/pack-package.mjs')
    // ② 上传的是 **tarball 路径**——`npm publish "$tgz"`（而不是在包目录里 `npm publish`，
    //    后者会让 npm 用**它自己**的打包器决定包内容，正是事故成因）
    expect(sh).toMatch(/npm publish "\$tgz"/)
  })

  it('漂移判定与发布同源（pnpm 打包）——否则「两侧都缺件」会被误判为一致', () => {
    const drift = fs.readFileSync(path.join(ROOT, 'scripts', 'check-publish-drift.mjs'), 'utf8')
    expect(drift).toContain('lib/pack-package.mjs')
    // 不得再用 npm pack 取「本地将发布的内容」
    expect(drift).not.toMatch(/execFileSync\('npm',\s*\['pack'/)
  })

  it('pack-package 用 pnpm 打包，且对同一份输入字节确定（integrity 可与 registry 比对）', async () => {
    // 该工具是无类型声明的 .mjs（纯 JS 工具链脚本），此处按结构断言使用
    const mod = (await import('../scripts/lib/pack-package.mjs')) as {
      packPackage: (dir: string) => { integrity: string; files: string[]; dest: string; ownedDest: boolean }
      cleanupPack: (p: unknown) => void
    }
    const compsDir = path.join(PKGS, 'components')
    const a = mod.packPackage(compsDir)
    const b = mod.packPackage(compsDir)
    try {
      expect(a.integrity).toBe(b.integrity)
      // ★事故形态的直接否定：74 个 p-* 组件必须在包内
      const pComps = a.files.filter((f: string) => /^p-[^/]+\/index\.vue$/.test(f))
      const onDisk = fs.readdirSync(compsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('p-') && fs.existsSync(path.join(compsDir, e.name, 'index.vue'))).length
      expect(pComps.length).toBe(onDisk)
      expect(pComps.length).toBeGreaterThan(70)
    } finally {
      mod.cleanupPack(a)
      mod.cleanupPack(b)
    }
  }, 120_000)

  it('内容门禁对本仓实际包全绿（files 命中 / 入口 / 相对 import 闭包）', () => {
    const out = execFileSync('node', [path.join(ROOT, 'scripts', 'check-publish-contents.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    expect(out).toContain('个包：files 声明全部命中')
  }, 300_000)
})
