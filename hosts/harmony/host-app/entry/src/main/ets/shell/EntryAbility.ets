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

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // ★场景参数（`aa start ... --ps scene stress`）→ AppStorage（页面读取后走对应场景分支）
    const scene = want?.parameters?.['scene'];
    const sceneStr: string = typeof scene === 'string' ? scene : '';
    AppStorage.setOrCreate('proteusScene', sceneStr);
    // ★★★批次 44（2026-10-05）：**桌面点开（无 scene）= superapp 真实应用**（用户原话
    //   「手机主屏图标点开 App 就能测完整体验」）；脚本要跑装置/探针 ⇒ 显式传 `--ps scene <名>`
    //   （含 `bench` = 原缺省的全套装置路径）⇒ 落 dev/Index。
    //   ★语义同 iOS（Info.plist 缺省场景 = superapp；脚本显式 `--selfdraw/--app-stack/…`）。
    // ★★★逐屏截图装置（2026-10-05）：`superapp-screen-<name>` 也落 shell/Superapp（启动后导航到该屏）。
    if (sceneStr === '' || sceneStr === 'superapp' || sceneStr === 'superapp-drive' || sceneStr.startsWith('superapp-screen-')) {
      this.pageToLoad = 'shell/Superapp';
    } else {
      this.pageToLoad = 'dev/Index';
    }
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_ONCREATE bundle=dev.proteus.host scene=%{public}s page=%{public}s', sceneStr, this.pageToLoad);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
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
