// tests/web-host.test.ts
// ★G-41 B4（proteus-host-integration-plan batches B4 · Web 宿主）：WebHostRuntime 可运行骨架
//   对齐 host-guide §5：Main + Worker + Event Loop；与 B3 vue-bridge 组合 = Web 端完整链路
//   （SFC → Vue renderer → Dispatcher → VueDomBackend → DOM）
// @vitest-environment happy-dom（document / EventTarget）
import { describe, it, expect } from 'vitest'
import { h } from 'vue'
import {
  createWebHostRuntime,
  createVueDomBackend,
  createProteusRendererForBackend,
  runHostConformance,
} from '@proteus-vue/render-backend'

describe('G-41 B4 WebHostRuntime（Main + Worker + Event Loop）', () => {
  it('状态机：bootstrap → running，suspend → suspended，resume → running，destroy → destroyed 且清理', () => {
    const host = createWebHostRuntime()
    expect(host.id).toBe('web')
    expect(host.state).toBe('created')

    host.bootstrap()
    expect(host.state).toBe('running')

    host.suspend()
    expect(host.state).toBe('suspended')
    host.resume()
    expect(host.state).toBe('running')

    host.enqueue(() => 1)
    host.createWorker()
    host.destroy()
    expect(host.state).toBe('destroyed')
    expect(host.queue.length).toBe(0)
    expect(host.workers.length).toBe(0)
    expect(host.threads).toEqual(['main'])
  })

  it('createWorker：注入工厂产生 worker（thread 独立记录）；SSR 无 Worker 时降级 fake（诚实声明）', () => {
    const host = createWebHostRuntime({
      createWorkerImpl: () => ({ raw: { postMessage() {} }, terminate() {} }),
    })
    host.bootstrap()
    const w = host.createWorker('worker.js')
    expect(w.id).toBe('w1')
    expect(w.thread).toBe('worker1')
    expect(host.threads).toContain('worker1')
    expect(w.raw).not.toBeNull()

    // 缺省工厂：happy-dom 无 Worker → 降级 fake（raw=null 诚实标注）
    const host2 = createWebHostRuntime()
    host2.bootstrap()
    const w2 = host2.createWorker()
    expect(w2.raw).toBeNull()
    w2.terminate()
  })

  it('enqueue/drain：同步队列（对齐 HostRuntimeLike）；优先级排序', () => {
    const host = createWebHostRuntime()
    host.bootstrap()
    const order: number[] = []
    host.enqueue(() => order.push(1), 2)
    host.nextTick(() => order.push(0)) // priority 0 先执行
    host.enqueue(() => order.push(2), 1)
    host.drain()
    expect(order).toEqual([0, 2, 1])
  })

  it('flush：微任务灌入 Event Loop（真实 Web 异步路径——await 后执行）', async () => {
    const host = createWebHostRuntime()
    host.bootstrap()
    let called = 0
    host.enqueue(() => {
      called++
    })
    expect(called).toBe(0) // 未 flush 不执行
    await host.flush()
    expect(called).toBe(1) // flush 后执行
  })

  it('bindPageVisibility：visibilitychange → suspend/resume（document 挂钩）', () => {
    const host = createWebHostRuntime()
    host.bootstrap()
    const unbind = host.bindPageVisibility()
    // happy-dom 可派发 visibilitychange；visibilityState 只读——用 Object.defineProperty 注入
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(host.state).toBe('suspended')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(host.state).toBe('running')
    unbind()
  })
})

describe('G-41 B4 Web 端完整链路（WebHostRuntime + VueDomBackend + vue-bridge → DOM）', () => {
  it('bootstrap 后：SFC vnode → 真实 DOM（B4 验收：Web 宿主跑通完整渲染）', () => {
    const host = createWebHostRuntime()
    host.bootstrap() // G-41.6：backend 已注册（下方 renderer），bootstrap 后 attach

    const { renderer } = createProteusRendererForBackend(createVueDomBackend())
    const container = document.createElement('div')
    document.body.appendChild(container)

    renderer.render(
      h('p-page', { title: 'Product' }, [h('p-grid', { minColWidth: 160 }, [h('p-text', { content: 'Web 宿主已接' }, 'Web 宿主已接')])]),
      container,
    )

    const grid = container.querySelector('.proteus-grid') as HTMLElement | null
    expect(grid).not.toBeNull()
    expect(grid?.querySelector('span')?.textContent).toContain('Web 宿主已接')
    document.body.removeChild(container)
  })

  it('WebHostRuntime 注入 host-conformance：H-01/H-02 生命周期组全过（web host 合规）', () => {
    const s = runHostConformance({ host: createWebHostRuntime() })
    // H-01 接入完整 + H-02 生命周期（web host 自身的状态机）
    const h01 = s.results.filter((r) => r.id.startsWith('H-01'))
    const h02 = s.results.filter((r) => r.id.startsWith('H-02'))
    expect(h01.every((r) => r.status === 'PASS')).toBe(true)
    expect(h02.every((r) => r.status === 'PASS')).toBe(true)
    // 全量仍 0 失败（web host 兼容 HostRuntimeLike 面）
    expect(s.fail).toBe(0)
  })
})