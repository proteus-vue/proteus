// hosts/harmony/host-app/entry/src/main/ets/pages/Index.ets
// Proteus 鸿蒙宿主首页 —— ★★★RenderNode 直绘（第二里程碑）+ 4050 应用级基准（M5）
//
// 【挂载链】ArkTS `NodeContent`（ContentSlot）→ `native.attach(content)` →
//   `native.renderCommands(json)`（C++ 建 RenderNode 子树 + customNode 包装 + NodeContent_AddNode）。
//
// 【4050 基准（M5，对标 Android/iOS 同口径）】读 `rawfile/app-4050-tree.json`（与 Android **同一份夹具**）
//   → `bench.bench4050(fixture, W, H, depthLimit)`（Rust 核建树排版 + RenderNode 直绘树构建）→ 上报读数。
//
// 【★实测坑（本轮，写进 README）】鸿蒙 UI 线程有 **THREAD_BLOCK_6S** 看门狗：
//   ① 首版 readFixture 用逐字符 `out += String.fromCharCode(...)`（435KB ⇒ O(n²) 拼接）
//      ⇒ 主线程卡死 6 秒被系统杀进程（日志 `will exit because THREAD_BLOCK_6S`）。
//      **修法**：`util.TextDecoder` 一次解码。
//   ② 基准分档串行 + 档间 `setTimeout(16)` 让出主线程（不长时间独占 UI 线程）。
import { deviceInfo } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { NodeContent, FrameCallback, UIContext } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { display } from '@kit.ArkUI';
import { hidebug } from '@kit.PerformanceAnalysisKit';
// ★矩阵 #17：App 路由栈场景探针（移植副本，与 Android/iOS 同口径）
import { runAppStackProbe } from '../core/app-stack-probe';
import { attach, renderCommands, stats, ProteusRenderStats, platformAnimBegin, platformAnimStep, platformAnimEnd, platformAnimSave, clearRoot, scrollRoot, gestureInstall, gestureSample } from 'libproteus_render.so';
// ★P3-3：宿主动画入口（`<Transition>` 桥的鸿蒙腿——与 Android/iOS 同形）
import { animTick, animActive } from 'libproteus_bench.so';
import { bench4050, hitProbe, recycleProbe, spliceProbe, textProbe, kernelAnimProbe, memProbe, sfcStressProbe, sfcStressCommands, jsvmProbe, vaporProbe, animCurveBezier, hostRuntimeProbe, hostRtShellInstall, mountVirtualProbe, gestureHitPrepare, gestureHitAt, fontFamilyProbe, nodeRect, version as rustVersion } from 'libproteus_bench.so';

const DOMAIN = 0x0002;
const TAG = 'ProteusRender';
const BENCH_TAG = 'ProteusBench';

/**
 * ★滚动帧率采集回调（具名类——ArkTS 禁类字面量 `arkts-no-class-literals`，编译器当场要求）。
 *   `stamps` 与 `onTick` 由持有方注入（避免类字段跨实例共享的坑）。
 */
class ScrollFrameCallback extends FrameCallback {
  private stamps: number[];
  private onTick: () => void;
  constructor(stamps: number[], onTick: () => void) {
    super();
    this.stamps = stamps;
    this.onTick = onTick;
  }
  onFrame(frameTimeInNano: number): void {
    this.stamps.push(frameTimeInNano);
    this.onTick();
  }
  onIdle(): void {
    /* 空闲帧：不采集（滚动探针只关心活跃帧） */
  }
}

/**
 * ★★压力场景"首帧已上屏"上报（矩阵 #21 采集用）——只报一次（避免逐帧刷屏 hilog）。
 *   采集脚本条件等待 `PROTEUS_SFCSTRESS_FRAME`（零盲等：让被测对象主动上报）。
 */
class SfcFrameCallback extends FrameCallback {
  private fired: boolean = false;
  onFrame(_frameTimeInNano: number): void {
    if (this.fired) return;
    this.fired = true;
    hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SFCSTRESS_FRAME');
  }
  onIdle(): void {}
}

/** 平台动画步进读数（ArkTS 严格模式：显式接口——字段与 platformAnimStep 的 JSON 对应） */
interface AnimStepReading {
  tx: number;
  scale: number;
  alpha: number;
  scale_readback: number;
  alpha_readback: number;
  on_draw_count: number;
}

/** 平台动画结算读数 */
interface AnimEndReading {
  ok: boolean;
  draw_delta: number;
  measure_delta: number;
  layout_delta: number;
  on_draw_count: number;
}

/**
 * ★★平台零参与动画（矩阵 #15）：VSync 帧回调逐帧写 RenderNode 变换属性。
 *   每帧只做 3 次属性写入 + 2 次读回（无绘制、无布局）——on_draw_count 全程恒定是本探针的核心判据。
 *   ★与 Android ViewPropertyAnimator 的语义差异（如实）：Android 一次性启动后由 RenderThread
 *   自主插值；鸿蒙 C-API 无同形入口 ⇒ 本探针由帧回调步进（与系统动画同一帧源）。
 */
/**
 * ★★★**过渡动画帧循环**（P3-3，2026-10-03 · 三端同步的鸿蒙腿）
 *
 * 【与 Android/iOS 同一套内核动画】`animStart`（登记）→ 每帧 `animTick(dt)`（推进/求值）
 *   → `animActive()` 报 0 停。宿主只做"按 vsync 调"（几何/通道求值全在内核）。
 * 【停判据】内核自报活跃数（权威）；硬上限 3s 防"永远活跃"时无限帧循环。
 */
class TransitionFrameCallback extends FrameCallback {
  private uiCtx: UIContext;
  private frames: number = 0;
  private hardStopAtMs: number = 0;
  constructor(uiCtx: UIContext) {
    super();
    this.uiCtx = uiCtx;
    this.hardStopAtMs = Date.now() + 3000;
  }
  onFrame(_frameTimeInNano: number): void {
    try {
      animTick('{"dtMs":16.7}');
      this.frames++;
      let active: number = -1;
      try {
        const a: string = animActive();
        const o = JSON.parse(a) as Record<string, number>;
        if (o && typeof o.active === 'number') active = o.active;
      } catch (ignored) { /* 读数失败 ⇒ 硬上限兜底（不静默盲转） */ }
      if (active === 0 || Date.now() > this.hardStopAtMs) {
        hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_ANIM_LOOP_DONE frames=%{public}d', this.frames);
        return;
      }
    } catch (e) {
      hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_ANIM_LOOP_ERROR %{public}s', JSON.stringify(e) ?? '');
      return;
    }
    this.uiCtx.postFrameCallback(this);
  }
}

