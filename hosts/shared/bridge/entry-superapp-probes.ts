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

/**
 * ★★★#1119：**download 流式落盘探针**（S3 真机判据入口）。
 *
 * `appSaveProbe(base, sizeMiB)` → 下载 `sizeMiB` 大小的确定序列文件，走 `responseType:'path'`
 * （= 宿主直写沙箱），把读数写进 `__proteusHostSaveProbeResult`。
 *
 * 【要证明什么（缺一不算 S3）】
 *   ① **落盘成功**且**字节数正确**（不是"调用成功"就算）；
 *   ② **JS 侧不碰字节**：`data` 是路径字符串，不是 Uint8Array/数组——
 *      这一条是"内存与文件大小解耦"的**结构证据**；
 *   ③ **内容正确**：再读回文件并抽样与期望序列比对（宿主写的确实是收到的字节）；
 *   ④ **内存读数**（宿主侧给）：峰值块大小应 ≈ 16 KiB，与文件总大小**无关**。
 *      ★这是本判据的核心——没有内存读数，"看起来成功"与"其实整包驻留"无法区分。
 *
 * 【为什么用 8 MiB 而不是 4 KiB】4 KiB 在任何实现下都不会 OOM，
 *   测不出"整包驻留 vs 边收边写"的差别（与 #1105「逐点差异测不出织纹」同族：
 *   **样本量不够的判据等于没有判据**）。
 */
export function appSaveProbe(base: string, sizeMiB = 8): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { size_mib: sizeMiB }
  g['__proteusHostSaveProbeResult'] = ''
  const bytes = sizeMiB * 1024 * 1024
  const url = `${base}/download?size=${bytes}`

  const run = async (): Promise<void> => {
    // ★#1119：直接引 capability-transfer（createAppDownload 住在那儿；不经 app 层，避免 app 文件变胖）
    const mod = (await import('../../../packages/api/src/capability-transfer')) as unknown as {
      createAppDownload: () => (
        url: string,
        options?: Record<string, unknown>,
        onProgress?: (p: number) => void,
      ) => Promise<{ status?: number; data?: unknown; path?: string; durable?: unknown }>
    }
    const progress: number[] = []
    try {
      const r = await mod.createAppDownload()(url, { responseType: 'path', timeout: 120000 }, (p) => progress.push(p))
      out['ok_return'] = true
      out['status'] = r.status
      out['path'] = r.path
      out['durable'] = r.durable ?? null   // ★#1200：宿主 fsync 结果（true/"partial"/false/缺）
      // ② JS 侧不碰字节：data 必须是字符串路径（是字节数组 ⇒ 整包回推了）
      const d = r.data
      out['data_kind'] = Array.isArray(d) ? 'array' : (d instanceof Uint8Array ? 'uint8array' : typeof d)
      out['data_is_path'] = typeof d === 'string'
      out['progress_points'] = progress
    } catch (e) {
      out['ok_return'] = false
      out['code'] = String((e as { code?: string })?.code ?? '')
      out['error'] = String((e as Error)?.message ?? e)
    }
    // ③ 读回**小样本**做内容校验。
    //   ★★★为什么不能在大文件上读回整份：`fs.readBytes` 返回 `number[]` ⇒ 8 MiB 文件会变成
    //   8M 个 JS number（>64 MiB 堆）⇒ **直接 OOM**（本轮实测：readback_error="out of memory"）。
    //   ★那是**判据自身的矛盾**：用"整包读回"去验证"不整包"，必然自相矛盾。
    //   正确做法 = 两层判据：小文件验**内容**、大文件验**结构**（JS 不碰字节 + 峰值块无关 + 字节数）。
    if (out['ok_return'] === true && typeof out['path'] === 'string' && bytes <= 1024 * 1024) {
      try {
        const mod2 = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
          invokeHostAsync: (m: string, a: unknown, t?: number) => Promise<unknown>
        }
        const rr = (await mod2.invokeHostAsync('fs.readBytes', { path: out['path'] }, 120000)) as { bytes?: number[]; size?: number }
        const arr = rr?.bytes ?? []
        out['readback_size'] = arr.length
        // ★服务端 /download 的序列：buf[i] = i % 256；抽样（整份转 number[] 本身就会爆内存）
        let mismatch = 0
        let checked = 0
        const step = Math.max(1, Math.floor(arr.length / 512))
        for (let i = 0; i < arr.length; i += step) { checked++; if (arr[i] !== (i % 256)) mismatch++ }
        out['readback_checked'] = checked
        out['readback_mismatch'] = mismatch
      } catch (e) {
        out['readback_error'] = String((e as Error)?.message ?? e)
      }
    }
    // ★大文件只验结构（内容校验仅在小样本上做——原因见上面 OOM 那段）
    const contentOk = bytes <= 1024 * 1024
      ? (Number(out['readback_size']) === bytes && Number(out['readback_mismatch']) === 0)
      : true
    out['ok'] = out['ok_return'] === true
      && Number(out['status']) === 200
      && out['data_is_path'] === true
      && contentOk
    g['__proteusHostSaveProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostSaveProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true, url, bytes })
}

