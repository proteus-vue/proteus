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
  hostVmSessionOpen, hostVmSessionTick, hostVmSessionEval, hostVmSessionClose,
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
export async function runVmSessionHttpScene(filesDir: string, base: string, maxTicks: number): Promise<void> {
  const out: Record<string, Object> = {};
  out['scene'] = 'session-http';
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

  /* ★发起真实请求：用**最简 GET 探针**（`useFetch(url)`，不带流式/取消）。
     ★为什么不复用 `__proteusHostAppUseFetchProbe`：那是**流式 + 取消**探针，
       而鸿蒙 `stream` 至今前置拒绝 ⇒ 会得到 `fetch.unsupported` 的**假失败**（实测踩过）。
     ★会话式 VM 下宿主对 http.request 走异步：立即回 pending，真实响应靠 tick 回推。 */
  const kickJs: string =
    "(typeof globalThis.__proteusHostAppSessionHttpGet === 'function'"
    + " ? String(globalThis.__proteusHostAppSessionHttpGet(" + JSON.stringify(base) + "))"
    + " : 'no-session-get-probe')";
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
    const readJs = "(typeof globalThis.__proteusHostSessionHttpGetResult === 'string'"
      + " ? globalThis.__proteusHostSessionHttpGetResult : '')";
    const readRaw: string = hostVmSessionEval(readJs);
    try {
      const rr = JSON.parse(readRaw) as EvalReading;
      if (rr.ok === true && rr.value !== undefined && rr.value.length > 0) {
        probeResult = rr.value;
        break;   // 结算了
      }
    } catch (e) { /* 继续等 */ }
    // ★让出 8ms（≈半帧）：给工作线程时间跑完 + 回推入队
    await sleepMs(8);
  }

  const closeRaw: string = hostVmSessionClose();
  out['jsTicks'] = lastJsTicks;
  out['pushed'] = pushedTotal;
  out['probeResult'] = probeResult;
  out['closeRaw'] = closeRaw;
  if (firstErr.length > 0) out['error'] = firstErr;

  /**
   * ★★★判定
   *   ① `pushed > 0`：会话真的消费了回推帧（异步链路走通）
   *   ② `probeResult` 非空且 `ok:true`：业务层（useFetch 门面）拿到真实响应
   *   ③ `jsTicks > 1`：会话态在请求期间保留
   */
  let probeOk: boolean = false;
  try {
    const pr = JSON.parse(probeResult) as Record<string, Object>;
    probeOk = pr['ok'] === true;
  } catch (e) { /* 未结算 */ }
  out['ok'] = firstErr.length === 0 && pushedTotal > 0 && probeOk && lastJsTicks > 1;
  // ★把探针原文打进 hilog（400 字符截断）：报告文件在沙箱里读不到，这是唯一取证通道
  hilog.info(DOMAIN, TAG, 'SESSION_HTTP_PROBE_RAW %{public}s',
    probeResult.length > 400 ? probeResult.slice(0, 400) : probeResult);
  hilog.info(DOMAIN, TAG,
    'SESSION_HTTP_DONE ok=%{public}s pushed=%{public}d jsTicks=%{public}d probeOk=%{public}s',
    String(out['ok']), pushedTotal, lastJsTicks, String(probeOk));
  writeReport(filesDir, 'vm-session-http.json', JSON.stringify(out));
}