class PlatformAnimFrameCallback extends FrameCallback {
  private uiCtx: UIContext;
  private filesDir: string;
  private step: number = 0;
  private readings: string[] = [];
  private readonly total: number = 8;
  private done: boolean = false;
  constructor(uiCtx: UIContext, filesDir: string) {
    super();
    this.uiCtx = uiCtx;
    this.filesDir = filesDir;
  }
  onFrame(_frameTimeInNano: number): void {
    if (this.done) return;
    if (this.step >= this.total) {
      this.done = true;
      this.finish();
      return;
    }
    const t: number = this.step / (this.total - 1);
    const payload: string = '{"tx":' + (120 * t).toFixed(2) +
      ',"scale":' + (1 - 0.4 * t).toFixed(3) +
      ',"alpha":' + (1 - 0.5 * t).toFixed(3) + '}';
    const r: string = platformAnimStep(payload);
    this.readings.push(r);
    this.step++;
    this.uiCtx.postFrameCallback(this);   // 下一帧继续（VSync 节奏）
  }
  onIdle(): void {}
  private finish(): void {
    try {
      const endJson: string = platformAnimEnd();          // {ok, draw_delta, ...}
      const bez: string = animCurveBezier(1);             // 内核贝塞尔（A1 契约）
      const endObj: AnimEndReading = JSON.parse(endJson) as AnimEndReading;
      const last: string = this.readings.length > 0 ? this.readings[this.readings.length - 1] : '{}';
      const composed: string = '{"host_id":"harmony","bezier":' + bez
        + ',"mids":[' + this.readings.join(',') + ']'
        + ',"end":' + last
        + ',"draw_delta":' + endObj.draw_delta
        + ',"measure_delta":' + endObj.measure_delta
        + ',"layout_delta":' + endObj.layout_delta
        + ',"note":"鸿蒙腿：RenderNode 变换 + VSync 帧回调逐帧写属性（应用层零绘制/零布局）；与 Android ViewPropertyAnimator 的差异见 proteus_render.cpp 头注"}';
      const rc: number = platformAnimSave(composed, this.filesDir + '/platform-anim.json');
      hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_PLATFORMANIM rc=%{public}d %{public}s', rc, composed);
    } catch (e) {
      hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_PLATFORMANIM_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }
}

/**
 * ★★矩阵 #5：**Proteus 渲染路径滚动**的帧回调（与 ArkUI Scroll 容器对照）。
 *   每帧只做一次 `scrollRoot(offset)`（平移根 RenderNode——内容整体位移）+ postFrameCallback，
 *   帧区间由 postFrameCallback 的 timeStamp 采（与现有滚动探针同法）。
 *   ★与 scrollProbe 的差别：那条滚的是 **ArkUI Scroll 容器**（平台滚动）；本探针滚的是
 *   **Proteus 自绘的 RenderNode 树**（应用级滚动）——两者对照即为 Android 的
 *   scroll-native vs scroll-core 在鸿蒙的等价物。
 */
class ScrollCoreFrameCallback extends FrameCallback {
  private uiCtx: UIContext;
  /** 完成回调（收尾编排：Proteus 滚动结束后启动原生滚动对照） */
  private onDone: () => void;
  private stamps: number[] = [];
  private step: number = 0;
  private readonly frames: number;
  private readonly stepVp: number;
  private readonly warmup: number;
  private offset: number = 0;
  onFrame(frameTimeInNano: number): void {
    if (this.step >= this.frames + this.warmup) return;
    this.offset += this.stepVp;
    scrollRoot(this.offset);                    // 真滚动：整幅内容上移（应用自绘路径）
    if (this.step >= this.warmup) {
      this.stamps.push(frameTimeInNano);        // ★预热帧不入统计：首几帧含"内容变更后 RS 重建"的一次性成本
    }
    this.step++;
    if (this.step < this.frames + this.warmup) {
      this.uiCtx.postFrameCallback(this);
      return;
    }
    // 结算
    const gaps: number[] = [];
    for (let k = 1; k < this.stamps.length; k++) gaps.push((this.stamps[k] - this.stamps[k - 1]) / 1e6);
    const sorted: number[] = gaps.slice().sort((a, b) => a - b);
    const avg: number = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : -1;
    const p50: number = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : -1;
    const p95: number = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : -1;
    const p99: number = sorted.length ? sorted[Math.floor(sorted.length * 0.99)] : -1;
    const minG: number = sorted.length ? sorted[0] : -1;
    const maxG: number = sorted.length ? sorted[sorted.length - 1] : -1;
    const total: number = this.stamps.length > 1 ? (this.stamps[this.stamps.length - 1] - this.stamps[0]) / 1e6 : -1;
    const fps: number = total > 0 ? (this.stamps.length - 1) / (total / 1000) : -1;
    const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
    hilog.info(DOMAIN, BENCH_TAG,
      'PROTEUS_SCROLL_CORE frames=%{public}d warmup=%{public}d avg_ms=%{public}s p50_ms=%{public}s p95_ms=%{public}s p99_ms=%{public}s min_ms=%{public}s max_ms=%{public}s fps=%{public}s offset=%{public}d',
      this.stamps.length, this.warmup, fmt(avg), fmt(p50), fmt(p95), fmt(p99), fmt(minG), fmt(maxG), fmt(fps), this.offset);
    this.onDone();
  }
  onIdle(): void {}
  constructor(uiCtx: UIContext, frames: number, stepVp: number, warmup: number, onDone: () => void) {
    super();
    this.uiCtx = uiCtx;
    this.frames = frames;
    this.stepVp = stepVp;
    this.warmup = warmup;
    this.onDone = onDone;
  }
}

/** CSS 十六进制色（#RRGGBB / #AARRGGBB）→ ARGB uint32 */
function cssToArgb(css: string): number {
  const hex = css.replace('#', '');
  const v = hex.length === 8 ? parseInt(hex, 16) : (0xff000000 | parseInt(hex, 16));
  return v >>> 0;
}

/** 测试指令（RenderCmd 同形——★ArkTS 严格模式要求显式接口） */
interface RenderCmdFixture {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  radius: number;
  /** ★文本上屏（2026-10-02）：带 text 的指令走 content modifier + typography */
  text?: string;
  fontSize?: number;
  textColor?: number;
}

/**
 * 原生混用场景**第二帧**渲染：等 @State 触发的页面重建完成后，再挂自绘内容。
 *
 * 【为什么必须分两帧（四轮实测收敛）】onAppear 里同步的序列是：
 *   `setState(几何)` → `attach + renderCommands（自绘）` —— 而 setState 会**排队一次重建**：
 *   重建把 ContentSlot 重挂载，**自绘内容随旧挂载点一起丢**（实测：渲染日志 44 节点都建了，
 *   截图里自绘层空白）。正解：重建完成（下一帧）后再渲染自绘 ⇒ 挂在最终 ContentSlot 上。
 */
class NativeMixRenderCallback extends FrameCallback {
  private content: NodeContent;
  private fixture: string;
  private vpW: number;
  private vpH: number;
  private x: number;
  private y: number;
  private w: number;
  private h: number;
  constructor(content: NodeContent, fixture: string, vpW: number, vpH: number,
              x: number, y: number, w: number, h: number) {
    super();
    this.content = content;
    this.fixture = fixture;
    this.vpW = vpW;
    this.vpH = vpH;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
  onFrame(_frameTimeInNano: number): void {
    try {
      const rcA: number = attach(this.content, vp2px(1), this.vpW, this.vpH);
      const cmds: string = sfcStressCommands(this.fixture, DENSITY, this.vpW, this.vpH);
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, BENCH_TAG,
        'PROTEUS_NATIVEMIX_READY rendered=%{public}d attach_rc=%{public}d x=%{public}s y=%{public}s w=%{public}s h=%{public}s',
        n, rcA, this.x.toFixed(1), this.y.toFixed(1), this.w.toFixed(1), this.h.toFixed(1));
    } catch (e) {
      hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_NATIVEMIX_RENDER_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }
  onIdle(): void {}
}

/** 触摸样本行（手势场景：落盘 JSONL——真时序证据） */
interface TouchSampleLine {
  t: string;
  x: number;
  y: number;
  ts: number;
}

/** 宿主运行时探针入参（ArkTS 严格模式） */
interface HostRtArgs {
  bundle: string;
  filesDir: string;
}

/** Vapor A/B 探针入参（含 mode/outName——矩阵 #14 续） */
interface VaporAbArgs {
  bundle: string;
  artifacts: string;
  vpW: number;
  vpH: number;
  density: number;
  filesDir: string;
  mode: string;
  outName: string;
}

/** Vapor 探针入参（ArkTS 严格模式要求显式接口） */
interface VaporProbeArgs {
  bundle: string;
  artifacts: string;
  vpW: number;
  vpH: number;
  density: number;
  filesDir: string;
}

/**
 * ★★单位换算（2026-10-02 实测修复，真根因）：
 *   RenderNode 的 `SetSize/SetPosition` 与 content modifier 的 canvas **都是物理 px 单位**
 *   （实证链：`vp2px(1)=3.5` + canvas 实测宽 300 + 截图方块约 300px ⇒ 传 300 得 300px）。
 *   ⇒ 设计值（vp）必须**乘密度**再下发，否则几何与字号整体缩 3.5 倍（首版字小即此因）。
 *   ★换算放 ArkTS 侧（`vp2px` 一处；C++ 侧不猜密度）。
 */
const DENSITY: number = vp2px(1);

function buildTestCommands(): string {
  const D = DENSITY;
  // ★色彩块 + 白色文字（文字经 typography 真绘制——见 proteus_render.cpp 的 DrawTextCallback）
  const cmds: RenderCmdFixture[] = [
    { kind: 'background', x: 16*D, y: 40*D, w: 328*D, h: 56*D, color: cssToArgb('#3478F6'), radius: 12*D,
      text: 'Proteus 文本上屏', fontSize: 18*D, textColor: cssToArgb('#FFFFFF') },
    { kind: 'background', x: 16*D, y: 108*D, w: 328*D, h: 56*D, color: cssToArgb('#F5A623'), radius: 12*D,
      text: 'typography 直绘（px 换算后）', fontSize: 16*D, textColor: cssToArgb('#FFFFFF') },
    { kind: 'background', x: 16*D, y: 176*D, w: 328*D, h: 56*D, color: cssToArgb('#1ABC9C'), radius: 12*D,
      text: 'RenderNode content modifier', fontSize: 15*D, textColor: cssToArgb('#FFFFFF') },
    { kind: 'background', x: 16*D, y: 244*D, w: 328*D, h: 56*D, color: cssToArgb('#9B59B6'), radius: 12*D,
      text: 'API 26 · 密度 3.5', fontSize: 16*D, textColor: cssToArgb('#FFFFFF') },
  ];
  return JSON.stringify(cmds);
}

@Entry
@Component
struct Index {
  private content: NodeContent = new NodeContent();
  /** ★压力场景模式（`aa start --ps scene stress` 时 true）——只渲染 SFC 夹具，跑采集截图 */
  private stressScene: boolean = (AppStorage.get<string>('proteusScene') ?? '') === 'stress';
  /** ★手势场景模式（`--ps scene gesture`）：只装真触摸接收器 + 渲染 SFC 夹具——不跑任何探针
   *  （探针日志会冲掉触摸样本行——实测：正常场景跑完 bench 后 PROTEUS_TOUCH 行被挤出缓冲区） */
  private gestureScene: boolean = (AppStorage.get<string>('proteusScene') ?? '') === 'gesture';
  /** ★Vapor A/B 场景（`--ps scene vapor-ab`，矩阵 #14 续）：Vapor vs Vue 运行时逐节点几何对照
   *  ——落独立报告 `vapor-ab.json`（不覆盖 runShort 的 vapor.json 证据） */
  private vaporAbScene: boolean = (AppStorage.get<string>('proteusScene') ?? '') === 'vapor-ab';

