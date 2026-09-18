/**
 * G-45 B3 —— DeviceLink（设备侧协议链路）+ connectInMemory（in-memory transport）
 *
 * DeviceLink 处理来自 dev server 的信封：
 *   · hello-ack：记录鉴权结果
 *   · module-push：完整性复算（bundleHash/manifestHash，G-45.8 设备侧）→
 *     loader 装载代码（模拟 DexClassLoader/动态框架——真实代码装载在 B4）→
 *     host.loadModule（门禁链 + conformance 快检）→ 产生 load-report 回传
 *
 * connectInMemory：内存双工管道，把 DevServer 与 DeviceLink 接成闭环——
 *   推送→装载→回放→report 全链 e2e 的「模拟设备」通道（B3 DoD）。
 */

import type { DevHost } from './dev-host'
import type { NativeBackendLike } from './types'
import type {
  DeviceConnection,
  HelloAckMessage,
  LoadReportMessage,
  ModulePushMessage,
  ProtocolEnvelope,
  ProtocolReportReason,
} from './protocol'
import { computeBundleHash, computeManifestHash } from './protocol'
import type { DevServer } from './dev-server'

export interface DeviceLinkOptions {
  deviceId: string
  token: string
  /** 设备宿主（装载门禁链在此执行） */
  host: DevHost
  /**
   * 动态代码装载器（模拟 DexClassLoader / 动态框架装载）：
   * 收到 module-push 后按 manifest 装载原生实现并返回后端实例。
   * 返回 null 表示装载失败（G45_LOADER_MISSING）。
   */
  loader: (manifest: ModulePushMessage['manifest']) => NativeBackendLike | null
}

export class DeviceLink {
  readonly deviceId: string
  authOk = false
  private readonly opts: DeviceLinkOptions
  private reports: LoadReportMessage[] = []

  constructor(opts: DeviceLinkOptions) {
    this.opts = opts
    this.deviceId = opts.deviceId
  }

  getReportLog(): LoadReportMessage[] {
    return [...this.reports]
  }

  /** 处理来自 server 的信封；返回需回传 server 的信封（load-report） */
  async handleEnvelope(env: ProtocolEnvelope): Promise<ProtocolEnvelope[]> {
    if (env.type === 'hello-ack') {
      this.authOk = env.ok
      return []
    }
    if (env.type === 'module-push') {
      return [await this.processPush(env)]
    }
    return []
  }

  private async processPush(env: ModulePushMessage): Promise<LoadReportMessage> {
    const base = {
      type: 'load-report' as const,
      deviceId: this.deviceId,
      moduleId: env.manifest.id,
      version: env.manifest.version,
    }

    // 完整性复算（G-45.8 设备侧）：哈希与信封声明不一致 → 拒绝（不进入装载）
    if (computeBundleHash(env.bundle) !== env.bundleHash) {
      return this.record({ ...base, ok: false, reason: 'G45_BUNDLE_HASH_MISMATCH', conformance: [], replayed: 0 })
    }
    if (computeManifestHash(env.manifest) !== env.manifestHash) {
      return this.record({ ...base, ok: false, reason: 'G45_MANIFEST_HASH_MISMATCH', conformance: [], replayed: 0 })
    }

    // 动态代码装载（loader 模拟原生容器：DexClassLoader / 动态框架 / HSP）
    const backend = this.opts.loader(env.manifest)
    if (!backend) {
      return this.record({ ...base, ok: false, reason: 'G45_LOADER_MISSING', conformance: [], replayed: 0 })
    }

    // 装载门禁链（签名/conformance 快检/覆盖率/三态——host 内执行）
    const report = await this.opts.host.loadModule({
      manifest: env.manifest,
      conformance: env.conformance,
      factory: () => backend,
    })
    return this.record({
      ...base,
      ok: report.ok,
      reason: report.reason as ProtocolReportReason,
      conformance: report.conformance,
      replayed: report.replayed,
    })
  }

  private record(report: LoadReportMessage): LoadReportMessage {
    this.reports.push(report)
    return report
  }
}

export interface InMemoryLinkOptions extends DeviceLinkOptions {
  /** MITM 模拟钩子（测试篡改在途信封——验证 G-45.8 完整性校验） */
  mitm?: (env: ProtocolEnvelope, direction: 'server-to-device' | 'device-to-server') => ProtocolEnvelope
}

export interface InMemoryLink {
  link: DeviceLink
  connection: DeviceConnection
  /** 握手结果（hello-ack） */
  helloAck: Promise<HelloAckMessage>
}

/**
 * 把 DeviceLink 与 DevServer 接成内存双工闭环：
 *   link(设备) ←→ connection(server 侧设备句柄)
 * 连接即握手（hello → hello-ack）。
 */
export function connectInMemory(server: DevServer, opts: InMemoryLinkOptions): InMemoryLink {
  const link = new DeviceLink(opts)
  let ackResolve!: (ack: HelloAckMessage) => void
  const helloAck = new Promise<HelloAckMessage>((resolve) => {
    ackResolve = resolve
  })

  const sendToServer = (env: ProtocolEnvelope) => {
    const e = opts.mitm ? opts.mitm(env, 'device-to-server') : env
    server.handleEnvelope(connection, e)
  }

  const connection: DeviceConnection = {
    deviceId: opts.deviceId,
    send: (env) => {
      const e = opts.mitm ? opts.mitm(env, 'server-to-device') : env
      if (e.type === 'hello-ack') {
        ackResolve(e)
        return
      }
      // 设备异步处理 server 信封；产生的 load-report 回传 server
      void link.handleEnvelope(e).then((out) => {
        for (const resp of out) sendToServer(resp)
      })
    },
  }

  // 连接即握手
  sendToServer({ type: 'hello', deviceId: opts.deviceId, token: opts.token })
  return { link, connection, helloAck }
}
