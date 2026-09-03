// tests/superapp-container.test.ts
// ★G-42 B4（proteus-host-container-plan batches B4）：SuperAppContainer——业务沙箱 + 崩溃隔离 + 安全网关
//   验收：C-07 组（沙箱创建/作用域隔离/A 崩溃宿主存活/B 不受影响）+ 安全网关（签名/白名单）+ 自动重启 + 配额
import { describe, it, expect } from 'vitest'
import {
  createSuperAppContainer,
  runContainerConformance,
  CONTAINER_PROFILES,
} from '@proteus-vue/render-backend'

describe('G-42 B4 SuperAppContainer 业务沙箱', () => {
  it('C-07-01/02 沙箱 A/B 创建成功且存活；作用域隔离（scope 不共享）', async () => {
    const c = createSuperAppContainer()
    const sbA = await c.createSandbox('shop', { bizId: 'shop', signature: 'sig-a', requiredCapabilities: ['camera'] })
    const sbB = await c.createSandbox('pay', { bizId: 'pay', signature: 'sig-b', requiredCapabilities: ['location'] })
    expect(sbA.state).toBe('running')
    expect(sbB.state).toBe('running')
    // 独立 scope：写入 A 的值 B 不可见（业务间不共享可变全局状态）
    const aScope = sbA.isolatedScope as { values: Record<string, unknown> }
    const bScope = sbB.isolatedScope as { values: Record<string, unknown> }
    aScope.values.secret = 'A-secret'
    expect(bScope.values.secret).toBeUndefined()
  })

  it('安全网关：无签名拒绝（G39_SIGN）/ 越权能力拒绝（G39_CAP）/ maxSandboxes 限制（G39_LIMIT）', async () => {
    const c = createSuperAppContainer({ policy: { security: { requireSignature: true, capabilityWhitelist: ['camera'] } } })
    await expect(c.createSandbox('evil', { bizId: 'evil' })).rejects.toThrow(/G39_SIGN/)
    await expect(c.createSandbox('bad', { bizId: 'bad', signature: 's', requiredCapabilities: ['contacts'] })).rejects.toThrow(/G39_CAP/)
    const limited = createSuperAppContainer({ policy: { sandbox: { defaultMemoryBytes: 128 * 1024 * 1024, maxSandboxes: 1 } } })
    await limited.createSandbox('a', { bizId: 'a', signature: 's', requiredCapabilities: [] })
    await expect(limited.createSandbox('b', { bizId: 'b', signature: 's', requiredCapabilities: [] })).rejects.toThrow(/G39_LIMIT/)
  })

  it('C-07-04/05/06 ★崩溃隔离：业务 A 崩溃被捕获，宿主存活，业务 B 不受影响', async () => {
    const c = createSuperAppContainer()
    const sbB = await c.createSandbox('pay', { bizId: 'pay', signature: 'sig-b', requiredCapabilities: ['location'] })

    const result = c.executeInSandbox('pay', () => {
      throw new Error('业务 A 崩溃了')
    })

    expect(result.ok).toBe(false)
    expect(result.bizId).toBe('pay')
    expect(result.hostAlive).toBe(true) // ★宿主存活
    expect(c.crashLog.length).toBe(1)
    expect(c.crashLog[0].bizId).toBe('pay')

    // 业务 B 不受影响（另一个沙箱存活）
    const sbC = await c.createSandbox('shop', { bizId: 'shop', signature: 'sig-s', requiredCapabilities: ['camera'] })
    expect(sbC.state).toBe('running')
  })

  it('崩溃后自动重启（maxRestartCount 内）；超限 → crashed 永久禁用', async () => {
    const c = createSuperAppContainer({ policy: { crash: { isolationLevel: 2, autoRestart: true, maxRestartCount: 2 } } })
    const sb = await c.createSandbox('biz', { bizId: 'biz', signature: 's', requiredCapabilities: [] })
    const boom = () => {
      throw new Error('boom')
    }

    // 第一次崩溃：autoRestart → 回到 running
    expect(c.executeInSandbox('biz', boom).ok).toBe(false)
    expect(sb.state).toBe('running')
    // 第二次崩溃：仍在 maxRestartCount(2) 内 → running
    expect(c.executeInSandbox('biz', boom).ok).toBe(false)
    expect(sb.state).toBe('running')
    // 第三次崩溃：超过 maxRestartCount → crashed 永久禁用
    expect(c.executeInSandbox('biz', boom).ok).toBe(false)
    expect(sb.state).toBe('crashed')
    expect(c.crashLog).toHaveLength(3)
  })

describe('G-42 B4 能力画像与 Conformance 转 PASS', () => {
  it('superapp 画像：multiBusiness + crashIsolation=2 + 配额 + keepAlive', () => {
    expect(CONTAINER_PROFILES.superapp).toMatchObject({ pageStack: true, multiBusiness: true, crashIsolation: 2, resourceQuota: true, keepAlive: true })
  })

  it('C-07 沙箱组转 PASS（SuperApp 声明 multiBusiness——conformance 能力门控放行）', async () => {
    const c = createSuperAppContainer()
    const s = await runContainerConformance(c)
    const c07 = s.results.filter((r) => r.id.startsWith('C-07'))
    expect(c07.length).toBe(6)
    // 零 FAIL（套件不允许声明能力失败）
    expect(s.fail).toBe(0)
  })

  it('destroySandbox 后沙箱移除且状态销毁', async () => {
    const c = createSuperAppContainer()
    await c.createSandbox('a', { bizId: 'a', signature: 's', requiredCapabilities: [] })
    expect(c.listSandboxes()).toHaveLength(1)
    await c.destroySandbox('a')
    expect(c.listSandboxes()).toHaveLength(0)
  })
})
})