// tests/e2e-mp-auth-gate.test.ts —— ★★★GP4-c：登录失效拦截真机 E2E（2026-10-03）
//
// 【这张卡验什么（对标 GP4-c 验收原文）】
//   ① **401 → 弹窗出现**：页面内触发（无导航）——"任意页面任何请求返回 401 均可弹出"
//   ② **不可取消**：弹窗出现后，`expired` 状态只能由 `markAuthRestored()` 清除
//      ⇒ 机器判据：**没有**任何"点击路径"能清掉它（点遮罩/点面板/点页面都仍在）
//   ③ **故障时页面栈不异常**：恢复后页面栈深度不变（本模块**不自己导航**——收口交给业务）
//   ④ 状态与守卫同源（`isAuthExpired` 就是 `createAuthChecker` 的取反——单测已锁，此处只验运行时）
//
// 【★与 GP4-b 的关键差别（为什么这里"不可取消"可以断言，而 GP4-b 的"拦截"不行）】
//   GP4-b 的"点击穿透"依赖**渲染层命中测试**（自动化工具绕过层叠 ⇒ 不可断言）。
//   本卡的"不可取消"判据是**状态**（`isAuthExpired()` 在点击后是否仍为 true）——
//   可以直接读全局状态，**不依赖命中测试** ⇒ 可机器断言（这是判据设计上的刻意选择：
//   把"不可取消"表达成状态事实而非交互事实）。
//
// 运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-auth-gate.test.ts
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || path.resolve(__dirname, '..', 'examples/dist/mp-weixin')
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'
/** 页面在**分包**（主包页面数 32 上限） */
const DEMO = '/subpackages/svg-lab/pages/gp4-auth-gate-demo'

