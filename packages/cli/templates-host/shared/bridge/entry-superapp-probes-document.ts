// hosts/shared/bridge/entry-superapp-probes-document.ts
// ★★★#1384 C84 `openDocument` 真机探针（`--document-probe=1`）—— **单列文件**。
//
// 【为什么单列】`entry-superapp-probes.ts` 已 962 行（新文件上限 1000，`check:file-size` 硬门禁）。
//   与 #1336 的 `entry-superapp-probes-share.ts`、#1150 的 probes-stale、#1179 的 HTTPDNS 探针
//   是同一手法——同一族探针各自成文件，不是为过门禁而拆。
//
// 【它证明什么】
//   ① 合法沙箱文件 ⇒ `useOpenDocument` 返回 ok（宿主受理，系统预览器派发）；
//   ② **越界路径必须被拒**（绝对路径 / `..`）——安全边界：预览会把文件字节交给**另一个 App**；
//   ③ **非白名单扩展名必须被拒**（`.exe` 之类不得"降级成 octet-stream 试着打开"）；
//   ④ 沙箱里不存在的文件 ⇒ 报错（不是假成功）；
//   ⑤ ★★**直调宿主**（绕过 JS 层校验）单独验宿主那一层白名单——
//      走 `useOpenDocument` 时 JS 层先拦，宿主不校验也看不出来 ⇒ 只改宿主的变异会**假绿**
//      （#1285 ⑤ / #1336 ④ 同款教训）。
//
// 【★前置（探针自己准备，不依赖外部推文件）】
//   写一个最小 PDF 到沙箱（`__DOC_PROBE__/sample.pdf`）——本探针**自己调 `fs.writeBytes`** 造夹具，
//   这样三端同一个探针都能跑（不需要 adb push / hdc file send 各写一遍）。
//   ★写失败 ⇒ 直接判失败并写明原因（不静默跳过——那是假绿）。
//
// 【不证明什么】不证明"用户真的看了文档"（预览器没有关闭回调）；
//   鸿蒙走动作队列 ⇒ 回执是 `{accepted:true}`（已入队），面板是否真拉起由
//   `PROTEUS_DOC_PREVIEW_OK` 日志取证（见 `hosts/harmony/run-document-probe.sh`）。
export function appDocumentProbe(): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { document: 'probe' }
  g['__proteusHostDocumentProbeResult'] = ''

  /** 最小合法 PDF（1 页，内容为空白）——字节数组形式，直接给 `fs.writeBytes` */
  const MINIMAL_PDF = [
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,        // %PDF-1.4\n
    0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a,               // 1 0 obj\n
    0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x43, 0x61,    // <</Type/Ca
    0x74, 0x61, 0x6c, 0x6f, 0x67, 0x3e, 0x3e, 0x0a,               // talog>>\n
    0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a,                     // endobj\n
    0x74, 0x72, 0x61, 0x69, 0x6c, 0x65, 0x72, 0x0a,               // trailer\n
    0x3c, 0x3c, 0x2f, 0x52, 0x6f, 0x6f, 0x74, 0x20, 0x31, 0x20,    // <</Root 1
    0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a,                           // 0 R>>\n
    0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a,                           // %%EOF\n
  ]

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown) => {
        useOpenDocument: (p: string) => Promise<{ ok: boolean; error?: { code?: string; message?: string } }>
      }
      createCapabilityBridge: () => unknown
    }
    const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
      invokeHost: (m: string, a?: unknown) => { ok: boolean; data?: unknown; reason?: string; missing?: boolean }
    }

    // ── ① 造夹具：写一个最小 PDF 进沙箱 ──
    const probeDir = '__DOC_PROBE__'
    const pdfRel = `${probeDir}/sample.pdf`
    const w = inv.invokeHost('fs.writeBytes', { path: pdfRel, bytes: MINIMAL_PDF })
    out['fixture_written'] = w.ok === true
    if (!w.ok) {
      out['fixture_error'] = String(w.reason ?? '')
      out['ok'] = false
      g['__proteusHostDocumentProbeResult'] = JSON.stringify(out)
      return
    }
    // 一个非白名单扩展名的同名文件（验"扩展名白名单在宿主/JS 都要拦"）
    const exeRel = `${probeDir}/evil.exe`
    inv.invokeHost('fs.writeBytes', { path: exeRel, bytes: [0x4d, 0x5a] })

    const hooks = mod.createCapabilityHooks(mod.createCapabilityBridge())

    // ── ② 合法：预览沙箱内 PDF ──
    const good = await hooks.useOpenDocument(pdfRel)
    out['good_ok'] = good.ok === true
    if (!good.ok) out['good_error'] = String(good.error?.code ?? '') + ':' + String(good.error?.message ?? '')

    // ── ③ 越界路径必须被拒（安全边界）──
    const abs = await hooks.useOpenDocument('/etc/passwd.pdf')
    out['abs_rejected'] = abs.ok === false
    out['abs_code'] = String(abs.error?.code ?? '')
    const dotdot = await hooks.useOpenDocument('../escape.pdf')
    out['dotdot_rejected'] = dotdot.ok === false
    out['dotdot_code'] = String(dotdot.error?.code ?? '')

    // ── ④ 非白名单扩展名必须被拒（不降级 octet-stream）──
    const exe = await hooks.useOpenDocument(exeRel)
    out['exe_rejected'] = exe.ok === false
    out['exe_code'] = String(exe.error?.code ?? '')

    // ── ⑤ 沙箱内不存在的文件 ⇒ 报错（不是假成功）──
    const missing = await hooks.useOpenDocument(`${probeDir}/not-there.pdf`)
    out['missing_rejected'] = missing.ok === false
    out['missing_code'] = String(missing.error?.code ?? '')

    // ── ⑥★★ 直调宿主层（绕过 JS 校验）——证明宿主那一层也真的在拦 ──
    const hostAbs = inv.invokeHost('document.open', { path: '/etc/passwd.pdf', mimeType: 'application/pdf' })
    out['host_direct_abs_rejected'] = hostAbs.ok === false
    out['host_direct_abs_reason'] = String(hostAbs.reason ?? '')
    const hostDotdot = inv.invokeHost('document.open', { path: '../x.pdf', mimeType: 'application/pdf' })
    out['host_direct_dotdot_rejected'] = hostDotdot.ok === false
    const hostExe = inv.invokeHost('document.open', { path: exeRel, mimeType: 'application/pdf' })
    out['host_direct_exe_rejected'] = hostExe.ok === false
    const hostMissing = inv.invokeHost('document.open', { path: `${probeDir}/nope.pdf`, mimeType: 'application/pdf' })
    out['host_direct_missing_rejected'] = hostMissing.ok === false
    // 宿主直调合法载荷：仅断言"受理"（预览器是否真的弹出由设备侧取证）
    const hostGood = inv.invokeHost('document.open', { path: pdfRel, mimeType: 'application/pdf' })
    out['host_direct_good_ok'] = hostGood.ok === true
    out['host_direct_good_reason'] = String(hostGood.reason ?? '')

    out['ok'] = out['fixture_written'] === true
      && out['good_ok'] === true
      && out['abs_rejected'] === true
      && out['dotdot_rejected'] === true
      && out['exe_rejected'] === true
      && out['missing_rejected'] === true
      && out['host_direct_abs_rejected'] === true
      && out['host_direct_dotdot_rejected'] === true
      && out['host_direct_exe_rejected'] === true
      && out['host_direct_missing_rejected'] === true
      && out['host_direct_good_ok'] === true
    g['__proteusHostDocumentProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostDocumentProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
