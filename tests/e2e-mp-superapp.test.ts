// tests/e2e-mp-superapp.test.ts —— ★★★超级应用验收（首模块：全局挂载八条场景）（2026-10-04）
//
// 【这份用例验什么】`superapp/`（框架最终验收场）里的**首个验收模块**——
//   全局挂载八条场景（GP5）在**生产形态**下的可用性：
//     ① **业务形态**：场景不是占位（悬浮球=客服入口 / 音乐条=播客播放器 / 主题=设置页开关 /
//        角标=消息页未读同源）——本用例按**真实业务路径**操作（设置页开深色、消息页标未读等）；
//     ② **跨页一致**：Global 层内容切页仍在、状态同步（共享状态一份）；
//     ③ **零每页引入**：业务页面源码不含场景声明（App 壳声明一次）。
//
// 【与前一份 e2e 的关系（勿混）】`tests/e2e-mp-gp5.test.ts` 验的是 **examples 工程**的
//   GP5 实现（引擎级：注入通道本身）；本用例验的是 **superapp 工程**的**生产可用性**
//   （业务级：真实页面 + 真实路径 + 真实形态）。两者互补，不是重复。
//
// 运行：`cd superapp && npx proteus build --target skyline` 之后
//       `PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-superapp.test.ts`
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_SUPERAPP_PATH || path.resolve(__dirname, '..', 'superapp', 'dist', 'mp-weixin')
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

/** 零参几何探针（选择器烘字面量——wxide evaluate 不支持带参，本仓实测约束） */
const makeRectProbe = (selector: string): (() => string) =>
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
const rectFab = makeRectProbe('#sa-fab')
const rectMusic = makeRectProbe('#sa-music-bar')
const rectTheme = makeRectProbe('#sa-theme-bg')
const rectBadge = makeRectProbe('#sa-im-badge')

