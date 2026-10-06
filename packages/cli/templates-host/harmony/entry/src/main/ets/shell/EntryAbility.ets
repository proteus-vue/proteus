// {{appName}} —— 最小宿主入口 Ability（Proteus 生成）
//
// 【为什么这样写】Proteus 的「壳」只做三件事：① 加载宿主页面；② 把**真实 Ability 生命周期**
//   交给 runtime（`hostRtShellEvent`）——这是 G-39「壳把生命周期交给 runtime」的端上实现；
//   ③ 上报启动完成信号（`PROTEUS_HOST_READY`，供零 sleep 的条件等待）。
//   ★本壳**不含任何应用身份/业务逻辑**（那属于项目内容，由 runtime 按 rawfile 内容渲染）。
import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { deviceInfo } from '@kit.BasicServicesKit';
// ★壳 → runtime 单向依赖（runtime = 所依赖 HAR 'proteus_render'；见 hosts/README-LAYERS.md）
import { hostRtShellEvent } from 'proteus_render';

const DOMAIN = 0x0001;
const TAG = 'ProteusHost';

export default class EntryAbility extends UIAbility {
  /** 本 Ability 要加载的页面（宿主页面；由 runtime 依 rawfile 内容渲染） */
  private pageToLoad: string = 'shell/MainPage';

  onCreate(want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_ONCREATE bundle=%{public}s page=%{public}s',
      want.bundleName, this.pageToLoad);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // ★机器判据：此行即「宿主已启动」信号（验证脚本条件等待它——零 sleep）
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
    // ★真实 Ability 生命周期 → JS 运行时（resume）
    try {
      hilog.info(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT resume %{public}s', hostRtShellEvent('resume'));
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT_ERR resume %{public}s', JSON.stringify(e) ?? '');
    }
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_HOST_BACKGROUND');
    try {
      hilog.info(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT pause %{public}s', hostRtShellEvent('pause'));
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'PROTEUS_SHELL_EVENT_ERR pause %{public}s', JSON.stringify(e) ?? '');
    }
  }
}
