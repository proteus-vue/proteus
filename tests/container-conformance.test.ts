// tests/container-conformance.test.ts
// ★G-42 B3（proteus-host-container-plan batches B3）：容器 Conformance 套件（C-01~C-08）权威 TS 版
//   验收：runContainerConformance(createStackContainer()) —— 基础组（C-01~C-06 C-08-03/04）全 PASS
//   能力门控（诚实）：C-07 沙箱组与 C-08-01/02 网关组因 Stack 无此能力 → SKIP + reason
import { describe, it, expect } from 'vitest'
import {
  createStackContainer,
  runContainerConformance,
  formatContainerConformance,
  scanRepoForFork,
  checkBizManifest,
} from '@proteus-vue/render-backend'

describe('G-42 B3 scanRepoForFork（G-42.6 严禁 fork 机器指纹）', () => {
  it('合规仓库 → 0 命中；fork 仓库 → 命中', () => {
    const clean = scanRepoForFork({ 'host/src/main.js': "import { createContainer } from '@proteus/container';" })
    expect(clean).toHaveLength(0)

    const dirty = scanRepoForFork({ 'host/vendor/core.js': "import x from '@proteus/core/internal/diff';" })
    expect(dirty.length).toBeGreaterThan(0)
    expect(dirty[0].filename).toBe('host/vendor/core.js')
  })

  it('FORK_SIGNATURES 覆盖源码副本/内部模块/import 内部/fork 标记', () => {
    expect(scanRepoForFork({ 'a.js': 'packages/core/src/renderer.ts' })).toHaveLength(1)
    expect(scanRepoForFork({ 'a.js': '__PROTEUS_FORKED__' })).toHaveLength(1)
  })
})

describe('G-42 B3 checkBizManifest（安全网关纯函数——C-08-01/02 语义）', () => {
  it('无签名拒绝（G39_SIGN）', () => {
    const r = checkBizManifest({ bizId: 'evil' }, { requireSignature: true, whitelist: ['camera'] })
    expect(r).toMatchObject({ ok: false, code: 'G39_SIGN' })
  })

  it('越权能力拒绝（G39_CAP）', () => {
    const r = checkBizManifest({ bizId: 'bad', signature: 's', capabilities: ['contacts'] }, { requireSignature: true, whitelist: ['camera'] })
    expect(r).toMatchObject({ ok: false, code: 'G39_CAP' })
  })

  it('合规清单放行', () => {
    const r = checkBizManifest({ bizId: 'good', signature: 's', capabilities: ['camera'] }, { requireSignature: true, whitelist: ['camera'] })
    expect(r.ok).toBe(true)
  })
})

describe('G-42 B3 runContainerConformance（C-01~C-08，38 项）', () => {
  it('StackContainer：基础组全过 + 能力门控 SKIP（零 FAIL）', async () => {
    const s = await runContainerConformance(createStackContainer())
    expect(s.fail).toBe(0)
    // 准入必需组（C-01~C-06 28 项 + C-08-03/04 仓库治理 2 项）应全 PASS
    const mandatory = s.results.filter((r) => !r.id.startsWith('C-07') && r.id !== 'C-08-01' && r.id !== 'C-08-02')
    expect(mandatory.every((r) => r.status === 'PASS')).toBe(true)
    // C-07 沙箱组（6 项）→ SKIP（Stack 无 multiBusiness 能力——诚实声明）
    const c07 = s.results.filter((r) => r.id.startsWith('C-07'))
    expect(c07.every((r) => r.status === 'SKIP')).toBe(true)
    expect(c07.every((r) => r.reason?.includes('multiBusiness=false'))).toBe(true)
  })

  it('C-03 五原子组全 PASS（G-42.2 核心）', async () => {
    const s = await runContainerConformance(createStackContainer())
    const c03 = s.results.filter((r) => r.id.startsWith('C-03'))
    expect(c03).toHaveLength(6)
    expect(c03.every((r) => r.status === 'PASS')).toBe(true)
  })

  it('C-05 泄漏检测组全 PASS（页面销毁无残留机器证据）', async () => {
    const s = await runContainerConformance(createStackContainer())
    const c05 = s.results.filter((r) => r.id.startsWith('C-05'))
    expect(c05).toHaveLength(5)
    for (const r of c05) {
      expect(r.status).toBe('PASS')
    }
  })

  it('失败可暴露：非容器对象 → C-01-01 FAIL（套件能抓不合规）', async () => {
    const fake = { id: '', version: '', capabilities: {} } as never
    const s = await runContainerConformance(fake)
    const c0101 = s.results.find((r) => r.id === 'C-01-01')
    expect(c0101?.status).toBe('FAIL')
  })

  it('formatContainerConformance 输出可读报告', async () => {
    const s = await runContainerConformance(createStackContainer())
    const text = formatContainerConformance(s)
    expect(text).toContain('C-01~C-08')
    expect(text).toContain('FAIL=0')
  })
})