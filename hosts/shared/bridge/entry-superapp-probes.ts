// hosts/shared/bridge/entry-superapp-probes.ts
// ★★★真机判据探针（#1115 响应体上限 / #1118 流式通道）——从 entry-superapp.ts 拆出（决策 #1118 收尾）。
//
// 【为什么单列】entry-superapp.ts 已 1095 行（`check:file-size` 上限 1000）。
//   探针与本文件主体（应用装配 + 能力分发）是**两个职责**：探针只在真机判据里被 host 按中性名调用，
//   不参与应用运行路径。拆开也让判据更容易 grep 定位。
//
// 【调用方式不变】entry-superapp.ts import 后挂到 globalThis（键名一个字都没改）。
/**
 * ★★★决策 #1115：**响应体上限探针**（宿主经中性名 `__proteusHostAppFetchLimitProbe` 调）。
 *
 * 【它证明什么】`fetch.tooLarge` 这条**规模闸**在真机上真的生效——
 *   请求 64 MiB 响应（两倍于两端 32 MiB 上限），必须拿到 `code === 'fetch.tooLarge'`；
 *   若"成功返回"⇒ 上限未生效；若拿到笼统 `fetch.failed` ⇒ 错误码没到位（业务无法区分可否重试）。
 *
 * 【两道闸各测一次】`chunked=0` 带 content-length（走**预判**闸）；
 *   `chunked=1` 不带长度分块写（走**读取累计**闸，且必须真中止）。
 *   ★只测一个有洞：未知/谎报长度时预判失效。
 *
 * 【为什么用 `.then` 链不用 async/await】bundle 无定时器宿主（#1093 实测），与 transfer 探针同款。
 */
export function appFetchLimitProbe(base: string, sizeMiB = 64): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { size_mib: sizeMiB }
  g['__proteusHostFetchLimitProbeResult'] = ''
  const bytes = sizeMiB * 1024 * 1024
  const cases: Array<[string, string]> = [
    ['declared', `${base}/huge?size=${bytes}&chunked=0`],
    ['chunked', `${base}/huge?size=${bytes}&chunked=1`],
  ]
  // ★用 `createAppNativeCapabilities` 构造**真实桥**（与 hook 内部同一实现）——
  //   `createCapabilityHooks(undefined as never, …)` 那条路径桥是 undefined（本文件按屏实例化如此），
  //   拿它测等于测"没有桥"，不是测宿主上限。
  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability-app')) as unknown as {
      createAppNativeCapabilities: (E: unknown) => { request: (c: Record<string, unknown>) => Promise<unknown> }
    }
    class ProbeError extends Error {
      code: string
      constructor(code: string, message: string) { super(message); this.code = code }
    }
    const appCaps = mod.createAppNativeCapabilities(ProbeError as never)
    for (const [name, url] of cases) {
      try {
        await appCaps.request({ url, method: 'GET', timeout: 30000 })
        // ★成功返回 = 上限没生效（这是失败信号，不是成功）
        out[`${name}_too_large`] = false
        out[`${name}_ok`] = false
        out[`${name}_note`] = '上限未生效：请求成功返回'
      } catch (e) {
        const code = String((e as { code?: string })?.code ?? '')
        out[`${name}_code`] = code
        out[`${name}_too_large`] = code === 'fetch.tooLarge'
        out[`${name}_ok`] = code === 'fetch.tooLarge'
      }
    }
    out['ok'] = out['declared_ok'] === true && out['chunked_ok'] === true
    g['__proteusHostFetchLimitProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostFetchLimitProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true, cases: cases.map((c) => c[0]) })
}

/**
 * ★★★#1118：**流式通道探针**（S3 真机判据入口）。
 *
 * `appStreamProbe(base, chunks, size, delayMs)` → 走**真实桥**（`createAppNativeCapabilities`）
 * 请求 `/stream`，逐块消费并**逐字节校验**，把读数写进 `__proteusHostStreamProbeResult`。
 *
 * 【为什么要逐字节校验，不只数块数】
 *   块数对得上但内容错位（seq 乱序/拼接错位）在"只统计块数"的判据下**完全看不出来**——
 *   与 #1105「逐点差异测不出织纹」同族：判据的能力边界决定结论的可信边界。
 *   服务端按 `(i*31+j) & 0xff` 生成确定序列 ⇒ 消费侧能发现任意位置的错位。
 *
 * 【读数里为什么有 `max_gap_ms`】
 *   背压的证据不是"队列深度"（JS 侧看不到宿主队列），而是**块间到达间隔**：
 *   消费侧同步回调里若做慢处理，宿主队列满 ⇒ 块被压住 ⇒ 间隔拉长；
 *   反过来若间隔恒为 0 且总时长极短 ⇒ 说明**根本没形成背压**（本地回环太快）。
 *   ⇒ 判据必须报告它，而不是只看"成功了"。
 *
 * 【完成信号】结果写入全局键；宿主轮询该键（与 fetch-limit 探针同装置）。
 */
