// tests/basic-containers.test.ts
// ★G-42 B6（proteus-host-container-plan batches B6）：其余 4 种容器（SinglePage/Embedded/Window/MiniProgram）
//   验收：6 种容器全部通过 conformance（未声明能力组诚实 SKIP——CMP065）+ 各容器语义单测
//   + G-43 B3 ownership 接入（单槽内联 / window/miniprogram 委托）+ 「真实 App 验证」需生产 App 诚实延后
import { describe, it, expect } from 'vitest'
import {
  createSinglePageContainer,
  createEmbeddedContainer,
  createWindowContainer,
  createMiniProgramContainer,
  runContainerConformance,
  OwnershipGraph,
} from '@proteus-vue/render-backend'
import type { ProteusHostContainer } from '@proteus-vue/render-backend'

describe('G-42 B6 conformance：6 种容器全过（零 FAIL）', () => {
  it('singlepage：C-04/C-06/C-07 诚实 SKIP，零 FAIL', async () => {
    const container = createSinglePageContainer()
    const r = await runContainerConformance(container as unknown as ProteusHostContainer)
    expect(r.fail).toBe(0)
    expect(r.total).toBe(38)
    // 单槽语义：无页面栈治理（4）+ 无配额（4）+ 无沙箱（6）+ 无网关 C-08-02（1）= 15 SKIP
    expect(r.skip).toBe(15)
    expect(r.pass).toBe(23)
  })

  it('embedded：同 singlepage 画像（embedded:true），零 FAIL', async () => {
    const container = createEmbeddedContainer({ getHostMountPoint: (config) => ({ host: true, irId: config.irId }) })
    const r = await runContainerConformance(container as unknown as ProteusHostContainer)
    expect(r.fail).toBe(0)
    expect(r.skip).toBe(15)
    expect(r.pass).toBe(23)
  })

  it('window：pageStack/resourceQuota 生效（C-04/C-06 全过），C-07 SKIP——与 stack 同计数', async () => {
    const container = createWindowContainer()
    const r = await runContainerConformance(container as unknown as ProteusHostContainer)
    expect(r.fail).toBe(0)
    expect(r.skip).toBe(7) // C-07×6 + C-08-02
    expect(r.pass).toBe(31)
  })

  it('miniprogram：multiBusiness=true → C-07 全过（L1 沙箱），仅 C-08-02 SKIP（destroy-oldest 策略——套件顺序累积与 stack 同形态；10 层 reject 语义归专项测试）', async () => {
    const container = createMiniProgramContainer({ policy: { overflowStrategy: 'destroy-oldest' } })
    const r = await runContainerConformance(container as unknown as ProteusHostContainer)
    expect(r.fail).toBe(0)
    expect(r.skip).toBe(1)
    expect(r.pass).toBe(37)
  })
})

