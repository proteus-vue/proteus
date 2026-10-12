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
// ★矩阵 #18 C 组：真生命周期 → JS 运行时转发（G-39"壳把生命周期交给 runtime"的端上证据）
import { hostRtShellEvent } from 'proteus_render';

const DOMAIN = 0x0001;
const TAG = 'ProteusHost';

export default class EntryAbility extends UIAbility {
  /** 本 Ability 要加载的页面（onCreate 决定，onWindowStageCreate 读取） */
  private pageToLoad: string = 'shell/Superapp';
  /** ★决策 #853：窗口级 stage 缓存（`onNewWant` 重载用）。 */
  private windowStageRef: window.WindowStage | null = null;

  /** 解析 Want 的场景参数（scene/scroll/ms）→ AppStorage + pageToLoad；返回 scene 是否变化。 */
  private applyWant(want: Want): boolean {
    const scene = want?.parameters?.['scene'];
    const sceneStr: string = typeof scene === 'string' ? scene : '';
    const changed: boolean = AppStorage.get<string>('proteusScene') !== sceneStr;
    AppStorage.setOrCreate('proteusScene', sceneStr);
    const scroll = want?.parameters?.['scroll'];
    AppStorage.setOrCreate('proteusScroll', typeof scroll === 'string' ? scroll : '');
    const ms = want?.parameters?.['ms'];
    AppStorage.setOrCreate('proteusPumpMs', typeof ms === 'string' ? ms : (typeof ms === 'number' ? String(ms) : ''));
    if (sceneStr === '' || sceneStr === 'superapp' || sceneStr === 'superapp-drive'
        || sceneStr.startsWith('superapp-screen-') || sceneStr.startsWith('superapp-pump-')) {
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
