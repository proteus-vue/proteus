// tests/e2e-mp-gp0-root-portal.test.ts —— ★★★GP0-a：root-portal 点击可达性 E2E（2026-10-03）
//
// 【这张卡是什么】《Proteus_全局挂载点任务卡清单.md》的 **GP0-a**（最高优先级·一票否决卡）：
//   社区报告「基础库 3.8.4 + Skyline 下 root-portal 内组件点击穿透（3.5.8 正常）」，
//   规避 = `virtualHost=false`。本用例把该验证**固化为可重跑判据**（不再依赖一次性手工操作）。
//
// 【判据设计（本仓纪律：不只看一个证据）】
//   ① **主树对照**（`mainTaps`）：主树按钮点了不涨 ⇒ 是链路问题，**不是穿透**（防误判）
//   ② **portal 内原生元素**（`portalTaps`）：社区报告的直接复现形态
//   ③ **portal 内自定义组件**（`portalCompTaps`）：**组件边界吞事件**是另一种失效形态
//      （本仓既有经验：原生 tap 不跨组件边界，p-button 走 click + bubbles/composed）
//   ④ **console 落痕**（`[GP0A]` 前缀）：事件真的到了 **JS 层**（页面 data 可能是缓存/没刷新）
//   ⑤ **零 error 门禁**：进页后无 console error（页面健康）
//
// 【★适用范围（必须写在这里，防"结论被放大"）】本用例只证明**当前运行环境**（基础库由 IDE 决定）
//   下 portal 点击可达。**基础库版本矩阵未覆盖**——工具链无切换入口（详见实测报告 §3/§4）。
//   跑完读报告：`docs/gp0a-root-portal-report.md`
//
// 【★装置经验（照抄自 e2e-mp-popover，勿再丢）】
//   ① `automation_element_action` 的短类名查不到（scoped hash）⇒ 探针页用**静态 id**（Skyline 认 id）
//   ② `open_page` 只触发编译不保证导航 ⇒ 用例内用 `reLaunch`（最稳通道）
//   ③ 进页先确认（读 data 特征字段）再操作——未进页断言必然假失败
//   ④ 首次开窗编译慢 ⇒ 带重试（瞬态失败重试即成功）
//
// 运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-gp0-root-portal.test.ts
//   （或 PROTEUS_E2E_ONLY=e2e-mp-gp0-root-portal proteus test e2e:mp examples）
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || path.resolve(__dirname, '..', 'examples/dist/mp-weixin')
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/** wechatide debugger 句柄：console 读取（零错门禁 + GP0A 落痕） */
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

/** 页内读当前页 data（evaluate 必须传**无参函数**——wechatide 后端 --args 不生效） */
const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify(p.data ?? {})
}

/** 读基础库版本（**结论适用范围**——报告要引用它） */
const readSdkVersion = (): string => {
  const i = (wx as unknown as { getAppBaseInfo?: () => { SDKVersion?: string } }).getAppBaseInfo?.()
    ?? (wx as unknown as { getSystemInfoSync: () => { SDKVersion?: string } }).getSystemInfoSync()
  return JSON.stringify({ SDKVersion: (i as { SDKVersion?: string }).SDKVersion ?? 'unknown' })
}

const GP0_PAGE = '/pages/gp0-root-portal'

describe.skipIf(!ENABLED)('GP0-a · root-portal 点击可达性（wechatide skill-CLI）', () => {
  it('主树对照 + portal 内原生元素 + portal 内自定义组件：三者点击都到 JS（穿透回归锁）', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 进页（reLaunch 最稳；瞬态失败重试）
    let launched = false
    for (let i = 0; i < 3 && !launched; i++) {
      try {
        await driver.reLaunch(GP0_PAGE)
        launched = true
      } catch {
        await driver.waitFor(3000)
      }
    }
    expect(launched, 'reLaunch 应成功（重试 3 次）').toBe(true)
    await driver.waitFor(800)

    // ② 进页确认（读 data 特征字段——未进页断言必然假失败）
    let data = JSON.parse(String(await driver.evaluate(readPageData))) as Record<string, unknown>
    for (let i = 0; i < 3 && !('portalTaps' in data); i++) {
      await driver.waitFor(2000)
      data = JSON.parse(String(await driver.evaluate(readPageData)))
    }
    expect('portalTaps' in data, `应在 GP0 页（data keys=${Object.keys(data).slice(0, 8).join(',')}）`).toBe(true)

    // ③ ★基础库版本（写进断言消息——结论适用范围必须可追溯）
    const sdk = JSON.parse(String(await driver.evaluate(readSdkVersion))) as { SDKVersion: string }
    console.log(`[GP0A] 基础库 SDKVersion=${sdk.SDKVersion}`)

    // ④ 零 error 门禁（页面健康——console 里的 error 会让后续结论不可信）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, `进页不应有 error（SDK=${sdk.SDKVersion}）`).toEqual([])

    /** 点一个选择器并读回某个计数（含等待 JS 侧 setData 落盘） */
    const tapAndRead = async (selector: string, field: string): Promise<number> => {
      callWxide('automation_element_action', { action: 'tap', selector }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
      await driver.waitFor(400)
      const d = JSON.parse(String(await driver.evaluate(readPageData))) as Record<string, number>
      return Number(d[field] ?? -1)
    }

    // ⑤ **主树对照**（若它不涨 ⇒ 装置/链路问题，不是穿透）
    const mainTaps = await tapAndRead('#gp0-main-btn', 'mainTaps')
    expect(mainTaps, `主树按钮应可点（SDK=${sdk.SDKVersion}）——不涨说明装置问题，不是穿透`).toBe(1)

    // ⑥ **portal 内原生元素**（社区报告的直接复现形态）
    const portalTaps = await tapAndRead('#gp0-portal-btn', 'portalTaps')
    expect(
      portalTaps,
      `★portal 内原生 button 点击应到 JS（SDK=${sdk.SDKVersion}）——若恒为 0 即复现了社区报告的穿透`,
    ).toBe(1)

    // ⑦ **portal 内自定义组件**（组件边界吞事件是另一种失效形态）
    const compTaps = await tapAndRead('#gp0-portal-comp', 'portalCompTaps')
    expect(
      compTaps,
      `★portal 内自定义组件（p-button）点击应到 JS（SDK=${sdk.SDKVersion}）——组件边界不吞事件`,
    ).toBe(1)

    // ⑧ **console 落痕**（独立证据链：事件真的到 JS，不只是 data 变了）
    const gp0Logs = (await driver.consoleLogs('GP0A')).map((l) => l.text)
    const joined = gp0Logs.join('\n')
    expect(joined, 'console 应有 main-tap 落痕').toContain('main-tap')
    expect(joined, 'console 应有 portal-tap 落痕').toContain('portal-tap')
    expect(joined, 'console 应有 portal-comp-tap 落痕').toContain('portal-comp-tap')

    console.log(`[GP0A] ✅ 三形态点击均到 JS（SDK=${sdk.SDKVersion}）：main=${mainTaps} portal=${portalTaps} comp=${compTaps}`)
  })
})