  /** Vapor 虚拟化列表场景（`--ps scene vapor-list`，矩阵 #14 续 · #5）——落 vapor-list.json */
  private vaporListScene: boolean = (AppStorage.get<string>('proteusScene') ?? '') === 'vapor-list';
  /** ★原生混用场景（`--ps scene native-mix`，矩阵 #10）：SFC 夹具自绘 + **ArkUI 原生组件**
   *  按核心几何定位（重叠在锚块上——z-order 像素实测） */
  private nativeMixScene: boolean = (AppStorage.get<string>('proteusScene') ?? '') === 'native-mix';
  /**
   * `.position` 的参照系修正 = **状态栏高度（48vp）**。
   * ★根因（`uitest dumpLayout` 取证）：页面 Stack 的 bounds 是 `[0,168][1320,2758]`——
   *   它本身从状态栏下方（y=168 **物理 px** = 48vp）开始；`position` 是**相对 Stack** 的坐标
   *   ⇒ 屏幕绝对 y = 48vp + position.y。要落屏幕 y=60vp 处，position.y 应为 60 − 48 = 12vp。
   *   ★这不是 magic number：它是**状态栏占位**，可复算（168px ÷ 3.5 = 48vp），与设备密度同源。
   *   ★教训：屏幕上"偏了 168px"的归因链——先怀疑布局参照系（Stack 从哪开始），再怀疑换算。
   */
  private readonly NATIVE_MIX_Y_COMP: number = 168 / 3.5;
  /** 原生组件几何（来自核心真源 nodeRect——"几何只在核心算"） */
  @State nativeX: number = -100;
  @State nativeY: number = -100;
  @State nativeW: number = 0;
  @State nativeH: number = 0;
  @State nativeReady: boolean = false;
  @State rendered: number = -1;
  @State benchLine: string = '（未跑）';
  // ── 滚动通道（真机滚动 + 帧率采集）──
  @State scrollOffset: number = 0;
  @State scrollFrames: number = 0;
  private scrollStartNs: number = 0;
  private scrollDone: boolean = false;
  private scroller: Scroller = new Scroller();
  private frameCb: FrameCallback | null = null;

  // ── 原生对照（声明式 ArkUI 建同规格 4050 元素）──
  @State showNative: boolean = false;
  @State nativeAppeared: number = 0;
  private nativeT0: number = 0;
  private nativeDone: boolean = false;
  // ★冷/热双读数（对齐 Android 惯例）：0=冷读中 / 1=热读中 / 2=完成
  private nativeRun: number = 0;
  private readonly NATIVE_ROWS: number = 50;
  private readonly NATIVE_COLS: number = 40;
  private readonly NATIVE_ELEMENTS: number = 4050; // 50 行 + 2000 格 + 2000 text

