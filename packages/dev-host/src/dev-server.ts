/**
 * G-45 B3 —— DevServer（dev server 核心，transport 无关）
 *
 * 职责（03-spi.md §4 + batches B3）：
 *   · token 门禁：握手 token 不匹配 → hello-ack G45_AUTH 拒绝 + 审计（CMP088）
 *   · 设备注册表：listDevices 可查询
 *   · pushModule：server 侧前置校验（manifest/签名/manifestHash，CMP084）→
 *     路由到设备 → 等待 LoadReport 回传（G45_TIMEOUT 超时兜底）
 *   · 签名审计：hello/push/report 全链审计日志（CLI host logs 数据源）
 */

import type {
  BackendManifest,
  ConformanceCase,
} from './types'
import type {
  DeviceConnection,
  LoadReportMessage,
  ModulePushMessage,
  ProtocolEnvelope,
  ProtocolReportReason,
} from './protocol'
import { computeBundleHash, computeManifestHash } from './protocol'

export interface DevServerOptions {
  token: string
  /** LoadReport 回传超时（ms，默认 5000） */
  reportTimeoutMs?: number
}

export interface AuditEntry {
  at: number
  kind: 'hello' | 'hello-rejected' | 'push' | 'push-rejected' | 'report'
  deviceId?: string
  moduleId?: string
  version?: string
  manifestHash?: string
  bundleHash?: string
  ok?: boolean
  reason?: string | null
}

export type PushStage = 'server-validate' | 'routing' | 'device'

export interface PushOutcome {
  ok: boolean
  stage: PushStage
  error?:
    | 'G45_AUTH'
    | 'G45_MANIFEST_INCOMPLETE'
    | 'G45_SIGN'
    | 'G45_MANIFEST_HASH_MISMATCH'
    | 'G45_NO_DEVICE'
    | 'G45_TIMEOUT'
    | null
  report?: LoadReportMessage
  deviceId?: string
}

/** push 输入：manifest + conformance 用例（代码经 loader 在设备侧装载——server 不碰代码） */
export interface PushInput {
  manifest: BackendManifest
  conformance: ConformanceCase[]
}

export class DevServer {
  private readonly token: string
  private readonly reportTimeoutMs: number
  private connections = new Map<string, DeviceConnection>()
  private audit: AuditEntry[] = []
  private waiters = new Map<string, (r: LoadReportMessage) => void>()

  constructor(opts: DevServerOptions) {
    this.token = opts.token
    this.reportTimeoutMs = opts.reportTimeoutMs ?? 5000
  }

  /** transport 接入点：处理来自设备的信封（hello / load-report） */
  handleEnvelope(conn: DeviceConnection, env: ProtocolEnvelope): void {
    if (env.type === 'hello') {
      if (env.token !== this.token) {
        this.audit.push({
          at: Date.now(),
          kind: 'hello-rejected',
          deviceId: env.deviceId,
          reason: 'G45_AUTH',
        })
        conn.send({ type: 'hello-ack', ok: false, error: 'G45_AUTH' })
        return
      }
      this.connections.set(env.deviceId, conn)
      this.audit.push({ at: Date.now(), kind: 'hello', deviceId: env.deviceId, ok: true })
      conn.send({ type: 'hello-ack', ok: true })
      return
    }
    if (env.type === 'load-report') {
      this.audit.push({
        at: Date.now(),
        kind: 'report',
        deviceId: env.deviceId,
        moduleId: env.moduleId ?? undefined,
        version: env.version ?? undefined,
        ok: env.ok,
        reason: env.reason,
      })
      const waiter = this.waiters.get(env.deviceId)
      if (waiter) {
        this.waiters.delete(env.deviceId)
        waiter(env)
      }
      return
    }
    // 设备发来的 module-push 非法（方向错误）——忽略并审计
    this.audit.push({ at: Date.now(), kind: 'push-rejected', deviceId: conn.deviceId, reason: 'G45_WRONG_DIRECTION' })
  }

  /**
   * 推送插件模块到设备并等待 LoadReport 回传。
   * server 侧前置校验（CMP084）：manifest 完整性 / 签名格式 / manifestHash 一致。
   */
  async pushModule(push: PushInput, bundle: string, targetDeviceId?: string): Promise<PushOutcome> {
    const m = push.manifest

    // server 侧前置校验（与设备侧门禁同源，尽早拦截）
    if (!m || !m.id || !m.version || !Array.isArray(m.capabilities) || m.capabilities.length === 0) {
      return { ok: false, stage: 'server-validate', error: 'G45_MANIFEST_INCOMPLETE' }
    }
    if (typeof m.signature !== 'string' || !/^sig-[a-z0-9]+$/.test(m.signature)) {
      return { ok: false, stage: 'server-validate', error: 'G45_SIGN' }
    }
    const manifestHash = computeManifestHash(m)
    if (m.manifestHash !== undefined && m.manifestHash !== manifestHash) {
      return { ok: false, stage: 'server-validate', error: 'G45_MANIFEST_HASH_MISMATCH' }
    }

    // 路由：指定设备或首个已连接设备
    const deviceId = targetDeviceId ?? (this.connections.size > 0 ? [...this.connections.keys()][0] : null)
    if (!deviceId || !this.connections.has(deviceId)) {
      return { ok: false, stage: 'routing', error: 'G45_NO_DEVICE' }
    }

    const bundleHash = computeBundleHash(bundle)
    const env: ModulePushMessage = {
      type: 'module-push',
      manifest: { ...m, manifestHash },
      conformance: push.conformance,
      bundle,
      bundleHash,
      manifestHash,
      pushedAt: Date.now(),
    }
    this.audit.push({
      at: Date.now(),
      kind: 'push',
      deviceId,
      moduleId: m.id,
      version: m.version,
      manifestHash,
      bundleHash,
    })

    // 发送 + 等待 LoadReport（超时兜底 G45_TIMEOUT）
    const conn = this.connections.get(deviceId) as DeviceConnection
    const report = await new Promise<LoadReportMessage>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          type: 'load-report',
          deviceId,
          moduleId: m.id,
          version: m.version,
          ok: false,
          reason: 'G45_TIMEOUT',
          conformance: [],
          replayed: 0,
        })
      }, this.reportTimeoutMs)
      this.waiters.set(deviceId, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      conn.send(env)
    })

    return {
      ok: report.ok,
      stage: 'device',
      error: report.ok ? null : report.reason === 'G45_TIMEOUT' ? 'G45_TIMEOUT' : undefined,
      report,
      deviceId,
    }
  }

  listDevices(): string[] {
    return [...this.connections.keys()]
  }

  hasDevice(deviceId: string): boolean {
    return this.connections.has(deviceId)
  }

  getAuditLog(): AuditEntry[] {
    return [...this.audit]
  }
}

export function createDevServer(opts: DevServerOptions): DevServer {
  return new DevServer(opts)
}

export type {
  ProtocolReportReason,
  ProtocolEnvelope,
  DeviceConnection,
} from './protocol'
