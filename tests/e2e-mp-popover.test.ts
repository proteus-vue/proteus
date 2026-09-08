// tests/e2e-mp-popover.test.ts
// ★★2026-09-08 重构后 MP E2E：以 **wechatide skill-CLI** 为唯一标准（不再用 miniprogram-automator——与新版 Electron IDE 不兼容）。
//   验证 p-popover「方案 A spike」（Skyline 层叠解药：打开时 measureRect → panelStyle=position:fixed+像素坐标）：
//   ① 运行时无崩溃（console 零错门禁）② **定位锚定 trigger（非左上角）**——用户实测气泡落左上角的回归锁。
// ★2026-09-08 定位根因与修复（对齐上午测试经验重写本文件）：
//   根因 = measureRect 用 [data-role] 属性选择器（**Skyline 不认属性选择器**，PROJECT_MEMORY L82-84 实证）
//        + class 被 scoped hash（select('.p-popover-trigger') 查不到 .p-popover-trigger-data-v-x）
//        → measureRect 返回 null → panelStyle 空 → 面板 absolute 含块跨 root-portal 失效 → 左上角。
//   修复 = trigger 用静态 id（#proteus-popover-trigger，Skyline 认 id；.in(scope) 限定组件内唯一）
//        + 组件改为标准 <teleport>（编译器转 root-portal——组件不再裸写平台标签，teleport 对齐有真实消费者）。
// ★测试经验（上午用例内化，勿再丢）：
//   ① evaluate 必须传**函数**（无参——wechatide 后端 --args 不生效，内部 toString 序列化）；字符串 `(() => …)()` 形式工具退出码 1。
//   ② 进页先确认（route/data）再操作——未进页面截图/断言必然假失败。
//   ③ 截图用 **/tmp 绝对路径**（wechatide CLI spawn 绝对路径语义；项目相对路径失败）。
//   ④ Skyline 页面被自动包 scroll-view（scroll-top 绑 {{__proteusPageScrollTop}}）——滚动 = setData 该字段。
// ★运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-popover.test.ts
//   或 CLI：PROTEUS_E2E_ONLY=e2e-mp-popover proteus test e2e:mp examples（未改编译器不必跑 vue 能力对齐全家桶）
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'dist/mp-weixin'
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/** ★wechatide debugger 句柄：console 零错门禁（get_simulator_console 全量 → 本端 parse error 行） */
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

/** 页内读当前页 data（evaluate 无参序列化——不要带参，wechatide 后端 --args 不生效） */
const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify(p.data ?? {})
}

/** 读 p-popover 组件实例的 panelStyle（demo id=proteus-popover-demo；MP 编译为组件 data 字段）——定位锚定断言面 */
const readPopoverPanelStyle = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  const inst = p.selectComponent('#proteus-popover-demo')
  return inst && inst.data ? String(inst.data.panelStyle ?? '') : ''
}

describe.skipIf(!ENABLED)('p-popover 方案 A MP E2E（wechatide skill-CLI 标准）', () => {
  it('滚动到触发器 → 打开 popover → 面板锚定 trigger（非左上角）→ 截图留档 → 关闭', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 进页（reLaunch 最稳通道）——★navigate 有瞬态失败（CLI refresh 后服务竞态，手动重试即成功）→ 带重试
    let launched = false
    for (let i = 0; i < 3 && !launched; i++) {
      try {
        await driver.reLaunch('/pages/semantic-primitives-demo')
        launched = true
      } catch {
        await driver.waitFor(3000) // 服务忙 → 等待重试（瞬态失败实测重试即成功）
      }
    }
    expect(launched, 'reLaunch 应成功（重试 3 次）').toBe(true)
    await driver.waitFor(800)

    // ② ★console 零错门禁（进页第一动作）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines).toEqual([]) // 零 error——页面健康

    // ③ 进页确认（上午模式：先确认进页，才操作）——route 必须 semantic-primitives-demo（首次开窗编译时序可能停在首页 → 重试）
    let pageData = JSON.parse(String(await driver.evaluate(readPageData))) as Record<string, unknown>
    // readPageData 不含 route（微信 data 无 route）——用 currentPage 通道确认；不对则再等再试（首次开窗编译慢）
    for (let i = 0; i < 3 && !JSON.stringify(pageData).includes('popoverOpen'); i++) {
      await driver.waitFor(2000)
      pageData = JSON.parse(String(await driver.evaluate(readPageData)))
    }
    expect(pageData.popoverOpen, `进页后应有 popoverOpen 字段（实际 data keys=${Object.keys(pageData).slice(0, 8).join(',')}）`).toBe(false)

    // ④ ★滚动到 popover 触发器（Skyline 页面被自动包 scroll-view，scroll-top 绑 {{__proteusPageScrollTop}}——setData 即滚动）
    //    popover 在 ③ Shell 区块（页面下方），不滚动则 trigger 在视口外（面板坐标也出视口，截图看不到锚定效果）
    await driver.evaluate(() => {
      const pages = getCurrentPages()
      pages[pages.length - 1].setData({ __proteusPageScrollTop: 1500 })
    })
    await driver.waitFor(600) // scroll-with-animation 动画

    // ⑤ 打开 popover（p-button 自定义组件元素层不可 tap → evaluate 调页面 setData 驱动 v-model）
    await driver.evaluate(() => {
      const pages = getCurrentPages()
      pages[pages.length - 1].setData({ popoverOpen: true })
    })
    await driver.waitFor(800)
    const after = JSON.parse(String(await driver.evaluate(readPageData))) as { popoverOpen?: boolean }
    expect((after as { popoverOpen?: boolean }).popoverOpen, 'popoverOpen 应为 true（打开）').toBe(true)

    // ⑥ ★定位断言（核心回归锁）：panelStyle 应含 fixed + 非 0 坐标（measureRect 成功 → 面板锚定 trigger 下方，非左上角）
    const panelStyle = String(await driver.evaluate(readPopoverPanelStyle))
    console.log('[POP-STYLE]', panelStyle)
    expect(panelStyle, 'p-popover panelStyle 应为非空 fixed 坐标（measureRect 成功锚定）').toMatch(/position:fixed/)
    expect(panelStyle).not.toMatch(/left:0px;top:0px/)

    // ⑦ ★截图留档（/tmp 绝对路径——上午模式；供人工确认气泡锚定触发源/不被遮挡）——popover 打开态
    const shotPath = await driver.screenshot('/tmp/proteus-popover-open.png')
    console.log('[SHOT] popover open →', shotPath)
    expect(shotPath, 'popover 打开截图应成功').toBeTruthy()

    // ⑧ console 零错复查（openMeasure→measureRect→setData panelStyle 运行时路径无崩溃）
    const afterLogs = await driver.consoleLogs()
    const afterErr = afterLogs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(afterErr).toEqual([])

    // ⑨ 关闭 popover + 回读
    await driver.evaluate(() => {
      const pages = getCurrentPages()
      pages[pages.length - 1].setData({ popoverOpen: false })
    })
    await driver.waitFor(500)
    const closed = JSON.parse(String(await driver.evaluate(readPageData))) as { popoverOpen?: boolean }
    expect(closed.popoverOpen, 'popoverOpen 应为 false（关闭）').toBe(false)

    await driver.close()
  }, 120_000)
})