  /** 读 rawfile 夹具（★TextDecoder 一次解码——不用逐字符拼接，见文件头坑①） */
  private readFixture(): string {
    const ctx = getContext(this);
    const bytes: Uint8Array = ctx.resourceManager.getRawFileContentSync('app-4050-tree.json');
    const decoder = util.TextDecoder.create('utf-8');
    return decoder.decodeToString(bytes);
  }

  /**
   * ★滚动通道（2026-10-02）：真机滚动 + **帧率采集**（与 Android 的 gfxinfo / iOS 的帧统计同类）。
   *
   * 【采法】`postFrameCallback` 逐帧回调 → 记录 frameTimeInNano 序列 → 算 avg/p50/p95 间隔。
   *   滚动由程序驱动（scrollTo 逐帧推进 60 帧），避免人工滑动的不确定性。
   *   ★主动上报（PROTEUS_SCROLL_DONE）——零盲等纪律。
   */
  private runScrollProbe(): void {
    const FRAMES = 60;
    const STEP = 200;   // 每帧滚动推进（vp）
    const stamps: number[] = [];
    this.scrollStartNs = 0;
    this.scrollDone = false;
    let i = 0;
    const tick = (): void => {
      if (i >= FRAMES) {
        // 结算：帧间隔（ns → ms）
        const gaps: number[] = [];
        for (let k = 1; k < stamps.length; k++) gaps.push((stamps[k] - stamps[k - 1]) / 1e6);
        gaps.sort((a, b) => a - b);
        const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : -1;
        const p50 = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : -1;
        const p95 = gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : -1;
        const total = stamps.length > 1 ? (stamps[stamps.length - 1] - stamps[0]) / 1e6 : -1;
        const fps = total > 0 ? (stamps.length - 1) / (total / 1000) : -1;
        // ★★格式坑（2026-10-02 实测）：hilog 的流式格式化**不认 `%.2f`**（原样打出 `%.2f` 字面量）——
        //   修法：把数值**先转成字符串**再以 %{public}s 打（数字精度在 JS 侧控制）。
        const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();
        hilog.info(DOMAIN, BENCH_TAG,
          'PROTEUS_SCROLL_DONE frames=%{public}d avg_ms=%{public}s p50_ms=%{public}s p95_ms=%{public}s fps=%{public}s',
          stamps.length, fmt(avg), fmt(p50), fmt(p95), fmt(fps));
        this.scrollDone = true;
        return;
      }
      i++;
      this.scrollOffset = this.scrollOffset + STEP;
      this.scroller.scrollTo({ xOffset: 0, yOffset: this.scrollOffset });
      if (this.frameCb) this.getUIContext().postFrameCallback(this.frameCb);
    };
    this.frameCb = new ScrollFrameCallback(stamps, tick);
    this.getUIContext().postFrameCallback(this.frameCb);
  }

