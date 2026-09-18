// tests/e2e-mp-retest.test.ts
// ★2026-09-09 用户欠的真机复测清单自动化（PROJECT_MEMORY 待办）：p-modal / p-safe / p-aspect / p-sidebar ☰ 展开
//   驱动 = wechatide skill-CLI 标准（同 e2e-mp-popover）；页面 = examples/pages/fluid-system-demo（四组件 id=retest-*）
//   断言面 = evaluate 读组件实例 data（稳定通道，不受模拟器激活态影响）+ 关键态截图留档（/tmp 绝对路径）
// 复测项 ↔ 断言：
//   p-modal 底部 sheet 定位/遮罩：variants 产出（MAX_SAFE_INTEGER 修复链）+ panelStyle 非空 + shown 下行链
//   p-modal 取消确定回写：onMaskTap → triggerEvent('update-visible') → 页面 proteusUpdateShowModel → data.showModal=false（v-model 闭环）
//   p-safe：safeStyle 含 env(safe-area-inset-top) + max(..., 44px) 兜底（fallback 语义在产物层生效）
//   p-aspect：aspectOk 探测 + aspectStyle/innerStyle 非空（padding-top hack 降级链在位）
//   p-sidebar ☰ 展开：collapsed → toggleCollapsed() → collapsed-open（#501 v-show 复合括号修复的语义面）
// ★运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-retest.test.ts
//   或 CLI：PROTEUS_E2E_ONLY=e2e-mp-retest proteus test e2e:mp examples
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'dist/mp-weixin'
const ENABLED = process.env.PROTEUS_MP_E2E_WXIDE === '1'

/** console 零错门禁（真机崩因 = ReferenceError 被 catch 吞掉的弧内主坑——get_simulator_console 全量） */
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

/** 页内读当前页 data（evaluate 无参——wechatide 后端 --args 不生效，内部 toString 序列化） */
const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify(p.data ?? {})
}

/** 读指定 id 组件实例的 data 子集（id + 字段名单参传入——evaluate 无参，字段名打包进 JSON 字符串后页内解析） */
const readComponentData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  const out: Record<string, Record<string, unknown>> = {}
  for (const id of ['retest-safe-top', 'retest-aspect', 'retest-sidebar', 'retest-modal']) {
    const inst = p.selectComponent('#' + id) as { data?: Record<string, unknown> } | null
    if (inst && inst.data) out[id] = inst.data
  }
  return JSON.stringify(out)
}

