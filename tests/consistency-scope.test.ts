// tests/consistency-scope.test.ts
// ★scripts/check-consistency.js 的 scope 残留规则回归门禁。
// 背景（2026-09-18）：该规则此前「全页 grep 任何「@proteus/<包名>」即失败」，而 fork 指纹检测样本
//   （container/core）、生态示例名（backend-* / plugin-* 等规划命名）与历史写法（compat-miniprogram
//   旧 scope 形式）是合法文本 → 40 项假红从 2026-09-12 起持续 6 天，真 drift 反而淹没在噪声里。
//   ★教训：门禁本身必须有测试，否则「规则写错」无人发现。
// 本测试锁定双向：合法豁免通过，真实旧 scope 仍必须失败（防豁免表过宽变成假绿）。
// ★本文件自身在扫描范围内（.ts）——故此处及全文都不出现字面量旧 scope token（见下方 oldScope 说明）。
import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_DIR = path.join(ROOT, 'tests', '__scope_fixture__')
const FIXTURE = path.join(FIXTURE_DIR, 'probe.ts')

// ★本文件自身在扫描范围内（.ts），故不允许出现字面量 @proteus/<x> 旧 scope——
//   否则测试源码会成为假红来源。用运行时拼接构造样本 token。
const oldScope = (pkg: string) => '@' + 'proteus/' + pkg

/** 跑 `--scope`，返回退出码与输出（不抛） */
function runScope(): { code: number; out: string } {
  try {
    const out = execFileSync('node', ['scripts/check-consistency.js', '--scope'], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

function writeProbe(content: string) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true })
  fs.writeFileSync(FIXTURE, content)
}

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true })
})

describe('★check-consistency scope 规则', () => {
  it('干净仓库 → 通过（无假红）', () => {
    const { code } = runScope()
    expect(code).toBe(0)
  })

  it('未知旧 scope → 失败（真实 drift 仍被抓住）', () => {
    const token = oldScope('bogus-pkg')
    writeProbe(`import x from '${token}'\n`)
    const { code, out } = runScope()
    expect(code).toBe(1)
    expect(out).toContain(token)
  })

  it('源码目录中的 compat-miniprogram 旧写法 → 失败（路径豁免不越界到源码）', () => {
    writeProbe(`import x from '${oldScope('compat-miniprogram')}'\n`)
    const { code } = runScope()
    expect(code).toBe(1)
  })

  it('行内 scope-allow 无理由 → 失败（不允许空理由豁免）', () => {
    writeProbe(`import x from '${oldScope('bogus2')}'\n// scope-allow:\n`)
    const { code } = runScope()
    expect(code).toBe(1)
  })

  it('行内 scope-allow 含理由 → 通过', () => {
    writeProbe(`import x from '${oldScope('bogus3')}' // scope-allow: 测试样本，非真实依赖\n`)
    const { code } = runScope()
    expect(code).toBe(0)
  })

  it('@proteus-vue/* 一律合法（组织 scope 本身不被误伤）', () => {
    writeProbe("import x from '@proteus-vue/runtime'\n")
    const { code } = runScope()
    expect(code).toBe(0)
  })
})