  /**
   * ★★矩阵 #5（scroll-core 等价物）：**Proteus 渲染路径滚动**。
   *   清根 → 渲染 SFC 应力夹具（44 节点，内容高 ≈816vp 可滚）→ 60 帧逐帧平移根 → 帧率上报。
   *   ★诚实边界：帧区间口径 = postFrameCallback 的 timeStamp（与 iOS 帧统计同档；
   *     Android 侧为 gfxinfo 系统帧统计——量纲同、采法不同，已在报告 note 标注）。
   */
  private runScrollCoreProbe(): void {
    try {
      const ctx = getContext(this);
      const sfcBytes: Uint8Array = ctx.resourceManager.getRawFileContentSync('stress-44.json');
      const sfcFix: string = util.TextDecoder.create('utf-8').decodeToString(sfcBytes);
      const disp = display.getDefaultDisplaySync();
      const vpW = px2vp(disp.width);
      const vpH = px2vp(disp.height);
      const remain: number = clearRoot();               // 清根（替换默认演示内容）
      const cmds: string = sfcStressCommands(sfcFix, DENSITY, vpW, vpH);
      const n: number = renderCommands(cmds);
      hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SCROLL_CORE_SETUP cleared_remain=%{public}d rendered=%{public}d',
        remain, n);
      // 60 帧 × 每帧 40vp（内容高 816 ⇒ 约 2.5 屏）；预热 8 帧不计（一次性重建成本归 setup）
      // ★收尾编排（串行）：Proteus 滚动结束后 → 启动 ArkUI 原生滚动对照（各跑各的，互不抢线程）
      this.getUIContext().postFrameCallback(new ScrollCoreFrameCallback(this.getUIContext(), 60, 40, 8, () => {
        try {
          this.runScrollProbe();
        } catch (sce) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_SCROLL_ERROR %{public}s', JSON.stringify(sce) ?? '');
        }
      }));
    } catch (e) {
      hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_SCROLL_CORE_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 分档跑基准（★档间让出主线程——见文件头坑②）；4050 全量在最后一档 */
  private async runBenchStaged(): Promise<void> {
    const t0 = Date.now();
    let fixture = '';
    try {
      fixture = this.readFixture();
    } catch (e) {
      hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_FIXTURE_ERROR %{public}s', JSON.stringify(e) ?? '');
      this.benchLine = '夹具读取失败';
      return;
    }
    hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_FIXTURE_READ bytes=%{public}d ms=%{public}d',
      fixture.length, Date.now() - t0);
    if (fixture.length === 0) {
      this.benchLine = '夹具为空';
      return;
    }
    const stages: number[] = [500, 2000, 4050];
    for (let i = 0; i < stages.length; i++) {
      // 让出主线程一帧（零盲等：这一帧是给系统 UI 的调度窗口，不是"等结果"）
      await new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, 16); });
      const limit: number = stages[i];
      const w0 = Date.now();
      const r: string = bench4050(fixture, 1080, 2400, limit);
      const wall: number = Date.now() - w0;
      hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_RESULT limit=%{public}d wall_ms=%{public}d %{public}s',
        limit, wall, r);
      this.benchLine = `4050 基准完成（末档 limit=${limit} wall=${wall}ms）`;
    }
    // ── ③ 原生对照：声明式 ArkUI 建 4050 元素（建完即收——不留在屏上）──
    await new Promise<void>((resolve) => { setTimeout(() => { resolve(); }, 800); });
    this.nativeDone = false;
    this.nativeAppeared = 0;
    this.nativeRun = 0;
    this.nativeT0 = Date.now();
    this.showNative = true;
  }

  /** 原生对照计数（每个元素 onAppear 触发）：全部到齐 = 渲染完成；★跑两遍（冷/热双读数） */
  private countNative(): void {
    this.nativeAppeared++;
    if (!this.nativeDone && this.nativeAppeared >= this.NATIVE_ELEMENTS) {
      this.nativeDone = true;
      const dt: number = Date.now() - this.nativeT0;
      if (this.nativeRun === 0) {
        hilog.info(DOMAIN, BENCH_TAG,
          'PROTEUS_BENCH_NATIVE wall_ms=%{public}d appeared=%{public}d', dt, this.nativeAppeared);
        // 触发第二遍（热读：管线已预热——与 Android 侧 "cold/warm 双读数" 同法）
        this.nativeRun = 1;
        this.showNative = false;
        setTimeout(() => {
          this.nativeAppeared = 0;
          this.nativeDone = false;
          this.nativeT0 = Date.now();
          this.showNative = true;
        }, 500);
      } else {
        hilog.info(DOMAIN, BENCH_TAG,
          'PROTEUS_BENCH_NATIVE_WARM wall_ms=%{public}d appeared=%{public}d', dt, this.nativeAppeared);
        this.benchLine = `原生 ArkUI 4050 元素 冷=${dt}ms（热读见上一条）`;
        this.showNative = false;
        this.nativeRun = 2;
        // ★矩阵 #5：现在主线程空闲了——启动 Proteus 渲染路径滚动探针（串行编排见 runScrollCoreProbe 注释）
        this.runScrollCoreProbe();
      }
    } else if (!this.nativeDone && this.nativeAppeared % 1000 === 0) {
      hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_NATIVE_PROGRESS appeared=%{public}d',
        this.nativeAppeared);
    }
  }

  /**
   * ★★★**过渡动画帧循环**（P3-3，2026-10-03 · 三端同步的鸿蒙腿）
   *
   * 【与 Android/iOS 同一套内核动画】`animStart`（登记）→ 每帧 `animTick(dt)`（推进，内核求值）
   *   → `animActive()` 报 0 停。宿主只做"按 vsync 调"这一件事（几何/求值全在内核）。
   * 【停判据用内核自报】与 Android `driveKernelAnimFrames` 同：`animActive` 是权威
   *   （时长由声明决定但接管/串联会改变实际时长）；硬上限 3s 防"永远活跃"时无限帧循环。
   */
  startTransitionFrameLoop(): void {
    // ★ArkTS 的 postFrameCallback 要 **FrameCallback 实例**（不是闭包——本仓实测编译期报
    //   `Argument of type '() => void' is not assignable to parameter of type 'FrameCallback'`
    //   ⇒ 与既有 PlatformAnimFrameCallback 同一模式：独立类实现 onFrame（该类定义在文件后段）。
    this.getUIContext().postFrameCallback(new TransitionFrameCallback(this.getUIContext()));
  }

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_PAGE_APPEAR');
  }

  build() {
    // ★定位语义（三轮实测收敛，写清避免重走）：
    //   ① Stack 默认居中 ⇒ `.position` 从居中算 ⇒ 偏下 168px；
    //   ② `alignContent(TopStart)` 单独用 ⇒ ContentSlot（自绘层）也跟着错位（蓝都没了）；
    //   ⇒ ③ 正解：**用 `.position` 但它相对于「Stack 布局给的位置」**——把原生组件放进一个
    //      **显式全屏、无内边距的容器**里，position 才等价于屏幕绝对坐标（见下方 Row 外层）。
    Stack() {
      ContentSlot(this.content)

      // ★矩阵 #10：ArkUI **原生组件**（按核心几何定位；重叠在自绘锚块上——z-order 像素实测）
      //   ★定位语义（三轮实测收敛）：**不包容器**（包全屏 Stack 会让 ContentSlot 也不见），
      //   直接用 `.position`——父 Stack 是**全屏**（宽高 100%），子项 position 即屏幕坐标；
      //   首轮"偏下 168px"的真因是**居中 Stack 的布局位置**（TopStart 已由最外层修正）。
      if (this.nativeMixScene && this.nativeReady) {
        Row() {
          Text('ArkUI Native').fontSize(12).fontColor('#FFFFFF')
        }
        .width(this.nativeW)
        .height(this.nativeH)
        .backgroundColor('#E53935')
        // ★★y 偏移补偿（四轮实测的根因落地）：Stack 的 `.position` 以**前一个兄弟
        //   （ContentSlot）的布局位置**为参照——实测稳定偏下 **170px**（≈ 48.6 设计单位，
        //   首个子项被 Stack 排到左上后，position 从它下方起算）。`NATIVE_MIX_Y_COMP` 是
        //   实测标定的常数（与设备密度无关——偏差来自布局流，非密度换算）。
        //   ★这是 ArkUI Stack 的定位语义，不是我们的几何错误：**核心几何 (16,60) 是唯一真源**，
        //     此处只做"渲染目标坐标系"的对齐（与 RenderNode 那次"host 被居中"同族问题）。
        .position({ x: this.nativeX, y: this.nativeY - this.NATIVE_MIX_Y_COMP })
        .id('proteus-native-mix')
      }

      // ★滚动通道：Scroll 容器（runScrollProbe 程序化滚动它；帧率由 postFrameCallback 采）
      Scroll(this.scroller) {
        Column() {
          ForEach(Array.from({ length: 40 }, (_: number, i: number) => i), (i: number) => {
            Row() {
              Text(`滚动行 ${i}`).fontSize(14).fontColor('#FFFFFF')
            }
            .width('100%').height(100).backgroundColor(i % 2 === 0 ? '#2A2A35' : '#222230')
          }, (i: number) => `srow-${i}`)
        }
      }
      .width(2).height(2)   // ★极小可视区（不干扰主画面；滚动逻辑与帧率采集不受尺寸影响）
      .position({ x: -100, y: -100 })
      .scrollBar(BarState.Off)

      if (this.showNative) {
        // 原生对照：声明式 ArkUI 4050 元素（规格与夹具同：50 行 × 40 格 × (格+text)）
        Column() {
          ForEach(Array.from({ length: this.NATIVE_ROWS }, (_: number, r: number) => r), (r: number) => {
            Row() {
              ForEach(Array.from({ length: this.NATIVE_COLS }, (_: number, c: number) => c), (c: number) => {
                Column() {
                  Text('item').fontSize(8).onAppear(() => { this.countNative(); })
                }
                .width(30)
                .height(18)
                .backgroundColor('#285ac8')
                .margin({ right: 1 })
                .onAppear(() => { this.countNative(); })
              }, (c: number) => `cell-${this.nativeRun}-${r}-${c}`)
            }
            .onAppear(() => { this.countNative(); })
          }, (r: number) => `row-${this.nativeRun}-${r}`)
        }
        .position({ x: 0, y: 700 })
      }

      if (!this.stressScene && !this.gestureScene && !this.nativeMixScene) {
        Column({ space: 8 }) {
          Text('Proteus RenderNode 直绘').fontSize(22).fontWeight(FontWeight.Bold)
        Text(`native nodes = ${this.rendered}`).fontSize(14).fontColor('#666666')
          .id('proteus-native-count')
        Text(`设备 ${deviceInfo.productModel} · API ${deviceInfo.sdkApiVersion}`)
          .fontSize(12).fontColor('#999999')
        Text(`4050 基准：${this.benchLine}`).fontSize(12).fontColor('#666666')
          .id('proteus-bench-line')
      }
        .width('100%')
        .padding({ top: 40, left: 16, right: 16 })
        .align(Alignment.TopStart)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F7F7F9')
    .onTouch((e: TouchEvent) => {
      // ★矩阵 #7：手势场景——真触摸样本落盘（标准触摸链；uitest uiInput 真注入驱动）
      if (!this.gestureScene) return;
      try {
        let typeName: string = 'other';
        if (e.type === TouchType.Down) typeName = 'down';
        else if (e.type === TouchType.Up) typeName = 'up';
        else if (e.type === TouchType.Move) typeName = 'move';
        else if (e.type === TouchType.Cancel) typeName = 'cancel';
        const arr: TouchObject[] = (typeName === 'up' || typeName === 'cancel') ? e.changedTouches : e.touches;
        if (arr.length > 0) {
          const pt: TouchObject = arr[0];
          const line: TouchSampleLine = { t: typeName, x: pt.x, y: pt.y, ts: e.timestamp };
          gestureSample(JSON.stringify(line));
          if (typeName === 'down') {
            // 命中测试打在**按下点**（与 GestureDetector 的 ACTION_DOWN 语义同）
            const hit: string = gestureHitAt(pt.x, pt.y);
            gestureSample('{"hit":' + hit + ',"hx":' + pt.x.toFixed(2) + ',"hy":' + pt.y.toFixed(2) + '}');
            hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_GESTURE_HIT x=%{public}s y=%{public}s %{public}s',
              pt.x.toFixed(1), pt.y.toFixed(1), hit);
          }
        }
      } catch (te) {
        hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_GESTURE_TOUCH_ERROR %{public}s', JSON.stringify(te) ?? '');
      }
    })
    .onAppear(() => {
      // ── ⓪' ★★手势场景分支（矩阵 #7）：只装真触摸接收器 + 渲染 SFC 夹具，不跑探针 ──
      if (this.gestureScene) {
        try {
          const ctx0 = getContext(this);
          const gb: Uint8Array = ctx0.resourceManager.getRawFileContentSync('stress-44.json');
          const gf: string = util.TextDecoder.create('utf-8').decodeToString(gb);
          const d0 = display.getDefaultDisplaySync();
          const gvw = px2vp(d0.width);
          const gvh = px2vp(d0.height);
          attach(this.content, vp2px(1), gvw, gvh);
          const gcmds: string = sfcStressCommands(gf, DENSITY, gvw, gvh);
          const gn: number = renderCommands(gcmds);
          const gi: string = gestureInstall(ctx0.filesDir);
          // 命中测试树（触摸坐标 → 核心 hitTest——与 hitProbe 同一 ABI）
          const gh: string = gestureHitPrepare(gf, gvw, gvh, DENSITY);
          hilog.info(DOMAIN, BENCH_TAG,
            'PROTEUS_GESTURE_SCENE rendered=%{public}d install=%{public}s hitprep=%{public}s', gn, gi, gh);
        } catch (gse) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_GESTURE_SCENE_ERROR %{public}s', JSON.stringify(gse) ?? '');
        }
        return;
      }
      // ── ⓪''' ★★Vapor 虚拟化列表场景（矩阵 #14 续 · #5）：mode:'list' ──
      if (this.vaporListScene) {
        try {
          const ctxL = getContext(this);
          const bL: Uint8Array = ctxL.resourceManager.getRawFileContentSync('bundle-vapor.js');
          const bLStr: string = util.TextDecoder.create('utf-8').decodeToString(bL);
          const aL: Uint8Array = ctxL.resourceManager.getRawFileContentSync('vapor-list-artifacts.json');
          const aLStr: string = util.TextDecoder.create('utf-8').decodeToString(aL);
          const dL = display.getDefaultDisplaySync();
          const lArgs: VaporAbArgs = {
            bundle: bLStr,
            artifacts: aLStr,
            vpW: px2vp(dL.width),
            vpH: px2vp(dL.height),
            density: DENSITY,
            filesDir: ctxL.filesDir,
            mode: 'list',
            outName: 'vapor-list.json',
          };
          const lOut: string = vaporProbe(JSON.stringify(lArgs));
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_LIST %{public}s', lOut.substring(0, 900));
        } catch (le) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_LIST_ERROR %{public}s', JSON.stringify(le) ?? '');
        }
        return;
      }
      // ── ⓪'' ★★Vapor A/B 场景（矩阵 #14 续）：Vapor vs Vue 运行时（mode:'ab'）──
      if (this.vaporAbScene) {
        try {
          const ctxA = getContext(this);
          const bA: Uint8Array = ctxA.resourceManager.getRawFileContentSync('bundle-vapor.js');
          const bAStr: string = util.TextDecoder.create('utf-8').decodeToString(bA);
          const aA: Uint8Array = ctxA.resourceManager.getRawFileContentSync('vapor-artifacts.json');
          const aAStr: string = util.TextDecoder.create('utf-8').decodeToString(aA);
          const dA = display.getDefaultDisplaySync();
          const abArgs: VaporAbArgs = {
            bundle: bAStr,
            artifacts: aAStr,
            vpW: px2vp(dA.width),
            vpH: px2vp(dA.height),
            density: DENSITY,
            filesDir: ctxA.filesDir,
            mode: 'ab',
            outName: 'vapor-ab.json',
          };
          // ★★先 attach（2026-10-03 · 打通绘制通道）：`probeChannels` 要读**渲染层**真源
          //   （四通道在 content modifier 画布上），而渲染层根节点由本调用建立——
          //   standalone vapor 场景恰好在更早的 bench 阶段已 attach 过 ⇒ 侥幸能跑；
          //   A/B 场景是**独立场景**（提前 return）⇒ 无此调用 ⇒ 建树返回 -1、通道全 0（实测）。
          attach(this.content, vp2px(1), px2vp(dA.width), px2vp(dA.height));
          const abOut: string = vaporProbe(JSON.stringify(abArgs));
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_AB %{public}s', abOut.substring(0, 900));
        } catch (abe) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_AB_ERROR %{public}s', JSON.stringify(abe) ?? '');
        }
        return;
      }

      // ── ⓪'' ★★原生混用场景（矩阵 #10）：自绘内容 + ArkUI 原生组件（核心几何定位）──
      if (this.nativeMixScene) {
        try {
          const ctxN = getContext(this);
          const nb: Uint8Array = ctxN.resourceManager.getRawFileContentSync('stress-44.json');
          const nf: string = util.TextDecoder.create('utf-8').decodeToString(nb);
          const dn = display.getDefaultDisplaySync();
          const nvw = px2vp(dn.width);
          const nvh = px2vp(dn.height);
          // ① 核心真源：实例化+排版（nodeRect 读它）
          gestureHitPrepare(nf, nvw, nvh, DENSITY);
          // ② 原生组件几何 = **核心算出的锚块几何**（不是我们手写的坐标）
          const rectJson: string = nodeRect(1);
          const rect = JSON.parse(rectJson) as Record<string, number>;
          if (rectJson.indexOf('"ok":true') >= 0) {
            this.nativeX = rect['x'];
            this.nativeY = rect['y'];
            this.nativeW = rect['w'];
            this.nativeH = rect['h'];
          }
          this.nativeReady = true;   // → 排队一次页面重建（ContentSlot 会重挂载）
          // ③ **下一帧**再渲染自绘（重建完成后——见 NativeMixRenderCallback 注释的四轮收敛）
          this.getUIContext().postFrameCallback(
            new NativeMixRenderCallback(this.content, nf, nvw, nvh,
              this.nativeX, this.nativeY, this.nativeW, this.nativeH));
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_NATIVEMIX_SETUP rect=%{public}s', rectJson);
        } catch (nme) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_NATIVEMIX_ERROR %{public}s', JSON.stringify(nme) ?? '');
        }
        return;
      }
      // ── ⓪ ★★压力场景分支（矩阵 #21 六端采集）：只渲染 SFC 夹具 + 主动上报，不跑探针 ──
      //   触发：`aa start ... --ps scene stress`（EntryAbility 写入 AppStorage；缺省场景不受影响）
      if (this.stressScene) {
        try {
          const ctx2 = getContext(this);
          const sfcBytes: Uint8Array = ctx2.resourceManager.getRawFileContentSync('stress-44.json');
          const sfcFix: string = util.TextDecoder.create('utf-8').decodeToString(sfcBytes);
          const disp2 = display.getDefaultDisplaySync();
          const vpW2 = px2vp(disp2.width);
          const vpH2 = px2vp(disp2.height);
          const rcA = attach(this.content, vp2px(1), vpW2, vpH2);
          // ★探针读数（锚块/首行几何——与六端报告同锚点；stress 场景也上报，采集脚本一次启动全收）
          const sfcOut2: string = sfcStressProbe(sfcFix, vpW2, vpH2, DENSITY);
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SFCSTRESS %{public}s', sfcOut2);
          const cmds: string = sfcStressCommands(sfcFix, DENSITY, vpW2, vpH2);
          const n2 = renderCommands(cmds);
          this.rendered = n2;
          hilog.info(DOMAIN, BENCH_TAG,
            'PROTEUS_SFCSTRESS_RENDERED nodes=%{public}d attach_rc=%{public}d vp=%{public}sx%{public}s',
            n2, rcA, vpW2.toFixed(2), vpH2.toFixed(2));
          this.getUIContext().postFrameCallback(new SfcFrameCallback());
        } catch (e) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_SFCSTRESS_RENDER_ERROR %{public}s', JSON.stringify(e) ?? '');
        }
        return;
      }
      // ── ① RenderNode 直绘（第二里程碑）──
      try {
        // ★密度自报（与 C++ 侧的单位标定日志对读——用于定标"canvas 单位 vs vp"）
        hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_DENSITY vp2px(1)=%{public}s', (vp2px(1)).toString());
        // ★密度 + 屏幕尺寸（vp）——建全屏 host + 根 RenderNode 用（绝对坐标空间）
        const disp = display.getDefaultDisplaySync();
        const rcAttach = attach(this.content, vp2px(1), px2vp(disp.width), px2vp(disp.height));
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_ATTACH rc=%{public}d', rcAttach);
        const n = renderCommands(buildTestCommands());
        this.rendered = n;
        const st: ProteusRenderStats = stats();
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_DONE nodes=%{public}d stats=%{public}d', n, st.nodes);
        // ★矩阵 #15：平台零参与动画（帧回调步进；报告落沙箱 el2 —— hdc 可读映射路径）
        const beginJson: string = platformAnimBegin();
        hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_PLATFORMANIM_BEGIN_JS %{public}s', beginJson);
        // ★矩阵 #7：装真触摸接收器（uitest uiInput 注入的样本 → PROTEUS_TOUCH 行）
        try {
          const gi: string = gestureInstall(getContext(this).filesDir);
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_GESTURE_INSTALL_JS %{public}s', gi);
        } catch (ge) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_GESTURE_INSTALL_ERROR %{public}s', JSON.stringify(ge) ?? '');
        }
        const ctxAnim = getContext(this);
        this.getUIContext().postFrameCallback(
          new PlatformAnimFrameCallback(this.getUIContext(), ctxAnim.filesDir));
        // ★矩阵 #5：Proteus 渲染路径滚动在 native 基准**热读完成后**触发（见 countNative）
        //   ——首版用 setTimeout(1000) 与 4050 原生基准并发 ⇒ 主线程被抢 ⇒ 滚动帧长尾
        //   （实测 p95 200ms / max 615ms）。**探针编排必须串行**（与"一条命令不并行两件写同一
        //   产物的事"同纪律：这里是"不并行两件抢同一主线程的事"）。
      } catch (e) {
        hilog.error(DOMAIN, TAG, 'PROTEUS_RENDER_JS_ERROR %{public}s', JSON.stringify(e) ?? '');
      }
      // ── ② 4050 应用级基准（M5；异步分档——不堵 UI 线程）──
      try {
        const ver: string = rustVersion();
        hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_RUST_VERSION %{public}s', ver);
        // ★命中测试探针（与 Android/iOS 同场景——三端共享核心的直接证据）
        try {
          const hp: string = hitProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_HIT_PROBE %{public}s', hp);
        } catch (he) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_HIT_PROBE_ERROR %{public}s', JSON.stringify(he) ?? '');
        }
        // ★长列表复用池探针（4000 行 / 400 帧；与 Android `recycle` 同口径）
        try {
          const rp: string = recycleProbe(4000, 400);
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_RECYCLE %{public}s', rp);
        } catch (re) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_RECYCLE_ERROR %{public}s', JSON.stringify(re) ?? '');
        }
        // ★★App 路由虚拟栈场景（矩阵 #17；与 Android/iOS 的 __proteusAppStackRun 同口径）
        try {
          const asOut: string = runAppStackProbe('{"depth":20000,"fans":32,"budget":1000}');
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_APPSTACK %{public}s', asOut);
        } catch (ase) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_APPSTACK_ERROR %{public}s', JSON.stringify(ase) ?? '');
        }
        // ★ArkUI 原生滚动对照（scroll-native 等价物）——改由 Proteus 滚动探针**完成后**启动
        //   （见 ScrollCoreFrameCallback.finish 的 onDone 回调）：两条滚动串行 ⇒ 互不抢主线程，
        //   读数各自干净（首版并发实测：Proteus 滚动 p95 200ms 全是并发噪声）。
        // ★结构变更探针（splice；与 Android 同 payload）
        try {
          const sp: string = spliceProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SPLICE %{public}s', sp);
        } catch (se) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_SPLICE_ERROR %{public}s', JSON.stringify(se) ?? '');
        }
        // ★★内存读数探针（矩阵 #19）：三段式（树 / 渲染节点 / 释放）——阶段间读 PSS
        try {
          const fix: string = this.readFixture();
          if (fix.length > 0) {
            // ★单位（文档确认）：`hidebug.getPss()` 返回 **KB**（与 Android PSS 同口径）——
            //   首版误当 bytes 除 1024 ⇒ 标签写"kb"实为 MB（数值本身没错，标签错）。
            const pss = (): number => Number(hidebug.getPss());   // KB
            const p0: number = pss();
            memProbe('tree', fix);
            const p1: number = pss();
            memProbe('nodes');
            const p2: number = pss();
            memProbe('release');
            const p3: number = pss();
            // ★归因第二轮（复用存量再建；区分"分配器缓存"与"真实泄漏"）
            memProbe('nodes-reuse');
            const p4: number = pss();
            memProbe('release');
            const p5: number = pss();
            const r = (v: number): number => Math.round(v);
            hilog.info(DOMAIN, BENCH_TAG,
              'PROTEUS_MEM {"ok":true,"base_kb":%{public}s,"tree_delta_kb":%{public}s,"nodes_delta_kb":%{public}s,"release_delta_kb":%{public}s,"reuse_delta_kb":%{public}s,"release2_delta_kb":%{public}s,"note":"鸿蒙腿：hidebug.getPss（KB）三段式；reuse 轮用于区分分配器缓存 vs 泄漏"}',
              r(p0).toString(), r(p1 - p0).toString(), r(p2 - p1).toString(), r(p3 - p2).toString(),
              r(p4 - p3).toString(), r(p5 - p4).toString());
          }
        } catch (me) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_MEM_ERROR %{public}s', JSON.stringify(me) ?? '');
        }
        // ★★SFC 压力夹具探针（矩阵 #21）——与六端一致性报告同源（同一份 .vue 的编译器产物）
        try {
          const ctx2 = getContext(this);
          const sfcBytes: Uint8Array = ctx2.resourceManager.getRawFileContentSync('stress-44.json');
          const sfcFix: string = util.TextDecoder.create('utf-8').decodeToString(sfcBytes);
          const dispS = display.getDefaultDisplaySync();
          const sfcOut: string = sfcStressProbe(sfcFix, px2vp(dispS.width), px2vp(dispS.height), DENSITY);
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SFCSTRESS %{public}s', sfcOut);
        } catch (sfe) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_SFCSTRESS_ERROR %{public}s', JSON.stringify(sfe) ?? '');
        }
        // ★JSVM 引擎探针（矩阵 #13/#14 前置——设备端 JS 引擎可用性）
        try {
          const jv: string = jsvmProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_JSVM %{public}s', jv);
        } catch (je) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_JSVM_ERROR %{public}s', JSON.stringify(je) ?? '');
        }
        // ★字体族探针（矩阵 #9）——同样文本同字号三族 ⇒ 度量分流（与 iOS V13 同款样本文本）
        try {
          const ff: string = fontFamilyProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_FONTFAMILY_PROBE %{public}s', ff);
        } catch (ffe) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_FONTFAMILY_ERROR %{public}s', JSON.stringify(ffe) ?? '');
        }
        // ★★整树级虚拟化（矩阵 #12）——同一份 SFC 产物（与 Android/iOS 同源）
        try {
          const ctxM = getContext(this);
          const mBytes: Uint8Array = ctxM.resourceManager.getRawFileContentSync('vapor-tree.json');
          const mStr: string = util.TextDecoder.create('utf-8').decodeToString(mBytes);
          const mvOut: string = mountVirtualProbe(mStr);
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_MOUNTVIRT %{public}s', mvOut);
        } catch (mve) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_MOUNTVIRT_ERROR %{public}s', JSON.stringify(mve) ?? '');
        }
        // ★★★宿主运行时（矩阵 #18，G-39）——JSVM eval 同一份 bundle-host-runtime.js
        try {
          const ctxH = getContext(this);
          const hBytes: Uint8Array = ctxH.resourceManager.getRawFileContentSync('bundle-host-runtime.js');
          const hStr: string = util.TextDecoder.create('utf-8').decodeToString(hBytes);
          const hArgs: HostRtArgs = { bundle: hStr, filesDir: ctxH.filesDir };
          const hOut: string = hostRuntimeProbe(JSON.stringify(hArgs));
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_HOSTRT %{public}s', hOut.substring(0, 700));
          // ★C 组：持久壳 VM（跨 onBackground/onForeground 存活——真生命周期转发的载体）
          const shellInstall: string = hostRtShellInstall(JSON.stringify(hArgs));
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SHELLINSTALL_JS %{public}s', shellInstall);
        } catch (he) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_HOSTRT_ERROR %{public}s', JSON.stringify(he) ?? '');
        }
        // ★★★Vapor 设备端链（矩阵 #14）——JSVM eval 与 Android 同一份 bundle-vapor.js
        //   ★串行执行（等前一档完成）——JSVM 全链在 UI 线程，单次 ~几百 ms（见 THREAD_BLOCK_6S 纪律）
        try {
          const ctx3 = getContext(this);
          const bBytes: Uint8Array = ctx3.resourceManager.getRawFileContentSync('bundle-vapor.js');
          const bStr: string = util.TextDecoder.create('utf-8').decodeToString(bBytes);
          const aBytes: Uint8Array = ctx3.resourceManager.getRawFileContentSync('vapor-artifacts.json');
          const aStr: string = util.TextDecoder.create('utf-8').decodeToString(aBytes);
          const disp3 = display.getDefaultDisplaySync();
          const vArgs: VaporProbeArgs = {
            bundle: bStr,
            artifacts: aStr,
            vpW: px2vp(disp3.width),
            vpH: px2vp(disp3.height),
            density: DENSITY,
            filesDir: ctx3.filesDir,
          };
          // ★★★P3-3（2026-10-03 · 三端同步）：启动**过渡动画帧循环**——
          //   `animStart` 只把动画登记进内核；"每帧 tick"是宿主职责（与 Android Choreographer /
          //   iOS CADisplayLink 同纪律）。本循环：每 vsync 调 `animTick(16.7)`，
          //   直到 `animActive` 报 0（内核权威停判据）或硬上限（3s 防"永远活跃"）。
          this.startTransitionFrameLoop();
          // ★★显式 attach（2026-10-03）：不再依赖"更早 bench 阶段恰好 attach 过"的**隐式耦合**
          //   （本轮实测：A/B 独立场景就没这层运气 ⇒ 渲染层建树返回 -1、通道全 0）。
          attach(this.content, vp2px(1), px2vp(disp3.width), px2vp(disp3.height));
          const vOut: string = vaporProbe(JSON.stringify(vArgs));
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR %{public}s', vOut.substring(0, 800));
        } catch (ve) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_VAPOR_ERROR %{public}s', JSON.stringify(ve) ?? '');
        }
        // ★内核动画探针（矩阵 #16）
        try {
          const kp: string = kernelAnimProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_KERNELANIM %{public}s', kp);
        } catch (ke) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_KERNELANIM_ERROR %{public}s', JSON.stringify(ke) ?? '');
        }
        // ★文本通道探针（ArkGraphics2D typography）
        try {
          const tp: string = textProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_TEXT %{public}s', tp);
        } catch (te) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_TEXT_ERROR %{public}s', JSON.stringify(te) ?? '');
        }
        this.runBenchStaged();
      } catch (e) {
        hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_ERROR %{public}s', JSON.stringify(e) ?? '');
        this.benchLine = '异常（见 hilog）';
      }
    })
  }
}
