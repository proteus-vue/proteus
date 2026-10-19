// tests/thread-p0-sampler.test.ts
// ★★★决策 #1098（2026-10-19）：**P0 长任务观测**（线程治理第一批）—— 判据。
//
// 【为什么先做 P0（调研文档 §6 的落地）】
//   调研结论：不自研线程引擎，先补执行原语（P1）。而"原语怎么切、切多细"取决于**真实的长任务分布**
//   —— 现在只能猜。P0 只采样、**不改变任何执行行为**（不排队/不让出/不取消）。
//
// 【★埋点位置的两端差异（不是设计不一致，是平台给的）】
//   · Android：JS 执行**唯一入口**是 `QuickJsEngine.eval`（nativeEval 只被它调）⇒ 埋一处覆盖全部。
//   · iOS：`JSContext.evaluateScript` 是**系统 API**，无法内部埋点 ⇒ 只能包一层
//     `JsTaskSampler.eval(ctx, source)`，并要求壳里所有调用点改走它。
//   ★这条差异本身是证据：**"统一入口"是平台给的，不是设计能保证的**——
//     iOS 侧若将来有人直接调 `evaluateScript`，采样就会漏（本判据用静态扫描守着）。
//
// 【判据】
//   ① 两端采样器存在、阈值/环形容量/JSON 字段名**逐项一致**（否则面板读数无法对比）；
//   ② 采样是**纯观测**：记录不改返回值、不抛错（逻辑上只累加计数）；
//   ③ 环形缓冲**有上限**（观测装置自己不能成为内存问题）；
//   ④ Android 埋点在 `QuickJsEngine.eval` / `evalWithHost`（唯一入口），且 dev 才启用；
//   ⑤ iOS 壳里**不得**残留裸 `ctx.evaluateScript(`（否则采样漏）；
//   ⑥ 两端读数都并入 perf 报告（字段名 `jsTasks`）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const ANDROID_SAMPLER = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/JsTaskSampler.java'
const IOS_SAMPLER = 'packages/cli/templates-host/ios/shell/JsTaskSampler.swift'
const ANDROID_ENGINE = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/QuickJsEngine.java'
const ANDROID_APP = 'packages/cli/templates-host/android/src/dev/proteus/layoutcore/AppActivity.java'
const IOS_APP = 'packages/cli/templates-host/ios/shell/ProteusApp.swift'

describe('★#1098 ① 两端采样器口径一致', () => {
  it('阈值 50ms 与环形容量 64 两端相同', () => {
    const a = read(ANDROID_SAMPLER)
    const i = read(IOS_SAMPLER)
    expect(a).toMatch(/LONG_TASK_MS = 50/)
    expect(a).toMatch(/RING = 64/)
    expect(i).toMatch(/longTaskMs: Int64 = 50/)
    expect(i).toMatch(/ringCapacity = 64/)
  })

  it('读数 JSON 字段名逐项一致（面板才能对比两端）', () => {
    const a = read(ANDROID_SAMPLER)
    const i = read(IOS_SAMPLER)
    for (const k of ['enabled', 'thresholdMs', 'total', 'long', 'maxMs', 'avgMs', 'recent', 'recentP95Ms', 'recentCount']) {
      expect(a.includes(`"${k}"`), `Android 缺字段 ${k}`).toBe(true)
      expect(i.includes(`"${k}"`), `iOS 缺字段 ${k}`).toBe(true)
    }
  })
})

describe('★#1098 ② 纯观测（不改行为）', () => {
  it('采样函数只累加计数、返回值不被改写', () => {
    const a = read(ANDROID_SAMPLER)
    // Android：record 是 void，只改计数与环形缓冲
    expect(a).toMatch(/public static void record\(String label, long startNs\)/)
    // 不得出现"丢弃/重排/延迟"这类行为改动
    for (const forbidden of ['queue.add', 'Thread.sleep', 'postDelayed', 'reject(']) {
      expect(a.includes(forbidden), `采样器不应含 ${forbidden}`).toBe(false)
    }
  })

  it('iOS 的 eval 包装原样返回底层结果（只加计时）', () => {
    const i = read(IOS_SAMPLER)
    expect(i).toMatch(/let v = ctx\.evaluateScript\(source\)/)
    expect(i).toMatch(/record\(label:/)
    expect(i).toMatch(/return v/)
  })

  it('环形缓冲有上限（观测装置自己不能成为内存问题）', () => {
    expect(read(ANDROID_SAMPLER)).toMatch(/while \(ring\.size\(\) > RING\) ring\.removeFirst\(\)/)
    expect(read(IOS_SAMPLER)).toMatch(/if ring\.count > ringCapacity \{ ring\.removeFirst/)
  })
})

describe('★#1098 ③ 埋点位置与启用条件', () => {
  it('Android 在唯一入口 eval / evalWithHost 埋点', () => {
    const e = read(ANDROID_ENGINE)
    // ★两处同步段都要计时（bundle 装载也是长任务候选）
    const hits = (e.match(/JsTaskSampler\.record\(JsTaskSampler\.labelOf\(source\), t0\)/g) || []).length
    expect(hits, 'eval 与 evalWithHost 都要埋点').toBe(2)
    expect(e).toMatch(/JsTaskSampler\.setEnabled\(ProteusBuildConfig\.DEV\)/)
  })

  it('Android 读数暴露为 perfStats / resetPerf', () => {
    const e = read(ANDROID_ENGINE)
    expect(e).toMatch(/public static String perfStats\(\)/)
    expect(e).toMatch(/public static void resetPerf\(\)/)
  })

  it('★iOS 壳里不得残留裸 ctx.evaluateScript（否则采样漏）', () => {
    const app = read(IOS_APP)
    const bare = (app.match(/ctx\.evaluateScript\(/g) || []).length
    expect(bare, '仍有裸 evaluateScript 调用——那些 JS 段不会被采样').toBe(0)
    expect((app.match(/JsTaskSampler\.eval\(ctx,/g) || []).length).toBeGreaterThan(5)
  })

  it('iOS 启用采样（dev 构建）', () => {
    expect(read(IOS_APP)).toMatch(/JsTaskSampler\.setEnabled\(ProteusBuildConfig\.DEV\)/)
  })
})

describe('★#1098 ④ 读数并入 perf 报告（两端字段名一致）', () => {
  it('Android AppActivity 把 jsTasks 并入心跳', () => {
    expect(read(ANDROID_APP)).toMatch(/o\.put\("jsTasks", js\)/)
  })
  it('iOS ProteusApp 把 jsTasks 并入 perfJson', () => {
    expect(read(IOS_APP)).toMatch(/o\["jsTasks"\] = js/)
  })
})
