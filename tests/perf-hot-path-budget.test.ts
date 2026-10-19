// tests/perf-hot-path-budget.test.ts
// ★★★决策 #1099（2026-10-19）：**P0 基线的第一个真结论——诊断代码跑在生产热路径上**
//
// 【这一轮量到了什么（Android 真机，superapp 桌面入口 drive，26 次 JS 同步段）】
//   开采样前基线：单次切屏 `__proteusSuperappRender` = 101–114ms，其中 `mount()` 占 101ms。
//   把 mount 内部按相位拆开后：
//      像素自检 `sample()` = 63.4ms  ← **62%**（整屏画进 bitmap + 每 12px 网格取色）
//      内核建树 layout      = 1.5ms
//      emitAll（出绘制指令）= 8.2ms
//      JS 实例化（总 − 宿主）= 3ms
//   ⇒ **最大的"长任务"不是 JS、也不是布局，是诊断口径的像素采样**。
//     而 `painted_samples`/`painted_colors` 只被**探针判据**读（`check-app-screen-content` /
//     `js-render` 场景），真实应用路径没有任何消费者。
//
// 【判据（守两件事，缺一不可）】
//   ① **默认仍必须开**——存量探针（js-render / app-screen-content）的 `painted_samples > 0`
//     是它们的放行判据；把默认改 false 会让那批判据静默变假（这是"偷性能换假绿"）。
//   ② **应用壳必须显式关**——`SuperappActivity`（框架参考壳）与 CLI 模板 `AppActivity`（真·生成的 App）
//      都在切屏热路径上，必须调用 `setPaintSampling(false)`。
//      ★漏一处 = 那个壳每次切屏白烧 60ms（本判据就是防这条回潮）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const VAPOR_HOST = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java'
const SUPERAPP_ACTIVITY = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/shell/SuperappActivity.java'
const CLI_APP_ACTIVITY = 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'

describe('★#1099 像素自检是可开关的诊断口径', () => {
  it('默认开（存量探针读 painted_samples，不得静默失效）', () => {
    const v = read(VAPOR_HOST)
    expect(v).toMatch(/private boolean paintSampling = true/)
    expect(v).toMatch(/public void setPaintSampling\(boolean on\)/)
  })

  it('采样仍走 sample(0)/sample(1) 且写回同一对字段（语义未变）', () => {
    const v = read(VAPOR_HOST)
    expect(v).toMatch(/if \(paintSampling\) \{.*lastPaintedSamples = sample\(0\); lastPaintedColors = sample\(1\);/)
  })

  it('★应用壳必须关掉（否则每次切屏白烧 ~60ms）', () => {
    for (const f of [SUPERAPP_ACTIVITY, CLI_APP_ACTIVITY]) {
      expect(read(f), `${f} 未关闭诊断像素采样`).toMatch(/draw\.setPaintSampling\(false\)/)
    }
  })
})

describe('★#1099 mount 相位耗时是可比读数（P1/P2 切片的依据）', () => {
  it('宿主侧 mount 拆分出 measure / layout / wrap / emit / scroll 五项', () => {
    const v = read(VAPOR_HOST)
    for (const field of ['lastMeasureMs', 'lastLayoutMs', 'lastWrapMs', 'lastEmitMs', 'lastScrollMs']) {
      expect(v.includes(field), `缺相位字段 ${field}`).toBe(true)
    }
  })

  it('运行时宿主桥记录 mount / applyOps 的宿主侧总耗时', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/SuperappRuntimeHost.java')
    expect(s).toMatch(/public long lastMountMs/)
    expect(s).toMatch(/public long lastApplyOpsMs/)
  })

  it('报告带出这些字段（判据可读；缺一项就无法归因）', () => {
    const a = read(SUPERAPP_ACTIVITY)
    for (const k of ['mount_host_ms', 'mount_measure_ms', 'mount_layout_ms', 'mount_wrap_ms', 'mount_emit_ms', 'mount_scroll_ms']) {
      expect(a.includes(k), `报告缺 ${k}`).toBe(true)
    }
  })
})
