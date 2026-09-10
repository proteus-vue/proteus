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
  mode?: string
  speed?: number
  seed?: number
  progress?: number
  frames?: number
  emits?: number
  issued?: number
  fails?: number
  img?: string
  srcTail?: string
}

/** 只取本用例需要的**小字段**——页 data 含 3 个大型场景对象（proteusSvgScene1-3），
 *  整体 JSON.stringify 体积很大（会拖慢/截断 evaluate 通道）→ 显式挑选。 */
const readPageData = (): string => {
  const pages = getCurrentPages()
  const p = pages[pages.length - 1]
  const d = p.data ?? {}
  return JSON.stringify({
    mode: d.mode,
    speed: d.speed,
    seed: d.seed,
    progress: d.progress,
    frames: d.frames,
    emits: d.emits,
    issued: d.issued,
    fails: d.fails,
    srcTail: d.srcTail,
  })
}

describe.skipIf(!ENABLED)('p-svg-canvas 骨骼动画 MP E2E（嵌套变换复合）', () => {
  it('嵌套关节动画持续渲染 + 回传通道健康 + 截图留档', async () => {
    const mini = createWxideMini({ cliPath: WXIDE_CLI, project: PROJECT, client: 'zed' })
    const driver = createDriver({ platform: 'mp', mini, debugger: wxideDebugger })

    /** ★IDE 窗口会瞬态掉线（automation_evaluate 报退出码 1/null）——所有 evaluate 走重试：
     *  这是 IDE 基建抖动，非产品问题；重试 3 次（每次等 1.5s）通常能拿到结果。 */
    const evalRetry = async <T,>(fn: unknown, times = 3): Promise<T> => {
      let last: unknown
      for (let i = 0; i < times; i++) {
        try {
          return (await driver.evaluate(fn as never)) as T
        } catch (e) {
          last = e
          try {
            await driver.waitFor(1500)
          } catch {
            /* 忽略 */
          }
        }
      }
      throw last
    }
    const readData = async (): Promise<Snap> => JSON.parse(String(await evalRetry(readPageData))) as Snap

    let launched = false
    for (let i = 0; i < 6 && !launched; i++) {
      try {
        await driver.reLaunch('/pages/svg-skeleton-demo')
        launched = true
      } catch {
        // ★IDE 窗口瞬态掉线 / CLI 竞态 → 吞掉错误重试（waitFor 本身也可能失败）
        try {
          await driver.waitFor(3000)
        } catch {
          /* 忽略 */
        }
      }
    }
    expect(launched, 'reLaunch 应成功（重试 6 次）').toBe(true)

    // ★就绪轮询（★实证：CLI refresh 后模拟器可能仍在编译 / 页面回退首页 / IDE 窗口瞬态掉线——
    //   故 waitFor 与 evaluate 都容错重试，必要时重导航）
    let snap: Snap = {}
    for (let i = 0; i < 12; i++) {
      try {
        await driver.waitFor(2000)
        snap = await readData()
      } catch {
        snap = {} // evaluate/waitFor 瞬态失败（CLI 竞态 / 窗口未就绪）→ 重试
      }
      if (typeof snap.frames === 'number') break
      if (i === 5 || i === 9) {
        // 半程仍未就绪 → 再导航一次（首次 refresh 编译时序不稳）
        try {
          await driver.reLaunch('/pages/svg-skeleton-demo')
        } catch {
          /* 忽略瞬态 */
        }
      }
    }
    expect(typeof snap.frames, '应有 frames 字段（页面已就绪）').toBe('number')

    const logs = await driver.consoleLogs()
    const errLines = logs.filter((l) => /error|not defined|ReferenceError|MiniProgramError|Fatal|TypeError/i.test(l.text))
    expect(errLines).toEqual([])

    // 跨多个动画周期（1.2s 周期）采样：帧数与回传持续增长
    await driver.waitFor(3000)
    const a = await readData()
    await driver.waitFor(4000)
    const b = await readData()
    console.log('[SVG-SKELETON] a=', JSON.stringify({ f: a.frames, em: a.emits, fa: a.fails }), ' b=', JSON.stringify({ f: b.frames, em: b.emits, fa: b.fails }))

    expect(b.frames || 0, 'frames 应持续增长（嵌套动画在跑）').toBeGreaterThan(a.frames || 0)
    expect(b.emits || 0, 'emits 应持续增长').toBeGreaterThan(a.emits || 0)
    expect(b.fails || 0, '回传失败应为 0').toBe(0)
    expect(String(b.srcTail || ''), 'src 应为临时文件路径（非 data:）').not.toMatch(/^data:/)

    const shot = await driver.screenshot('/tmp/proteus-svg-skeleton.png')
    console.log('[SHOT]', shot)
    expect(shot, '截图应成功').toBeTruthy()

    // ★交互：动作切换（走→跑→跳）——三个独立场景 + :playing 门控 + **相位连续**（seed 承接进度）
    // ★原子断言：一次 evaluate 内先读 progress，再 setMode，再读 seed——
    //   小程序 setData 同步更新 this.data → 可精确比较，避免跨调用延迟导致 progress 漂移。
    // wechatide 后端 evaluate 不收带参（--args 无效）→ 用内联字面量的无参箭头函数
    const switchAndRead = async (m: string) => {
      const raw = await evalRetry(
        new Function(`return () => {
          const pages = getCurrentPages(); const pg = pages[pages.length - 1]
          const pre = pg.data.progress
          pg.setMode('${m}')
          return JSON.stringify({ pre, mode: pg.data.mode, seed: pg.data.seed, playing: pg.data.playing })
        }`)(),
      )
      return JSON.parse(String(raw)) as { pre: number; mode: string; seed: number; playing: boolean }
    }

    for (const m of ['run', 'jump', 'walk']) {
      const r = await switchAndRead(m)
      expect(r.mode, `应切到 ${m}`).toBe(m)
      // ★相位连续（原子）：seed === 切换瞬间 progress（新动作不回到起点）
      expect(r.seed, `切到 ${m} 时 seed 应精确等于切换前进度（相位承接）`).toBe(r.pre)
      expect(r.playing, '切换后应为播放态').toBe(true)
    }

    // ★相位连续回归锁：切到 run 后该场景应继续推进（不再冻结）
    await evalRetry(new Function(`return () => { const p = getCurrentPages(); p[p.length - 1].setMode('run'); }`)())
    await driver.waitFor(600)
    const r0 = (await readData()) as Snap & { seed?: number; progress?: number }
    await driver.waitFor(2500)
    const r1 = await readData()
    console.log('[SVG-SKELETON] run progress:', r0.progress, '→', r1.progress, ' frames', r0.frames, '→', r1.frames)
    expect(r1.frames || 0, '切到 run 后场景应继续推进（帧数增长）').toBeGreaterThan(r0.frames || 0)

    // ★交互：速率控制（定格 speed=0）——相位停表
    await evalRetry(() => {
      const pages = getCurrentPages()
      pages[pages.length - 1].setData({ speed: 0 })
    })
    await driver.waitFor(800)
    const frozen = (await readData()) as Snap & { speed?: number }
    expect(frozen.speed, 'speed 应被设为 0（定格）').toBe(0)

    // ★交互：倒放（speed=-1）——相位递减仍持续回传（单调时钟分离的回归锁）
    await evalRetry(() => {
      const pages = getCurrentPages()
      pages[pages.length - 1].setData({ speed: -1 })
    })
    await driver.waitFor(2500)
    const rev1 = await readData()
    await driver.waitFor(2500)
    const rev2 = await readData()
    expect(rev2.emits || 0, '倒放时回传仍应增长（负相位不冻结节流）').toBeGreaterThan(rev1.emits || 0)
    expect(rev2.fails || 0, '倒放回传失败应为 0').toBe(0)

    await driver.close()
  }, 180_000)
})
