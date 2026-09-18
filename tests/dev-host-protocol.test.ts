/**
 * G-45 B3 —— 推送协议 + DevServer + DeviceLink + CLI host push 测试
 * 对齐 proteus-dev-host-plan 03-spi.md §4 + batches B3 DoD（推送→装载→回放全链 e2e 模拟设备）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createDevHost,
  createDevServer,
  connectInMemory,
  canonicalJson,
  computeManifestHash,
  computeBundleHash,
  checkResultShape,
} from '@proteus-vue/dev-host'
import { parseHostArgs, validateModuleDir, formatHostPushReport, runHostPush } from '../packages/cli/src/host'

const SCANNER_MANIFEST = {
  id: 'scanner',
  version: '1.0.0',
  capabilities: ['scanQR'],
  signature: 'sig-abc123',
}
const SCANNER_CONFORMANCE = [checkResultShape('scanQR', 'scanQR', [{ format: 'qr' }], { text: 'string' })]
const SCANNER_BUNDLE = 'export function scanQR() { /* native impl */ }'
const SCANNER_LOADER = () => ({ scanQR: async () => ({ text: 'CODE-123' }) })

describe('canonical 哈希（G-45.8 完整性基础）', () => {
  it('canonicalJson：键序无关 + 递归 + 数组保序', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [1, 2] })).toBe(canonicalJson({ a: [1, 2], b: { c: 2, d: 1 } }))
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
    expect(canonicalJson('x')).toBe('"x"')
    expect(canonicalJson(null)).toBe('null')
  })

  it('computeManifestHash：manifestHash 字段剥离后计算（设备端复算不产生分歧）', () => {
    const h1 = computeManifestHash(SCANNER_MANIFEST)
    const h2 = computeManifestHash({ ...SCANNER_MANIFEST, manifestHash: 'whatever' })
    expect(h1).toBe(h2)
    // 能力变化 → 哈希变化
    const h3 = computeManifestHash({ ...SCANNER_MANIFEST, capabilities: ['scanQR', 'stopScan'] })
    expect(h3).not.toBe(h1)
  })

  it('computeBundleHash：内容敏感', () => {
    expect(computeBundleHash('abc')).toBe(computeBundleHash('abc'))
    expect(computeBundleHash('abc')).not.toBe(computeBundleHash('abd'))
  })
})

describe('DevServer：token 门禁 + 设备注册表（CMP088）', () => {
  it('错误 token → hello-ack G45_AUTH + 审计 hello-rejected + 设备不注册', async () => {
    const server = createDevServer({ token: 'secret' })
    const { helloAck } = connectInMemory(server, {
      deviceId: 'dev-1',
      token: 'wrong-token',
      host: createDevHost(),
      loader: SCANNER_LOADER,
    })
    const ack = await helloAck
    expect(ack.ok).toBe(false)
    expect(ack.error).toBe('G45_AUTH')
    expect(server.listDevices()).toEqual([])
    const rejected = server.getAuditLog().filter((a) => a.kind === 'hello-rejected')
    expect(rejected.length).toBe(1)
    expect(rejected[0].reason).toBe('G45_AUTH')
  })

  it('正确 token → 注册设备 + 审计 hello', async () => {
    const server = createDevServer({ token: 'secret' })
    const { helloAck } = connectInMemory(server, {
      deviceId: 'dev-1',
      token: 'secret',
      host: createDevHost(),
      loader: SCANNER_LOADER,
    })
    expect((await helloAck).ok).toBe(true)
    expect(server.listDevices()).toEqual(['dev-1'])
    expect(server.getAuditLog().some((a) => a.kind === 'hello' && a.deviceId === 'dev-1')).toBe(true)
  })
})

