// hosts/shared/bridge/entry-superapp-probes-httpdns-prod.ts
// ★★★#1180：**iOS HTTPDNS 生产路径真机判据**——业务面 `useFetch({ httpDns })` 走本地代理。
////
// 【与 #1179 那条探针的区别（两者都要留）】
//   · `entry-superapp-probes-httpdns-b.ts`（#1179）：验证**传输通路**——宿主配了代理后
//     https 会不会走 `CONNECT` 隧道（表由**探针脚本**的固定映射提供，不走业务 API）。
//   · **本文件（#1180）**：验证**业务面**——`useFetch({ httpDns })` 传的表经线格式到宿主后，
//     由 `HttpDnsProxy` 真的按表解析。这是"iOS 端已支持 HTTPDNS"的**唯一**判据。
//
// 【判据（双向对照，与 Android #1171 同形）】
//   ① 注入**不可达 IP**（RFC 5737 TEST-NET-3 `203.0.113.1`）⇒ 请求**必须失败**
//      （表真的被采用；若表没生效，系统 DNS 会解析成功 ⇒ 请求成功 ⇒ 判据红）
//   ② 不注入（基线）⇒ 请求**必须成功**
//   ③ `http.dnsStats` 回执里 `tableHits > 0` 且 `lastSource == 'table'`
//      （★这是"表被采用"的**直接证据**，而不是"碰巧失败"）
//   ④ 表未命中的域名 ⇒ 回落系统解析且 `lastSource == 'system'`（**回落必须可见**）
//
// 【★顺序：注入侧先跑】
//   连接池优先于 DNS（HTTPDNS 固有语义）：先跑基线会让 `host:443` 的连接进池，
//   注入侧直接复用、**不查 DNS** ⇒ 表"看起来没生效"（#1169 首跑实测：
//   `lookups=1, tableHits=0, lastSource='system'`——两次请求只发生一次 DNS）。
export function appHttpDnsProdProbe(
  hitUrl: string,
  missUrl = '',
  unreachableIp = '203.0.113.1',
  /** ★★★#1183：该 host 的真实可达 IP（探针脚本侧解析后传入；空 = 跳过 hit 轮） */
  reachableIp = '',
): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { hitUrl, missUrl, unreachableIp }
  g['__proteusHostHttpDnsProdProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostHttpDnsProdProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  type Res = {
    ok?: boolean
    status?: number
    data?: unknown
    error?: { code?: string; message?: string }
    /** ★★★#1183：观测元数据（`meta.transport.dnsSource` 就在这里——业务可见的那个面） */
    meta?: { transport?: Record<string, unknown> }
  }
  type Hooks = { useFetch: <T>(u: string, c?: unknown) => Promise<Res> }

  /** 从 URL 里取主机名（表键必须与之一致——线格式按 host 精确匹配） */
  const hostOf = (u: string): string => {
    const m = /^https?:\/\/([^/:]+)/.exec(u)
    return (m?.[1] ?? '').toLowerCase()
  }

  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => Hooks
      getSharedCapabilityBridge: () => unknown
    }
    const bridge = cap.getSharedCapabilityBridge()
    const mk = (): Hooks => cap.createCapabilityHooks(bridge, {})
    progress('import:done')

    const host = hostOf(hitUrl)
    out['host'] = host
    const base = { responseType: 'text' as const, timeout: 15000 }

    // ── ① 注入侧**先跑**（池空 ⇒ 必然真的查一次 DNS）──
    let injectOk: boolean | undefined
    let injectStatus = -1
    let injectCode = ''
    let injectMsg = ''
    /** ★★★#1183：本次请求的传输读数（`meta.transport`，业务真正能看到的那个面） */
    let injectTransport: Record<string, unknown> | null = null
    try {
      const r = await mk().useFetch(hitUrl, { ...base, httpDns: { [host]: unreachableIp } })
      injectOk = r?.ok === true
      injectStatus = Number(r?.status ?? -1)
      injectCode = String(r?.error?.code ?? '')
      injectMsg = String(r?.error?.message ?? '').slice(0, 120)
      injectTransport = (r?.meta?.transport as Record<string, unknown>) ?? null
    } catch (e) {
      injectOk = false
      injectMsg = String((e as Error)?.message ?? e).slice(0, 120)
    }
    out['inject'] = { ok: injectOk, status: injectStatus, code: injectCode, message: injectMsg }
    out['inject_transport'] = injectTransport
    progress('inject:done', { ok: injectOk, dnsSource: injectTransport?.['dnsSource'] ?? null })

    // ── ①b ★★★#1183：**命中表且成功**的一轮（真实可达 IP 填表）──
    //   ★顺序：inject 之后、baseline 之前。理由与 Android 探针同（`reused:true` ⇒ 没解析
    //     ⇒ `dnsSource` 为空）；真机实测过"放 baseline 之后"与"放最前"两种错位。
    if (reachableIp) {
      try {
        const r = await mk().useFetch(`${hitUrl}?proteus-dns-hit=1`, {
          ...base,
          httpDns: { [host]: reachableIp },
        })
        const tp = (r?.meta?.transport as Record<string, unknown> | undefined) ?? null
        out['hit_ok'] = r?.ok === true
        out['hit_status'] = Number(r?.status ?? -1)
        out['hit_transport'] = tp
        out['hit_dns_source'] = tp ? String(tp['dnsSource'] ?? '') : ''
      } catch (e) {
        out['hit_error'] = String((e as Error)?.message ?? e).slice(0, 120)
      }
      progress('hit:done', { ok: out['hit_ok'] === true, src: out['hit_dns_source'] })
    }

    // ── ② 基线（不注入）：必须成功 ──
    let baseOk: boolean | undefined
    let baseStatus = -1
    let baseTransport: Record<string, unknown> | null = null
    try {
      const r = await mk().useFetch(hitUrl, { ...base, _noCache: Math.random() })
      baseOk = r?.ok === true
      baseStatus = Number(r?.status ?? -1)
      baseTransport = (r?.meta?.transport as Record<string, unknown>) ?? null
    } catch {
      baseOk = false
    }
    out['baseline'] = { ok: baseOk, status: baseStatus }
    out['baseline_transport'] = baseTransport
    progress('baseline:done', { ok: baseOk })

    // ── ③ 表未命中 ⇒ 回落系统解析（必须**可见**，不静默）──
    if (missUrl) {
      const missHost = hostOf(missUrl)
      out['missHost'] = missHost
      let missOk: boolean | undefined
      let missStatus = -1
      let missTransport: Record<string, unknown> | null = null
      try {
        const r = await mk().useFetch(missUrl, {
          ...base,
          // ★表里只放 hit 的域名 ⇒ missHost 必然走回落
          httpDns: { [host]: unreachableIp },
        })
        missOk = r?.ok === true
        missStatus = Number(r?.status ?? -1)
        // ★★★#1183：这条的 `dnsSource` 必须是 `system`（回落**可见**才是可观测）
        missTransport = (r?.meta?.transport as Record<string, unknown>) ?? null
      } catch {
        missOk = false
      }
      out['miss'] = { ok: missOk, status: missStatus }
      out['miss_transport'] = missTransport
      progress('miss:done', { ok: missOk, dnsSource: missTransport?.['dnsSource'] ?? null })
    }

    // ── ④ 读宿主记账（"表被采用"的直接证据）──
    try {
      const b = bridge as { invoke?: (m: string, a: unknown) => Promise<unknown> }
      const stats = await b.invoke?.('http.dnsStats', {})
      out['dnsStats'] = stats ?? null
    } catch (e) {
      out['dnsStats_error'] = String((e as Error)?.message ?? e).slice(0, 120)
    }

    // ★判据（双向对照：注入失败 + 基线成功 = 表真的生效）
    const stats = (out['dnsStats'] as Record<string, unknown> | null) ?? {}
    out['inject_failed'] = out['inject'] && (out['inject'] as { ok?: boolean }).ok === false
    out['baseline_ok'] = out['baseline'] && (out['baseline'] as { ok?: boolean }).ok === true
    out['table_hit_seen'] = Number(stats['tableHits'] ?? 0) > 0
    out['last_source'] = String(stats['lastSource'] ?? '')
    // ★★★#1183：**业务可见的**每请求解析来源（`meta.transport.dnsSource`）——
    //   这是本轮交付的核心：`http.dnsStats` 是进程级记账，业务在单次请求里看不到。
    //   ★注意"注入侧"那次可能是失败（不可达 IP）⇒ 失败分支也可能带 meta，取到即可。
    out['inject_dns_source'] = (injectTransport?.['dnsSource'] as string) ?? ''
    out['miss_dns_source'] = ((out['miss_transport'] as Record<string, unknown> | null)?.['dnsSource'] as string) ?? ''
    out['ok'] =
      out['inject_failed'] === true &&
      out['baseline_ok'] === true &&
      out['table_hit_seen'] === true
    progress('done', { ok: out['ok'] })
    g['__proteusHostHttpDnsProdProbeResult'] = JSON.stringify(out)
  }

  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostHttpDnsProdProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}


