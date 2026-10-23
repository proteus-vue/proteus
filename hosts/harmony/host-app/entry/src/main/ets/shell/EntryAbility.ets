// hosts/harmony/host-app/entry/src/main/ets/shell/EntryAbility.ets
// Proteus 鸿蒙宿主 —— 入口 Ability（第一里程碑：装机 + 启动可机器验证）
//
// 【设计约束（对齐本仓"禁止盲等"纪律）】宿主**主动上报**启动完成信号：
//   onWindowStageCreate 里向 hilog 打 `PROTEUS_HOST_READY` 标记行——
//   验证脚本用 hilog 条件等待它（零 sleep；与 iOS 腿 PROTEUS_EXIT_AFTER_REPORT 同思路）。
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
import { fileIo } from '@kit.CoreFileKit';
// ★矩阵 #18 C 组：真生命周期 → JS 运行时转发（G-39"壳把生命周期交给 runtime"的端上证据）
import { hostRtShellEvent } from 'proteus_render';

const DOMAIN = 0x0001;
const TAG = 'ProteusHost';

export default class EntryAbility extends UIAbility {
  /** 本 Ability 要加载的页面（onCreate 决定，onWindowStageCreate 读取） */
  private pageToLoad: string = 'shell/Superapp';
  /** ★决策 #853：窗口级 stage 缓存（`onNewWant` 重载用）。 */
  private windowStageRef: window.WindowStage | null = null;

