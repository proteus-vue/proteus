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
      ) => Promise<{ status?: number; data?: unknown; path?: string }>
    }
    const progress: number[] = []
    try {
      const r = await mod.createAppDownload()(url, { responseType: 'path', timeout: 120000 }, (p) => progress.push(p))
      out['ok_return'] = true
      out['status'] = r.status
      out['path'] = r.path
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