/**
 * ★★★#1180：**HTTPDNS 三条探针的 globalThis 注册**（集中一处安装）。
 *
 * 【为什么搬到这里】`entry-superapp.ts` 已到 1000 行红线——三条探针的注册各占 3-4 行，
 *   留在主文件里只能靠删注释换空间。它们**同属一个职责**（HTTPDNS 探针面），
 *   收成一个 `installHttpDnsProbes()` 后主文件只剩一行调用，且以后加 HTTPDNS 探针
 *   不必再动主文件（**减少将来的 1000 行冲突面**，不是为了过门禁而搬）。
 */
export function installHttpDnsProbes(
  appHttpDnsProbe: (b: string, h: string, ip?: string) => string,
  appHttpDnsBProbe: (u: string, p?: string, r?: number) => string,
): void {
  const g = globalThis as unknown as {
    __proteusHostAppHttpDnsProbe?: (b: string, h: string, ip?: string) => string
    __proteusHostAppHttpDnsBProbe?: (u: string, p?: string, r?: number) => string
    __proteusHostAppHttpDnsProdProbe?: (h: string, m?: string, ip?: string, rip?: string) => string
  }
  // #1169：端到端探针（结果填 __proteusHostHttpDnsProbeResult）
  g.__proteusHostAppHttpDnsProbe = appHttpDnsProbe
  // #1179：B 路线**传输通路**探针（结果填 __proteusHostHttpDnsBProbeResult）
  g.__proteusHostAppHttpDnsBProbe = appHttpDnsBProbe
  // #1180：**生产面**探针（结果填 __proteusHostHttpDnsProdProbeResult）
  g.__proteusHostAppHttpDnsProdProbe = (h: string, m?: string, ip?: string, rip?: string) =>
    appHttpDnsProdProbe(h, m, ip, rip)
}
