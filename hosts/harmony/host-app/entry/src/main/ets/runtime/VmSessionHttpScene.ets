// hosts/harmony/host-app/entry/src/main/ets/runtime/VmSessionHttpScene.ets
// ★★★#1344 B-2：**会话式 VM 里的真实 HTTP 判据**（`scene=superapp-session-http`）。
//
// 【它证明什么（B-2 的全部意义）】
//   ① `http.request` 走**异步**：宿主立即回 `pending:true`，真实响应稍后回推
//   ② 回推链真的通：工作线程 → `pushResolve` 队列 → `sessionTick` 推 `__proteusHostResolveBytes`
//      → JS 的 Promise 结算 → **业务层拿到真实响应**
//   ③ **会话态在请求期间保留**（JS 侧 tick 计数继续递增）
//   ④ 端到端拿到**真实 HTTP status + body 长度**，不是假数据
//
// 【为什么复用 `__proteusHostAppUseFetchProbe`】
//   它是 #1122 建的、**走 useFetch 门面**的现成探针（`useFetch → bridge → invokeBytes`），
//   正好是要验的完整业务链。自己再写一份等于重复发明，还会漏掉门面层。
//   ★用它还有一个好处：与 iOS/Android 的同名探针**同一判据口径**（三端可比）。
//
// 【诚实边界】
//   · 目标 URL 用公网（httpbin）；失败可能来自网络而非实现 —— 报告带 `error` 原文。
//   · 不验 cancel / stream（B-2c / B-3）。
//   · 探针结果键是 `__proteusHostUseFetchProbeResult`（bundle 内既有约定）。

import {
  hostVmSessionOpen, hostVmSessionTick, hostVmSessionEval, hostVmSessionClose, hostVmSessionCancelStats,
} from 'proteus_render';
import { fileIo as fs } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';

const DOMAIN: number = 0x0003;
const TAG: string = 'ProteusSessionHttp';

interface TickReading {
  ok?: boolean;
  ticks?: number;
  pushed?: number;
  pendingDepth?: number;
  heapKB?: number;
  jsTicks?: number;
  boot?: string;
  error?: string;
}

interface CancelChecks {
  aborted: boolean;
  codeOk: boolean;
  stoppedEarly: boolean;
  jsTicksKept: boolean;
}

interface EvalReading {
  ok?: boolean;
  value?: string;
  error?: string;
}

function writeReport(filesDir: string, name: string, text: string): void {
  const path: string = filesDir + '/' + name;
  try {
    const f = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(f.fd, text);
      try { fs.fsyncSync(f.fd); } catch (e) { /* 降级 */ }
    } finally {
      fs.closeSync(f);
    }
    hilog.info(DOMAIN, TAG, 'SESSION_HTTP_REPORT_WRITTEN bytes=%{public}d', text.length);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'SESSION_HTTP_REPORT_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
}