export function appStreamProbe(base: string, chunks = 64, size = 16 * 1024, delayMs = 0, slowMs = 0): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { chunks, size, delay_ms: delayMs, slow_ms: slowMs }
  g['__proteusHostStreamProbeResult'] = ''
  const url = `${base}/stream?chunks=${chunks}&size=${size}&delayMs=${delayMs}`

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability-app')) as unknown as {
      createAppNativeCapabilities: (E: unknown) => {
        request: (c: Record<string, unknown>) => Promise<unknown>
      }
    }
    class ProbeError extends Error {
      code: string
      constructor(code: string, message: string) { super(message); this.code = code }
    }
    const appCaps = mod.createAppNativeCapabilities(ProbeError as never)

    let gotChunks = 0
    let gotBytes = 0
    let mismatches = 0
    let firstMismatch = ''
    const seqs: number[] = []
    // ★★★#1118：**全局偏移**——块的边界由 TCP 分片决定（宿主 read 返回多少就是多少），
    //   "服务端块数"不是契约。判据只认"整条字节流是不是同一个确定序列"。
    //   （实测踩到：服务端发 256 块，宿主按 read 分片推了 768 块；按块数断言会把它判红，
    //     而实际数据完全正确——那是**判据**错，不是实现错。）
    let offset = 0
    let lastAt = 0
    let maxGapMs = 0
    const t0 = Date.now()

    try {
      await appCaps.request({
        url,
        method: 'GET',
        timeout: 60000,
        onChunk: (chunk: Uint8Array, seq: number) => {
          const now = Date.now()
          if (lastAt > 0) {
            const gap = now - lastAt
            if (gap > maxGapMs) maxGapMs = gap
          }
          lastAt = now
          seqs.push(seq)
          // ★逐字节校验（按**全局偏移**，与分片方式无关）：
          //   服务端序列 = byte[k] = ((floor(k/size))*31 + (k%size)) & 0xff
          for (let j = 0; j < chunk.length; j++) {
            const k = offset + j
            const want = (Math.floor(k / size) * 31 + (k % size)) & 0xff
            if (chunk[j] !== want) {
              mismatches++
              if (!firstMismatch) firstMismatch = `offset=${k} got=${chunk[j]} want=${want}`
            }
          }
          offset += chunk.length
          gotChunks++
          gotBytes += chunk.length
          // ★★#1118 装置：模拟**慢消费方**。onChunk 是同步的（在宿主回推的 JS 线程上）⇒
          //   这里忙等会把回推处理拖住 ⇒ 宿主有界队列被填满 ⇒ 读线程阻塞 ⇒ **真背压发生**。
          //   没有这一步，本地回环太快、队列从不满，"有没有背压"根本测不出来。
          if (slowMs > 0) { const until = Date.now() + slowMs; while (Date.now() < until) { /* 忙等 */ } }
        },
      })
      out['ok_return'] = true
    } catch (e) {
      out['ok_return'] = false
      out['error'] = String((e as Error)?.message ?? e)
      out['code'] = String((e as { code?: string })?.code ?? '')
    }

    out['elapsed_ms'] = Date.now() - t0
    out['got_chunks'] = gotChunks
    out['got_bytes'] = gotBytes
    out['expected_bytes'] = chunks * size
    out['mismatches'] = mismatches
    out['first_mismatch'] = firstMismatch
    out['max_gap_ms'] = maxGapMs
    // ★seq 必须严格 0..n-1 连续（JS 侧丢帧检测会 reject；这里再独立核一遍）
    let seqOk = seqs.length === gotChunks
    for (let i = 0; i < seqs.length; i++) if (seqs[i] !== i) { seqOk = false; break }
    out['seq_continuous'] = seqOk
    out['ok'] = out['ok_return'] === true
      && gotBytes === chunks * size
      && mismatches === 0
      && seqOk
    // ★不要求 gotChunks === chunks：块数由 TCP 分片决定，不是契约（见上面 offset 的说明）
    g['__proteusHostStreamProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostStreamProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true, url })
}
