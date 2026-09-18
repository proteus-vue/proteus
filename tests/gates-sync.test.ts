// tests/gates-sync.test.ts
// ★门禁通道一致性回归锁（2026-09-18）。
//
// 背景：CI 与本地 `pnpm verify` 曾是**两套重叠但不一致**的门禁集，各自都不完整，且缺的
//   正好是对方的强项——CI 有 vue-tsc/build-packages 而 verify 没有（本地「全绿」掩盖 tsc
//   才暴露的类型错误，实测 TS2322 漏到 CI）；verify 有 check:mp-attrs（主属性棘轮）而 CI 没有
//   （属性覆盖回退可推上去而 CI 不拦）。根因是「接线」靠人工记忆、无机器校验。
//
// 本测试把接线要求固化为断言，防止上述分叉复发。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const WF_DIR = path.join(ROOT, '.github', 'workflows')
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>

const CI_TEXT = fs
  .readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => fs.readFileSync(path.join(WF_DIR, f), 'utf8'))
  .join('\n')

/** 递归判断某 check:* 是否被 CI 引用（含经 pnpm run 的间接引用） */
function coveredByCi(name: string): boolean {
  if (CI_TEXT.includes(name)) return true
  const cmd = scripts[name] ?? ''
  const files = cmd.match(/(?:^|\s)(?:npx\s+tsx\s+)?(?:scripts|website\/scripts)\/[\w./-]+\.(?:mjs|ts|js)/g) ?? []
  if (files.some((f) => CI_TEXT.includes(f.trim()))) return true
  const subs = cmd.match(/pnpm run (check:[\w-]+)/g)?.map((m) => m.replace('pnpm run ', '')) ?? []
  return subs.some((s) => scripts[s] && coveredByCi(s))
}

describe('★门禁通道一致性（CI ⟷ verify 不得分叉）', () => {
  it('每个 check:* 脚本都被 CI 引用（新增门禁必须接线）', () => {
    const unwired = Object.keys(scripts)
      .filter((k) => k.startsWith('check:'))
      .filter((k) => !coveredByCi(k))
    expect(unwired, `未接入任何 workflow：${unwired.join(', ')}（接线或登记 LOCAL_ONLY）`).toEqual([])
  })

  it('★verify 链含 build-packages + 根 vue-tsc（本地无类型盲区）', () => {
    const verify = scripts.verify ?? ''
    expect(verify, 'verify 缺 build-packages（vue-tsc 需 dist）').toContain('build-packages')
    expect(verify, 'verify 缺根 vue-tsc').toMatch(/vue-tsc --noEmit/)
  })

  it('★CI 含属性棘轮与降级门禁（主标尺不得被删/漏接线）', () => {
    for (const pat of ['audit-component-attrs.mjs', 'audit-degradation.mjs', 'check-consistency.js']) {
      expect(CI_TEXT, `CI 缺 ${pat}`).toContain(pat)
    }
  })

  it('CI 含 build-packages + vue-tsc（构建与类型检查不可缺席）', () => {
    expect(CI_TEXT).toContain('build-packages')
    expect(CI_TEXT).toMatch(/vue-tsc --noEmit/)
  })

  it('破坏性语义：本测试的判定逻辑确实能发现未接线脚本', () => {
    // 模拟一个未接线的脚本名 → coveredByCi 应为 false（证明断言不是恒真）
    expect(coveredByCi('check:definitely-not-wired-xyz')).toBe(false)
    // 已接线的应命中（证明不是恒假）
    expect(coveredByCi('check:degradation')).toBe(true)
  })
})
