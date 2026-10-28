// hosts/shared/bridge/entry-superapp-probes-persist.ts
// ★★★决策 #1151：**HTTP 缓存持久层（L2）**的真机判据探针——**两阶段跨进程**。
//
// 【为什么必须跨进程（这是本探针唯一的存在理由）】
//   `tests/fetch-cache-persist.test.ts` 用"新 store 实例"模拟重启，它证明代码路径对。
//   但真机上还有一件 Node 判据**根本证不了**的事：
//     **宿主真的把字节写到盘上了吗？下次进程启动真的能读回来吗？**
//   （App 端要经 `fs.writeBytes` → 宿主 → 沙箱文件；iOS 返回 `{bytes:[...]}`、
//     Android 走 `FileTransferCapability`——任一环不通，持久层就是"看起来实现了"。）
//   ⇒ 分两次进程启动：
//     ① `phase=write`：请求一次（落盘）→ 报告 → **进程退出**；
//     ② `phase=read` ：**新进程**（内存空）再请求同一 URL ⇒ 必须命中，且服务端 hits 不增。
//   ★判据的硬证据在**服务端记账**：第二次请求如果真发了，`hits` 会 +1。
//
// 【判据】
//   ① `phase=write`：`stored=true` 且落盘成功（`persistStats.writes > 0`）
//   ② `phase=read` ：`status='hit'`（来自盘上，不是内存）+ 服务端 hits 与 write 阶段相同
//   ③ 体内容与首次一致（`gen` 不变）
//
// 【★装置形态】沿用 #1122 起的范式：宿主按中性名调 → 探针写结果全局键 → runner 轮询落盘。

/**
 * 持久化缓存探针。`phase`：
 *   · `write`：只写（请求 + 落盘 + 报告写入数）；
 *   · `read` ：只读（**新进程**；断言命中且服务端零请求）。
 */
