// tests/capability-app-capture.test.ts
// ★★★决策 #1083（2026-10-19）：App 端录屏/截屏状态（C71 `useScreenCapture`）的四条判据。
//
// 【为什么这项要专门测（它的风险不在"调不通"，在"说谎"）】
//   三端能力面**不同**：Android 无公开录屏查询、iOS 无全局 PiP 查询、鸿蒙无用户截屏事件。
//   ⇒ 这类能力的头号缺陷形态是**伪造 false**——业务看到 `{ok:true, data:false}` 会以为
//     "确认没在录屏"，实际是"这个端根本查不了"。**伪造 false 比 unsupported 危险得多**。
//   ⇒ 本文件的判据：
//     ① **缺字段 ⇒ unsupported**（不是 false）——三端各自缺不同的字段，逐个验；
//     ② 有字段 ⇒ 如实透传（on/off / true/false）；
//     ③ 推通道：按 payload 分派到对应订阅者、非法载荷不派发、取消订阅生效；
//     ④ 宿主未接线 / 调用失败 ⇒ unsupported / failed 分档（不冒充成功）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  APP_CAPTURE_KEY,
  APP_CAPTURE_METHODS,
  createAppCaptureCapabilities,
  dispatchCapturePush,
  installCaptureChannel,
  normalizeCapturePush,
  resetCaptureSubscriptions,
  CAPTURE_MAX_SUBSCRIPTIONS, CAPTURE_MAX_DISPATCH_PER_PUSH,
  captureStatsSnapshot, __resetCaptureStats,
} from '../packages/api/src/capability-app-capture'

/** 装一个假宿主（记录调用 + 回指定 data） */
function makeHost(data: Record<string, unknown>) {
  const calls: Array<{ method: string; args: string }> = []
  ;(globalThis as Record<string, unknown>).proteusHost = {
    invoke: (method: string, args: string) => {
      calls.push({ method, args })
      return JSON.stringify({ ok: true, data })
    },
  }
  return calls
}

describe('★#1083 ① 缺字段 ⇒ unsupported（绝不伪造 false）', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__proteusHostInvoke
    delete (globalThis as Record<string, unknown>).__proteusHostInvokeBytes
    delete (globalThis as Record<string, unknown>).proteusHost
    resetCaptureSubscriptions()
  })
  afterEach(() => {
    resetCaptureSubscriptions()
    delete (globalThis as Record<string, unknown>).proteusHost
  })

  it('Android 形态（有 pip、无 recording）⇒ 录屏 unsupported、PiP 可用', async () => {
    makeHost({ pip: false, recordingSupported: false, pipSupported: true, userCaptureSupported: true })
    const api = createAppCaptureCapabilities().getScreenCapture()

    const rec = await api.getRecordingState()
    expect(rec.ok, '缺 recording 字段 ⇒ 必须 unsupported（不能是 ok:false）').toBe(false)
    if (!rec.ok) {
      expect(rec.error.code).toBe('screen-capture.unsupported')
      expect(rec.error.message).toContain('无公开的"正在录屏"')
    }

    const pip = await api.isPictureInPictureActive()
    expect(pip.ok && pip.data).toBe(false) // 有真值 ⇒ 如实透传 false
  })

  it('iOS 形态（有 recording、无 pip）⇒ 录屏可用、PiP unsupported', async () => {
    makeHost({ recording: false, recordingSupported: true, pipSupported: false, userCaptureSupported: true })
    const api = createAppCaptureCapabilities().getScreenCapture()

    const rec = await api.getRecordingState()
    expect(rec.ok && rec.data).toBe('off')

    const pip = await api.isPictureInPictureActive()
    expect(pip.ok, '缺 pip 字段 ⇒ 必须 unsupported').toBe(false)
    if (!pip.ok) {
      expect(pip.error.code).toBe('screen-capture.unsupported')
      expect(pip.error.message).toContain('画中画')
    }
  })

  it('鸿蒙形态（两者都有）⇒ 都可用；录屏 on 时回 "on"', async () => {
    makeHost({ recording: true, pip: true })
    const api = createAppCaptureCapabilities().getScreenCapture()
    const rec = await api.getRecordingState()
    expect(rec.ok && rec.data).toBe('on')
    const pip = await api.isPictureInPictureActive()
    expect(pip.ok && pip.data).toBe(true)
  })

  it('宿主未接线 ⇒ unsupported；宿主抛错 ⇒ failed（两档分得开）', async () => {
    // ① 完全没有能力通道
    const noChannel = await createAppCaptureCapabilities().getScreenCapture().getRecordingState()
    expect(!noChannel.ok && noChannel.error.code).toBe('screen-capture.unsupported')

    // ② 通道在但宿主说"未实现"
    ;(globalThis as Record<string, unknown>).proteusHost = {
      invoke: () => JSON.stringify({ ok: false, missing: true, reason: '未实现的原生方法：device.capture' }),
    }
    const missing = await createAppCaptureCapabilities().getScreenCapture().getRecordingState()
    expect(!missing.ok && missing.error.code).toBe('screen-capture.unsupported')

    // ③ 有 API 但真失败
    ;(globalThis as Record<string, unknown>).proteusHost = {
      invoke: () => { throw new Error('boom') },
    }
    const failed = await createAppCaptureCapabilities().getScreenCapture().isPictureInPictureActive()
    expect(!failed.ok && failed.error.code).toBe('screen-capture.failed')
  })
})

