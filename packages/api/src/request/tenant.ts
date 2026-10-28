// packages/api/src/request/tenant.ts
// ★★★#1342 请求库的**多业务隔离层**：bizId · 域名白名单 · 每业务并发配额 · 调用审计。
//
// 【为什么这是本库与主流库最根本的分野】
//   axios/SWR/ofetch 都假设"一个 App 一个团队"。而超级应用是**几十个团队共用一个进程**：
//   平台方必须能回答三个问题，应答不上就过不了合规评审：
//     ① 这个业务**能访问哪些域**（域名白名单）
//     ② 这个业务**占了多少并发/流量**（配额 —— 现在额度按 hooks 实例计，10 页 = 100 并发）
//     ③ 出事时**谁访问了什么**（调用审计）
//   ⇒ 本文件把 bizId 做成贯穿这三件事的一等轴。
//
// 【诚实边界】
//   · 白名单是**前缀通配**（`*.example.com`），不是正则——避免白名单被写成任意匹配而失去意义。
//   · 配额是**进程内**的（单实例）。跨进程共享需要宿主支持（未做，如实登记）。
//   · 审计**已脱敏**：只记 host 不记完整 path（path 里常带用户 id/订单号），不记 body。
//     需要更细的可追溯性时，业务应自己打点（本库不替你承担 PII 责任）。

import type { RequestAuditEntry, RequestOutcome, TenantPolicy } from './types'

/* ══════════════════════ ① 域名白名单 ══════════════════════ */

/**
 * 把一条白名单模式归一化。
 * 支持：`api.example.com`（精确）· `*.example.com`（任意一级子域）· `*`（全放行，仅平台内部）。
 * ★不支持正则/路径匹配：白名单一旦能表达复杂规则，就容易被写成"看起来受限、实际全通"。
 */
function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

/** 从 URL 里取 host（★不依赖 `URL` 构造器——App 精简引擎没有它，见 #1336 的实测） */
export function hostOf(rawUrl: string): string {
  const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(rawUrl)
  if (!m) return ''
  let host = m[1]
  const at = host.lastIndexOf('@')
  if (at >= 0) host = host.slice(at + 1)
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    return close > 0 ? host.slice(0, close + 1).toLowerCase() : host.toLowerCase()
  }
  const colon = host.indexOf(':')
  if (colon >= 0) host = host.slice(0, colon)
  return host.toLowerCase()
}

/**
 * 判断 host 是否命中白名单。
 * @param allow 为 `undefined`/空数组 ⇒ **不限制**（返回 true）。白名单是可选增强，不配就不拦
 *              （否则现有业务全部会被拦死）。
 */
export function isHostAllowed(rawUrl: string, allow?: string[]): boolean {
  if (!allow || allow.length === 0) return true
  const host = hostOf(rawUrl)
  if (host.length === 0) return false // 相对 URL 且没 baseURL ⇒ 无法判定 ⇒ 拒（保守）
  for (const raw of allow) {
    const p = normalizePattern(raw)
    if (p === '*') return true
    if (p.startsWith('*.')) {
      const suffix = p.slice(1) // `.example.com`
      // ★只允许"任意一级"：`a.example.com` ✓；`a.b.example.com` ✗（需显式再配一条）
      const rest = host.endsWith(suffix) ? host.slice(0, host.length - suffix.length) : ''
      if (rest.length > 0 && !rest.includes('.')) return true
      continue
    }
    if (host === p) return true
  }
  return false
}

/* ══════════════════════ ② 每业务并发配额 ══════════════════════ */

/**
 * 一个信号的并发闸门。
 *
 * 【为什么本库自己再做一层闸门】
 *   pipeline 的并发上限在 `CapabilityHooks` 实例里，而超级应用里"每页一个 hooks"
 *   ⇒ 10 个页面 = 10 × 10 = 100 并发（实证见 `capability-fetch-pipeline.ts:319-321` 的注释）。
 *   平台方要的是"全局不超过 N、每业务不超过 M"，这必须在**所有实例之上**再有一层。
 *   ★叠加而非替代：pipeline 的额度仍生效（双重保护），本层负责跨实例的全局视图。
 */
export class ConcurrencyGate {
  private running = 0
  private readonly waiters: Array<() => void> = []
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit > 0 ? Math.floor(limit) : 0
  }

  /** 当前在飞数 */
  get inflight(): number {
    return this.running
  }

  /** 等待中的数量（诊断用） */
  get queued(): number {
    return this.waiters.length
  }

  /**
   * 取得一个槽位。返回释放函数。
   * ★`limit === 0` 表示不限（直接返回 noop 释放）。
   * ★释放必须幂等：重复调用不会把计数减成负数（否则额度会被"泄漏的释放"打穿）。
   */
  async acquire(signal?: { aborted?: boolean; onabort?: ((reason?: string) => void) | null }): Promise<() => void> {
    if (this.limit === 0) return () => {}
    if (this.running < this.limit) {
      this.running++
      return this.makeRelease()
    }
    // 排队等槽位；同时响应取消（★否则取消的请求会永久占着队列位置）
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const waiter = (): void => {
        if (settled) return
        settled = true
        if (signal) signal.onabort = null
        resolve()
      }
      this.waiters.push(waiter)
      if (signal) {
        signal.onabort = (reason?: string): void => {
          if (settled) return
          settled = true
          const i = this.waiters.indexOf(waiter)
          if (i >= 0) this.waiters.splice(i, 1)
          reject(new Error(reason ?? 'aborted'))
        }
      }
    })
    this.running++
    return this.makeRelease()
  }

  private makeRelease(): () => void {
    let released = false
    return (): void => {
      if (released) return
      released = true
      this.running = Math.max(0, this.running - 1)
      const next = this.waiters.shift()
      if (next) next()
    }
  }
}

