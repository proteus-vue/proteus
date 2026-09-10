// tests/e2e-mp-svg-skeleton.test.ts
// ★2026-09-10 SVG 骨骼动画 MP E2E：验证**嵌套 <g> 变换复合**（层级运动学）在真机产物上连续渲染。
//   编译器契约：深层子级 animateTransform → 走 Canvas 通道（CSS 只能整图转，见 tests/svg-anim.test.ts）。
//   本用例锁运行时侧：帧数/回传持续增长（动画确实在跑）+ 回传零失败 + src 非 data:。
//   ★诚实边界：骨骼「姿态是否正确」属视觉，模拟器截图留档人工确认；本用例锁的是「在跑 + 通道健康」。
// ★运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-svg-skeleton.test.ts
import { describe, it, expect } from 'vitest'
import { createDriver, createWxideMini, callWxide } from '@proteus-vue/test-core/driver'
import type { MpDebuggerLike } from '@proteus-vue/test-core/driver'

const WXIDE_CLI = process.env.PROTEUS_IDE_CLI || '/Volumes/data1/applications/wechatwebdevtools.app/Contents/MacOS/wechatide'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH || 'dist/mp-weixin'
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

interface Snap {
  frames?: number
  emits?: number
  issued?: number
  fails?: number
  img?: string
  srcTail?: string
}

const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify(p.data ?? {})
}

describe.skipIf(!ENABLED)('p-svg-canvas 骨骼动画 MP E2E（嵌套变换复合）', () => {
  it('嵌套关节动画持续渲染 + 回传通道健康 + 截图留档', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    let launched = false
    for (let i = 0; i < 3 && !launched; i++) {
      try {
        await driver.reLaunch('/pages/svg-skeleton-demo')
        launched = true
      } catch {
        await driver.waitFor(3000)
      }
    }
    expect(launched, 'reLaunch 应成功（重试 3 次）').toBe(true)

    let snap: Snap = {}
    for (let i = 0; i < 5; i++) {
      await driver.waitFor(2000)
      snap = JSON.parse(String(await driver.evaluate(readPageData))) as Snap
      if (typeof snap.frames === 'number') break
    }
    expect(typeof snap.frames, '应有 frames 字段（页面已就绪）').toBe('number')

    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines).toEqual([])

    // 跨多个动画周期（1.2s 周期）采样：帧数与回传持续增长
    await driver.waitFor(3000)
    const a = JSON.parse(String(await driver.evaluate(readPageData))) as Snap
    await driver.waitFor(4000)
    const b = JSON.parse(String(await driver.evaluate(readPageData))) as Snap
    console.log('[SVG-SKELETON] a=', JSON.stringify({ f: a.frames, em: a.emits, fa: a.fails }), ' b=', JSON.stringify({ f: b.frames, em: b.emits, fa: b.fails }))

    expect(b.frames || 0, 'frames 应持续增长（嵌套动画在跑）').toBeGreaterThan(a.frames || 0)
    expect(b.emits || 0, 'emits 应持续增长').toBeGreaterThan(a.emits || 0)
    expect(b.fails || 0, '回传失败应为 0').toBe(0)
    expect(String(b.srcTail || ''), 'src 应为临时文件路径（非 data:）').not.toMatch(/^data:/)

    const shot = await driver.screenshot('/tmp/proteus-svg-skeleton.png')
    console.log('[SHOT]', shot)
    expect(shot, '截图应成功').toBeTruthy()

    await driver.close()
  }, 150_000)
})
