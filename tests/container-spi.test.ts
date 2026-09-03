// tests/container-spi.test.ts
// ★G-42 B1（proteus-host-container-plan batches B1）：容器 SPI + 类型定义（插头形状）
//   验收：类型可编译、与 G-27/G-39/G-40 同形（id/version/capabilities + initialize/dispose）
//   可测纯逻辑：页面生命周期状态机（page-lifecycle §5.1）+ 五原子销毁校验（G-42.2）+ 容器能力画像（诚实声明）
import { describe, it, expect } from 'vitest'
import {
  canTransitionPageState,
  assertAtomicDestroy,
  createDestroyReport,
  FIVE_ATOMIC_STEPS,
  CONTAINER_PROFILES,
  profileOfContainer,
  PAGE_STATE_TRANSITIONS,
} from '@proteus-vue/render-backend'
import type {
  ProteusHostContainer,
  ContainerCapabilities,
  PageHandle,
  DestroyReport,
  QuotaManager,
  ResourcePool,
  StackPolicy,
  PageState,
} from '@proteus-vue/render-backend'

describe('G-42 B1 ToC 容器 SPI 类型定义（可编译 = 插头形状验收）', () => {
  it('核心接口 ProteusHostContainer 类型可编译（同形性：id/version/capabilities + 生命周期方法）', () => {
    // 编译期断言：以下赋值必须通过 tsc（运行期仅验证类型导出存在）
    const container: ProteusHostContainer = {
      id: 'stack',
      version: '0.1.0',
      capabilities: CONTAINER_PROFILES.stack,
      async initialize() {},
      dispose() {},
      createPage(config) {
        return config as unknown as PageHandle
      },
      async mountPage() {},
      async unmountPage() {},
      async destroyPage(pageId) {
        return createDestroyReport((pageId as unknown as PageHandle).pageId)
      },
      async push(config) {
        return config as unknown as PageHandle
      },
      async pop() {
        return null
      },
      getCurrent() {
        return null
      },
      getStackDepth() {
        return 0
      },
      async createSandbox(_bizId, manifest) {
        return { bizId: manifest.bizId, isolatedScope: {}, quotaHandle: null, state: 'running' as const }
      },
      async destroySandbox(bizId) {
        return createDestroyReport(bizId)
      },
      listSandboxes() {
        return []
      },
      quota: {} as QuotaManager,
      onMemoryPressure() {},
      on() {},
    }
    expect(container.id).toBe('stack')
    expect(container.capabilities.pageStack).toBe(true)
  })

  it('辅助类型导出齐全（ContainerCapabilities/PageHandle/DestroyReport/QuotaManager/ResourcePool/StackPolicy/PageState）', () => {
    const typeChecks = [
      {} as ContainerCapabilities,
      {} as PageHandle,
      {} as DestroyReport,
      {} as QuotaManager,
      {} as ResourcePool,
      {} as StackPolicy,
      {} as PageState,
    ]
    expect(typeChecks.length).toBe(7)
  })
})

describe('G-42 B1 页面生命周期状态机（page-lifecycle §5.1）', () => {
  it('合法链：created→mounted→hidden→destroyed→recycled（含 hide/show 往返）', () => {
    expect(canTransitionPageState('created', 'mounted')).toBe(true)
    expect(canTransitionPageState('mounted', 'hidden')).toBe(true)
    expect(canTransitionPageState('hidden', 'mounted')).toBe(true) // show 返回
    expect(canTransitionPageState('mounted', 'destroyed')).toBe(true)
    expect(canTransitionPageState('destroyed', 'recycled')).toBe(true) // 对象池复用
  })

  it('异常路径：mounted→crashed→destroyed（崩溃隔离不影响宿主）', () => {
    expect(canTransitionPageState('mounted', 'crashed')).toBe(true)
    expect(canTransitionPageState('crashed', 'destroyed')).toBe(true)
  })

  it('任意前置态→destroyed 合法（页面随时可销毁）；非法转换拒绝', () => {
    for (const from of ['created', 'mounted', 'hidden', 'crashed'] as PageState[]) {
      expect(canTransitionPageState(from, 'destroyed')).toBe(true)
    }
    expect(canTransitionPageState('created', 'hidden')).toBe(false) // 未挂载不能隐藏
    expect(canTransitionPageState('recycled', 'mounted')).toBe(false) // 复用对象不能直接挂载
    expect(canTransitionPageState('destroyed', 'crashed')).toBe(false) // 已销毁不能崩
    expect(canTransitionPageState('crashed', 'hidden')).toBe(false)
  })

  it('状态机表与 PageState 全集一致（无遗漏状态）', () => {
    const allStates: PageState[] = ['created', 'mounted', 'hidden', 'destroyed', 'crashed', 'recycled']
    for (const s of allStates) {
      expect(PAGE_STATE_TRANSITIONS[s]).toBeDefined()
    }
  })
})

describe('G-42 B1 五原子销毁校验（G-42.2 铁律：steps 必须恰好五步且顺序正确）', () => {
  it('合法报告（createDestroyReport 骨架）通过', () => {
    const report = createDestroyReport('page-1', 8388608, 12)
    expect(() => assertAtomicDestroy(report)).not.toThrow()
    expect(report.steps).toEqual(['unmount', 'unbindEvents', 'releaseResources', 'destroyIR', 'releaseQuota'])
  })

  it('步数不足 → 抛错（部分执行 = 泄漏）', () => {
    const bad: DestroyReport = { pageId: 'p1', steps: ['unmount', 'unbindEvents'], leaked: [], reclaimedBytes: 0, durationMs: 0 }
    expect(() => assertAtomicDestroy(bad)).toThrow(/五原子/)
  })

  it('步序错误 → 抛错', () => {
    const bad: DestroyReport = { pageId: 'p1', steps: ['unmount', 'unbindEvents', 'releaseResources', 'releaseQuota', 'destroyIR'], leaked: [], reclaimedBytes: 0, durationMs: 0 }
    expect(() => assertAtomicDestroy(bad)).toThrow(/顺序错误/)
  })

  it('FIVE_ATOMIC_STEPS 唯一事实源 = 文档五步', () => {
    expect(FIVE_ATOMIC_STEPS).toEqual(['unmount', 'unbindEvents', 'releaseResources', 'destroyIR', 'releaseQuota'])
  })
})

describe('G-42 B1 容器能力画像（诚实声明 CMP065 前置）', () => {
  it('六种预设容器画像与文档一致（superapp 崩溃隔离 L2 + 配额 + keepAlive）', () => {
    expect(CONTAINER_PROFILES.singlepage).toMatchObject({ pageStack: false, crashIsolation: 0 })
    expect(CONTAINER_PROFILES.stack).toMatchObject({ pageStack: true, resourceQuota: true, keepAlive: true })
    expect(CONTAINER_PROFILES.superapp).toMatchObject({ pageStack: true, multiBusiness: true, crashIsolation: 2, resourceQuota: true, keepAlive: true })
    expect(CONTAINER_PROFILES.miniprogram).toMatchObject({ pageStack: true, multiBusiness: true, crashIsolation: 1 })
    expect(CONTAINER_PROFILES.window.windowManagement).toBe(true)
    expect(CONTAINER_PROFILES.embedded.embedded).toBe(true)
  })

  it('未知容器 → 全 false（诚实默认，不虚报）', () => {
    expect(profileOfContainer('unknown-type')).toMatchObject({ pageStack: false, multiBusiness: false, crashIsolation: 0 })
  })
})