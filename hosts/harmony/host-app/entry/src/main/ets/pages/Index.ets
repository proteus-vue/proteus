// hosts/harmony/host-app/entry/src/main/ets/pages/Index.ets
// Proteus 鸿蒙宿主首页 —— ★★★RenderNode 直绘接入（方案 §2.2 路径 B）第二里程碑
//
// 【本页做什么】证明 Proteus 指令流（RenderCmd 同形）能经 NAPI → C++ →
//   `OH_ArkUI_RenderNodeUtils_*` **直建渲染节点树**并挂到页面（不经 ArkUI measure/layout）。
//
// 【挂载链（实测形态）】ArkTS `NodeContent`（放 ContentSlot 里）→ `native.attach(content)`
//   （C++ 侧 `OH_ArkUI_GetNodeContentFromNapiValue` 取句柄）→ `native.renderCommands(json)`
//   （C++ 建 RenderNode 子树 + customNode 包装 + `OH_ArkUI_NodeContent_AddNode` 挂载）。
//
// 【指令流形态】`renderCommands` 参数 = RenderCmd 同形 JSON（kind/x/y/w/h/color/radius）——
//   `x/y/w/h` 为整数逻辑像素（内核已吸附——卡 I2），`color` 为 ARGB uint32
//   （由 JS 侧从 CSS 色转出：一处实现；见 `cssToArgb`）。
import { deviceInfo } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NodeContent } from '@kit.ArkUI';
import { attach, renderCommands, stats, ProteusRenderStats } from 'libproteus_render.so';

const DOMAIN = 0x0002;
const TAG = 'ProteusRender';

/** CSS 十六进制色（#RRGGBB / #AARRGGBB）→ ARGB uint32（RenderNode 的 SetBackgroundColor 格式） */
function cssToArgb(css: string): number {
  const hex = css.replace('#', '');
  // #RRGGBB → FF000000 | RGB；#AARRGGBB → 原样
  const v = hex.length === 8 ? parseInt(hex, 16) : (0xff000000 | parseInt(hex, 16));
  return v >>> 0;
}

/** 测试指令（RenderCmd 同形——★ArkTS 严格模式要求显式接口，见 arkts-no-untyped-obj-literals） */
interface RenderCmdFixture {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  radius: number;
}

/** 一屏测试指令（结构与 packages/layout-core/src/render-cmd.ts 一致） */
function buildTestCommands(): string {
  const cmds: RenderCmdFixture[] = [
    { kind: 'background', x: 40, y: 120, w: 300, h: 160, color: cssToArgb('#3478F6'), radius: 16 },
    { kind: 'background', x: 60, y: 300, w: 260, h: 120, color: cssToArgb('#F5A623'), radius: 12 },
    { kind: 'background', x: 80, y: 440, w: 220, h: 100, color: cssToArgb('#1ABC9C'), radius: 8 },
    { kind: 'background', x: 100, y: 560, w: 180, h: 80, color: cssToArgb('#9B59B6'), radius: 24 },
  ];
  return JSON.stringify(cmds);
}

@Entry
@Component
struct Index {
  private content: NodeContent = new NodeContent();
  @State rendered: number = -1;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_PAGE_APPEAR');
  }

  build() {
    Stack() {
      // ── ① RenderNode 直绘区（NodeContent 挂载点）──
      ContentSlot(this.content)

      // ── ② 标注层（ArkUI 声明式——对照用；判据看 native 上报与截图）──
      Column({ space: 8 }) {
        Text('Proteus RenderNode 直绘').fontSize(22).fontWeight(FontWeight.Bold)
        Text(`native nodes = ${this.rendered}`).fontSize(14).fontColor('#666666')
          .id('proteus-native-count')
        Text(`设备 ${deviceInfo.productModel} · API ${deviceInfo.sdkApiVersion}`)
          .fontSize(12).fontColor('#999999')
      }
      .width('100%')
      .padding({ top: 40, left: 16, right: 16 })
      .align(Alignment.TopStart)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F7F7F9')
    .onAppear(() => {
      // ★接线：attach(NodeContent) → renderCommands(指令流)
      //   C++ 侧上报 PROTEUS_RENDER_ATTACHED / PROTEUS_RENDER_DONE（宿主主动上报——零盲等验收）
      try {
        const rcAttach = attach(this.content);
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_ATTACH rc=%{public}d', rcAttach);
        const n = renderCommands(buildTestCommands());
        this.rendered = n;
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_DONE nodes=%{public}d', n);
        const st: ProteusRenderStats = stats();
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_STATS nodes=%{public}d', st.nodes);
      } catch (e) {
        hilog.error(DOMAIN, TAG, 'PROTEUS_RENDER_JS_ERROR %{public}s', JSON.stringify(e) ?? '');
      }
    })
  }
}