const wxideDebugger: MpDebuggerLike = {
  async consoleGrep(command: string): Promise<string[]> {
    const r = callWxide('get_simulator_console', { command: command || 'grep -n .' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    return Array.isArray(r) ? (r as string[]) : typeof r === 'string' ? r.split('\n') : []
  },
  async refresh(): Promise<void> {
    callWxide('simulator_refresh', {}, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
  },
  async clearCache(): Promise<void> {
    callWxide('debug_clear_cache', { action: 'all' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
  },
}

/** 读页面 data（读数面） */
const readPageState = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify({ route: p.route, depth: pages.length, data: p.data ?? {} })
}

/** ★读**全局状态**（判据不依赖命中测试——见头注） */
const readGate = (): string => {
  const g = globalThis as unknown as Record<string, unknown>
  const byPage = (g.__PROTEUS_AUTH_GATE_RENDER_BY_PAGE__ as Record<string, { expired?: boolean }> | undefined) ?? {}
  const pages = getCurrentPages() as unknown as Array<{ route?: string }>
  const route = pages.length ? (pages[pages.length - 1].route ?? '') : ''
  return JSON.stringify({
    mounted: Number(g.__PROTEUS_AUTH_GATE_HOST_MOUNTED__) || 0,
    state: g.__PROTEUS_AUTH_GATE__ ?? null,
    rendered: byPage[route] ?? null,
  })
}

describe.skipIf(!ENABLED)('GP4-c · 登录失效拦截（不可取消模态）真机（wechatide skill-CLI）', () => {
  it('401 → 弹窗出现且不可取消；恢复后栈不异常；"重新登录"转达业务', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    const tap = (selector: string): void => {
      callWxide('automation_element_action', { action: 'tap', selector }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    }
    const gate = async (): Promise<{ mounted: number; state: { expired?: boolean; count?: number } | null; rendered: { expired?: boolean } | null }> =>
      JSON.parse(String(await driver.evaluate(readGate))) as { mounted: number; state: { expired?: boolean; count?: number } | null; rendered: { expired?: boolean } | null }
    const pageData = async (): Promise<Record<string, unknown>> => {
      const st = JSON.parse(String(await driver.evaluate(readPageState))) as { data: Record<string, unknown> }
      return st.data
    }

    // ① 进页（以"真的到了这页"为判据重试——首次开窗编译慢）
    const wantRoute = 'subpackages/svg-lab/pages/gp4-auth-gate-demo'
    let st = { route: '', depth: 0, data: {} as Record<string, unknown> }
    for (let i = 0; i < 5; i++) {
      try {
        await driver.reLaunch(DEMO)
      } catch {
        /* 瞬态失败：下一轮 */
      }
      await driver.waitFor(1200)
      st = JSON.parse(String(await driver.evaluate(readPageState))) as { route: string; depth: number; data: Record<string, unknown> }
      if (st.route === wantRoute) break
      await driver.waitFor(1600)
    }
    expect(st.route, `应停在 GP4-c 演示页（实到 ${st.route}）`).toBe(wantRoute)
    const depthBefore = st.depth

    // ② 宿主在场（本页**手写**宿主——需要绑 onAction；自动注入会让位）
    expect((await gate()).mounted, '★手写的 <p-auth-gate /> 应实例化').toBeGreaterThan(0)
    expect((await gate()).state?.expired ?? false, '初始未失效').toBe(false)

    // ③ ★401 → 弹窗出现（无导航——"任意页面任何请求返回 401"路径）
    const beforeTaps = Number((await pageData()).taps ?? 0)
    tap('#gp4a-401')
    await driver.waitFor(700)
    const g1 = await gate()
    expect(g1.state?.expired, '★通知 401 后进入失效态').toBe(true)
    expect(g1.rendered?.expired, '★宿主（组件侧）投影到失效态 ⇒ 弹窗可见').toBe(true)
    expect(Number((await pageData()).expiredReadout), '页面读数面同步').toBe(1)

    // ④ ★**不可取消**：点页面上的普通按钮（有遮罩覆盖）⇒ 状态**仍是**失效（没有任何点击能清掉它）
    tap('#gp4a-outside')
    await driver.waitFor(500)
    const g2 = await gate()
    expect(g2.state?.expired, '★点页面别处后仍失效（不可取消——判据是状态，不依赖命中测试）').toBe(true)
    expect(g2.rendered?.expired, '★宿主侧仍显示').toBe(true)

    // ⑤ 再触发一次（幂等确认）：状态仍在，计数增长（不重复翻转）
    tap('#gp4a-401')
    await driver.waitFor(500)
    const g2b = await gate()
    expect(g2b.state?.expired, '幂等：重复 401 仍是失效态').toBe(true)
    expect(g2b.state?.count, '★计数随每次 401 增长（可观测）').toBeGreaterThanOrEqual(2)
    // ★**验证边界**："重新登录"按钮在弹窗面板内（root-portal）⇒ 页面级自动化**点不到它**
    //   （GP4-b 实证：automation 无法定位 portal 内元素）⇒ 该按钮的**接线**由单测锁
    //   （tests/auth-gate.test.ts 的"动作按钮转达业务 onAction、组件内不得出现导航 API"），
    //   真机点击需**人眼/手工**验证（与 GP4-b 的遮罩拦截同一条诚实边界）。

    // ⑥ 恢复：模拟登录成功 ⇒ 弹窗消失；**页面栈深度不变**（本模块不自己导航 ⇒ 栈不异常）
    tap('#gp4a-login-ok')
    await driver.waitFor(700)
    const g3 = await gate()
    expect(g3.state?.expired, '★登录成功 ⇒ 失效态清除').toBe(false)
    expect(g3.rendered?.expired, '★宿主侧同步隐藏').toBe(false)
    const after = JSON.parse(String(await driver.evaluate(readPageState))) as { depth: number }
    expect(after.depth, '★恢复前后页面栈深度不变（无导航动作注入）').toBe(depthBefore)

    // ⑦ 计数可观测（本次会话累计触发次数）
    expect(g3.state?.count, '★累计 401 次数可观测').toBeGreaterThanOrEqual(1)

    // ⑧ 零 error 门禁
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, '全程不应有 error').toEqual([])

    console.log('[GP4C] ✅ 401 → 弹窗（不可取消，状态判据）→ 恢复；栈深度不变；计数可观测')
  })
})
