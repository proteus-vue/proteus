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
import { NodeContent } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { attach, renderCommands, stats, ProteusRenderStats } from 'libproteus_render.so';
import { bench4050, hitProbe, recycleProbe, spliceProbe, textProbe, version as rustVersion } from 'libproteus_bench.so';

const DOMAIN = 0x0002;
const TAG = 'ProteusRender';
const BENCH_TAG = 'ProteusBench';

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
}

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
  @State benchLine: string = '（未跑）';
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
      }
    } else if (!this.nativeDone && this.nativeAppeared % 1000 === 0) {
      hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_BENCH_NATIVE_PROGRESS appeared=%{public}d',
        this.nativeAppeared);
    }
  }

  aboutToAppear(): void {
    hilog.info(DOMAIN, TAG, 'PROTEUS_PAGE_APPEAR');
  }

  build() {
    Stack() {
      ContentSlot(this.content)

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
    .width('100%')
    .height('100%')
    .backgroundColor('#F7F7F9')
    .onAppear(() => {
      // ── ① RenderNode 直绘（第二里程碑）──
      try {
        const rcAttach = attach(this.content);
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_ATTACH rc=%{public}d', rcAttach);
        const n = renderCommands(buildTestCommands());
        this.rendered = n;
        const st: ProteusRenderStats = stats();
        hilog.info(DOMAIN, TAG, 'PROTEUS_RENDER_JS_DONE nodes=%{public}d stats=%{public}d', n, st.nodes);
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
        // ★结构变更探针（splice；与 Android 同 payload）
        try {
          const sp: string = spliceProbe();
          hilog.info(DOMAIN, BENCH_TAG, 'PROTEUS_SPLICE %{public}s', sp);
        } catch (se) {
          hilog.error(DOMAIN, BENCH_TAG, 'PROTEUS_SPLICE_ERROR %{public}s', JSON.stringify(se) ?? '');
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
