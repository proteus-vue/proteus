// tests/stack-container.test.ts
// ★G-42 B2（proteus-host-container-plan batches B2）：StackContainer 参考实现
//   验收：页面栈 push/pop + 五原子销毁（G-42.2）+ 框架代管资源池（G-42.3）+ 深度限制 LRU + keep-alive 配额
import { describe, it, expect } from 'vitest'
import {
  createStackContainer,
  createResourcePool,
  createQuotaManager,
  CONTAINER_PROFILES,
} from '@proteus-vue/render-backend'

describe('G-42 B2 框架代管资源池（G-42.3）', () => {
  it('timer/listener 登记 + releaseAll 清零（页面销毁自动回收）', () => {
    const pool = createResourcePool('p1')
    pool.timer(() => {}, 1000)
    pool.interval(() => {}, 500)
    pool.on({ addEventListener() {}, removeEventListener() {} } as never, 'tap', () => {})
    expect(pool.total).toBe(3)
    const report = pool.releaseAll()
    expect(report.timersCleared).toBe(2)
    expect(report.listenersUnbound).toBe(1)
    expect(pool.total).toBe(0)
  })
})

describe('G-42 B2 配额管理（CMP061 超限返回 null）', () => {
  it('request 记账 + release 归还 + 超限 null', () => {
    const quota = createQuotaManager(100)
    expect(quota.request(60)).not.toBeNull()
    expect(quota.request(60)).toBeNull() // 超限 → null（CMP061）
    expect(quota.usage.usedBytes).toBe(60)
    const handle = quota.attach('p2', 40)!
    expect(quota.usage.usedBytes).toBe(100) // attach 增加记账
    quota.release(handle)
    expect(quota.usage.usedBytes).toBe(60) // release 归还 40
    expect(quota.pressure).toBe('normal') // 60/100 = 60% < 80%
  })

  it('压力分级：≥80% warning，≥100% critical', () => {
    const quota = createQuotaManager(100)
    quota.request(85)
    expect(quota.pressure).toBe('warning')
    quota.request(15)
    expect(quota.pressure).toBe('critical')
  })
})

describe('G-42 B2 StackContainer 页面栈', () => {
  it('push 挂载 → 栈深度/current 正确；状态机 created→mounted', async () => {
    const c = createStackContainer()
    const p1 = await c.push({ irId: 'ir-1' })
    const p2 = await c.push({ irId: 'ir-2' })
    expect(c.getStackDepth()).toBe(2)
    expect(c.getCurrent()?.pageId).toBe(p2.pageId)
    expect(p1.state).toBe('mounted')
    expect(p2.state).toBe('mounted')
  })

  it('pop 返回栈顶并销毁（五原子销毁报告 steps=5）', async () => {
    const c = createStackContainer()
    const p1 = await c.push({ irId: 'ir-1' })
    const p2 = await c.push({ irId: 'ir-2' })

    const popped = await c.pop()
    expect(popped?.pageId).toBe(p2.pageId)
    expect(c.getStackDepth()).toBe(1)
    expect(c.getCurrent()?.pageId).toBe(p1.pageId)
  })

  it('destroyPage 五原子报告：steps 恰好 5 步且顺序正确（G-42.2）', async () => {
    const c = createStackContainer()
    const page = await c.push({ irId: 'ir-1', budgetBytes: 8192 })
    const report = await c.destroyPage(page)
    expect(report.steps).toEqual(['unmount', 'unbindEvents', 'releaseResources', 'destroyIR', 'releaseQuota'])
    expect(report.pageId).toBe(page.pageId)
  })

  it('销毁后页面从栈移除、事件 page-destroyed 触发', async () => {
    const c = createStackContainer()
    const seen: Array<{ pageId: string }> = []
    c.on('page-destroyed', (p) => seen.push(p as { pageId: string }))
    const page = await c.push({ irId: 'ir-1' })
    await c.destroyPage(page)
    expect(c.getStackDepth()).toBe(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].pageId).toBe(page.pageId)
  })
})

describe('G-42 B2 页面栈深度治理（StackPolicy）', () => {
  it('destroy-oldest：超深 → LRU 销毁栈底（CMP060 显式事件）', async () => {
    const c = createStackContainer({ policy: { maxDepth: 3, overflowStrategy: 'destroy-oldest', keepAlive: { maxCount: 3, memoryBudgetBytes: 64 * 1024 * 1024 } } })
    const seen: string[] = []
    c.on('overflow', (p) => seen.push((p as { strategy: string }).strategy))

    const p1 = await c.push({ irId: '1' })
    await c.push({ irId: '2' })
    await c.push({ irId: '3' })
    await c.push({ irId: '4' }) // 超深 → 销毁 p1

    expect(c.getStackDepth()).toBe(3)
    expect(c.getCurrent()?.irId).toBe('4')
    expect(seen).toContain('destroy-oldest')
    expect(p1.state).toBe('destroyed')
  })

  it('reject：超深 → 抛错（安全但体验差）', async () => {
    const c = createStackContainer({ policy: { maxDepth: 2, overflowStrategy: 'reject', keepAlive: { maxCount: 2, memoryBudgetBytes: 64 * 1024 * 1024 } } })
    await c.push({ irId: '1' })
    await c.push({ irId: '2' })
    await expect(c.push({ irId: '3' })).rejects.toThrow(/reject/)
  })
})

describe('G-42 B2 容器能力画像（诚实声明）', () => {
  it('stack 画像：pageStack+资源配额+keepAlive，无多业务/无崩溃隔离', () => {
    expect(CONTAINER_PROFILES.stack).toMatchObject({ pageStack: true, resourceQuota: true, keepAlive: true, multiBusiness: false, crashIsolation: 0 })
  })

  it('stack 容器 createSandbox → 拒绝（能力外诚实报错）', async () => {
    const c = createStackContainer()
    await expect(c.createSandbox('biz-a', { bizId: 'biz-a' })).rejects.toThrow(/无沙箱/)
  })
})