// tests/quickjs-host.test.ts
// ★★G-39 B4 切片：单线程 JS 引擎宿主运行时（Android QuickJS / iOS JSC 同族）
//
// 验收（对齐 G-39 计划「宿主运行时 SPI 与职责边界」）：
//   ① **SPI 面**：HostRuntimeLike 全方法可用（bootstrap/suspend/resume/destroy + worker/queue/nextTick/drain）
//   ② **生命周期唯一拥有**：非法转换**被拒绝且记账**（不静默）——重复 bootstrap / 未挂起就 resume /
//      销毁后 enqueue / 销毁后复活 / 重复 destroy
//   ③ **职责边界**：`runOnThread('background')` 诚实拒绝（capabilities.threads.background=false）；
//      原生调用未注册 ⇒ 拒绝并给出可操作信息（已注册清单）
//   ④ **事件循环归属**：帧驱动 `pumpFrame()` 才能推进队列；挂起时不推进（帧预算归还宿主）
//   ⑤ **诚实声明**：worker 是逻辑域（real=false）；能力表 threads.background=false
//   ⑥ **★G-41 宿主 conformance 用它替换 stub → 32/32 PASS**（真实运行时满足宿主接入契约——
//      这是"B4 存量宿主"的可执行判据，不是文档声明）
import { describe, it, expect } from 'vitest'
import { createQuickJsHostRuntime } from '../packages/render-backend/src/quickjs-host'
import { runHostConformance } from '../packages/render-backend/src/host-conformance'

describe('① SPI 面（HostRuntimeLike 全方法）', () => {
  it('bootstrap → running；suspend/resume 往返；destroy 清队列清 worker', () => {
    const rt = createQuickJsHostRuntime()
    expect(rt.state).toBe('created')
    rt.bootstrap()
    expect(rt.state).toBe('running')
    rt.suspend()
    expect(rt.state).toBe('suspended')
    rt.resume()
    expect(rt.state).toBe('running')

    rt.createWorker()
    rt.enqueue(() => 1)
    rt.destroy()
    expect(rt.state).toBe('destroyed')
    expect(rt.queue).toHaveLength(0)
    expect(rt.workers).toHaveLength(0)
    expect(rt.threads).toEqual(['main'])
  })

  it('queue：priority 排序（nextTick=0 先于 enqueue 默认 2）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    const order: string[] = []
    rt.enqueue(() => order.push('normal'))
    rt.nextTick(() => order.push('tick'))
    rt.enqueue(() => order.push('high'), 1)
    rt.drain()
    expect(order).toEqual(['tick', 'high', 'normal'])
  })
})

describe('② 生命周期唯一拥有（非法转换被拒绝 + 记账）', () => {
  it('bootstrap 幂等性分档：running 时重复调用不炸不重置；suspended 时拒绝（应显式 resume）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.bootstrap() // running 时重复：幂等（宿主重复调用是常见形态）
    expect(rt.refusals).toHaveLength(0)
    expect(rt.state).toBe('running')

    rt.suspend()
    expect(() => rt.bootstrap()).toThrow(/已挂起/) // 已挂起：拒绝（否则会静默把状态掰回 running，掩盖真实生命周期错误）
    expect(rt.refusals.some((r) => r.op === 'bootstrap')).toBe(true)
  })

  it('未挂起就 resume → 拒绝并记账（防"假 resume 事件"）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    expect(() => rt.resume()).toThrow(/职责边界拒绝/)
    expect(rt.refusals).toHaveLength(1)
    expect(rt.refusals[0].op).toBe('resume')
    expect(rt.refusals[0].state).toBe('running')
  })

  it('销毁后 enqueue → 拒绝（防悬空回调）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.destroy()
    expect(() => rt.enqueue(() => 1)).toThrow(/职责边界拒绝/)
    expect(rt.refusals.some((r) => r.op === 'enqueue')).toBe(true)
  })

  it('销毁后复活（bootstrap）→ 拒绝（G-39.1：destroyed 是终态）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.destroy()
    expect(() => rt.bootstrap()).toThrow(/不可复活/)
  })

  it('重复 destroy → 拒绝（第二次 destroy 通常是上层重复清理——真实缺陷）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.destroy()
    expect(() => rt.destroy()).toThrow(/重复销毁/)
  })

  it('lifecycleEvents 记录真实发生的转换（治理证据流）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.suspend()
    rt.resume()
    rt.suspend()
    rt.destroy()
    expect(rt.lifecycleEvents).toEqual(['suspend', 'resume', 'suspend', 'destroy'])
  })
})

