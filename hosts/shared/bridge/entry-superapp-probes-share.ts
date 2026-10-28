// hosts/shared/bridge/entry-superapp-probes-share.ts
// ★★★#1336 C22 `share` 真机探针（`--share-probe=1`）—— **单列文件**。
//
// 【为什么单列】`entry-superapp-probes.ts` 已 962 行（新文件上限 1000，`check:file-size` 硬门禁）。
//   这与决策 #1150 把 RFC 5861 探针单列（`entry-superapp-probes-stale.ts`）、
//   #1179/#1180 把 HTTPDNS 探针单列是**同一手法**——不是为过门禁而拆，是同一族探针各自成文件。
//
// 【它证明什么】
//   ① 合法载荷（文本 / 链接）⇒ `useShare` 返回 ok（宿主受理，系统面板派发）；
//   ② **危险 URL scheme 必须被拒**（`file://` / `javascript:` / 自定义 scheme）——安全边界：
//      分享会把链接递给**别的 App**，`file:` 等于泄漏本机路径；
//   ③ 空载荷被拒（不拉起空面板）；
//   ④ ★★**直调宿主**（绕过 JS 层 assertShareOptions）单独验宿主那一层白名单——
//      走 useShare 时 JS 层先拦，宿主不校验也看不出来 ⇒ 只改宿主的变异会假绿（同 #1285 ⑤ 的教训）。
//
// 【不证明什么】不证明"用户真的选了某个目标并发送成功"（那属系统 UI 内的行为）；
//   鸿蒙走动作队列 ⇒ 回执是 `{accepted:true}`（已入队），面板是否真拉起由 hilog 的
//   `PROTEUS_SHARE_OK` 取证（见 `hosts/harmony/run-share-probe.sh`）。
export function appShareProbe(): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { share: 'probe' }
  g['__proteusHostShareProbeResult'] = ''

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown) => {
        useShare: (o: { title?: string; text?: string; url?: string }) => Promise<{ ok: boolean; error?: { code?: string; message?: string } }>
      }
      createCapabilityBridge: () => unknown
    }
    const hooks = mod.createCapabilityHooks(mod.createCapabilityBridge())

    // ① 合法：纯文本
    const goodText = await hooks.useShare({ text: 'Proteus share probe（#1336）' })
    out['good_text_ok'] = goodText.ok === true
    if (!goodText.ok) out['good_text_error'] = String(goodText.error?.code ?? '') + ':' + String(goodText.error?.message ?? '')

    // ①b 合法：链接
    const goodUrl = await hooks.useShare({ title: 'Proteus', text: '分享一条链接', url: 'https://proteus.dev/' })
    out['good_url_ok'] = goodUrl.ok === true
    if (!goodUrl.ok) out['good_url_error'] = String(goodUrl.error?.code ?? '') + ':' + String(goodUrl.error?.message ?? '')

    // ②★★ 危险 scheme 必须被拒（`file:` = 本机路径泄漏）
    const badFile = await hooks.useShare({ url: 'file:///etc/passwd' })
    out['bad_file_rejected'] = badFile.ok === false
    out['bad_file_code'] = String(badFile.error?.code ?? '')

    // ②b 可执行语义
    const badJs = await hooks.useShare({ url: 'javascript:alert(1)' })
    out['bad_js_rejected'] = badJs.ok === false

    // ②c 自定义 scheme（深链）
    const badCustom = await hooks.useShare({ url: 'myapp://deep/link' })
    out['bad_custom_rejected'] = badCustom.ok === false

    // ③ 空载荷（不拉起空面板）
    const empty = await hooks.useShare({})
    out['empty_rejected'] = empty.ok === false

    // ④★★ 直调宿主层（绕过 JS 白名单）——证明宿主那一层也真的在拦
    const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
      invokeHost: (m: string, a?: unknown) => { ok: boolean; data?: unknown; reason?: string; missing?: boolean }
    }
    const hostBad = inv.invokeHost('share', { url: 'file:///etc/passwd' })
    out['host_direct_file_rejected'] = hostBad.ok === false
    out['host_direct_file_reason'] = String(hostBad.reason ?? '')
    const hostEmpty = inv.invokeHost('share', {})
    out['host_direct_empty_rejected'] = hostEmpty.ok === false
    // 宿主直调合法载荷：仅断言"受理"（面板是否真的弹出由设备侧取证）
    const hostGood = inv.invokeHost('share', { text: 'Proteus share probe（宿主直调）' })
    out['host_direct_good_ok'] = hostGood.ok === true

    out['ok'] = out['good_text_ok'] === true
      && out['good_url_ok'] === true
      && out['bad_file_rejected'] === true
      && out['bad_js_rejected'] === true
      && out['bad_custom_rejected'] === true
      && out['empty_rejected'] === true
      && out['host_direct_file_rejected'] === true
      && out['host_direct_empty_rejected'] === true
      && out['host_direct_good_ok'] === true
    g['__proteusHostShareProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostShareProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