  /** ★决策 #854：上次场景的**文件持久化**（同步写，抗 force-stop；PersistentStorage 不刷盘不可靠）。 */
  private lastScenePath(): string { return this.context.filesDir + '/proteus-last-scene.txt'; }
  private readLastScene(): string {
    try {
      const fd = fileIo.openSync(this.lastScenePath(), fileIo.OpenMode.READ_ONLY);
      const buf = new ArrayBuffer(256);
      const n = fileIo.readSync(fd.fd, buf);
      fileIo.closeSync(fd);
      const bytes = new Uint8Array(buf).slice(0, n);
      let s = ''; for (let i = 0; i < bytes.length; i++) { if (bytes[i] === 0) break; s += String.fromCharCode(bytes[i]); }
      return s.trim();
    } catch (e) { return ''; }
  }
  private writeLastScene(s: string): void {
    try {
      const fd = fileIo.openSync(this.lastScenePath(), fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(fd.fd, s);
      fileIo.closeSync(fd);
    } catch (e) { /* 写失败不阻断 */ }
  }

  /** 解析 Want 的场景参数（scene/scroll/ms）→ AppStorage + pageToLoad；返回 scene 是否变化。
   *  ★决策 #854：**记住上次场景**——无 `scene` 参数（桌面点开/重启）时**恢复上次场景**（文件持久化），
   *   便于反复测试（用户：「重启后想停在玻璃演示页」）。首次安装无记录 ⇒ 空 ⇒ superapp。 */
  private applyWant(want: Want): boolean {
    const scene = want?.parameters?.['scene'];
    let sceneStr: string = typeof scene === 'string' ? scene : '';
    if (sceneStr === '') {
      sceneStr = this.readLastScene();   // 无参数 ⇒ 恢复上次场景
    } else {
      this.writeLastScene(sceneStr);      // 记录本次（供下次无参恢复）
    }
    const changed: boolean = AppStorage.get<string>('proteusScene') !== sceneStr;
    AppStorage.setOrCreate('proteusScene', sceneStr);
    // ★T-app-fetch：HTTP 探针目标 URL（`--ps url https://…`）
    const probeUrl = want?.parameters?.['url'];
    AppStorage.setOrCreate('proteusProbeUrl', typeof probeUrl === 'string' ? probeUrl : '');
    // ★★★#1167：DNS 探针（`--ps dnsIp 203.0.113.1`）——把目标 host 强制解析到该 IP，
    //   用于取证 `RCP_DNS_RULE_DYNAMIC` 这条路是否真接通（给不可达 IP ⇒ 请求必失败）。
    //   ★不给就**不设置**这个键（HTTP 探针读不到 ⇒ 不安装假解析器，生产行为零影响）。
    const probeDnsIp = want?.parameters?.['dnsIp'];
    if (typeof probeDnsIp === 'string' && probeDnsIp.length > 0) {
      AppStorage.setOrCreate('proteusProbeDnsIp', probeDnsIp);
    }
    // ★#1169：域名（与 dnsIp 配对 ⇒ 往帧里塞 httpDns 表，验证宿主的表解析生效）
    const probeDnsHost = want?.parameters?.['dnsHost'];
    if (typeof probeDnsHost === 'string' && probeDnsHost.length > 0) {
      AppStorage.setOrCreate('proteusProbeDnsHost', probeDnsHost);
    }
    /**
     * ★★★#1202：DoH 落点探针（`--ps dohUrl https://127.0.0.1:18443/dns-query`）。
     * ★斜杠同样会被 `aa start --ps` 吃掉（#1187 实测）⇒ 脚本侧传 `%2F`，这里解回 `/`。
     * ★不给 ⇒ 不设置该键 ⇒ 探针不启用 DoH（生产路径零影响）。
     */
    const probeDohUrl = want?.parameters?.['dohUrl'];
    if (typeof probeDohUrl === 'string' && probeDohUrl.length > 0) {
      AppStorage.setOrCreate('proteusProbeDohUrl', probeDohUrl.split('%2F').join('/'));
    }
    const probeDohSkip = want?.parameters?.['dohSkipCert'];
    if (probeDohSkip !== undefined) {
      AppStorage.setOrCreate('proteusProbeDohSkipCert', String(probeDohSkip) === '1' ? '1' : '');
    }
    // ★★★#1187：`savePath`（宿主逐块落盘）与 `stream`（应被如实拒绝）——两个语义各需真机验证
    // ★#1187 诊断：把 want.parameters 的**全部键**打出来（判断是 key 名变了还是值丢了）
    try { hilog.info(DOMAIN, TAG, 'WANT_PARAMS %{public}s', JSON.stringify(want?.parameters ?? {})); } catch (e) { }
    const probeSavePath = want?.parameters?.['savePath'];
    if (typeof probeSavePath === 'string' && probeSavePath.length > 0) {
      // ★★★#1187 真机踩坑：`aa start --ps savePath download/x.txt` 的**斜杠会被 aa 吃掉**
      //   （实测 want.parameters 里根本没有 savePath 这个键，而 scene/url 都在）。
      //   ⇒ 探针脚本传 `%2F`，这里解回 `/`（只解这一种，避免误伤路径里的 %）。
      AppStorage.setOrCreate('proteusProbeSavePath', probeSavePath.split('%2F').join('/'));
    }
    const probeStream = want?.parameters?.['stream'];
    if (probeStream !== undefined) {
      AppStorage.setOrCreate('proteusProbeStream', String(probeStream) === '1' ? '1' : '');
    }
    // ★★★#1156：传输层取证（`--ps transportUrl http://…` + `--ps rounds 3`）——
    //   ★单列参数名而**不复用** `url`：同一台机器上两个场景的 URL 语义不同
    //   （httpProbe 打公网、transport 打本地 h2 服务的明文端口），复用会互相覆盖。
    const tUrl = want?.parameters?.['transportUrl'];
    AppStorage.setOrCreate('proteusTransportUrl', typeof tUrl === 'string' ? tUrl : '');
    const tRounds = want?.parameters?.['rounds'];
    AppStorage.setOrCreate('proteusTransportRounds', typeof tRounds === 'string' ? tRounds : (typeof tRounds === 'number' ? String(tRounds) : ''));
    // ★#1156：sync / async 取证模式（见 transport_probe.h 的 async 分支注释）
    const tMode = want?.parameters?.['mode'];
    AppStorage.setOrCreate('proteusTransportMode', typeof tMode === 'string' ? tMode : '');
    const scroll = want?.parameters?.['scroll'];
    AppStorage.setOrCreate('proteusScroll', typeof scroll === 'string' ? scroll : '');
    const ms = want?.parameters?.['ms'];
    AppStorage.setOrCreate('proteusPumpMs', typeof ms === 'string' ? ms : (typeof ms === 'number' ? String(ms) : ''));
    // ★决策 #859：高刷请求开关（`--ps refresh off` ⇒ 玻璃场景不请求 120Hz，用于 A/B 对照）。
    const refresh = want?.parameters?.['refresh'];
    AppStorage.setOrCreate('proteusRefresh', typeof refresh === 'string' ? refresh : '');
    // ★决策 #860：玻璃分辨率降采样（`--ps glassS 3` ⇒ S=3，降 blit 尖峰成本）。
    const gs = want?.parameters?.['glassS'];
    AppStorage.setOrCreate('proteusGlassS', typeof gs === 'string' ? gs : (typeof gs === 'number' ? String(gs) : ''));
    // ★决策 #860：重算步长（`--ps glassDiv 6` ⇒ 每 6 帧重算一次，其余复用）。
    const gd = want?.parameters?.['glassDiv'];
    AppStorage.setOrCreate('proteusGlassDiv', typeof gd === 'string' ? gd : (typeof gd === 'number' ? String(gd) : ''));
    // ★决策 #1077：**前缀匹配**所有 superapp-* 场景（此前是逐个列举，新增场景漏加 ⇒ 落到 dev/Index）
    if (sceneStr === '' || sceneStr.startsWith('superapp')) {
      this.pageToLoad = 'shell/Superapp';
    } else {
      this.pageToLoad = 'dev/Index';
    }
    return changed;
  }

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // ★场景参数（`aa start ... --ps scene stress`）→ AppStorage（页面读取后走对应场景分支）
    this.applyWant(want);
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_ONCREATE bundle=dev.proteus.host scene=%{public}s page=%{public}s',
      AppStorage.get<string>('proteusScene') ?? '', this.pageToLoad);
  }

  /**
   * ★决策 #853：**应用已在运行时再次 `aa start`（带新场景参数）** —— 此前只在 `onCreate` 读场景，
   *   而运行中的 Ability 被 `aa start` 拉起时走的是 `onNewWant`（复用实例、不重跑 `onCreate`）
   *   ⇒ **新场景不生效**（真机实测：`aa start --ps scene glass-demo` 后仍是上一个场景 vkglass，
   *   用户「我现在看到的不是测试页」）。修 = `onNewWant` 里**重读场景并重载页面**。
   */
  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const changed = this.applyWant(want);
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_NEWWANT scene=%{public}s page=%{public}s changed=%{public}d',
      AppStorage.get<string>('proteusScene') ?? '', this.pageToLoad, changed ? 1 : 0);
    if (changed && this.windowStageRef !== null) {
      this.windowStageRef.loadContent(this.pageToLoad, (err) => {
        if (err.code) hilog.error(DOMAIN, TAG, 'PROTEUS_HOST_NEWWANT_ERR %{public}s', JSON.stringify(err) ?? '');
      });
    }
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.windowStageRef = windowStage;
    // ★机器判据：此行即"宿主已启动"信号（验证脚本 grep 它——见 hosts/harmony/run-host-app.sh）
    hilog.info(DOMAIN, TAG,
      'PROTEUS_HOST_READY model=%{public}s os=%{public}s api=%{public}d display=%{public}s',
      deviceInfo.productModel, deviceInfo.osFullName, deviceInfo.sdkApiVersion, deviceInfo.displayVersion);

    windowStage.loadContent(this.pageToLoad, (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'PROTEUS_HOST_ERROR loadContent failed: %{public}s', JSON.stringify(err) ?? '');
        return;
      }
      hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_LOADED page=%{public}s', this.pageToLoad);
    });
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_FOREGROUND');
    // ★真事件 → JS 运行时（resume）——触点是**真实 Ability 生命周期**（脚本用 HOME 键驱动），
    //   不是页内手动调（后者只能证明状态机，前者才证明"壳把生命周期交给了 runtime"）。
    try {
      const r: string = hostRtShellEvent('resume');
      hilog.info(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT resume %{public}s', r);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT_ERR resume %{public}s', JSON.stringify(e) ?? '');
    }
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_BACKGROUND');
    try {
      const r: string = hostRtShellEvent('pause');
      hilog.info(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT pause %{public}s', r);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT_ERR pause %{public}s', JSON.stringify(e) ?? '');
    }
  }
}
