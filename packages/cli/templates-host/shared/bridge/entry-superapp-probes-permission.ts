// hosts/shared/bridge/entry-superapp-probes-permission.ts
// ★★★C16 `getPermission` 真机探针（`--permission-probe=1`）—— **单列文件**。
//
// 【为什么单列】`entry-superapp.ts` 的探针注册区已接近 1000 行上限（`check:file-size` 硬门禁），
//   与 #1336 share / #1384 document / #1150 stale 等探针同一手法：同族探针各自成文件。
//
// 【它证明什么（iOS/鸿蒙共用；Android 用 `run-permission-probe.sh` 走 capprobe）】
//   ① 三个 scope 都查得回来，且是两态之一（`granted` / `denied`，**永不返回 `prompt`**）；
//   ② 回执带 `declared` 位（"没配置"与"用户拒绝"必须能分开）；
//   ③ 小程序 scope 写法（`scope.camera` 等）能归一（宿主收到的是规范名）；
//   ④ 未知 scope ⇒ **报错**（不是回 denied）；
//   ⑤ ★★直调宿主（绕过 JS 归一）单独验宿主那一层也拒绝未知 scope ——
//      走 `usePermission` 时 JS 层先拦，宿主不校验也看不出来 ⇒ 只改宿主的变异会**假绿**。
//
// 【它**不**证明什么】
//   · 不证明"授权态真的随系统设置翻转"——那要改变设备授权态（Android 用 `pm grant/revoke`，
//     见 `hosts/android/run-permission-probe.sh` ⑤；iOS/鸿蒙需人工在系统设置里改，脚本无法代做）；
//   · 不证明"申请会弹框"——本能力**只查不申请**（见 capability-app-permission.ts 头注释）。
export function appPermissionProbe(): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { permission: 'probe' }
  g['__proteusHostPermissionProbeResult'] = ''

  const run = async (): Promise<void> => {
    const mod = (await import('../../../packages/api/src/capability')) as unknown as {
      createCapabilityHooks: (b: unknown) => {
        usePermission: (n: string) => Promise<{
          ok: boolean
          data?: { permission?: string; state?: string }
          error?: { code?: string; message?: string }
        }>
      }
      createCapabilityBridge: () => unknown
    }
    const inv = (await import('../../../packages/api/src/capability-invoke')) as unknown as {
      invokeHost: (m: string, a?: unknown) => { ok: boolean; data?: unknown; reason?: string; missing?: boolean }
    }

    const hooks = mod.createCapabilityHooks(mod.createCapabilityBridge())

    // ── ① 三个 scope：查得回来 + 两态 + declared 位 ──
    const scopes = ['camera', 'microphone', 'geolocation']
    const states: Record<string, string> = {}
    const declared: Record<string, boolean> = {}
    let allTwoState = true
    for (const scope of scopes) {
      const r = await hooks.usePermission(scope)
      // ★不经 usePermission 的封装：同时读一次宿主原始回执，核对 `declared` 位
      //   （Hook 层返回的 PermissionState 只有 permission/state 两个字段，
      //     而 `declared` 是本能力的"配置是否就绪"信号，必须单独取证）
      const raw = inv.invokeHost('permission.check', { scope })
      const rawData = (raw.ok ? (raw.data as { declared?: unknown; state?: unknown }) : undefined) ?? {}
      states[scope] = String(r.ok ? r.data?.state : `ERR:${r.error?.code ?? ''}`)
      declared[scope] = rawData.declared === true
      if (!r.ok || (r.data?.state !== 'granted' && r.data?.state !== 'denied')) allTwoState = false
      // ★回显原始名字（Hook 层行为，与 Web 一致）
      if (r.ok && r.data?.permission !== scope) out[`echo_mismatch_${scope}`] = String(r.data?.permission)
    }
    out['states'] = states
    out['declared'] = declared
    out['all_two_state'] = allTwoState
    out['never_prompt'] = Object.values(states).every((s) => s === 'granted' || s === 'denied')

    // ── ② 小程序 scope 写法归一（宿主收到的是规范名）──
    const alias = await hooks.usePermission('scope.record')
    out['alias_ok'] = alias.ok === true
    out['alias_echo'] = String(alias.ok ? alias.data?.permission : '')
    const rawAliasArg = inv.invokeHost('permission.check', { scope: 'microphone' })
    out['alias_host_ok'] = rawAliasArg.ok === true

    // ── ③ 未知 scope 必须报错（不是回 denied）──
    const bad = await hooks.usePermission('notifications')
    out['unknown_rejected'] = bad.ok === false
    out['unknown_code'] = String(bad.error?.code ?? '')

    // ── ④ 空名字必须报错 ──
    const empty = await hooks.usePermission('')
    out['empty_rejected'] = empty.ok === false

    // ── ⑤★★ 直调宿主层（绕过 JS 归一）——证明宿主也拒未知 scope ──
    const hostBad = inv.invokeHost('permission.check', { scope: 'notifications' })
    out['host_direct_unknown_rejected'] = hostBad.ok === false
    out['host_direct_unknown_reason'] = String(hostBad.reason ?? '')
    const hostEmpty = inv.invokeHost('permission.check', {})
    out['host_direct_empty_rejected'] = hostEmpty.ok === false
    // 宿主直调合法：只断言"受理 + state 合法"
    const hostGood = inv.invokeHost('permission.check', { scope: 'camera' })
    out['host_direct_good_ok'] = hostGood.ok === true
    out['host_direct_good_state'] = String(
      (hostGood.ok ? (hostGood.data as { state?: unknown }).state : undefined) ?? '',
    )

    out['ok'] =
      out['all_two_state'] === true &&
      out['never_prompt'] === true &&
      out['alias_ok'] === true &&
      out['alias_echo'] === 'scope.record' &&
      out['unknown_rejected'] === true &&
      out['empty_rejected'] === true &&
      out['host_direct_unknown_rejected'] === true &&
      out['host_direct_empty_rejected'] === true &&
      out['host_direct_good_ok'] === true
    g['__proteusHostPermissionProbeResult'] = JSON.stringify(out)
  }
  void run().catch((e: unknown) => {
    out['error'] = String((e as Error)?.message ?? e)
    out['ok'] = false
    g['__proteusHostPermissionProbeResult'] = JSON.stringify(out)
  })
  return JSON.stringify({ phase: 'started', queued: true })
}
