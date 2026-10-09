// {{appName}} —— 运行期宿主页面（Proteus 生成）
//
// 【它做什么】把 **Proteus 编译产物**经 runtime **运行期**上屏（与 Android/iOS 壳同级）：
//   ① rawfile `bundle-superapp.js`（项目路由 + 交互 + 响应式 + 导航）→ `hostAppRender`
//      （**一次性 VM**：eval bundle → boot 路由栈 → 共享运行期实例化当前屏 → host.mount 捕获 tree）；
//   ② 捕获到的 tree → `appScreenCommands`（内容 → 内核树 → RenderCmd）→ `renderCommands`（直绘）；
//   ③ 触摸：点按 → `appScreenHitAt` 命中链 → `hostAppRender(chain)` 派发（$nav 导航 / 数据变更）→ 重绘；
//      拖动 → `scrollRoot` 滚动位移。
//   ★链路全部来自 runtime（HAR 'proteus_render'）——本页**不含项目身份**（页名/内容都从产物读）；
//     换一个项目只需替换 rawfile 产物。缺 bundle 时**回退静态 `app-screen-content.json`**（诚实降级）。
//
// 【★一次性 VM 的状态回灌】鸿蒙 JSVM 跨调用复用会崩（本机唯一稳定形态 = 一次性）⇒ 每次交互新建 VM，
//   跨交互实例态（计数/列表）靠 `hostAppRender` 返回的 `snapshot` 回灌为下次 `state`（seedData）。
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NodeContent, display } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import {
  attach, renderCommands, scrollRoot, clearRoot,
  appScreenCommands, appScreenContentHeight, appScreenHitAt, hostAppRender,
} from 'proteus_render';

const DOMAIN = 0x0002;
const TAG = 'ProteusHostPage';

/** 运行期渲染入参（ArkTS 禁未型字面量 ⇒ 用接口声明） */
interface RtViewport { width: number; height: number }
interface RtArgs { bundle: string; filesDir: string; page: string; viewport: RtViewport; chain?: number[]; state?: Record<string, Object> }

