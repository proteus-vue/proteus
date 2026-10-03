// tests/e2e-mp-global-layer.test.ts —— ★★★GP3-b1：Global 层「每页注入 + 状态共享」真机 E2E（2026-10-03）
//
// 【这张卡验什么】《全局挂载点方案》的核心承诺——**源码声明一次（App.mp.vue 的 <global-layer>），
//   全应用生效**。MP 端每页独立渲染树（方案 §1.2-bis）⇒ 实现形态 = "每页注入 + **共享状态**"
//   （与微信官方 `custom-tab-bar` 同模式）。本用例把这条链路锁成可重跑判据。
//
// 【★判据设计（三层证据，缺一即可能是假绿）】
//   ① **注入证据**：本页**没有**声明 `barVisible`/`toggleGlobalDemoBar`，但点上能出现状态条
//      ⇒ 内容确实来自 App 壳注入（不是页面自己写的）；
//   ② **跨页证据**：跳转另一页后状态条**仍在**（那一页同样被注入了壳内容 + 读同一份共享状态）
//      —— 这是"共享状态通道"的直接证据；
//   ③ **写回证据**：在第二页点隐藏 → 回第一页**仍隐藏**（写镜像 + onShow 拉取生效）。
//
// 【★诚实边界（必须写在这里，防"结论被放大"）】本用例证明的是**每页注入 + 状态一份**，
//   **不是**"单实例跨页面存活"（MP 架构上不成立——每页一棵独立渲染树）。方案 §1.2-bis。
//
// 【★装置经验（照抄自 e2e-mp-gp0-root-portal，勿再丢）】
//   ① 元素查询用**静态 id**（scoped hash 类名查不到）；② `reLaunch` 最稳；③ 进页先确认再操作；
//   ④ 首次开窗编译慢 ⇒ 带重试。
//
// 运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-global-layer.test.ts
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || path.resolve(__dirname, '..', 'examples/dist/mp-weixin')
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

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

/** 读当前页 data（含注入的全局字段） */
const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify({ route: p.route, data: p.data ?? {} })
}

/** 读全局状态条那个节点的几何（存在 = 真的渲染出来了；null = 未渲染） */
const readBarRect = (): string => new Promise((resolve) => {
  const q = wx.createSelectorQuery()
  q.select('#gl-net-bar').boundingClientRect()
  q.exec((r: unknown[]) => {
    const el = (r?.[0] ?? null) as { height?: number } | null
    resolve(JSON.stringify({ has: Boolean(el), height: el?.height ?? 0 }))
  })
}) as unknown as string

const DEMO_PAGE = '/pages/gp3-global-layer-demo'

describe.skipIf(!ENABLED)('GP3-b1 · Global 层每页注入 + 状态共享（wechatide skill-CLI）', () => {
  it('①壳内容注入本页 ②跳转后仍在 ③在第二页写回后回第一页仍生效', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 进验证页（reLaunch 最稳；瞬态失败重试）
    let launched = false
    for (let i = 0; i < 3 && !launched; i++) {
      try {
        await driver.reLaunch(DEMO_PAGE)
        launched = true
      } catch {
        await driver.waitFor(3000)
      }
    }
    expect(launched, 'reLaunch 应成功（重试 3 次）').toBe(true)
    await driver.waitFor(800)

    let info = JSON.parse(String(await driver.evaluate(readPageData))) as { route: string; data: Record<string, unknown> }
    for (let i = 0; i < 3 && info.route !== 'pages/gp3-global-layer-demo'; i++) {
      await driver.waitFor(2000)
      info = JSON.parse(String(await driver.evaluate(readPageData)))
    }
    expect(info.route, '应在 GP3 验证页').toBe('pages/gp3-global-layer-demo')

    // ★注入证据前置：本页源码**没有** barVisible 字段——但 data 里有（来自 App 壳注入）
    expect('barVisible' in info.data, '★页面 data 应有注入的全局字段 barVisible（本页未声明它）').toBe(true)
    expect('netText' in info.data, '★页面 data 应有注入的全局字段 netText（本页未声明它）').toBe(true)

    // 初始应隐藏（壳声明的初值 false）
    let rect = JSON.parse(String(await driver.evaluate(readBarRect))) as { has: boolean; height: number }
    expect(rect.has, '初始状态条应隐藏（barVisible 初值 false）').toBe(false)

    // ② 点「切换」→ 状态条出现（**壳方法**被注入本页并生效）
    callWxide('automation_element_action', { action: 'tap', selector: '#gp3-toggle' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    await driver.waitFor(500)
    rect = JSON.parse(String(await driver.evaluate(readBarRect))) as { has: boolean; height: number }
    expect(rect.has, '★点切换后状态条应出现（壳方法注入生效）').toBe(true)
    expect(rect.height, '状态条应有真实高度（不是零高占位）').toBeGreaterThan(10)

    // 确认写入共享状态（data 同步）
    info = JSON.parse(String(await driver.evaluate(readPageData)))
    expect(info.data.barVisible, 'data.barVisible 应为 true').toBe(true)

    // ③ **跨页证据**：跳另一页（该页同样被注入壳内容 + 读同一份共享状态）
    await driver.reLaunch('/pages/index')
    await driver.waitFor(900)
    const idx = JSON.parse(String(await driver.evaluate(readPageData))) as { route: string; data: Record<string, unknown> }
    expect(idx.route, '应已跳到首页').toBe('pages/index')
    const idxRect = JSON.parse(String(await driver.evaluate(readBarRect))) as { has: boolean; height: number }
    expect(idxRect.has, '★首页也应有全局状态条（每页注入 + 共享状态）——若无即注入/共享链断了').toBe(true)

    // ④ **写回证据**：在首页点隐藏（点**提示文字**——handler 在那个节点上，容器中心点不到它）
    //    → 回验证页仍隐藏（写镜像 + onShow 拉取）
    callWxide('automation_element_action', { action: 'tap', selector: '#gl-net-bar-hide' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    await driver.waitFor(500)
    const idxRect2 = JSON.parse(String(await driver.evaluate(readBarRect))) as { has: boolean }
    expect(idxRect2.has, '首页点「隐藏」后状态条应消失（壳方法在首页也生效）').toBe(false)
    // ★独立证据（不只看几何）：首页 data 里的全局字段也应为 false（壳方法写了页面 data → setData 镜像）
    const idxData2 = JSON.parse(String(await driver.evaluate(readPageData))) as { data: Record<string, unknown> }
    expect(idxData2.data.barVisible, '首页 data.barVisible 应为 false（写镜像生效）').toBe(false)

    await driver.reLaunch(DEMO_PAGE)
    await driver.waitFor(900)
    const back = JSON.parse(String(await driver.evaluate(readPageData))) as { route: string; data: Record<string, unknown> }
    expect(back.route, '应回到验证页').toBe('pages/gp3-global-layer-demo')
    expect(back.data.barVisible, '★回到验证页仍是隐藏态（共享状态写回 + onShow 拉取）').toBe(false)

    // ⑤ 零 error 门禁（链路健康）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, '全流程不应有 error').toEqual([])

    console.log('[GP3B1] ✅ 每页注入 + 状态共享闭环（本页注入 → 跨页可见 → 写回同步）')
  })
})
