// hosts/harmony/host-app/entry/src/main/ets/pages/Index.ets
// Proteus 鸿蒙宿主首页（第一里程碑：证明"我们的 app"装上了并跑起来了）
//   显示设备档案（与 hosts/harmony/README.md 的记录同源——都以设备实测为准）
import { deviceInfo } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

@Entry
@Component
struct Index {
  @State rows: string[] = [
    `设备 ${deviceInfo.productModel}（${deviceInfo.productModelAlias}）`,
    `系统 ${deviceInfo.osFullName}`,
    `API ${deviceInfo.sdkApiVersion}`,
    `版本 ${deviceInfo.displayVersion}`
  ];

  aboutToAppear(): void {
    hilog.info(0x0001, 'ProteusHost', 'PROTEUS_PAGE_APPEAR rows=%{public}d', this.rows.length);
  }

  build() {
    Column({ space: 12 }) {
      Text('Proteus 鸿蒙宿主').fontSize(28).fontWeight(FontWeight.Bold)
      Text('dev.proteus.host · 0.1.0').fontSize(14).fontColor('#888888')
      Divider().width('80%').margin({ top: 8, bottom: 8 })
      ForEach(this.rows, (r: string) => {
        Text(r).fontSize(16)
      })
      Text('下一里程碑：RenderNode 直绘接入（API 20+，本机 API 26 满足）')
        .fontSize(12)
        .fontColor('#AAAAAA')
        .margin({ top: 24 })
    }
    .width('100%')
    .height('100%')
    .padding(24)
    .justifyContent(FlexAlign.Center)
  }
}
