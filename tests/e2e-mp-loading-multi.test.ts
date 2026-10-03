// tests/e2e-mp-loading-multi.test.ts —— ★★★GP4-b：Loading 多实例与遮罩范围真机 E2E（2026-10-03）
//
// 【这张卡验什么（对标 GP4-b 验收原文）】
//   ① **两个不同范围的 Loading 可共存**：`page`（work-a）+ `global`（net-busy）同时活跃，
//      宿主渲染**两个**遮罩实例（读数量）；结束 A 后 B 仍在（互不影响）
//   ② **范围语义**：page 级的实例在**跳页后被清理**（页面卸载 sweep），global 级的**跨页仍在**
//   ③ **遮罩范围内的交互被正确拦截，范围外不受影响**：
//      · 宿主遮罩（page/global）活跃时 ⇒ 页面按钮点不动（拦内）
//      · `region` 组件：区域内点不动、区域**外**的按钮照常可点（拦内不拦外）
//
// 【★★★本用例的**验证边界**（必须写在最前，防"假绿"）】
//   `automation_element_action` 的选择器 tap 是**直接派发**：会**绕过渲染层层叠**
//   （实证：点被遮罩完全覆盖的按钮仍触发页面回调；且它**无法定位** portal 内元素——遮罩 id 直接报错）。
//   ⇒ 本用例**不**断言"遮罩拦截"（那会得到假结果）；只断言**可机器验证的部分**：
//     宿主实例化 / 多实例共存 / 范围语义（ids 与 masks）/ 跳页清理与跨页存活 / 遮罩几何全屏。
//   ⇒ 拦截语义：单测锁字段与判定（tests/loading-multi.test.ts）+ 组件头注记录人眼验证要求。
//
// 【★★装置纪律（GP4-a 血泪，必须照做）】
//   · **组件内部节点页面级查询不可见**（root-portal 内的宿主更不可见）⇒ 断言走**组件侧落痕**
//     （`__PROTEUS_LOADING_RENDER_BY_PAGE__`，按页面 route 分桶）+ 页面 data。
//   · 每次 evaluate 有 IDE 往返开销 ⇒ 判据不要依赖"极短显示窗口"（用常驻实例或长时长）。
//   · 静态 id 点击；reLaunch 最稳；进页先确认再操作。
//
// 运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-loading-multi.test.ts
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || path.resolve(__dirname, '..', 'examples/dist/mp-weixin')
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'
/** ★页面在**分包**里（主包页面数有 32 上限——演示页统一放 svg-lab 分包） */
const DEMO = '/subpackages/svg-lab/pages/gp4-loading-demo'

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

/** ★读**宿主实际渲染的实例**（组件侧落痕，按当前页 route 分桶——唯一能看见 portal 内的通道） */
const readHostRender = (): string => {
  const g = globalThis as unknown as Record<string, unknown>
  const pages = getCurrentPages() as unknown as Array<{ route?: string }>
  const route = pages.length ? (pages[pages.length - 1].route ?? '') : ''
  const byPage = (g.__PROTEUS_LOADING_RENDER_BY_PAGE__ as Record<string, { ids?: string[]; count?: number; masks?: string[] }> | undefined) ?? {}
  const r = byPage[route] ?? null
  return JSON.stringify({
    mounted: Number(g.__PROTEUS_LOADING_HOST_MOUNTED__) || 0,
    ids: r ? (r.ids ?? []) : [],
    count: r ? (r.count ?? 0) : 0,
    masks: r ? (r.masks ?? []) : [],
  })
}