describe('G-42 B6 SinglePage 单槽语义', () => {
  it('push 替换：新页挂载 → 旧页销毁；同一时刻至多一个页面', async () => {
    const c = createSinglePageContainer()
    const p1 = await c.push({ pageId: 'p1', irId: 'card-1' })
    expect(p1.state).toBe('mounted')
    const p2 = await c.push({ pageId: 'p2', irId: 'card-2' })
    expect(p2.state).toBe('mounted')
    expect(c.getCurrent()?.pageId).toBe('p2')
    expect(c.getStackDepth()).toBe(1)
    // 旧页已销毁（replace 语义——单页容器显式语义非静默）
    expect(p1.state).toBe('destroyed')
    // destroyPage 旧页报未知（已从容器移除）
    await expect(c.destroyPage(p1)).rejects.toThrow(/未知页面/)
  })

  it('hidden↔mounted 往返 + pop 销毁', async () => {
    const c = createSinglePageContainer()
    const p = await c.push({ pageId: 'p1', irId: 'x' })
    await c.unmountPage(p)
    expect(p.state).toBe('hidden')
    await c.mountPage(p)
    expect(p.state).toBe('mounted')
    const popped = await c.pop()
    expect(popped?.state).toBe('destroyed')
    expect(c.getCurrent()).toBeNull()
  })

  it('事件（page-created/page-destroyed）', async () => {
    const c = createSinglePageContainer()
    const seen: string[] = []
    c.on('page-created', (p) => seen.push('created:' + (p as { pageId: string }).pageId))
    c.on('page-destroyed', (p) => seen.push('destroyed:' + (p as { pageId: string }).pageId))
    await c.push({ pageId: 'p1', irId: 'x' })
    await c.push({ pageId: 'p2', irId: 'y' }) // 替换 → 先销毁旧页再创建新页（单槽不变量：销毁→创建）
    expect(seen).toEqual(['created:p1', 'destroyed:p1', 'created:p2'])
  })

  it('G-43 B3 ownership：页面销毁 → 该页资源 forceDrop + 配额归零', async () => {
    const graph = new OwnershipGraph()
    const c = createSinglePageContainer({ ownership: { graph } })
    const p = await c.push({ pageId: 'PageA', irId: 'x' })
    const own = c.ownershipOf('PageA')!
    const buf = own.alloc({ byteSize: 4 * 1024 * 1024 })
    const borrow = buf.borrow('CardView')
    expect(graph.resourcesOf('PageA')).toHaveLength(1)

    const report = await c.destroyPage(p)
    expect(report.steps).toHaveLength(5)
    expect(report.reclaimedBytes).toBe(4 * 1024 * 1024)
    expect(graph.resourcesOf('PageA')).toHaveLength(0)
    expect(borrow.valid).toBe(false)
    expect(c.ownershipOf('PageA')).toBeNull()
  })
})

describe('G-42 B6 Embedded 嵌入语义', () => {
  it('宿主挂载点工厂：mountPoint 来自 getHostMountPoint', async () => {
    const c = createEmbeddedContainer({ getHostMountPoint: (config) => ({ host: true, irId: config.irId }) })
    const p = await c.push({ pageId: 'w1', irId: 'widget-1' })
    expect(p.state).toBe('mounted')
    expect((p as unknown as { mountPoint: { host: boolean; irId: string } }).mountPoint).toEqual({ host: true, irId: 'widget-1' })
  })

  it('dispose 后销毁（宿主控制生命周期）', async () => {
    const c = createEmbeddedContainer()
    await c.push({ pageId: 'w1', irId: 'x' })
    c.dispose()
    expect(c.getCurrent()).toBeNull()
  })
})

describe('G-42 B6 Window 多窗口语义', () => {
  it('窗口创建/聚焦/销毁 + SPI 代理聚焦窗口', async () => {
    const c = createWindowContainer()
    await c.initialize()
    expect(c.listWindows()).toEqual(['window-1'])
    const w2 = c.createWindow('win-editor')
    expect(c.focusedWindow).toBe('win-editor') // 创建即聚焦
    const page = await c.push({ pageId: 'ed-1', irId: 'editor' }) // 进 win-editor
    expect(w2.getCurrent()?.pageId).toBe('ed-1')

    c.focusWindow('window-1')
    expect(c.focusedWindow).toBe('window-1')
    await c.push({ pageId: 'main-1', irId: 'home' }) // 进 window-1
    expect(c.getCurrent()?.pageId).toBe('main-1')

    // 窗口事件
    const seen: string[] = []
    c.onWindow('window-destroyed', (p) => seen.push((p as { windowId: string }).windowId))
    await c.destroyWindow('win-editor') // 窗口内页面五原子销毁
    expect(seen).toEqual(['win-editor'])
    expect(page.state).toBe('destroyed')
    expect(c.listWindows()).toEqual(['window-1'])
  })

  it('销毁聚焦窗口 → 焦点回落到剩余窗口', async () => {
    const c = createWindowContainer()
    c.createWindow('w2')
    c.createWindow('w3')
    await c.destroyWindow('w3')
    expect(c.focusedWindow).toBe('w2')
  })

  it('G-43 B3 ownership：ownershipOf 跨窗口查找', async () => {
    const graph = new OwnershipGraph()
    const c = createWindowContainer({ ownership: { graph } })
    const w1 = c.createWindow('w1')
    const w2 = c.createWindow('w2')
    await w1.push({ pageId: 'a', irId: 'x' })
    await w2.push({ pageId: 'b', irId: 'y' })
    expect(c.ownershipOf('a')?.owner).toBe('a')
    expect(c.ownershipOf('b')?.owner).toBe('b')
    expect(c.ownershipOf('missing')).toBeNull()
    w2.ownershipOf('b')!.alloc({ byteSize: 1024 })
    expect(graph.resourcesOf('b')).toHaveLength(1)
  })
})

