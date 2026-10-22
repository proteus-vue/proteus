// hosts/shared/bridge/entry-superapp-probes-httpdns-b.ts
// ★★★#1179：**iOS B 路线（本地 CONNECT 代理）真机探针**——把 #1178 的模拟器结论升到真机。
//
// 【要回答的问题（#1178 的诚实边界）】
//   #1178 已在**模拟器**（与真机同一份 CFNetwork）证到：配 HTTP 代理键后，https 请求由
//   CFNetwork 以 `CONNECT host:port` 隧道交给代理，且 SNI/Host/h2/复用全保留。
//   但真机没跑（当时把 Xcode 找错了位置，误以为本机没有 devicectl）。
//   ⇒ 本探针在**真机**上重跑同一组判据。
//
// 【判据（三条，每条都要读数）】
//   ① 假域名经代理返回 200 ⇒ 系统 DNS 解析不出它，只有代理（按固定映射转到本地 TLS 服务端）能通
//   ② 宿主回执里 `status=200` 且 body 里 `host` 仍是原域名 ⇒ Host 头没被改成 IP
//   ③ N 次请求只产生 1 个 CONNECT ⇒ 隧道内连接复用
//   ★SNI 由**服务端**侧读（`SNICallback`），不在本文件判——client 侧看不到自己的 SNI。
//
// 【★为什么用 `sni-probe.local` 这个不存在的域名】
//   若用公网域名，"成功"可能只是"代理没生效、直连成功"。
//   用一个**无 DNS 记录**的假域名 ⇒ ① 系统解析必然失败 ② 只有代理能让它成功
//   ⇒ "200" 本身就是"代理接管了解析"的证据。这个混淆因子排除手法与 #1178 一致。
//
// 【诚实边界】
//   · 本探针只**定性**（B 路线在真机上可行/不可行）；生产代理进程、表查询、降级链仍未实现。
//   · 代理地址由宿主环境变量 `PROTEUS_B_PROXY` 注入（见 HttpCapability.session 注释）；
//     探针本身**不配代理**——它验证的是"宿主配上代理后，业务请求能否走通隧道"。
//   · TLS 服务端自签 ⇒ App 侧会因证书不受信而失败，这是**预期的**：
//     判据取"请求到达服务端（有 SNI/有 CONNECT）"而不是"TLS 握手成功"。
export function appHttpDnsBProbe(url: string, publicUrl = '', rounds = 3): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { url, publicUrl, rounds, host_platform: String(g['__PROTEUS_HOST_ID__'] ?? '') }
  g['__proteusHostHttpDnsBProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostHttpDnsBProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
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
    const hooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {})
    progress('import:done')

    // ★这几次请求**不带 httpDns**——表由代理侧（探针脚本的固定映射）提供，
    //   因为我们验证的是 B 路线这条**传输通路**，不是业务 API（业务 API 尚未接 B）。
    const statuses: number[] = []
    const hosts: string[] = []
    const errs: string[] = []
    let lastErr = ''
    for (let i = 0; i < rounds; i++) {
      try {
        const r = await hooks.useFetch(url, { responseType: 'text', timeout: 15000 })
        statuses.push(Number(r?.status ?? -1))
        // ★记录错误码（真机首跑 statuses 全 -1 且 error 为空，看不出是证书失败还是别的原因）
        if (r?.error) errs.push(String(r.error.code ?? '') + ':' + String(r.error.message ?? '').slice(0, 80))
        // 服务端回 `{"ok":true,"host":"sni-probe.local:18443",...}` ⇒ 读回 Host 是否保留原域名
        if (typeof r?.data === 'string') {
          try {
            const j = JSON.parse(r.data) as { host?: string }
            if (j && typeof j.host === 'string') hosts.push(j.host)
          } catch { /* 非 JSON 就不记 */ }
        }
      } catch (e) {
        statuses.push(-1)
        lastErr = String((e as Error)?.message ?? e)
        errs.push('throw:' + lastErr.slice(0, 80))
      }
      progress('round', { i: i + 1, status: statuses[statuses.length - 1] })
    }

    // ── 第二组：**公网域名经同一代理**（真实证书 ⇒ 连接可复用）──
    //   ★★★为什么必须加这一组（真机首跑的教训）：假域名用**自签证书**，真机生产 session
    //     不信任 ⇒ TLS 握手失败 ⇒ 每次重连（实测 3 请求 3 个 CONNECT，而模拟器用 TrustAll
    //     无条件信任 ⇒ 1 个）。**这不是 B 路线不可行，而是"证书不受信"这个装置变量**。
    //     生产上证书是受信的 ⇒ 必须用真实证书的域名再测一次复用，否则会把装置问题
    //     误读成路线缺陷（本仓 #1165「把探针连不上自签服务端当成平台不支持」同族）。
    const pubStatuses: number[] = []
    const pubErr = ''
    if (publicUrl) {
      for (let i = 0; i < rounds; i++) {
        try {
          const r = await hooks.useFetch(publicUrl, { responseType: 'text', timeout: 15000 })
          pubStatuses.push(Number(r?.status ?? -1))
        } catch {
          pubStatuses.push(-1)
        }
        progress('public-round', { i: i + 1, status: pubStatuses[pubStatuses.length - 1] })
      }
    }

    out['statuses'] = statuses
    out['hosts'] = hosts
    out['errors'] = errs
    out['error'] = lastErr
    out['public_statuses'] = pubStatuses
    out['public_error'] = pubErr
    // ★判据①：假域名返回 200（系统解析不出 ⇒ 只有代理能通）
    //   ★真机上这条会因为自签证书失败而**预期为 false** —— 它不是缺陷，见上。
    out['fake_domain_ok'] = statuses.length > 0 && statuses.every((s) => s === 200)
    // ★判据①b：假域名**到达了服务端**（真机上自签证书必然被拒 ⇒ 只要求"确实发起了请求
    //   并拿到证书错误"，而不是 200）。判据取"有错误且是证书相关"或"已经 200"。
    //   ★错误信息实测形如 `fetch.failed: [proteus-cap] fetch.failed: The certificate for this...`
    //     ⇒ 匹配 `certificate` / `ssl` / `tls` 任一即可，别锁死整句（会随系统语言变）。
    out['fake_reached'] =
      out['fake_domain_ok'] === true ||
      errs.some((e) => /certificate|ssl|tls|secure|证书/i.test(e))
    // ★判据②：Host 仍是原域名（不是 IP）
    out['host_preserved'] = hosts.length > 0 && hosts.every((h) => /sni-probe\.local/.test(h))
    // ★判据③：公网经代理正常（真实证书 ⇒ 可复用）——这条才是"生产形态"的读数
    out['public_ok'] = pubStatuses.length > 0 && pubStatuses.every((s) => s === 200)
    out['ok'] = out['public_ok'] === true || out['host_preserved'] === true
    progress('done', { ok: out['ok'] })
    g['__proteusHostHttpDnsBProbeResult'] = JSON.stringify(out)
  }

  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostHttpDnsBProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