describe('pushModule：server 侧前置校验 + 路由（CMP084）', () => {
  it('无设备连接 → G45_NO_DEVICE', async () => {
    const server = createDevServer({ token: 't' })
    const outcome = await server.pushModule(
      { manifest: SCANNER_MANIFEST, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.stage).toBe('routing')
    expect(outcome.error).toBe('G45_NO_DEVICE')
  })

  it('manifest 不完整 → server-validate G45_MANIFEST_INCOMPLETE（设备未收包）', async () => {
    const server = createDevServer({ token: 't' })
    const outcome = await server.pushModule(
      { manifest: { id: '', version: '1.0.0', capabilities: [], signature: 'sig-ok' }, conformance: [] },
      'code'
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.stage).toBe('server-validate')
    expect(outcome.error).toBe('G45_MANIFEST_INCOMPLETE')
  })

  it('坏签名 → server-validate G45_SIGN', async () => {
    const server = createDevServer({ token: 't' })
    const outcome = await server.pushModule(
      { manifest: { ...SCANNER_MANIFEST, signature: 'hacked' }, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE
    )
    expect(outcome.error).toBe('G45_SIGN')
    expect(outcome.stage).toBe('server-validate')
  })

  it('manifestHash 预检不一致 → server-validate G45_MANIFEST_HASH_MISMATCH（G-45.8 server 侧）', async () => {
    const server = createDevServer({ token: 't' })
    const outcome = await server.pushModule(
      { manifest: { ...SCANNER_MANIFEST, manifestHash: 'stale-hash' }, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE
    )
    expect(outcome.error).toBe('G45_MANIFEST_HASH_MISMATCH')
    expect(outcome.stage).toBe('server-validate')
  })
})

describe('全链 e2e：推送 → 装载 → 回放 → LoadReport 回传（B3 DoD 模拟设备）', () => {
  it('成功链路：pending 调用 → push → 装载即验证 → 回放 → report ok replayed=1', async () => {
    const host = createDevHost()
    const server = createDevServer({ token: 't' })
    const { helloAck } = connectInMemory(server, {
      deviceId: 'phone-1',
      token: 't',
      host,
      loader: SCANNER_LOADER,
    })
    await helloAck

    // 业务先调用（后端未装载 → pending）
    const stub = host.createStub('scanQR', 'scanQR')
    const pending = stub.call({ format: 'qr' })
    expect(host.getMetrics().pendingNow).toBe(1)

    // dev server push → 设备装载 → 回放 → report 回传
    const outcome = await server.pushModule(
      { manifest: SCANNER_MANIFEST, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE,
      'phone-1'
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.stage).toBe('device')
    expect(outcome.report?.replayed).toBe(1)
    expect(outcome.deviceId).toBe('phone-1')

    // 业务拿到结果（pending 被回放）
    expect(await pending).toEqual({ text: 'CODE-123' })
    expect(host.getMetrics().replayedTotal).toBe(1)
    expect(host.capabilityOf('scanQR')).toMatchObject({ id: 'scanner', source: 'dynamic' })

    // 审计链完整：hello → push → report
    const kinds = server.getAuditLog().map((a) => a.kind)
    expect(kinds).toEqual(['hello', 'push', 'report'])
    const pushEntry = server.getAuditLog().find((a) => a.kind === 'push')
    expect(pushEntry?.manifestHash).toBe(computeManifestHash(SCANNER_MANIFEST))
    expect(pushEntry?.bundleHash).toBe(computeBundleHash(SCANNER_BUNDLE))
  })

  it('失败链路：conformance FAIL → report 带原因 → 审计记录', async () => {
    const host = createDevHost()
    const server = createDevServer({ token: 't' })
    connectInMemory(server, {
      deviceId: 'dev-1',
      token: 't',
      host,
      loader: () => ({ takePhoto: async () => ({ code: 7 }) }), // shape 错误
    })

    const outcome = await server.pushModule(
      {
        manifest: { id: 'badcam', version: '1.0.0', capabilities: ['takePhoto'], signature: 'sig-ok' },
        conformance: [checkResultShape('takePhoto', 'takePhoto', [], { path: 'string' })],
      },
      'code'
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.report?.reason).toBe('G45_CONFORMANCE_FAIL')
    expect(host.capabilityOf('takePhoto')).toBeNull()

    const reportEntry = server.getAuditLog().find((a) => a.kind === 'report')
    expect(reportEntry?.ok).toBe(false)
    expect(reportEntry?.reason).toBe('G45_CONFORMANCE_FAIL')
  })

  it('MITM 篡改 bundle → 设备完整性复算拒绝（G45_BUNDLE_HASH_MISMATCH，G-45.8）', async () => {
    const host = createDevHost()
    const server = createDevServer({ token: 't' })
    connectInMemory(server, {
      deviceId: 'dev-1',
      token: 't',
      host,
      loader: SCANNER_LOADER,
      mitm: (env, direction) => {
        if (direction === 'server-to-device' && env.type === 'module-push') {
          return { ...env, bundle: env.bundle + '\n// injected by attacker' }
        }
        return env
      },
    })

    const outcome = await server.pushModule(
      { manifest: SCANNER_MANIFEST, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.report?.reason).toBe('G45_BUNDLE_HASH_MISMATCH')
    expect(host.capabilityOf('scanQR')).toBeNull() // 被篡改的包从未进入装载
  })

  it('MITM 篡改 manifest → manifestHash 复算不一致拒绝', async () => {
    const host = createDevHost()
    const server = createDevServer({ token: 't' })
    connectInMemory(server, {
      deviceId: 'dev-1',
      token: 't',
      host,
      loader: SCANNER_LOADER,
      mitm: (env, direction) => {
        if (direction === 'server-to-device' && env.type === 'module-push') {
          return { ...env, manifest: { ...env.manifest, version: '9.9.9' } }
        }
        return env
      },
    })

    const outcome = await server.pushModule(
      { manifest: SCANNER_MANIFEST, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.report?.reason).toBe('G45_MANIFEST_HASH_MISMATCH')
  })

  it('设备无响应 → G45_TIMEOUT 超时兜底', async () => {
    const server = createDevServer({ token: 't', reportTimeoutMs: 30 })
    // 静默设备：握手但不处理 push（吞掉信封）
    server.handleEnvelope({ deviceId: 'mute-1', send: () => undefined }, {
      type: 'hello',
      deviceId: 'mute-1',
      token: 't',
    })
    expect(server.hasDevice('mute-1')).toBe(true)

    const outcome = await server.pushModule(
      { manifest: SCANNER_MANIFEST, conformance: SCANNER_CONFORMANCE },
      SCANNER_BUNDLE,
      'mute-1'
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('G45_TIMEOUT')
  })
})

/* ================= CLI：proteus host push ================= */

function writeModuleDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-plugin-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

const VALID_PLUGIN_JSON = JSON.stringify({
  id: 'scanner',
  version: '1.0.0',
  capabilities: ['scanQR'],
  signature: 'sig-abc123',
})

describe('CLI：proteus host push（模块前置校验 + push 信封生成）', () => {
  it('parseHostArgs：push 解析 / 缺目录报错 / devices+logs 提示 B4 / 未知子命令报错', () => {
    expect(parseHostArgs(['push', './my-plugin'])).toEqual({ sub: 'push', moduleDir: './my-plugin' })
    expect(() => parseHostArgs(['push'])).toThrow(/需要 <module-dir>/)
    expect(() => parseHostArgs(['devices'])).toThrow(/B4 transport/)
    expect(() => parseHostArgs(['logs'])).toThrow(/B4 transport/)
    expect(() => parseHostArgs(['what'])).toThrow(/未知的 host 子命令/)
  })

  it('validateModuleDir：合规目录 → PASS + 双哈希 + 覆盖率统计', () => {
    const dir = writeModuleDir({
      'proteus.plugin.json': VALID_PLUGIN_JSON,
      'conformance/scanQR.tir.json': '{"type":"eq"}',
      'src/index.ts': 'export const scanner = 1',
      'src/native.ts': 'export const native = 2',
    })
    const v = validateModuleDir(dir)
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
    expect(v.manifestHash).toBe(computeManifestHash(JSON.parse(VALID_PLUGIN_JSON)))
    expect(v.bundleHash).toBe(computeBundleHash('\n// ---- src/index.ts ----\nexport const scanner = 1\n// ---- src/native.ts ----\nexport const native = 2'))
    expect(v.conformanceFiles.length).toBe(1)
    expect(v.bundleFiles).toBe(2)

    const lines = formatHostPushReport(v)
    expect(lines.some((l) => l.includes('✅ PASS'))).toBe(true)
    expect(lines.some((l) => l.includes('"type":"module-push"'))).toBe(true) // push 信封
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('validateModuleDir：缺 manifest / 坏签名 / 覆盖率不足 逐项拒绝', () => {
    // 缺 proteus.plugin.json
    const d1 = writeModuleDir({ 'src/index.ts': 'x' })
    const v1 = validateModuleDir(d1)
    expect(v1.ok).toBe(false)
    expect(v1.errors[0]?.code).toBe('G45_MANIFEST_MISSING')
    fs.rmSync(d1, { recursive: true, force: true })

    // 坏签名（CMP084）
    const d2 = writeModuleDir({
      'proteus.plugin.json': JSON.stringify({ ...JSON.parse(VALID_PLUGIN_JSON), signature: 'hacked' }),
      'conformance/scanQR.tir.json': '{}',
      'src/index.ts': 'x',
    })
    const v2 = validateModuleDir(d2)
    expect(v2.errors.map((e) => e.code)).toContain('G45_SIGN')
    fs.rmSync(d2, { recursive: true, force: true })

    // 覆盖率不足（CMP087：1 能力 0 用例）
    const d3 = writeModuleDir({
      'proteus.plugin.json': VALID_PLUGIN_JSON,
      'src/index.ts': 'x',
    })
    const v3 = validateModuleDir(d3)
    expect(v3.errors.map((e) => e.code)).toContain('G45_CONFORMANCE_COVERAGE')
    expect(formatHostPushReport(v3).some((l) => l.includes('❌ FAIL'))).toBe(true)
    fs.rmSync(d3, { recursive: true, force: true })
  })

  it('runHostPush：合规 → exit 0；违规 → exit 1（CI 阻断）', () => {
    const good = writeModuleDir({
      'proteus.plugin.json': VALID_PLUGIN_JSON,
      'conformance/scanQR.tir.json': '{}',
      'src/index.ts': 'x',
    })
    expect(runHostPush({ sub: 'push', moduleDir: good })).toBe(0)
    fs.rmSync(good, { recursive: true, force: true })

    const bad = writeModuleDir({ 'src/index.ts': 'x' })
    expect(runHostPush({ sub: 'push', moduleDir: bad })).toBe(1)
    fs.rmSync(bad, { recursive: true, force: true })
  })
})
