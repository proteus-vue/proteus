// hosts/shared/bridge/entry-superapp-probes-perf.ts
// ★★★#1404 请求层**真机并发吞吐**探针（`--perf-probe=<concurrency>,<total>`）—— 单列文件。
//
// 【它回答什么问题（本轮唯一剩下的硬缺口）】
//   已有证据只能回答"**单个**请求的稳定往返有多快"（ttfb 7.3ms / 11.1ms）。
//   但大厂采购问的是"**每秒能扛多少**" —— 那是**并发**下的吞吐，不是单请求延迟的倒数。
//   并发下连接池 / 多路复用 / 事件循环调度都会改变结果，可能更高也可能更低
//   ⇒ 必须实测，不能从 ttfb 推导。
//
// 【★测量口径（与 `scripts/bench-request.mjs` 同一套纪律，但这里是真网络）】
//   · **固定 worker 池**（不是 `Promise.all(N)` —— 后者一次性创建 N 个 Promise，
//     量到的是调度开销不是吞吐）；
//   · **预热**一轮丢弃（JIT + 连接池建好），否则既量到冷启动又把首轮 DNS/TLS 摊进去；
//   · 报 **p50 / p95 / p99 + QPS**，不报均值（均值藏 p99）；
//   · 每轮**记录总墙钟**，QPS = 完成数 / 墙钟。
//
// 【★诚实边界】
//   · 只走 `useFetch`（业务真正看到的面），但**不经过** `createRequestClient` 的治理层
//     （配额/限速/审计）⇒ 这是**传输 + 门面**的吞吐，不是"全治理后的吞吐"。
//     ★为什么这样切：治理层的开销已由 `scripts/bench-request.mjs` 在假 hooks 下量过
//       （p50 +0.03ms 量级，低于噪声底）；真机要量的是**宿主传输**这一段，两者相加才是全貌。
//   · 受本地 HTTP 服务端影响（单进程 node server，可能先成为瓶颈）⇒ 报告里必须写明服务端。
//   · 一次性 VM 的端（鸿蒙 oneshot 模式）里 `await` 循环的可行性取决于调度策略 ——
//     本探针在 iOS 上验证；鸿蒙会话模式另测（见 hosts/harmony）。
export function appPerfProbe(base = '', concurrency = 8, total = 200): string {
  const g = globalThis as Record<string, unknown>
  // ★base 必须是第一参（本仓探针统一约定，见文件头）；coerce 防 Swift 侧把数字传成字符串
  concurrency = Number(concurrency) || 8
  total = Number(total) || 200
  const out: Record<string, unknown> = { perf: 'probe', base, concurrency, total }
  g['__proteusHostPerfProbeResult'] = ''

  /** 单调时钟：App 精简引擎**没有 performance.now**（本仓已踩过 #1071/#1095 同族） */
  const now = (): number => {
    const p = (globalThis as { performance?: { now?: () => number } }).performance
    if (p && typeof p.now === 'function') return p.now()
    return Date.now()
  }

  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => {
        useFetch: (url: string, cfg?: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code?: string }; status?: number }>
      }
      getSharedCapabilityBridge: () => unknown
    }
    const hooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {})

    /** 首个失败的归因（诊断用；不参与分位数） */
    let firstError: { code: string; message: string; status: number | null } | null = null

    /** 固定 worker 池跑一批，返回每个请求的耗时（ms） */
    const runBatch = async (n: number, c: number): Promise<number[]> => {
      const lat: number[] = new Array(n)
      let next = 0
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++
          if (i >= n) return
          const t0 = now()
          const r = await hooks.useFetch(`${base}/perf?i=${i}`, { timeout: 20000 })
          lat[i] = now() - t0
          if (!r.ok) {
            // ★失败也要记账 —— 否则"快"可能是"全部失败得很快"
            lat[i] = -1
            // ★★#1404：**必须留下失败原因**。首版只记 `failed=N`，真机首跑得到
            //   "failed=8 · wallMs=8"（8 个 worker 各失败一次就退出）却**无任何错误码**，
            //   无法区分"网络不通 / 明文被策略拦 / 参数错 / 服务端 5xx"——只能靠猜。
            //   ⇒ 记首个失败的 code + message + status（只记一份，不污染分位数）。
            if (!firstError) {
              const e = (r as { error?: { code?: string; message?: string } }).error
              firstError = { code: e?.code ?? 'unknown', message: String(e?.message ?? '').slice(0, 160), status: (r as { status?: number }).status ?? null }
            }
            break
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(c, n) }, worker))
      return lat
    }

    // ① 预热（丢弃）：JIT + 连接池建好
    await runBatch(Math.max(8, Math.min(20, total)), Math.min(concurrency, 8))

    // ② 正式一轮
    const t0 = now()
    const lat = await runBatch(total, concurrency)
    const wallMs = now() - t0

    const okLat = lat.filter((x) => x >= 0).sort((a, b) => a - b)
    const failed = lat.filter((x) => x < 0).length
    const q = (p: number): number => (okLat.length === 0 ? 0 : okLat[Math.min(okLat.length - 1, Math.max(0, Math.ceil(p * okLat.length) - 1))]!)
    const sum = okLat.reduce((a, b) => a + b, 0)

    out['ok'] = failed === 0 && okLat.length === total
    out['completed'] = okLat.length
    out['failed'] = failed
    out['wallMs'] = +wallMs.toFixed(2)
    // ★QPS 用**完成数**除墙钟（不是 total）—— 失败率高时虚高是典型假绿
    out['qps'] = +(okLat.length / (wallMs / 1000)).toFixed(1)
    out['meanMs'] = okLat.length ? +(sum / okLat.length).toFixed(2) : 0
    out['p50Ms'] = +q(0.5).toFixed(2)
    out['p95Ms'] = +q(0.95).toFixed(2)
    out['p99Ms'] = +q(0.99).toFixed(2)
    out['maxMs'] = okLat.length ? +okLat[okLat.length - 1]!.toFixed(2) : 0
    // ★诚实：失败率必须随吞吐一起看
    out['failRatePct'] = +((failed / total) * 100).toFixed(1)
    // ★失败归因（null = 无失败）：'失败得快'必须能解释为什么
    out['firstError'] = firstError
    g['__proteusHostPerfProbeResult'] = JSON.stringify(out)
  }

  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostPerfProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
