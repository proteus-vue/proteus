// tests/capability-app-device.test.ts
// ★★App 端「设备与系统」域桥的语义契约（决策 #1067）。
//
// 【要证明什么】
//   ① 12 项都真的走宿主方法名（不是 web 桥降级）——且同步腿优先走**二进制帧**（#1066）；
//   ② 返回形状归一：剪贴板 `{text}` → 字符串；电池/屏幕/设备/网络/方向字段直达（Hook 侧零适配）；
//   ③ **诚实降级分档**：宿主 `missing` ⇒ `*.unsupported`；宿主真失败 ⇒ `*.failed`——两者不能混；
//   ④ 键盘通道：壳推 `__proteusHostKeyboard` ⇒ 订阅者收到并归一（`{height}` / 裸数字都接受）；
//   ⑤ 媒体查询：基于宿主屏幕读数求值，条件不满足立刻回 `matches:false`。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CapError, capOk } from '../packages/api/src/capability-types'
import { APP_DEVICE_METHODS, APP_KEYBOARD_KEY, createAppDeviceCapabilities } from '../packages/api/src/capability-app-device'
import { decodeInvokeFrame, encodeResolveFrame } from '../packages/api/src/invoke-wire'
import { utf8Decode, utf8Encode } from '@proteus-vue/shared'
import { HOST_INVOKE_BYTES_KEY, HOST_INVOKE_KEY, lastInvokeWire } from '../packages/api/src/capability-invoke'

const g = globalThis as Record<string, unknown>

/** 宿主桩：按方法名返回 `{ok:true,data}`（JSON 腿）；同时记录调用序 */
function installJsonHost(handler: (method: string, args: Record<string, unknown>) => unknown): string[] {
  const calls: string[] = []
  g[HOST_INVOKE_KEY] = (method: string, argsJson: string): string => {
    calls.push(method)
    const args = JSON.parse(argsJson || 'null') as Record<string, unknown>
    try {
      return JSON.stringify({ ok: true, data: handler(method, args) })
    } catch (e) {
      const err = e as Error & { code?: string; missing?: boolean }
      return JSON.stringify({ ok: false, missing: !!err.missing, reason: err.message })
    }
  }
  return calls
}

/**
 * 宿主桩：二进制腿（#1066 的主通路）——帧 body = JSON 字节，回程 body = 既有 `invoke()` 的 JSON 串。
 * ★与三端宿主 `invokeGenericBytes` 同形（Android/iOS/鸿蒙都是这么答的）。
 */
function installBytesHost(handler: (method: string, args: Record<string, unknown>) => unknown): string[] {
  const calls: string[] = []
  g[HOST_INVOKE_BYTES_KEY] = (frame: Uint8Array): Uint8Array => {
    const f = decodeInvokeFrame(frame)
    calls.push(f.method)
    const body = f.body ?? new Uint8Array(0)
    const args = body.length === 0 ? {} : (JSON.parse(utf8Decode(body)) as Record<string, unknown>)
    let out: string
    try {
      out = JSON.stringify({ ok: true, data: handler(f.method, args) })
    } catch (e) {
      const err = e as Error & { missing?: boolean }
      out = JSON.stringify({ ok: false, missing: !!err.missing, reason: err.message })
    }
    return encodeResolveFrame({ reqId: f.reqId, ok: true, body: utf8Encode(out) })
  }
  return calls
}

const caps = () => createAppDeviceCapabilities(CapError)

beforeEach(() => {
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_INVOKE_KEY]
  delete g[APP_KEYBOARD_KEY]
})

afterEach(() => {
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_INVOKE_KEY]
})

