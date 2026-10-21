// hosts/shared/bridge/entry-superapp-probes-tls.ts
// ★★★决策 #1153：**TLS 证书 pinning** 真机判据探针。
//
// 【为什么必须在真机上验】pinning 只在 **TLS 握手**阶段生效，而握手在**宿主**里发生
//   （Android `SSLSocketFactory` / iOS `URLSession` challenge）⇒ Node 判据只能验"指纹口径与归一"，
//   "证书不对时连接真的被拒"只能真机证。
//
// 【四条判据（缺一条都可能是"看起来钉了"）】
//   ① **pin 命中**（对 A 服务 + A 的指纹）⇒ 成功（且 `tlsPinOnly=true`，因为 A 是自签）；
//   ② **pin 未命中**（对 A 服务 + B 的指纹）⇒ `fetch.tlsError`（★不是 `fetch.failed`/`aborted`）；
//   ③ **叠加模式真的叠加**（对 A 服务 + A 的指纹、但**不开** pinOnly）⇒ 失败
//      —— 自签证书过不了系统信任。★这条最容易被实现"简化"掉（只做 pin 不调系统校验），
//      而那样等于"pin 命中就放行"，安全性反而下降；
//   ④ **无 pin**（对 A 服务、不给 tlsPins）⇒ 失败（系统信任拒绝自签）——零回归基线。
//
// 【诚实边界】④ 与 ③ 都为"失败"，但**错误码不同预期**：③ 由 pinOnly=false 的**系统校验**拒绝，
//   错误可能表现为 `fetch.tlsError`（我们统一归因）或 `fetch.failed`（平台原始 TLS 错误）；
//   ⇒ ③ 只断言"失败"，不硬判码；② 才断言**必须**是 `tlsError`（那是我们自己的 pin 判定）。