describe('★#1083 ② 推通道（壳 → 订阅者）', () => {
  beforeEach(() => resetCaptureSubscriptions())
  afterEach(() => resetCaptureSubscriptions())

  it('recording 推给录屏订阅者、userCapture 推给截屏订阅者（互不串）', () => {
    const api = createAppCaptureCapabilities().getScreenCapture()
    const recs: Array<'on' | 'off'> = []
    let captures = 0
    const offRec = api.onRecordingStateChange((s) => recs.push(s))
    const offCap = api.onUserCapture(() => { captures++ })

    dispatchCapturePush({ recording: true })
    expect(recs).toEqual(['on'])
    expect(captures, 'recording 不该触发截屏订阅').toBe(0)

    dispatchCapturePush({ userCapture: true })
    expect(captures).toBe(1)
    expect(recs).toEqual(['on']) // 没被多推一次

    dispatchCapturePush({ recording: false })
    expect(recs).toEqual(['on', 'off'])

    offRec()
    offCap()
    dispatchCapturePush({ recording: true, userCapture: true })
    expect(recs, '取消订阅后不再收到').toEqual(['on', 'off'])
    expect(captures).toBe(1)
  })

  it('非法载荷 ⇒ 不派发（不静默派错值）', () => {
    const api = createAppCaptureCapabilities().getScreenCapture()
    let fired = 0
    api.onRecordingStateChange(() => { fired++ })
    api.onUserCapture(() => { fired++ })

    expect(normalizeCapturePush(null)).toBeNull()
    expect(normalizeCapturePush('x')).toBeNull()
    expect(normalizeCapturePush({})).toBeNull()
    expect(normalizeCapturePush({ recording: 'yes' })).toBeNull() // 非布尔不认
    expect(normalizeCapturePush({ userCapture: false })).toBeNull() // 只认"发生"
    expect(dispatchCapturePush({ recording: 'yes' })).toBe(0)
    expect(dispatchCapturePush(null)).toBe(0)
    expect(fired).toBe(0)
  })

  it('`userCapture: 1` 也认（不同平台习惯）；`recording` 只认布尔', () => {
    expect(normalizeCapturePush({ userCapture: 1 })).toEqual({ userCapture: true })
    expect(normalizeCapturePush({ recording: true })).toEqual({ recording: true })
    expect(normalizeCapturePush({ recording: 1 })).toBeNull()
  })

  it('单订阅者抛错不影响其余订阅者', () => {
    const api = createAppCaptureCapabilities().getScreenCapture()
    let okCount = 0
    api.onRecordingStateChange(() => { throw new Error('subscriber boom') })
    api.onRecordingStateChange(() => { okCount++ })
    dispatchCapturePush({ recording: true })
    expect(okCount, '抛错的那个不影响后面的订阅者').toBe(1)
  })
})

