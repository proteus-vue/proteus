/**
 * G-45 B3 —— 推送协议层（03-spi.md §4 冻结语义的落地）
 *
 * 信封流（transport 无关——in-memory / HTTP / WS 适配器均可承载）：
 *   设备 → server : { type: 'hello', deviceId, token }            // 握手 + token 门禁
 *   server → 设备 : { type: 'hello-ack', ok, error? }             // G45_AUTH 拒绝
 *   server → 设备 : { type: 'module-push', manifest, conformance, bundle, ...hashes }
 *   设备 → server : { type: 'load-report', ...LoadReport }        // 秒级回传
 *
 * 完整性：manifestHash（canonical JSON 哈希，服务端计算、设备端复算）+
 *         bundleHash（源码包哈希）——任一不匹配即拒绝（G-45.8 防 MITM）。
 * 诚实边界：conformance 用例真实 transport 下以 Test IR（.tir.json）序列化传输（G-44）；
 *           TLS 由 transport 适配器/反向代理终结——协议层负责 token + 审计。
 */

import type {
  BackendManifest,
  ConformanceCase,
  LoadRejectReason,
} from './types'
import { fnv1a } from './build-planner'

/* ================= 信封类型 ================= */

/** server 侧设备句柄：transport 注册的发送回函（in-memory / HTTP / WS 各自实现） */
export interface DeviceConnection {
  deviceId: string
  send(env: ProtocolEnvelope): void
}

export interface HelloMessage {
  type: 'hello'
  deviceId: string
  token: string
}

export interface HelloAckMessage {
  type: 'hello-ack'
  ok: boolean
  error?: 'G45_AUTH'
}

export interface ModulePushMessage {
  type: 'module-push'
  manifest: BackendManifest
  /** 语义快检用例（真实 transport 以 Test IR 序列化传输——G-44） */
  conformance: ConformanceCase[]
  /** 插件源码包（真实 transport 为 ArrayBuffer/二进制） */
  bundle: string
  bundleHash: string
  manifestHash: string
  pushedAt: number
}

export type ProtocolReportReason =
  | LoadRejectReason
  | 'G45_BUNDLE_HASH_MISMATCH'
  | 'G45_MANIFEST_HASH_MISMATCH'
  | 'G45_LOADER_MISSING'
  | 'G45_TIMEOUT'
  | null

export interface LoadReportMessage {
  type: 'load-report'
  deviceId: string
  moduleId: string | null
  version: string | null
  ok: boolean
  reason: ProtocolReportReason
  conformance: { name: string; pass: boolean }[]
  replayed: number
}

export type ProtocolEnvelope =
  | HelloMessage
  | HelloAckMessage
  | ModulePushMessage
  | LoadReportMessage

/* ================= 完整性哈希 ================= */

/** canonical JSON：键递归排序——同 manifest 不同键序产出同一哈希 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

/**
 * manifest 哈希（G-45.8）：canonical JSON → FNV-1a。
 * manifestHash 字段自身从哈希输入剥离（设备端复算时携带该字段不产生分歧）。
 */
export function computeManifestHash(manifest: BackendManifest): string {
  const { manifestHash: _ignored, ...rest } = manifest as BackendManifest & {
    manifestHash?: string
  }
  return fnv1a(canonicalJson(rest))
}

/** bundle 哈希：源码包内容 → FNV-1a（真实 transport 为字节流哈希） */
export function computeBundleHash(bundle: string): string {
  return fnv1a(bundle)
}
