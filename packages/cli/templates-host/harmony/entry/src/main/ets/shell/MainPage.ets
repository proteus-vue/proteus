// {{appName}} —— 最小宿主页面（Proteus 生成）
//
// 【它做什么】把 **Proteus 编译产物**（`rawfile/app-screen-content.json`：项目路由 → 真实 SFC →
//   编译器 → 屏内容）经 runtime 渲染上屏：
//     `attach`（接 RenderNode 容器）→ `appScreenCommands`（内容 → 内核树 → RenderCmd）→
//     `renderCommands`（直绘上屏）→ `scrollRoot`（滚动位移）。
//   ★链路全部来自 runtime（HAR 'proteus_render'）——本页**不含项目身份**（页名/内容都从产物读）；
//     换一个项目只需替换 rawfile 产物。与 Android ScreenHost / iOS screen-host 同形。
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NodeContent, display } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { attach, renderCommands, scrollRoot, appScreenCommands, appScreenContentHeight } from 'proteus_render';

const DOMAIN = 0x0002;
const TAG = 'ProteusHostPage';

@Entry
@Component
struct MainPage {
  private content: NodeContent = new NodeContent();
  private filesDir: string = '';
  /** 每页 nodes 的 JSON 串（appScreenCommands 入参要字符串） */
  private nodesByPage: Map<string, string> = new Map<string, string>();
  @State current: string = '';
  private scrollOffset: number = 0;
  private maxScroll: number = 0;
  private touchLastY: number = -1;
  private static vpH: number = 844;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'HOST_PAGE_APPEAR');
    try {
      const ctx = getContext(this);
      this.filesDir = ctx.filesDir;
      // 编译产物：屏内容（键 = 页名；与 Web/MP/App 同源编译）
      const sb: Uint8Array = ctx.resourceManager.getRawFileContentSync('app-screen-content.json');
      const scStr: string = util.TextDecoder.create('utf-8').decodeToString(sb);
      const pages = JSON.parse(scStr) as Record<string, Record<string, Object>>;
      const names: string[] = Object.keys(pages);
      for (const nm of names) {
        this.nodesByPage.set(nm, JSON.stringify(pages[nm]['nodes']));
      }
      // 起始页：约定取 'index'（无则取首个）
      this.current = this.nodesByPage.has('index') ? 'index' : (names.length > 0 ? names[0] : '');
      this.renderCurrent();
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_BOOT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 把当前页内容真画到屏上（runtime 通道） */
  private renderCurrent(): void {
    if (!this.current || !this.nodesByPage.has(this.current)) return;
    const nodes: string | undefined = this.nodesByPage.get(this.current);
    if (!nodes) return;
    const disp = display.getDefaultDisplaySync();
    // ★vp 精确除法（vp2px(1) = density；避免 px2vp 截断成整数 vp 导致右缘差 1px）
    const vpDensity: number = vp2px(1);
    const vpW: number = disp.width / vpDensity;
    const vpH: number = disp.height / vpDensity;
    MainPage.vpH = vpH;
    try {
      attach(this.content, vpDensity, vpW, vpH);
      const cmds: string = appScreenCommands(JSON.stringify({
        'nodes': nodes, 'density': vpDensity, 'vpW': vpW, 'vpH': vpH,
        'page': this.current, 'filesDir': this.filesDir,
      } as Record<string, Object>));
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, TAG, 'HOST_PAGE_RENDER page=%{public}s nodes_rendered=%{public}d', this.current, n);
      const chVp: number = appScreenContentHeight();
      this.maxScroll = Math.max(0, chVp - vpH);
      if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
      if (this.scrollOffset < 0) this.scrollOffset = 0;
      scrollRoot(this.scrollOffset);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_RENDER_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 触摸滚动（与 App 三端同语义：手指上滑 ⇒ offset 增大 ⇒ 内容上移） */
  private onScrollTouch(e: TouchEvent): void {
    const t: TouchObject = e.touches[0];
    if (t === undefined) return;
    if (e.type === TouchType.Down) { this.touchLastY = t.windowY; return; }
    if (e.type === TouchType.Move) {
      if (this.touchLastY < 0) { this.touchLastY = t.windowY; return; }
      const dy: number = t.windowY - this.touchLastY;
      this.touchLastY = t.windowY;
      let next: number = this.scrollOffset - dy;
      if (next < 0) next = 0;
      if (next > this.maxScroll) next = this.maxScroll;
      if (next !== this.scrollOffset) { this.scrollOffset = next; scrollRoot(this.scrollOffset); }
      return;
    }
    if (e.type === TouchType.Up || e.type === TouchType.Cancel) this.touchLastY = -1;
  }

  build() {
    Column() {
      Stack() {
        ContentSlot(this.content)
      }
      .width('100%')
      .layoutWeight(1)
      .clip(true)
      .onTouch((e: TouchEvent) => { this.onScrollTouch(e); })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#101020')
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