/** 有界让出（★本场景**唯一**允许的等待：退出条件是"探针结果出现"，上界 = maxTicks） */
function sleepMs(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * 跑会话内 HTTP 判据：open → 用最简 GET 探针发起真请求 → tick 到它结算 → close。
 * @param filesDir 沙箱
 * @param base 目标 URL
 * @param maxTicks 最多等多少拍（每拍之间让出 8ms ⇒ 上界 ≈ maxTicks × 8ms）
 */
export async function runVmSessionHttpScene(filesDir: string, base: string, maxTicks: number, mode: string = 'get'): Promise<void> {
  const out: Record<string, Object> = {};
  out['scene'] = mode === 'cancel' ? 'session-cancel' : 'session-http';
  out['base'] = base;

  let bundle: string = '';
  try {
    const ctx = getContext() as common.UIAbilityContext;
    const bb: Uint8Array = ctx.resourceManager.getRawFileContentSync('bundle-superapp.js');
    bundle = util.TextDecoder.create('utf-8').decodeToString(bb);
  } catch (e) {
    out['ok'] = false;
    out['error'] = 'bundle 读取失败：' + (JSON.stringify(e) ?? '');
    writeReport(filesDir, 'vm-session-http.json', JSON.stringify(out));
    return;
  }

  const openRaw: string = hostVmSessionOpen(bundle, true);
  hilog.info(DOMAIN, TAG, 'SESSION_HTTP_OPEN %{public}s', openRaw);
  let openR: TickReading | undefined = undefined;
  try { openR = JSON.parse(openRaw) as TickReading; } catch (e) { /* 统一报 */ }
  out['openRaw'] = openRaw;
  if (openR === undefined || openR.ok !== true) {
    out['ok'] = false;
    out['error'] = '会话打开失败';
    writeReport(filesDir, 'vm-session-http.json', JSON.stringify(out));
    return;
  }
  out['boot'] = String(openR.boot ?? '');

  /* 选探针：
     · `mode != 'cancel'` ⇒ 最小 GET（验异步链路）
     · `mode == 'cancel'` ⇒ **两阶段**：start（发慢请求）→ 等 600ms → abort（验 B-2c 真取消）
       ★两阶段的原因：App 精简引擎**没有 setTimeout**，JS 侧无法自己延迟；
         而忙等会阻塞 JS 线程 ⇒ 请求发不出去。⇒ 延迟放到 ArkTS 侧（宿主事件循环）。 */
  const isCancel: boolean = mode === 'cancel';
  const probeName: string = isCancel ? '__proteusHostAppSessionCancelStart' : '__proteusHostAppSessionHttpGet';
  const resultKey: string = isCancel ? '__proteusHostSessionCancelProbeResult' : '__proteusHostSessionHttpGetResult';
  const kickJs: string =
    "(typeof globalThis." + probeName + " === 'function'"
    + " ? String(globalThis." + probeName + "(" + JSON.stringify(base) + "))"
    + " : 'no-session-probe')";
  const kickRaw: string = hostVmSessionEval(kickJs);
  hilog.info(DOMAIN, TAG, 'SESSION_HTTP_KICK %{public}s', kickRaw.length > 200 ? kickRaw.slice(0, 200) : kickRaw);
  let kickR: EvalReading | undefined = undefined;
  try { kickR = JSON.parse(kickRaw) as EvalReading; } catch (e) { /* 统一报 */ }
  out['kick'] = kickRaw;

  // tick 循环：等回推把 Promise 结算（探针结果从 '' 变成 JSON）
  /* ★★★必须**有条件等待**（不能一毫秒跑完 100 拍）：
     HTTP 请求在**工作线程**里跑，通常几十~几百 ms 才回来；而 tick 循环是同步的，
     100 拍不到 1ms 就跑完了 ⇒ `pushed=0`、探针结果永远空（实测踩过：
     日志显示 `SESSION_HTTP_DONE ok=1 status=200` 与 `pushed=0` 并存 ——
     请求**成功**了，但 tick 循环早就退出了，谁都没消费那个回推帧）。
     ⇒ 每轮之间用 `setTimeout(8ms)` 让出一次（有界：最多 maxTicks 次）。
     ★这不是盲等：等待的**退出条件是**"探针结果出现"，超时上界由 maxTicks 控制。 */
  let lastJsTicks: number = 0;
  let pushedTotal: number = 0;
  let firstErr: string = '';
  let probeResult: string = '';
  for (let i = 0; i < maxTicks; i++) {
    // ★CANCEL 模式：第 40 拍（≈320ms 后）触发 abort —— 此时慢请求仍在飞
    if (isCancel && i === 40) {
      const abortRaw: string = hostVmSessionEval(
        "(typeof globalThis.__proteusHostAppSessionCancelAbort === 'function'"
        + " ? String(globalThis.__proteusHostAppSessionCancelAbort()) : 'no-abort-hook')");
      hilog.info(DOMAIN, TAG, 'SESSION_CANCEL_ABORT %{public}s', abortRaw);
    }
    const raw: string = hostVmSessionTick(64);
    let r: TickReading | undefined = undefined;
    try { r = JSON.parse(raw) as TickReading; } catch (e) { /* 统一报 */ }
    if (r === undefined || r.ok !== true) {
      firstErr = '第 ' + i + ' 拍失败：' + raw;
      break;
    }
    lastJsTicks = r.jsTicks ?? -1;
    pushedTotal += r.pushed ?? 0;
    // 读探针结果（空 = 还没结算）
    const readJs = "(typeof globalThis." + resultKey + " === 'string'"
      + " ? globalThis." + resultKey + " : '')";
    const readRaw: string = hostVmSessionEval(readJs);
    try {
      const rr = JSON.parse(readRaw) as EvalReading;
      if (rr.ok === true && rr.value !== undefined && rr.value.length > 0) {
        /* ★★★结算判据按 mode 不同（第一版没区分 ⇒ CANCEL 模式在 `phase:'start'` 阶段
           就把回执当成最终结果 break 了，`jsTicks` 只有 1、`stoppedEarly=false`，看起来像"取消没生效"）：
           · GET 模式：任何非空结果就是最终结果
           · CANCEL 模式：必须等到 `phase:'abort'` **且**带 `stopped_early` 字段
             （start 阶段只回 `{phase:'start',started_at}`，那不是结论） */
        let settled: boolean = true;
        if (isCancel) {
          try {
            const pr = JSON.parse(rr.value) as Record<string, Object>;
            settled = pr['phase'] === 'abort' && pr['stopped_early'] !== undefined;
          } catch (e) {
            settled = false;
          }
        }
        if (settled) {
          probeResult = rr.value;
          break;
        }
      }
    } catch (e) { /* 继续等 */ }
    // ★让出 8ms（≈半帧）：给工作线程时间跑完 + 回推入队
    await sleepMs(8);
  }

  /* ★★★CANCEL 模式：**宿主侧取证**（这是"传输真被取消"的唯一直接证据）。
     JS 侧的 `settle_ms_after_abort` 只说明"本地 Promise 立刻 reject 了"——
     实测：把宿主的 `HMS_Rcp_CancelRequest` 摘掉，JS 侧读数**一模一样**（破坏性验证 M7 抓到）。
     ⇒ 必须在**宿主关掉会话之前**读 `http.cancelStats` 的 `calls`。
     ★★取证方式：**不用 eval 调 invoke**（那条路在会话里崩过，见下），改用**宿主侧直接读** ——
       新增 `hostVmSessionCancelStats()` napi 入口，直接返回 `stats().cancelCalls`。
       这比绕 JS 一圈更直接，也不给 JS 线程增加一次回调重入。 */
  let hostCancelCalls: number = -1;
  if (isCancel) {
    const statsRaw: string = hostVmSessionCancelStats();
    try {
      const sr = JSON.parse(statsRaw) as EvalReading;
      const payload = JSON.parse(String(sr.value ?? '{}')) as Record<string, Object>;
      hostCancelCalls = Number(payload['calls'] ?? -1);
    } catch (e) {
      hostCancelCalls = -1;
    }
    out['hostCancelCalls'] = hostCancelCalls;
  }
  const closeRaw: string = hostVmSessionClose();
  out['jsTicks'] = lastJsTicks;
  out['pushed'] = pushedTotal;
  out['probeResult'] = probeResult;
  out['closeRaw'] = closeRaw;
  if (firstErr.length > 0) out['error'] = firstErr;

  /**
   * ★★★判定（按 mode 分两套口径 —— 两者的"成功"含义完全不同）
   *   **GET 模式**：① `pushed > 0`（回推帧被消费）② 探针 `ok:true`（拿到真实响应）③ `jsTicks > 1`
   *   **CANCEL 模式**：① 探针 `ok:false`（请求失败）② `error_code == 'fetch.aborted'`（码对）
   *     ③ `stopped_early == true`（**远早于超时结束** = 传输真被中止，不是自然超时）
   *     ★第 ③ 条是核心：慢响应 10s / timeout 30s，若传输没停，totalMs 会接近 10s 或 30s。
   */
  let probeOk: boolean = false;
  let cancelCodeOk: boolean = false;
  let stoppedEarly: boolean = false;
  try {
    const pr = JSON.parse(probeResult) as Record<string, Object>;
    if (isCancel) {
      /* ★★★CANCEL 模式的三个判据（**不要**用探针的 `ok` 当"请求成功"：
         探针里 `ok:true` 只表示"abort 流程跑完了"，而请求本身必然是失败的）：
         ① `error_code == 'fetch.aborted'` —— 业务拿到的是取消码（不是 fetch.failed）
         ② `stopped_early == true`        —— **abort 后立即结算**（3ms 实测）
            ★这条是核心：若只 reject 本地而传输照跑，会等到 10s 慢响应或 30s 超时。
         ③ `settle_ms_after_abort` 有值且很小 —— 同一件事的量化读数 */
      cancelCodeOk = String(pr['error_code'] ?? '') === 'fetch.aborted';
      stoppedEarly = pr['stopped_early'] === true;
      probeOk = cancelCodeOk && stoppedEarly;
    } else {
      probeOk = pr['ok'] === true;
    }
  } catch (e) { /* 未结算 */ }
  if (isCancel) {
    const hostCanceled: boolean = hostCancelCalls > 0;
    const cc: CancelChecks = {
      aborted: probeOk, codeOk: cancelCodeOk, stoppedEarly: stoppedEarly, jsTicksKept: lastJsTicks > 1,
    };
    out['checks'] = cc;
    out['hostCancelOk'] = hostCanceled;
    // ★四条全过才算：JS 码对 + 早结算 + **宿主真调了 cancel** + 会话态保留
    out['ok'] = firstErr.length === 0 && probeOk && cancelCodeOk && stoppedEarly && hostCanceled && lastJsTicks > 1;
    hilog.info(DOMAIN, TAG,
      'SESSION_CANCEL_DONE ok=%{public}s codeOk=%{public}s stoppedEarly=%{public}s hostCancelCalls=%{public}d jsTicks=%{public}d',
      String(out['ok']), String(cancelCodeOk), String(stoppedEarly), hostCancelCalls, lastJsTicks);
  } else {
    out['ok'] = firstErr.length === 0 && pushedTotal > 0 && probeOk && lastJsTicks > 1;
    hilog.info(DOMAIN, TAG,
      'SESSION_HTTP_DONE ok=%{public}s pushed=%{public}d jsTicks=%{public}d probeOk=%{public}s',
      String(out['ok']), pushedTotal, lastJsTicks, String(probeOk));
  }
  // ★把探针原文打进 hilog（400 字符截断）：报告文件在沙箱里读不到，这是唯一取证通道
  hilog.info(DOMAIN, TAG, 'SESSION_HTTP_PROBE_RAW %{public}s',
    probeResult.length > 400 ? probeResult.slice(0, 400) : probeResult);
  writeReport(filesDir, isCancel ? 'vm-session-cancel.json' : 'vm-session-http.json', JSON.stringify(out));
}
