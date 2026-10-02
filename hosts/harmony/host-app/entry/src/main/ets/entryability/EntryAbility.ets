// hosts/harmony/host-app/entry/src/main/ets/entryability/EntryAbility.ets
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
import { hostRtShellEvent } from 'libproteus_bench.so';

const DOMAIN = 0x0001;
const TAG = 'ProteusHost';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    // ★场景参数（`aa start ... --ps scene stress`）→ AppStorage（页面读取后走压力场景分支）
    const scene = want?.parameters?.['scene'];
    const sceneStr: string = typeof scene === 'string' ? scene : '';
    AppStorage.setOrCreate('proteusScene', sceneStr);
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_ONCREATE bundle=dev.proteus.host scene=%{public}s', sceneStr);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // ★机器判据：此行即"宿主已启动"信号（验证脚本 grep 它——见 hosts/harmony/run-host-app.sh）
    hilog.info(DOMAIN, TAG,
      'PROTEUS_HOST_READY model=%{public}s os=%{public}s api=%{public}d display=%{public}s',
      deviceInfo.productModel, deviceInfo.osFullName, deviceInfo.sdkApiVersion, deviceInfo.displayVersion);

    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'PROTEUS_HOST_ERROR loadContent failed: %{public}s', JSON.stringify(err) ?? '');
        return;
      }
      hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_LOADED page=pages/Index');
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
