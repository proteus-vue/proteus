// hosts/shared/bridge/entry-superapp-probes-stale.ts
// ★★★决策 #1150：**RFC 5861 扩展指令**（`stale-while-revalidate` / `stale-if-error`）的真机判据探针。
//
// 【为什么单列】`entry-superapp-probes.ts` 加完本探针后 1079 行 ≥ `check:file-size` 的 1000 行上限。
//   这与"为过门禁而拆"不同：探针按**能力批次**分组本来就是清晰边界——
//   缓存基础（#1149：条件请求/304）与缓存扩展（#1150：SWR/SIE）是两次独立交付，
//   各自的判据、装置参数、排障埋点都不同；放在一起只会让"改 A 要读 B"。
//   ★调用方式不变：`entry-superapp.ts` 从这里 import 后照旧挂 globalThis（键名一个字都没改）。
//
// 【★与基础缓存探针的差异（值得单列的理由）】
//   本探针含**后台校验**（SWR）与**故障注入**（SIE）⇒ 需要
//     ① 进度埋点（超时也要能带回"卡在哪一步"）；
//     ② 服务端 `/__fail/<path><status>` 故障开关；
//     ③ 约 13 次串行往返（基础探针 ~8 次）⇒ Java runner 的 deadline 也按此放宽。

/**
 * RFC 5861 判据探针（SWR / SIE）。
 *
 * 【为什么必须在真机上验（Node 层判据不够）】
 *   `tests/fetch-stale.test.ts` 跑在 undici 上，验的是"框架层语义"。真机上还有两件事只能实测：
 *     ① **后台校验能不能真的发出去**（App 引擎无 `setTimeout`、无 `fetch`，全靠宿主回推）——
 *        若后台校验在这类引擎上根本跑不起来，SWR 就退化成"永远返回旧值"（比没有更糟）；
 *     ② iOS 的 `URLCache` 是否干扰后台校验的条件请求（#1149 已证它会替我们发/合成）。
 *
 * 【判据（都以**服务端记账**为准）】
 *   ① SWR：`max-age=0` + 窗口 ⇒ 第二次 `meta.cache.status='stale'` 且 `staleReason='swr'`，
 *      **立即返回**（body 仍是旧代），随后服务端收到**一次**条件校验 ⇒ 新值进缓存；
 *   ② SWR 窗口=0 ⇒ **不得**返回 stale；
 *   ③ SIE：源站 503 ⇒ 用旧值兜底（`staleReason='stale-if-error'`），业务看不到错误；
 *   ④ Age 头存在（RFC 9111 §5.1 MUST）。
 *
 * 【★装置约束（同 #1134/#1149）】App 精简引擎**没有全局 `fetch`** ⇒ 一切请求（含读记账、设故障）
 *   都走 `useFetch`。★故障注入用服务端的 `/__fail/<path><status>`（不靠停服务，同一进程可复现）。
 */
