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
  appScreenCommands, appScreenContentHeight, appScreenHitAt, appScreenNodeRect, hostAppRender, hostAppEval,
} from 'proteus_render';
// ★★★dev 通道（决策 #728）：变体常量 + dev-watch/角标（**dev 调试件**，release 门控不创建——守宿主定位 #727）。
import { DEV, DEV_URL } from './ProteusBuildConfig';
import { DevWatch } from '../dev/DevWatch';

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
  /** dev 上报缓冲（宿主读线程/主线程写→dev-watch 排空）：原生日志（`level\ttext`）与事件 trace（已编码 query）。 */
  private devLogQueue: string[] = [];
  private devTraceQueue: string[] = [];
  /** 最近一次实例化树 JSON（dev-watch 取走上报 Elements）。 */
  private pendingTreeJson: string = '';
  /** 最近一次渲染耗时（ms；dev 心跳 perf 上报）。 */
  private lastRenderMs: number = 0;
  /** ★dev 命令态（决策 #729）：高亮节点 id（0=无）；就地编辑覆盖（节点 id → `{字段:值}`；渲染时每轮重施）。 */
  private highlightId: number = 0;
  private devEdits: Map<number, Record<string, Object>> = new Map<number, Record<string, Object>>();
  /** ★dev 逐帧采样（决策 #730 · 对齐 iOS CADisplayLink）：独立**常驻** displaySync 采真实帧间隔 →
   *  fps / frameMs / frameMaxMs / dropped（排空式，每心跳取一次）。与惯性用的 dSync **分开**（互不干扰）。 */
  private devFrameSync: displaySync.DisplaySync | null = null;
  private devFrameLastTs: number = 0;
  private devFrameCount: number = 0;
  private devFrameSumMs: number = 0;
  private devFrameMaxMs: number = 0;
  private devFrameDropped: number = 0;
  /** ★dev 渲染/重排计数（面板 perf 卡）：mountCalls=渲染次数（重排≈重建）。 */
  private devMountCalls: number = 0;
  /** ★dev 被点元素（决策 #730）：命中链末位 id（-1=无）→ `/inspect` 上报（面板高亮被点节点）。 */
  private pendingInspectId: number = -1;
  /** ★启动占位（决策 #731）：内容首帧前显示浅底+App名+转圈；首帧渲染后置 false 撤掉。 */
  @State loading: boolean = true;
  private firstPainted: boolean = false;
  /** ★dev 胶囊（决策 #731/#732）：DEV 角标可见性 + 面板 URL（菜单显示）+ 菜单/编辑态/toast。 */
  @State devCapsule: boolean = false;
  @State panelUrl: string = '';
  /** ★菜单展开（决策 #732）：底部 sheet（对齐 Android/iOS 的 `toggleSheet`，非居中 dialog）。 */
  @State sheetOn: boolean = false;
  /** ★编辑态（决策 #732）：有未还原的就地编辑 ⇒ 角标 `DEV ✎` + 琥珀 + sheet 状态行"非项目代码效果"。 */
  @State edited: boolean = false;
  /** ★顶部 toast（决策 #732）：自绘**顶部居中**提示（`promptAction.showToast` 默认底部，不对齐两端）。 */
  @State flashMsg: string = '';
  private flashTimer: number = -1;
  /** ★★chrome 顶部基准（决策 #732）：= 安全区顶 + 6vp。**用 @State**（`envVars` 是普通字段 ⇒ 赋值不重渲 ⇒
   *   胶囊会停在 build 时"env 尚空"的 0+6=6vp 处、贴到状态栏）。@State 赋值即重渲 ⇒ 位置随安全区正确落位。 */
  @State chromeTopVp: number = 54;
  /** 应用名（启动占位显示；`$r('app.string.app_name')`）。 */
  private appName: string = 'Proteus';
  private static vpW: number = 390;
  private static vpH: number = 844;

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'HOST_PAGE_APPEAR');
    try {
      const ctx = getContext(this);
      this.filesDir = ctx.filesDir;
      // 应用名（启动占位显示）——`$r('app.string.app_name')` 在 build 里用；此处存字符串备用（读不到则回落）
      try {
        const v: string = (ctx.resourceManager.getStringSync($r('app.string.app_name').id) as string);
        if (v.length > 0) { this.appName = v; }
      } catch (e) { /* 读不到 ⇒ 保持默认 */ }
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
        // ★chrome 顶部基准（决策 #732）：安全区顶 + 6vp ⇒ 胶囊/toast 落在状态栏下方（@State 触发重渲）
        this.chromeTopVp = Math.max(sysTop, cutT) + 6;
        this.renderCurrent();
      }).catch((err: Error) => {
        hilog.error(DOMAIN, TAG, 'HOST_PAGE_WINDOW_ERR %{public}s', String(err?.message ?? err));
        this.renderCurrent();
      });
      // ★★★去双重渲染（决策 #732 · 用户「启动就掉帧」）：此前此处**立即**渲染一次、env 回调**再**渲染一次
      //   ⇒ 每次启动 eval **两遍** 4MB bundle（dev 模式 dev-watch 首 tick 再一遍 = 三遍）⇒ 主线程长阻塞 =
      //   **启动掉帧**。⇒ 起手**不渲**，只等 `getLastWindow` 回调（带安全区 env）**渲一次**；
      //   `getLastWindow` 失败时由上面的 catch 兜底渲一次（覆盖"窗口取不到"）。
      //   顺序沿用"只渲一次"纪律（与 Android/iOS `bootAsync` → 主线程回调一次上屏同构）。
      // ⑤ dev 通道（决策 #728）：`DEV` 编译期常量 或 启动参数注入的 dev server 地址 ⇒ 起 dev-watch + 角标。
      //   ★dev 调试件**门控创建**（release 零残留）——宿主功能不受影响（守 #727）。
      const devBase: string = MainPage.resolveDevBase();
      if (DEV || devBase.length > 0) {
        this.panelUrl = devBase;
        this.devCapsule = true;   // ★dev 胶囊（决策 #731）：右上 "DEV" 角标（可点展开底部 sheet）
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
    // ★perf 读数（决策 #730）：renderMs + 逐帧（fps/frameMs/maxMs/dropped/frames，**排空式**每心跳取一次）
    //   + mountCalls（渲染次数）。relayout 用 mountCalls 表意、patches=0（鸿蒙无增量 patch 通道）。
    w.perfJson = (): string => {
      const f = this.drainFrameStats();
      const o: Record<string, number> = { 'renderMs': this.lastRenderMs, 'mountCalls': this.devMountCalls, 'patches': 0 };
      for (const k of Object.keys(f)) { o[k] = f[k]; }
      return JSON.stringify(o);
    };
    w.takeTreeJson = (): string => { const t: string = this.pendingTreeJson; this.pendingTreeJson = ''; return t; };
    w.takeLogs = (): string[] => { const q: string[] = this.devLogQueue; this.devLogQueue = []; return q; };
    w.takeTraces = (): string[] => { const q: string[] = this.devTraceQueue; this.devTraceQueue = []; return q; };
    w.takeInspect = (): number => { const id: number = this.pendingInspectId; this.pendingInspectId = -1; return id; };
    w.applyBundle = (b: string, v: string): void => {
      this.bundle = b;
      this.renderCurrent();
      this.flash('⟳ 已热重载 · v' + v);
      this.devLog('info', 'hot reload · v' + v + ' · screen=' + this.current);
    };
    // ★面板→设备命令（决策 #729）：dev-watch 取到 /cmd ⇒ 宿主执行（highlight/edit/reset/eval）
    w.onCmd = (json: string): void => { this.applyCommand(json); };
    this.startDevFrameSampler();
    this.devWatch = w;
    w.start();
  }

  /** ★dev 逐帧采样（决策 #730）：独立**常驻** displaySync 采真实帧间隔（与惯性 dSync 分开，互不干扰）。 */
  private startDevFrameSampler(): void {
    if (this.devFrameSync !== null) { return; }
    try {
      const s = displaySync.create();
      s.setExpectedFrameRateRange({ expected: 60, min: 30, max: 120 });
      s.on('frame', (info: displaySync.IntervalInfo) => { this.onDevFrame(info); });
      s.start();
      this.devFrameSync = s;
    } catch (e) { hilog.warn(DOMAIN, TAG, 'HOST_PAGE_DEVFRAME_ERR %{public}s', JSON.stringify(e) ?? ''); }
  }

  /** 帧回调：真实帧间隔（ms）；`> 1.5× 本帧预算` ⇒ 掉帧（主线程阻塞跳过 vsync）——口径同 iOS onDevFrame。 */
  private onDevFrame(info: displaySync.IntervalInfo): void {
    const ts: number = info.timestamp;   // ns
    if (this.devFrameLastTs <= 0) { this.devFrameLastTs = ts; return; }
    const dtMs: number = (ts - this.devFrameLastTs) / 1e6;
    this.devFrameLastTs = ts;
    const targetMs: number = (info.targetTimestamp - info.timestamp) / 1e6;   // 本帧预算（可变刷新率随屏）
    this.devFrameCount++;
    this.devFrameSumMs += dtMs;
    if (dtMs > this.devFrameMaxMs) { this.devFrameMaxMs = dtMs; }
    if (targetMs > 0 && dtMs > targetMs * 1.5) { this.devFrameDropped++; }
  }

  /** 排空逐帧统计（每心跳取一次 ⇒ 新鲜窗口；#723 教训：周期量每 tick drain，不烤进缓存）。 */
  private drainFrameStats(): Record<string, number> {
    const n: number = this.devFrameCount;
    const sum: number = this.devFrameSumMs;
    const o: Record<string, number> = {
      'frames': n,
      'frameMs': n > 0 ? Math.round((sum / n) * 100) / 100 : 0,
      'frameMaxMs': Math.round(this.devFrameMaxMs * 100) / 100,
      'fps': sum > 0 ? Math.round((n / (sum / 1000)) * 10) / 10 : 0,
      'dropped': this.devFrameDropped,
    };
    this.devFrameCount = 0; this.devFrameSumMs = 0; this.devFrameMaxMs = 0; this.devFrameDropped = 0;
    return o;
  }

  /** 宿主原生日志入队（dev-watch 排空上报面板 Console），格式 `channel\tlevel\ttext`。 */
  private devLog(level: string, text: string): void {
    this.enqueueLog('native', level, text);
  }

  /** ★项目 `console.*`（决策 #730）入队（channel=project ⇒ 面板 Console·项目通道）。 */
  private devProjectLog(level: string, text: string): void {
    this.enqueueLog('project', level, text);
  }

  private enqueueLog(channel: string, level: string, text: string): void {
    if (this.devLogQueue.length > 200) { this.devLogQueue.shift(); }
    this.devLogQueue.push(channel + '\t' + level + '\t' + text);
  }

  /** ★dev 项目 console（决策 #730）：`hostAppRender` 返回的 `rt.console`（`level\ttext\n` 逐行）⇒ 入队（channel=project）。 */
  private drainProjectConsole(rt: Record<string, Object>): void {
    if (this.devWatch === null) { return; }
    const cons = rt['console'] as string | undefined;
    if (cons === undefined || cons.length === 0) { return; }
    for (const line of cons.split('\n')) {
      if (line.length === 0) { continue; }
      const tab: number = line.indexOf('\t');
      this.devProjectLog(tab >= 0 ? line.slice(0, tab) : 'log', tab >= 0 ? line.slice(tab + 1) : line);
    }
  }

  /* ═══════════════ ★★★dev 命令集（决策 #729 · 面板→设备；`/cmd` 契约三端一致）═══════════════
   *   命令种类（对齐 dev server `/panelcmd` 与 AppActivity/ProteusApp 的 `applyCommand`）：
   *     · highlight(nodeId)：叠半透明高亮框（`appScreenNodeRect` 取内核 rect → 追加一条背景 cmd）；
   *     · edit(nodeId,key,value)：就地编辑——写入 `devEdits`（渲染时每轮重施到实例树）⇒ 任意字段生效；
   *     · reset：清 `devEdits`（恢复项目代码效果）+ 重渲；
   *     · eval(expr)：`hostAppEval`（一次性 VM 内求值）→ 结果入 Console。
   *   ★highlight 高亮框与命中**同源**（同一棵内核树）；★就地编辑走"改树+全量重挂"（每轮重施），
   *     不受增量 `PatchStyle` 字段子集所限（Android #722 的教训）。 */
  private applyCommand(json: string): void {
    try {
      const o = JSON.parse(json) as Record<string, Object>;
      const type: string = typeof o['type'] === 'string' ? o['type'] as string : '';
      if (type === 'highlight') {
        const id: number = typeof o['nodeId'] === 'number' ? o['nodeId'] as number : 0;
        this.highlightId = id;
        this.renderCurrent();   // 重渲以叠/撤高亮框
        this.devLog('info', 'highlight #' + id);
      } else if (type === 'edit') {
        const id: number = typeof o['nodeId'] === 'number' ? o['nodeId'] as number : 0;
        const key: string = typeof o['key'] === 'string' ? o['key'] as string : '';
        const value: string = typeof o['value'] === 'string' ? o['value'] as string : '';
        if (id > 0 && key.length > 0) {
          // 禁改结构字段（与 iOS/Android 一致：id/parentId/文本结构不动，只改样式）
          if (key === 'id' || key === 'parentId') { this.devLog('warn', 'edit #' + id + ' ' + key + '（结构字段不可改）'); return; }
          // ★★类型强转（决策 #731 · 黑屏根因）：字符串值按字段类型转成数字/对象/枚举——否则内核 serde 失败 ⇒ 空屏
          const coerced: Object | null = this.coerceLiveEdit(key, value);
          if (coerced === null) {
            this.flash('⚠ 就地编辑值非法 #' + id + ' · ' + key + '=' + value);
            this.devLog('warn', 'edit #' + id + ' ' + key + '=' + value + '（值非法，未应用）');
            return;
          }
          let ov: Record<string, Object> = this.devEdits.get(id) ?? {};
          ov[key] = coerced;
          this.devEdits.set(id, ov);
          this.edited = true;     // ★编辑态（决策 #732）：角标 `DEV ✎` + 琥珀 + sheet 状态行
          this.renderCurrent();   // 改树 + 全量重挂（每轮重施覆盖）
          this.flash('✎ 已就地编辑 #' + id + ' · ' + key + '=' + value);
          this.devLog('info', 'edit #' + id + ' ' + key + '=' + value);
        }
      } else if (type === 'reset') {
        this.devEdits.clear();
        this.edited = false;
        this.renderCurrent();
        this.devLog('info', 'reset · 恢复项目代码效果');
      } else if (type === 'eval') {
        const expr: string = typeof o['expr'] === 'string' ? o['expr'] as string : '';
        if (expr.length > 0) {
          const args: Record<string, Object> = { 'bundle': this.bundle, 'filesDir': this.filesDir, 'expr': expr };
          let disp: string = '';
          try {
            const r = JSON.parse(hostAppEval(JSON.stringify(args))) as Record<string, Object>;
            disp = r['ok'] === true ? String(r['value']) : ('✗ ' + String(r['error']));
          } catch (e) { disp = '✗ ' + (JSON.stringify(e) ?? ''); }
          this.devLog('log', '› ' + expr + '\n' + disp);
        }
      }
      // 命令执行后**重推树**（几何可能变）——与 Android #722 同（编辑/重置改变布局，面板树须同步）
      if (type === 'edit' || type === 'reset') { this.pendingTreeJson = ''; /* 下轮 renderCurrent 重填 */ }
    } catch (e) { /* 命令尽力而为——不干扰渲染 */ }
  }

  /** ★高亮框 cmd（决策 #731 · **对齐 Android/iOS**）：fill `systemBlue α0.18`(0x2E2F6BFF) + stroke `systemBlue`(0xFF2F6BFF, 2×density)。
   *   两层（先填充后描边，描边在内）；rect 由 `appScreenNodeRect` 给出、与 cmd 同口径（物理 px）。
   *   ★此 cmd 放在**最后**（覆盖在内容之上）——本仓纪律"高亮框与命中同源"。 */
  private highlightCmd(): string {
    if (this.highlightId <= 0) { return ''; }
    try {
      const r = JSON.parse(appScreenNodeRect(this.highlightId)) as Record<string, Object>;
      if (r['ok'] !== true) { return ''; }
      const x: number = r['x'] as number;
      const y: number = r['y'] as number;
      const w: number = r['w'] as number;
      const h: number = r['h'] as number;
      const d: number = vp2px(1);
      const bw: number = Math.max(1, Math.round(2 * d));   // 描边宽 = 2×density（物理 px，同 Android `setStrokeWidth(2*d)`）
      // ★用**十六进制字面量**（0x2E2F6BFF），不手写十进制——手算十进制极易错（本处一度算错 ⇒ 颜色不对）。
      const FILL: number = 0x2E2F6BFF;     // systemBlue #2F6BFF alpha 0.18（=46/255）
      const STROKE: number = 0xFF2F6BFF;   // systemBlue 不透明
      const fill: string = ',{"kind":"background","id":-990001,"parentId":-1,"x":' + x.toFixed(2) + ',"y":' + y.toFixed(2)
        + ',"w":' + w.toFixed(2) + ',"h":' + h.toFixed(2) + ',"color":' + FILL + ',"radius":0}';
      const half: number = bw / 2;
      const stroke: string = ',{"kind":"background","id":-990002,"parentId":-1,"x":' + (x - half).toFixed(2) + ',"y":' + (y - half).toFixed(2)
        + ',"w":' + (w + bw).toFixed(2) + ',"h":' + (h + bw).toFixed(2) + ',"color":0,"radius":0,'
        + '"borderWidth":' + bw + ',"borderColor":' + STROKE + '}';
      return fill + stroke;
    } catch (e) { return ''; }
  }

  /**
   * ★★就地编辑**值类型强转**（决策 #731 · 镜像 iOS/Android `coerceLiveEdit`）——**黑屏根因**：
   *   此前直接把面板的字符串值塞进树 ⇒ `padding`/`fontSize` 等**内核期望数字/对象**的字段收到字符串
   *   ⇒ **serde 失败 ⇒ 内核建树返回 0 ⇒ 空屏**。此处按字段类型强转（与两端同口径）。
   *   非法值 ⇒ 返回 null（**不静默**，调用方报 warn）。
   */
  private coerceLiveEdit(key: string, value: string): Object | null {
    // 颜色：合法 hex 才收（存原串；渲染侧 hexToArgb 解析）
    if (key === 'backgroundColor' || key === 'borderColor' || key === 'color') {
      return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : null;
    }
    // padding/margin：单值 ⇒ 四边同值；或 JSON 对象
    if (key === 'padding' || key === 'margin') {
      const d: number = Number(value);
      if (!Number.isNaN(d) && value.trim().length > 0) {
        return { 'top': d, 'right': d, 'bottom': d, 'left': d } as Record<string, number>;
      }
      try {
        const o = JSON.parse(value) as Record<string, Object>;
        const e: Record<string, number> = {};
        for (const s of ['top', 'right', 'bottom', 'left']) {
          const v = o[s];
          if (typeof v === 'number') { e[s] = v; }
        }
        return Object.keys(e).length > 0 ? e : null;
      } catch (err) { return null; }
    }
    // 枚举封闭集（防非法值致整树建不起来）
    if (key === 'display') { return ['flex', 'none', 'grid'].indexOf(value) >= 0 ? value : null; }
    if (key === 'position') { return ['static', 'relative', 'absolute', 'fixed', 'sticky'].indexOf(value) >= 0 ? value : null; }
    if (key === 'overflow' || key === 'overflowX' || key === 'overflowY') { return ['visible', 'hidden', 'scroll', 'auto'].indexOf(value) >= 0 ? value : null; }
    if (key === 'flexDirection') { return ['row', 'column', 'row-reverse', 'column-reverse'].indexOf(value) >= 0 ? value : null; }
    if (key === 'flexWrap') { return ['nowrap', 'wrap', 'wrap-reverse'].indexOf(value) >= 0 ? value : null; }
    // 默认：能解析为数字 ⇒ 数字（尺寸/弹性/字号/圆角/透明/偏移…）；否则按字符串原样收（文本/字体族/对齐…）
    const n: number = Number(value);
    if (!Number.isNaN(n) && value.trim().length > 0) { return n; }
    return value;
  }

  /** 把 `devEdits` 覆盖施到实例树（就地编辑；每轮渲染重施——全量重挂语义）。 */
  private applyEditsToNodes(nodes: Record<string, Object>[]): void {
    if (this.devEdits.size === 0) { return; }
    for (const n of nodes) {
      const idV = n['id'];
      if (typeof idV !== 'number') { continue; }
      const ov = this.devEdits.get(idV as number);
      if (ov !== undefined) {
        for (const k of Object.keys(ov)) { n[k] = ov[k]; }
      }
    }
  }

  aboutToDisappear(): void {
    this.stopMomentum();
    if (this.dSync !== null) { try { this.dSync.stop(); } catch (e) { /* 无 */ } }
    if (this.devWatch !== null) { this.devWatch.stop(); }
    if (this.devFrameSync !== null) { try { this.devFrameSync.stop(); } catch (e) { /* 无 */ } }
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
            // ★dev 就地编辑（决策 #729）：把面板下发的样式覆盖**应用到实例树**再上屏（改树 + 全量重挂语义——
            //   每次渲染整树重建，故覆盖须每轮重施）。⇒ **任意字段生效**（不受增量 PatchStyle 字段子集所限）。
            this.applyEditsToNodes(tree['nodes'] as Record<string, Object>[]);
            nodes = JSON.stringify(tree['nodes']);
            // ★dev：缓存**整棵实例化树**（含 viewport，供面板 Elements）——dev-watch 取走上报 /tree
            if (this.devWatch !== null) { this.pendingTreeJson = JSON.stringify(tree); }
            hilog.info(DOMAIN, TAG, 'HOST_PAGE_RUNTIME page=%{public}s nodes=%{public}d', page, (tree['nodes'] as Object[]).length);
          }
          this.saveSnapshot(rt);
          this.drainProjectConsole(rt);   // ★dev 项目 console（决策 #730）
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
    this.devMountCalls++;
  }

  /** 把某屏 nodes 画到屏上（appScreenCommands → renderCommands）+ 重算/重放滚动范围 */
  private paintTree(page: string, nodes: string): void {
    try {
      // renderCommands 是**追加**语义 ⇒ 每次上屏前先 clearRoot（清子节点 + fixed/sticky/id 登记），防叠树
      clearRoot();
      let cmds: string = appScreenCommands(JSON.stringify({
        'nodes': nodes, 'density': vp2px(1), 'vpW': MainPage.vpW, 'vpH': MainPage.vpH,
        'page': page, 'filesDir': this.filesDir,
        'env': this.envVars,   // ★安全区 env token（--pf-inset-*）替换用
      } as Record<string, Object>));
      // ★dev 元素高亮（决策 #729）：内存里的 cmds 是数组串 `[…]` ⇒ 在尾部叠一条**半透明高亮框 cmd**
      //   （rect 与 cmd 同口径=物理 px，由 `appScreenNodeRect` 给出；与命中同源）。不改 C++、不动命中/sticky 语义。
      const hl: string = this.highlightCmd();
      if (hl.length > 0) { cmds = cmds.replace(/\]\s*$/, hl + ']'); }
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
      // ★启动占位（决策 #731）：内容首帧已上屏 ⇒ 占位**最短可见 ~800ms** 后撤。
      //   ★为什么"最短时长"：release（rawfile 同步读）首帧即内容 ⇒ 占位一闪（用户「没看到占位」）；
      //     Android/iOS 的占位时长由**异步加载**决定（有真实等待）；鸿蒙 release 无等待 ⇒ 显式给最短窗口，
      //     与两端**观感对齐**（打开即见"App名+转圈"→ 内容）。dev 模式通常 dev bundle 更晚到，占位自然更久。
      if (!this.firstPainted && n > 0) {
        this.firstPainted = true;
        const self = this;
        setTimeout(() => { self.loading = false; }, 800);
      }
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
      this.drainProjectConsole(rt);   // ★dev 项目 console（tap 的 VM 调用也会产生）
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
        // ★被点元素（决策 #730 → 面板高亮）：命中链**末位** id ⇒ `/inspect`（dev-watch 上报）
        this.pendingInspectId = chain[chain.length - 1];
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
    Stack() {
      // ① 内容层（Proteus 屏内容直绘）
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

      // ② ★dev 胶囊（决策 #731/#732，对齐 Android/iOS DevOverlay）——**右上角**：
      //   ★容器只占**顶部一条**（`width 100%` + **高度自适应**，不 `height('100%')`）⇒ 只有这条(含胶囊)可点、
      //     下方内容点击**正常穿透**（此前全屏容器 `hitTestBehavior(Transparent)` 让胶囊点击被吞/错位）。
      //   顶部偏移 = 安全区顶(chromeTopVp) + 6vp、右 10vp（对齐 Android `TOP|END` + statusBar + 6/10dp）。
      //   有未还原就地编辑 ⇒ `DEV ✎` + 琥珀（`0xE6E08A00`）；否则 `DEV` + 半透明品牌蓝（`0xCC2F6BFF`）。
      if (this.devCapsule) {
        Column() {
          Text(this.edited ? 'DEV ✎' : 'DEV')
            .fontSize(11).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
            .padding({ left: 9, right: 9, top: 3, bottom: 3 })
            .backgroundColor(this.edited ? '#E6E08A00' : '#CC2F6BFF')
            .borderRadius(40)
            .onClick(() => { this.toggleSheet(); })
        }
        .width('100%')
        .alignItems(HorizontalAlign.End)
        .padding({ top: this.chromeTopVp, right: 10 })
      }

      // ③ ★顶部 toast（决策 #732）：**顶部一条**（高度自适应）⇒ **顶部居中**、角标下方 ~34vp、深色胶囊
      //   （对齐 Android/iOS 位置；不用 `promptAction.showToast`——它默认弹底部）。
      if (this.flashMsg.length > 0) {
        Column() {
          Text(this.flashMsg)
            .fontSize(13).fontColor('#FFFFFF')
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor('#E61F2430').borderRadius(14)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ top: this.chromeTopVp + 34 })
      }

      // ④ ★dev 底部 sheet（决策 #732，对齐 Android/iOS `buildSheet`）：全屏容器 `justifyContent(End)` ⇒ 贴底。
      //   title「DevTools」+ 渲染状态行 + 「重置为项目代码」+ 面板 URL。
      if (this.devCapsule && this.sheetOn) {
        Column() {
          Column({ space: 10 }) {
            Text('DevTools').fontSize(14).fontWeight(FontWeight.Bold).fontColor('#FFFFFF').width('100%')
            Text(this.edited ? '⚠ 渲染状态：含就地编辑 — 非项目代码效果' : '渲染状态：项目代码（实时）')
              .fontSize(12).fontColor(this.edited ? '#FFC24D' : '#FFFFFF').width('100%')
            Button('重置为项目代码')
              .fontSize(13).backgroundColor('#2F6BFF').width('100%')
              .onClick(() => { this.resetAll(); this.sheetOn = false; })
            Text(this.panelUrl.length > 0 ? ('面板：' + this.panelUrl + '（浏览器打开·元素高亮/就地编辑/REPL）') : '面板：浏览器打开 dev server 地址')
              .fontSize(11).fontColor('#9AA0AE').width('100%')
          }
          .width('100%').alignItems(HorizontalAlign.Start)
          .padding({ left: 16, right: 16, top: 16, bottom: 28 })
          .backgroundColor('#F21F2430')
          .borderRadius({ topLeft: 16, topRight: 16 })
          // 点 sheet 内的空白/按钮**不关**（点遮罩关）——onClick 只吞事件
          .onClick(() => { /* 吞掉内部点击 */ })
        }
        .width('100%').height('100%').justifyContent(FlexAlign.End)
        // ★遮罩：点 sheet 之外的区域 ⇒ 关闭（与两端"点外部收起"同语义）
        .backgroundColor('#66000000')
        .onClick(() => { this.sheetOn = false; })
      }

      // ⑤ ★启动占位（决策 #731，对齐 Android LaunchPlaceholder / iOS）：浅底 + App 名 + 品牌蓝转圈，**居中**
      if (this.loading) {
        Column({ space: 16 }) {
          Text(this.appName)
            .fontSize(18).fontWeight(FontWeight.Medium).fontColor('#1A1C22')
          LoadingProgress().width(36).height(36).color('#5B5BD6')
          Text('正在启动…').fontSize(13).fontColor('#8A8F99')
        }
        .width('100%').height('100%')
        .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
        .backgroundColor('#F5F6FA')
      }
    }
    // ★★★ `Stack` 默认 `alignContent: Center` ⇒ 子层（胶囊 Column/Text）会被**整体居中**（用户实测"胶囊跑到屏幕中间"）。
    //   显式 `TopEnd` ⇒ 右上角定位（配合各子层的 margin 微调）；内容层/占位层用 100% 尺寸自撑满，不受影响。
    .alignContent(Alignment.TopEnd)
    .width('100%')
    .height('100%')
    .backgroundColor('#101020')
    // ★内容铺满**全屏**（含状态栏与手势区）——与 Web viewport（390×844 全屏）同口径；叠加
    //   `setWindowLayoutFullScreen(true)`（见 aboutToAppear）⇒ 状态栏透明、内容透上来。
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }

  /** ★顶部 toast（决策 #732）：自绘**顶部居中**、角标下方、深色胶囊、~1.5s 淡出。
   *   ★为什么不用 `promptAction.showToast`——它默认弹在**屏幕底部**（用户实测"位置偏下"、与两端不一致）。 */
  private flash(msg: string): void {
    this.flashMsg = msg;
    if (this.flashTimer >= 0) { clearTimeout(this.flashTimer); }
    this.flashTimer = setTimeout(() => { this.flashMsg = ''; this.flashTimer = -1; }, 1500);
  }

  /** ★dev 胶囊点击 → 底部 sheet 开关（对齐 Android/iOS `toggleSheet`）。 */
  private toggleSheet(): void { this.sheetOn = !this.sheetOn; }

  /** sheet「重置为项目代码」——与面板 `/cmd reset` **同一实现**（清就地编辑 + 重渲 + 清编辑态）。 */
  private resetAll(): void {
    this.devEdits.clear();
    this.edited = false;
    this.renderCurrent();
    this.flash('已重置为项目代码');
    this.devLog('info', 'reset · 恢复项目代码效果');
  }
}
