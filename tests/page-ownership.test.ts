// tests/page-ownership.test.ts
// ★G-43 B3（proteus-ownership-plan batches B3）：与 G-42 五原子销毁集成（权威 TS 版）
//   验收三连：① 页面销毁后该页资源计数 = 0  ② 活跃借用被强制失效（forceDrop）  ③ 配额完全归还
//   对齐 drop-protocol.md（§3.2：G-42 步骤 3「releaseResources」→ 遍历该页所有权图节点逐个 Drop 五阶段，
//   页面销毁使用 forceDrop）+ ownership-reference.cjs destroyPage 演示 + batches B3 内容
import { describe, it, expect } from 'vitest'
import { createPageOwnership, createStackContainer, OwnershipGraph, Owned, Managed, createSuperAppContainer } from '@proteus-vue/render-backend'

function makePageCtx(opts: { quotaBytes?: number } = {}): { graph: OwnershipGraph; ctx: ReturnType<typeof createPageOwnership> } {
  const graph = new OwnershipGraph()
  const ctx = createPageOwnership('PageA', { graph, ...(opts.quotaBytes !== undefined ? { quotaBytes: opts.quotaBytes } : {}) })
  return { graph, ctx }
}

describe('G-43 B3 PageOwnership 页面所有权上下文（alloc/登记/destroy）', () => {
  it('alloc 登记资源；destroy(force) 后资源计数 = 0 + 借用失效 + 配额归零', () => {
    const { graph, ctx } = makePageCtx()
    const buf = ctx.alloc({ byteSize: 8 * 1024 * 1024, sourceLocation: 'Gallery.vue:5' })
    const borrow = buf.borrow('GalleryView') // 故意留活跃借用（验收：forceDrop 强制失效）

    expect(ctx.resourcesOf()).toHaveLength(1)
    expect(graph.stats().alive).toBe(1)

    const report = ctx.destroy({ force: true })
    expect(report.freedCount).toBe(1)
    expect(report.freedBytes).toBe(8 * 1024 * 1024)
    expect(report.invalidatedBorrows).toBe(1)
    expect(report.quotaRemaining).toBe(0) // ③ 配额完全归还
    expect(report.managedDisposed).toBe(0)

    // ① 页面销毁后该页资源计数 = 0（graph + ctx 双口径）
    expect(graph.resourcesOf('PageA')).toHaveLength(0)
    expect(ctx.resourcesOf()).toHaveLength(0)
    expect(borrow.valid).toBe(false) // ② 活跃借用被强制失效
    expect(buf.state).toBe('dropped')

    // 幂等：二次 destroy 零动作
    const again = ctx.destroy({ force: true })
    expect(again.freedCount).toBe(0)
    expect(again.quotaRemaining).toBe(0)
  })
})