describe('★#1083 ③ 通道装配（幂等 + 可观测）', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[APP_CAPTURE_KEY]
    resetCaptureSubscriptions()
  })

  it('模块装配后 globalThis.__proteusHostCapture 存在且可调（壳推的落点）', () => {
    createAppCaptureCapabilities()
    const fn = (globalThis as Record<string, unknown>)[APP_CAPTURE_KEY]
    expect(typeof fn, '壳推的全局接收器必须存在').toBe('function')
  })

  it('重复装配不覆盖既有接收器（幂等——避免热重载时丢订阅）', () => {
    const sentinel = () => 42
    ;(globalThis as Record<string, unknown>)[APP_CAPTURE_KEY] = sentinel
    installCaptureChannel()
    expect((globalThis as Record<string, unknown>)[APP_CAPTURE_KEY]).toBe(sentinel)
  })

  it('宿主方法名契约与实现一致（device.capture）', () => {
    expect(APP_CAPTURE_METHODS.capture).toBe('device.capture')
  })

// ══════════════ ★★★#1247 §1.0 四项必答（screen-capture 此前是 S1）══════════════

describe('⑥ 规模承载：screen-capture 的四项必答', () => {
  beforeEach(() => { resetCaptureSubscriptions(); __resetCaptureStats() })

  it('① 订阅上界：超过 CAPTURE_MAX_SUBSCRIPTIONS ⇒ 显式抛 screen-capture.tooManySubscriptions', async () => {
    const api = (await import('../packages/api/src/capability-app-capture')).createAppCaptureCapabilities()
      .getScreenCapture()
    const offs: Array<() => void> = []
    for (let i = 0; i < CAPTURE_MAX_SUBSCRIPTIONS; i++) offs.push(api.onRecordingStateChange(() => undefined))
    let code = ''
    try {
      api.onRecordingStateChange(() => undefined)
    } catch (e) {
      code = (e as { code?: string }).code ?? ''
    }
    expect(code, '★超限必须显式拒绝').toBe('screen-capture.tooManySubscriptions')
    expect(captureStatsSnapshot().rejectedSubscriptions).toBe(1)
    expect(captureStatsSnapshot().peakSubscriptions, '峰值被记录').toBe(CAPTURE_MAX_SUBSCRIPTIONS)
    for (const off of offs) off()
  })

  it('② 背压·无订阅者：事件来了没人听 ⇒ 计入 pushesUnheard（必须可查）', () => {
    const fired = dispatchCapturePush({ recording: true })
    expect(fired, '无订阅者 ⇒ 命中 0').toBe(0)
    expect(captureStatsSnapshot().pushesUnheard, '★"用户录屏了但没人知道"被计数').toBe(1)
    expect(captureStatsSnapshot().pushesDispatched, '收到计数 +1').toBe(1)
  })

  it('③ 背压·单次派发上界：订阅者超过 CAPTURE_MAX_DISPATCH_PER_PUSH ⇒ 截断并计数', async () => {
    const api = (await import('../packages/api/src/capability-app-capture')).createAppCaptureCapabilities()
      .getScreenCapture()
    let calls = 0
    for (let i = 0; i < CAPTURE_MAX_DISPATCH_PER_PUSH + 5; i++) {
      api.onUserCapture(() => { calls++ })
    }
    dispatchCapturePush({ userCapture: true })
    expect(calls, '★单次最多派发 CAPTURE_MAX_DISPATCH_PER_PUSH 个').toBe(CAPTURE_MAX_DISPATCH_PER_PUSH)
    expect(captureStatsSnapshot().dispatchTruncated, '截断被计数').toBe(1)
  })

  it('④ 非法载荷计入 pushesDropped（"来了多少"与"派发多少"能对上）', () => {
    __resetCaptureStats()
    const n = dispatchCapturePush({ notAField: 1 })
    expect(n, '非法载荷 ⇒ 0').toBe(0)
    expect(captureStatsSnapshot().pushesDropped, '★丢弃被计数').toBe(1)
    expect(captureStatsSnapshot().pushesDispatched, '合法派发计数不增加').toBe(0)
  })

  it('⑤ 回收：取消订阅后计数回落（上界不被假订阅吃掉）', async () => {
    const api = (await import('../packages/api/src/capability-app-capture')).createAppCaptureCapabilities()
      .getScreenCapture()
    const off1 = api.onUserCapture(() => undefined)
    const off2 = api.onUserCapture(() => undefined)
    expect(captureStatsSnapshot().userCaptureSubscriptions).toBe(2)
    off1()
    expect(captureStatsSnapshot().userCaptureSubscriptions, '★取消即释放').toBe(1)
    off2()
    expect(captureStatsSnapshot().userCaptureSubscriptions).toBe(0)
  })
})
})