describe('G-42 B6 MiniProgram 导航语义', () => {
  it('navigateTo 10 层上限（超限显式拒绝）+ navigateBack', async () => {
    const c = createMiniProgramContainer()
    for (let i = 0; i < 10; i++) {
      await c.navigateTo({ pageId: `p${i}`, irId: `ir-${i}` })
    }
    expect(c.getStackDepth()).toBe(10)
    await expect(c.navigateTo({ pageId: 'p11', irId: 'ir-11' })).rejects.toThrow(/导航超限/)
    const popped = await c.navigateBack()
    expect(popped?.state).toBe('destroyed')
    expect(c.getStackDepth()).toBe(9)
  })

  it('redirectTo 替换栈顶 / reLaunch 清栈', async () => {
    const c = createMiniProgramContainer()
    const p1 = await c.navigateTo({ pageId: 'a', irId: 'ia' })
    const p2 = await c.redirectTo({ pageId: 'b', irId: 'ib' })
    expect(p1.state).toBe('destroyed') // 栈顶被替换
    expect(c.getCurrent()?.pageId).toBe('b')
    expect(p2.state).toBe('mounted')
    await c.reLaunch({ pageId: 'home', irId: 'ih' })
    expect(p2.state).toBe('destroyed')
    expect(c.getStackDepth()).toBe(1)
    expect(c.getCurrent()?.pageId).toBe('home')
  })

  it('switchTab：非 tab 页全销毁 + 其他 tab 页保活出栈（同实例往返——状态保活）', async () => {
    const c = createMiniProgramContainer()
    c.registerTab({ pageId: 'tab-home', irId: 'it-home' })
    c.registerTab({ pageId: 'tab-me', irId: 'it-me' })

    const first = await c.switchTab('tab-home')
    await c.navigateTo({ pageId: 'detail', irId: 'id' })
    await c.navigateTo({ pageId: 'sub', irId: 'is' })
    expect(c.getStackDepth()).toBe(3)

    // switchTab → detail/sub 销毁；tab-home 保活出栈（hidden，IR 保留）；栈 = [tab-me]
    const me = await c.switchTab('tab-me')
    expect(c.getCurrent()?.pageId).toBe('tab-me')
    expect(c.getStackDepth()).toBe(1)
    expect(first.state).toBe('hidden') // 保活出栈（非销毁）
    void me

    // 切回：同一实例（keep-alive 证据——状态/IR 保留）+ 重新挂载
    const back = await c.switchTab('tab-home')
    expect(back).toBe(first)
    expect(back.state).toBe('mounted')
    expect(c.getStackDepth()).toBe(1)
    expect(c.getCurrent()?.pageId).toBe('tab-home')
  })

  it('switchTab 未注册目标 → 显式拒绝', async () => {
    const c = createMiniProgramContainer()
    await expect(c.switchTab('nope')).rejects.toThrow(/未注册为 tab/)
  })

  it('L1 沙箱：scope 隔离（业务间不共享可变状态）+ 列表可查询 + 销毁', async () => {
    const c = createMiniProgramContainer()
    const a = await c.createSandbox('biz-a', { bizId: 'biz-a' })
    const b = await c.createSandbox('biz-b', { bizId: 'biz-b' })
    ;(a.scope.values as Record<string, unknown>).token = 'A'
    expect((b.scope.values as Record<string, unknown>).token).toBeUndefined() // scope 隔离
    expect(c.listSandboxes().map((s) => s.bizId).sort()).toEqual(['biz-a', 'biz-b'])
    await c.destroySandbox('biz-a')
    expect(c.listSandboxes()).toHaveLength(1)
    expect(a.state).toBe('destroyed')
  })
})
