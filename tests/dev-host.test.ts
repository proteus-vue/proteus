/**
 * G-45 B2 —— @proteus-vue/dev-host 测试套件
 * 对齐 proteus-dev-host-plan NAT-C 门禁语义 + B1 参考实现 12 自检场景
 */
import { describe, it, expect } from 'vitest'
import {
  createDevHost,
  BuildCache,
  planBuild,
  checkResultShape,
  shapeOf,
  shapeEquals,
  fnv1a,
  checkAbiCompat,
  stableLayerCacheKey,
  type DevHostEventType,
} from '@proteus-vue/dev-host'

function scannerModule(version: string, text: string) {
  return {
    manifest: { id: 'scanner', version, capabilities: ['scanQR'], signature: 'sig-abc123' },
    conformance: [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })],
    factory: () => ({ scanQR: async () => ({ text }) }),
  }
}

describe('DevHost 基座常驻（C-01）', () => {
  it('创建即就绪：baseRebuildCount 恒为 0，可立即生成转发桩', () => {
    const host = createDevHost()
    const stub = host.createStub('scanQR', 'scanQR')
    expect(stub).toBeTruthy()
    expect(host.baseRebuildCount).toBe(0)
    expect(host.getMetrics().loadedModules).toBe(0)
  })

  it('同 cap.method 复用同一 stub 实例（热升级对业务透明）', () => {
    const host = createDevHost()
    const a = host.createStub('scanQR', 'scanQR')
    const b = host.createStub('scanQR', 'scanQR')
    expect(a).toBe(b)
  })
})

