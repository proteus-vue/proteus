// hosts/harmony/host-app/proteus_render/AppRuntimeDriver.ets
// ★★★**应用运行期驱动**（v-pump 周期驱动 + 跳变驱动动画）——**runtime 归属的唯一实现**（决策 #796）。
//
// 【为什么在这一层（用户 2026-10-11 点名）】「我们做宿主关注点分离不就是要规避这种问题吗？
//   宿主能力应该是做一次所有宿主都收益」。此前该驱动写在**壳**里（参考宿主 `Superapp.ets`，
//   本轮又抄进 CLI 模板壳 `MainPage.ets`）——正是"同一能力多消费者逐条接线"的隐患形态：
//   换一个壳就漏接（本仓实证：Android 的 `pullPumps()` 只写在 CLI 模板壳里，框架参考壳
//   `SuperappActivity` 从未接 ⇒ 泵在框架壳上**从不跑**）。
//   ⇒ 本类固定在 **runtime HAR** 里：任何鸿蒙壳（参考宿主 / CLI 生成宿主 / 未来新壳）
//   `import { AppRuntimeDriver } from 'proteus_render'` 一次装配即得全部能力，**壳内零驱动代码**。
//
// 【诚实边界（一次性 VM）】鸿蒙是**一次性 VM**（决策 #540）⇒ 每一拍 = 一个新 VM（boot + N 帧泵 +
//   重挂），批内中间帧不上屏 ⇒ 可见刷新率低于 Android 逐帧驱动；批大小按实测 `eval_ms` 自适应。
//   ★动画规格/原子钟在 native 侧持有（`hostAppAnimAttach` 重放到当前相位），本类只做"何时调"。
import { hilog } from '@kit.PerformanceAnalysisKit';
import { applyNodeVisuals, applyPressVisual, appScreenFollowField, hostAppPumpTick, hostAppPumpHzSet, hostAppAnimAttach, hostAppAnimTick, hostAppAnimStats } from './Index';

const DOMAIN = 0x0003;
const TAG = 'ProteusAppRuntime';

/** 视口（vp；内部用——**不跨模块导出**，见构造函数注释）。 */
interface ZRuntimeViewport { width: number; height: number }
/** 泵节拍入参（hostAppPumpTick 契约；ArkTS 禁未型字面量 ⇒ 显式接口；**本地不导出**）。 */
interface ZPumpTickArgs {
  bundle: string; page: string; viewport: ZRuntimeViewport; dtMs: number; frames: number;
  state?: Record<string, Object>;
}
/** 读数（宿主侧真源；本地不导出）。 */
interface ZDriverStats {
  pump_ticks: number; pump_fired: number; pump_interval_ms: number; batch_frames: number; last_eval_ms: number;
  anim_attaches: number; anim_ticks: number; anim_applied: number; anim_starts: number; anim_active_last: number;
}
/** 读数 JSON 包装（本地不导出）。 */
interface ZDriverStatsJson { host: ZDriverStats; native: Record<string, Object> }
/** 含交互反馈探针的读数包装（Dactyl 专项）。 */
interface ZDriverStatsJson3 { host: ZDriverStats; native: Record<string, Object>; probe: Record<string, Object> }
/** 交互反馈探针（ArkTS 禁未型字面量）。 */
interface InteractionProbe {
  press_styles: number; press_applied: number; field_specs: number; field_ticks: number; field_nodes_touched: number;
}

/**
 * ★★★**应用运行期驱动**（一个实例挂在一个页面壳上）。
 *
 * 【为什么构造参数是**回调分解**而不是一个 host 对象（实测）】ArkTS 拒收"跨 HAR 导入的接口 +
 *   对象字面量"（`arkts-no-untyped-obj-literals`：壳侧 `const h: AppRuntimeDriverHost = {...}` 编译红）
 *   ⇒ 改为**分解回调**（壳侧传箭头函数，零跨模块类型、零对象字面量）。
 *
 * 用法（壳侧全部代码——零驱动逻辑）：
 * ```ts
 * this.driver = new AppRuntimeDriver(
 *   () => this.bundle, () => this.current, () => MainPage.vpW, () => MainPage.vpH,
 *   () => this.runtimeState,
 *   (rt) => { this.saveSnapshot(rt); ... 拿 rt.tree 上屏 ... },
 * )
 * // 渲染/命中后各调一次（幂等）：
 * this.driver.onRenderReply(rt)
 * // 页面销毁：
 * this.driver.stop()
 * ```
 */
