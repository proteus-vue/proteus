// hosts/shared/bridge/entry-superapp-probes-session-cancel.ts
// ★★★#1344 B-2c：**会话内"真取消"探针**（两阶段：`start` / `abort`）—— 单列文件。
//
// 【它证明什么（B-2c 的全部意义）】
//   ① `abort()` 真的**打到了宿主**：`http.cancel` 在途表命中 ⇒ `HMS_Rcp_CancelRequest` 被调用
//   ② 宿主传输**真的中止**：慢响应（httpbin/delay/10）远早于到期就结束
//      （若传输没停，`fetch.aborted` 之后它还会跑满 10s/30s）
//   ③ JS 侧错误码正确：`fetch.aborted`
//
// 【★★★为什么必须两阶段（这是本轮踩出来的硬约束）】
//   第一版想"发请求 → 等 600ms → abort"，但 **App 精简引擎没有 `setTimeout`**
//   （`threw: setTimeout is not defined`，本仓 `capability-fetch-pipeline.ts` 的 `makeDelay`
//     就是为这条降级过的）。而**忙等不行**：它阻塞 JS 线程 ⇒ 请求根本发不出去
//     （本引擎是单线程同步调度，忙等期间谁都不跑）。
//   ⇒ 只能由**宿主侧（ArkTS）**做延迟：JS 先 `start`，ArkTS 等一会儿再 `abort`。
//     这个分工正好也符合真实场景 —— 业务点"取消"按钮本来就是另一个事件循环里的事。
//
// 【诚实边界】
//   · 验"宿主受理并发出取消"+"请求立即结束"；**不验**服务端是否收到 RST（需可控服务端）。
//   · 一次性 VM 下宿主仍回 `harmony-sync-napi` ⇒ 如实报 `cancel_supported:false`（不伪造）。
export function appSessionCancelStart(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { probe: 'session-cancel', phase: 'start', base }
  g['__proteusHostSessionCancelProbeResult'] = ''
  // ★把任务句柄挂到全局，供第二阶段 `abort` 取用
  ;(g as Record<string, unknown>)['__proteusSessionCancelTask'] = null

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown) => {
        useFetchTask: (url: string, cfg?: Record<string, unknown>) => {
          result: Promise<{ ok: boolean; status?: number; error?: { code?: string; message?: string } }>
          abort: (reason?: string) => void
        }
      }
      createCapabilityBridge: () => unknown
    }
    const hooks = mod.createCapabilityHooks(mod.createCapabilityBridge())
    const task = hooks.useFetchTask(base, { timeout: 30000 })
    ;(g as Record<string, unknown>)['__proteusSessionCancelTask'] = task
    out['started_at'] = Date.now()
    // ★请求已受理（Task 同步返回句柄，内部异步发出）⇒ 如实记阶段，不假装已完成
    g['__proteusHostSessionCancelProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['ok'] = false
    out['error_msg'] = 'start threw: ' + String((e as Error)?.message ?? e)
    g['__proteusHostSessionCancelProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}

/**
 * 第二阶段：中止在飞请求并等它的结果。
 * @returns 同步返回 `{phase:'abort'; abortedAt:<ms>}`；最终结果仍写 `__proteusHostSessionCancelProbeResult`
 */
export function appSessionCancelAbort(): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { probe: 'session-cancel', phase: 'abort' }
  const task = (g as Record<string, unknown>)['__proteusSessionCancelTask'] as
    | {
        result: Promise<{ ok: boolean; status?: number; error?: { code?: string; message?: string } }>
        abort: (reason?: string) => void
      }
    | null
    | undefined
  if (!task) {
    out['ok'] = false
    out['error_msg'] = 'abort: 没有在飞任务（start 阶段失败？）'
    g['__proteusHostSessionCancelProbeResult'] = JSON.stringify(out)
    return JSON.stringify({ phase: 'abort', error: 'no-task' })
  }
  const abortAt = Date.now()
  task.abort('probe:abort')
  out['aborted_at'] = abortAt
  void task.result
    .then((r) => {
      const totalMs = Date.now() - abortAt
      out['ok'] = r.ok === false
      out['error_code'] = String(r.error?.code ?? '')
      out['error_msg'] = String(r.error?.message ?? '').slice(0, 160)
      out['settle_ms_after_abort'] = totalMs
      // ★判据核心：abort 后应立即结算（< 2s）。若传输没停，会拖到 10s/30s。
      out['stopped_early'] = totalMs < 2000
      g['__proteusHostSessionCancelProbeResult'] = JSON.stringify(out)
    })
    .catch((e: unknown) => {
      out['ok'] = false
      out['error_msg'] = 'result threw: ' + String((e as Error)?.message ?? e)
      g['__proteusHostSessionCancelProbeResult'] = JSON.stringify(out)
    })
  return JSON.stringify({ phase: 'abort', abortedAt: abortAt })
}
