// tests/mp-e2e.test.ts
// ★test-framework B5：小程序 E2E 链路（IDE 路径可配置：PROTEUS_IDE_CLI / --ide / 平台默认探测）
// resolveMpIdeCli 四态 + planMpE2E（无 IDE 指引 / 计划 / 产物缺失）+ waitForAutomatorPort 超时
import { describe, expect, it } from 'vitest'
import { resolveMpIdeCli, planMpE2E, waitForAutomatorPort } from '../packages/cli/src/mp-e2e'

describe('resolveMpIdeCli（IDE 路径探测）', () => {
  const exists = (p: string): boolean => p.includes('real')

  it('环境变量 PROTEUS_IDE_CLI 指定且存在 → 优先使用', () => {
    expect(resolveMpIdeCli({ env: { PROTEUS_IDE_CLI: '/real/cli' }, exists })).toBe('/real/cli')
  })

  it('环境变量指定但不存在 → 落平台默认路径', () => {
    expect(resolveMpIdeCli({ env: { PROTEUS_IDE_CLI: '/fake/cli' }, exists, platform: 'darwin', defaultPaths: ['/Applications/real/cli'] })).toBe('/Applications/real/cli')
  })

  it('默认路径命中（注入 defaultPaths + exists）', () => {
    const defaultPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
    expect(resolveMpIdeCli({ env: {}, exists: (p) => p === defaultPath, platform: 'darwin', defaultPaths: [defaultPath] })).toBe(defaultPath)
  })

  it('全部缺失 → null（CLI 报错含配置指引）', () => {
    expect(resolveMpIdeCli({ env: {}, exists: () => false, platform: 'darwin', defaultPaths: ['/none/cli'] })).toBeNull()
  })
})

describe('planMpE2E（执行计划）', () => {
  it('无 IDE → throw 含配置指引（PROTEUS_IDE_CLI / --ide / 默认路径）', () => {
    expect(() => planMpE2E({ ideCli: null })).toThrow(/PROTEUS_IDE_CLI/)
    expect(() => planMpE2E({ ideCli: null })).toThrow(/--ide/)
    expect(() => planMpE2E({ ideCli: null })).toThrow(/wechatwebdevtools/)
  })

  it('有 IDE → 计划含步骤/端口/产物；产物缺失 → needBuild', () => {
    const plan = planMpE2E({ ideCli: '/real/cli', projectDir: '/p/dist/mp-weixin', port: 9527, exists: (p) => p !== '/p/dist/mp-weixin' })
    expect(plan.ideCli).toBe('/real/cli')
    expect(plan.port).toBe(9527)
    expect(plan.needBuild).toBe(true)
    expect(plan.steps.some((s) => s.includes('auto --project'))).toBe(true)
    expect(plan.steps.some((s) => s.includes('9527'))).toBe(true)
  })

  it('产物存在 → needBuild false；步骤含端口就绪与 vitest 执行说明', () => {
    const plan = planMpE2E({ ideCli: '/real/cli', projectDir: '/p/dist/mp-weixin', port: 9420, exists: () => true })
    expect(plan.needBuild).toBe(false)
    expect(plan.steps.some((s) => s.includes('PROTEUS_MP_E2E=1'))).toBe(true)
  })
})

describe('waitForAutomatorPort（端口就绪轮询）', () => {
  it('无服务端口 → 超时返回 false（注入短超时）', async () => {
    // 9999 端口无服务 → 轮询直到 150ms 超时 → false
    const ready = await waitForAutomatorPort(59999, 150)
    expect(ready).toBe(false)
  })
})
