// hosts/harmony/host-app/entry/src/main/ets/runtime/TransportProbe.ets
// ★★★决策 #1156：鸿蒙**传输层事实取证**探针（`scene=superapp-transport`）的逻辑层。
//
// 【为什么单列一个文件】`Superapp.ets` 原本 998 行，`check:file-size` 新文件硬上限 1000；
//   把本段（约 45 行）塞进去会越线（实测 1044 行 ⇒ 门禁红）。
//   ★按纪律不能抬基线 ⇒ 拆出来（与 `KeyboardProbe.ets` / `ElementProbe.ets` 同族）。
//
// 【它验证什么】同一 `host:port` 连发 N 个请求，**连接复用**是否成立。
//   ★但**判据不在这里**：协议版本与 TCP 连接数只有**服务端**知道（客户端自述不算）。
//   本模块只落自己的读数（状态码 / 字节数 / 逐轮墙钟 / session 建了几次）；
//   "复用了没有"由 runner 读服务端 `/__stats` 判（三端同一判据，见 `run-transport-probe.sh`）。
//
// 【模式】`sync`（生产路径，内部已改异步 Fetch 但 napi 仍同步返回）/
//   `async`（**取证专用**对照分支：直接走异步 `HMS_Rcp_Fetch`）。
//   两者存在的原因：真机实测发现"连接池只在异步路径生效"，而生产路径必须同步返回
//   （一次性 VM 约束）⇒ 需要一个能单独验证异步路径的口子。
import { fileIo } from '@kit.CoreFileKit'
import { hilog } from '@kit.PerformanceAnalysisKit'
import { hostTransportProbe } from 'proteus_render'

const DOMAIN = 0x0003
const TAG = 'ProteusHostBridge'

/** 从 AppStorage 里取参数（缺省值与 runner 一致，保证三端可比） */
export interface TransportProbeArgs {
  /** 目标 base（如 `http://192.168.1.124:9400`）；空 ⇒ 回落 `proteusProbeUrl` */
  url: string
  /** 轮数（1..20，缺省 3） */
  rounds: number
  /** `sync` / `async`（缺省 sync） */
  mode: string
}

/** 组装探针入参（纯函数，便于单测；不做 IO） */
export function transportProbeArgs(
  transportUrl: string,
  fallbackUrl: string,
  roundsRaw: string,
  modeRaw: string,
): TransportProbeArgs {
  let url: string = transportUrl;
  if (url.length === 0) url = fallbackUrl;
  let rounds: number = 3;
  if (roundsRaw.length > 0) {
    const n: number = Number.parseInt(roundsRaw, 10);
    if (!Number.isNaN(n) && n > 0 && n <= 20) rounds = n;
  }
  return { url: url, rounds: rounds, mode: modeRaw };
}

/**
 * **场景入口**：从 AppStorage 取参数 → 跑一轮 → 落盘。
 * ★为什么自取 AppStorage（而不是让 `Superapp.ets` 收集后传进来）：后者要在那个**已到 1000 行硬上限**
 *   的文件里多写 6 行参数收集（实测会越线 18 行）。参数读取本是本探针自己的关注点 ⇒ 放这里。
 */
export function runTransportProbeScene(filesDir: string): string {
  const args: TransportProbeArgs = transportProbeArgs(
    AppStorage.get<string>('proteusTransportUrl') ?? '',
    AppStorage.get<string>('proteusProbeUrl') ?? '',
    AppStorage.get<string>('proteusTransportRounds') ?? '',
    AppStorage.get<string>('proteusTransportMode') ?? '',
  );
  return runTransportProbe(filesDir, args);
}

/**
 * 跑一轮传输取证并把回执写到 `<filesDir>/transport-probe.json`。
 * ★完成信号 = 文件落盘（runner 用 `wait_for.sh --cmd test -f`），零盲等。
 */
export function runTransportProbe(filesDir: string, args: TransportProbeArgs): string {
  let result: string = '';
  try {
    result = hostTransportProbe(
      JSON.stringify({ 'url': args.url, 'rounds': args.rounds, 'mode': args.mode } as Record<string, Object>),
    );
  } catch (e) {
    result = '{"ok":false,"host":"harmony","bridge":"invokeBytes","error":"' + JSON.stringify(e) + '"}';
  }
  try {
    const path: string = filesDir + '/transport-probe.json';
    const fd = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    fileIo.writeSync(fd.fd, result);
    fileIo.closeSync(fd.fd);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'TRANSPORT_PROBE_WRITE_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
  hilog.info(DOMAIN, TAG, 'PROTEUS_TRANSPORT_PROBE_DONE %{public}s', result);
  return result;
}