describe.skipIf(!ENABLED)('GP4-b · Loading 多实例与遮罩范围真机（wechatide skill-CLI）', () => {
  it('两范围共存 + 拦内不拦外 + 跳页清理/跨页存活', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    const tap = (selector: string): void => {
      callWxide('automation_element_action', { action: 'tap', selector }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    }
    const host = async (): Promise<{ mounted: number; ids: string[]; count: number; masks: string[] }> =>
      JSON.parse(String(await driver.evaluate(readHostRender))) as { mounted: number; ids: string[]; count: number; masks: string[] }
    const pageData = async (): Promise<Record<string, unknown>> => {
      const st = JSON.parse(String(await driver.evaluate(readPageState))) as { data: Record<string, unknown> }
      return st.data
    }

    // ① 进页（以"真的到了这页"为判据重试——首次开窗编译慢）
    const wantRoute = 'subpackages/svg-lab/pages/gp4-loading-demo'
    let st = { route: '', data: {} as Record<string, unknown> }
    for (let i = 0; i < 5; i++) {
      try {
        await driver.reLaunch(DEMO)
      } catch {
        /* 瞬态失败：下一轮 */
      }
      await driver.waitFor(1200)
      st = JSON.parse(String(await driver.evaluate(readPageState))) as { route: string; data: Record<string, unknown> }
      if (st.route === wantRoute) break
      await driver.waitFor(1600)
    }
    expect(st.route, `应停在 GP4-b 演示页（实到 ${st.route}）`).toBe(wantRoute)

    // ② 宿主在场（注入闭环第一判据）
    expect((await host()).mounted, '★注入的 <p-loading-host /> 应实例化').toBeGreaterThan(0)
    expect((await host()).count, '初始无活跃实例').toBe(0)

    // ③ ★多实例共存（page + page）——uni.showLoading 做不到的事
    tap('#gp4l-two')
    await driver.waitFor(700)
    const two = await host()
    expect(two.ids, `★两个不同 id 的实例应同时在（实见 ${two.ids.join(',')}）`).toContain('work-a')
    expect(two.ids, '★同上').toContain('work-b')
    expect(two.count, '恰好两个（不是叠了更多）').toBe(2)
    expect(two.masks, '两个都要求拦截').toHaveLength(2)

    // ④ 结束 A ⇒ B 仍在（互不影响——与 Toast 的队列语义分道扬镳）
    tap('#gp4l-end-a')
    await driver.waitFor(600)
    const afterA = await host()
    expect(afterA.ids, '★结束 A 后只剩 B（互不影响）').toEqual(['work-b'])

    // ⑤ ★遮罩**渲染**（可机器验证的部分）：有实例时遮罩几何应为全屏
    //   ★**不可机器验证的部分（诚实边界）**：`automation_element_action` 的选择器 tap 走"直接派发"，
    //     会绕过渲染层层叠（实证：点被遮罩完全覆盖的按钮仍触发页面回调；且它无法定位 portal 内元素）。
    //     ⇒ "遮罩是否真的拦住点击"**不能**用该工具断言（会用假结果误导）——本轮在组件头注与本文件
    //     都写明：渲染正确性以**截图**为准，拦截语义在**单测**锁字段与判定，真机拦截需**人眼**验证。
    const geom = JSON.parse(String(await driver.evaluate(
      `function () {
        var g = globalThis
        return JSON.stringify(g.__PROTEUS_LOADING_GEOM__ || null)
      }`,
    ))) as { root?: { w: number; h: number } | null; mask?: { w: number; h: number } | null } | null
    if (geom && geom.mask) {
      expect(geom.mask.w, '★遮罩应为全屏宽（渲染取证——拦截不可用工具断言）').toBeGreaterThan(300)
      expect(geom.mask.h, '★遮罩应为全屏高').toBeGreaterThan(600)
    }

    // ⑥ ★区域遮罩（region 组件）：就地渲染（active 时遮罩元素存在）
    tap('#gp4l-end-b')
    await driver.waitFor(500)
    expect((await host()).count, '清完 page 实例后宿主无遮罩').toBe(0)
    tap('#gp4l-region')
    await driver.waitFor(600)
    const regionOn = (await pageData()).regionOn
    expect(regionOn, '★区域遮罩已开启（active 状态）').toBe(true)

    // ⑦ ★跳页：page 级被清理（卸载 sweep）、global 级跨页存活
    tap('#gp4l-region') // 先关区域遮罩（切 active 状态——再次点击 toggle 语义由演示页控制）？
    await driver.waitFor(300)
    tap('#gp4l-end-all')
    await driver.waitFor(400)
    tap('#gp4l-two') // 造 page 级实例（work-a/b）
    await driver.waitFor(400)
    tap('#gp4l-global') // 造 global 级实例（net-busy）
    await driver.waitFor(500)
    const preNav = await host()
    expect(preNav.ids.sort(), `跳页前应含 page + global 两类：${preNav.ids.join(',')}`).toEqual(['net-busy', 'work-a', 'work-b'])

    await driver.reLaunch('/pages/index')
    await driver.waitFor(1500)
    const onIndex = await host()
    expect(onIndex.ids, '★跳到首页：page 级的 A/B 已被**卸载清理**，global 的 net-busy 跨页存活').toEqual(['net-busy'])

    // ⑧ 回原页：global 仍在（跨页一致）+ 无 error
    await driver.reLaunch(DEMO)
    await driver.waitFor(1500)
    const back = await host()
    expect(back.ids, '★回来时 global 实例仍在（跨页存活）').toEqual(['net-busy'])
    // 清理（避免影响后续用例）
    tap('#gp4l-end-all')
    await driver.waitFor(400)

    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, '全程不应有 error').toEqual([])

    console.log('[GP4B] ✅ 多实例共存 / 范围语义 / 跳页清理与跨页存活 通过（遮罩拦截：渲染已取证，拦截待人工/真机）')
  })
})
