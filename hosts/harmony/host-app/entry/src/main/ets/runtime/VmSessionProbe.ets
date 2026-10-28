// hosts/harmony/host-app/entry/src/main/ets/runtime/VmSessionProbe.ets
// ★★★#1342-A：**#540 决策门**的 ArkTS 侧入口（`scene=superapp-vmprobe`）。
//
// 【它做什么】调 `hostVmSessionProbe({rounds, mode})` 跑持久 VM 探针，把读数写进
//   `<filesDir>/vm-probe.json`（落盘即完成信号 ⇒ 脚本零轮询等待，与其它探针同一约定）。
//
// 【为什么单独一个文件】`Superapp.ets` 已 967 行（接近 1000 行门禁），探针逻辑必须另开文件
//   ——与 `TransportProbe.ets` / `HttpProbe.ets` 同一手法。
//
// 【★探针本身崩了怎么办（这是本轮最关键的取证点）】
//   持久 VM 如果崩，会在 `hostVmSessionProbe` **内部** SIGSEGV ⇒ 进程直接死、报告写不出来。
//   ⇒ 判定不能只看"有没有报告"：
//     · 有报告且 ok:true            ⇒ 持久 VM 可用
//     · 有报告但 ok:false           ⇒ 探针内部某步失败（报告里有 firstFailureRound/Why）
//     · **无报告 + 进程消失**        ⇒ 持久 VM 崩溃（脚本据 hilog/cppcrash 判定）
//   脚本侧对三种情况分别断言，见 `hosts/harmony/run-vm-probe.sh`。

import { hostVmSessionProbe, hostVmSessionBundleProbe } from 'proteus_render';
import { fileIo as fs } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';

const DOMAIN: number = 0x0003;
const TAG: string = 'ProteusVmProbe';

/** 探针读数（与 `vm_session_probe.h` 的 ProbeResult 同形） */
interface VmProbeResult {
  ok?: boolean;
  mode?: string;
  rounds?: number;
  roundsOk?: number;
  firstFailureRound?: number;
  firstFailureWhy?: string;
  heapBeforeKB?: number;
  heapAfterKB?: number;
  heapPeakKB?: number;
  heapGrowthPct?: number;
  samples?: number[][];
  error?: string;
}

function writeJson(filesDir: string, name: string, text: string): void {
  const path: string = filesDir + '/' + name;
  try {
    const f = fs.openSync(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(f.fd, text);
      // ★fsync：保证报告真的落盘（与 #1197 的落盘纪律一致）
      try { fs.fsyncSync(f.fd); } catch (e) { /* 部分实现无 fsyncSync，降级 */ }
    } finally {
      fs.closeSync(f);
    }
    hilog.info(DOMAIN, TAG, 'VM_PROBE_WRITTEN path=%{public}s bytes=%{public}d', path, text.length);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'VM_PROBE_WRITE_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
}

/**
 * ★★★#1342 B-0：**整包 Vue bundle 版**探针。
 *
 * 【为什么值得单独跑一轮（而不是直接信合成负载的结果）】
 *   `plain`/`nav`/`ref` 是我手写的合成负载 —— 它们证明"VM 能跨调用存活"，
 *   **但没有**真实 Vue 运行时的微任务压力（响应式依赖追踪 / nextTick 队列 / 路由守卫链）。
 *   B 阶段要让整包 runtime 跑在持久 VM 里 ⇒ 必须在真实负载下再验一次，
 *   否则"合成负载通过"会被当成"生产可用"（假绿）。
 *
 * 【诚实边界】探针给的 `proteusHost` 是**最小桩**（invoke 只记调用数、永远回 missing），
 *   不接真实内核 ⇒ 本模式验的是"**VM 持久性**"，不是"整包在真实宿主下能跑"。
 *   后者属 B 阶段的 SessionOpen/Tick 工作。
 */
function runBundleProbe(filesDir: string, rounds: number): void {
  let bundle: string = '';
  try {
    const ctx = getContext() as common.UIAbilityContext;
    const bb: Uint8Array = ctx.resourceManager.getRawFileContentSync('bundle-superapp.js');
    bundle = util.TextDecoder.create('utf-8').decodeToString(bb);
  } catch (e) {
    const failed: VmProbeResult = {
      ok: false, mode: 'bundle', rounds: rounds, error: 'bundle 读取失败：' + (JSON.stringify(e) ?? ''),
    };
    hilog.error(DOMAIN, TAG, 'VM_PROBE_BUNDLE_READ_FAIL %{public}s', JSON.stringify(e) ?? '');
    writeJson(filesDir, 'vm-probe.json', JSON.stringify(failed));
    return;
  }
  hilog.info(DOMAIN, TAG, 'VM_PROBE_BUNDLE_LOADED bytes=%{public}d rounds=%{public}d', bundle.length, rounds);

  let raw: string = '';
  try {
    raw = hostVmSessionBundleProbe(bundle, rounds);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'VM_PROBE_BUNDLE_THROW %{public}s', JSON.stringify(e) ?? '');
    writeJson(filesDir, 'vm-probe.json',
      JSON.stringify({ ok: false, mode: 'bundle', rounds: rounds, error: 'napi-throw: ' + (JSON.stringify(e) ?? '') } as VmProbeResult));
    return;
  }
  hilog.info(DOMAIN, TAG, 'VM_PROBE_RAW %{public}s', raw.length > 0 ? raw : '(empty)');
  writeJson(filesDir, 'vm-probe.json', raw);
}

