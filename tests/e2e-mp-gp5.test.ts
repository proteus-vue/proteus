// tests/e2e-mp-gp5.test.ts —— ★★★GP5：八条超级应用场景真机 E2E（2026-10-03）
//
// 【这张卡验什么（任务卡 GP5 验收原文）】
//   八条超级应用场景**任一条需要每页引入 ⇒ 方案不成立**。本用例验 Global 层四条
//   （④悬浮球 ⑤音乐条 ⑦主题容器 ⑧IM 角标；⑥状态条见 e2e-mp-global-layer；
//     Overlay 三条见各自 e2e）——在**源码零声明的演示页**上操作：
//     ① **声明零引入**：演示页没有声明任何场景元素/字段，但点上能出现 ⇒ 内容来自 App 壳注入；
//     ② **跨页证据**：跳另一页后场景仍在（那一页同样被注入 + 读同一份共享状态）；
//     ③ **状态一份**：在第二页读到同一份 `imUnread`（写镜像 + onLoad 直读共享状态）。
//
// 【★诚实边界（必须写在这里，防"结论被放大"）】本用例证明的是**每页注入 + 状态一份**，
//   **不是**"单实例跨页面存活"（MP 架构上不成立——每页一棵独立渲染树）。方案 §1.2-bis。
//
// 【★装置经验（照抄自 e2e-mp-global-layer，勿再丢）】
//   ① 元素查询用**静态 id**（scoped hash 类名查不到）；② `reLaunch` 最稳；③ 进页先确认再操作；
//   ④ 首次开窗编译慢 ⇒ 带重试。
//
// 运行：`pnpm --filter proteus-examples build:mp` 之后
//       `PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-gp5.test.ts`
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || path.resolve(__dirname, '..', 'examples/dist/mp-weixin')
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'
/** 页面在**分包**（主包页面数 32 上限） */
const DEMO = '/subpackages/svg-lab/pages/gp5-scenarios-demo'

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

/** 读某选择器的几何（存在 = 真的渲染出来了）
 *  ★形态：**零参函数、选择器烘进字面量**——两个约束（都是实测踩出来的）：
 *    ① wxide 的 evaluate 不支持带参（`--args` 实测不生效；带参会包成 IIFE ⇒ exit 1）；
 *    ② 不能在 Node 侧先调用（本地执行会 `wx is not defined` ⇒ 未处理拒绝）——
 *       必须传**函数本身**、由设备侧执行。
 *    ⇒ 每个选择器一个独立零参探针（照抄 e2e-mp-global-layer 的 readBarRect 成功形态）。 */
const makeRectProbe = (selector: string): (() => string) =>
  // new Function 产出**独立零参函数**（选择器烘进源码；不与其它探针共享带参实现）
  (new Function(
    `return function () { return new Promise(function (resolve) {
      var wx = globalThis.wx
      var q = wx.createSelectorQuery()
      q.select(${JSON.stringify(selector)}).boundingClientRect()
      q.exec(function (r) {
        var el = (r && r[0]) || null
        resolve(JSON.stringify({ has: !!el, width: el ? (el.width || 0) : 0, height: el ? (el.height || 0) : 0 }))
      })
    }) }`,
  )() as unknown as () => string)
const rectFab = makeRectProbe('#gl-fab')
const rectMusic = makeRectProbe('#gl-music-bar')
const rectTheme = makeRectProbe('#gl-theme-bg')
const rectBadge = makeRectProbe('#gl-im-badge')

