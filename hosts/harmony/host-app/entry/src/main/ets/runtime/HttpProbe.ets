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
import { UploadSpec } from './InvokeWire';
// ★★★#1285：探针场景不渲染 ⇒ 必须自己 drain 设备动作队列（见文件尾注释），否则 phone.call 只是入队不执行
import { runDeviceActions } from './DeviceSnapshot';

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
  /** ★#1187 诊断：探针实际拿到的入参（savePath 没生效时用来归因） */
  let probeDiag: Record<string, string> = {};
  // ★ArkTS 自己编一帧（frameHex 入参）——C++ 侧解它 ⇒ 真机上的跨语言逐字节契约
  let frameHex: string = '';
  /**
   * ★★★#1210：**能力直通模式**——`proteusProbeCapMethod` 非空时，编一个
   *   `method=<capMethod>` + `body=JSON(args)` 的 PINV 帧，走**通用能力分发**
   *   （`invokeBytes` 的非 `http.request` 分支 ⇒ `screenInvokeDispatch`）。
   * ★为什么需要它：`fs.*` / `log.*` / `cookie.*` 这类能力**不是 `http.request`**，
   *   现有探针只会编 http 帧 ⇒ 没有这条通路，这些能力在鸿蒙端**无法真机取证**。
   * ★诚实边界：这条通路验的是「帧 → 通用分发 → 宿主方法」，与业务 `useStorage`
   *   走的是同一条能力通道（差别只在 JS 侧那层封装，已有单测覆盖）。
   */
  const capMethodIn: string | undefined = AppStorage.get<string>('proteusProbeCapMethod');
  /**
   * ★`capArgs` 以 **base64** 传入（`aa start --ps` 会吃掉 `{}`/`"`/`,` 等字符——#1187/#1202 实测）。
   * ★这里用简单 base64 解码（ArkTS 有 `util.Base64Helper`，但为少一个依赖用纯算术实现）。
   */
  const capArgsB64: string | undefined = AppStorage.get<string>('proteusProbeCapArgsB64');
  let capArgsDecoded: string = '';
  if (capArgsB64 !== undefined && capArgsB64.length > 0) {
    // ★自带 base64 解码（不依赖全局 `atob`——鸿蒙 ArkTS 不保证有；也不用 `util.Base64Helper` 少一个依赖）
    // ★支持 **base64url**（`-` → `+`、`_` → `/`）且**无填充**——因为 `aa start --ps` 会吃掉 `=`
    //   （实测：带 `==` 的 base64 让 `aa start` 直接启动失败）
    const ABC: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out: string = '';
    let buf: number = 0;
    let bits: number = 0;
    for (let i = 0; i < capArgsB64.length; i++) {
      let ch: string = capArgsB64.charAt(i);
      if (ch === '=') break;
      if (ch === '-') ch = '+';
      else if (ch === '_') ch = '/';
      const v: number = ABC.indexOf(ch);
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buf >> bits) & 0xff);
      }
    }
    capArgsDecoded = out;
  }
  const isCapProbe: boolean = capMethodIn !== undefined && capMethodIn.length > 0;
  try {
    const f: InvokeFrame = new InvokeFrame();
    f.method = isCapProbe ? (capMethodIn as string) : 'http.request';
    f.reqId = isCapProbe ? 'probe-cap-arkts-1' : 'probe-http-arkts-1';
    if (isCapProbe) {
      // ★通用分支：body = JSON args 字节
      const argsText: string = capArgsDecoded.length > 0 ? capArgsDecoded : '{}';
      const ab: Uint8Array = new Uint8Array(argsText.length);
      for (let i = 0; i < argsText.length; i++) ab[i] = argsText.charCodeAt(i) & 0xff;
      f.body = ab;
    }
    f.url = url;
    /**
     * ★★★#1205：**上传必须是 POST**（multipart 体只在有方法体语义时才会被发送）。
     * ★之前固定 `GET` ⇒ 上传组会发出一个**没有体的 GET**（服务端 `bodyBytes:0`），
     *   而客户端回执仍是 200 ⇒ 只看客户端会误判"上传成功"。这正是判据要看服务端回显的原因。
     */
    const httpMethodIn: string | undefined = AppStorage.get<string>('proteusProbeHttpMethod');
    // ★#1210：能力直通模式不设 http 专有字段（否则帧里混入 http 语义，宿主分派也会困惑）
    if (!isCapProbe) {
      f.httpMethod = httpMethodIn !== undefined && httpMethodIn.length > 0 ? httpMethodIn : 'GET';
      f.responseType = 0;   // RESPONSE_TEXT
    }
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
    /**
     * ★★★#1187：`savePath`（宿主逐块落盘）与 `stream`（应被如实拒绝）两个入参。
     * ★探针侧必须能分别驱动它们——否则这两个语义在鸿蒙端**无法真机验证**。
     */
    const savePathIn: string | undefined = AppStorage.get<string>('proteusProbeSavePath');
    if (savePathIn !== undefined && savePathIn.length > 0) f.savePath = savePathIn;
    const streamIn: string | undefined = AppStorage.get<string>('proteusProbeStream');
    if (streamIn === '1') f.stream = true;
    /**
     * ★★★#1203：`tlsPins`（应被**如实拒绝**——RCP 无指纹校验回调）。
     * ★探针必须能驱动它，否则"配了 pin 但静默不校验"这个**安全缺陷**在鸿蒙端无法真机验证。
     * ★`tlsPinOnly` 用 `1` 驱动（单独出现也应被拒：它表达了"信任判定由 pin 决定"的意图）。
     */
    const pinsIn: string | undefined = AppStorage.get<string>('proteusProbeTlsPins');
    if (pinsIn !== undefined && pinsIn.length > 0) f.tlsPins = pinsIn;
    const pinOnlyIn: string | undefined = AppStorage.get<string>('proteusProbeTlsPinOnly');
    if (pinOnlyIn === '1') f.tlsPinOnly = true;
    /**
     * ★★★#1205：`upload`（multipart 流式上传）——与 JS 侧 `UploadSpec` 同构。
     * ★`boundary` 必须给（JS 侧要写进 Content-Type；鸿蒙宿主会**剔除该头**由平台自生成，
     *   但字段仍按契约传，便于与 Android/iOS 同一份帧）。
     */
    const uploadPathIn: string | undefined = AppStorage.get<string>('proteusProbeUploadPath');
    const uploadFieldIn: string | undefined = AppStorage.get<string>('proteusProbeUploadField');
    if (uploadPathIn !== undefined && uploadPathIn.length > 0) {
      const u = new UploadSpec();
      u.path = uploadPathIn;
      u.fieldName = uploadFieldIn !== undefined && uploadFieldIn.length > 0 ? uploadFieldIn : 'file';
      u.filename = AppStorage.get<string>('proteusProbeUploadFilename') ?? '';
      u.boundary = '----ProteusHarmonyBoundaryProbe';
      // ★#1205：上传默认用 POST（multipart 只有 POST/PUT 才有体语义）
      if (httpMethodIn === undefined || httpMethodIn.length === 0) f.httpMethod = 'POST';
      const fd = new Map<string, string>();
      const f1k = AppStorage.get<string>('proteusProbeUploadField1Key');
      const f1v = AppStorage.get<string>('proteusProbeUploadField1Value');
      if (f1k !== undefined && f1k.length > 0) fd.set(f1k, f1v ?? '');
      u.formData = fd;
      f.upload = u;
    }
    /** ★#1187 诊断：把"探针实际拿到的入参"回显进报告（否则 savePath 没生效时无从归因） */
    probeDiag = { 'savePath': savePathIn ?? '', 'stream': streamIn ?? '', 'filesDir': filesDir,
                  'targetUrl': url, 'tlsPins': (pinsIn ?? '').length > 0 ? 'set' : '',
                  'tlsPinOnly': pinOnlyIn ?? '', 'uploadPath': uploadPathIn ?? '',
                  'capMethod': capMethodIn ?? '', 'capArgs': capArgsDecoded };
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
      // ★★★#1202：DoH 落点探针（进程级状态，非帧字段 ⇒ 线格式零改动）
      'dohUrl': AppStorage.get<string>('proteusProbeDohUrl') ?? '',
      'dohSkipCert': AppStorage.get<string>('proteusProbeDohSkipCert') ?? '',
      'probeDiag': JSON.stringify(probeDiag),
    } as Record<string, Object>));
  } catch (e) {
    result = '{"ok":false,"host":"harmony","error":"' + JSON.stringify(e) + '"}';
  }
  try {
    /* ★★★#1344：**报告文件名必须随用途变化**（否则装置污染生产证据）。
       此前不管是 HTTP 判据还是 `--cap-method=<能力>` 直通，都写同一个 `http-probe.json`
       ⇒ 跑一次 share / phone.call 探针就把 HTTP 判据的证据覆盖掉。
       实测后果：`tests/fetch-cancel.test.ts` 的「慢请求 8s 完整返回」判据读到 share 的
       `{"status":0,...}` 而变红——**装置缺陷伪装成能力缺陷**（等价于"证据被换成别人的"）。
       ★主机侧 `run-http-probe.sh` 的 `REPORT_FILE` 与本处**同一命名规则**，两边必须一致。 */
    let capSlug: string = '';
    if (isCapProbe) {
      const src: string = capMethodIn ?? '';
      for (let i = 0; i < src.length; i++) {
        const ch: string = src.charAt(i);
        const safe: boolean = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
          || (ch >= '0' && ch <= '9') || ch === '.' || ch === '_' || ch === '-';
        capSlug += safe ? ch : '_';
      }
    }
    const reportName: string = capSlug.length > 0 ? ('http-probe-cap-' + capSlug + '.json') : 'http-probe.json';
    const path: string = filesDir + '/' + reportName;
    const fd = fileIo.openSync(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    fileIo.writeSync(fd.fd, result);
    fileIo.closeSync(fd.fd);
    hilog.info(DOMAIN, TAG, 'HTTP_PROBE_PATH %{public}s', reportName);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'HTTP_PROBE_WRITE_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
  hilog.info(DOMAIN, TAG, 'PROTEUS_HTTP_PROBE_DONE %{public}s', result);
  /**
   * ★★★#1285：**探针场景也要 drain 一次设备动作队列**。
   *
   * 【为什么必须有】`phone.call` 在鸿蒙走"动作队列"（同步 napi 里不能 await `startAbility`）：
   *   C++ 入队、ArkTS 在**渲染后** `runDeviceActions()` 执行。而探针场景（`superapp-http`）
   *   **不渲染** ⇒ `runDeviceActions` 永远不会被调用 ⇒ 动作烂在队列里，
   *   回执只有 `{accepted:true, queued:1}` 而**拨号盘根本没被拉起**。
   *   ★这正是"回执说受理 ≠ 真的发生"——本仓最忌的形态。探针必须自己把队列消费掉，
   *     否则能力直通探针会给出**看起来成功、实际什么都没做**的假证据。
   * 【★诚实边界】此处不传 `win`（探针场景没有窗口）⇒ 依赖窗口的动作（亮度/常亮）会跳过，
   *   但 `phone.call` 用的是 `ctx.startAbility`（不需要窗口）⇒ 能真执行。
   */
  try {
    runDeviceActions(undefined);
  } catch (e) {
    hilog.error(DOMAIN, TAG, 'HTTP_PROBE_DRAIN_FAIL %{public}s', JSON.stringify(e) ?? '');
  }
}
