// tests/component-capability.test.ts
// ★组件库落地评估 v2（B1）：平台能力探测（backend 判定 / has 能力表 / 降级 warn）
// 组件代码不得直接判 wx，必须查询 capability；惰性单例 + resetCapability 供测试切换 backend
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  getCapability,
  resetCapability,
  capabilityWarn,
} from '../src/components/runtime/capability'

afterEach(() => {
  vi.unstubAllGlobals() // ★vitest 全局残留：wx stub 必须清（不止 restoreAllMocks）
  resetCapability()
})

describe('backend 判定（web 分支）', () => {
  it('无 wx → web：passive-event 可用，native-toast 不可用', () => {
    const cap = getCapability()
    expect(cap.backend).toBe('web')
    expect(cap.has('passive-event')).toBe(true)
    expect(cap.has('native-toast')).toBe(false)
  })
})

describe('backend 判定（skyline 分支）', () => {
  it('wx 存在 → skyline：native-toast 可用，passive-event 不可用', () => {
    vi.stubGlobal('wx', { showToast: vi.fn() })
    const cap = getCapability()
    expect(cap.backend).toBe('skyline')
    expect(cap.has('native-toast')).toBe(true)
    expect(cap.has('passive-event')).toBe(false)
  })

  it('wx 存在但无 showToast → native-toast 降级 false', () => {
    vi.stubGlobal('wx', {})
    const cap = getCapability()
    expect(cap.has('native-toast')).toBe(false)
  })
})

describe('能力表（未实现能力恒 false，防静默失效）', () => {
  it('worklet-animation / recycle-manager 当前恒 false（Worklet 未实现，router B10 ⬜）', () => {
    vi.stubGlobal('wx', {})
    const cap = getCapability()
    expect(cap.has('worklet-animation')).toBe(false)
    expect(cap.has('recycle-manager')).toBe(false)
  })

  it('未知能力名 → false（防御式默认）', () => {
    const cap = getCapability()
    expect(cap.has('not-a-real-capability' as never)).toBe(false)
  })
})

describe('惰性单例', () => {
  it('同 backend 下 getCapability 返回同一实例；resetCapability 后重新求值', () => {
    const a = getCapability()
    expect(getCapability()).toBe(a)
    resetCapability()
    expect(getCapability()).not.toBe(a)
  })
})

describe('异步探测 detect（失败兜底同步判定）', () => {
  it('动态能力 resolve 同步判定值；静态能力直接返回 has()', async () => {
    const cap = getCapability() // web 分支
    await expect(cap.detect('webp')).resolves.toBe(true)
    await expect(cap.detect('native-toast')).resolves.toBe(false)
    await expect(cap.detect('worklet-animation')).resolves.toBe(false)
  })
})

describe('降级告警 capabilityWarn（铁律 C6）', () => {
  it('输出 [Proteus][tag] 前缀 + 降级说明，console.warn 被调用', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    capabilityWarn('p-popup', 'worklet-animation', 'CSS transition')
    expect(spy).toHaveBeenCalledWith('[Proteus][p-popup] worklet-animation 不可用，已降级：CSS transition')
    spy.mockRestore()
  })
})
