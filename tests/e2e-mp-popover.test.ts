// tests/e2e-mp-popover.test.ts
// ★★2026-09-08 重构后 MP E2E：以 **wechatide skill-CLI** 为唯一标准（不再用 miniprogram-automator——与新版 Electron IDE 不兼容）。
//   验证 p-popover「方案 A spike」（Skyline 层叠解药：打开时 measureRect → panelStyle=position:fixed+像素坐标）在真机/模拟器
//   Skyline 运行时无崩溃（此前 automator 通道的 popoverSeq ReferenceError 真机 bug 已由此管线的 console 零错门禁抓到并修复）。
// ★运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-popover.test.ts
//   （前置：build:mp 产出 dist/mp-weixin + 微信开发者工具已开项目窗口 + skyline private config = skylineRenderEnable:true）
// ★15 铁律：进页第一动作 = console 零错门禁（get_simulator_console）→ 绿后才断言。
import { describe, it, expect } from 'vitest'
import { createDriver } from '@proteus-vue/test-core/driver'
import { createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

// ★装配：wechatide CLI + 产物路径（与 ad-hoc/proteus test e2e:mp 一致）
const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'dist/mp-weixin'
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/** ★wechatide debugger 句柄：console 零错门禁（get_simulator_console 全量 → 本端 parse error 行） */
const wxideDebugger: MpDebuggerLike = {
  async consoleGrep(command: string): Promise<string[]> {
    const r = callWxide('get_simulator_console', { command: command || 'grep -n .' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    // ★返回 = 行数组（result.result.result 或直接数组）
    return Array.isArray(r) ? (r as string[]) : typeof r === 'string' ? r.split('\n') : []
  },
  async refresh(): Promise<void> {
    callWxide('simulator_refresh', {}, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
  },
  async clearCache(): Promise<void> {
    callWxide('debug_clear_cache', { action: 'all' }, { cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
  },
}

describe.skipIf(!ENABLED)('p-popover 方案 A MP E2E（wechatide skill-CLI 标准）', () => {
  it('打开 popover → 方案 A 运行时路径无崩溃 + console 零错 → 关闭', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 重置到 demo 页（reLaunch 最稳通道）
    await driver.reLaunch('/pages/semantic-primitives-demo')
    await driver.waitFor(800)

    // ② ★console 零错门禁（进页第一动作）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines).toEqual([]) // 零 error——页面健康

    // ③ data 就绪断言（稳通道 evaluate 读初始态）
    const before = await driver.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1]
      return { route: p.route, popoverOpen: p.data.popoverOpen }
    })
    expect((before as { route: string }).route).toBe('pages/semantic-primitives-demo')
    expect((before as { popoverOpen: boolean }).popoverOpen).toBe(false)

    // ④ 打开 popover（★p-button 自定义组件元素层不可 tap → evaluate 调页面 setData 驱动 v-model）
    await driver.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1]
      p.setData({ popoverOpen: true })
    })
    await driver.waitFor(800)
    const after = await driver.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1]
      return { popoverOpen: p.data.popoverOpen }
    })
    expect((after as { popoverOpen: boolean }).popoverOpen).toBe(true)

    // ⑤ 开完 console 复查：方案 A（openMeasure→adapter.measureRect→setData panelStyle）运行时路径无崩溃
    //   ★popoverSeq ReferenceError 真机 bug 若复发会在此暴露（get_simulator_console 能抓 error 级行）
    const afterLogs = await driver.consoleLogs()
    const afterErr = afterLogs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(afterErr).toEqual([])

    // ⑥ 关闭 popover + 回读
    await driver.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1]
      p.setData({ popoverOpen: false })
    })
    await driver.waitFor(500)
    const closed = await driver.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1]
      return { popoverOpen: p.data.popoverOpen }
    })
    expect((closed as { popoverOpen: boolean }).popoverOpen).toBe(false)

    await driver.close()
  }, 120_000)
})
