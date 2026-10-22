// hosts/harmony/host-app/entry/src/main/ets/runtime/HttpProbe.ets
// ★★★#1169：HTTP 通路真机判据（从 `Superapp.ets` 抽出——那个文件已 1008 行破 1000 上限）。
//
// 【它做什么】`scene=superapp-http` ⇒ **不 boot 应用**，在**一次性 VM** 里用真实的
//   `proteusHost.invokeBytes` 走完整条能力通道，真发一次网络请求，回执里带**回程帧真实解出的**
//   状态码/载荷/逐块闸读数/DNS 读数。
//
// 【★为什么抽出来（两条纪律同时命中）】
//   ① `check:file-size`：`Superapp.ets` 加完 #1169 的 DNS 表注入后到 1008 行（硬上限 1000）；
//   ② 职责：探针是**判据装置**，与应用壳运行期逻辑无关——本来就不该长在壳里。
//   ★与 `TransportProbe.ets` / `KeyboardProbe` 同族（它们已是独立模块）。
//
// 【诚实边界】证明"桥 + 线格式 + 宿主 HTTP/DNS"三段真实；**不**证明 `useFetch` 的业务封装
//   （那由单测与 Android/iOS 的 JS 探针覆盖）。
import { fileIo } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { hostHttpProbe } from 'proteus_render';
import { InvokeFrame, encodeInvoke } from './InvokeWire';

const DOMAIN: number = 0x0000;
const TAG: string = 'HttpProbe';

/**
 * 跑一次 HTTP 探针并把回执落盘（完成信号 = 文件存在 + hilog `PROTEUS_HTTP_PROBE_DONE`）。
 *
 * @param filesDir 沙箱目录（回执落 `http-probe.json`）
 */
export function runHttpProbe(filesDir: string): void {
  let url: string = AppStorage.get<string>('proteusProbeUrl') ?? '';
  if (url.length === 0) url = 'https://httpbin.org/get';
  let result: string = '';
  // ★ArkTS 自己编一帧（frameHex 入参）——C++ 侧解它 ⇒ 真机上的跨语言逐字节契约
  let frameHex: string = '';
  try {
    const f: InvokeFrame = new InvokeFrame();
    f.method = 'http.request';
    f.reqId = 'probe-http-arkts-1';
    f.url = url;
    f.httpMethod = 'GET';
    f.responseType = 0;   // RESPONSE_TEXT
    /**
     * ★★★#1169：**HTTPDNS 表注入**（`dnsHost` + `dnsIp` 配对）。
     * ★必须在 **ArkTS 自编帧**这条路上加，否则 C++ 侧的 dnsHost 分支永远不执行
     *   （ArkTS 编的帧决定内容，C++ 只负责解码与执行）——本轮实测踩到：
     *   只在 C++ 加参 ⇒ `tableRules=0 · lastSource='probe'`，业务表根本没被测到。
     */
    const dnsHost: string | undefined = AppStorage.get<string>('proteusProbeDnsHost');
    const dnsIp: string | undefined = AppStorage.get<string>('proteusProbeDnsIp');
    if (dnsHost !== undefined && dnsIp !== undefined && dnsHost.length > 0 && dnsIp.length > 0) {
      const t = new Map<string, string>();
      t.set(dnsHost, dnsIp);
      f.httpDns = t;
    }
    const bytes: Uint8Array = encodeInvoke(f);
    let hex: string = '';
    for (let i = 0; i < bytes.length; i++) {
      const b: number = bytes[i];
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
    frameHex = hex;
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'HTTP_PROBE_ARKTS_ENCODE_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
  try {
    // ★#1169：dnsForceIp=假解析器探针 · dnsHost+dnsIp=业务表注入（互斥；缺省都不传 ⇒ 生产零影响）
    result = hostHttpProbe(JSON.stringify({
      'url': url,
      'frameHex': frameHex,
      'filesDir': filesDir,
      'dnsForceIp': AppStorage.get<string>('proteusProbeDnsIp'),
      'dnsHost': AppStorage.get<string>('proteusProbeDnsHost'),
      'dnsIp': AppStorage.get<string>('proteusProbeDnsIp'),
    } as Record<string, Object>));
  } catch (e) {
    result = '{"ok":false,"host":"harmony","error":"' + JSON.stringify(e) + '"}';
  }
  try {
    const path: string = filesDir + '/http-probe.json';
    const fd = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    fileIo.writeSync(fd.fd, result);
    fileIo.closeSync(fd.fd);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'HTTP_PROBE_WRITE_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
  hilog.info(DOMAIN, TAG, 'PROTEUS_HTTP_PROBE_DONE %{public}s', result);
}