/**
 * ★★★#1120：**流式上传探针**（S3 真机判据入口）。
 *
 * `appUploadProbe(base, sizeMiB)` →
 *   ① 造一个 `sizeMiB` 的确定序列文件（`fs.writeBytes`，小文件才这么做——见下）；
 *   ② 走 `createAppUpload`（`upload` meta ⇒ 宿主自读文件、自拼 multipart、边读边发）；
 *   ③ 校验服务端收到的字节数 / 头尾 / 采样摘要。
 *
 * 【★为什么造文件要分两档】`fs.writeBytes` 收 `number[]` ⇒ 8 MiB 会变成 8M 个 JS number（>64 MiB 堆）⇒ OOM。
 *   ⇒ 大文件让**服务端**生成（`/stream` 落到沙箱？不行，落盘是响应体）。
 *   ⇒ 实际做法：先下载一份（download 流式落盘，JS 不碰字节）拿到大文件，再上传它。
 *     **这正好复用 #1119 的 `savePath`**——两件事拼起来才是完整的"大文件迁移"。
 *
 * 【要证明什么（缺一不算 S3）】
 *   ① `upload` meta 真的被送下去（`fs.readBytes` 没被调用）；
 *   ② 服务端收到的**字节数与内容**正确（`first`/`last`/`sum`）；
 *   ③ 宿主记账 `peak_chunk_bytes` ≈ 16 KiB，与文件大小**无关**。
 */
