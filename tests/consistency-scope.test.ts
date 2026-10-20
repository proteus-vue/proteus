// tests/consistency-scope.test.ts
// ★scripts/check-consistency.js 的 scope 残留规则回归门禁。
// 背景（2026-09-18）：该规则此前「全页 grep 任何「@proteus/<包名>」即失败」，而 fork 指纹检测样本
//   （container/core）、生态示例名（backend-* / plugin-* 等规划命名）与历史写法（compat-miniprogram
//   旧 scope 形式）是合法文本 → 40 项假红从 2026-09-12 起持续 6 天，真 drift 反而淹没在噪声里。
//   ★教训：门禁本身必须有测试，否则「规则写错」无人发现。
// 本测试锁定双向：合法豁免通过，真实旧 scope 仍必须失败（防豁免表过宽变成假绿）。
// ★本文件自身在扫描范围内（.ts）——故此处及全文都不出现字面量旧 scope token（见下方 oldScope 说明）。
//
// 【★★★#1132：为什么规则自测要扫**临时夹具**而不是全仓（用户点名「前后跑了好几轮全量测试，
//   测试占用的时间太久了」）】
//   本文件原先 6 条规则自测**每条都扫全仓**（`--scope` 无 --root）：真仓 15k+ 文件、单次 ~6 秒
//   ⇒ 本文件独占 **45.5 秒**，占全量套件墙钟的 1/3（498 个测试文件里排第一）。
//   ★根因不是"扫描慢"，而是**判据拿全仓当夹具**——规则自证只需要"一个探针文件"的目录。
//   ⇒ `check-consistency.js` 加 `--root=<dir>`：规则自测扫临时夹具（**0.04 秒**，150 倍差距）；
//     只有「真仓干净」那一条仍扫全仓——它验的正是**真实仓库**，换夹具就成了假绿。
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

/** 规则自测用的临时夹具根（**不污染真仓**，也不再让真仓参与规则判定） */
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-rule-'))

// ★本文件自身在扫描范围内（.ts），故不允许出现字面量 @proteus/<x> 旧 scope——
//   否则测试源码会成为假红来源。用运行时拼接构造样本 token。
const oldScope = (pkg: string) => '@' + 'proteus/' + pkg

/**
 * 跑 `--scope`，返回退出码与输出（不抛）。
 *
 * @param opts.root 扫描根；缺省 = 真仓（只有「真仓干净」那一条用）
 */
function runScope(opts: { root?: string } = {}): { code: number; out: string } {
  const args = ['scripts/check-consistency.js', '--scope', ...(opts.root ? [`--root=${opts.root}`] : [])]
  try {
    const out = execFileSync('node', args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** 写探针（到夹具根；`rel` 可指定子路径以验路径豁免规则） */
function writeProbe(content: string, rel = 'probe.ts'): string {
  const abs = path.join(FIXTURE_ROOT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

/** 清空夹具（每条用例独立，避免上一条的探针影响下一条） */
function clearProbes(): void {
  for (const e of fs.readdirSync(FIXTURE_ROOT)) fs.rmSync(path.join(FIXTURE_ROOT, e), { recursive: true, force: true })
}

afterAll(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

describe('★check-consistency scope 规则', () => {
  it('★真仓干净 → 通过（无假红）——**唯一扫全仓**的一条（它验的就是真实仓库）', () => {
    const { code, out } = runScope()
    expect(code, `真仓有残留：\n${out}`).toBe(0)
  })

  it('未知旧 scope → 失败（真实 drift 仍被抓住）', () => {
    clearProbes()
    const token = oldScope('bogus-pkg')
    writeProbe(`import x from '${token}'\n`)
    const { code, out } = runScope({ root: FIXTURE_ROOT })
    expect(code).toBe(1)
    expect(out).toContain(token)
  })

  it('源码目录中的 compat-miniprogram 旧写法 → 失败（路径豁免不越界到源码）', () => {
    clearProbes()
    // ★放在 `packages/` 下——这正是豁免表里"仅限 docs/examples"的路径规则要拦的位置
    writeProbe(`import x from '${oldScope('compat-miniprogram')}'\n`, 'packages/some-pkg/src/probe.ts')
    const { code, out } = runScope({ root: FIXTURE_ROOT })
    expect(code, `源码目录里的旧写法应失败：\n${out}`).toBe(1)
  })

  it('行内 scope-allow 无理由 → 失败（不允许空理由豁免）', () => {
    clearProbes()
    writeProbe(`import x from '${oldScope('bogus2')}'\n// scope-allow:\n`)
    const { code } = runScope({ root: FIXTURE_ROOT })
    expect(code).toBe(1)
  })

  it('行内 scope-allow 含理由 → 通过', () => {
    clearProbes()
    writeProbe(`import x from '${oldScope('bogus3')}' // scope-allow: 测试样本，非真实依赖\n`)
    const { code, out } = runScope({ root: FIXTURE_ROOT })
    expect(code, `带理由应豁免：\n${out}`).toBe(0)
  })

  it('@proteus-vue/* 一律合法（组织 scope 本身不被误伤）', () => {
    clearProbes()
    writeProbe("import x from '@proteus-vue/runtime'\n")
    const { code } = runScope({ root: FIXTURE_ROOT })
    expect(code).toBe(0)
  })

  it('★破坏性：夹具里放真实 drift ⇒ 必须红（证明"扫夹具"没有退化成空扫）', () => {
    clearProbes()
    writeProbe(`import x from '${oldScope('definitely-drift')}'\n`, 'docs/probe.md')
    const { code, out } = runScope({ root: FIXTURE_ROOT })
    expect(code, `★如果这里是 0，说明 --root 没生效（空扫 = 假绿）：\n${out}`).toBe(1)
  })
})