describe('① 12 项都走宿主（方法名契约）', () => {
  it('读类 6 项 + 动作类 4 项 + 剪贴板 2 项 = 12 个方法名全部命中', async () => {
    const calls = installBytesHost((method) => {
      if (method === APP_DEVICE_METHODS.screen) return { width: 390, height: 844, dpr: 3, orientation: 'portrait' }
      if (method === APP_DEVICE_METHODS.info) return { platform: 'ios', model: 'iPhone', os: 'iOS', version: '18.0' }
      if (method === APP_DEVICE_METHODS.battery) return { level: 0.8, charging: true }
      if (method === APP_DEVICE_METHODS.network) return { online: true, type: 'wifi' }
      if (method === APP_DEVICE_METHODS.orientation) return { type: 'portrait', angle: 0 }
      if (method === APP_DEVICE_METHODS.brightnessGet) return { value: 0.62 }
      if (method === APP_DEVICE_METHODS.hevc) return { supported: true }
      if (method === APP_DEVICE_METHODS.clipboardRead) return { text: 'copied' }
      return {}
    })
    const c = caps()
    expect(await c.getScreen()).toEqual({ width: 390, height: 844, dpr: 3, orientation: 'portrait' })
    expect(await c.getDevice()).toMatchObject({ platform: 'ios' })
    expect(await c.getBattery()).toEqual({ level: 0.8, charging: true })
    expect(await c.getNetwork()).toEqual({ online: true, type: 'wifi' })
    expect(await c.getOrientation()).toEqual({ type: 'portrait', angle: 0 })
    expect(await c.getBrightness()).toBe(0.62)
    const hevcRes = await c.getDeviceCapability().supportsHevc()
    expect(hevcRes.ok && hevcRes.data).toBe(true)
    expect(await c.readClipboard()).toBe('copied')
    await c.vibrate(20)
    await c.setClipboard('hello')
    await c.setBrightness(0.3)
    await c.setKeepScreenOn(true)
    expect(calls).toEqual([
      'device.screen', 'device.info', 'device.battery', 'device.network', 'device.orientation',
      'device.brightness.get', 'device.hevc', 'clipboard.read',
      'device.vibrate', 'clipboard.write', 'device.brightness.set', 'device.keepScreenOn',
    ])
    expect(lastInvokeWire()).toBe('bytes') // ★#1066：同步能力也走字节帧
  })

  it('剪贴板读兼容裸字符串（宿主回 `{ok:true,data:"x"}` 的形态）', async () => {
    installBytesHost(() => 'raw-text')
    expect(await caps().readClipboard()).toBe('raw-text')
  })
})

describe('② 降级分档（unsupported vs failed 必须分得开）', () => {
  it('宿主 missing ⇒ `*.unsupported`', async () => {
    installJsonHost(() => {
      const e = new Error('未实现') as Error & { missing: boolean }
      e.missing = true
      throw e
    })
    await expect(caps().getDevice()).rejects.toMatchObject({ code: 'device.unsupported' })
  })

  it('宿主真失败 ⇒ `*.failed`（不是 unsupported）', async () => {
    installJsonHost(() => {
      throw new Error('系统 API 抛错')
    })
    const r = await caps().getBattery().catch((e: CapError) => e)
    expect((r as CapError).code).toBe('battery.failed')
  })

  it('宿主完全未注册 ⇒ 全部 unsupported（不伪造成功）', async () => {
    await expect(caps().getScreen()).rejects.toMatchObject({ code: 'screen.unsupported' })
    await expect(caps().vibrate(10)).rejects.toMatchObject({ code: 'vibrate.unsupported' })
  })
})

describe('③ 键盘通道（壳推 → 订阅者）', () => {
  it('壳推 `{height}` ⇒ 归一为 visible；订阅者立即收到当前值', async () => {
    installBytesHost(() => ({}))
    const kb = caps().getKeyboard()
    const seen: Array<{ height: number; visible: boolean }> = []
    kb.onChange((info) => seen.push(info))
    ;(g[APP_KEYBOARD_KEY] as (p: unknown) => string)({ height: 312 })
    expect(seen[0]).toEqual({ height: 0, visible: false }) // 订阅瞬间的当前值
    expect(seen[seen.length - 1]).toEqual({ height: 312, visible: true })
    // 裸数字也接受（三端壳字段习惯不同）
    ;(g[APP_KEYBOARD_KEY] as (p: unknown) => string)(0)
    expect(seen[seen.length - 1]).toEqual({ height: 0, visible: false })
  })

  it('取消订阅后不再收到推送', () => {
    installBytesHost(() => ({}))
    const kb = caps().getKeyboard()
    const seen: number[] = []
    const off = kb.onChange((i) => seen.push(i.height))
    const before = seen.length
    off()
    ;(g[APP_KEYBOARD_KEY] as (p: unknown) => string)({ height: 100 })
    expect(seen.length).toBe(before)
  })
})

describe('④ 媒体查询（纯 JS 求值）', () => {
  it('条件匹配 ⇒ matches:true；不匹配 ⇒ 立即回调 false', () => {
    installBytesHost(() => ({ width: 400, height: 800, dpr: 2, orientation: 'portrait' }))
    const mq = caps().createMediaQuery()
    const got: boolean[] = []
    mq.observe({ minWidth: 300, maxWidth: 500, orientation: 'portrait' }, (r) => got.push(r.matches))
    expect(got).toEqual([true])
    const got2: boolean[] = []
    mq.observe({ minWidth: 500 }, (r) => got2.push(r.matches))
    expect(got2).toEqual([false])
    mq.disconnect()
  })
})

describe('⑤ 返回形状直通（不做多余包装）', () => {
  it('`ok:true` 的 data 原样返回（不被包成 {data:…}）', async () => {
    installBytesHost(() => ({ value: 0.42 }))
    const v = await caps().getBrightness()
    expect(v).toBe(0.42)
    expect(capOk(v)).toEqual({ ok: true, data: 0.42 }) // 自证：Hook 层的 CapResult 包装由 capability.ts 做
  })
})
