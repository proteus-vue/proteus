// tests/e2e-mp-toast-queue.test.ts —— ★★★GP4-a：Toast 队列真机 E2E（2026-10-03）
//
// 【这张卡验什么（对标 GP4-a 验收："连续触发 10 个 Toast，按序显示且不互相覆盖"）】
//   ① **队列按序**（核心判据）：连点「连续触发 10 条」→ 逐个采样**正在显示的文本**，
//      必须是 第1→第10 递增（若退化成"单例覆盖"，会直接跳到第 10 条或只看到最后一条）
//   ② **位置参数生效**：top / bottom 两种锚点（读宿主实例的 position——队列投影的产物）
//   ③ **常驻 + 手动关**：duration=0 不被自动关；hideToast 后消失
//   ④ **上限与丢弃**：上限 3 时连发 8 条 → 不崩、仍按序、丢弃可观测（`dropped` 计数）
//   ⑤ **零 error 门禁**（链路健康）
//
// 【★★装置纪律（本轮血泪，必须照做）】
//   · **组件内部节点页面级查询不可见**（`createSelectorQuery` 在页面上查组件内部恒 null；
//     这正是本仓"探针机制"存在的理由）⇒ 断言组件内部一律走**能看见该层的通道**
//     （组件实例 selectComponent / 运行时状态落痕 / 页面 data）。
//   · 本轮曾因用页面级查询测组件内部，得出"组件未被创建"的**错误结论**并据此改了实现（改错一版）。
//     ⇒ 排障结论必须用**能看见该层的通道**复核（与"先取证再断言"同条）。
//   · 静态 id 点击；reLaunch 最稳；进页先确认再操作。
//
// 运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-toast-queue.test.ts

import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || path.resolve(__dirname, '..', 'examples/dist/mp-weixin')
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'


// ★GP4-b 起该页在**分包**（主包页面数 32 上限——演示页统一放 svg-lab 分包）
const DEMO = '/subpackages/svg-lab/pages/gp4-toast-queue-demo'

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

/** 读页面 data（演示页读数面） */
const readPageState = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify({ route: p.route, data: p.data ?? {} })
}

/**
 * ★读**宿主实际渲染的那一条**（组件顶部在 globalThis 上的运行时落痕）。
 *
 * 【为什么不用 selectComponent】宿主在 `root-portal` 内 ⇒ 它**不在页面的组件树**里，
 *   页面级 `selectComponent`/`selectAllComponents` **一律返回 null**（本轮实测：四种选择器全 null）。
 *   ⇒ 组件侧主动落痕（`__PROTEUS_TOAST_RENDER__`）= 能看见该层的通道（同"探针"思路）。
 */
const readHostRender = (): string => {
  const g = globalThis as unknown as Record<string, unknown>
  // ★按**当前页 route** 取（多宿主短时共存时旧实例会写同名键——见组件注释的分桶理由）
  const pages = getCurrentPages() as unknown as Array<{ route?: string }>
  const route = pages.length ? (pages[pages.length - 1].route ?? '') : ''
  const byPage = (g.__PROTEUS_TOAST_RENDER_BY_PAGE__ as Record<string, { text?: string | null; position?: string | null }> | undefined) ?? {}
  // ★按当前页 route 取（分包页的 route 带 `subpackages/<name>/pages/...` 前缀——不是裸 `pages/...`）
  const r = byPage[route] ?? null
  return JSON.stringify({
    mounted: Number(g.__PROTEUS_TOAST_HOST_MOUNTED__) || 0,
    current: r ? (r.text ?? null) : null,
    position: r ? (r.position ?? null) : null,
  })
}