export function appStaleProbe(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base }
  g['__proteusHostStaleProbeResult'] = ''
  /**
   * ★★★进度埋点（真机排障用）：**独立全局键**，不写 `out` 的最终结果键。
   * 【为什么需要】首次真机跑出「服务端收到请求 + 探针 120s 无结果」——
   *   没有埋点就只能猜"卡在哪一步"。埋点让"超时"也带回现场（Java runner 超时时一并读它）。
   * ★不写最终键：否则 runner 会把半成品当完成（判据变假绿/假红）。
   */
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostStaleProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  type CacheMeta = { status?: string; staleReason?: string; revalidating?: boolean; ageMs?: number }
  type Res = {
    ok?: boolean
    status?: number
    data?: unknown
    headers?: Record<string, string>
    error?: { code?: string; message?: string }
    meta?: { cache?: CacheMeta }
  }
  type Hooks = { useFetch: <T>(u: string, c?: unknown) => Promise<Res> }

  const run = async (): Promise<void> => {
    progress('import-capability:start')
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => Hooks
      getSharedCapabilityBridge: () => unknown
    }
    progress('import-capability:done')
    const bridge = cap.getSharedCapabilityBridge()
    const mk = (opts: unknown): Hooks => cap.createCapabilityHooks(bridge, opts)
    progress('hooks-factory-ready')

    /** 读服务端记账（绕过缓存）。 */
    const readStats = async (): Promise<Record<string, unknown>> => {
      const hooks = mk({ fetch: {} })
      const r = await hooks.useFetch<Record<string, unknown>>(`${base}/__stats`, {
        responseType: 'json',
        cache: 'no-store',
        timeout: 15000,
      })
      return r.ok && r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {}
    }
    const hitOf = (o: Record<string, unknown>, path: string): number => {
      const m = o['hits'] as Record<string, number> | undefined
      const n = m?.[path]
      return typeof n === 'number' ? n : 0
    }
    const condOf = (o: Record<string, unknown>, path: string): string =>
      ((o['conditional'] as Record<string, string[]> | undefined)?.[path] ?? []).join('|')
    const ageHeader = (h: Record<string, string> | undefined): string | undefined =>
      h ? Object.entries(h).find(([k]) => k.toLowerCase() === 'age')?.[1] : undefined
    /** 设/清故障：`/__fail/<path><status>`（status=0 清）。 */
    const setFail = async (path: string, status: number): Promise<void> => {
      const hooks = mk({ fetch: {} })
      await hooks.useFetch(`${base}/__fail/${path.replace(/^\//, '')}${status}`, { cache: 'no-store', timeout: 10000 })
    }
    /**
     * ★★★`/__bump/<path>`：让服务端内容版本 +1（模拟"上游更新了"）。
     * 【为什么必须有】首版判据拿"生成次数"当版本 ⇒ 后台校验带旧 ETag 回来时服务端回 **304**
     *   ⇒ 缓存体不变 ⇒ "第三次应拿到新代"**永远不可能成立**（判据假设错，不是实现坏）。
     *   ⇒ 显式 bump 才能验证"后台校验拿到的新值真的写进了缓存"。
     */
    const bump = async (path: string): Promise<void> => {
      const hooks = mk({ fetch: {} })
      await hooks.useFetch(`${base}/__bump/${path.replace(/^\//, '')}`, { cache: 'no-store', timeout: 10000 })
    }
    /**
     * 等一个条件（有条件等待，**不用固定 sleep**）。
     *
     * ★★★真机实测抓出的判据缺陷：首版在"无 `setTimeout`"时**直接 return false**——
     *   而 App 精简引擎**都没有 `setTimeout`** ⇒ 该分支在真机上 100% 触发
     *   ⇒ `swr_background_sent` 恒为 false，而服务端日志里 `If-None-Match: "g1"` **明明收到了**
     *   （= "没等到"被当成了"没发生"，与 #1148 的"未测到 ≠ 通过"是同一类错误的镜像）。
     * ⇒ 无定时器时改用**一次真实往返**推进事件循环：`readStats()` 本身就是一次
     *   宿主异步调用，后台校验的 Promise 会在这期间被泵到。**有次数上限**（不死循环）。
     */
    const waitUntil = async (fn: () => Promise<boolean>, ms: number): Promise<boolean> => {
      const st = (globalThis as { setTimeout?: (f: () => void, n: number) => unknown }).setTimeout
      const deadline = Date.now() + ms
      let spins = 0
      for (;;) {
        if (await fn()) return true
        if (Date.now() >= deadline) return false
        if (typeof st === 'function') {
          await new Promise<void>((r) => st(r, 20))
        } else {
          // ★无定时器引擎：用"读一次记账"当让步点（真实往返，不是盲等），最多 20 次
          if (++spins > 20) return false
          await readStats()
        }
      }
    }

    // ── ① SWR：立即回旧值 + 后台校验 ──
    const swr = mk({ fetch: { cache: true } })
    progress('swr:hooks-created')
    try {
      progress('swr:first-request')
      const r1 = await swr.useFetch<{ gen?: number }>(`${base}/swr`, { responseType: 'json', timeout: 20000 })
      progress('swr:first-done', { status: r1.status, ok: r1.ok })
      out['swr_first_status'] = r1.status
      progress('swr:read-stats-1')
      const before = hitOf(await readStats(), '/swr')
      progress('swr:stats-1-done', { before })
      out['swr_hits_before_second'] = before
      const t0 = Date.now()
      progress('swr:second-request')
      // ★在触发 stale 之前把服务端内容版本 +1 ⇒ 后台校验会拿到 200 + 新体（而不是 304）
      await bump('/swr')
      const r2 = await swr.useFetch<{ gen?: number; ver?: number }>(`${base}/swr`, { responseType: 'json', timeout: 20000 })
      progress('swr:second-done', { status: r2.status, cache: r2.meta?.cache })
      const elapsed = Date.now() - t0
      out['swr_second_elapsed_ms'] = elapsed
      out['swr_second_status'] = r2.status
      out['swr_second_cache'] = r2.meta?.cache
      out['swr_second_data'] = r2.data
      out['swr_age_header'] = ageHeader(r2.headers)
      out['swr_stale_ok'] = r2.meta?.cache?.status === 'stale' && r2.meta?.cache?.staleReason === 'swr'
      // ★"立即返回"：不等后台校验（给 1500ms 上限，慢网络也不该超过）
      out['swr_immediate_ok'] = elapsed < 1500
      // ★后台校验真的发出（等它落地）。★"发出"的硬证据是**服务端收到了条件头**，不是"我等到了一次额外请求"——
      //   后者在慢节奏下可能还没落地（真机实测：等到超时但 `conditional` 里已有值）。
      progress('swr:wait-background')
      const revalidated = await waitUntil(async () => hitOf(await readStats(), '/swr') > before, 5000)
      progress('swr:wait-done', { revalidated })
      const st2 = await readStats()
      out['swr_conditional_seen'] = condOf(st2, '/swr')
      out['swr_background_conditional_ok'] = /If-None-Match/.test(condOf(st2, '/swr'))
      // ★★判据口径修正：**条件头出现** = 后台校验已发出（这是服务端视角的事实）；
      //   `waitUntil` 的返回值只是"是否在预算内观察到计数变化"，慢设备上可能为 false 而校验其实已发。
      //   ⇒ 以 `conditional` 为准，`waitUntil` 结果仅作读数保留（不再当判据）。
      out['swr_background_sent'] = out['swr_background_conditional_ok'] === true
      // ★Age 头（RFC 9111 §5.1 MUST）
      out['swr_age_ok'] = typeof out['swr_age_header'] === 'string'
      // ★后台校验后新值进缓存：再请求一次，body 的代/版本应更新
      //   ★服务端已 bump 版本 ⇒ 后台校验会拿到 200 + 新 ver（不是 304）
      const r3 = await swr.useFetch<{ gen?: number; ver?: number }>(`${base}/swr`, { responseType: 'json', timeout: 20000 })
      progress('swr:third-done', { status: r3.status })
      const v3 = (r3.data as { ver?: number } | undefined)?.ver
      out['swr_third_ver'] = v3
      out['swr_refreshed_ok'] = typeof v3 === 'number' && v3 >= 2
    } catch (e) {
      out['swr_error'] = String((e as Error)?.message ?? e)
      progress('swr:error', { error: out['swr_error'] })
    }

    // ── ② SWR 窗口=0 ⇒ 不得返回 stale ──
    const zero = mk({ fetch: { cache: true } })
    progress('swr-zero:start')
    try {
      await zero.useFetch(`${base}/swr-zero`, { responseType: 'json', timeout: 20000 })
      progress('swr-zero:first-done')
      const r2 = await zero.useFetch(`${base}/swr-zero`, { responseType: 'json', timeout: 20000 })
      progress('swr-zero:second-done', { cache: r2.meta?.cache })
      out['swr_zero_second_cache'] = r2.meta?.cache
      out['swr_zero_ok'] = r2.meta?.cache?.status !== 'stale'
    } catch (e) {
      out['swr_zero_error'] = String((e as Error)?.message ?? e)
      progress('swr-zero:error', { error: out['swr_zero_error'] })
    }

    // ── ③ SIE：源站 503 ⇒ 旧值兜底 ──
    const sie = mk({ fetch: { cache: true } })
    progress('sie:start')
    try {
      await setFail('/sie', 0)
      progress('sie:fail-cleared')
      const r1 = await sie.useFetch<{ gen?: number }>(`${base}/sie`, { responseType: 'json', timeout: 20000 })
      progress('sie:first-done', { status: r1.status, ok: r1.ok })
      const gen1 = (r1.data as { gen?: number } | undefined)?.gen
      out['sie_first_gen'] = gen1
      await setFail('/sie', 503)
      progress('sie:fail-set')
      /**
       * ★★★二分步骤（真机实测加的）：**不带缓存**先打一次 503。
       * 【它抓到过一个真缺陷】第一次真机跑到这里卡死 120s，服务端日志显示请求**到了**、
       *   宿主也 `HTTP_DONE bodyLen=16`，但 JS 永不返回。根因是
       *   `invoke-wire.interpretBody` 在 `responseType:'json'` 时对非 JSON 文本 `JSON.parse` 抛异常，
       *   而它在**宿主回推回调**里执行 ⇒ 异常逃出 ⇒ Promise 既不 resolve 也不 reject ⇒ 僵尸请求。
       *   ⇒ 已修（解析失败降级为原文）+ 结算路径加兜底。本步骤保留为**回归判据**：
       *     它证明"5xx 的 status/body 能完整回到 JS"（此前无任何探针覆盖这条通路）。
       *   ★body 是纯文本 ⇒ 用 `responseType:'text'` 断言原文；这条与缓存无关。
       */
      const plain503 = mk({})
      const p503 = await plain503.useFetch<string>(`${base}/sie`, { responseType: 'text', timeout: 20000 })
      progress('sie:plain-503-done', { status: p503.status, ok: p503.ok })
      out['sie_plain_503_status'] = p503.status
      out['sie_plain_503_ok'] = p503.ok === true && p503.status === 503
      out['sie_plain_503_body'] = typeof p503.data === 'string' ? p503.data.slice(0, 40) : String(p503.data)
      // ★JSON 模式下的非 JSON 体也必须**正常返回**（不挂起）——这是 #1150 修的那个缺陷的回归判据
      const json503 = mk({})
      const j503 = await json503.useFetch<unknown>(`${base}/sie`, { responseType: 'json', timeout: 20000 })
      progress('sie:json-503-done', { status: j503.status, ok: j503.ok })
      out['sie_json_503_status'] = j503.status
      // ★请求**有结果**（不挂起）就是通过；data 应为降级后的原文
      out['sie_json_503_no_hang'] = j503.ok === true && j503.status === 503
      out['sie_json_503_data'] = typeof j503.data === 'string' ? j503.data.slice(0, 40) : j503.data
      const r2 = await sie.useFetch<{ gen?: number }>(`${base}/sie`, { responseType: 'json', timeout: 20000 })
      progress('sie:second-done', { status: r2.status, cache: r2.meta?.cache })
      out['sie_second_ok'] = r2.ok === true
      out['sie_second_status'] = r2.status
      out['sie_second_data'] = r2.data
      out['sie_second_cache'] = r2.meta?.cache
      out['sie_rescued_ok'] = r2.ok === true && r2.meta?.cache?.status === 'stale'
        && r2.meta?.cache?.staleReason === 'stale-if-error'
      out['sie_same_body_ok'] = typeof gen1 === 'number'
        && (r2.data as { gen?: number } | undefined)?.gen === gen1
      await setFail('/sie', 0)
    } catch (e) {
      out['sie_error'] = String((e as Error)?.message ?? e)
      progress('sie:error', { error: out['sie_error'] })
    }

    out['ok'] = out['swr_stale_ok'] === true
      && out['swr_immediate_ok'] === true
      && out['swr_background_sent'] === true
      && out['swr_background_conditional_ok'] === true
      && out['swr_age_ok'] === true
      && out['swr_refreshed_ok'] === true
      && out['swr_zero_ok'] === true
      && out['sie_plain_503_ok'] === true
      && out['sie_json_503_no_hang'] === true
      && out['sie_rescued_ok'] === true
      && out['sie_same_body_ok'] === true
    progress('done')
    g['__proteusHostStaleProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostStaleProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
