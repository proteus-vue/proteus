// {{appName}} —— 运行期宿主页面（Proteus 生成）
//
// 【它做什么】把 **Proteus 编译产物**经 runtime **运行期**上屏（与 Android/iOS 壳同级）：
//   ① rawfile `bundle-superapp.js`（项目路由 + 交互 + 响应式 + 导航）→ `hostAppRender`
//      （**一次性 VM**：eval bundle → boot 路由栈 → 共享运行期实例化当前屏 → host.mount 捕获 tree）；
//   ② 捕获到的 tree → `appScreenCommands`（内容 → 内核树 → RenderCmd）→ `renderCommands`（直绘）；
//   ③ 手势（**原生识别器**，非手搓 .onTouch）：`PanGesture` 拖动滚动 + `TapGesture` 点击命中→导航；
//      松手惯性 `startMomentum` 由 **`displaySync`（vsync 帧源）** 逐帧驱动；系统返回/边缘滑返 → `onBackPress`。
//   ★链路全部来自 runtime（HAR 'proteus_render'）——本页**不含项目身份**（页名/内容都从产物读）；
//     换一个项目只需替换 rawfile 产物。缺 bundle 时**回退静态 `app-screen-content.json`**（诚实降级）。
//
// 【★★★为什么惯性用 displaySync（vsync）而非 setInterval（决策 #726/731 · 用户「快滚卡一下再瞬间过去」）】
//   对照 **Android/iOS 的 dev 宿主**（非"参考宿主"——它是验证装置，本身有坑）：
//   · iOS：拖拽走原生 `UIPanGestureRecognizer`（给 velocity），惯性走 **`CADisplayLink`**（vsync 帧源）；
//   · Android：原生触摸 + `Choreographer`（vsync）。
//   ⇒ 鸿蒙的正确等价物 = 拖拽用 `.onTouch`（与参考宿主同，已证 Smooth），**惯性用 `displaySync`（vsync 帧回调）**。
//   ★此前照搬"参考宿主"的 `setInterval(16)`：**不对齐 vsync**，主线程一忙就把回调**攒成一批**触发
//     ⇒ 惯性"卡一下再瞬间过去"（非丝滑）。displaySync 与 vsync 对齐（CADisplayLink 同族）。
//   ★为什么不用原生 `PanGesture`（试过，撤回）：它 `distance` 阈值使其对**纯点击不触发**，须再叠 `TapGesture`；
//     而两手势在 `GestureMode.Parallel` 下**同时识别** ⇒ 拖拽也会触发 tap（真机实测：拖动被当点击导航）。
//     ⇒ 拖拽 + 点按的判别沿用 `.onTouch` 的 `touchMoved`（与 Android/iOS dev 宿主同——它们也在各自触摸回调里判别）。
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NodeContent, display, window, FrameCallback } from '@kit.ArkUI';
import { displaySync } from '@kit.ArkGraphics2D';
import { util } from '@kit.ArkTS';
import {
  attach, renderCommands, scrollRoot, clearRoot,
  appScreenCommands, appScreenContentHeight, appScreenHitAt, hostAppRender,
} from 'proteus_render';
// ★★★dev 通道（决策 #728）：变体常量 + dev-watch/角标（**dev 调试件**，release 门控不创建——守宿主定位 #727）。
import { DEV, DEV_URL } from './ProteusBuildConfig';
import { DevWatch } from '../dev/DevWatch';
import { DevOverlay } from '../dev/DevOverlay';

const DOMAIN = 0x0002;
const TAG = 'ProteusHostPage';
/** 惯性减速速率（= iOS UIScrollView normal 0.998/ms / CADisplayLink 同式；平台标准值，不自造曲线）。 */
const DECEL_RATE = 0.998;
/** 停止阈值（vp/ms）——低于它认为"停了"。 */
const MOMENTUM_STOP = 0.02;

/** 运行期渲染入参（ArkTS 禁未型字面量 ⇒ 用接口声明） */
interface RtViewport { width: number; height: number }
interface RtArgs { bundle: string; filesDir: string; page: string; viewport: RtViewport; chain?: number[]; state?: Record<string, Object> }

