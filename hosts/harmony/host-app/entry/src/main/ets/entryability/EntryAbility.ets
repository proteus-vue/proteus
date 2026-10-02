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

const DOMAIN = 0x0001;
const TAG = 'ProteusHost';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_ONCREATE bundle=dev.proteus.host');
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
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_BACKGROUND');
  }
}
