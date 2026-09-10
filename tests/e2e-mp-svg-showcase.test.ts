// tests/e2e-mp-svg-showcase.test.ts
// ★2026-09-09 真机「15 秒后动画停止」根因回归锁（模拟器可复现的部分）：
//   回传节流曾用动画相位（elapsed % duration）比较 → 一个周期后相位回绕、差值恒为负 → src 永久停更。
//   症状极具迷惑性：frames 照常增长（看着像在动），但 emits（canvasToTempFilePath 成功次数）冻结。
//   本用例断言：跨过多个动画周期（演示页主场景 dur=4500ms）后 emits 仍持续增长。
//   ★诚实边界：真机 wxfile:// 路径 + image 解码行为无法在模拟器复现（模拟器路径是 http://tmp/...），
//   路径形态由 tests/svg-canvas.test.ts 的源码契约锁 + 真机复测确认。
// ★运行：PROTEUS_MP_E2E_WXIDE=1 npx vitest run tests/e2e-mp-svg-showcase.test.ts
import path from 'node:path'
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

interface PageSnapshot {
  frames?: number
  emits?: number
  fails?: number
  img?: string
  srcTail?: string
  err?: string
}

const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  return JSON.stringify(p.data ?? {})
}

describe.skipIf(!ENABLED)('p-svg-canvas 回传节流 MP E2E（相位回绕回归锁）', () => {
  it('跨多个动画周期后回传仍持续（emits 不冻结）+ 回传通道零失败 + 截图留档', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    // ① 进页（重试 3 次——CLI refresh 后有瞬态竞态）
    let launched = false
    for (let i = 0; i < 3 && !launched; i++) {
      try {
        await driver.reLaunch('/pages/svg-showcase-demo')
        launched = true
      } catch {
        await driver.waitFor(3000)
      }
    }
    expect(launched, 'reLaunch 应成功（重试 3 次）').toBe(true)

    // ② 进页确认（首次开窗编译慢——轮询到 emits 字段出现）
    let snap: PageSnapshot = {}
    for (let i = 0; i < 5; i++) {
      await driver.waitFor(2000)
      snap = JSON.parse(String(await driver.evaluate(readPageData))) as PageSnapshot
      if (typeof snap.emits === 'number') break
    }
    expect(typeof snap.emits, `进页后应有 emits 字段（实际 data keys 见 ${JSON.stringify(snap).slice(0, 200)}）`).toBe('number')

    // ③ console 零错门禁
    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines).toEqual([])

    // ④ 等过一个完整周期（dur=4500ms）后再等一个周期——修复前 emits 会在此冻结
    await driver.waitFor(5000)
    const at5s = JSON.parse(String(await driver.evaluate(readPageData))) as PageSnapshot
    await driver.waitFor(6000)
    const at11s = JSON.parse(String(await driver.evaluate(readPageData))) as PageSnapshot
    console.log('[SVG-SHOWCASE] at5s=', JSON.stringify(at5s), ' at11s=', JSON.stringify(at11s))

    // 帧数持续（动画在跑）
    expect(at11s.frames || 0, 'frames 应持续增长').toBeGreaterThan(at5s.frames || 0)
    // ★核心断言：跨周期后 emits 仍增长（修复前相位回绕 → emits 冻结）
    expect(at11s.emits || 0, 'emits 应在第二个周期后继续增长（相位回绕回归锁）').toBeGreaterThan(at5s.emits || 0)

    // ⑤ 回传通道健康：零失败 + src 是临时文件路径（非 data-URI）
    expect(at11s.fails || 0, '回传失败计数应为 0').toBe(0)
    expect(String(at11s.srcTail || ''), 'src 应为临时文件路径（非 data: 前缀）').not.toMatch(/^data:/)

    // ⑥ 截图留档
    const shot = await driver.screenshot('/tmp/proteus-svg-showcase.png')
    console.log('[SHOT]', shot)
    expect(shot, '截图应成功').toBeTruthy()

    await driver.close()
  }, 150_000)
})