/* ══════════════════════ ③ 审计 ══════════════════════ */

/** 审计条目构造（★默认只记 host，不记完整路径——路径里常含 PII） */
export function makeAuditEntry(input: {
  id: string
  bizId: string
  url: string
  method: string
  outcome: RequestOutcome
  status?: number
  durationMs: number
  attempts: number
  errorCode?: string
  cacheHit?: boolean
  now?: number
}): RequestAuditEntry {
  return {
    id: input.id,
    bizId: input.bizId,
    url: redactAuditUrl(input.url),
    host: hostOf(input.url),
    method: input.method.toUpperCase(),
    outcome: input.outcome,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    attempts: input.attempts,
    errorCode: input.errorCode,
    cacheHit: input.cacheHit,
    at: input.now ?? Date.now(),
  }
}

/**
 * 审计用的 URL：**只保留 origin + 前两段 path**，去掉 query 与其余 path。
 *   `/v1/order/123456/pay?token=x` ⇒ `/v1/order/<redacted>`
 * 理由：完整 path 会泄漏订单号/用户 id；完全不记又无法定位是哪个接口。
 */
export function redactAuditUrl(rawUrl: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/.exec(rawUrl)
  if (!m) return '<relative>'
  const origin = m[1]
  const segs = m[2].split('/').filter((s) => s.length > 0)
  if (segs.length === 0) return origin + '/'
  const keep = segs.slice(0, 2)
  const rest = segs.length > 2 ? '/<redacted>' : ''
  return `${origin}/${keep.join('/')}${rest}`
}

/* ══════════════════════ ④ 租户上下文 ══════════════════════ */

export interface TenantContext {
  bizId: string
  /** 该业务的并发闸门（未配 `concurrency` 时为 undefined ⇒ 不额外限制） */
  gate?: ConcurrencyGate
  /** 检查域名；返回 `{ allowed, host }` */
  checkHost: (url: string) => { allowed: boolean; host: string }
  /** 审计（未配 `onAudit` 时为 noop） */
  audit: (entry: RequestAuditEntry) => void
}

/** 由 `TenantPolicy` 建一个租户上下文（`bizId` 为空 ⇒ undefined） */
export function createTenantContext(policy?: TenantPolicy): TenantContext | undefined {
  if (!policy || policy.bizId.length === 0) return undefined
  const allow = policy.allowedDomains
  return {
    bizId: policy.bizId,
    gate: policy.concurrency !== undefined ? new ConcurrencyGate(policy.concurrency) : undefined,
    checkHost: (url: string) => ({ allowed: isHostAllowed(url, allow), host: hostOf(url) }),
    audit: (entry) => {
      // ★审计是**旁路**：回调抛错绝不能阻断/影响业务请求。
      //   （实测踩过：此处原先直接调用，业务侧 audit sink 挂了会让整个请求抛错。）
      try {
        policy.onAudit?.(entry)
      } catch {
        /* 审计失败 ⇒ 静默（不阻断业务） */
      }
    },
  }
}

/* ══════════════════════ ⑤ 全局额度树 ══════════════════════ */

/**
 * ★痛点 #18 的答案：额度树 `全局 → 业务 → host`。
 *
 * 【为什么是树而不是单一计数器】
 *   单一全局上限无法回答"哪个业务占满了"；单一 per-host 上限又管不住"一个业务打 100 个域"。
 *   三级各有独立上限，任一超限**只影响自己**（业务 A 打满不阻塞业务 B）。
 *   ★这是"隔离"的技术含义：不是"给每个业务一个数字"，而是"一个业务失控时别人不受影响"。
 */
export class QuotaTree {
  readonly global: ConcurrencyGate
  private readonly perTenant = new Map<string, ConcurrencyGate>()
  private readonly perHost = new Map<string, ConcurrencyGate>()
  private readonly hostLimit: number

  constructor(globalLimit: number, hostLimit = 0) {
    this.global = new ConcurrencyGate(globalLimit)
    this.hostLimit = hostLimit
  }

  /** 取（或建）某业务的闸门 */
  tenantGate(bizId: string, limit: number): ConcurrencyGate {
    let g = this.perTenant.get(bizId)
    if (!g) {
      g = new ConcurrencyGate(limit)
      this.perTenant.set(bizId, g)
    }
    return g
  }

  /** 取（或建）某 host 的闸门（`hostLimit === 0` ⇒ 不限，返回 noop gate） */
  hostGate(host: string): ConcurrencyGate {
    if (this.hostLimit === 0) return NOOP_GATE
    let g = this.perHost.get(host)
    if (!g) {
      g = new ConcurrencyGate(this.hostLimit)
      this.perHost.set(host, g)
    }
    return g
  }

  snapshot(): { global: number; tenants: number; hosts: number } {
    return { global: this.global.inflight, tenants: this.perTenant.size, hosts: this.perHost.size }
  }
}

/** 不限的闸门（避免到处判空） */
const NOOP_GATE = new ConcurrencyGate(0)
