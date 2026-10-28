// hosts/shared/bridge/entry-superapp-probes-session-stream.ts
// ★★★#1344 B-3：**会话内流式（逐块回推）探针** —— 单列文件。
//
// 【它证明什么（B-3 的全部意义）】
//   ① 会话模式下 `stream:true` **不再被前置拒绝**（宿主钩子已注册 ⇒ 放行）
//   ② 每个数据块**真的逐块到达** JS 的 `onChunk`（不是最后一次性给整包）
//   ③ `seq` **从 0 起连续**（宿主按块编号，JS 侧跳号即判丢帧）
//   ④ 收到的**总字节数**与请求一致（不是"块数对了但内容缺"）
//   ⑤ 最终结果 `ok:true` + `status:200`（流结束后照常结算，不是挂在半路）
//
// 【★为什么必须用本地 /stream 端点（而非公网）】
//   公网端点（httpbin）不保证分块边界：可能把 8 行合成 1 个 TCP 段 ⇒ 只看到 1 块，
//   于是"逐块"这件事**无法被证伪**。本地 `transfer-echo-server.mjs` 的
//   `/stream?chunks=N&size=B&delayMs=D` 按 N 次 `res.write` + 间隔写出 ⇒ 块数确定。
//   ★并且它每次写前有 delay，能证明"块是**陆续**到的"，不是末尾一起冲进来。
//
// 【为什么是单阶段（不像 cancel 那样两阶段）】
//   取消需要"等请求在飞再 abort"，而 App 精简引擎没有 `setTimeout` ⇒ 只能宿主侧定时。
//   流式不需要外部触发：**发起后由 tick 推块**，块到齐自然结算。
//   探针本身同步返回"已发起"，最终结果写 `__proteusHostSessionStreamProbeResult`。
//
// 【诚实边界】
//   · 不验背压（消费方是同步计数，不制造慢消费）；背压属 Android/iOS 的既有判据。
//   · 不验 `savePath` 与 stream 同时出现（本仓语义是 savePath 优先落盘；此处不混用）。
export function appSessionStreamStart(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { probe: 'session-stream', phase: 'start', base }
  g['__proteusHostSessionStreamProbeResult'] = ''

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown) => {
        useFetch: (url: string, cfg?: Record<string, unknown>) => Promise<{
          ok: boolean
          status?: number
          data?: unknown
          error?: { code?: string; message?: string }
        }>
      }
      createCapabilityBridge: () => unknown
    }
    const hooks = mod.createCapabilityHooks(mod.createCapabilityBridge())

    let chunks = 0
    let bytes = 0
    let seqOk = true
    let lastSeq = -1
    /** 首块与末块的到达时刻（证明"陆续到达"而不是末尾一次性） */
    let firstAt = 0
    let lastAt = 0

    // ★端点参数由宿主场景传入（默认 8 块 × 4 KiB）；与 `transfer-echo-server.mjs` 的契约一致
    const r = await hooks.useFetch(base, {
      onChunk: (chunk: Uint8Array, seq: number) => {
        // ★seq 连续性 = 宿主没有丢帧（JS 的 settleHostCallBytes 也会独立校验一次；
        //   这里再记一遍是为了**探针自带判据**，不依赖被测实现的报错）
        if (seq !== lastSeq + 1) seqOk = false
        lastSeq = seq
        chunks++
        bytes += chunk?.length ?? 0
        const now = Date.now()
        if (firstAt === 0) firstAt = now
        lastAt = now
      },
      timeout: 30000,
    })

    out['ok'] = r.ok === true
    out['status'] = r.status
    out['chunks'] = chunks
    out['bytes'] = bytes
    out['seq_ok'] = seqOk
    out['last_seq'] = lastSeq
    out['error_code'] = r.error?.code ?? ''
    out['error_msg'] = String(r.error?.message ?? '').slice(0, 160)
    // ★首末块时间差：> 0 说明块**分散到达**（配合服务端 delayMs，可区分"逐块"与"末尾整包"）
    out['spread_ms'] = firstAt > 0 && lastAt >= firstAt ? lastAt - firstAt : -1
    g['__proteusHostSessionStreamProbeResult'] = JSON.stringify(out)
  }

  void run().catch((e: unknown) => {
    out['ok'] = false
    out['error_msg'] = 'stream probe threw: ' + String((e as Error)?.message ?? e)
    g['__proteusHostSessionStreamProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