@Entry
@Component
struct MainPage {
  private content: NodeContent = new NodeContent();
  private filesDir: string = '';
  /** 运行期 bundle 源（每次交互的一次性 VM 都要 eval 它） */
  private bundle: string = '';
  /** 每页 nodes 的 JSON 串（runtime 不可用时的静态回退） */
  private nodesByPage: Map<string, string> = new Map<string, string>();
  @State current: string = '';
  private scrollOffset: number = 0;
  private maxScroll: number = 0;
  private touchLastY: number = -1;
  private touchStartX: number = -1;
  private touchStartY: number = -1;
  private touchMoved: boolean = false;
  /** ArkTS 侧导航历史栈（一次性 VM：JS 路由态不跨调用保留 ⇒ 返回栈由宿主记） */
  private navStack: string[] = [];
  /** 上次 hostAppRender 返回的 snapshot（`{屏名:{变量:值}}`）——下次新 VM 回灌 state */
  private runtimeState: Record<string, Object> | null = null;
  private static vpW: number = 390;
  private static vpH: number = 844;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'HOST_PAGE_APPEAR');
    try {
      const ctx = getContext(this);
      this.filesDir = ctx.filesDir;
      // ① 运行期 bundle（项目路由/交互/响应式）——缺则回退静态屏内容
      try {
        const bb: Uint8Array = ctx.resourceManager.getRawFileContentSync('bundle-superapp.js');
        this.bundle = util.TextDecoder.create('utf-8').decodeToString(bb);
      } catch (e) {
        this.bundle = '';
        hilog.info(DOMAIN, TAG, 'HOST_PAGE_NO_BUNDLE 缺运行期 bundle —— 回退静态屏内容');
      }
      // ② 静态屏内容（回退 + 起始页推断）
      try {
        const sb: Uint8Array = ctx.resourceManager.getRawFileContentSync('app-screen-content.json');
        const scStr: string = util.TextDecoder.create('utf-8').decodeToString(sb);
        const pages = JSON.parse(scStr) as Record<string, Record<string, Object>>;
        const names: string[] = Object.keys(pages);
        for (const nm of names) {
          this.nodesByPage.set(nm, JSON.stringify(pages[nm]['nodes']));
        }
        this.current = this.nodesByPage.has('index') ? 'index' : (names.length > 0 ? names[0] : '');
      } catch (e) { /* 无静态产物（纯运行期）——起始页用约定名 */ }
      if (!this.current) this.current = 'index';
      this.renderCurrent();
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_BOOT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 运行期渲染入参 → JSON（用接口声明，避 ArkTS 未型字面量） */
  private rtArgsJson(page: string, chain?: number[]): string {
    const vp: RtViewport = { width: MainPage.vpW, height: MainPage.vpH };
    const a: RtArgs = { bundle: this.bundle, filesDir: this.filesDir, page: page, viewport: vp };
    if (chain && chain.length > 0) { a.chain = chain; }
    if (this.runtimeState !== null && Object.keys(this.runtimeState).length > 0) { a.state = this.runtimeState; }
    return JSON.stringify(a);
  }

  /** 从 hostAppRender 返回里保存 snapshot（供下次回灌）——一次性 VM 的状态持有侧 */
  private saveSnapshot(rt: Record<string, Object>): void {
    const snap = rt['snapshot'];
    if (snap !== undefined && snap !== null) {
      try { this.runtimeState = snap as Record<string, Object>; } catch (e) { /* 保持旧态（不静默） */ }
    }
  }

  /** 把**当前页**真画到屏上（运行期实例化 → appScreenCommands → renderCommands） */
  private renderCurrent(): void {
    const page: string = this.current;
    let nodes: string = this.nodesByPage.get(page) ?? '[]';
    const disp = display.getDefaultDisplaySync();
    // ★vp 精确除法（vp2px(1) = density；避免 px2vp 截断成整数 vp 导致右缘差 1px）
    const vpDensity: number = vp2px(1);
    const vpW: number = disp.width / vpDensity;
    const vpH: number = disp.height / vpDensity;
    MainPage.vpW = vpW;
    MainPage.vpH = vpH;
    try {
      attach(this.content, vpDensity, vpW, vpH);
      // ★运行期优先：eval bundle → boot → 实例化该屏（host.mount 捕获 tree）；失败则用静态 nodes
      if (this.bundle.length > 0) {
        try {
          const rtOut: string = hostAppRender(this.rtArgsJson(page));
          const rt = JSON.parse(rtOut) as Record<string, Object>;
          const tree = rt['tree'] as Record<string, Object> | undefined;
          if (tree && Array.isArray(tree['nodes'])) {
            nodes = JSON.stringify(tree['nodes']);
            hilog.info(DOMAIN, TAG, 'HOST_PAGE_RUNTIME page=%{public}s nodes=%{public}d', page, (tree['nodes'] as Object[]).length);
          }
          this.saveSnapshot(rt);
          // 屏名以**实际渲染的 current** 为准（boot 后路由 current 恒为 index，会盖掉真实当前屏）
          const cur = rt['current'] as string;
          if (cur !== undefined && cur.length > 0) { this.current = cur; }
        } catch (re) {
          hilog.error(DOMAIN, TAG, 'HOST_PAGE_RUNTIME_ERROR %{public}s', JSON.stringify(re) ?? '');
        }
      }
      this.paintTree(this.current, nodes);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_RENDER_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 把某屏 nodes 画到屏上（appScreenCommands → renderCommands）+ 重算/重放滚动范围 */
  private paintTree(page: string, nodes: string): void {
    try {
      // renderCommands 是**追加**语义 ⇒ 每次上屏前先 clearRoot（清子节点 + fixed/sticky/id 登记），防叠树
      clearRoot();
      const cmds: string = appScreenCommands(JSON.stringify({
        'nodes': nodes, 'density': vp2px(1), 'vpW': MainPage.vpW, 'vpH': MainPage.vpH,
        'page': page, 'filesDir': this.filesDir,
      } as Record<string, Object>));
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, TAG, 'HOST_PAGE_RENDER page=%{public}s nodes_rendered=%{public}d', page, n);
      const chVp: number = appScreenContentHeight();
      this.maxScroll = Math.max(0, chVp - MainPage.vpH);
      if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
      if (this.scrollOffset < 0) this.scrollOffset = 0;
      scrollRoot(this.scrollOffset);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_PAINT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 点击命中 → 运行期派发（$nav 导航 / 数据变更）→ 重绘（与 Android/iOS 同一条命中链） */
  private onTapAt(vpX: number, vpY: number): void {
    if (this.bundle.length === 0) return;
    try {
      const contentY: number = vpY + this.scrollOffset;
      const hitJson: string = appScreenHitAt(vpX, contentY);
      const hit = JSON.parse(hitJson) as Record<string, Object>;
      const chain = hit['chain'] as number[] | undefined;
      if (!chain || chain.length === 0) return;
      const prev: string = this.current;
      const rtOut: string = hostAppRender(this.rtArgsJson(this.current, chain));
      const rt = JSON.parse(rtOut) as Record<string, Object>;
      this.saveSnapshot(rt);
      const target = rt['current'] as string;
      if (target !== undefined && target.length > 0) {
        if (target !== prev && prev.length > 0) { this.navStack.push(prev); }
        this.current = target;
      }
      let nodes: string = this.nodesByPage.get(this.current) ?? '[]';
      const tree = rt['tree'] as Record<string, Object> | undefined;
      if (tree && Array.isArray(tree['nodes'])) { nodes = JSON.stringify(tree['nodes']); }
      this.paintTree(this.current, nodes);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_TAP_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 触摸：拖动滚动 / 点按命中（与 App 三端同语义）——★方法名不用 `onTouch`（与 ArkUI
   *  `CustomComponent.onTouch` 属性方法**签名冲突** ⇒ ArkTS 编译报 "not assignable to base type"） */
  private handleTouch(e: TouchEvent): void {
    const t: TouchObject = e.touches[0];
    if (t === undefined) return;
    if (e.type === TouchType.Down) {
      this.touchLastY = t.windowY; this.touchStartX = t.windowX; this.touchStartY = t.windowY; this.touchMoved = false;
      return;
    }
    if (e.type === TouchType.Move) {
      if (this.touchLastY < 0) { this.touchLastY = t.windowY; this.touchStartX = t.windowX; this.touchStartY = t.windowY; return; }
      const dy: number = t.windowY - this.touchLastY;
      this.touchLastY = t.windowY;
      if (Math.abs(dy) > 2) this.touchMoved = true;
      let next: number = this.scrollOffset - dy;
      if (next < 0) next = 0;
      if (next > this.maxScroll) next = this.maxScroll;
      if (next !== this.scrollOffset) { this.scrollOffset = next; scrollRoot(this.scrollOffset); }
      return;
    }
    if (e.type === TouchType.Up) {
      const dx: number = Math.abs(t.windowX - this.touchStartX);
      const dy2: number = Math.abs(t.windowY - this.touchStartY);
      if (!this.touchMoved && dx < 12 && dy2 < 12) { this.onTapAt(t.windowX, t.windowY); }
      this.touchLastY = -1;
      return;
    }
    if (e.type === TouchType.Cancel) this.touchLastY = -1;
  }

  /** 系统返回（含手势）：栈非空则返回上一屏，否则交系统 */
  onBackPress(): boolean {
    if (this.navStack.length === 0) { return false; }
    this.current = this.navStack.pop() as string;
    this.scrollOffset = 0;
    this.renderCurrent();
    return true;
  }

  build() {
    Column() {
      Stack() {
        ContentSlot(this.content)
      }
      .width('100%')
      .layoutWeight(1)
      .clip(true)
      .onTouch((e: TouchEvent) => { this.handleTouch(e); })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#101020')
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