describe('G-43 B3 配额与泄漏', () => {
  it('quotaBytes 限额：超限 alloc 抛错；限额内正常', () => {
    const { ctx } = makePageCtx({ quotaBytes: 10 * 1024 * 1024 })
    ctx.alloc({ byteSize: 6 * 1024 * 1024 })
    let msg = ''
    try {
      ctx.alloc({ byteSize: 6 * 1024 * 1024 }) // 6MB + 6MB > 10MB
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('配额不足')
    ctx.destroy({ force: true })
  })

  it('register 登记业务自建 Owned（同 graph + owner=本页）——销毁一并回收', () => {
    const graph = new OwnershipGraph()
    const ctx = createPageOwnership('PageA', { graph })
    ctx.alloc({ byteSize: 6 * 1024, type: 'array-buffer' }) // alloc 形态
    const ext = new Owned({
      id: 'cam-1',
      resourceType: 'camera-handle',
      byteSize: 4 * 1024,
      owner: 'PageA',
      value: {},
      graph,
      releaseHook: () => {},
    })
    ctx.register(ext) // register 形态（业务自建）
    expect(ctx.resourcesOf()).toHaveLength(2)

    const report = ctx.destroy({ force: true })
    expect(report.freedCount).toBe(2)
    expect(graph.resourcesOf('PageA')).toHaveLength(0)
    expect(ext.state).toBe('dropped')
  })

  it('destroy(force:false) drop 语义：活跃借用资源不释放 → leaked 清单 + 配额保留；force 后清空', () => {
    const graph = new OwnershipGraph()
    const ctx = createPageOwnership('PageA', { graph, quotaBytes: 32 * 1024 * 1024 })
    const buf = ctx.alloc({ byteSize: 8 * 1024 * 1024 })
    const borrow = buf.borrow('ViewX')

    const soft = ctx.destroy({ force: false })
    expect(soft.freedCount).toBe(0)
    expect(soft.leaked).toHaveLength(1)
    expect(soft.leaked[0].resourceId).toBe(buf.id)
    expect(soft.leaked[0].reason).toBe('has_active_borrows')
    expect(buf.state).toBe('alive') // drop-protocol §6.3：失败保持 alive + 配额保留（供宿主再试）
    expect(soft.quotaRemaining).toBe(8 * 1024 * 1024)

    // force 兜底：页面销毁场景强制回收
    const hard = ctx.destroy({ force: true })
    expect(hard.freedCount).toBe(1)
    expect(hard.invalidatedBorrows).toBe(1)
    expect(hard.leaked).toHaveLength(0)
    expect(hard.quotaRemaining).toBe(0)
    expect(borrow.valid).toBe(false)
  })

  it('Managed 框架代管资源随 destroy disposeAll', () => {
    const { ctx } = makePageCtx()
    new Managed({ value: {}, owner: 'PageA', registry: ctx.managed })
    new Managed({ value: {}, owner: 'PageA', registry: ctx.managed })
    expect(ctx.managed.size).toBe(2)

    const report = ctx.destroy({ force: true })
    expect(report.managedDisposed).toBe(2)
    expect(ctx.managed.size).toBe(0)
  })

  it('transferTo 别页的资源不再属本页（destroy 跳过——moved 节点不误删）', () => {
    const { graph, ctx } = makePageCtx()
    const buf = ctx.alloc({ byteSize: 1024 })
    buf.transferTo('PageB') // Move 到 PageB（所有权转移）
    expect(buf.state).toBe('moved')

    const report = ctx.destroy({ force: true })
    expect(report.freedCount).toBe(0) // moved 资源不属本页销毁范围
    expect(graph.resourcesOf('PageA')).toHaveLength(0)
    expect(graph.stats().moved).toBe(1) // 节点保留为 moved 证据（DevTools 可回溯）
    expect(report.quotaRemaining).toBe(0)
  })
})

describe('G-43 B3 StackContainer 集成（五原子第 3 步委托 Drop 协议）', () => {
  it('端到端验收：页面销毁 → 该页资源计数 0 / 活跃借用失效 / 配额归零 / 五原子完整', async () => {
    const graph = new OwnershipGraph()
    const container = createStackContainer({ ownership: { graph } })
    const page = await container.push({ pageId: 'PageA', irId: 'home' })

    // 业务经页面所有权上下文分配资源（页面 = 所有权 scope）
    const own = container.ownershipOf('PageA')
    expect(own).not.toBeNull()
    const buf = own!.alloc({ byteSize: 16 * 1024 * 1024, sourceLocation: 'Leaky.vue:23' })
    const borrow = buf.borrow('PlayerView') // 故意留活跃借用
    expect(graph.resourcesOf('PageA')).toHaveLength(1)

    const report = await container.destroyPage(page)
    expect(report.steps).toHaveLength(5) // 五原子完整（G-42.2）
    expect(report.reclaimedBytes).toBe(16 * 1024 * 1024) // 步骤③ freedBytes 计入销毁报告
    expect(graph.resourcesOf('PageA')).toHaveLength(0) // ① 页面销毁后该页资源计数 = 0
    expect(borrow.valid).toBe(false) // ② 活跃借用被强制失效
    expect(buf.state).toBe('dropped')
    expect(container.ownershipOf('PageA')).toBeNull() // 页面已销毁，上下文随之消失
  })

  it('destroyPage 五原子校验仍严格（G-42.2 steps 恰好 5 步）', async () => {
    const graph = new OwnershipGraph()
    const container = createStackContainer({ ownership: { graph, quotaBytes: 64 * 1024 * 1024 } })
    const page = await container.push({ pageId: 'PageB', irId: 'detail' })
    const own = container.ownershipOf('PageB')!
    own.alloc({ byteSize: 4 * 1024 * 1024 })
    new Managed({ value: {}, owner: 'PageB', registry: own.managed })

    const report = await container.destroyPage(page)
    expect(report.steps.join(' → ')).toBe('unmount → unbindEvents → releaseResources → destroyIR → releaseQuota')
    expect(report.leaked).toHaveLength(0)
    expect(report.reclaimedBytes).toBe(4 * 1024 * 1024)
  })

  it('未启用 ownership 的容器零变化（ownershipOf 返回 null + 销毁照常）', async () => {
    const container = createStackContainer()
    expect(container.ownershipOf('whatever')).toBeNull()
    const page = await container.push({ pageId: 'Plain', irId: 'x' })
    const report = await container.destroyPage(page)
    expect(report.steps).toHaveLength(5)
    expect(report.reclaimedBytes).toBe(0)
  })

  it('SuperAppContainer ownership pass-through（委托内部 Stack 的 forceDrop）', async () => {
    const graph = new OwnershipGraph()
    const container = createSuperAppContainer({ ownership: { graph } })
    const page = await container.push({ pageId: 'BizPage', irId: 'super' })
    const own = container.ownershipOf('BizPage')
    expect(own).not.toBeNull()
    own!.alloc({ byteSize: 2 * 1024 * 1024 })

    const report = await container.destroyPage(page)
    expect(report.steps).toHaveLength(5)
    expect(graph.resourcesOf('BizPage')).toHaveLength(0)
  })
})
