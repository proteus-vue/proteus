import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// tests/deny-blind-tests-hook.test.ts
// ★★★决策 #1132：**全量测试拦截 hook 自身的判据**（用户点名「这次前后跑了好几轮全量测试，
// 测试占用的时间太久了」）。
//
// 【为什么 hook 也要被判据守】hook 是"工具层红线"，它一旦漏判就**静默失效**——
//   2026-10-02 那次 5 天静默失效（输出契约错误）就是同族。本轮实测出的是**判据覆盖面**问题：
//   `pnpm test` 之后的**任何**尾巴都被当"额外参数 ⇒ 定向跑"放行 ⇒ 最常见的两种写法全漏网：
//     `pnpm test > /tmp/x.log 2>&1`   （本会话就是这么跑的——落盘看日志）
//     `pnpm test 2>&1 | grep FAIL`     （过滤看失败）
//   同一代码状态连喂 4 条：带 `cd &&` 的被拦，带重定向/管道的**全放行**。
//
// 【判据口径】直接喂 hook 的 stdin 协议，**看退出码**（exit 2 = 拦截；0 = 放行）。
//   ★不要看 stdout 文本——2026-10-02 的教训就是"脚本自己打印了 deny"但客户端读的是另一套格式。
const ROOT = path.resolve(__dirname, '..')
const HOOK = path.join(ROOT, 'scripts', 'hooks', 'deny-blind-tests.mjs')

/** 喂一条 Bash 调用给 hook，返回退出码。 */
function feed(command: string, stateFile: string): number {
  try {
    execFileSync('node', [HOOK], {
      cwd: ROOT,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: ROOT }),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PROTEUS_TEST_HOOK_STATE: stateFile },
    })
    return 0
  } catch (e) {
    return (e as { status?: number }).status ?? 1
  }
}

describe('★★#1132 全量测试拦截 hook · 覆盖面（看退出码，不看文本）', () => {
  /** 每条用例独立状态文件（避免相互记账干扰）。 */
  const fresh = (): string => path.join(os.tmpdir(), `hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)

  it('★裸 `pnpm test`：首次放行（0）、同状态再来一次拦截（2）', () => {
    const s = fresh()
    expect(feed('pnpm test', s), '首次应放行并记账').toBe(0)
    expect(feed('pnpm test', s), '同状态重跑应拦截').toBe(2)
  })

  it('★★带重定向（`pnpm test > f 2>&1`）⇒ 仍应拦截（本轮修的盲区）', () => {
    const s = fresh()
    expect(feed('pnpm test', s)).toBe(0)
    expect(feed('pnpm test > /tmp/x.log 2>&1', s), '★重定向被当成"额外参数"放行了').toBe(2)
  })

  it('★★带管道（`pnpm test 2>&1 | grep FAIL`）⇒ 仍应拦截（本轮修的盲区）', () => {
    const s = fresh()
    expect(feed('pnpm test', s)).toBe(0)
    expect(feed('pnpm test 2>&1 | grep FAIL', s), '★管道被当成"额外参数"放行了').toBe(2)
  })

  it('`pnpm run test` + 重定向 ⇒ 仍应拦截', () => {
    const s = fresh()
    expect(feed('pnpm run test', s)).toBe(0)
    expect(feed('pnpm run test >/tmp/y.log', s)).toBe(2)
  })

  it('★真参数（`pnpm test -- --runInBand`）⇒ 放行（视为定向）', () => {
    const s = fresh()
    expect(feed('pnpm test', s)).toBe(0)
    expect(feed('pnpm test -- --runInBand', s), '真参数应视为定向').toBe(0)
  })

  it('定向 vitest（带文件路径）⇒ 一律放行', () => {
    const s = fresh()
    expect(feed('npx vitest run tests/foo.test.ts', s)).toBe(0)
    expect(feed('npx vitest run tests/foo.test.ts', s), '定向跑不该被拦').toBe(0)
  })

  it('无关注释命令（如 grep 里出现 "vitest run"）⇒ 放行（不误伤）', () => {
    const s = fresh()
    expect(feed("grep -n 'vitest run' README.md", s)).toBe(0)
    expect(feed("sed -n '1,5p' vitest.config.ts", s)).toBe(0)
  })

  it('显式表态 `PROTEUS_ALLOW_FULL_SUITE=1 pnpm test` ⇒ 放行', () => {
    const s = fresh()
    expect(feed('pnpm test', s)).toBe(0)
    expect(feed('PROTEUS_ALLOW_FULL_SUITE=1 pnpm test', s), '显式表态应放行').toBe(0)
  })
})