describe('③ 职责边界（线程诚实 + 原生桥唯一出口）', () => {
  it('runOnThread(background) → 诚实拒绝（不假排队——假排队=框架以为拿到后台线程）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    expect(() => rt.runOnThread('background', () => {})).toThrow(/threads\.background=false/)
    expect(rt.refusals.some((r) => r.op === 'runOnThread(background)')).toBe(true)
  })

  it("runOnThread('main') → 入队，由 pumpFrame 消费", () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    let ran = false
    rt.runOnThread('main', () => {
      ran = true
    })
    expect(ran).toBe(false) // 尚未帧驱动
    expect(rt.pumpFrame()).toBe(1)
    expect(ran).toBe(true)
  })

  it('invokeNative 未注册且无 transport → 拒绝 + 可操作信息（列出已注册项）', async () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.registerNativeHandler('echo', (a) => a)
    await expect(rt.invokeNative('nope')).rejects.toThrow(/未注册且无 transport.*echo/s)
  })

  it('invokeNative：注册处理器优先于 transport', async () => {
    const calls: string[] = []
    const rt = createQuickJsHostRuntime({
      transport: { call: (name) => (calls.push(`transport:${name}`), '"from-transport"') },
    })
    rt.bootstrap()
    rt.registerNativeHandler('echo', (a) => `from-handler:${JSON.stringify(a)}`)
    await expect(rt.invokeNative('echo', { v: 1 })).resolves.toBe('from-handler:{"v":1}')
    expect(calls).toHaveLength(0)
    await expect(rt.invokeNative('other')).resolves.toBe('from-transport')
    expect(calls).toEqual(['transport:other'])
  })
})

describe('④ 事件循环归属（帧驱动才推进）', () => {
  it('pumpFrame 一次消费整队并返回任务数；挂起时不推进（帧预算归还宿主）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    rt.enqueue(() => 1)
    rt.enqueue(() => 2)
    expect(rt.pumpFrame()).toBe(2)
    expect(rt.pumpFrame()).toBe(0)

    rt.suspend()
    rt.enqueue(() => 3) // 队列可收（宿主可能仍有系统事件），但**不执行**（挂起语义）
    expect(rt.pumpFrame()).toBe(0)
    rt.resume()
    expect(rt.pumpFrame()).toBe(1)
  })

  it('pumpFrame 内新入队任务同帧继续消费（帧内排队语义；防饥饿）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    const order: number[] = []
    rt.enqueue(() => {
      order.push(1)
      rt.enqueue(() => order.push(2))
    })
    expect(rt.pumpFrame()).toBe(2)
    expect(order).toEqual([1, 2])
  })
})

describe('⑤ 诚实声明（能力表）', () => {
  it('capabilities：threads.background=false / count=1 / engine 可声明', () => {
    const rt = createQuickJsHostRuntime({ id: 'android', engine: 'quickjs', frameDriver: 'Choreographer' })
    expect(rt.capabilities.threads).toEqual({ main: true, background: false, count: 1 })
    expect(rt.capabilities.engine).toBe('quickjs')
    expect(rt.capabilities.lifecycle).toBe('full')
    expect(rt.capabilities.frameDriver).toBe('Choreographer')
  })

  it('createWorker 产逻辑域（real=false——无真并行，机器可读）', () => {
    const rt = createQuickJsHostRuntime()
    rt.bootstrap()
    const w = rt.createWorker()
    expect(w.real).toBe(false)
    expect(rt.threads).toContain(w.thread)
  })
})

describe('⑥ ★G-41 宿主 conformance（真实运行时替换 stub：32/32 PASS）', () => {
  it('H-01~H-08 全组通过（失败 = 真实宿主不满足接入契约）', () => {
    const rt = createQuickJsHostRuntime({ id: 'android', frameDriver: 'Choreographer' })
    const summary = runHostConformance({ host: rt })
    if (summary.fail > 0) {
      // 失败明细直出（否则只看到数字，排查要重跑）
      const failed = summary.results.filter((r) => r.status === 'FAIL').map((r) => `${r.id}: ${r.error}`)
      throw new Error(`宿主 conformance 失败 ${summary.fail} 项：\n${failed.join('\n')}`)
    }
    expect(summary.total).toBe(32)
    expect(summary.fail).toBe(0)
    expect(summary.pass).toBe(32)
  })

  it('conformance 后运行时状态仍是 running（外部驱动的事件不改状态机）', () => {
    const rt = createQuickJsHostRuntime()
    runHostConformance({ host: rt })
    expect(rt.state).toBe('running')
  })
})