export function appTlsProbe(baseA: string, baseB: string, pinA: string, pinB: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base_a: baseA, base_b: baseB }
  g['__proteusHostTlsProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostTlsProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  /**
   * ★★★**每条用例必须换端口**（真机实测抓出）。
   *
   * 【现场】iOS 的 `URLSession` 会**复用已建立的 TLS 连接** ⇒ 同一 `host:port` 的连续请求
   *   只有**第一条**触发 challenge（后续直接复用连接）。
   *   首版 5 条用例都打同一个端口 ⇒ 宿主记账 `challenges=4 / accepted=2 / rejected=0`
   *   （即只有 2 个请求真的过了 challenge）⇒ "无 pin 也成功 / pin 不匹配也成功"
   *   看起来像 pinning 完全没生效，实际是**复用了前一条已建立的连接**。
   * ⇒ 传入的 `baseA/baseB` 是**端口列表**，每条用例取不同端口 ⇒ 强制新建连接 ⇒ 每次都真的过 challenge。
   *   ★★内层用 `+` 分隔端口（**不是 `,`**）：探针参数整体是逗号分隔的多实参
   *     （`--tls-probe=<baseA>,<baseB>,<pinA>,<pinB>`，Swift runner 按 `,` split）
   *     ⇒ base 内部再用 `,` 会被外层切碎（真机实测：`bases_a` 只剩 1 个、`bases_b` 变成裸端口号）。
   */
  const expandBases = (raw: string): string[] => {
    const one = raw.trim()
    if (!one) return []
    // 形态 A：`https://h:p0+p1+p2`
    const m = /^(.*):([0-9+]+)$/.exec(one)
    if (m) {
      const prefix = m[1]!
      const ports = m[2]!.split('+').filter(Boolean)
      return ports.map((p) => `${prefix}:${p}`)
    }
    // 形态 B：整串里用 `+` 连接多个完整 URL
    if (one.includes('+') && one.includes('://')) return one.split('+').filter(Boolean)
    return [one]
  }
  const basesA = expandBases(baseA)
  const basesB = expandBases(baseB)
  const baseAt = (arr: string[], i: number): string => arr[Math.min(i, arr.length - 1)] ?? ''
  out['bases_a'] = basesA
  out['bases_b'] = basesB

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

    // ① pin 命中（pinOnly：自签证书必须替代系统信任才可能通过）
    {
      const hooks = mk()
      progress('hit:request')
      const r = await hooks.useFetch<{ whoami?: string }>(`${baseAt(basesA, 0)}/__whoami`, {
        responseType: 'json',
        tlsPins: [pinA],
        tlsPinOnly: true,
        timeout: 20000,
      })
      progress('hit:done', { ok: r.ok, code: r.error?.code })
      out['hit_ok'] = r.ok === true
      out['hit_code'] = r.ok ? '' : (r.error?.code ?? '')
      out['hit_error'] = r.ok ? '' : (r.error?.message ?? '')
      out['hit_secure'] = (basesA[0] ?? '').startsWith('https://')
    }

    // ② pin 未命中 ⇒ 必须 tlsError（对 A 服务、拿 B 的指纹）
    {
      const hooks = mk()
      progress('mismatch:request')
      const r = await hooks.useFetch(`${baseAt(basesA, 1)}/__whoami`, {
        responseType: 'json',
        tlsPins: [pinB],
        tlsPinOnly: true,
        timeout: 20000,
      })
      progress('mismatch:done', { ok: r.ok, code: r.error?.code })
      out['mismatch_failed'] = r.ok === false
      out['mismatch_code'] = r.ok ? '' : (r.error?.code ?? '')
      out['mismatch_is_tls_error'] = r.ok === false && r.error?.code === 'fetch.tlsError'
    }

    // ③ 叠加模式真的叠加（pin 对，但不开 pinOnly ⇒ 自签过不了系统信任 ⇒ 失败）
    {
      const hooks = mk()
      progress('stacked:request')
      const r = await hooks.useFetch(`${baseAt(basesA, 2)}/__whoami`, {
        responseType: 'json',
        tlsPins: [pinA],
        // ★故意不传 tlsPinOnly
        timeout: 20000,
      })
      progress('stacked:done', { ok: r.ok, code: r.error?.code })
      out['stacked_failed'] = r.ok === false
      out['stacked_code'] = r.ok ? '' : (r.error?.code ?? '')
    }

    // ④ 无 pin ⇒ 自签被拒（零回归基线）
    {
      const hooks = mk()
      progress('nopin:request')
      const r = await hooks.useFetch(`${baseAt(basesA, 3)}/__whoami`, { responseType: 'json', timeout: 20000 })
      progress('nopin:done', { ok: r.ok, code: r.error?.code })
      out['nopin_failed'] = r.ok === false
      out['nopin_code'] = r.ok ? '' : (r.error?.code ?? '')
    }

    // ⑤ B 服务自身可用（证明"B 的指纹确实对应一台能连通的机器"，避免②是"连不上"而假通过）
    {
      const hooks = mk()
      progress('b:request')
      const r = await hooks.useFetch(`${baseAt(basesB, 1)}/__whoami`, {
        responseType: 'json',
        tlsPins: [pinB],
        tlsPinOnly: true,
        timeout: 20000,
      })
      progress('b:done', { ok: r.ok })
      out['b_ok'] = r.ok === true
      out['b_code'] = r.ok ? '' : (r.error?.code ?? '')
    }

    /**
     * ★★★**宿主侧记账**（真机实测新增）：读 `http.tlsStats` 看 challenge 到底被调用几次。
     * 【为什么必须有】iOS 首跑出现"连自签证书都成功"——客户端读数看起来像"pin 生效了"，
     *   但实际可能是 challenge **根本没被调用**（走了别的路径）。
     *   ⇒ 把"宿主有没有真正处理证书"变成可断言的读数，而不是靠日志猜。
     * ★`invokeHostAsync` 直接调（不经 useFetch——它不是网络请求）。
     */
    try {
      progress('stats:request')
      const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
        invokeHostAsync: (m: string, a?: unknown, t?: number) => Promise<unknown>
      }
      const st = (await inv.invokeHostAsync('http.tlsStats', {}, 10000)) as Record<string, unknown> | null
      out['host_tls_stats'] = st ?? null
      const challenges = Number((st ?? {})['challenges'] ?? 0)
      out['host_challenge_seen'] = challenges > 0
      out['host_rejected'] = Number((st ?? {})['rejected'] ?? 0)
      out['host_accepted'] = Number((st ?? {})['accepted'] ?? 0)
    } catch (e) {
      out['host_tls_stats_error'] = String((e as Error)?.message ?? e)
    }

    out['ok'] = out['hit_ok'] === true
      && out['mismatch_is_tls_error'] === true
      && out['stacked_failed'] === true
      && out['nopin_failed'] === true
      && out['b_ok'] === true
      // ★challenge 必须真的被调用过（否则上面的"成功"无法归因到 pinning）
      && out['host_challenge_seen'] === true
    progress('done', { ok: out['ok'] })
    g['__proteusHostTlsProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostTlsProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
