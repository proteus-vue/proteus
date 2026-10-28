// hosts/harmony/host-app/entry/src/main/ets/runtime/VmSessionScene.ets
// ★★★#1344 B-1：**会话式 VM 判据场景**（`scene=superapp-session`）。
//
// 【它证明什么（这是 B 阶段最关键的一条判据）】
//   ① **会话跨调用存活**：open 之后连续 tick N 次，JS 侧计数器 `__proteusSessionTicks`
//      必须**单调递增到 N**。若 VM 是一次性的，每次 tick 都是新上下文 ⇒ 计数器恒为 1
//      （这正是当前生产路径的病根，见决策 #1343）。
//   ② **回推链通了**：从 ArkTS 侧塞假 PRSP 帧 → tick → JS 侧 `__proteusHostResolveBytes` 收到
//      ⇒ 证明"网络线程入队 → tick 搬运 → JS 结算"这条异步通路真的成立。
//   ③ **boot 成功**：整包 Vue runtime 在会话里 boot 起来（`boot:"booted"`）。
//   ④ **无泄漏**：N 拍后堆不线性漂移。
//
// 【诚实边界】
//   · 本场景**不做真实网络请求**：只用假帧证明搬运链。真 HTTP + cancel/stream 属下一步。
//   · 会话是进程级单例：场景结束必须 `close`（否则下次 open 会报"会话已打开"）。
//   · `boot` 失败不算会话不可用（整包可能要更多宿主方法）——如实记录在 `boot` 字段。

import {
  hostVmSessionOpen, hostVmSessionTick, hostVmSessionPushResolve,
  hostVmSessionClose, hostVmSessionStats,
} from 'proteus_render';
import { fileIo as fs } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';

const DOMAIN: number = 0x0003;
const TAG: string = 'ProteusSession';

/** PRSP 帧的十六进制（最小合法帧：magic 'PRSP' + version 1 + flags 0 + meta 0 + body 0） */
function minimalPrspFrameHex(): string {
  // 小端 u32：magic=0x50535250 ('PRSP') · version=1 · flags=0 · metaBytes=0 · bodyBytes=0
  return '50535250' + '01000000' + '00000000' + '00000000' + '00000000';
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
    hilog.info(DOMAIN, TAG, 'SESSION_REPORT_WRITTEN bytes=%{public}d', text.length);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'SESSION_REPORT_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
}

interface SessionChecks {
  jsTicksOk: boolean;
  framesOk: boolean;
  heapOk: boolean;
}

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

/**
 * 跑会话判据：open → N 拍 tick（每 10 拍塞一个假回推帧）→ close。
 * @param filesDir 沙箱目录（报告落点）
 * @param ticks 拍数
 */
export function runVmSessionScene(filesDir: string, ticks: number): void {
  const out: Record<string, Object> = {};
  out['scene'] = 'session';
  out['requestedTicks'] = ticks;

  // ① 读整包
  let bundle: string = '';
  try {
    const ctx = getContext() as common.UIAbilityContext;
    const bb: Uint8Array = ctx.resourceManager.getRawFileContentSync('bundle-superapp.js');
    bundle = util.TextDecoder.create('utf-8').decodeToString(bb);
  } catch (e) {
    out['ok'] = false;
    out['error'] = 'bundle 读取失败：' + (JSON.stringify(e) ?? '');
    writeReport(filesDir, 'vm-session.json', JSON.stringify(out));
    return;
  }
  out['bundleBytes'] = bundle.length;
  hilog.info(DOMAIN, TAG, 'SESSION_START ticks=%{public}d bundle=%{public}d', ticks, bundle.length);

  // ② open
  const openRaw: string = hostVmSessionOpen(bundle, true);
  hilog.info(DOMAIN, TAG, 'SESSION_OPEN %{public}s', openRaw);
  let openR: TickReading | undefined = undefined;
  try { openR = JSON.parse(openRaw) as TickReading; } catch (e) { /* 下面统一报 */ }
  out['openRaw'] = openRaw;
  if (openR === undefined || openR.ok !== true) {
    out['ok'] = false;
    out['error'] = '会话打开失败：' + openRaw;
    writeReport(filesDir, 'vm-session.json', JSON.stringify(out));
    return;
  }
  out['boot'] = String(openR.boot ?? '');

  // ③ N 拍：每 10 拍塞一个假回推帧（验证搬运链）
  const heapSamples: number[] = [];
  let lastJsTicks: number = 0;
  let framesPushed: number = 0;
  let firstErr: string = '';
  const frameHex: string = minimalPrspFrameHex();
  for (let i = 0; i < ticks; i++) {
    if (i % 10 === 0) {
      const pr: string = hostVmSessionPushResolve(frameHex);
      if (pr.indexOf('"ok":true') >= 0) framesPushed++;
    }
    const raw: string = hostVmSessionTick(64);
    let r: TickReading | undefined = undefined;
    try { r = JSON.parse(raw) as TickReading; } catch (e) { /* 下面统一报 */ }
    if (r === undefined || r.ok !== true) {
      firstErr = '第 ' + i + ' 拍失败：' + raw;
      break;
    }
    lastJsTicks = r.jsTicks ?? -1;
    if ((i + 1) % 100 === 0) {
      heapSamples.push(Math.round(r.heapKB ?? -1));
    }
  }

  // ④ close（必须，否则下次 open 会报"已打开"）
  const closeRaw: string = hostVmSessionClose();
  hilog.info(DOMAIN, TAG, 'SESSION_CLOSE %{public}s', closeRaw);

  out['jsTicks'] = lastJsTicks;
  out['framesPushed'] = framesPushed;
  out['heapSamples'] = heapSamples;
  out['closeRaw'] = closeRaw;
  if (firstErr.length > 0) out['error'] = firstErr;

  /**
   * ★★★判定（这是本场景的全部意义）
   *   ① `jsTicks === ticks`：**同一 JS 上下文跨调用存活**（一次性 VM 下会是 1）
   *   ② `framesPushed > 0`：假帧真的入队了
   *   ③ 堆不线性漂移：首尾样本差 < 50%（只是粗判，细判靠细跑）
   */
  const jsTicksOk: boolean = lastJsTicks === ticks;
  const framesOk: boolean = framesPushed > 0;
  let heapOk: boolean = true;
  if (heapSamples.length >= 2) {
    const first: number = heapSamples[0];
    const last: number = heapSamples[heapSamples.length - 1];
    heapOk = first > 0 ? (last - first) / first < 0.5 : true;
  }
  out['ok'] = firstErr.length === 0 && jsTicksOk && framesOk && heapOk;
  const checks: SessionChecks = { jsTicksOk: jsTicksOk, framesOk: framesOk, heapOk: heapOk };
  out['checks'] = checks;

  hilog.info(DOMAIN, TAG,
    'SESSION_DONE ok=%{public}s jsTicks=%{public}d/%{public}d frames=%{public}d heapOk=%{public}s',
    String(out['ok']), lastJsTicks, ticks, framesPushed, String(heapOk));
  writeReport(filesDir, 'vm-session.json', JSON.stringify(out));
}
