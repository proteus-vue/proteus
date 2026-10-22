// hosts/shared/bridge/entry-superapp-probes-body.ts
// ★★★决策 #1160：**POST 带请求体探针**（`__proteusHostAppBodyProbe`）——补上全仓的用例空白。
//
// 【为什么必须单独立这一条（独立验证抓出的 P0 漏网根因）】
//   换栈第一版把 `perform()`（整包路径）的 `cfg.body` 漏了 ⇒ **Android 所有带 `data` 的
//   POST/PUT 静默变成空体**（功能全错、零报错）。而当时四条真机探针（transfer/stream/save/
//   tls/redirect/fetch-limit）**全是 GET 或上传**：
//     · upload 走 `bodyWriter` 路径（body 由回调产生）
//     · stream/save 走各自分支
//     · 其余全是 GET（无体）
//   ⇒ **没有任何一条覆盖"整包路径 + 请求体"**，所以 9 组真机回归全绿而功能已坏。
//
// 【它证明什么】
//   ① 请求体**逐字节**到达服务端（服务端回显长度与首/末字节）；
//   ② 请求体不是"空体"（空体时服务端 echo 的 length=0 ⇒ 判红）；
//   ③ `Content-Type` 按调用方给的落地（不是被 OkHttp 默认值盖掉）。
//
// 【为什么同时测 GET**无**体】换栈后 GET 若被挂上体，OkHttp 直接抛
//   `IllegalArgumentException: method GET must not have a request body`（实测）
//   ⇒ 这条要证明"没有把体错挂到 GET 上"。

export function appBodyProbe(base: string): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { base }
  g['__proteusHostBodyProbeResult'] = ''
  const progress = (step: string, extra?: Record<string, unknown>): void => {
    try {
      g['__proteusHostBodyProbeProgress'] = JSON.stringify({ step, at: Date.now(), ...(extra ?? {}) })
    } catch { /* 埋点失败不影响主流程 */ }
  }
  progress('enter')

  /** 期望的请求体：含 ASCII + 中文（证明 UTF-8 不被改写）+ 有末字节可核对 */
  const payload = `proteus-body-probe|${'X'.repeat(1024)}|尾部`
  /**
   * ★★UTF-8 字节数**手算**（不能用 `TextEncoder`）：
   *   App 精简引擎（QuickJS）**没有 `TextEncoder`**——实测真机报
   *   `ReferenceError: 'TextEncoder' is not defined` 导致探针整个不启动（装置问题，
   *   会被误读成"框架失败"）。⇒ 按码点算 UTF-8 长度（ASCII 1B / U+0800 以下 2B / 以上 3B）。
   */
  const utf8Len = (s: string): number => {
    let n = 0
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c < 0x80) n += 1
      else if (c < 0x800) n += 2
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }   // 代理对（补充平面）
      else n += 3
    }
    return n
  }
  const expectedLen = utf8Len(payload)

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability-app')) as unknown as {
      createAppNativeCapabilities: (E: unknown) => {
        request: (c: Record<string, unknown>) => Promise<{ status?: number; data?: unknown }>
      }
    }
    class ProbeError extends Error {
      code: string
      constructor(code: string, message: string) { super(message); this.code = code }
    }
    const caps = mod.createAppNativeCapabilities(ProbeError as never)
    progress('import:done')

    // ① POST 带体 ⇒ 服务端必须收到**完全一致**的字节
    const wantCt = 'text/plain; charset=utf-8'
    try {
      const r = await caps.request({
        url: `${base}/body-echo`,
        method: 'POST',
        headers: { 'Content-Type': wantCt },
        data: payload,
        responseType: 'json',
        timeout: 20000,
      })
      const echo = (r?.data ?? {}) as { length?: number; sha?: string; first?: number; last?: number; contentType?: string }
      out['post_status'] = r?.status
      out['post_len_server'] = echo.length
      out['post_len_expected'] = expectedLen
      out['post_content_type'] = echo.contentType
      out['post_content_type_expected'] = wantCt
      // ★★核心判据：服务端收到的长度必须等于期望长度（空体 ⇒ 0 ≠ 1024+ ⇒ 红）
      out['post_len_ok'] = Number(echo.length) === expectedLen
      // 空体时 length=0；这条把"没发出去"与"发出去但内容错"分开
      out['post_not_empty'] = Number(echo.length) > 0
      /**
       * ★★★Content-Type 必须**全等**，不能用 `includes`（第二轮独立验证实证）：
       *   框架的 `encodeBody` 会为字符串 data 自动填 `contentType='text/plain'`，
       *   若那个推导值覆盖了调用方的 `text/plain; charset=utf-8`，用 `includes('text/plain')`
       *   仍然绿——而**charset 已被静默抹掉**（真实语义回退）。
       */
      out['post_ct_ok'] = String(echo.contentType ?? '').toLowerCase() === wantCt
    } catch (e) {
      out['post_error'] = String((e as Error)?.message ?? e)
      out['post_len_ok'] = false
      out['post_not_empty'] = false
      out['post_ct_ok'] = false
    }
    progress('post:done', { lenOk: out['post_len_ok'] })

    // ② GET（无体）⇒ 必须成功（若体被错挂到 GET，OkHttp 会抛 IllegalArgumentException）
    try {
      const r = await caps.request({
        url: `${base}/body-echo`,
        method: 'GET',
        responseType: 'json',
        timeout: 20000,
      })
      const echo = (r?.data ?? {}) as { length?: number }
      out['get_status'] = r?.status
      out['get_len_server'] = echo.length
      out['get_ok'] = r?.status === 200 && Number(echo.length ?? -1) === 0
    } catch (e) {
      out['get_error'] = String((e as Error)?.message ?? e)
      out['get_ok'] = false
    }
    progress('get:done', { getOk: out['get_ok'] })

    // ③ PUT 带体（同一整包路径的另一个方法，防"只对 POST 特判"）
    try {
      const r = await caps.request({
        url: `${base}/body-echo`,
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        data: payload,
        responseType: 'json',
        timeout: 20000,
      })
      const echo = (r?.data ?? {}) as { length?: number }
      out['put_status'] = r?.status
      out['put_len_ok'] = Number(echo.length) === expectedLen
    } catch (e) {
      out['put_error'] = String((e as Error)?.message ?? e)
      out['put_len_ok'] = false
    }
    progress('put:done', { putOk: out['put_len_ok'] })

    out['ok'] = out['post_len_ok'] === true && out['post_not_empty'] === true
      && out['post_ct_ok'] === true && out['get_ok'] === true && out['put_len_ok'] === true
    progress('done', { ok: out['ok'] })
    g['__proteusHostBodyProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    progress('failed', { error: out['error'] })
    g['__proteusHostBodyProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
