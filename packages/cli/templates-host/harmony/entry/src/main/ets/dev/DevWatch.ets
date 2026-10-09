// {{appName}} —— Proteus 鸿蒙 dev-watch（**dev 变体专用**；release 不创建）
//
// 【它做什么（决策 #728 · 鸿蒙 dev 通道地基）】与 Android/iOS 的 `startDevWatch` 同契约（dev server 端无关）：
//   · `GET /version` → 变 ⇒ `GET /bundle` → 主线程热刷（`applyBundle`）；
//   · `GET /ping?screen&env&perf` 心跳（面板"设备在线 + 当前屏 + 设备环境"）；
//   · `GET /log?channel=native&level&text` 宿主原生日志 → 面板 Console；
//   · `GET /trace?<encoded>` 事件 trace → 面板 Events；
//   · `POST /tree` 实例化树 → 面板 Elements。
//   【本批不做命令集】`/cmd`（highlight/edit/reset/eval）留下批（需新 native 高亮原语）。
//
// 【有界轮询、非盲等】固定 `setInterval` 节奏（与 Android dev-watch 的 `Thread.sleep(1000)` 同族——
//   产品内的**周期性 dev 轮询**，每轮都有明确的上报/比对动作，不是"等条件满足"的盲等）。
// 【单飞（busy）】一轮未跑完不叠下一轮（HTTP 异步；防请求堆积）。
// 【宿主注入用函数字段（非 interface）】ArkTS 结构类型不认对象字面量 ⇒ 宿主直接给本类赋**函数字段**。
import { http } from '@kit.NetworkKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0003;
const TAG = 'ProteusDevWatch';
const TICK_MS = 1500;

export class DevWatch {
  private base: string;
  private timer: number = -1;
  private busy: boolean = false;
  /** 上次已知版本（'' = 尚未取到 ⇒ 首次视为"变化"⇒ 加载 dev bundle）。 */
  private lastVer: string = '';
  /** 读数 / 动作（宿主注入）。 */
  public currentScreen: () => string = () => '';
  public envJson: () => string = () => '{}';
  public perfJson: () => string = () => '{}';
  public takeTreeJson: () => string = () => '';
  public takeLogs: () => string[] = () => [];
  public takeTraces: () => string[] = () => [];
  /** ★被点元素 id（决策 #730；-1=无）⇒ `/inspect` 上报（面板高亮被点节点）。 */
  public takeInspect: () => number = () => -1;
  public applyBundle: (b: string, v: string) => void = () => {};
  /** ★面板→设备命令（决策 #729）：GET `/cmd` 取到非空命令 ⇒ 回调宿主 `applyCommand(json)`。 */
  public onCmd: (json: string) => void = () => {};

  constructor(base: string) {
    this.base = base.replace(/\/+$/, '');
  }

  start(): void {
    if (this.timer >= 0) { return; }
    // ★首轮即加载 dev bundle：`lastVer=''` ⇒ 首次 `/version` 视为"变化" ⇒ 走 §⑤ 热刷路径取 `/bundle` 并重渲。
    //   （启动时先渲 rawfile 内嵌包出首帧；dev 包到达后覆盖——与 Android/iOS"dev 走 server"同语义。）
    this.timer = setInterval(() => { this.tick(); }, TICK_MS);
    hilog.info(DOMAIN, TAG, 'DEVWATCH_START base=%{public}s', this.base);
  }

  stop(): void {
    if (this.timer >= 0) { clearInterval(this.timer); this.timer = -1; }
  }

  private get(path: string, onOk?: (body: string) => void, onDone?: () => void): void {
    const req = http.createHttp();
    req.request(this.base + path, {
      method: http.RequestMethod.GET,
      expectDataType: http.HttpDataType.STRING,
      connectTimeout: 3000,
      readTimeout: 5000,
    }).then((resp: http.HttpResponse) => {
      const body: string = typeof resp.result === 'string' ? resp.result : '';
      if (onOk !== undefined) { onOk(body); }
    }).catch((_e: Object) => {
      // 心跳/上报**尽力而为**：失败静默（不干扰热刷）——与 Android 同
    }).finally(() => {
      try { req.destroy(); } catch (_e) { /* 无 */ }
      if (onDone !== undefined) { onDone(); }
    });
  }

  private post(path: string, body: string): void {
    const req = http.createHttp();
    const hdr: Record<string, string> = { 'content-type': 'application/json' };
    req.request(this.base + path, {
      method: http.RequestMethod.POST,
      expectDataType: http.HttpDataType.STRING,
      extraData: body,
      header: hdr,
      connectTimeout: 3000,
      readTimeout: 5000,
    }).then((_resp: http.HttpResponse) => {
      /* ok */
    }).catch((_e: Object) => {
      /* 尽力而为 */
    }).finally(() => {
      try { req.destroy(); } catch (_e) { /* 无 */ }
    });
  }

  private tick(): void {
    if (this.busy) { return; }   // 单飞：上一轮未完成则跳过本轮
    this.busy = true;
    // ① 心跳（先发——否则"版本没变"主路径永不 ping ⇒ 面板一直"设备离线"，同 Android 教训）
    this.get('/ping?screen=' + encodeURIComponent(this.currentScreen())
      + '&env=' + encodeURIComponent(this.envJson())
      + '&perf=' + encodeURIComponent(this.perfJson()));
    // ② 日志 → Console（`channel\tlevel\ttext`；channel=project|native）
    const logs: string[] = this.takeLogs();
    for (const l of logs) {
      const parts: string[] = l.split('\t');
      const channel: string = parts.length >= 3 ? parts[0] : 'native';
      const level: string = parts.length >= 3 ? parts[1] : (parts[0] || 'log');
      const text: string = parts.length >= 3 ? parts.slice(2).join('\t') : parts.slice(1).join('\t');
      this.get('/log?channel=' + encodeURIComponent(channel) + '&level=' + encodeURIComponent(level) + '&text=' + encodeURIComponent(text));
    }
    // ③ 事件 trace → Events
    const traces: string[] = this.takeTraces();
    for (const t of traces) { if (t.length > 0) { this.get('/trace?' + t); } }
    // ④ 实例化树 → Elements（有则上报）
    const tree: string = this.takeTreeJson();
    if (tree.length > 0) { this.post('/tree', tree); }
    // ④b 被点元素 → 面板高亮（决策 #730）
    const ins: number = this.takeInspect();
    if (ins >= 0) { this.get('/inspect?id=' + ins); }
    // ⑤ 面板→设备命令（决策 #729）：`/cmd` one-shot（取走即清）；非空 ⇒ 宿主执行（highlight/edit/reset/eval）。
    this.get('/cmd', (c: string) => {
      const t: string = c.trim();
      if (t.length > 2 && t !== '{}' && t !== 'null') { this.onCmd(t); }
    });
    // ⑥ 版本 → 热刷（最后一件事；回调里放开单飞）
    this.get('/version', (v: string) => {
      const nv: string = v.trim();
      if (nv.length > 0 && nv !== this.lastVer) {
        this.lastVer = nv;
        this.get('/bundle', (b: string) => {
          if (b.length > 0) { this.applyBundle(b, nv); }
        });
      }
    }, () => { this.busy = false; });
  }
}