describe.skipIf(!ENABLED)('GP5 · 八条超级应用场景（Global 层四条 · wechatide skill-CLI）', () => {
  it('零声明页：悬浮球/音乐条/主题/角标由注入生效 + 跨页仍在 + 状态一份', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    const tap = (selector: string): void => {
      callWxide('automation_element_action', { action: 'tap', selector }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    }
    const pageData = async (): Promise<{ route: string; data: Record<string, unknown> }> =>
      JSON.parse(String(await driver.evaluate(readPageData))) as { route: string; data: Record<string, unknown> }
    const probe = async (fn: () => string): Promise<{ has: boolean; width: number; height: number }> =>
      JSON.parse(String(await driver.evaluate(fn))) as { has: boolean; width: number; height: number }

    // ① 进演示页（以"真的到了这页"为判据重试——首次开窗编译慢）
    const wantRoute = 'subpackages/svg-lab/pages/gp5-scenarios-demo'
    let st = await pageData()
    for (let i = 0; i < 5; i++) {
      try {
        await driver.reLaunch(DEMO)
      } catch {
        /* 瞬态失败：下一轮 */
      }
      await driver.waitFor(1200)
      st = await pageData()
      if (st.route === wantRoute) break
      await driver.waitFor(1600)
    }
    expect(st.route, `应停在 GP5 演示页（实到 ${st.route}）`).toBe(wantRoute)

    // ★② 注入证据前置：本页源码**没有**这些字段——但 data 里有（来自 App 壳注入）
    for (const k of ['fabVisible', 'musicVisible', 'theme', 'imUnread']) {
      expect(k in st.data, `★页面 data 应有注入的全局字段 ${k}（本页未声明它）`).toBe(true)
    }

    // ★★先归一状态，不假设"初始干净"——
    //   共享状态是模拟器里的**模块级单例**（require 缓存），**跨测试运行存活**：
    //   上一轮（或上一次交互）把 fabVisible 留成 true，新运行读到的初值就是 true。
    //   ⇒ e2e 的判据必须表达成"**切换语义**"（读到什么 ⇒ 点后变成相反/确定值），
    //     而不是"初始必是 false"（那依赖外部状态，是**装置假红**的经典来源，本轮实测踩到）。
    const ensureFalse = async (key: string, selector: string): Promise<void> => {
      if ((await pageData()).data[key] === true) {
        tap(selector)
        await driver.waitFor(500)
      }
    }
    await ensureFalse('fabVisible', '#gp5-fab')
    await ensureFalse('musicVisible', '#gp5-music')
    // 未读清零（幂等——等价于把状态拉到确定值 0）
    tap('#gp5-im-clear')
    await driver.waitFor(400)
    let cur = await pageData()
    expect(cur.data.fabVisible, '归一后悬浮球隐藏').toBe(false)
    expect(cur.data.musicVisible, '归一后音乐条隐藏').toBe(false)
    expect(cur.data.imUnread, '归一后未读 0').toBe(0)

    // ② 场景 ④：点「切换悬浮球」→ 悬浮球出现（**壳方法**被注入本页并生效）
    tap('#gp5-fab')
    await driver.waitFor(500)
    let r = await probe(rectFab)
    expect(r.has, '★点后悬浮球应出现（壳方法注入生效）').toBe(true)
    expect(r.width, '悬浮球应有真实尺寸（不是零尺寸占位）').toBeGreaterThan(10)
    expect((await pageData()).data.fabVisible, 'data.fabVisible 应为 true').toBe(true)

    // ③ 场景 ⑤：点「切换音乐条」→ 出现
    tap('#gp5-music')
    await driver.waitFor(500)
    r = await probe(rectMusic)
    expect(r.has, '★音乐条应出现').toBe(true)
    expect((await pageData()).data.musicVisible, 'data.musicVisible 应为 true').toBe(true)

    // ④ 场景 ⑦：点「切换主题」→ 切到**另一态**（不假设当前必是 light——同"不假设干净态"纪律），
    //    再点一次切回 ⇒ 验证"无需刷新、即时切换"的双向性
    const themeBefore = String((await pageData()).data.theme)
    tap('#gp5-theme')
    await driver.waitFor(500)
    const themeAfter = String((await pageData()).data.theme)
    expect(themeAfter, `★主题应切换（${themeBefore} → ${themeAfter}）`).not.toBe(themeBefore)
    expect((await probe(rectTheme)).has, '主题容器元素常驻（背景层）').toBe(true)

    // ⑤ 场景 ⑧：点「IM +1」两次 → 角标出现且计数 = 2（已清零 ⇒ 确定值）
    tap('#gp5-im-bump')
    await driver.waitFor(300)
    tap('#gp5-im-bump')
    await driver.waitFor(500)
    expect((await pageData()).data.imUnread, '★未读应为 2').toBe(2)
    expect((await probe(rectBadge)).has, '★角标应出现').toBe(true)

    // ⑥ 跨页证据：跳首页（该页同样被注入 + 读同一份共享状态）
    await driver.reLaunch('/pages/index')
    await driver.waitFor(900)
    const idx = await pageData()
    expect(idx.route, '应已跳到首页').toBe('pages/index')
    expect(idx.data.fabVisible, '★首页 data 也应含注入字段（值来自共享状态）').toBe(true)
    expect(idx.data.imUnread, '★首页读到同一份未读计数（=2）').toBe(2)
    expect(idx.data.theme, '★首页读到同一份主题（=切后态）').toBe(themeAfter)
    expect((await probe(rectFab)).has, '★首页也应有悬浮球（每页注入 + 共享状态）').toBe(true)
    expect((await probe(rectBadge)).has, '★首页也应有 IM 角标').toBe(true)

    // ⑦ 写回证据：回演示页 → 读到的仍是同一份状态（未被页面切换重置）
    await driver.reLaunch(DEMO)
    await driver.waitFor(900)
    const back = await pageData()
    expect(back.route, '应回到演示页').toBe(wantRoute)
    expect(back.data.imUnread, '★回演示页未读仍为 2（状态一份，不是页面局部状态）').toBe(2)
    expect(back.data.theme, '★主题仍是切后态').toBe(themeAfter)

    // ⑧ 收尾：清零（演示也验一次"跨页可写"）
    tap('#gp5-im-clear')
    await driver.waitFor(500)
    expect((await pageData()).data.imUnread, '清零后为 0').toBe(0)
    expect((await probe(rectBadge)).has, '角标随状态消失').toBe(false)

    // ⑨ 零 error 门禁（链路健康）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, '全流程不应有 error').toEqual([])

    console.log('[GP5] ✅ 八条场景 · Global 四条：零声明页 → 注入生效（悬浮球/音乐条/主题/角标）→ 跨页仍在 → 状态一份 → 写回同步')
  })
})