describe.skipIf(!ENABLED)('真机复测清单 MP E2E（p-modal/p-safe/p-aspect/p-sidebar——wechatide 标准）', () => {
  it('fluid-system-demo 四组件：数据链断言 + ☰ 展开 + 弹窗开合回写 + 关键态截图', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 进页（reLaunch 最稳通道；瞬态失败重试——popover 弧实测经验）
    let launched = false
    for (let i = 0; i < 3 && !launched; i++) {
      try {
        await driver.reLaunch('/pages/fluid-system-demo')
        launched = true
      } catch {
        await driver.waitFor(3000)
      }
    }
    expect(launched, 'reLaunch 应成功（重试 3 次）').toBe(true)
    await driver.waitFor(1000)

    // ② 进页确认（data 必含 showModal 才算进对页——首次开窗编译时序可能停首页）
    let pageData = JSON.parse(String(await driver.evaluate(readPageData))) as Record<string, unknown>
    for (let i = 0; i < 3 && pageData.showModal === undefined; i++) {
      await driver.waitFor(2000)
      pageData = JSON.parse(String(await driver.evaluate(readPageData)))
    }
    expect(pageData.showModal, `进页后应有 showModal 字段（实际 keys=${Object.keys(pageData).slice(0, 8).join(',')}）`).toBe(false)

    // ②.5 ★Skyline 前置门禁（2026-09-09 复测踩坑：产物 json 声明 renderer:skyline 不够——IDE 需
    //   project.config.json setting.skylineRenderEnable 开关，否则模拟器静默回落 WebView →
    //   复测结论全部失真。此处硬断言运行时真的在 Skyline，防止「WebView 跑出 Skyline 结论」）
    const skylineInfo = String(await driver.evaluate(() => JSON.stringify(wx.getSkylineInfoSync ? wx.getSkylineInfoSync() : { isSupported: false })))
    console.log('[SKYLINE]', skylineInfo)
    expect(skylineInfo, `运行时必须是 Skyline（实际 ${skylineInfo}——产物 project.config.json 需 setting.skylineRenderEnable:true）`).toContain('"isSupported":true')

    // ③ console 零错门禁（进页第一动作——ReferenceError 被 catch 吞掉的弧内主坑靠它兜底）
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines, `console 应零 error（实际：${errLines.slice(0, 3).map((l) => l.text.slice(0, 120)).join(' | ')}）`).toEqual([])

    // ④ 四组件实例 data 一次性读回（派生字段 safeStyle/variants/mode 在 attached/onReady 初始化——轮询到就绪）
    let compData = JSON.parse(String(await driver.evaluate(readComponentData))) as Record<string, Record<string, unknown>>
    for (let i = 0; i < 6 && !compData['retest-safe-top']?.safeStyle; i++) {
      await driver.waitFor(1000)
      compData = JSON.parse(String(await driver.evaluate(readComponentData))) as Record<string, Record<string, unknown>>
    }
    console.log('[COMP-KEYS]', Object.fromEntries(Object.entries(compData).map(([k, v]) => [k, Object.keys(v).slice(0, 12)])))

    // ⑤ p-safe：safeStyle 含 env(safe-area-inset-top) + max(…, 44px)（fallback 兜底语义在产物层生效）
    const safe = compData['retest-safe-top'] ?? {}
    expect(String(safe.safeStyle ?? ''), 'p-safe safeStyle 应含 env(safe-area-inset-top)').toContain('safe-area-inset-top')
    expect(String(safe.safeStyle ?? ''), 'p-safe safeStyle 应含 max( 兜底（fallback=44）').toContain('max(')
    expect(String(safe.safeStyle ?? ''), 'p-safe fallback 44px 应进表达式').toContain('44px')

    // ⑥ p-aspect：aspectClass/aspectStyle/innerStyle 非空（ready 派生链在位；aspectOk 是实例属性不落 data——
    //   探测结果经 aspectClass 体现：fallback 类 = 不支持 aspect-ratio 走 padding-top hack）
    const aspect = compData['retest-aspect'] ?? {}
    expect(typeof aspect.aspectClass, 'p-aspect 应有 aspectClass（ready 派生）').toBe('string')
    expect(String(aspect.aspectStyle ?? ''), 'p-aspect aspectStyle 应非空').toBeTruthy()
    expect(String(aspect.innerStyle ?? ''), 'p-aspect innerStyle 应非空').toBeTruthy()
    console.log('[ASPECT]', JSON.stringify(aspect))

    // ⑦ p-sidebar ☰ 展开：collapsed → toggleCollapsed → collapsed-open（#501 v-show 复合括号修复的语义面）
    const sidebar = compData['retest-sidebar'] ?? {}
    const beforeMode = String(sidebar.mode ?? '')
    console.log('[SIDEBAR] before:', beforeMode, 'userExpanded:', sidebar.userExpanded)
    expect(['collapsed', 'side-rail', 'collapsed-open']).toContain(beforeMode)
    // ☰ 展开（组件方法 evaluate 直调——元素层 tap 受模拟器激活态限制）
    await driver.evaluate(() => {
      const pages = getCurrentPages()
      const inst = (pages[pages.length - 1] as unknown as { selectComponent: (s: string) => { toggleCollapsed: () => void } | null }).selectComponent('#retest-sidebar')
      if (inst) inst.toggleCollapsed()
    })
    await driver.waitFor(600)
    const afterSide = JSON.parse(String(await driver.evaluate(readComponentData))) as Record<string, Record<string, unknown>>
    const sideMode = String(afterSide['retest-sidebar']?.mode ?? '')
    console.log('[SIDEBAR] after toggle:', sideMode)
    if (beforeMode === 'collapsed') {
      expect(sideMode, '☰ 点击后 collapsed 应展开为 collapsed-open').toBe('collapsed-open')
    } else {
      expect(sideMode, 'side-rail/collapsed-open 下 toggle 不应崩（模式如实回读）').toBeTruthy()
    }

    // ⑧ p-modal 打开：页面 setData showModal → 组件 shown 下行链（v-model 下行）
    await driver.evaluate(() => {
      const pages = getCurrentPages()
      ;(pages[pages.length - 1] as unknown as { setData: (d: Record<string, unknown>) => void }).setData({ showModal: true })
    })
    await driver.waitFor(1000)
    const modalOpen = JSON.parse(String(await driver.evaluate(readComponentData))) as Record<string, Record<string, unknown>>
    const modal = modalOpen['retest-modal'] ?? {}
    expect(Boolean(modal.shown), 'p-modal shown 应随页面 showModal 下行为 true').toBe(true)
    // ★#502 修复链断言：variants 产出（MAX_SAFE_INTEGER，JSON 序列化安全——否则整次 setData 放弃全丢）
    const variants = modal.variants
    expect(variants, 'p-modal variants 应已产出（setData 序列化修复链）').toBeTruthy()
    const variantsStr = JSON.stringify(variants)
    expect(variantsStr, 'variants 应含 sheet 档（375 宽模拟器 → sheet(0,600)）').toContain('sheet')
    expect(variantsStr).not.toContain('Infinity') // 非有限数进 data = 微信整次放弃（反黑盒）
    expect(String(modal.panelStyle ?? ''), 'p-modal panelStyle 应非空（底部 sheet 定位）').toBeTruthy()
    console.log('[MODAL]', JSON.stringify({ variants, panelStyle: modal.panelStyle, maskStyle: modal.maskStyle }))

    // ⑨ 打开态截图留档（底部 sheet 定位/遮罩半透明——人工确认面）
    const shotOpen = await driver.screenshot('/tmp/proteus-retest-modal-open.png')
    console.log('[SHOT] modal open →', shotOpen)
    expect(shotOpen, '弹窗打开截图应成功').toBeTruthy()

    // ⑩ 取消确定回写（v-model 闭环）：组件 onMaskTap → triggerEvent('update-visible') → 页面回写 showModal=false
    await driver.evaluate(() => {
      const pages = getCurrentPages()
      const inst = (pages[pages.length - 1] as unknown as { selectComponent: (s: string) => { onMaskTap: () => void } | null }).selectComponent('#retest-modal')
      if (inst) inst.onMaskTap()
    })
    await driver.waitFor(800)
    const closed = JSON.parse(String(await driver.evaluate(readPageData))) as { showModal?: boolean }
    expect(closed.showModal, '遮罩关闭应经 update-visible 回写页面 showModal=false（v-model 闭环）').toBe(false)

    // ⑪ console 零错复查（开合/回写全链路无崩溃）
    const afterLogs = await driver.consoleLogs()
    const afterErr = afterLogs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(afterErr, `全链路 console 应零 error（实际：${afterErr.slice(0, 3).map((l) => l.text.slice(0, 120)).join(' | ')}）`).toEqual([])

    await driver.close()
  }, 180_000)
})