/**
 * ★空帧回调——**仅用于"请求一帧"**（`postFrameCallback` 会驱动 ArkUI 产出下一帧）。
 *   【为什么需要（决策 #726 · 用户实测「二级页返回后视图不更新、点一下才更新」）】RenderNode 子树在 C++
 *   侧重建后，**触摸事件会自带一帧**（点击/拖动 ⇒ 画面刷新）；而**返回键/边缘滑返**这类**非触摸**重建后
 *   **没有帧被请求** ⇒ 画面停在旧树。注册一个帧回调即请求一帧 ⇒ 新树被合成。
 *   （不能传闭包——ArkTS 要求 `FrameCallback` **实例**，见本仓记忆：闭包在编译期报错。）
 */
class NudgeFrameCallback extends FrameCallback {
  onFrame(_frameTimeInNano: number): void { /* 空：只为请求一帧 */ }
  onIdle(): void { /* 空 */ }
}

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
  /** 触摸：上一 Y（windowY）/ 起点 / 是否移动（tap-vs-drag 判别）+ 速度采样（vp/ms）。 */
  private touchLastY: number = -1;
  private touchStartX: number = -1;
  private touchStartY: number = -1;
  private touchMoved: boolean = false;
  private touchLastTs: number = 0;
  private touchVelSum: number = 0;
  private touchVelDt: number = 0;
  private velOffset: number = 0;
  /** ★边缘滑返（左缘）：跟踪标志 + 起点（与 iOS dev 宿主的 `UIScreenEdgePanGestureRecognizer` 同语义——
   *  系统边缘手势在本机不路由到 `onBackPress`，故显式判别；只认**左缘 + 明确右滑**，最小化与系统手势冲突）。 */
  private edgeTracking: boolean = false;
  private edgeStartX: number = 0;
  private edgeStartY: number = 0;
  /** ArkTS 侧导航历史栈（一次性 VM：JS 路由态不跨调用保留 ⇒ 返回栈由宿主记）+ 每屏滚动进度 */
  private navStack: string[] = [];
  private scrollByScreen: Map<string, number> = new Map<string, number>();
  /** 上次 hostAppRender 返回的 snapshot（`{屏名:{变量:值}}`）——下次新 VM 回灌 state */
  private runtimeState: Record<string, Object> | null = null;
  /** ★内置环境变量表（决策 #593）：安全区避免区（vp）——`appScreenCommands` 的 env token 替换用。 */
  private envVars: Record<string, number> = {};
  /** ★vsync 帧源（`displaySync`，CADisplayLink/Choreographer 同族）——惯性逐帧驱动；不对齐 vsync 会攒批跳变。 */
  private dSync: displaySync.DisplaySync | null = null;
  /** 当前**内容速度**（vp/ms）——每帧按 `DECEL_RATE` 指数衰减。 */
  private momV: number = 0;
  /** 上一帧时间戳（ns；0 = 首帧只记基准）。 */
  private momLastTs: number = 0;
  /** 惯性帧数 / 真推动帧数（"惯性真的接线了"的机器证据——本仓纪律：有通路无靠计数现形）。 */
  private momentumFrames: number = 0;
  private momentumMovedFrames: number = 0;
  /** 请求帧用的空回调实例（见 `NudgeFrameCallback`）。 */
  private nudgeCb: NudgeFrameCallback = new NudgeFrameCallback();
  /** ★dev 通道（决策 #728）：dev-watch + 角标（**release 不创建**）。 */
  private devWatch: DevWatch | null = null;
  private devOverlay: DevOverlay | null = null;
  /** dev 上报缓冲（宿主读线程/主线程写→dev-watch 排空）：原生日志（`level\ttext`）与事件 trace（已编码 query）。 */
  private devLogQueue: string[] = [];
  private devTraceQueue: string[] = [];
  /** 最近一次实例化树 JSON（dev-watch 取走上报 Elements）。 */
  private pendingTreeJson: string = '';
  /** 最近一次渲染耗时（ms；dev 心跳 perf 上报）。 */
  private lastRenderMs: number = 0;
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
      // ③ vsync 帧源（惯性用）——建一次，`.on` 只挂一次（重复 on 会重复回调）
      try {
        this.dSync = displaySync.create();
        this.dSync.setExpectedFrameRateRange({ expected: 60, min: 30, max: 120 });
        this.dSync.on('frame', (info: displaySync.IntervalInfo) => { this.tickMomentum(info); });
      } catch (e) {
        hilog.error(DOMAIN, TAG, 'HOST_PAGE_DISPLAYSYNC_ERR %{public}s', JSON.stringify(e) ?? '');
        this.dSync = null;
      }
      // ④ 窗口设置（edge-to-edge + 系统栏）——异步；取到安全区后**再渲染一次**（env 生效）
      window.getLastWindow(ctx).then((win: window.Window) => {
        // ★edge-to-edge：内容铺满全屏（含状态栏/导航栏区），状态栏**叠加**在内容之上（透明）
        //   ⇒ 页面背景透上来，与 Web viewport-fit=cover 同观感。此前非 full-screen ⇒ 状态栏占位成**黑带**。
        win.setWindowLayoutFullScreen(true).catch((e: Error) => {
          hilog.warn(DOMAIN, TAG, 'HOST_PAGE_FULLSCREEN_ERR %{public}s', String(e?.message ?? e));
        });
        // ★窗口背景 = 页面浅底：状态栏透明处透出窗口背景；若为系统默认（深/浅蓝）⇒ 屏顶露非页面色的带。
        try { win.setWindowBackgroundColor('#F4F5F7'); } catch (e) { /* 旧版本不支持 ⇒ 保持默认 */ }
        // ★显示状态栏 + 导航栏（内容在其下铺满）——与 Web 手机端 viewport-fit=cover 对齐。
        win.setWindowSystemBarEnable(['status', 'navigation']).catch((e: Error) => {
          hilog.error(DOMAIN, TAG, 'HOST_PAGE_STATUSBAR_ERR %{public}s', String(e?.message ?? e));
        });
        // ★采集安全区避免区（px ⇒ vp）——`env` 传给 appScreenCommands，页面据此自让位。
        let sysTop = 0, sysB = 0, indicB = 0, cutT = 0, cutL = 0, cutR = 0;
        try {
          const avoid: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
          sysTop = px2vp(avoid.topRect.height); sysB = px2vp(avoid.bottomRect.height);
        } catch (e) { /* 旧版本 ⇒ 0 */ }
        try {
          const ind: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
          indicB = px2vp(ind.bottomRect.height);
        } catch (e) { /* 旧版本无该 type ⇒ 0 */ }
        try {
          const co: window.AvoidArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT);
          cutT = px2vp(co.topRect.height); cutL = px2vp(co.leftRect.width); cutR = px2vp(co.rightRect.width);
        } catch (e) { /* 未声明 metadata ⇒ 0 */ }
        const totalB = sysB + indicB;
        const gesture = indicB > 0 && sysB === 0;
        const disp = display.getDefaultDisplaySync();
        this.envVars = {
          '--pf-inset-top': Math.max(sysTop, cutT),
          '--pf-inset-bottom': totalB,
          '--pf-inset-left': cutL,
          '--pf-inset-right': cutR,
          '--pf-status-bar-height': sysTop,
          '--pf-nav-bar-height': gesture ? 0 : sysB,
          '--pf-indicator-height': gesture ? indicB : 0,
          '--pf-nav-bar-total': totalB,
          '--pf-cutout-top': cutT,
          '--pf-cutout-left': cutL,
          '--pf-cutout-right': cutR,
          '--pf-keyboard-height': 0,
          '--pf-vw': disp.width / vp2px(1),
          '--pf-vh': disp.height / vp2px(1),
          '--pf-hairline': 1 / vp2px(1),
        };
        this.renderCurrent();
      }).catch((err: Error) => {
        hilog.error(DOMAIN, TAG, 'HOST_PAGE_WINDOW_ERR %{public}s', String(err?.message ?? err));
        this.renderCurrent();
      });
      // 立即渲染一次（窗口 promise 未回前先出内容；env 到位后会再渲染一次覆盖）
      this.renderCurrent();
      // ⑤ dev 通道（决策 #728）：`DEV` 编译期常量 或 启动参数注入的 dev server 地址 ⇒ 起 dev-watch + 角标。
      //   ★dev 调试件**门控创建**（release 零残留）——宿主功能不受影响（守 #727）。
      const devBase: string = MainPage.resolveDevBase();
      if (DEV || devBase.length > 0) {
        this.devOverlay = new DevOverlay();
        this.devOverlay.setPanelUrl(devBase);
        this.startDevWatch(devBase);
        this.devLog('info', 'app ready · screen=' + this.current + ' · dev=' + (devBase.length > 0 ? devBase : '(无地址)'));
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_BOOT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** dev server 基址：**启动参数优先**（`--ps proteusDev <url>` → AppStorage），其次**编译期** `DEV_URL`（与 Android/iOS 同契约）。 */
  private static resolveDevBase(): string {
    const fromArg: string = AppStorage.get<string>('proteusDev') ?? '';
    if (fromArg.length > 0) { return fromArg.replace(/\/+$/, ''); }
    return DEV_URL.replace(/\/+$/, '');
  }

  /** 起 dev-watch：注入读数/动作函数（ArkTS 结构类型不认对象字面量 ⇒ 逐字段赋）。 */
  private startDevWatch(base: string): void {
    if (base.length === 0) { return; }
    const w = new DevWatch(base);
    w.currentScreen = (): string => this.current;
    w.envJson = (): string => JSON.stringify(this.envVars);
    w.perfJson = (): string => JSON.stringify({ 'renderMs': this.lastRenderMs } as Record<string, number>);
    w.takeTreeJson = (): string => { const t: string = this.pendingTreeJson; this.pendingTreeJson = ''; return t; };
    w.takeLogs = (): string[] => { const q: string[] = this.devLogQueue; this.devLogQueue = []; return q; };
    w.takeTraces = (): string[] => { const q: string[] = this.devTraceQueue; this.devTraceQueue = []; return q; };
    w.applyBundle = (b: string, v: string): void => {
      this.bundle = b;
      this.renderCurrent();
      if (this.devOverlay !== null) { this.devOverlay.flash('⟳ 已热重载 · v' + v); }
      this.devLog('info', 'hot reload · v' + v + ' · screen=' + this.current);
    };
    this.devWatch = w;
    w.start();
  }

  /** 宿主原生日志入队（dev-watch 排空上报面板 Console）。 */
  private devLog(level: string, text: string): void {
    if (this.devLogQueue.length > 200) { this.devLogQueue.shift(); }
    this.devLogQueue.push(level + '\t' + text);
  }

  aboutToDisappear(): void {
    this.stopMomentum();
    if (this.dSync !== null) { try { this.dSync.stop(); } catch (e) { /* 无 */ } }
    if (this.devWatch !== null) { this.devWatch.stop(); }
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
    const t0: number = Date.now();
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
            // ★dev：缓存**整棵实例化树**（含 viewport，供面板 Elements）——dev-watch 取走上报 /tree
            if (this.devWatch !== null) { this.pendingTreeJson = JSON.stringify(tree); }
            hilog.info(DOMAIN, TAG, 'HOST_PAGE_RUNTIME page=%{public}s nodes=%{public}d', page, (tree['nodes'] as Object[]).length);
          }
          this.saveSnapshot(rt);
          // 屏名以**实际渲染的 current** 为准（boot 后路由 current 恒为 index，会盖掉真实当前屏）
          const cur = rt['current'] as string;
          if (cur !== undefined && cur.length > 0) { this.current = cur; }
        } catch (re) {
          hilog.error(DOMAIN, TAG, 'HOST_PAGE_RUNTIME_ERROR %{public}s', JSON.stringify(re) ?? '');
          this.devLog('error', 'runtime error: ' + (JSON.stringify(re) ?? ''));
        }
      }
      this.paintTree(this.current, nodes);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_RENDER_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
    this.lastRenderMs = Date.now() - t0;
  }

  /** 把某屏 nodes 画到屏上（appScreenCommands → renderCommands）+ 重算/重放滚动范围 */
  private paintTree(page: string, nodes: string): void {
    try {
      // renderCommands 是**追加**语义 ⇒ 每次上屏前先 clearRoot（清子节点 + fixed/sticky/id 登记），防叠树
      clearRoot();
      const cmds: string = appScreenCommands(JSON.stringify({
        'nodes': nodes, 'density': vp2px(1), 'vpW': MainPage.vpW, 'vpH': MainPage.vpH,
        'page': page, 'filesDir': this.filesDir,
        'env': this.envVars,   // ★安全区 env token（--pf-inset-*）替换用
      } as Record<string, Object>));
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, TAG, 'HOST_PAGE_RENDER page=%{public}s nodes_rendered=%{public}d', page, n);
      const chVp: number = appScreenContentHeight();
      this.maxScroll = Math.max(0, chVp - MainPage.vpH);
      if (this.scrollOffset > this.maxScroll) this.scrollOffset = this.maxScroll;
      if (this.scrollOffset < 0) this.scrollOffset = 0;
      scrollRoot(this.scrollOffset);
      // ★★★请求一帧（决策 #726）：非触摸驱动的重建（返回键/边缘滑返）默认**没有帧**⇒ 画面停在旧树
      //   （用户「点一下屏幕才更新」的真因）。postFrameCallback 请求下一帧 ⇒ 新树被合成。
      //   （C++ 侧已 `OH_ArkUI_RenderNodeUtils_Invalidate` 标脏；此处补"产帧"。）
      try { this.getUIContext().postFrameCallback(this.nudgeCb); } catch (e) { /* 无 UIContext（旧版本）⇒ 跳过 */ }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_PAINT_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 返回上一屏（系统边缘滑返 / 返回键 → onBackPress）。栈非空 ⇒ 出栈 + 恢复该屏滚动；空 ⇒ 交系统（退出）。 */
  private goBack(): boolean {
    if (this.navStack.length === 0) { return false; }
    this.stopMomentum();
    const prev: string = this.navStack.pop() as string;
    this.scrollByScreen.set(this.current, this.scrollOffset);
    this.current = prev;
    this.scrollOffset = this.scrollByScreen.get(prev) ?? 0;
    hilog.info(DOMAIN, TAG, 'HOST_PAGE_BACK current=%{public}s depth=%{public}d', this.current, this.navStack.length + 1);
    this.renderCurrent();
    return true;
  }

  /** ★系统返回（含手势滑动返回）——@Entry Page 生命周期；栈非空则消费，否则交系统。 */
  onBackPress(): boolean {
    return this.goBack();
  }

  /**
   * 触摸：拖动滚动 + 松手惯性 + 点按命中（与 Android/iOS dev 宿主同语义——在触摸回调里判别 tap/drag）。
   *   · Down：停惯性 + 记起点；Move：按位移滚动 + 采样速度（vp/ms，≥24ms 一采）；Up：几乎没动 ⇒ tap；
   *     移动过 ⇒ 用**松手速度**启动惯性（`displaySync` vsync 逐帧）。
   *   · ★方法名不用 `onTouch`（与 ArkUI `CustomComponent.onTouch` 属性方法**签名冲突**）。
   *   · ★不加自定义边缘滑返——鸿蒙系统边缘手势（返回）自动走 @Entry 的 `onBackPress`（叠自绘会与系统手势冲突）。
   */
  private handleTouch(e: TouchEvent): void {
    const t: TouchObject = e.touches[0];
    if (t === undefined) return;
    if (e.type === TouchType.Down) {
      this.stopMomentum();
      this.touchLastY = t.windowY; this.touchStartX = t.windowX; this.touchStartY = t.windowY; this.touchMoved = false;
      this.touchLastTs = Date.now(); this.touchVelSum = 0; this.touchVelDt = 0; this.velOffset = 0;
      // ★左缘起手 ⇒ 进入"边缘滑返"跟踪（见 Up 分支：明确右滑才触发返回；否则照常滚动）
      this.edgeTracking = this.touchStartX <= 20;
      this.edgeStartX = this.touchStartX; this.edgeStartY = this.touchStartY;
      return;
    }
    if (e.type === TouchType.Move) {
      if (this.touchLastY < 0) { this.touchLastY = t.windowY; this.touchLastTs = Date.now(); return; }
      const dy: number = t.windowY - this.touchLastY;
      this.touchLastY = t.windowY;
      const now: number = Date.now();
      const dt: number = now - this.touchLastTs;
      this.touchLastTs = now;
      if (Math.abs(t.windowY - this.touchStartY) > 16 || Math.abs(t.windowX - this.touchStartX) > 16) this.touchMoved = true;
      // ★边缘跟踪期间**不滚动**（横向位移为主、纵向分量近 0；与 iOS 边缘 pan 并发的语义一致）
      if (this.edgeTracking && Math.abs(t.windowX - this.edgeStartX) > Math.abs(t.windowY - this.edgeStartY)) {
        return;
      }
      this.edgeTracking = false;   // 起手在边缘但纵向拖动 ⇒ 转为普通滚动
      const step: number = this.applyScrollBy(-dy);   // 手指上滑（windowY 减小）⇒ offset 增大
      // 速度采样：本步**实际内容位移**（钳制后）累计，≥24ms 算一次瞬时速度
      if (dt > 0) { this.touchVelSum += step; this.touchVelDt += dt; }
      if (this.touchVelDt >= 24) { this.velOffset = this.touchVelSum / this.touchVelDt; this.touchVelSum = 0; this.touchVelDt = 0; }
      return;
    }
    if (e.type === TouchType.Up) {
      const dx: number = t.windowX - this.edgeStartX;
      const dyAbs: number = Math.abs(t.windowY - this.edgeStartY);
      if (this.edgeTracking && dx > 60 && dyAbs < 60) {
        // ★左缘明确右滑 ⇒ 滑返（对齐 iOS dev 宿主 `UIScreenEdgePanGestureRecognizer` dx>60 ⇒ 返回）
        hilog.info(DOMAIN, TAG, 'HOST_PAGE_EDGE_BACK dx=%{public}d', Math.round(dx));
        this.goBack();
      } else if (!this.touchMoved && this.touchStartX >= 0) {
        this.onTapAt(this.touchStartX, this.touchStartY);   // 几乎没动 ⇒ tap（★含左缘静点：不漏）
      } else if (this.touchMoved) {
        this.startMomentum(this.velOffset);   // ★松手惯性（显示由 displaySync vsync 驱动）
      }
      this.touchLastY = -1; this.touchMoved = false; this.edgeTracking = false;
      return;
    }
    if (e.type === TouchType.Cancel) { this.stopMomentum(); this.touchLastY = -1; this.touchMoved = false; this.edgeTracking = false; }
  }

  /** 点击命中 → 运行期派发（$nav 导航 / 数据变更）→ 重绘（与 Android/iOS 同一条命中链） */
  private onTapAt(vpX: number, vpY: number): void {
    if (this.bundle.length === 0) return;
    this.stopMomentum();
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
        if (target !== prev && prev.length > 0) {
          this.scrollByScreen.set(prev, this.scrollOffset);
          this.navStack.push(prev);
          this.scrollOffset = 0;
        }
        this.current = target;
      }
      let nodes: string = this.nodesByPage.get(this.current) ?? '[]';
      const tree = rt['tree'] as Record<string, Object> | undefined;
      if (tree && Array.isArray(tree['nodes'])) {
        nodes = JSON.stringify(tree['nodes']);
        if (this.devWatch !== null) { this.pendingTreeJson = JSON.stringify(tree); }
      }
      this.paintTree(this.current, nodes);
      // ★dev 事件 trace（决策 #728 → 面板 Events）：命中 → 导航。`handled`/`fired` 由运行期返回（本批最简：handled=导航是否发生）。
      if (this.devWatch !== null) {
        const handled: boolean = target !== undefined && target.length > 0 && target !== prev;
        this.pushTrace('tap', chain, handled, []);
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'HOST_PAGE_TAP_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** dev 事件 trace 入队（dev-watch 排空 → `/trace?<encoded>`）。字段与 dev server `/trace` 契约一致。 */
  private pushTrace(type: string, chain: number[], handled: boolean, fired: number[]): void {
    const q: string = 'type=' + encodeURIComponent(type)
      + '&id=' + (chain.length > 0 ? chain[chain.length - 1] : 0)
      + '&chain=' + encodeURIComponent(chain.join(','))
      + '&handled=' + (handled ? '1' : '0')
      + '&fired=' + encodeURIComponent(fired.join(','));
    if (this.devTraceQueue.length > 80) { this.devTraceQueue.shift(); }
    this.devTraceQueue.push(q);
  }

  /** 按内容位移（vp；正 = offset 增大）滚动一步，钳到 [0,maxScroll]。返回**实际位移**（钳制后）。 */
  private applyScrollBy(delta: number): number {
    let next: number = this.scrollOffset + delta;
    if (next < 0) next = 0;
    if (next > this.maxScroll) next = this.maxScroll;
    if (next !== this.scrollOffset) {
      const actual: number = next - this.scrollOffset;
      this.scrollOffset = next;
      scrollRoot(this.scrollOffset);
      return actual;
    }
    return 0;
  }

  /** ★启动惯性（松手时调用）。速度单位 = vp/ms；`|v|` 过小 ⇒ 不启动。由 `displaySync`（vsync）逐帧步进。 */
  private startMomentum(v: number): void {
    this.stopMomentum();
    if (Math.abs(v) <= MOMENTUM_STOP) return;
    this.momV = v;
    this.momLastTs = 0;
    this.momentumFrames = 0; this.momentumMovedFrames = 0;
    if (this.dSync === null) return;
    this.dSync.start();
  }

  /** ★vsync 帧回调（`displaySync`）：指数减速 `v *= DECEL_RATE^dt`（与 iOS `CADisplayLink` 同式）。 */
  private tickMomentum(info: displaySync.IntervalInfo): void {
    const ts: number = info.timestamp;   // ns
    if (this.momLastTs <= 0) { this.momLastTs = ts; return; }
    const dtMs: number = (ts - this.momLastTs) / 1e6;
    this.momLastTs = ts;
    if (dtMs <= 0 || dtMs > 100) return;   // 异常间隔（>100ms）跳过，避免跳变
    this.momentumFrames++;
    this.momV *= Math.pow(DECEL_RATE, dtMs);
    if (Math.abs(this.momV) < MOMENTUM_STOP) {
      hilog.info(DOMAIN, TAG, 'HOST_PAGE_MOMENTUM_END frames=%{public}d moved=%{public}d', this.momentumFrames, this.momentumMovedFrames);
      this.stopMomentum(); return;
    }
    const s: number = this.applyScrollBy(this.momV * dtMs);
    if (s !== 0) this.momentumMovedFrames++;
    if (s === 0 && (this.scrollOffset <= 0 || this.scrollOffset >= this.maxScroll)) {
      hilog.info(DOMAIN, TAG, 'HOST_PAGE_MOMENTUM_END frames=%{public}d moved=%{public}d (bound)', this.momentumFrames, this.momentumMovedFrames);
      this.stopMomentum();
    }
  }

  /** 停止惯性（新触摸/点按/销毁时）。 */
  private stopMomentum(): void {
    if (this.dSync !== null) { try { this.dSync.stop(); } catch (e) { /* 无 */ } }
  }

  build() {
    Column() {
      Stack() {
        ContentSlot(this.content)
      }
      .width('100%')
      .layoutWeight(1)
      .clip(true)
      // ★触摸：拖拽滚动 + 点按命中 + 松手惯性（在 handleTouch 里判别 tap/drag；惯性由 displaySync vsync 驱动）。
      //   ★不用原生 PanGesture（与 TapGesture 竞争会误判，见文件头）；不叠横向手势（不抢系统边缘滑返）。
      .onTouch((e: TouchEvent) => { this.handleTouch(e); })
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#101020')
    // ★内容铺满**全屏**（含状态栏与手势区）——与 Web viewport（390×844 全屏）同口径；叠加
    //   `setWindowLayoutFullScreen(true)`（见 aboutToAppear）⇒ 状态栏透明、内容透上来。
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
