// hosts/shared/bridge/entry-superapp-probes-transport.ts
// ★★★决策 #1155：**传输层事实取证探针**——HTTP/2 与连接复用**是否已经在工作**。
//
// 【为什么要做这个探针（而不是直接引 OkHttp）】
//   矩阵 P1 写着「HTTP/2 + 连接池：需 Android 引入 OkHttp（APK +Δ）」。
//   但 **Android 的 `HttpURLConnection` 底层就是 OkHttp**（AOSP 从 4.4 起 `com.android.okhttp`）
//   ⇒ HTTP/2 与连接池**可能早就在工作**，缺的只是"我们看不见它"。
//   ⇒ 先取证：真机对 h2 服务端连 3 次，服务端记账会告诉我们协议版本与连接数。
//     · 若已是 h2 且连接复用 ⇒ P1 的实质是**补可观测字段**（+ HTTPDNS），都不需要换栈；
//     · 若仍是 h1 / 不复用 ⇒ 才真的需要引 OkHttp（独立大单，先评估 APK 体积）。
//
// 【判据（以服务端记账为准，客户端自述不算）】
//   ① 协议：服务端记录的 `protocols` 是否含 `h2`
//   ② 复用：`requests > connections`（3 次请求只用了 1~2 条 TCP 连接）
//   ③ 客户端侧读数：`performance` 或宿主记账（可观测字段的雏形）
//
// 【★装置约束】自签证书 ⇒ 必须用 `tlsPins + tlsPinOnly`（复用 #1154 的能力）。
//   参数经**文件**传（`base` 含 `:`、`pin` 是 base64 含 `=`/`+`/`/`——经 adb shell 会掉字符）。

