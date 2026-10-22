// hosts/shared/bridge/entry-superapp-probes-httpdns.ts
// ★★★#1169：**HTTPDNS 端到端探针**——验证 `useFetch({ httpDns })` 在真机上真的生效。
//
// 【它要证明什么（三件，缺一不可）】
//   ① **表被采用**：把目标域名强制解析到一个**不可达 IP**（203.0.113.1，TEST-NET-3）
//      ⇒ 请求必须**失败**（网络层）。若成功，说明表没被采用（宿主忽略了它）。
//   ② **是"表"起的作用，不是网络恰好不通**：对照组用**同样的域名、不传 httpDns**
//      ⇒ 必须**成功**。两者一起才排除"网络本来就不通"的解释。
//   ③ **不静默忽略**：iOS 无自定义 DNS 钩子 ⇒ 传了 `httpDns` 必须拿到
//      `fetch.unsupported`（**不是**"成功了但走了系统 DNS"）。
//
// 【为什么要真机】单测只能验"帧编码里有这个 tag"；"宿主真的按表解析"只能在设备上验。
//
// 【诚实边界】本探针用"不可达 IP ⇒ 失败"作为因果证据（与 #1169 的鸿蒙探针同一手法）。
//   ★它证明"表生效"，**不**证明"HTTPDNS 服务商给的 IP 是优质的"（那是业务侧的事）。
export function appHttpDnsProbe(base: string, host: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base, host, host_platform: String(g['__PROTEUS_HOST_ID__'] ?? '') }
  g['__proteusHostHttpDnsProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostHttpDnsProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  /** 不可达地址（RFC 5737 TEST-NET-3，保留给文档示例，保证不可路由） */
  const UNREACHABLE = '203.0.113.1'
  /**
   * ★★探测目标必须**既是域名、又真实可达**——否则测不到 DNS 这条路：
   *   · 用 IP 字面量 ⇒ OkHttp/URLSession 直接连 IP、**根本不查 DNS**（探针会空转）；
   *   · 用不可达域名 ⇒ 基线就失败 ⇒ 无法区分"表生效"与"网络本来不通"。
   * ⇒ 缺省用 `https://example.com/`（公网可达、走 DNS）；也可由调用方传 base 覆盖。
   */
  const url = base && base.length > 0 ? base : `https://${host}/`

  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => {
        useFetch: <T>(u: string, c?: unknown) => Promise<{
          ok?: boolean
          status?: number
          error?: { code?: string; message?: string }
          meta?: Record<string, unknown>
        }>
      }
      getSharedCapabilityBridge: () => unknown
    }
    const hooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {})
    progress('import:done')

    // ── ① 注入侧**先跑**：此时连接池是空的 ⇒ 必然真的做一次 DNS ⇒ 才测得到表 ──
    //   ★★★顺序很重要（#1169 首跑实测）：若先跑基线，基线会把 `host:443` 的连接放进池，
    //     注入侧**直接复用、不查 DNS** ⇒ 表"看起来没生效"
    //     （证据：`lookups=1, tableHits=0, lastSource='system'`——两次请求只发生一次 DNS）。
    //   ★这是 HTTPDNS 的**固有语义**（连接池优先于 DNS），不是缺陷；但探针必须绕开它才能测。
    let injectOk: boolean | undefined
    let injectCode = ''
    let injectMsg = ''
    try {
      const r = await hooks.useFetch(`${url}?proteus-dns-probe=1`, {
        responseType: 'text',
        timeout: 20000,
        httpDns: { [host]: [UNREACHABLE] },
      })
      injectOk = r?.ok === true
      injectCode = String(r?.error?.code ?? '')
      injectMsg = String(r?.error?.message ?? '')
    } catch (e) {
      const err = e as Error & { code?: string }
      injectCode = String(err?.code ?? '')
      injectMsg = String(err?.message ?? '')
      injectOk = false
    }
    out['inject_ok'] = injectOk
    out['inject_code'] = injectCode
    out['inject_message'] = injectMsg
    out['inject_unreachable_ip'] = UNREACHABLE
    progress('inject:done', { ok: injectOk, code: injectCode })

    // ── ② 基线：**注入之后**再跑（不传 httpDns）⇒ 应成功（证明域名本身可达）──
    //   ★此时连接池里可能有注入侧的失败记录，但那条连接从未建立成功 ⇒ 基线仍会新建连接并解析。
    let baselineOk = false
    let baselineStatus = 0
    try {
      const r = await hooks.useFetch(url, { responseType: 'text', timeout: 20000 })
      baselineOk = r?.ok === true
      baselineStatus = Number(r?.status ?? 0)
    } catch (e) {
      out['baseline_error'] = String((e as Error)?.message ?? e)
    }
    out['baseline_ok'] = baselineOk
    out['baseline_status'] = baselineStatus
    progress('baseline:done', { ok: baselineOk })

    /**
     * ★★★#1169：读**宿主侧记账**（`http.dnsStats`）——把"表被采用"从**间接推断**变成**直接证据**。
     * 【为什么必须有】"注入不可达 IP ⇒ 失败"与"网络本来就不通"在外部看起来一样；
     *   `tableHits > 0` + `lastSource='table'` 才证明"解析真的走了业务给的表"。
     */
    try {
      const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
        invokeHostAsync: (m: string, a?: unknown, t?: number) => Promise<unknown>
      }
      const st = (await inv.invokeHostAsync('http.dnsStats', {}, 8000)) as Record<string, unknown> | null
      out['host_dns_stats'] = st ?? null
    } catch (e) {
      out['host_dns_stats_error'] = String((e as Error)?.message ?? e)
    }

    /**
     * ── ③ 判定（按端差异）──
     * · **iOS**：传了 httpDns 必须 `fetch.unsupported`（宿主明确拒绝，不静默忽略）；
     * · **Android / 鸿蒙**：基线成功 + 注入失败 ⇒ 表真的生效。
     *   ★注入失败的错误码应是网络层（`fetch.failed`/`network.unreachable`/`timeout`），
     *     而不是 `fetch.unsupported`（那说明该端根本没实现）。
     */
    const hostId = String(g['__PROTEUS_HOST_ID__'] ?? '')
    if (hostId === 'ios') {
      out['mode'] = 'ios-unsupported'
      out['ok'] = injectCode === 'fetch.unsupported'
    } else {
      out['mode'] = 'table-applied'
      const injectFailed = injectOk === false
      const notUnsupported = injectCode !== 'fetch.unsupported'
      out['ok'] = baselineOk === true && injectFailed && notUnsupported
    }
    progress('done', { ok: out['ok'] })
    g['__proteusHostHttpDnsProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostHttpDnsProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