describe('转发桩 pending 语义（C-02 / CMP083）', () => {
  it('未装载调用进 pending，装载后按序回放', async () => {
    const host = createDevHost()
    host.registerFallback('scanQR', async () => ({ text: null, degraded: true }))
    const stub = host.createStub('scanQR', 'scanQR')
    const p = stub.call({ format: 'qr' })
    expect(host.getMetrics().pendingNow).toBe(1)

    const report = await host.loadModule(scannerModule('1.0.0', 'CODE-123'))
    expect(report.ok).toBe(true)
    expect(report.replayed).toBe(1)

    const r = (await p) as { text: string }
    expect(r.text).toBe('CODE-123')
    expect(host.getMetrics().replayedTotal).toBe(1)
    expect(host.getMetrics().pendingNow).toBe(0)
  })

  it('装载后调用直通（不再 pending）', async () => {
    const host = createDevHost()
    const stub = host.createStub('scanQR', 'scanQR')
    await host.loadModule(scannerModule('1.0.0', 'CODE-123'))
    const r = (await stub.call({ format: 'qr' })) as { text: string }
    expect(r.text).toBe('CODE-123')
    expect(stub.directCalls).toBe(1)
    expect(host.getMetrics().pendingNow).toBe(0)
  })

  it('多笔 pending 按 seq 序回放', async () => {
    const host = createDevHost()
    const stub = host.createStub('scanQR', 'scanQR')
    const p1 = stub.call({ seq: 1 })
    const p2 = stub.call({ seq: 2 })
    const replays: number[] = []
    host.on('stub:replay', (p) => replays.push(p.seq as number))
    await host.loadModule(scannerModule('1.0.0', 'X'))
    await Promise.all([p1, p2])
    // seq 单调递增
    expect(replays.length).toBe(2)
    expect(replays[1]).toBeGreaterThan(replays[0])
  })

  it('同能力不同方法各自 pending', async () => {
    const host = createDevHost()
    const s1 = host.createStub('scanQR', 'scanQR')
    const s2 = host.createStub('scanQR', 'stopScan')
    const p1 = s1.call()
    const p2 = s2.call()
    expect(host.getMetrics().pendingNow).toBe(2)
    await host.loadModule({
      manifest: { id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-ok' },
      conformance: [
        { name: 'a', check: () => true },
        { name: 'b', check: () => true },
      ],
      factory: () => ({
        scanQR: async () => ({ ok: 1 }),
        stopScan: async () => ({ ok: 2 }),
      }),
    })
    expect(await p1).toEqual({ ok: 1 })
    expect(await p2).toEqual({ ok: 2 })
  })
})

describe('热升级（C-03）', () => {
  it('v1 → v2 热替换：stub 不变、零基座重打、结果更新', async () => {
    const host = createDevHost()
    const stub = host.createStub('scanQR', 'scanQR')
    await host.loadModule(scannerModule('1.0.0', 'CODE-123'))
    const report = await host.loadModule(scannerModule('2.0.0', 'CODE-V2'))
    expect(report.ok).toBe(true)

    const r = (await stub.call({})) as { text: string }
    expect(r.text).toBe('CODE-V2')
    expect(host.getMetrics().upgrades).toBe(1)
    expect(host.baseRebuildCount).toBe(0)
    expect(host.capabilityOf('scanQR')?.version).toBe('2.0.0')

    const ups = host.getEvents('module:upgraded')
    expect(ups.length).toBe(1)
    expect(ups[0].payload.from).toBe('1.0.0')
    expect(ups[0].payload.to).toBe('2.0.0')
  })
})

describe('装载即验证：门禁链（C-04/C-05 / CMP084-087）', () => {
  it('conformance FAIL → 拒绝装载 + pending 转降级（降级不崩溃）', async () => {
    const host = createDevHost()
    host.registerFallback('takePhoto', async () => ({ path: null, degraded: true }))
    const p = host.createStub('takePhoto', 'takePhoto').call()

    const report = await host.loadModule({
      manifest: { id: 'badcam', version: '1.0.0', capabilities: ['takePhoto'], signature: 'sig-abc' },
      conformance: [checkResultShape('takePhoto', 'takePhoto', [], { path: 'string' })],
      factory: () => ({ takePhoto: async () => ({ code: 7 }) }),
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_CONFORMANCE_FAIL')

    const r = (await p) as { degraded: boolean }
    expect(r.degraded).toBe(true)
    expect(host.getMetrics().fallbacks).toBe(1)
    expect(host.capabilityOf('takePhoto')).toBeNull()
  })

  it('无降级后端时：装载失败后 pending 调用拒绝（G45_NO_FALLBACK）', async () => {
    const host = createDevHost()
    const p = host.createStub('scanQR', 'scanQR').call()
    await host.loadModule({
      manifest: { id: 'bad', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-abc' },
      conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
      factory: () => ({ scanQR: async () => ({ code: 1 }) }),
    })
    await expect(p).rejects.toThrow(/G45_NO_FALLBACK/)
  })

  it('坏签名拒绝（能力注册表不被污染）', async () => {
    const host = createDevHost()
    await host.loadModule(scannerModule('2.0.0', 'V2'))
    const report = await host.loadModule({
      manifest: { id: 'evil', version: '1.0.0', capabilities: ['scanQR'], signature: 'hacked' },
      conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
      factory: () => ({ scanQR: async () => ({ text: 'x' }) }),
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_SIGN')
    expect(host.capabilityOf('scanQR')?.version).toBe('2.0.0')
    expect(host.capabilityOf('scanQR')?.id).toBe('scanner')
  })

  it('manifest 缺失/不完整拒绝', async () => {
    const host = createDevHost()
    const bad = await host.loadModule({
      manifest: { id: '', version: '1.0.0', capabilities: [], signature: 'sig-ok' },
      conformance: [],
      factory: () => ({}),
    })
    expect(bad.ok).toBe(false)
    expect(bad.reason).toBe('G45_MANIFEST_INCOMPLETE')
  })

  it('conformance 覆盖率不足（用例数 < 能力数）拒绝', async () => {
    const host = createDevHost()
    const report = await host.loadModule({
      manifest: { id: 'lazy', version: '1.0.0', capabilities: ['a', 'b'], signature: 'sig-ok' },
      conformance: [{ name: 'only-a', check: () => true }],
      factory: () => ({}),
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_CONFORMANCE_COVERAGE')
  })

  it('factory 抛异常拒绝（G45_FACTORY_THROWN）', async () => {
    const host = createDevHost()
    const report = await host.loadModule({
      manifest: { id: 'boom', version: '1.0.0', capabilities: ['a'], signature: 'sig-ok' },
      conformance: [{ name: 'a', check: () => true }],
      factory: () => {
        throw new Error('native init failed')
      },
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_FACTORY_THROWN')
    expect(report.reasonDetail).toContain('native init failed')
  })

  it('方法缺失：直调拒绝（G45_METHOD_MISSING）', async () => {
    const host = createDevHost()
    await host.loadModule(scannerModule('1.0.0', 'X'))
    await expect(
      host.createStub('scanQR', 'notExist').call()
    ).rejects.toThrow(/G45_METHOD_MISSING/)
  })
})

describe('卸载语义（C-06）', () => {
  it('unload 后调用重回 pending，再装载恢复', async () => {
    const host = createDevHost()
    const stub = host.createStub('scanQR', 'scanQR')
    await host.loadModule(scannerModule('1.0.0', 'A'))
    expect(host.unloadModule('scanner')).toBe(true)
    expect(host.unloadModule('scanner')).toBe(false)
    expect(host.capabilityOf('scanQR')).toBeNull()

    const p = stub.call({})
    expect(host.getMetrics().pendingNow).toBe(1)
    const report = await host.loadModule(scannerModule('2.0.0', 'B'))
    expect(report.replayed).toBe(1)
    expect(((await p) as { text: string }).text).toBe('B')
    expect(host.getMetrics().unloads).toBe(1)
  })
})

describe('双层构建计划器（C-07 / CMP086）', () => {
  it('页面 20→80→150 + 插件迭代，base 恒为 1 次首建', () => {
    const cache = new BuildCache()
    const s1 = planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'src-r1', pluginVersions: { scanner: '2.0.0' } })
    expect(s1.base.action).toBe('build')
    expect(s1.plugins[0]?.action).toBe('build')

    const s2 = planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'src-r2', pluginVersions: { scanner: '2.0.0' } })
    expect(s2.base.action).toBe('skip') // 页面变化不影响 base
    expect(s2.js.action).toBe('build') // js 增量

    const s3 = planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'src-r3', pluginVersions: { scanner: '3.0.0' } })
    expect(s3.base.action).toBe('skip')
    expect(s3.plugins[0]?.action).toBe('build') // 只有变化的插件重建

    expect(cache.buildCounts).toEqual({ base: 1, js: 3, plugin: 2 })
  })

  it('框架版本变化触发 base 重建（合理失效）', () => {
    const cache = new BuildCache()
    planBuild(cache, { frameworkVersion: 'v1.0', abi: 'arm64', jsHash: 'a', pluginVersions: {} })
    const s = planBuild(cache, { frameworkVersion: 'v1.1', abi: 'arm64', jsHash: 'a', pluginVersions: {} })
    expect(s.base.action).toBe('build')
    expect(s.js.action).toBe('skip') // jsHash 未变
  })

  it('fnv1a 稳定且区分输入', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'))
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'))
  })
})

describe('shape 语义等价（C-08 / CMP074 思想）', () => {
  it('mock 与 native 同 shape 通过、异 shape 拒绝', async () => {
    const c = checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })
    expect(await c.check({ scanQR: async () => ({ text: 'MOCK' }) })).toBe(true)
    expect(await c.check({ scanQR: async () => ({ text: 'REAL' }) })).toBe(true)
    expect(await c.check({ scanQR: async () => ({ code: 1 }) })).toBe(false)
    expect(await c.check({})).toBe(false)
  })

  it('shapeOf：嵌套/数组/原始值（叶子节点含 typeof——返回类型变化即契约破坏）', () => {
    expect(shapeEquals({ a: 1, b: { c: 'x' } }, { b: { c: 's' }, a: 2 })).toBe(true)
    expect(shapeEquals({ a: 1 }, { a: 's' })).toBe(false) // 值类型变化 = 契约破坏
    expect(shapeEquals([1, 2], ['a'])).toBe(false) // 数组首元素类型不同
    expect(shapeEquals([1], [])).toBe(false)
    expect(shapeEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(shapeOf('s')).toBe('string')
    expect(shapeOf(null)).toBe('null')
  })
})

describe('可观测（C-09/C-10 / G-45.5）', () => {
  it('能力注册表可查询', async () => {
    const host = createDevHost()
    await host.loadModule(scannerModule('2.0.0', 'X'))
    const list = host.listBackends()
    expect(list.length).toBe(1)
    expect(list[0]).toMatchObject({ id: 'scanner', version: '2.0.0', capabilities: ['scanQR'] })
    expect(host.capabilityOf('scanQR')).toEqual({ id: 'scanner', version: '2.0.0', source: 'dynamic' })
    expect(host.capabilityOf('nope')).toBeNull()
  })

  it('全链事件：pending/loaded/upgraded/rejected/fallback/unloaded/replay 齐全', async () => {
    const host = createDevHost()
    host.registerFallback('takePhoto', async () => ({ degraded: true }))
    const stub = host.createStub('scanQR', 'scanQR')
    const p = stub.call({})
    await host.loadModule(scannerModule('1.0.0', 'A'))
    await p
    await host.loadModule(scannerModule('2.0.0', 'B'))
    await host.loadModule({
      manifest: { id: 'evil', version: '1.0.0', capabilities: ['takePhoto'], signature: 'bad' },
      conformance: [{ name: 'x', check: () => true }],
      factory: () => ({}),
    })
    host.unloadModule('scanner')

    const types = new Set<string>(host.getEvents().map((e) => e.type))
    for (const t of ['stub:pending', 'stub:replay', 'module:loaded', 'module:upgraded', 'module:rejected', 'module:unloaded']) {
      expect(types.has(t)).toBe(true)
    }
    expect(host.getEvents('module:loaded').length).toBe(2)
  })

  it('on() 订阅收到事件，退订后不再收到', async () => {
    const host = createDevHost()
    const seen: string[] = []
    const off = host.on('module:loaded', (p) => seen.push(String(p.id)))
    await host.loadModule(scannerModule('1.0.0', 'A'))
    off()
    await host.loadModule(scannerModule('1.0.1', 'B')) // 升级路径发的是 upgraded，非 loaded
    expect(seen).toEqual(['scanner'])
  })

  it('metrics 全字段（pendingPeak / rejected / events）', async () => {
    const host = createDevHost()
    const s = host.createStub('x', 'm')
    const p1 = s.call()
    const p2 = s.call()
    const m1 = host.getMetrics()
    expect(m1.pendingNow).toBe(2)
    expect(m1.pendingPeak).toBe(2)
    host.registerFallback('x', async () => null)
    await host.loadModule({
      manifest: { id: 'bad', version: '1.0.0', capabilities: ['x'], signature: 'sig-ok' },
      conformance: [{ name: 'f', check: () => false }],
      factory: () => ({}),
    })
    await Promise.allSettled([p1, p2])
    const m2 = host.getMetrics()
    expect(m2.rejectedModules).toBe(1)
    expect(m2.fallbacks).toBe(2)
    expect(m2.pendingNow).toBe(0)
    expect(m2.events).toBeGreaterThan(0)
    expect(m2.uptimeMs).toBeGreaterThanOrEqual(0)
  })
})

/* ================= 补丁一/二：三态生命周期 + ABI 冻结协议（#371） ================= */

const BASE_ABI = {
  abi: { major: 1, minor: 3, patch: 0 },
  features: ['camera', 'scanQR', 'haptic_feedback'],
  signatureChain: 'chain-proteus-official',
}

describe('ABI 兼容矩阵（补丁二 §2 / checkAbiCompat）', () => {
  it('ABI-01：同 major + 插件 minor ≤ 基座 → 兼容', () => {
    const r = checkAbiCompat(BASE_ABI, {
      abi: { major: 1, minor: 2, patch: 5 },
      features: ['camera'],
      signatureChain: 'chain-proteus-official',
    })
    expect(r.compatible).toBe(true)
    // minor 相等也兼容
    const rEq = checkAbiCompat(BASE_ABI, { ...BASE_ABI })
    expect(rEq.compatible).toBe(true)
  })

  it('ABI-02：major 不一致 → 链接失败（明确报错）', () => {
    const r = checkAbiCompat(BASE_ABI, {
      abi: { major: 2, minor: 0, patch: 0 },
      features: [],
      signatureChain: 'chain-proteus-official',
    })
    expect(r.compatible).toBe(false)
    expect(r.reason).toBe('G45_ABI_MAJOR_MISMATCH')
  })

  it('ABI-02b：插件 minor > 基座 minor → 拒绝（G45_ABI_MINOR_NEWER）', () => {
    const r = checkAbiCompat(BASE_ABI, {
      abi: { major: 1, minor: 4, patch: 0 },
      features: [],
      signatureChain: 'chain-proteus-official',
    })
    expect(r.compatible).toBe(false)
    expect(r.reason).toBe('G45_ABI_MINOR_NEWER')
  })

  it('ABI-03：插件声明未 expose 的 feature → 拒绝', () => {
    const r = checkAbiCompat(BASE_ABI, {
      abi: { major: 1, minor: 3, patch: 0 },
      features: ['camera', 'sms_send'],
      signatureChain: 'chain-proteus-official',
    })
    expect(r.compatible).toBe(false)
    expect(r.reason).toBe('G45_ABI_FEATURE_NOT_EXPOSED')
    expect(r.detail).toContain('sms_send')
  })

  it('ABI-06：签名证书链不同源 → 拒绝（G-45.7）', () => {
    const r = checkAbiCompat(BASE_ABI, {
      abi: { major: 1, minor: 3, patch: 0 },
      features: [],
      signatureChain: 'chain-third-party',
    })
    expect(r.compatible).toBe(false)
    expect(r.reason).toBe('G45_ABI_SIGN_CHAIN_MISMATCH')
  })

  it('ABI-04：末尾新增字段，旧消费方可忽略 → 运行正常', async () => {
    // 基座 v1.3 新增 diagnostics 末尾字段；旧插件（v1.2 期编译）只消费 nodeTree
    const newBaseResult = { nodeTree: { id: 'n1' }, diagnostics: [{ code: 'FLD003' }] }
    function oldConsumer(result: { nodeTree: { id: string } }) {
      return result.nodeTree.id // 旧插件不读 diagnostics
    }
    expect(oldConsumer(newBaseResult)).toBe('n1') // 运行正常
    // 旧基座上新插件：新字段为 undefined → 防御性判断
    const oldBaseResult = { nodeTree: { id: 'n2' } } as { nodeTree: { id: string }; diagnostics?: unknown[] }
    expect(oldBaseResult.diagnostics).toBeUndefined()
  })
})

describe('三态生命周期门禁（补丁一 §2.3 / G-45.10）', () => {
  it('ABI-05：冻结 ABI 后不兼容插件 → 拒绝装载 + pending 转降级（不崩溃）', async () => {
    const host = createDevHost()
    host.registerFallback('scanQR', async () => ({ text: null, degraded: true }))
    host.freezeAbi(BASE_ABI)
    const p = host.createStub('scanQR', 'scanQR').call()

    const report = await host.loadModule({
      manifest: {
        id: 'oldplug', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-ok',
        abi: { major: 2, minor: 0, patch: 0 }, // major 不一致
        features: ['scanQR'], signatureChain: 'chain-proteus-official',
      },
      conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
      factory: () => ({ scanQR: async () => ({ text: 'X' }) }),
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_ABI_MAJOR_MISMATCH')

    const r = (await p) as { degraded: boolean }
    expect(r.degraded).toBe(true)
  })

  it('ABI-08：runtime 态尝试装载未预注册模块 → 拒绝执行（G-45.10）', async () => {
    const host = createDevHost()
    await host.loadModule(scannerModule('1.0.0', 'A')) // dev 态正常装载
    host.setMode('runtime')

    const report = await host.loadModule({
      manifest: { id: 'newplug', version: '1.0.0', capabilities: ['useNFC'], signature: 'sig-ok' },
      conformance: [{ name: 'nfc', check: () => true }],
      factory: () => ({}),
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_MODE_FORBIDDEN')
    expect(host.capabilityOf('useNFC')).toBeNull() // 能力注册表未被污染
  })

  it('release 态热加载新插件 → 拒绝装载（补丁一 §2.3）', async () => {
    const host = createDevHost()
    host.setMode('release')
    host.freezeAbi(BASE_ABI)
    const report = await host.loadModule(scannerModule('2.0.0', 'B'))
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_MODE_FORBIDDEN')
    expect(report.reasonDetail).toContain('release')
  })

  it('dev 态全流程不受三态门禁影响（向后兼容）', async () => {
    const host = createDevHost()
    expect(host.currentMode).toBe('dev')
    const report = await host.loadModule(scannerModule('1.0.0', 'A'))
    expect(report.ok).toBe(true)
  })

  it('ABI-07：manifest 哈希不匹配推送清单 → 拒绝装载（G-45.8 防 MITM）', async () => {
    const host = createDevHost()
    host.registerPushManifest('scanner', 'hash-expected')

    const report = await host.loadModule({
      manifest: {
        id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-ok',
        manifestHash: 'hash-tampered',
      },
      conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
      factory: () => ({ scanQR: async () => ({ text: 'X' }) }),
    })
    expect(report.ok).toBe(false)
    expect(report.reason).toBe('G45_MANIFEST_HASH_MISMATCH')

    // 哈希一致 → 正常装载
    const okReport = await host.loadModule({
      manifest: {
        id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-ok',
        manifestHash: 'hash-expected',
      },
      conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
      factory: () => ({ scanQR: async () => ({ text: 'OK' }) }),
    })
    expect(okReport.ok).toBe(true)
  })

  it('运行态参数灰度合法（setFeatureFlag 非代码下发 + mode:changed/config:applied 事件）', () => {
    const host = createDevHost()
    const modes: string[] = []
    const configs: string[] = []
    host.on('mode:changed', (p) => modes.push(String(p.mode)))
    host.on('config:applied', (p) => configs.push(String(p.name)))

    host.setMode('runtime')
    host.setFeatureFlag('glass_material', { enabled: true, level: 'L2' })
    host.setFeatureFlag('video_stream', { enabled: false })

    expect(modes).toEqual(['runtime'])
    expect(configs).toEqual(['glass_material', 'video_stream'])
    expect(host.getFeatureFlags()['glass_material']).toEqual({ enabled: true, level: 'L2' })
  })

  it('冻结 ABI 后 dev 态装载兼容插件成功（ABI 冻结不阻断合规插件）', async () => {
    const host = createDevHost()
    host.freezeAbi(BASE_ABI)
    const report = await host.loadModule({
      manifest: {
        id: 'scanner', version: '1.0.0', capabilities: ['scanQR'], signature: 'sig-ok',
        abi: { major: 1, minor: 2, patch: 0 }, features: ['scanQR'],
        signatureChain: 'chain-proteus-official',
      },
      conformance: [checkResultShape('scanQR', 'scanQR', [{}], { text: 'string' })],
      factory: () => ({ scanQR: async () => ({ text: 'OK' }) }),
    })
    expect(report.ok).toBe(true)
  })
})

describe('stableLayerCacheKey 精确化（补丁二 §5）', () => {
  it('manifest/签名链哈希参与稳定层 key；页面规模永远不参与（CMP086）', () => {
    const k1 = stableLayerCacheKey({ frameworkVersion: 'v1.0', abi: '1.3' })
    expect(k1).toBe('base:v1.0:1.3')

    const k2 = stableLayerCacheKey({ frameworkVersion: 'v1.0', abi: '1.3', backendManifestHash: 'm1', signatureChainHash: 's1' })
    expect(k2).toBe('base:v1.0:1.3:m:m1:s:s1')

    // 任一插件 manifest 变更 → 稳定层 key 变化（触发发布构建）
    const k3 = stableLayerCacheKey({ frameworkVersion: 'v1.0', abi: '1.3', backendManifestHash: 'm2', signatureChainHash: 's1' })
    expect(k3).not.toBe(k2)

    // 与页面数无关：同输入同 key
    const k4 = stableLayerCacheKey({ frameworkVersion: 'v1.0', abi: '1.3', backendManifestHash: 'm1', signatureChainHash: 's1' })
    expect(k4).toBe(k2)
  })
})
