// tests/capability-app-sensor.test.ts
// ★★App 端 C5 传感器桥的语义契约（决策 #1080）。
//
// 【要证明什么】
//   ① 三个桥方法（readSensor / startSensor / stopSensor）都真的走宿主方法名；
//   ② **订阅通道**：壳推 `__proteusHostSensor` → 只分发给**同 kind** 的订阅者（不串台）；
//   ③ 载荷归一：缺字段容忍（只保留存在的分量）、非法 kind 被拒（回 `bad-payload`，不静默吞）；
//   ④ **诚实降级**：宿主 missing ⇒ `sensor.unsupported`；宿主真失败 ⇒ `sensor.failed`；
//   ⑤ 三端读数**原样透传**（不做单位换算——Android m/s² / iOS g / 鸿蒙各 SensorId 口径不同）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CapError } from '../packages/api/src/capability-types'
import { APP_DEVICE_METHODS, APP_SENSOR_KEY, createAppDeviceCapabilities } from '../packages/api/src/capability-app-device'
import { decodeInvokeFrame, encodeResolveFrame } from '../packages/api/src/invoke-wire'
import { utf8Decode, utf8Encode } from '@proteus-vue/shared'
import { HOST_INVOKE_BYTES_KEY, HOST_INVOKE_KEY } from '../packages/api/src/capability-invoke'

const g = globalThis as Record<string, unknown>

/** 宿主桩：二进制腿（帧 body = JSON 字节；回程 body = 既有 invoke() JSON 串） */
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
  delete g[APP_SENSOR_KEY]
})

afterEach(() => {
  delete g[HOST_INVOKE_BYTES_KEY]
  delete g[HOST_INVOKE_KEY]
})

describe('① 三个方法都走宿主 + 方法名契约', () => {
  it('readSensor / startSensor / stopSensor 分别命中 device.sensor.{read,start,stop}', async () => {
    const calls = installBytesHost((method) => {
      if (method === APP_DEVICE_METHODS.sensorRead) return { kind: 'accelerometer', x: 0.1, y: 0.2, z: 9.8 }
      return {}
    })
    const c = caps()
    expect(await c.readSensor('accelerometer')).toEqual({ kind: 'accelerometer', x: 0.1, y: 0.2, z: 9.8 })
    await c.startSensor('accelerometer')
    await c.stopSensor('accelerometer')
    expect(calls).toEqual(['device.sensor.read', 'device.sensor.start', 'device.sensor.stop'])
  })

  it('★读数**原样透传**（不做单位换算——三端口径不同是如实差异，不是缺陷）', async () => {
    // iOS 用 g 为单位、Android 用 m/s²：同一个 1.0 在不同端含义不同，桥不猜
    installBytesHost(() => ({ kind: 'accelerometer', x: 1, y: 0, z: 0 }))
    const r = await caps().readSensor('accelerometer')
    expect(r.x).toBe(1) // 原样，不乘 9.8
  })
})

describe('② 订阅通道（壳推 → 同 kind 订阅者）', () => {
  it('只分发给**同 kind** 的订阅者（加速度计事件不串到陀螺仪）', () => {
    installBytesHost(() => ({}))
    const c = caps()
    const accSeen: number[] = []
    const gyrSeen: number[] = []
    c.subscribeSensor('accelerometer', (s) => accSeen.push(s.x ?? -1))
    c.subscribeSensor('gyroscope', (s) => gyrSeen.push(s.x ?? -1))
    const push = g[APP_SENSOR_KEY] as (p: unknown) => string
    push({ kind: 'accelerometer', x: 5 })
    push({ kind: 'accelerometer', x: 7 })
    push({ kind: 'gyroscope', x: 9 })
    expect(accSeen).toEqual([5, 7])
    expect(gyrSeen).toEqual([9])
  })

  it('取消订阅后不再收到', () => {
    installBytesHost(() => ({}))
    const c = caps()
    const seen: number[] = []
    const off = c.subscribeSensor('compass', (s) => seen.push(s.heading ?? -1))
    const push = g[APP_SENSOR_KEY] as (p: unknown) => string
    push({ kind: 'compass', heading: 90 })
    off()
    push({ kind: 'compass', heading: 180 })
    expect(seen).toEqual([90])
  })
})

describe('③ 载荷归一（不静默吞非法）', () => {
  it('非法 kind ⇒ 回 bad-payload（不派发、不静默）', () => {
    installBytesHost(() => ({}))
    const c = caps()
    let called = 0
    c.subscribeSensor('accelerometer', () => { called++ })
    const push = g[APP_SENSOR_KEY] as (p: unknown) => string
    expect(push({ kind: 'bogus', x: 1 })).toBe('bad-payload')
    expect(called).toBe(0)
  })

  it('非对象载荷 ⇒ bad-payload', () => {
    installBytesHost(() => ({}))
    caps()
    const push = g[APP_SENSOR_KEY] as (p: unknown) => string
    expect(push(null)).toBe('bad-payload')
    expect(push('x')).toBe('bad-payload')
  })

  it('缺字段容忍：只保留存在的分量（NaN/非数字被丢弃）', () => {
    installBytesHost(() => ({}))
    const c = caps()
    let got: Record<string, unknown> | null = null
    c.subscribeSensor('compass', (s) => { got = s as unknown as Record<string, unknown> })
    const push = g[APP_SENSOR_KEY] as (p: unknown) => string
    push({ kind: 'compass', heading: 'abc', timestamp: 123 })
    expect(got).not.toBeNull()
    expect((got as unknown as { heading?: number }).heading).toBeUndefined() // 非数字 ⇒ 丢弃
    expect((got as unknown as { timestamp?: number }).timestamp).toBe(123)
  })
})

describe('④ 诚实降级分档', () => {
  it('宿主 missing ⇒ sensor.unsupported', async () => {
    installBytesHost(() => {
      const e = new Error('本机无 compass 传感器') as Error & { missing: boolean }
      e.missing = true
      throw e
    })
    await expect(caps().readSensor('compass')).rejects.toMatchObject({ code: 'sensor.unsupported' })
  })

  it('宿主真失败 ⇒ sensor.failed', async () => {
    installBytesHost(() => {
      throw new Error('2s 内无采样')
    })
    const e = await caps().readSensor('accelerometer').catch((x: CapError) => x)
    expect((e as CapError).code).toBe('sensor.failed')
  })
})