export class AppRuntimeDriver {
  private bundleGetter: () => string;
  private pageGetter: () => string;
  private vpWGetter: () => number;
  private vpHGetter: () => number;
  private stateGetter: () => Record<string, Object> | null;
  private onReplyCb: (rt: Record<string, Object>) => void;
  private pumpTimer: number = -1;
  private pumpIntervalMs: number = 0;
  private pumpFramesPerBatch: number = 4;
  private pumpLastEvalMs: number = 0;
  private pumpTicks: number = 0;
  private pumpFired: number = 0;
  private animTimer: number = -1;
  private animTicks: number = 0;
  private animAttaches: number = 0;
  private animAppliedTotal: number = 0;
  private animStarts: number = 0;
  private animActiveLast: number = -1;

  constructor(
    bundleGetter: () => string,
    pageGetter: () => string,
    vpWGetter: () => number,
    vpHGetter: () => number,
    stateGetter: () => Record<string, Object> | null,
    onReply: (rt: Record<string, Object>) => void,
  ) {
    this.bundleGetter = bundleGetter;
    this.pageGetter = pageGetter;
    this.vpWGetter = vpWGetter;
    this.vpHGetter = vpHGetter;
    this.stateGetter = stateGetter;
    this.onReplyCb = onReply;
  }

  /**
   * ★**每次 hostAppRender / hostAppPumpTick 回执后调一次**（壳的渲染出口）：
   *   ① 读 `pumpHz` 起/停周期驱动（**回执不带 `pumpHz` ⇒ 不动节拍**——空回执只做动画挂树）；
   *   ② 动画挂树 + 重放到当前相位。
   *   ★幂等：重复调只刷新频率/重放一次动画，不会起第二个定时器。
   */
  onRenderReply(rt: Record<string, Object>): void {
    if (rt['pumpHz'] !== undefined) { this.syncPumpFromReply(rt); }
    this.attachAnimations();
  }

  /* ── 泵周期驱动 ── */

  private syncPumpFromReply(rt: Record<string, Object>): void {
    let hz: number[] = [];
    const raw = rt['pumpHz'];
    if (Array.isArray(raw)) { hz = raw as number[]; }
    try { hostAppPumpHzSet(JSON.stringify(hz)); } catch (e) { /* 读数记录失败不阻断驱动 */ }
    let maxHz = 0;
    for (const v of hz) { if (typeof v === 'number' && v > 0 && v > maxHz) { maxHz = v; } }
    if (maxHz > 0) {
      this.pumpIntervalMs = Math.max(8, Math.round(1000 / maxHz));
      this.startPumpLoop();
    } else {
      this.stopPumpLoop();
    }
  }

  private startPumpLoop(): void {
    if (this.pumpTimer >= 0) { return; }   // 已在跑（频率变化由下一拍现读 pumpHz 生效）
    this.pumpTimer = setInterval(() => { this.pumpBeat(); }, Math.max(8, this.pumpIntervalMs));
    hilog.info(DOMAIN, TAG, 'APP_RT_PUMP_START interval=%{public}dms', this.pumpIntervalMs);
  }

  private stopPumpLoop(): void {
    if (this.pumpTimer >= 0) { clearInterval(this.pumpTimer); this.pumpTimer = -1; }
  }

