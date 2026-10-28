// hosts/shared/bridge/entry-superapp-probes-session.ts
// ★★★#1344 B-2：**会话式 VM 的最小 HTTP 探针**（`__proteusHostAppSessionHttpGet`）—— 单列文件。
//
// 【为什么单列】`entry-superapp-probes.ts` 已 963 行（上限 1000）；与 #1150/#1179/#1180/#1336
//   的单列是同一手法。
//
// 【为什么不复用 `appUseFetchProbe`】它是**流式 + 取消**探针（`onChunk` / `abort()`），
//   而鸿蒙的 `stream` 至今前置拒绝（`fetch.unsupported`）⇒ 用它验 B-2 会得到**假失败**
//   （实测踩过：`cancel_code:"fetch.unsupported"`、`stream_ok_flag:false`，看半天以为 HTTP 坏了）。
//   ⇒ B-2 要的是「**一个最简 GET 能不能拿到真实 status/body**」，必须用不带流式/取消的探针。
//
// 【它证明什么】`useFetch(url)` 这条**业务面**在会话式 VM 里真的完成一次往返：
//   拿到 `status`、`headers`、`data`（body 长度）。这是"异步回推打通"的最终证据 ——
//   因为 `useFetch` 内部走 `invokeBytes` 异步腿：宿主回 pending → 网络线程跑完 → tick 推帧 → Promise 结算。
export function appSessionHttpGet(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { probe: 'session-http-get', base }
  g['__proteusHostSessionHttpGetResult'] = ''

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown) => {
        useFetch: (url: string, cfg?: Record<string, unknown>) => Promise<{
          ok: boolean
          status?: number
          headers?: Record<string, string>
          data?: unknown
          error?: { code?: string; message?: string }
          meta?: { attempts?: number; transport?: Record<string, unknown> }
        }>
      }
      createCapabilityBridge: () => unknown
    }
    const hooks = mod.createCapabilityHooks(mod.createCapabilityBridge())
    // ★**不带 onChunk / signal / upload / savePath** —— 只要一次最简 GET
    const r = await hooks.useFetch(base, { timeout: 15000 })
    out['ok'] = r.ok === true
    if (r.ok) {
      out['status'] = r.status ?? -1
      out['headerCount'] = r.headers ? Object.keys(r.headers).length : 0
      try {
        out['bodyLen'] = JSON.stringify(r.data).length
      } catch {
        out['bodyLen'] = -2
      }
      out['attempts'] = r.meta?.attempts ?? -1
      // 传输读数的键名（证明宿主采集的那一段真的穿到了业务面）
      out['transportKeys'] = r.meta?.transport ? Object.keys(r.meta.transport).join(',') : ''
    } else {
      out['error'] = String(r.error?.code ?? '') + ':' + String(r.error?.message ?? '')
    }
    g['__proteusHostSessionHttpGetResult'] = JSON.stringify(out)
  }

  void run().catch((e: unknown) => {
    out['ok'] = false
    out['error'] = 'threw: ' + String((e as Error)?.message ?? e)
    g['__proteusHostSessionHttpGetResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