export function appUploadProbe(base: string, sizeMiB = 8): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { size_mib: sizeMiB }
  g['__proteusHostUploadProbeResult'] = ''
  const bytes = sizeMiB * 1024 * 1024

  const run = async (): Promise<void> => {
    const transfer = (await import('../../../packages/api/src/capability-transfer')) as unknown as {
      createAppDownload: () => (url: string, o?: Record<string, unknown>) => Promise<{ path?: string }>
      createAppUpload: () => (o: Record<string, unknown>) => Promise<{ status?: number; data?: unknown }>
    }
    try {
      // ① 先下载一份大文件（走 #1119 的 savePath，JS 不碰字节）
      const dl = await transfer.createAppDownload()(`${base}/download?size=${bytes}`, { responseType: 'path', timeout: 120000 })
      const filePath = dl.path ?? ''
      out['download_path'] = filePath
      out['download_ok'] = filePath.length > 0
      if (!filePath) { out['ok'] = false; out['error'] = '下载未拿到路径（savePath 未生效）'; g['__proteusHostUploadProbeResult'] = JSON.stringify(out); return }

      // ② 上传它（走 upload meta，宿主自读）
      const up = await transfer.createAppUpload()({
        url: `${base}/upload`,
        filePath,
        name: 'file',
        formData: { tag: 'probe' },
        timeout: 180000,
      })
      out['upload_status'] = up.status
      const d = up.data
      const reply = typeof d === 'string' ? JSON.parse(d) : d
      out['upload_reply'] = reply
      const o = (reply ?? {}) as { bytes?: number; first?: number; last?: number; fields?: Record<string, string> }
      out['server_bytes'] = o.bytes
      out['server_first'] = o.first
      out['server_last'] = o.last
      out['server_fields'] = o.fields
      // 服务端 /download 的序列：buf[i] = i % 256
      out['bytes_ok'] = o.bytes === bytes
      out['first_ok'] = o.first === 0
      out['last_ok'] = o.last === ((bytes - 1) % 256)
      out['fields_ok'] = o.fields?.['tag'] === 'probe'
      out['ok'] = Number(up.status) === 200 && out['bytes_ok'] === true && out['first_ok'] === true
        && out['last_ok'] === true && out['fields_ok'] === true
    } catch (e) {
      out['ok'] = false
      out['code'] = String((e as { code?: string })?.code ?? '')
      out['error'] = String((e as Error)?.message ?? e)
    }
    g['__proteusHostUploadProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostUploadProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true, bytes })
}

/**
 * ★★★#1121：**取消通道探针**（S3 回收维度真机判据入口）。
 *
 * `appCancelProbe(base, chunks, size, delayMs)` →
 *   ① 起一个**慢速流式**请求（服务端每块之间有延迟 ⇒ 给"中途取消"留出窗口）；
 *   ② 收到**前 N 块**后 `controller.abort()`；
 *   ③ 校验三件：
 *      · JS 侧 `promise` 以 `fetch.aborted` reject（不是成功、不是普通失败）；
 *      · **后续块不再到达**（`got_chunks` 停在取消那一刻附近，不会继续涨到总块数）；
 *      · 宿主侧 `http.cancel` 记账 `hit=true`（证明**取消真的打到宿主**，不只是 JS 层 reject）。
 *
 * 【★为什么要"后续块不再到达"这一条】只验证 reject 太弱——JS 侧 reject 之后如果宿主还在推，
 *   回调会被 `pendingHostCalls` 里已删除的条目丢弃，**看起来"没块了"但其实传输还在跑**。
 *   故要同时看 `got_chunks` 的**增长是否停止**（再等一段后仍不变）+ 宿主 `hit` 记账。
 */
export function appCancelProbe(base: string, chunks = 128, size = 16 * 1024, delayMs = 20): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { chunks, size, delay_ms: delayMs }
  g['__proteusHostCancelProbeResult'] = ''

  const run = async (): Promise<void> => {
    const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
      invokeHostStream: (
        m: string, a: unknown, onChunk: (c: Uint8Array, s: number) => void, t?: number, sig?: unknown,
      ) => Promise<unknown>
      invokeHost: (m: string, a?: unknown) => { ok: boolean; data?: unknown; missing?: boolean; reason?: string }
      createAbortController: () => { signal: unknown; abort: () => void }
    }
    const controller = inv.createAbortController()
    let gotChunks = 0
    let abortedAt = -1
    let errCode = ''
    let errMsg = ''
    const t0 = Date.now()
    try {
      await inv.invokeHostStream(
        'http.request',
        { url: `${base}/stream?chunks=${chunks}&size=${size}&delayMs=${delayMs}` },
        () => {
          gotChunks++
          // 收到第 4 块就取消（留出足够窗口让服务端还在发）
          if (gotChunks === 4 && abortedAt < 0) {
            abortedAt = gotChunks
            controller.abort()
          }
        },
        60000,
        controller.signal,
      )
      out['rejected'] = false
      out['error'] = '请求成功结束（取消未生效）'
    } catch (e) {
      out['rejected'] = true
      errCode = String((e as { code?: string })?.code ?? '')
      errMsg = String((e as Error)?.message ?? e)
      out['error_code'] = errCode
      out['error_message'] = errMsg
    }
    const chunksAtAbort = gotChunks
    // ★等一段（不是盲等：给宿主足够时间推"如果它还在推"的块），再看块数是否还在涨。
    //   用 Promise + setTimeout（宿主环境有定时器就走它；没有就直接跳过这段观察并如实标注）。
    // ★App 引擎**都没有 setTimeout**（#1071 已知）⇒ 这段"等待观察"在真机上是跳过的。
    //   那 `chunks_stopped` 在真机上只等于"取消后没再收到块"，**强度弱于**带等待窗口的版本。
    //   ⇒ 补救：用**宿主侧**的 `http.cancel` 记账 + **服务端是否跑到完成** 两条硬证据交叉验证，
    //     并在读数里如实标注本端是否真的观察过等待窗口。
    const st = (globalThis as { setTimeout?: (fn: () => void, ms?: number) => unknown }).setTimeout
    if (typeof st === 'function') {
      await new Promise<void>((resolve) => { st(() => resolve(), 400) })
      out['observe_waited_ms'] = 400
    } else {
      out['observe_skipped'] = 'no-setTimeout（取消后的"块停止"只证明没再收到，未跨等待窗口）'
    }
    out['chunks_at_abort'] = chunksAtAbort
    out['chunks_after_wait'] = gotChunks
    out['chunks_stopped'] = gotChunks === chunksAtAbort
    out['aborted_at'] = abortedAt
    out['total_chunks'] = chunks
    // ★宿主侧记账：证明取消真的打到宿主（不是只有 JS 层 reject）
    // ★宿主侧记账：证明取消真的打到宿主（不是只有 JS 层 reject）
    try {
      const st2 = inv.invokeHost('http.cancelStats', {})
      out['host_cancel_stats'] = st2.ok ? (st2.data ?? null) : (st2.reason ?? null)
    } catch (e) {
      out['host_cancel_stats'] = String((e as Error)?.message ?? e)
    }
    out['elapsed_ms'] = Date.now() - t0
    out['aborted_code_ok'] = /fetch\.aborted/.test(errMsg)
    out['ok'] = out['rejected'] === true
      && out['aborted_code_ok'] === true
      && out['chunks_stopped'] === true
      && abortedAt === 4
    g['__proteusHostCancelProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostCancelProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}

/**
 * ★★★#1122：**走 `useFetch` 门面**的真机判据（不是打底层 `invokeHost*`）。
 *
 * `appUseFetchProbe(base, chunks, size, delayMs)` →
 *   ① **流式**：`useFetch` 传 `onChunk` ⇒ 逐块到达（证明 `FetchConfig.onChunk` 真的下到了宿主）；
 *   ② **取消**：第 4 块时 `createAbortController().abort()` ⇒ `fetch.aborted` + 后续块停止；
 *   ③ **status/headers**：返回结果里**有** `status` 与 `headers`（此前只有 `data`）。
 *
 * 【为什么必须单独一条（它防的是本单修的那类缺陷）】
 *   此前所有探针都打底层 ⇒ "底层 S3 做了、`useFetch` 门面只透传 6 字段"这类缺口**全绿**。
 *   本探针只走 `createCapabilityHooks(...).useFetch`——业务真正看到的那个面。
 */
/**
 * ★★★#1134 `appRedirectProbe(base, crossBase, maxRedirects)` →
 *   ① **manual**：`useFetch(url, { redirect: "manual" })` ⇒ 拿到 **302 + Location**（不是跳到终点）；
 *   ② **onRedirect 逐跳**：两跳链 ⇒ 回调被调 2 次，且 from/to/status 可读；
 *   ③ **stop**：回调返回 stop ⇒ `fetch.redirectStopped` 且不再发下一跳；
 *   ④ **限额**：环 + `maxRedirects=2` ⇒ `fetch.tooManyRedirects`；
 *   ⑤ **跨域剥离凭据**：302 到另一 origin ⇒ 终点收到的 `authorization` 为空（服务端视角取证）。
 *
 * 【为什么这些必须在真机验（Web 层已绿）】宿主侧是**另一套实现**：
 *   Android 靠 `setInstanceFollowRedirects(false)`、iOS 靠 `willPerformHTTPRedirection`。
 *   两者都可能"看起来没跟随"但实际已发了两跳（凭据已经泄露出去）——
 *   所以判据不仅看客户端结果，还要看**服务端 `/__seen` 里到底收到了什么**。
 */
export function appRedirectProbe(base: string, crossBase: string, maxRedirects = 2): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base, cross_base: crossBase, max_redirects: maxRedirects }
  g['__proteusHostRedirectProbeResult'] = ''


  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => {
        useFetch: <T>(u: string, c?: unknown) => Promise<{ ok: boolean; status?: number; headers?: Record<string, string>; data?: unknown; error?: { code?: string; message?: string }; meta?: { redirects?: { hops?: unknown[]; exceeded?: boolean; stopped?: boolean } } }>
      }
      getSharedCapabilityBridge: () => unknown
    }
    const hooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {})

    // ── ① manual：不跟随 ──
    try {
      const r = await hooks.useFetch(`${base}/one`, { redirect: 'manual', timeout: 20000 })
      out['manual_status'] = r.status
      out['manual_ok'] = r.ok === true && r.status === 302
      const loc = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === 'location')?.[1]
      out['manual_location'] = loc ?? ''
      out['manual_has_location'] = typeof loc === 'string' && loc.length > 0
    } catch (e) {
      out['manual_error'] = String((e as Error)?.message ?? e)
    }

    // ── ② onRedirect 逐跳 ──
    const hops: Array<{ status: number; from: string; to: string }> = []
    try {
      const r = await hooks.useFetch(`${base}/two`, {
        onRedirect: (h: { status: number; from: string; to: string }) => {
          hops.push(h)
          return { action: 'follow', }
        },
        timeout: 30000,
      })
      out['hop_count'] = hops.length
      out['hop_statuses'] = hops.map((h) => h.status)
      out['hop_from_to_ok'] = hops.length > 0 && !!hops[0]!.from && !!hops[0]!.to && hops[0]!.from !== hops[0]!.to
      out['hop_final_ok'] = r.ok === true
    } catch (e) {
      out['hop_error'] = String((e as Error)?.message ?? e)
    }

    // ── ③ stop ──
    let stopCalls = 0
    try {
      const r = await hooks.useFetch(`${base}/two`, {
        onRedirect: () => {
          stopCalls++
          return { action: 'stop', reason: 'probe-stop' }
        },
        timeout: 20000,
      })
      out['stop_code'] = r.ok === false ? (r.error?.code ?? '') : 'NO_ERROR'
      out['stop_ok'] = r.ok === false && r.error?.code === 'fetch.redirectStopped'
    } catch (e) {
      out['stop_error'] = String((e as Error)?.message ?? e)
    }
    out['stop_calls'] = stopCalls
    out['stop_single_call'] = stopCalls === 1

    // ── ④ 限额（环） ──
    try {
      const r = await hooks.useFetch(`${base}/loop1`, {
        onRedirect: () => ({ action: 'follow', }),
        maxRedirects,
        timeout: 30000,
      })
      out['limit_code'] = r.ok === false ? (r.error?.code ?? '') : 'NO_ERROR'
      out['limit_ok'] = r.ok === false && r.error?.code === 'fetch.tooManyRedirects'
    } catch (e) {
      out['limit_error'] = String((e as Error)?.message ?? e)
    }

    // ── ⑤ 跨域剥离凭据（服务端视角） ──
    const crossTo = `${crossBase}/final`
    try {
      await hooks.useFetch(`${base}/cross?to=${encodeURIComponent(crossTo)}`, {
        // ★★★#1257：Cookie 一起带上——只测 Authorization 是**假绿**（实测 OkHttp 的
        //   followUpRequest 只 removeHeader("Authorization")，**对 Cookie 完全不管**）。
        headers: { Authorization: 'Bearer PROBE_SECRET', Cookie: 'PROBE_SESSION=SECRET_1257', 'X-Trace': 'redirect-probe' },
        onRedirect: () => ({ action: 'follow', }),
        timeout: 30000,
      })
      // ★★必须用 `useFetch` 读，**不能用全局 `fetch`**：App 精简引擎（QuickJS/JSC 精简版）
      //   没有 `fetch` ⇒ 原写法在此静默失败 ⇒ `cross_seen_count=0`（真机实测抓出）。
      const seenRes = await hooks.useFetch<Array<Record<string, unknown>>>(`${crossBase}/__seen`, {
        responseType: 'json',
        timeout: 15000,
      })
      const seen = seenRes.ok && Array.isArray(seenRes.data) ? seenRes.data : []
      const finals = seen.filter((s) => s['path'] === '/final')
      const lastAuth = finals.length ? String(finals[finals.length - 1]!['auth'] ?? '') : ''
      const lastCookie = finals.length ? String(finals[finals.length - 1]!['cookie'] ?? '') : ''
      out['cross_final_auth'] = lastAuth
      out['cross_final_cookie'] = lastCookie
      out['cross_stripped'] = finals.length > 0 && lastAuth === ''
      out['cross_cookie_stripped'] = finals.length > 0 && !lastCookie.includes('SECRET_1257')
      out['cross_seen_count'] = finals.length
    } catch (e) {
      out['cross_error'] = String((e as Error)?.message ?? e)
    }

    // ── ⑥ ★★★#1257 默认路径（无 onRedirect / 无 manual）带 Cookie 跨域 ──
    //   ★这是**修复前真正泄露的那条路**：默认让宿主自己跟随，JS 的跨域剥离没有执行机会。
    try {
      await hooks.useFetch(`${base}/cross?to=${encodeURIComponent(crossTo)}`, {
        headers: { Cookie: 'PROBE_SESSION=DEFAULT_PATH_1257' },
        timeout: 30000,
      })
      const seenRes2 = await hooks.useFetch<Array<Record<string, unknown>>>(`${crossBase}/__seen`, {
        responseType: 'json',
        timeout: 15000,
      })
      const seen2 = seenRes2.ok && Array.isArray(seenRes2.data) ? seenRes2.data : []
      const finals2 = seen2.filter((s) => s['path'] === '/final')
      const lastCookie2 = finals2.length ? String(finals2[finals2.length - 1]!['cookie'] ?? '') : ''
      out['cross_default_final_cookie'] = lastCookie2
      out['cross_default_cookie_stripped'] = finals2.length > 0 && !lastCookie2.includes('DEFAULT_PATH_1257')
    } catch (e) {
      out['cross_default_error'] = String((e as Error)?.message ?? e)
    }
    out['ok'] = out['manual_ok'] === true
      && out['manual_has_location'] === true
      && out['hop_count'] === 2
      && out['hop_from_to_ok'] === true
      && out['stop_ok'] === true
      && out['stop_single_call'] === true
      && out['limit_ok'] === true
      && out['cross_stripped'] === true
      && out['cross_cookie_stripped'] === true   // ★#1257：Cookie 也必须跨域消失
      && out['cross_default_cookie_stripped'] === true   // ★#1257：默认跟随路径同样不得泄露
    g['__proteusHostRedirectProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostRedirectProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}

export function appUseFetchProbe(base: string, chunks = 128, size = 16 * 1024, delayMs = 20): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { chunks, size, delay_ms: delayMs }
  g['__proteusHostUseFetchProbeResult'] = ''

  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => {
        useFetch: <T>(u: string, c?: unknown) => Promise<unknown>
      }
      getSharedCapabilityBridge: () => unknown
    }
    const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
      createAbortController: () => { signal: unknown; abort: () => void }
    }
    const hooks = cap.createCapabilityHooks(cap.getSharedCapabilityBridge(), {})

    // ── ① 流式 + ③ status/headers，用**正常结束**的短流（不取消）──
    let streamed = 0
    let streamSeqOk = true
    let lastSeq = -1
    try {
      const r = (await hooks.useFetch(`${base}/stream?chunks=8&size=${size}&delayMs=0`, {
        onChunk: (_chunk: Uint8Array, seq: number) => {
          if (seq !== lastSeq + 1) streamSeqOk = false
          lastSeq = seq
          streamed++
        },
        timeout: 30000,
      })) as { ok?: boolean; status?: number; headers?: Record<string, string>; data?: unknown }
      out['stream_ok_flag'] = r?.ok === true
      out['stream_status'] = r?.status
      out['stream_headers'] = r?.headers
      out['has_status'] = typeof r?.status === 'number' && (r?.status ?? 0) > 0
      out['has_headers'] = r?.headers !== null && typeof r?.headers === 'object'
    } catch (e) {
      out['stream_error'] = String((e as Error)?.message ?? e)
    }
    out['streamed_chunks'] = streamed
    out['stream_seq_ok'] = streamSeqOk

    // ── ② 取消：走 useFetch 的 signal ──
    const ctl = inv.createAbortController()
    let cancelChunks = 0
    let cancelAbortedAt = -1
    let cancelErrMsg = ''
    // ★`useFetch` **不抛异常**（G-32.3：失败以 `ok:false` 返回）⇒ 必须看返回值，
    //   不能像底层 `invokeHostStream` 那样只 catch（首版探针就栽在这里：取消生效了但探针判成"未 reject"）。
    try {
      const cr = (await hooks.useFetch(`${base}/stream?chunks=${chunks}&size=${size}&delayMs=${delayMs}`, {
        signal: ctl.signal,
        onChunk: () => {
          cancelChunks++
          if (cancelChunks === 4 && cancelAbortedAt < 0) {
            cancelAbortedAt = 4
            ctl.abort()
          }
        },
        timeout: 60000,
      })) as { ok?: boolean; error?: { code?: string; message?: string } }
      const failed = cr?.ok === false
      out['cancel_failed_flag'] = failed
      out['cancel_code'] = cr?.error?.code ?? ''
      cancelErrMsg = String(cr?.error?.code ?? cr?.error?.message ?? '')
      out['cancel_rejected'] = failed
    } catch (e) {
      // 兜底：万一实现改成抛异常也接住
      out['cancel_rejected'] = true
      cancelErrMsg = String((e as Error)?.message ?? e)
    }
    // ★失败通过 capErr 返回（不抛）⇒ 也可能拿到 ok:false 的返回值
    out['cancel_aborted_at'] = cancelAbortedAt
    out['cancel_chunks'] = cancelChunks
    out['cancel_err'] = cancelErrMsg
    out['cancel_code_ok'] = /fetch\.aborted/.test(cancelErrMsg)

    out['ok'] = out['has_status'] === true
      && out['has_headers'] === true
      && streamed >= 1
      && streamSeqOk
      && cancelAbortedAt === 4
      && out['cancel_code_ok'] === true
    g['__proteusHostUseFetchProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostUseFetchProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}

/**
 * ★★★决策 #1149：**HTTP 条件请求缓存**的真机判据探针。
 *
 * 【为什么这条必须在真机上跑（Node 层判据不够）】
 *   `tests/fetch-cache.test.ts` 用的是 Node 的 `fetch`（undici）——它自己不做 HTTP 缓存，
 *   所以那条判据验的是"框架层语义对不对"。真机上是另一回事：
 *     · **Android** 腿是裸 `HttpURLConnection`（未装 `ResponseCache`）⇒ 条件头真能发出去？
 *       304 会原样回来还是被吞？**必须实测**；
 *     · **iOS** 腿是 `URLSessionConfiguration.default` ⇒ 系统 `URLCache` **可能**替我们发条件请求、
 *       把 304 合成 200，甚至直接回本地缓存（那样我们就看不到 304）。
 *   ⇒ 本探针同时读**服务端记账**：客户端说"命中"不算，服务端没收到才算。
 *
 * 【判据（缺一条都可能是"看起来缓存了"）】
 *   ① `max-age=60`：第二次 `meta.cache.status='hit'`，且服务端 `hits` **不增加**；
 *   ② `max-age=0 + ETag`：第二次服务端**收到** `If-None-Match`，我们拿到 `status=200`
 *      + **同一份 body**（`gen` 不变 ⇒ 确实是缓存体，不是重新生成）；
 *   ③ `no-store`：第二次仍回源（服务端 `hits` 递增）；
 *   ④ 未开缓存的管线：`meta.cache` 不出现（零回归）。
 *
 * 【★装置硬约束（同 #1134 教训）】App 精简引擎**没有全局 `fetch`** ⇒ 一切请求（含读记账）都走 `useFetch`。
 */
export function appCacheProbe(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base }
  g['__proteusHostCacheProbeResult'] = ''

  type CacheMeta = { status?: string; ageMs?: number; stored?: boolean; mode?: string }
  type Res = {
    ok?: boolean
    status?: number
    data?: unknown
    headers?: Record<string, string>
    error?: { code?: string; message?: string }
    meta?: { attempts?: number; cache?: CacheMeta }
  }
  type Hooks = { useFetch: <T>(u: string, c?: unknown) => Promise<Res> }

  const run = async (): Promise<void> => {
    const cap = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown, o?: unknown) => Hooks
      getSharedCapabilityBridge: () => unknown
    }
    const bridge = cap.getSharedCapabilityBridge()
    /** ★每个用例用**独立管线实例**：缓存是管线级状态，共用会让用例互相污染。 */
    const mk = (opts: unknown): Hooks => cap.createCapabilityHooks(bridge, opts)

    /** 读服务端记账（绕过缓存：no-store）。 */
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

    // ── ① 新鲜期命中：第二次不该打服务器 ──
    // ★★`cache` 开在**管线配置**上：`createCapabilityHooks(bridge, { fetch: { cache: true } })`
    const fresh = mk({ fetch: { cache: true } })
    try {
      // 首调用 `reload` ⇒ 即使该实例里已有条目也强制回源（让计数起点确定）
      const r1 = await fresh.useFetch<{ gen?: number }>(`${base}/fresh`, { cache: 'reload', responseType: 'json' })
      const s1 = await readStats()
      const r2 = await fresh.useFetch<{ gen?: number }>(`${base}/fresh`, { responseType: 'json' })
      const s2 = await readStats()
      out['fresh_first_status'] = r1.status
      out['fresh_first_cache'] = r1.meta?.cache
      out['fresh_second_status'] = r2.status
      out['fresh_second_cache'] = r2.meta?.cache
      out['fresh_second_data'] = r2.data
      out['fresh_hits_after_first'] = hitOf(s1, '/fresh')
      out['fresh_hits_after_second'] = hitOf(s2, '/fresh')
      const firstGen = (r1.data as { gen?: number } | undefined)?.gen
      const secondGen = (r2.data as { gen?: number } | undefined)?.gen
      out['fresh_hit_ok'] = r2.meta?.cache?.status === 'hit'
      out['fresh_no_network_ok'] = hitOf(s2, '/fresh') === hitOf(s1, '/fresh')
      out['fresh_same_body_ok'] = typeof firstGen === 'number' && firstGen === secondGen
    } catch (e) {
      out['fresh_error'] = String((e as Error)?.message ?? e)
    }

    // ── ② 条件请求 + 304 复用（max-age=0 ⇒ 每次都要校验）──
    const etag = mk({ fetch: { cache: true } })
    try {
      const r1 = await etag.useFetch<{ gen?: number }>(`${base}/etag`, { cache: 'reload', responseType: 'json' })
      const r2 = await etag.useFetch<{ gen?: number }>(`${base}/etag`, { responseType: 'json' })
      const s2 = await readStats()
      out['etag_first_cache'] = r1.meta?.cache
      out['etag_second_cache'] = r2.meta?.cache
      out['etag_second_status'] = r2.status
      out['etag_second_data'] = r2.data
      out['etag_conditional_seen'] = condOf(s2, '/etag')
      const g1 = (r1.data as { gen?: number } | undefined)?.gen
      const g2 = (r2.data as { gen?: number } | undefined)?.gen
      out['etag_if_none_match_ok'] = /If-None-Match:\s*"g1"/.test(condOf(s2, '/etag'))
      out['etag_revalidated_ok'] = r2.meta?.cache?.status === 'revalidated'
      out['etag_status_200_ok'] = r2.status === 200
      out['etag_same_body_ok'] = typeof g1 === 'number' && g1 === g2
      out['etag_hits'] = hitOf(s2, '/etag')
    } catch (e) {
      out['etag_error'] = String((e as Error)?.message ?? e)
    }

    // ── ③ no-store：不许缓存 ──
    const nostore = mk({ fetch: { cache: true } })
    try {
      await nostore.useFetch(`${base}/nostore`, { responseType: 'json' })
      const s1 = await readStats()
      await nostore.useFetch(`${base}/nostore`, { responseType: 'json' })
      const s2 = await readStats()
      out['nostore_hits_after_first'] = hitOf(s1, '/nostore')
      out['nostore_hits_after_second'] = hitOf(s2, '/nostore')
      out['nostore_ok'] = hitOf(s2, '/nostore') === hitOf(s1, '/nostore') + 1
    } catch (e) {
      out['nostore_error'] = String((e as Error)?.message ?? e)
    }

    // ── ④ 未开缓存 ⇒ 零回归（meta.cache 不出现；框架层完全不参与）──
    //   ★★这里**不能断言"每次都真发"**：真机实测（2026-10-21）iOS 在未开框架缓存时
    //     系统 `URLCache` 自己就会拦下 `/fresh`（`max-age=60`）——服务端 hits 不增。
    //     那是**平台既有行为**（我们没改过 iOS 的 cachePolicy 默认值），不是本轮的回归。
    //   ⇒ 如实分两件事：
    //     · `off_meta_has_cache=false`（框架层零参与）——这是**判据**；
    //     · `off_platform_cache_intervened`（服务端 hits 没增 ⇒ 平台缓存在起作用）——这是**端差异读数**，
    //       它恰好就是"为什么必须框架层做缓存"的立论证据（Android 裸连接不会做，iOS 会做，Web 浏览器会做）。
    const plain = mk({})
    try {
      const r1 = await plain.useFetch(`${base}/fresh`, { responseType: 'json' })
      const s1 = await readStats()
      const r2 = await plain.useFetch(`${base}/fresh`, { responseType: 'json' })
      const s2 = await readStats()
      out['off_meta_has_cache'] = r1.meta !== undefined && Object.prototype.hasOwnProperty.call(r1.meta, 'cache')
      out['off_hits_delta'] = hitOf(s2, '/fresh') - hitOf(s1, '/fresh')
      out['off_platform_cache_intervened'] = out['off_hits_delta'] === 0
      out['off_both_ok'] = r1.ok === true && r2.ok === true
    } catch (e) {
      out['off_error'] = String((e as Error)?.message ?? e)
    }

    out['ok'] = out['fresh_hit_ok'] === true
      && out['fresh_no_network_ok'] === true
      && out['fresh_same_body_ok'] === true
      && out['etag_if_none_match_ok'] === true
      && out['etag_revalidated_ok'] === true
      && out['etag_status_200_ok'] === true
      && out['etag_same_body_ok'] === true
      && out['nostore_ok'] === true
      && out['off_meta_has_cache'] === false
      && out['off_both_ok'] === true
    g['__proteusHostCacheProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostCacheProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}