export function appPersistProbe(base: string, phase: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base, phase }
  g['__proteusHostPersistProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostPersistProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  type Res = {
    ok?: boolean
    status?: number
    data?: unknown
    headers?: Record<string, string>
    error?: { code?: string; message?: string }
    meta?: { cache?: { status?: string; stored?: boolean } }
  }
  type Controller = { useFetch: <T>(u: string, c?: unknown) => Promise<Res> }

  const run = async (): Promise<void> => {
    progress('import:start')
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => Controller
      getSharedCapabilityBridge: () => unknown
    }
    const persistMod = (await import('../../../packages/api/src/capability-fetch-cache-persist')) as unknown as {
      createPersistentFetchCache: (o: unknown) => {
        flush: () => Promise<void>
        persistStats: () => {
          writes: number
          loads: number
          writeErrors: number
          evicted: number
          quotaShrinks: number
          persistBytes: number
          persistEntries: number
        }
        persistBudget?: () => number
      }
    }
    const runtimeMod = (await import('../../../packages/api/src/capability-fetch-cache-runtime')) as unknown as {
      choosePersistBackend: (o?: unknown) => { backend?: unknown; degraded: boolean; reason: string }
    }
    progress('import:done')

    // ★★★**write 阶段前必须先清盘**（判据的生死线）。
    //   【为什么】首版漏了这步，iOS 真机读到 `ageMs=91620`（约 25 小时）——
    //   那是我前一天调试留下的旧条目，而两次运行只差 92 秒。
    //   ⇒ 不清盘时，**任何残留都能让"重启后命中"通过** ⇒ 判据假绿（证明不了这次的 write 生效）。
    //   ★为什么放在探针里而不是 runner：清盘要对"这一端真实用的那套介质"操作，
    //     runner 是 shell（Android 能 `rm -rf` 目录，iOS 不能）⇒ 端无关的清盘只能靠 backend 自己。
    //     `backend.clearAll()` 两端都有：KV 删前缀键、文件删**单文件**（不需要 readdir）。
    if (phase === 'write') {
      progress('clear:start')
      try {
        const backend0 = runtimeMod.choosePersistBackend({ dir: 'cache/probe-http' }).backend as
          | { keys: () => Promise<string[]>; clearAll: () => Promise<void>; kind: string }
          | undefined
        if (backend0) {
          const before = await backend0.keys()
          await backend0.clearAll()
          out['cleared_keys'] = before.length
          out['cleared_after'] = (await backend0.keys()).length
        }
      } catch (e) {
        out['clear_error'] = String((e as Error)?.message ?? e)
      }
      progress('clear:done', { cleared: out['cleared_keys'], remaining: out['cleared_after'] })
    }

    // ★先取证"这一端到底会用哪个后端"——判据要能分辨"选了文件"与"降级成内存"
    const choice = runtimeMod.choosePersistBackend({ dir: 'cache/probe-http' })
    out['backend_reason'] = choice.reason
    out['backend_kind'] = (choice.backend as { kind?: string } | undefined)?.kind ?? 'none'
    out['degraded'] = choice.degraded
    if (!choice.backend) {
      out['ok'] = false
      out['error'] = `拿不到持久化介质（${choice.reason}）—— 该端没有可用的存储/文件能力`
      progress('failed', { error: out['error'] })
      g['__proteusHostPersistProbeResult'] = JSON.stringify(out)
      return
    }

    // ★用**显式 backend** 建 store（不去重复探测；探测结果已在上面记录）
    // ★#1152：主判据（跨进程命中）用**默认预算**——小预算留给下面独立的淘汰阶段，
    //   否则小预算会把主条目自己挤掉（首版就这么假红过：read 阶段 miss）。
    const store = persistMod.createPersistentFetchCache({
      backend: choice.backend,
      flushDelayMs: 0,
    })
    const hooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {
      fetch: { cache: { store } },
    }) as Controller

    const url = `${base}/persist`
    if (phase === 'write') {
      progress('write:request')
      const r = await hooks.useFetch<{ gen?: number }>(url, { responseType: 'json', timeout: 20000 })
      progress('write:done', { status: r.status, cache: r.meta?.cache })
      out['write_ok'] = r.ok === true
      out['write_status'] = r.status
      out['write_gen'] = (r.data as { gen?: number } | undefined)?.gen
      out['write_cache'] = r.meta?.cache
      // ★必须显式 flush：App 端落盘是 fire-and-forget，进程退出前不等它就白写
      progress('write:flush')
      await store.flush()
      const st = store.persistStats()
      progress('write:flushed', { stats: st })
      out['persist_stats'] = st
      out['write_persisted_ok'] = st.writes > 0 && st.writeErrors === 0

      /**
       * ★★★#1152：**淘汰阶段**——写多条不同 URL 直到明显超过 6 KB 预算。
       * 【为什么必须真机做】Node 判据用的是 KV/文件桩；真机上"字节数估算 + manifest 记账 +
       *   删除真的生效"是另一条链路（App 侧每次写都要重写整份单文件）。
       * 【判据】`persistBytes ≤ 预算` 且 `evicted > 0` —— 前者证明"不无限增长"，后者证明"淘汰真的发生"。
       *
       * ★★★**必须用独立 store + 独立 backend 目录**（首版与主判据共用一个，结果把主条目挤掉了
       *   ⇒ read 阶段 miss ⇒ 四条主判据连带假红）。
       *   "淘汰"这件事本来就会删数据：让它和"跨进程命中"共用同一份缓存 =
       *   两个判据互相破坏（本仓"一条命令内别并行跑两件会写同一产物的事"的同族）。
       */
      progress('evict:start')
      const evictDir = 'cache/probe-http-evict'
      const evictChoice = runtimeMod.choosePersistBackend({ dir: evictDir })
      const budget = 6000
      out['persist_budget'] = budget
      try {
        if (!evictChoice.backend) throw new Error(`拿不到介质（${evictChoice.reason}）`)
        const evictStore = persistMod.createPersistentFetchCache({
          backend: evictChoice.backend,
          flushDelayMs: 0,
          maxPersistBytes: budget,
        })
        // ★先清空这块**独立**目录（避免上一轮残留混入；独立目录 = 与主判据隔离）
        const backend0 = evictChoice.backend as { clearAll?: () => Promise<void> }
        await backend0.clearAll?.()
        progress('evict:cleared')
        const evictHooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {
          fetch: { cache: { store: evictStore } },
        }) as Controller
        for (let i = 0; i < 12; i++) {
          // 每个参数不同 ⇒ 不同缓存键；`pad` 让体大到足以撑满预算
          await evictHooks.useFetch(`${base}/persist?i=${i}&pad=1200`, { responseType: 'json', timeout: 15000 })
          progress('evict:write', { i })
        }
        progress('evict:flushing')
        await evictStore.flush()
        const st2 = evictStore.persistStats()
        progress('evict:done', { stats: st2 })
        out['evict_stats'] = st2
        out['evict_ok'] = st2.evicted > 0
        out['budget_respected_ok'] = st2.persistBytes <= budget
      } catch (e) {
        // ★不能让它卡死：淘汰阶段失败要**如实记录**（否则整个探针超时、主判据全空）
        out['evict_error'] = String((e as Error)?.message ?? e)
        out['evict_ok'] = false
        out['budget_respected_ok'] = false
        progress('evict:error', { error: out['evict_error'] })
      }
      out['ok'] = out['write_ok'] === true && out['write_persisted_ok'] === true
        && out['evict_ok'] === true && out['budget_respected_ok'] === true
    } else {
      progress('read:request')
      const r = await hooks.useFetch<{ gen?: number }>(url, { responseType: 'json', timeout: 20000 })
      progress('read:done', { status: r.status, cache: r.meta?.cache })
      out['read_ok'] = r.ok === true
      out['read_status'] = r.status
      out['read_gen'] = (r.data as { gen?: number } | undefined)?.gen
      out['read_cache'] = r.meta?.cache
      const st = store.persistStats()
      out['persist_stats'] = st
      // ★核心：命中且**来自盘上**（loads>0 证明"读盘发生过"，不是内存碰巧有）
      out['read_hit_ok'] = r.meta?.cache?.status === 'hit'
      out['read_from_disk_ok'] = st.loads > 0
      // ★★注意：这里**不**要求"命中即不走网络"——find 是否真的没打服务器，由 runner 侧的
      //   服务端记账判定（客户端无法自证）。探针只如实回报 meta。
      out['ok'] = out['read_ok'] === true && out['read_hit_ok'] === true && out['read_from_disk_ok'] === true
    }
    progress('done', { ok: out['ok'] })
    g['__proteusHostPersistProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostPersistProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
