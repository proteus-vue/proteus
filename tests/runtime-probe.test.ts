// tests/runtime-probe.test.ts
// ★框架元素探针注册表（runtime，2026-09-14）契约锁——
//   跨端 E2E 降级通道的地基：组件自测量 → 全局注册表 → 测试经 evaluate 读取（绕开工具元素查询限制）。
import { describe, it, expect, beforeEach } from 'vitest'
import { recordProbe, readProbes, clearProbes, probeEnabled, PROBE_GLOBAL_KEY } from '../packages/runtime/src/probe'

describe('★框架探针注册表（runtime/probe）', () => {
  beforeEach(() => {
    clearProbes()
    delete (globalThis as Record<string, unknown>).__PROTEUS_PROBE_ALL__
  })

  it('record → read（按 pid / 全部）', () => {
    recordProbe({ pid: 'a', tag: 'p-x', rect: { left: 0, top: 0, right: 1, bottom: 1, width: 10, height: 20 }, ts: 1 })
    recordProbe({ pid: 'b', tag: 'p-y', rect: null, ts: 2 })
    expect(readProbes('a').length).toBe(1)
    expect(readProbes('a')[0].rect?.height).toBe(20)
    expect(readProbes().length).toBe(2)
    expect(readProbes('missing')).toEqual([])
  })

  it('clear（单条 / 全部）——测试隔离用', () => {
    recordProbe({ pid: 'a', tag: 'p-x', rect: null, ts: 1 })
    clearProbes('a')
    expect(readProbes()).toEqual([])
    recordProbe({ pid: 'a', tag: 'p-x', rect: null, ts: 1 })
    recordProbe({ pid: 'b', tag: 'p-y', rect: null, ts: 1 })
    clearProbes()
    expect(readProbes()).toEqual([])
  })

  it('probeEnabled：显式 pid 或全局开关注入', () => {
    expect(probeEnabled('x'), '有 pid → 开').toBe(true)
    expect(probeEnabled(), '无 pid 且无全局开关 → 关（零成本）').toBe(false)
    ;(globalThis as Record<string, unknown>).__PROTEUS_PROBE_ALL__ = true
    expect(probeEnabled()).toBe(true)
  })

  it('（破坏性）空 pid 不写入——防脏数据', () => {
    recordProbe({ pid: '', tag: 'x', rect: null, ts: 1 })
    expect(readProbes()).toEqual([])
  })

  it('注册表键稳定（编译器内联注入与消费端共用同一键）', () => {
    expect(PROBE_GLOBAL_KEY).toBe('__PROTEUS_PROBES__')
    recordProbe({ pid: 'z', tag: 'p', rect: null, ts: 1 })
    expect((globalThis as unknown as Record<string, Record<string, Record<string, unknown>>>)[PROBE_GLOBAL_KEY].z.pid).toBe('z')
  })

  it('同 pid 覆盖（测最新）', () => {
    recordProbe({ pid: 'a', tag: 'p', rect: { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }, ts: 1 })
    recordProbe({ pid: 'a', tag: 'p', rect: { left: 0, top: 0, right: 1, bottom: 1, width: 2, height: 2 }, ts: 2 })
    expect(readProbes('a').length).toBe(1)
    expect(readProbes('a')[0].rect?.width).toBe(2)
  })
})