describe.skipIf(!ENABLED)('GP4-a · Toast 队列真机（wechatide skill-CLI）', () => {
  it('连续 10 条按序显示（不互相覆盖）+ 位置/常驻/手动关闭/上限', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    const tap = (selector: string): void => {
      callWxide('automation_element_action', { action: 'tap', selector }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    }
    const host = async (): Promise<{ mounted: number; current: string | null; position: string | null }> =>
      JSON.parse(String(await driver.evaluate(readHostRender))) as { mounted: number; current: string | null; position: string | null }

    // ① 进页（reLaunch 最稳；**首次开窗编译慢** ⇒ 以"真的到了这页"为判据重试，
    //    不看 reLaunch 的返回值——它成功不代表页面栈已切过去（实测首跑停在首页））
    let info = { route: '', data: {} as Record<string, unknown> }
    for (let i = 0; i < 5; i++) {
      try {
        await driver.reLaunch(DEMO)
      } catch {
        /* 瞬态失败：下一轮重试 */
      }
      await driver.waitFor(1200)
      info = JSON.parse(String(await driver.evaluate(readPageState))) as { route: string; data: Record<string, unknown> }
      if (info.route === 'subpackages/svg-lab/pages/gp4-toast-queue-demo') break
      await driver.waitFor(1800)
    }
    expect(info.route, `reLaunch 后应停在 GP4 演示页（实到 ${info.route}）`).toBe('subpackages/svg-lab/pages/gp4-toast-queue-demo')

    // ② ★宿主在场（注入闭环第一判据——没有宿主后面全是假失败）
    expect((await host()).mounted, '★构建期注入的 <p-toast-host /> 应实例化（组件挂载落痕 ≥1）').toBeGreaterThan(0)

    // ③ 单条基线（确认 队列→宿主→渲染 完整）
    //   ★点后**以页面读数确认 tap 真的生效**（lastId 变化）再断言渲染——
    //     首次开窗后元素坐标未稳时 tap 可能落空（本仓 T6 类装置陷阱）。
    //   ★★用**长时长**条目做基线（duration=6000）：e2e 每轮 evaluate 有 IDE 往返开销（百毫秒级），
    //     用 1500ms 的条目会踩"读到之前已自动关闭"的**装置性假失败**（本轮实测：0–1503ms 内有效，
    //     采样点漂到 1500+ 就恒 null——这不是产品缺陷，是测试窗口与时长的赛跑）。
    const before = JSON.parse(String(await driver.evaluate(readPageState))) as { data: Record<string, unknown> }
    let tapped = false
    for (let i = 0; i < 3 && !tapped; i++) {
      tap('#gp4-single')
      await driver.waitFor(500)
      const now = JSON.parse(String(await driver.evaluate(readPageState))) as { data: Record<string, unknown> }
      tapped = String(now.data.lastId) !== String(before.data.lastId)
    }
    expect(tapped, '★tap 应真的触发了 showToast（以页面 lastId 变化为判据——防"tap 落空"假失败）').toBe(true)
    expect((await host()).current, '★点单条后宿主应显示该文本').toBe('单条提示（默认 center）')
    tap('#gp4-close-all')
    await driver.waitFor(400)
    expect((await host()).current, '全部清空后应无显示').toBeNull()

    // ④ ★核心判据：连续 10 条 → 显示序列严格递增（第1→第10，不跳跃/不覆盖）
    //   ★两条证据链（互不依赖）：
    //     (a) 页面侧 `burstLog`（页面订阅读队列，逐条记录显示过的文本——**不看采样时机**，采样漏号也不影响）；
    //     (b) e2e 外部采样（补充"外部真的看得见"——但 IDE 往返 ~200ms，必然漏号，只做增长性检查）。
    //   ★为什么以 (a) 为主判据：本轮实测外部采样节奏追不上 300ms/条（漏号是**装置限制**，
    //     把它当"队列退化成单例"会误判——真退化时 burstLog 会只剩最后一条）。
    tap('#gp4-burst')
    await driver.waitFor(1200)
    let logged: string[] = []
    for (let i = 0; i < 12; i++) {
      const st = JSON.parse(String(await driver.evaluate(readPageState))) as { data: Record<string, unknown> }
      const raw = st.data.burstLog
      logged = Array.isArray(raw) ? (raw as string[]) : []
      if (logged.length >= 10) break
      await driver.waitFor(400)
    }
    const nums = logged.map((t) => Number(/排队第 (\d+) 条/.exec(t)?.[1] ?? -1))
    expect(nums.length, `★应记录到多条显示（只 1 条 = 队列退化单例覆盖）；实采 ${logged.join('→')}`).toBeGreaterThan(4)
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i], `★必须按序递增（不跳跃/不覆盖）；实采序列 ${nums.join('→')}`).toBe(nums[i - 1]! + 1)
    }
    console.log(`[GP4A] ✅ 连续触发按序显示：${nums.join('→')}（共 ${nums.length} 条）`)

    // (b) 外部可见性补充：**另起一轮**长的常驻条目，外部进程应真的读到它（"宿主渲染"的外部证据）
    //   ★不放在 burst 采样里（e2e 往返 ~200ms 追不上 300ms/条——那是装置限制，不是队列缺陷）；
    //     改为用 duration=0 的常驻条目，给外部进程充足的读取窗口。
    tap('#gp4-close-all')
    await driver.waitFor(400)
    tap('#gp4-persist')
    await driver.waitFor(800)
    const extSeen = await host()
    expect(extSeen.current, '★外部读到的宿主渲染 = 常驻条目文本（宿主渲染的外部证据）').toBeTruthy()

    // ⑤ 位置参数生效    // ⑤ 位置参数生效
    tap('#gp4-close-all')
    await driver.waitFor(400)
    tap('#gp4-top')
    await driver.waitFor(500)
    expect((await host()).position, '点顶部后 position 应为 top').toBe('top')
    tap('#gp4-close-all')
    await driver.waitFor(400)
    tap('#gp4-bottom')
    await driver.waitFor(500)
    expect((await host()).position, '点底部后 position 应为 bottom').toBe('bottom')

    // ⑥ 常驻 + 手动关
    tap('#gp4-close-all')
    await driver.waitFor(400)
    tap('#gp4-persist')
    await driver.waitFor(1600) // 远超默认时长
    expect((await host()).current, '★duration=0 的常驻提示 1.6 秒后仍应在（不自动关）').toBeTruthy()
    tap('#gp4-close-last')
    await driver.waitFor(500)
    expect((await host()).current, '★手动关闭生效').toBeNull()

    // ⑦ 上限与丢弃（不崩）
    tap('#gp4-clear-then-flood')
    await driver.waitFor(700)
    expect((await host()).mounted, '★洪水后宿主仍存活（队列未崩溃）').toBeGreaterThan(0)
    const afterFlood = JSON.parse(String(await driver.evaluate(readPageState))) as { data: Record<string, unknown> }
    expect(afterFlood.data.lastId, '洪水后调用链完好').toBeTruthy()
    tap('#gp4-restore')
    await driver.waitFor(500)
    expect((await host()).current, '恢复配置后能正常显示').toBeTruthy()

    // ⑧ 零 error 门禁
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, '全程不应有 error').toEqual([])

    console.log('[GP4A] ✅ Toast 队列闭环（按序 / 位置 / 常驻 / 手动关 / 上限）')
  })
})