  /** 一拍：一个一次性 VM 里跑 N 帧泵（批大小按上拍实测 eval_ms 自适应——目标 ≈ 80ms/拍）。 */
  private pumpBeat(): void {
    const bundle: string = this.bundleGetter();
    if (bundle.length === 0) { return; }
    try {
      const vp: ZRuntimeViewport = { width: this.vpWGetter(), height: this.vpHGetter() };
      const args: ZPumpTickArgs = {
        bundle: bundle, page: this.pageGetter(), viewport: vp,
        dtMs: 1000 / 60, frames: this.pumpFramesPerBatch,
      };
      const st = this.stateGetter();
      if (st !== null && Object.keys(st).length > 0) { args.state = st; }
      const rtOut: string = hostAppPumpTick(JSON.stringify(args));
      const rt = JSON.parse(rtOut) as Record<string, Object>;
      this.pumpTicks++;
      const fired = rt['fired'] as number | undefined;
      if (fired !== undefined) { this.pumpFired += fired; }
      const evalMs = rt['eval_ms'] as number | undefined;
      if (evalMs !== undefined) {
        this.pumpLastEvalMs = evalMs;
        // 批大小自适应：>80ms ⇒ 减半（保 UI 线程）；<20ms ⇒ 加倍（提高可见刷新率），上限 32
        if (evalMs > 80 && this.pumpFramesPerBatch > 1) { this.pumpFramesPerBatch = Math.max(1, Math.floor(this.pumpFramesPerBatch / 2)); }
        else if (evalMs < 20 && this.pumpFramesPerBatch < 32) { this.pumpFramesPerBatch = this.pumpFramesPerBatch * 2; }
      }
      this.onReplyCb(rt);             // 宿主：保存 snapshot / applyState / 拿 tree 上屏
      this.attachAnimations();        // 树重建后补挂动画 + 重放（动画与泵同拍推进）
      if (this.pumpTicks <= 3 || this.pumpTicks % 30 === 0) {
        hilog.info(DOMAIN, TAG, 'APP_RT_PUMP tick=%{public}d fired=%{public}d frames=%{public}d evalMs=%{public}d',
          this.pumpTicks, fired ?? -1, this.pumpFramesPerBatch, Math.round(evalMs ?? 0));
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'APP_RT_PUMP_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /* ── 跳变驱动动画 ── */

  /** 每次建树后调：把动画规格挂到新树 + 重放到当前相位，返回首帧 updates（立即写视觉）。 */
  private attachAnimations(): void {
    try {
      const out = hostAppAnimAttach();
      const o = JSON.parse(out) as Record<string, Object>;
      const active = o['active'] as number | undefined;
      const started = o['started'] as number | undefined;
      if (started !== undefined && started > 0) { this.animStarts += started; }
      this.animAttaches++;
      this.applyVisuals(o);
      if (active !== undefined && active > 0) { this.startAnimLoop(); }
      this.animActiveLast = active ?? -1;
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'APP_RT_ANIM_ATTACH_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /** 帧循环：`hostAppAnimTick` → applyNodeVisuals；内核 active==0 ⇒ 自停。 */
  private startAnimLoop(): void {
    if (this.animTimer >= 0) { return; }
    this.animTimer = setInterval(() => {
      try {
        const out = hostAppAnimTick('{"dtMs":16.7}');
        const o = JSON.parse(out) as Record<string, Object>;
        this.animTicks++;
        this.applyVisuals(o);
        const active = o['active'] as number | undefined;
        this.animActiveLast = active ?? -1;
        if (active !== undefined && active === 0) {
          clearInterval(this.animTimer); this.animTimer = -1;
          hilog.info(DOMAIN, TAG, 'APP_RT_ANIM_LOOP_DONE ticks=%{public}d applied=%{public}d', this.animTicks, this.animAppliedTotal);
        }
      } catch (e) {
        hilog.error(DOMAIN, TAG, 'APP_RT_ANIM_TICK_ERROR %{public}s', JSON.stringify(e) ?? '');
        clearInterval(this.animTimer); this.animTimer = -1;
      }
    }, 16);
  }

  /** 把回执里的 `updates`（内核逐帧视觉）写到渲染层。 */
  private applyVisuals(o: Record<string, Object>): void {
    const updates = o['updates'];
    if (updates === undefined || updates === null) { return; }
    const json: string = JSON.stringify(updates);
    if (json.length <= 2) { return; }
    try {
      const r = applyNodeVisuals(json);
      const ro = JSON.parse(r) as Record<string, Object>;
      const applied = ro['applied'] as number | undefined;
      if (applied !== undefined) { this.animAppliedTotal += applied; }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'APP_RT_ANIM_APPLY_ERROR %{public}s', JSON.stringify(e) ?? '');
    }
  }

  /* ══════════ ★★★Dactyl 专项：按下态 + 场跟手（与 Android/iOS 同一职责）══════════
   * 【为什么在这（决策 #796 能力归属）】平台无关的宿主动力 ⇒ 归 runtime：任何鸿蒙壳零接线受益。
   * 【按下态】DOWN 时从**当前树**的 press* 字段收集（与 iOS InteractionFeedback.install 同源）
   *   ⇒ 调 applyPressVisual 直写 RenderNode（O(1) 同帧）；UP ⇒ applyPressVisual({}) 还原。
   * 【场跟手】MOVE 只记焦点（零 FFI）；帧循环每帧一次 appScreenFollowField ⇒ 写 RenderNode 缩放。
   *   ★与泵定时器分开：场跟手要**逐帧**（手指在场里），泵按屏频率。 */

  private pressStyles: Map<number, Record<string, number>> = new Map<number, Record<string, number>>()
  private fieldSpecs: Map<number, Record<string, number>> = new Map<number, Record<string, number>>()
  private fieldFocus: Map<number, number[]> = new Map<number, number[]>()
  private touchFieldCid: number = -1
  private pressNodeId: number = -1
  private interactionLink: number = -1
  private pressAppliedCount: number = 0
  private fieldTickCount: number = 0
  private fieldTouchedTotal: number = 0
  private currentNodes: Record<string, Object>[] = []

  /** 收集两张表（每次回执带 tree 时调）——与 iOS InteractionFeedback.install 同源口径。 */
  private installInteraction(nodes: Record<string, Object>[]): void {
    this.currentNodes = nodes
    this.pressStyles.clear()
    this.fieldSpecs.clear()
    for (const n of nodes) {
      const id = n['id'] as number | undefined
      if (id === undefined) { continue }
      const ps: Record<string, number> = {}
      let has = false
      const bg = n['pressBackgroundColor'] as string | undefined
      if (bg !== undefined) { ps['bg'] = hexToArgbNum(bg); has = true }
      const bc = n['pressBorderColor'] as string | undefined
      if (bc !== undefined) { ps['borderColor'] = hexToArgbNum(bc); has = true }
      const tf = n['pressTransform'] as Record<string, Object> | undefined
      if (tf !== undefined) {
        const sx = (tf['sx'] as number | undefined) ?? 1
        const sy = (tf['sy'] as number | undefined) ?? 1
        if (sx !== 1 || sy !== 1) { ps['sx'] = sx; ps['sy'] = sy; has = true }
      }
      const sh = n['pressBoxShadow'] as Record<string, Object> | undefined
      if (sh !== undefined) {
        const gc = sh['color'] as string | undefined
        const gr = (sh['blur'] as number | undefined) ?? 0
        if (gc !== undefined && gr > 0) { ps['glowColor'] = hexToArgbNum(gc); ps['glowRadius'] = gr; ps['glowAlpha'] = 0.9; has = true }
      }
      if (has) { this.pressStyles.set(id, ps) }
      if (n['followField'] !== undefined) {
        // ★ArkTS 禁 Record 字面量 ⇒ 逐步赋值（与 pressStyles 的 ps 同法）
        const spec: Record<string, number> = {}
        spec['falloff'] = (n['followFieldFalloff'] as number | undefined) ?? 300
        spec['minScale'] = (n['followFieldMinScale'] as number | undefined) ?? 0.3
        spec['maxScale'] = (n['followFieldMaxScale'] as number | undefined) ?? 1.0
        spec['rotate'] = (n['followFieldRotate'] as number | undefined) ?? 30
        this.fieldSpecs.set(id, spec)
      }
    }
  }

  /** ★DOWN（壳的 .onTouch Down 调）：命中链已有（壳给 chain）⇒ 按下态 + 场焦点。 */
  onTouchDown(cx: number, cy: number, chain: number[]): void {
    this.touchFieldCid = -1
    for (const id of chain) { if (this.fieldSpecs.has(id)) { this.touchFieldCid = id; break } }
    if (this.touchFieldCid >= 0) {
      this.fieldFocus.set(this.touchFieldCid, [cx, cy])
      this.startInteractionLoop()
    }
    const target = chain.length > 0 ? chain[0] : -1
    if (target >= 0 && this.pressStyles.has(target)) {
      this.pressNodeId = target
      this.applyPress([target])
    }
  }

  /** ★MOVE：只记焦点（零 FFI）。 */
  onTouchMove(cx: number, cy: number): void {
    if (this.touchFieldCid >= 0) { this.fieldFocus.set(this.touchFieldCid, [cx, cy]) }
  }

  /** ★UP/CANCEL：还原按下态 + 清场（叶回基态）。 */
  onTouchUp(): void {
    if (this.pressNodeId >= 0) { this.applyPress([]); this.pressNodeId = -1 }
    this.fieldFocus.clear()
    this.touchFieldCid = -1
    this.stopInteractionLoop()
  }

  /** 应用/还原按下态：传 ids 列表（含伪子传播）⇒ 写 RenderNode；传 [] ⇒ 全还原。 */
  private applyPress(ids: number[]): void {
    const obj: Record<string, Object> = {}
    for (const id of ids) {
      const ps = this.pressStyles.get(id)
      obj[String(id)] = (ps !== undefined ? ps : EMPTY_PRESS) as Object
      for (const n of this.currentNodes) {
        if ((n['parentId'] as number | undefined) === id && n['pseudo'] !== undefined) {
          const nid = n['id'] as number
          const pps = this.pressStyles.get(nid)
          obj[String(nid)] = (pps !== undefined ? pps : EMPTY_PRESS) as Object
        }
      }
    }
    try {
      applyPressVisual(JSON.stringify(obj))
      if (ids.length > 0) { this.pressAppliedCount++ }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'APP_RT_PRESS_ERROR %{public}s', JSON.stringify(e) ?? '')
    }
  }

  private startInteractionLoop(): void {
    if (this.interactionLink >= 0) { return }
    this.interactionLink = setInterval(() => { this.interactionBeat() }, 16)
  }

  private stopInteractionLoop(): void {
    if (this.interactionLink >= 0) { clearInterval(this.interactionLink); this.interactionLink = -1 }
  }

  private interactionBeat(): void {
    if (this.fieldFocus.size === 0) { this.stopInteractionLoop(); return }
    this.fieldTickCount++
    for (const entry of Array.from(this.fieldFocus.entries())) {
      const cid: number = entry[0]
      const xy: number[] = entry[1]
      const spec = this.fieldSpecs.get(cid)
      if (spec === undefined) { continue }
      try {
        const req: Record<string, Object> = {
          'containerId': cid, 'x': xy[0], 'y': xy[1],
          'falloff': spec['falloff'], 'minScale': spec['minScale'], 'maxScale': spec['maxScale'],
          'rotate': spec['rotate'],
        }
        const out = appScreenFollowField(JSON.stringify(req))
        const o = JSON.parse(out) as Record<string, Object>
        const nodes = o['nodes'] as Record<string, Object>[] | undefined
        if (nodes !== undefined && nodes.length > 0) {
          const arr: Object[] = []
          for (const nd of nodes) { arr.push([nd['id'], 0, 0, nd['scale'], nd['rotate'], 1] as Object) }
          applyNodeVisuals(JSON.stringify(arr))
          this.fieldTouchedTotal += nodes.length
        }
      } catch (e) {
        hilog.error(DOMAIN, TAG, 'APP_RT_FIELD_ERROR %{public}s', JSON.stringify(e) ?? '')
      }
    }
  }

  /** ★交互反馈探针（判据）：与 iOS interactionProbe / Android fieldProbe 同口径。 */
  interactionProbeJson(): string {
    const p: InteractionProbe = {
      press_styles: this.pressStyles.size, press_applied: this.pressAppliedCount,
      field_specs: this.fieldSpecs.size, field_ticks: this.fieldTickCount,
      field_nodes_touched: this.fieldTouchedTotal,
    };
    return JSON.stringify(p)
  }

  /** ★页面销毁时调（停定时器；防泄漏）。 */
  stop(): void {
    this.stopPumpLoop();
    if (this.animTimer >= 0) { clearInterval(this.animTimer); this.animTimer = -1; }
  }

  /** ★读数（判据/报告）：宿主侧真源 + native 会话真源**分开报**。 */
  statsJson(): string {
    // ★★★Dactyl 专项：并列报交互反馈读数（按下态/场跟手——与 iOS interactionProbe 同口径）
    const probe = this.interactionProbeJson();
    let native = '{}';
    try { native = hostAppAnimStats(); } catch (e) { native = '{"error":"stats 调用失败"}'; }
    const host: ZDriverStats = {
      pump_ticks: this.pumpTicks, pump_fired: this.pumpFired, pump_interval_ms: this.pumpIntervalMs,
      batch_frames: this.pumpFramesPerBatch, last_eval_ms: this.pumpLastEvalMs,
      anim_attaches: this.animAttaches, anim_ticks: this.animTicks, anim_applied: this.animAppliedTotal,
      anim_starts: this.animStarts, anim_active_last: this.animActiveLast,
    };
    const body: ZDriverStatsJson3 = { host: host, native: JSON.parse(native) as Record<string, Object>, probe: JSON.parse(probe) as Record<string, Object> };
    return JSON.stringify(body);
  }
}

/** 空按下态（= 还原该节点；ArkTS 禁裸 {} 字面量 ⇒ 具名常量）。 */
const EMPTY_PRESS: Record<string, number> = {}

/** `#RRGGBB[AA]` → ARGB uint32（RenderNode 的 SetBackgroundColor 口径；与 C++ hexToArgb 同序）。 */
function hexToArgbNum(hex: string): number {
  const s = hex.startsWith('#') ? hex.slice(1) : hex
  if (s.length === 8) {
    const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16)
    const b = parseInt(s.slice(4, 6), 16), a = parseInt(s.slice(6, 8), 16)
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16)
    return (0xFF000000 | (r << 16) | (g << 8) | b) >>> 0
  }
  return 0
}
