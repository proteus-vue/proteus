// hosts/shared/bridge/entry-superapp-probes-worker.ts
// ★★★#1251 iOS 真机判据：**worker 数上界真的会拒第 17 个**（补 #1250 的"iOS 未上真机"缺口）。
//
// 【为什么单列一个文件】`entry-superapp-probes.ts` 已近 file-size 上限（本仓纪律：不压缩历史注释
//   让位，按职责拆）。worker 上界是**独立关注点**（配额类探针），与网络/缓存那批职责不同。
//
// 【它证明什么】iOS `HostCapabilities` 加了 `MAX_WORKERS = 16`（#1250）：
//   · 第 1..16 次 `worker.create` ⇒ 回 `{id, thread}`（成功）
//   · 第 17 次 ⇒ `fail("...worker.tooManyWorkers...")`（`ok:false`）
//   ★判据刻意同时断言"第 16 个成功"与"第 17 个被拒"——只断言后者时，
//     **把上界写成 0** 也能通过（那种实现第 1 个就全拒，是更糟的 bug）。
//
// 【为什么走 JS 桥而不是直调宿主】
//   业务路径是 `useWorker()` → `bridge.createWorker()` → `invokeHost('worker.create')`。
//   只验宿主方法（绕开桥）会漏掉"桥把 id 丢了/post 不带 workerId"这类**已在本仓真实发生过的**
//   断链（#1096 真机抓出过）。⇒ 本探针走**完整桥路径**。
//
// 【★与 Android 装置的差异（如实登记）】
//   Android 用 `SuperappActivity --es capprobe "loop:..."`（同一实例连调，见 #1250）；
//   iOS 用 `--worker-bound-probe=` 触发本函数。两者**都是同一实例内连调**——原因相同：
//   `HostCapabilities` 是每次启动新建的 ⇒ 重启会清空 `workers` ⇒ 上界永远到不了。
export function appWorkerBoundProbe(max = 16): string {
  const g = globalThis as Record<string, unknown>
  const out: Record<string, unknown> = { max }
  g['__proteusHostWorkerBoundProbeResult'] = ''

  const run = async (): Promise<void> => {
    try {
      // ★走真实桥（不直调 invokeHost）：业务用的是 useWorker，断链风险在中间那层
      const mod = (await import('../../../packages/api/src/capability-app')) as unknown as {
        detectAppHost?: () => boolean
      }
      void mod
      const cap = (await import('../../../packages/api/src/capability')) as unknown as {
        createCapabilityBridge: () => Record<string, unknown>
      }
      const bridge = cap.createCapabilityBridge()
      const createWorker = bridge['createWorker'] as
        | ((scriptPath: string) => { terminate?: () => unknown })
        | undefined
      if (typeof createWorker !== 'function') {
        out['ok'] = false
        out['error'] = 'bridge.createWorker 缺失（worker 未接线）'
        g['__proteusHostWorkerBoundProbeResult'] = JSON.stringify(out)
        return
      }

      const created: Array<{ terminate?: () => unknown }> = []
      const results: Array<{ i: number; ok: boolean; id?: number; err?: string }> = []

      for (let i = 1; i <= max + 1; i++) {
        try {
          const w = createWorker(`probe-w${i}.js`)
          // ★桥返回的句柄**没有 id 字段**（workerId 由桥内部持有，见 capability-app.ts 的
          //   createWorker——它读 r.data.id 后闭包持有，不再外露）。第一版探针断言 w.id 会恒 0
          //   ⇒ 误判"create 失败"。这里只判"拿到了可用的句柄"（有 postMessage/terminate）。
          const usable = typeof (w as { terminate?: unknown })?.terminate === 'function'
          created.push(w)
          results.push({ i, ok: usable, ...(usable ? {} : { err: '句柄不可用（缺 terminate）' }) })
        } catch (e) {
          const err = e as { code?: string; message?: string }
          results.push({ i, ok: false, err: `${err?.code ?? ''} ${err?.message ?? String(e)}`.trim() })
        }
      }

      out['results'] = results
      out['created_count'] = created.length
      // ★核心两条
      out['first_ok'] = results[0]?.ok === true
      out['max_ok'] = results[max - 1]?.ok === true
      out['overflow_rejected'] = results[max]?.ok === false
      out['overflow_reason'] = results[max]?.err ?? ''
      out['reason_has_code'] = /worker\.tooManyWorkers/.test(String(out['overflow_reason']))
      out['ok'] =
        out['first_ok'] === true &&
        out['max_ok'] === true &&
        out['overflow_rejected'] === true &&
        out['reason_has_code'] === true

      // 清理：terminate 掉本次创建的（避免残留占上界）
      let cleaned = 0
      for (const w of created) {
        try {
          w.terminate?.()
          cleaned++
        } catch {
          /* 单个失败不阻断 */
        }
      }
      out['cleaned'] = cleaned
    } catch (e) {
      out['ok'] = false
      out['error'] = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }
    g['__proteusHostWorkerBoundProbeResult'] = JSON.stringify(out)
  }

  void run()
  return 'started'
}

/**
 * ★★★#1251 安装 worker 上界探针到全局（照 #1180 `installHttpDnsProbes` 的先例）。
 *
 * 【为什么把"安装"放在这里而不是主文件】
 *   `entry-superapp.ts` 已顶到 **1000 行硬上限**（`check:file-size`）。
 *   我先把安装写在主文件里，压行压到 998 行——但那是**为了省行删注释**，
 *   正是本仓明令禁止的形态（"不压缩历史注释来让位"）。
 *   ⇒ 改成`安装与实现同处`（与 HTTPDNS 那批同一工艺）：主文件只留一行调用，
 *     说明与逻辑都留在本文件，谁读这里就看到全部。
 */
export function installWorkerProbe(fn: (m?: number) => string): void {
  ;(globalThis as unknown as { __proteusHostAppWorkerBoundProbe?: (m?: number) => string })
    .__proteusHostAppWorkerBoundProbe = (m?: number) => fn(m)
}