export function appTransportProbe(base: string, pin: string, rounds = 3, plainBase = ''): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base, rounds, plain_base: plainBase }
  g['__proteusHostTransportProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostTransportProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  type Res = { ok?: boolean; status?: number; data?: unknown; error?: { code?: string; message?: string } }
  type Hooks = { useFetch: <T>(u: string, c?: unknown) => Promise<Res> }

  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => Hooks
      getSharedCapabilityBridge: () => unknown
    }
    const bridge = cap.getSharedCapabilityBridge()
    const mk = (): Hooks => cap.createCapabilityHooks(bridge, {})
    progress('import:done')

    const cfg = { responseType: 'json', tlsPins: [pin], tlsPinOnly: true, timeout: 20000 }

    /** 服务端按通道（`tls` / `plain`）的记账形态 */
    type Channel = {
      requests?: number
      connections?: number
      reused?: boolean
      protocols?: Record<string, number>
      conns?: Record<string, number>
    }
    type Stats = { channels?: Record<string, Channel> }
    /** 服务端已按通道算好 `reused` ⇒ 客户端**只读不重算**（判据一个实现，见服务端注释） */
    const channelOf = (stats: Stats, tag: 'tls' | 'plain'): Channel => (stats.channels ?? {})[tag] ?? {}

    /**
     * ★★★**对照实验**：明文 HTTP 基线（不装 TLS、不装 pinning）。
     * 【为什么必须有这个对照】真机首跑发现"5 次请求 5 条 TCP 连接"（完全不复用），
     *   而唯一可疑的差异是 **pinning 会 `setSSLSocketFactory`**——若每次请求都新建 `SSLContext`，
     *   连接池会按 SSLContext 分桶 ⇒ 复用失效。
     *   ⇒ 用"同一台机器的明文端口"做基线：**基线复用、带 pin 不复用** ⇒ 才能把责任归到 pinning 实现上，
     *     而不是笼统地说"本端不复用连接"。
     */
    if (plainBase) {
      progress('plain:start')
      const plainOk: boolean[] = []
      for (let i = 0; i < rounds; i++) {
        const r = await mk().useFetch(`${plainBase}/__whoami?p=${i}`, { responseType: 'json', timeout: 20000 })
        plainOk.push(r.ok === true)
      }
      const ps = await mk().useFetch<Stats>(`${plainBase}/__stats`, {
        responseType: 'json',
        cache: 'no-store',
        timeout: 20000,
      })
      const pstats: Stats = ps.ok && ps.data && typeof ps.data === 'object' ? (ps.data as Stats) : {}
      const plain = channelOf(pstats, 'plain')
      out['plain_all_ok'] = plainOk.every(Boolean)
      out['plain_server_stats'] = pstats
      out['plain_requests'] = Number(plain.requests ?? 0)
      out['plain_connections'] = Number(plain.connections ?? 0)
      // ★基线判据：明文下**应当**复用（若基线也不复用 ⇒ 是本端/装置问题，不是 pinning）
      out['plain_reused_ok'] = plain.reused === true
      progress('plain:done', { reused: out['plain_reused_ok'], conns: out['plain_connections'] })
    }

    // ① 连 rounds 次（每次都不同 path ⇒ 避开 HTTP 缓存/去重，但**同 host:port** ⇒ 可复用连接）
    const protos: string[] = []
    const peers: string[] = []
    /**
     * ★★★#1158：**每一轮的 `meta.transport`**（这是"产品化链路"的判据）。
     * 【为什么探针必须读 `meta.transport` 而不是直连宿主】本字段的链路有五段，
     *   探针若绕过 `useFetch` 去问宿主，就只能证明"宿主能测"，**证明不了业务拿得到**——
     *   本仓栽过多次「底层做完、门面没接」（#1122 五个 S3 字段没进 `FetchConfig`）。
     *   ⇒ 这里走**真实 `useFetch`**，读 `r.meta.transport`。
     */
    const transportPerRound: unknown[] = []
    let firstOk = false
    for (let i = 0; i < rounds; i++) {
      progress('req', { i })
      const r = await mk().useFetch<{ proto?: string; peer?: string }>(`${base}/__whoami?i=${i}`, cfg)
      if (i === 0) firstOk = r.ok === true
      // ★`meta` 只在**走管线**时才有（`useFetch` 门面会带）；直接 `runFetch` 不带
      const meta = (r as { meta?: { transport?: unknown } }).meta
      transportPerRound.push(meta?.transport ?? null)
      if (r.ok && r.data && typeof r.data === 'object') {
        const d = r.data as { proto?: string; peer?: string }
        if (d.proto) protos.push(d.proto)
        // ★连接身份用**对端 socket**（`remoteAddress:remotePort`）：同一 TCP 连接的所有 h2 流相同；
        //   `sid` 在 h2 下是**每流**的，不能当连接身份（本地校准实测）。
        if (d.peer) peers.push(d.peer)
      } else {
        out['req_error'] = r.ok ? 'no-data' : (r.error?.code ?? 'unknown')
      }
    }
    out['client_protos'] = protos
    out['client_peers'] = peers
    out['client_same_conn'] = peers.length > 1 && new Set(peers).size < peers.length
    out['first_ok'] = firstOk
    // ★#1158：三端"业务能拿到什么"的逐项读数（首轮 + 末轮：首轮常无复用、末轮应复用）
    out['transport_per_round'] = transportPerRound
    out['transport_first'] = transportPerRound[0] ?? null
    out['transport_last'] = transportPerRound[transportPerRound.length - 1] ?? null

    /**
     * ★★★#1158：**宿主侧记账**——`http.tlsStats` 现在也带 `metrics`
     * （`collecting_calls` / `before_complete` / `after_complete`）。
     *
     * 【为什么要读它（真机实测驱动）】iOS 首跑 `transport_first/last` 全是 `null`，而 Android 有值。
     *   两种可能：① `didFinishCollecting` 没被调用；② 被调用了但**晚于** `didComplete`
     *   （完成帧发出后才到 ⇒ 那一帧永远带不上）。
     *   ⇒ 用 `after_complete > 0` 区分这两种情形——**不给"平台不给"这种笼统结论**。
     */
    try {
      progress('stats:request')
      const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
        invokeHostAsync: (m: string, a?: unknown, t?: number) => Promise<unknown>
      }
      const st = (await inv.invokeHostAsync('http.tlsStats', {}, 10000)) as Record<string, unknown> | null
      out['host_stats'] = st ?? null
    } catch (e) {
      out['host_stats_error'] = String((e as Error)?.message ?? e)
    }

    // ② 读服务端记账（服务端视角 = 事实）
    progress('stats')
    const sr = await mk().useFetch<Stats>(`${base}/__stats`, { ...cfg, cache: 'no-store' })
    const stats: Stats = sr.ok && sr.data && typeof sr.data === 'object' ? (sr.data as Stats) : {}
    out['server_stats'] = stats
    const tls = channelOf(stats, 'tls')
    const protocols = tls.protocols ?? {}
    const requests = Number(tls.requests ?? 0)
    const connections = Number(tls.connections ?? 0)
    out['server_protocols'] = protocols
    out['server_requests'] = requests
    out['server_connections'] = connections
    // ★判据：h2 已协商？（服务端已按通道分账 ⇒ 键就是纯协议名 `h2` / `http/1.1`）
    out['http2_ok'] = Object.entries(protocols).some(([k, v]) => /h2|HTTP\/2|2\.0/i.test(k) && Number(v) > 0)
    // ★判据：连接复用？——以服务端按**对端 socket** 聚合的结果为准
    out['conn_reused_ok'] = tls.reused === true

    // ★★`ok` **不包含** HTTP/2——它是**端差异读数**而不是缺陷：
    //   实测 iOS 全 h2、Android 全 http/1.1（AOSP 的 HttpURLConnection 默认不开 h2）。
    //   ⇒ "Android 没有 h2" 是**已取证的结论**（要换栈才能有），不是"本轮实现坏了"。
    //   若把它写进 ok，Android 的判据会永远红 ⇒ 判断据本身错了（本仓反复踩的形态）。
    out['ok'] = firstOk && out['conn_reused_ok'] === true
    progress('done', { ok: out['ok'] })
    g['__proteusHostTransportProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostTransportProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