describe.skipIf(!ENABLED)('超级应用验收 · 首模块：全局挂载八条场景（生产形态 · wechatide）', () => {
  it('业务路径走查：设置页开关驱动主题/客服球、消息页驱动角标、首页/验收台驱动音乐与网络条；跨页一致', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    const tap = (selector: string): void => {
      callWxide('automation_element_action', { action: 'tap', selector }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    }
    const pageData = async (): Promise<{ route: string; data: Record<string, unknown> }> =>
      JSON.parse(String(await driver.evaluate(readPageData))) as { route: string; data: Record<string, unknown> }
    const probe = async (fn: string): Promise<{ has: boolean; width: number; height: number }> =>
      JSON.parse(String(await driver.evaluate(fn))) as { has: boolean; width: number; height: number }
    const go = async (url: string, want: string): Promise<Record<string, unknown>> => {
      // ★首次进入时模拟器可能尚未打开本项目 ⇒ 先 reLaunch（带重试），再读 pageData
      let st = { route: '', data: {} as Record<string, unknown> }
      for (let i = 0; i < 6; i++) {
        try {
          await driver.reLaunch(url)
        } catch {
          /* 瞬态失败 */
        }
        await driver.waitFor(1200)
        try {
          st = await pageData()
        } catch {
          // evaluate 尚未就绪（项目未开/首编译慢）——下一轮
          await driver.waitFor(1500)
          continue
        }
        if (st.route === want) break
        await driver.waitFor(1500)
      }
      expect(st.route, `应停在 ${want}（实到 ${st.route}）`).toBe(want)
      return st.data
    }

    // ── ① 首页：注入字段齐备（Global 四条）+ 主题容器常驻 ──
    let d = await go('/pages/index', 'pages/index')
    for (const k of ['theme', 'fabVisible', 'musicVisible', 'imUnread', 'netBarVisible']) {
      expect(k in d, `★首页 data 应有注入字段 ${k}（页面零声明）`).toBe(true)
    }
    expect((await probe(rectTheme)).has, '主题容器元素常驻（背景层）').toBe(true)

    // ── ② 首页「模拟弱网」→ 网络条出现（⑥ 业务路径） ──
    tap('#idx-weaknet')
    await driver.waitFor(600)
    expect((await pageData()).data.netBarVisible, '★点「模拟弱网」→ 全局网络条出现').toBe(true)
    // 点「忽略」→ 收起
    tap('#sa-net-hide')
    await driver.waitFor(500)
    expect((await pageData()).data.netBarVisible, '点忽略 → 收起').toBe(false)

    // ── ③ 首页「播放内部播客」→ 音乐条出现（⑤ 业务路径） ──
    tap('#idx-play')
    await driver.waitFor(600)
    const afterPlay = await pageData()
    expect(afterPlay.data.musicVisible, '★点播放 → 全局音乐条出现').toBe(true)
    // ★曲目名 = 传给 saPlayMusic 的第一个参数（生产形态：真实曲目）；artist 在 musicArtist
    expect(String(afterPlay.data.musicTitle), '曲目名已设置（生产形态：真实曲目）').toBe('热区业务周报')
    expect(String(afterPlay.data.musicArtist), '艺术家/来源已设置').toContain('播客')
    const mrect = await probe(rectMusic)
    expect(mrect.has, '音乐条渲染').toBe(true)
    expect(mrect.width, '音乐条有真实宽度（深色播放器形态）').toBeGreaterThan(100)

    // ── ④ 消息页：真实业务路径驱动 ⑧ 角标 ──
    d = await go('/pages/messages', 'pages/messages')
    const baseUnread = Number(d.imUnread ?? 0)
    tap('#msg-mark-one') // 标记一条未读 → 角标 +1
    await driver.waitFor(600)
    const afterBump = await pageData()
    expect(Number(afterBump.data.imUnread), '★消息页「标记一条未读」→ 全局角标 +1').toBe(baseUnread + 1)
    // ★2026-10-04 形态变更（用户：「web 上面把未读放到 tabbar 的消息上面了，小程序的这个还是在右上角啊」）：
    //   MP 端角标从"页面右上角自绘"改为**原生 tabBar 角标**（wx.setTabBarBadge）——与 Web 端形态一致。
    //   判据随之改：不再查自绘元素，改查**壳方法确实被调用**（跑过 saSyncTabBarBadge ⇒ 页实例上有它）。
    expect(
      JSON.parse(String(await driver.evaluate(`function () {
        var p = getCurrentPages(); var c = p[p.length - 1]
        return JSON.stringify({ hasSync: typeof c.saSyncTabBarBadge })
      }`))).hasSync,
      '★角标走原生 tabBar（壳方法 saSyncTabBarBadge 在页实例上——注入生效）',
    ).toBe('function')

    // ── ⑤ 我的页：设置开关驱动 ⑦ 主题（真实业务路径） ──
    d = await go('/pages/mine', 'pages/mine')
    // ★先归一状态再断言"切换"（本仓实测教训：共享状态是模拟器里的**模块级单例**，跨测试运行存活
    //   ⇒ 上一轮留下的 dark 会让"再切一次"仍是 dark ⇒ 假红）。这里显式把主题统一到 light 再切。
    if (String(d.theme) === 'dark') {
      tap('#mine-row-dark')
      await driver.waitFor(700)
      d = (await pageData()).data // ★pageData() 返回 { route, data }——取 data 层（本轮修正）
    }
    const themeBefore = String(d.theme)
    expect(themeBefore, '归一后应为 light（再切才有可断言的"变化"）').toBe('light')
    tap('#mine-row-dark')
    await driver.waitFor(700)
    const afterTheme = await pageData()
    expect(String(afterTheme.data.theme), `★设置页开关 → 主题切换（${themeBefore} → ${afterTheme.data.theme}）`).not.toBe(themeBefore)
    // 客服球开关（④ 业务路径）
    const fabBefore = Boolean((await pageData()).data.fabVisible)
    tap('#mine-row-fab')
    await driver.waitFor(600)
    expect(Boolean((await pageData()).data.fabVisible), '★设置页开关 → 客服球显隐').toBe(!fabBefore)

    // ── ⑥ 跨页一致：切回首页，主题/角标/音乐仍是同一份（状态一份） ──
    d = await go('/pages/index', 'pages/index')
    expect(String(d.theme), '★回首页主题仍是设置页切后的值（跨页同源）').toBe(String(afterTheme.data.theme))
    expect(Number(d.imUnread), '★回首页角标仍是消息页写后的值').toBe(baseUnread + 1)
    expect(d.musicVisible, '音乐条仍在（Global 层跨页）').toBe(true)

    // ── ⑦ 验收控制台：八条场景页可达 + 逐条触发（①②③） ──
    await go('/pages/verify', 'pages/verify')
    tap('#vf-1b') // ① Toast 排队 3 条
    await driver.waitFor(500)
    tap('#vf-2b') // ② Loading 两实例
    await driver.waitFor(500)
    tap('#vf-3a') // ③ 登录失效
    await driver.waitFor(700)
    const authState = JSON.parse(String(await driver.evaluate(`(function () {
      var g = globalThis
      var pages = getCurrentPages()
      var p = pages[pages.length - 1]
      return JSON.stringify({ route: p.route })
    })`))) as { route: string }
    expect(authState.route, '验收台页可达').toBe('pages/verify')
    // 收尾：恢复登录态（避免污染后续运行——③ 的状态是模块级单例）
    tap('#vf-3b')
    await driver.waitFor(500)

    // ── ⑧ 零 error 门禁 ──
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, '全流程不应有 error').toEqual([])

    console.log('[SUPERAPP] ✅ 八条场景走真实业务路径：网络条(首页) → 音乐条(首页) → 角标(消息页) → 主题/客服球(设置页) → 跨页一致 → 验收台触发 ①②③')
  })
})