/**
 * 跑探针场景（`aboutToAppear` 里调用；**同步**执行 —— 与其它探针一致）。
 * ★注意：探针本身是同步长任务（1000 轮可能几百 ms~数秒）。
 *   UI 线程有 6s 看门狗（`THREAD_BLOCK_6S`）⇒ 轮数上界由脚本控制（默认 1000，一般远低于 6s）。
 */
export function runVmSessionProbeScene(filesDir: string, rounds: number, mode: string): void {
  // ★★★`bundle` 模式（B-0）：先把 rawfile 里的整包读出来，走**独立的 napi 入口**
  //   （1.5MB 走 JSON 入参要全量转义，既慢又易踩引号/换行坑 ⇒ 直接传原文）。
  if (mode === 'bundle') {
    runBundleProbe(filesDir, rounds);
    return;
  }
  const args: string = JSON.stringify({ rounds: rounds, mode: mode });
  hilog.info(DOMAIN, TAG, 'VM_PROBE_START rounds=%{public}d mode=%{public}s', rounds, mode);
  let raw: string = '';
  let thrown: string = '';
  try {
    raw = hostVmSessionProbe(args);
  } catch (e) {
    // ★napi 调用抛错（非崩溃）：如实记下，报告仍要写出去
    thrown = JSON.stringify(e) ?? String(e);
    hilog.error(DOMAIN, TAG, 'VM_PROBE_THROW %{public}s', thrown);
  }

  if (thrown.length > 0) {
    const failed: VmProbeResult = { ok: false, rounds: rounds, mode: mode, error: 'napi-throw: ' + thrown };
    writeJson(filesDir, 'vm-probe.json', JSON.stringify(failed));
    return;
  }

  let parsed: VmProbeResult | undefined = undefined;
  try { parsed = JSON.parse(raw) as VmProbeResult; } catch (e) { /* 下面统一报 */ }
  if (parsed === undefined) {
    const failed: VmProbeResult = { ok: false, rounds: rounds, mode: mode, error: 'unparsable: ' + raw.slice(0, 200) };
    writeJson(filesDir, 'vm-probe.json', JSON.stringify(failed));
    return;
  }
  // ★把完整回执也打进 hilog —— 报告文件在沙箱里 `hdc shell` 读不到（实测 Permission denied），
  //   而 hilog 一定能读 ⇒ **hilog 是主取证通道，文件是副本**。
  hilog.info(DOMAIN, TAG, 'VM_PROBE_RAW %{public}s', raw.length > 0 ? raw : '(empty)');
  hilog.info(DOMAIN, TAG,
    'VM_PROBE_DONE ok=' + String(parsed.ok) + ' roundsOk=' + String(parsed.roundsOk ?? -1)
    + ' firstFail=' + String(parsed.firstFailureRound ?? -1)
    + ' heapAfterKB=' + String(parsed.heapAfterKB ?? -1)
    + ' grow=' + String(parsed.heapGrowthPct ?? -1)
    + ' err=' + String(parsed.error ?? parsed.firstFailureWhy ?? ''));
  writeJson(filesDir, 'vm-probe.json', raw);
}
