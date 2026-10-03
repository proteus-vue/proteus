// hosts/android/bridge/entry-vapor.ts —— ★★★**真实 SFC → 编译产物 → 设备端实例化 → 自研渲染体系**
//
// 【这一条链路补的是什么（本仓 2026-10-01 核实的缺口）】
//   此前 Android 侧跑的是「**构建期**在 Node 里预实例化好的静态树」：
//     `gen-app4050-fixture.mjs` 的注释自己写着「Android 测试宿主没有 JS 引擎 ⇒
//      模板实例化无法在设备上跑」——**该前提已过期**（QuickJS 已在设备上跑着）；
//     而 `entry-batch.ts` 的注释写着「**不接 Vue**」（它只把节点表喂给适配器）。
//   ⇒ 真实 Vue 模板经编译器产出的两件产物（LayoutTemplate + 订阅表）**从未在设备上跑过**：
//     · 设备端**实例化**（模板 + 数据 → 可渲染的节点树）：从未；
//     · **订阅驱动的增量更新**（数据变 → 槽位求值 → 二进制指令 → 内核几何变化）：从未。
//   本入口就是那两段。设备端 JS **只产语义树与指令**，几何一律由宿主侧的 Rust 核心算
//   （与 iOS `entry-selfdraw.ts` 同一分工，也遵守「JS 不算任何几何」的既有纪律）。
//
// 【★分段与理由（为什么编译在构建期、实例化在设备端）】
//   编译器（`@proteus-vue/compiler`）依赖 `@babel/core` + `@vue/compiler-sfc`——
//   二者都**引用 Node API**（browser 构建里 `path`/`fs` 被 externalize，且代码里有 `Buffer`）
//   ⇒ **不适合进 QuickJS**（不是"不想"，是依赖形态不允许；如实标注，不假装端上能编译）。
//   ⇒ 分工：**构建期**跑编译器（产物是**纯 JSON**——`LayoutTemplate` + `SubscriptionTable`
//     都是可序列化声明，方案 §4.4 明确要求"产物可序列化、跨端禁 eval"）；
//     **设备端**跑实例化 + 订阅驱动更新（这两件只依赖 `@proteus-vue/slot-runtime`，
//     纯 TS 零 Node API，50KB → 完全可以进 bundle）。
//   ★这条分工正是产品形态：`proteus build` 编译、App 运行时实例化 + 更新。
//
// 【链路（全同步，铁律 A-02）】
//   ① 构建期：SFC → `buildLayoutTemplate()` + `buildVaporSubscriptions()` → `vapor-artifacts.json`
//      （见 `gen-vapor-fixture.mjs`；由构建路径自动刷新）
//   ② 设备端（本文件）：`instantiateTemplate(tpl, { read, table, registry })`
//      → `{ viewport, nodes, virtual }` → 宿主 `mount`（Rust 核心建树 + 算几何 + 下发绘制指令）
//   ③ 设备端更新：改数据 → `VaporRuntime`（订阅表 → 槽位求值 → **二进制指令流**）
//      → 宿主 `applyOps` → Rust 内核增量重排 ⇒ 回执给"哪些节点真的动了 + 重排范围"
//
// 【★诚实边界（写在这里，判据里逐条核）】
//   · 文本度量仍由宿主注入（内核不自研文本，Profile §L4）——本入口只报文本字面量；
//   · 单层 v-for（模板产物能力边界，见 `buildLayoutTemplate` 的诊断）；
//   · `virtual`（虚拟化描述）本入口**透传但不消费**——端上消费它是长列表批次的事；
//   · 指令流走 `encodeOps` 二进制（与 iOS `applyOps` 同一条），不经 JSON。
//
// 【产物】hosts/android/bridge/dist/bundle-vapor.js（IIFE，QuickJS 直接 eval）
// 【调用】Java：`__proteusVaporRun(argsJson)`（见 MainActivity 的 `vapor` 通路）
import { instantiateTemplate, ListRegistry, PropKeyTable, StringPool, SlotRuntime, VaporRuntime, decodeOps, evalExpr, OpCode } from '@proteus-vue/slot-runtime'
// ★★P2-3（2026-10-03）：事件派发语义（含修饰符 .stop/.self/.once）下沉到共享实现——
//   本桥不再内联"链序 + 修饰符"逻辑（iOS/Harmony 接同一份 ⇒ 不会漂移）
import { dispatchGesture, indexEventBindings, createDispatchState, directiveShouldPlay } from '@proteus-vue/slot-runtime'
import type { EventBinding, EventIndex, DispatchState } from '@proteus-vue/slot-runtime'
// ★★★A/B 对照（2026-10-01）：**同一份 SFC 的第二条路**——Vue 运行时渲染。
//   `abRender` 由构建期用 **@vue/compiler-sfc** 从同一份 SFC 编出（见 gen-vapor-fixture.mjs）。
import { createAppRenderer } from '@proteus-vue/renderer-app'
import { createSelfDrawAdapter } from '@proteus-vue/renderer-app/adapters/selfdraw'
import { ref, getCurrentInstance } from '@vue/runtime-core'
import { abRender } from './vapor-ab-render.generated'
import type { LayoutTemplate, SubscriptionTable } from '@proteus-vue/slot-runtime'

/* ══════════════════ 宿主桥（Java 经 JNI 注入；与 JsRenderHost 的三个入口同形） ══════════════════ */

interface VaporHost {
  /** 建树（首帧）：`{viewport, nodes}` → 宿主注入度量 + 核心建树 + 算几何 + 下发绘制指令 */
  mount(treeJson: string): string
  /** 二进制指令流（`number[]` JSON 形态——JNI 侧转 byte[]，见 JsRenderHost.applyOps） */
  applyOps(opsJson: string): string
  /**
   * ★★★**宿主动画入口**（P3-3 · `<Transition>` 桥接）：`{anims:[{nodeId,kind,from,to,durMs,curve}]}`
   *   → 内核 `proteus_layout_anim_start`（宿主每帧 tick、采样回绘制层）。
   *
   * 【为什么走宿主而不是 JS】内核动画是**平台无关的**（`anim.rs`），入口是 FFI；
   *   而"每帧推进"由各端的帧循环驱动（Android `Choreographer` / iOS `CADisplayLink` /
   *   鸿蒙帧回调）—— 那是**宿主职责**（与几何同纪律：JS 只产语义，平台负责驱动）。
   *   可选：宿主未实现 ⇒ 桥如实记 note（不静默把"过渡没播"当成"播了"）。
   */
  animStart?(animsJson: string): string
  /**
   * ★★**样式/文本增量补丁**（B 路 / Vue 运行时的更新入口；2026-10-01 更新路径 A/B 新增宿主端口）：
   *   适配器 `takePatches()` 产出的 `[{id, style}]` → 宿主度量 → 内核 `update` → 变化集 → 增量指令。
   *   （形状与 iOS `selfdraw-scene.updatePatches`、Rust `StylePatch` 三处同形。）
   */
  updatePatches(patchesJson: string): string
  /** 核心几何读数（判据用：**从内核真源读**，不是从我们发下去的参数复述） */
  readRects(): string
  /** ★★绘制通道探针（读**宿主真源**：渐变/发光/遮罩/圆角/裁剪/描边建出来了没） */
  probeChannels(idsJson: string): string
  /**
   * ★★**注册手势回调**（交互闭环的反向通道：**宿主 → JS**）——传函数名，JS 侧注册后由
   *   宿主在"语义手势 + 命中节点"时回调 `__proteusVaporGesture(type, nodeId, chainJson)`。
   *   ★与其余入口的差别：那些是 JS→Java（同步取返回值）；这条是 Java→JS（宿主驱动），
   *     故用**注册函数名 + 全局回调**的形态（QuickJS 侧唯一可行的同步反向调用）。
   *   ★`chainJson`（2026-10-02 起）：冒泡链 `"[target, ...祖先]"`（自深到浅，内核 `bubble_chain` 语义）
   *     ——此前只传 `(type, nodeId)` ⇒ 祖先 handler 永不触发（链在最后一环被丢）。
   */
  onGesture?(jsCallbackName: string): string
  /** ★进程内注入一次 tap（判据驱动；真机 `adb input tap` 无权限——见宿主注释） */
  tapAt?(argsJson: string): string
  /** 手势探针（判据：手势真的到宿主了吗 / 点在哪） */
  probeGesture?(): string
  /** ★★**虚拟化挂载**（长列表：整树在内核、宿主只物化可见区）——`{viewport,nodes,rows}` */
  mountVirtual(treeJson: string): string
  /** ★★虚拟化滚动一帧：`{dy, capture}` → 核心给决策、宿主执行动作 */
  scrollRows(argsJson: string): string
}

declare const proteusHost: VaporHost

/* ══════════════════ 入参 ══════════════════ */

interface VaporArgs {
  viewport: { width: number; height: number }
  /** 编译产物（构建期产出的 JSON 串；必填）——`{tpl, table, sfc}` */
  artifacts: string
  /**
   * 模式：`'short'`（缺省）= 实例化 + 订阅驱动增量；
   *      `'list'` = **长列表虚拟化**（1000 行、行高 100px、30 下 + 30 上滚动）；
   *      `'ab'` = 同一份 SFC 的 Vapor vs Vue 运行时对照；
   *      `'stress'` = **六端 SFC 压力夹具**（examples/pages/consistency-stress.vue 的编译产物，
   *                  数据用产物内嵌快照——见 runStress）。
   */
  mode?: 'short' | 'list' | 'ab' | 'stress'
  /** 行数（覆盖产物里的首行数据；短列表缺省 8 / 长列表缺省 1000） */
  rows?: number
  /** 增量更新轮数（每轮改一行文本 + 一行宽度 ⇒ 走订阅表 → 指令流） */
  updates?: number
  /**
   * ★★★**逻辑单位 → 物理像素的密度系数**（2026-10-02 实测抓出的真缺陷修复）。
   *
   * 【为什么必须有】SFC 的 px 是**逻辑单位**（与 Web CSS px / iOS pt / MP 逻辑 px 同义），
   *   而 Android 宿主按**物理像素** 1:1 绘制 ⇒ 不换算时锚块 80px（其它端 130~240px）、
   *   内容只占屏 22%（其它端 91~96%）——用户目视直接看出来的差异。
   * 【调用方】`StressSfcActivity` 传 `dm.density`（本机 3.0）；其余模式不传（缺省 1 = 既有行为零变化）。
   */
  scale?: number
}

/** 长列表（虚拟化）报告 */
interface VaporListReport {
  ok: boolean
  error?: string
  tpl_nodes: number
  sub_l1: number
  inst_nodes: number
  inst_rows: number
  inst_allocated_ids: number
  mount_ms: number
  row_count: number
  row_pitch: number
  /** ★物化有界：存活行 / 存活指令（**与滚动距离无关**是核心断言） */
  rows_live_first: number
  cmds_live_first: number
  /** 30 下滚动：物化总数增量（应**有界**——每帧新物化的行数 = 新进视野的行数） */
  down_frames: number
  down_built_delta: number
  /** 30 上滚动（回顶） */
  up_frames: number
  up_built_delta: number
  /** 滚动过程的读数轨迹（每 10 帧采一次：存活行/指令/已物化总数——"有界"的证据） */
  trail: Array<{ f: number; scroll: number; live: number; cmds: number; built: number }>
  /** 部分帧的签名差异（"真的动了"） */
  moved_diff_pct: number
  /** 回顶后与顶部签名的差异（**应 ≈ 0 = 恒等**：虚拟化没有累积漂移） */
  back_top_diff_pct: number
  /** 最后一帧的 scroll_y / 复用的行帧累计 */
  final_scroll: number
  row_frames_total: number
  built_total: number
  released_total: number
  uninstantiated_slots: number
  notes: string[]
}

/**
 * ★★★**A/B 对照报告**（2026-10-01）：同一份 SFC，两条渲染路——
 *   · A = **Vapor**（编译产物：LayoutTemplate + 订阅表 → 实例化）
 *   · B = **Vue 运行时**（@vue/compiler-sfc 编出的 render 函数 → runtime-core → selfdraw 适配器）
 * 判据：**两条路的树规模与几何逐节点一致**（都把同一份语义交给同一个内核算几何）、
 *   以及各自的成本（JS 侧建树耗时 / 宿主布局耗时）。
 *
 * 本档覆盖两段：
 *   · **mount 段**（首帧建树 + 几何逐节点对比 + 绘制通道 + 成本）；
 *   · **update 段**（2026-10-01 本轮新增）：同一份数据变更在两条路上的等价性——
 *     A 走**订阅增量**（改数据 → 触发源 → VaporRuntime → 二进制指令 → 内核），
 *     B 走 **Vue patch**（ref 变更 → 组件更新 → 适配器 `takePatches()` → 宿主 `updatePatches`）。
 *     两条路改的是同一语义（列表标题/宽度、标量宽度），更新后几何应仍逐节点一致。
 *
 * 【update 段的驱动方式（本仓实测的调度事实，写在类型旁边）】Vue 的组件更新是**微任务**调度——
 *   单次 eval 内改 `ref` 不会立刻产 patch。而 QuickJS 的 `eval_impl` **在每个 eval 之后泵微任务**
 *   （`pump_jobs_bounded`）⇒ 本入口按**两相位**驱动 B 路：
 *     相位①（本次 eval）：改 ref + `$forceUpdate` → 返回时宿主泵微任务 ⇒ patch 已入队；
 *     相位②（下一次 eval，由宿主逐相位调用）：`takePatches()` + `updatePatches` + 读数。
 *   A 路不需要相位拆分（`slotRt.flush()` 是确定性驱动）。
 */
/** 内核几何（判据读 `readRects` 的形状） */
interface RectLike { x: number; y: number; width: number; height: number }

interface AbReport {
  ok: boolean
  error?: string
  /** 两条路的节点数（B 减去适配器的 2 个包装节点：adapter.root + mount container） */
  nodes_a: number
  nodes_b: number
  /** 有文本的节点数（两条路各自数） */
  texts_a: number
  texts_b: number
  /** ★几何对比的**样本数**（A 侧语义文本节点数；=0 ⇒ 对比无效，判据必须红） */
  samples: number
  /** ★几何逐节点对比（同一树序）：最大绝对差（px，x/y/w/h 四量一起取最大） */
  max_delta: number
  /** 超出容差的节点数（容差 0.01px——两路喂给同一内核，理论应逐位相同） */
  mismatches: number
  /** 首个不一致节点的诊断（index / A 的 rect / B 的 rect） */
  first_mismatch: Record<string, unknown> | null
  /** 成本（ms）：A = 实例化+挂载；B = Vue mount + toRequest + 序列化 + 宿主挂载 */
  cost_a: { instantiate_ms: number; host_ms: number; total_ms: number }
  cost_b: { vue_ms: number; request_ms: number; serialize_ms: number; host_ms: number; total_ms: number }
  /** 宿主侧布局耗时（同一内核，两侧各自 mount 的读数） */
  layout_ms_a: number
  layout_ms_b: number
  /** 绘制通道一致性：两侧各探针的"非空通道数"（应相同） */
  channels_a: number
  channels_b: number
  /* ════════ ★★绘制通道逐项等价（2026-10-01 第二批：B 侧探针口径对齐） ════════ */
  /** 各通道签名（按通道分组的**排序多重集** + 逐节点组合签名 `node_sigs`）——
   *  不是"非空通道数相等"，而是**每条通道的值都相等**（同值同计数） */
  chan_a: Record<string, unknown> | null
  chan_b: Record<string, unknown> | null
  /** ★逐项等价结论（`JSON.stringify(chan_a) === JSON.stringify(chan_b)`） */
  chan_match: boolean
  /* ════════ ★★事件路径 A/B（2026-10-01 第二批：B 侧事件闭环） ════════ */
  /** A 路 tap：命中节点 / 冒泡链 / 逐跳派发（fired）+ 逐跳宽度位移 / handler / 指令回执 /
   *  内核几何前后 / 宽度位移（tap → hitTest → 反向调用 → handler → 订阅 → 指令 → 内核几何） */
  ev_a: { node: number; hit: number; chain: number[]; fired: number[]; fired_width_deltas: number[]; handler: string; ops_bytes: number; applied: number; relayout: number; changed_rects: number; before: RectLike | null; after: RectLike | null; width_delta: number; tap_ms: number } | null
  /** B 路 tap：适配器派发（chain/fired/errors）+ 逐跳宽度位移 + 补丁 + 宿主回执 + 内核几何前后
   *  （tap → hitTest → 反向调用 → Vue onClick → 同步 patch → 宿主 updatePatches → 内核几何） */
  ev_b: { node: number; hit: number; chain: number[]; fired: number[]; fired_width_deltas: number[]; errors: string[]; before: RectLike | null; after: RectLike | null; width_delta: number; patches: number; applied: number; changed_rects: number; text_layers: number; driver_ms: number } | null
  /** ★两路 tap 等价（同语义按钮：before 矩形一致 + 位移一致 + after 矩形一致） */
  ev_match: boolean
  /** tap 前 / 后两路按钮的**最大矩形差**（px；判据用——不等价时先看这个） */
  ev_before_delta: number
  ev_after_delta: number
  /* ════════════ ★★update 段（2026-10-01：同一份变更在两条路上的等价性） ════════════ */
  /** 实际跑了几轮更新（两侧轮数相同） */
  upd_rounds: number
  /** A 路每轮：变更规模（ops 字节）+ 内核回执（changed 数 / 重排范围）+ 耗时 + 本轮几何位移 */
  upd_a: Array<{ round: number; ops_bytes: number; ops_ms: number; apply_ms: number; changed_rects: number; relayout: number; layout_ms: number; text_synced: number; moved: number }>
  /** B 路每轮：适配器产了几条补丁 + 宿主回执（applied / 变更集 / 文本落层）+ 耗时 + 本轮几何位移 */
  upd_b: Array<{ round: number; patches: number; applied: number; changed_rects: number; relayout: number; host_ms: number; text_layers: number; moved: number; driver_ms: number }>
  /** ★更新后几何对比（与 mount 同一对齐口径）：样本数 / 最大差 / 不一致数 */
  upd_samples: number
  upd_max_delta: number
  upd_mismatches: number
  upd_first_mismatch: Record<string, unknown> | null
  /** ★每轮更新后两路的**几何真值**（readRects 读内核）——比对它们的逐轮演化 */
  upd_geom_rounds: Array<{ round: number; delta: number; mismatches: number; samples: number }>
  /** ★文本通道证据（两条路各自的回归锁）：A = 内核 text_updates 被宿主消费数；B = 文本落层数 */
  upd_a_text_synced: number
  upd_b_text_applied: number
  notes: string[]
}

interface VaporReport {
  ok: boolean
  error?: string
  // —— 编译产物段（构建期产出，这里只报规模——证明"产物真的来自编译器"）——
  tpl_nodes: number
  tpl_ok: boolean
  sub_l1: number
  sub_l0: number
  sub_l1_rate: number
  /** 订阅表里的源名（判据核对"行内槽位真的挂上了 list 源"） */
  sub_sources: string[]
  // —— 实例化段（★设备端跑）——
  inst_ms: number
  inst_nodes: number
  inst_reused_ids: number
  inst_allocated_ids: number
  inst_rows: number
  inst_values_filled: number
  inst_virtual_rows: number
  /** 实例树里 text 非空 / width 非空的节点数（"数据真的回填了"的机器证据） */
  inst_text_filled: number
  inst_width_filled: number
  /** ★★★P3-3（2026-10-03）：`<Transition>` 交给宿主的动画条数（>0 = 过渡真的被驱动） */
  transition_started: number
  /** ★★★P1-3（2026-10-03）：组件挂载数 / 组件展开产出的节点数（0 = 无组件或未注册） */
  component_mounts: number
  component_nodes: number
  /** 组件子节点的实测探针（文本 = props 值；宽度 = props 上行后的值） */
  component_kid_probe: { text?: string; width?: number; width_after?: number; rect_before?: number; rect_after?: number }
  /**
   * ★★★**插槽分发探针**（P1-3 插槽分发，2026-10-03）——独立挂载 slot 夹具树后的读数：
   *   · `texts`：内核树里的全部非空文本（判据核 SLOT-HDR/SLOT-DFT 在、后备前缀与孤儿前缀不在）；
   *   · `rects`：按探针节点 id 读的**内核几何**（内容节点真被布局——"树里有、内核没有"是另一类失效）；
   *   · `fills`：slotMounts 如实透传（filled/name/contentIds——分发记录）。
   */
  slot_probe: {
    texts: string[]
    rects: Array<{ id: number; width: number }>
    fills: Array<{ name: string; filled: boolean; contentIds: number[] }>
    /** 出口 marker 是否残留在给内核的树里（必须为 0——分发期语义不进最终树） */
    markers_left: number
  }
  /**
   * ★★★**emits 探针**（P1-3 emits，2026-10-03）——子组件 `$emit` → 父级 handler 的**真值读数**：
   *   · `emits`：逐条记录（事件名 / 载荷 / 是否路由到父级 / 父 handler 名）；
   *   · `parent_source_after`：父级 handler 跑完后**落点源**的值（`bumpTotal`）；
   *   · `geom_before` / `geom_after`：锚节点的**内核宽度**（emit 前后）——
   *     "handler 跑了"与"内核几何真变"是两件事（本仓反复踩过的两类失效），故两者都记。
   */
  emit_probe: {
    emits: Array<{ event: string; payload: unknown; routed: boolean; handler?: string }>
    parent_source_after: unknown
    geom_before: number
    geom_after: number
  }
  /**
   * ★★★**作用域插槽探针**（P1-3 作用域插槽，2026-10-03）——`#default="sp"` 内容按出口 props 求值：
   *   · `texts`：内核树里的文本（判据核 `cnt-7` 在——不是空串/`undefined` 字样）；
   *   · `anchor_width_field`：内容锚节点的**字段**宽度（作用域样式写进去的）；
   *   · `anchor_width_rect`：同一节点的**内核真值**宽度（"字段写了"与"内核认了"是两件事）。
   */
  scoped_probe: {
    texts: string[]
    anchor_id: number
    anchor_width_field: number
    anchor_width_rect: number
  }
  /**
   * ★★★**生命周期探针**（P1-3 @vue:mounted，2026-10-03）——挂载后钩子的**真值读数**：
   *   · bindings / ran_handler：产物里的绑定与真的跑了的 handler（"编了"与"跑了"是两件事）；
   *   · changed_sources：动作改了哪些源；ops_bytes / applied：指令链真的把变化送到内核；
   *   · geom_before / geom_after：锚节点**内核宽度**（"跑了"与"屏幕变了"是两件事）。
   */
  lifecycle_probe: {
    bindings: string[]
    ran_handler: string
    changed_sources: string[]
    ops_bytes: number
    applied: number
    anchor_id: number
    geom_before: number
    geom_after: number
  }
  /**
   * ★★★**动态组件探针**（P3 `<component :is>`，2026-10-03）——首帧解析的真值读数：
   *   · `texts`：内核树文本（判据核 DYNA 在 / DYNB 在（静态形态）/ 假值不留空壳）；
   *   · `mounts`：解析出的组件名（从挂载记录读——不猜 id 规律）；
   *   · `geom` / `dropped`：内容节点的**内核宽度**与摘除数（"树里有"与"内核认了"是两件事）。
   */
  dyn_probe: {
    texts: string[]
    mounts: string[]
    geom: Array<{ id: number; width: number }>
    dropped: number
    notes: string[]
  }
  /**
   * ★★★**宿主指令探针**（P3-5 `v-animate`，2026-10-03）——三段语义的**宿主回执**读数：
   *   · `nodes`：指令数据（name:preset:通道数——编译期解析的规格真的在）；
   *   · `rounds`：逐轮的 `animStart` started 计数（首评 truthy/值变化/假值——各自应当如何）；
   *   · `plays`：逐条记录（含 from→to 值，判据核"哪一轮播了哪个节点"）。
   */
  directive_probe: {
    nodes: Array<{ id: number; dirs: string[] }>
    rounds: Array<{ name: string; started: number }>
    plays: Array<{ nodeId: number; preset: string; started: number; fromValue: unknown; toValue: unknown }>
  }
  /**
   * ★★★**混排探针**（元素/文本混排，2026-10-03）——每段文本真的渲染了：
   *   · `texts`：内核树全部非空文本（判据核每一段都在，含插值求值结果）；
   *   · `leaves`：合成叶总数（与编译期对账——防少合成/多合成）；
   *   · `geom`：逐叶**内核宽度**（"树里有"与"内核认了"是两件事）。
   */
  mixed_probe: {
    texts: string[]
    leaves: number
    geom: Array<{ id: number; text: string; width: number }>
  }
  /** 模板里的过渡声明（`隐id:预设名`；判据区分"未声明"与"声明未驱动"） */
  tpl_transition: string[]
  /**
   * ★★**混合文本首帧探针**（P2-2，2026-10-03）：实例树里**多段拼接**节点的实际文本。
   *   判据核它等于「静态段 + 实参求值」的完整串（不是单字段/单个源值）——
   *   这是"段求值真的在设备上跑了"的证据（不依赖宿主回执）。
   */
  mix_text_probe: Array<{ id: number; text: string; statics: string[] }>
  /**
   * ★★**表达式能力探针**（P2-6~P2-9）：按**前缀锚定**的节点首帧文本
   *   （`pi-` / `mx-` / `jn-` / `oc-` / `vt-`）——判据核"求值真的落在文本上"。
   */
  expr_probe: Array<{ id: number; prefix: string; text: string }>
  /**
   * ★★**P2-5 门禁轮读数**（v-once 冻结 / v-memo 组门）：每轮的「应跳过 vs 实际发了几条指令」。
   *   判据核：expect_skip=true 的轮 **ops 必须为 0**（且不含目标文本）；
   *            expect_skip=false 的轮 **ops 必须 > 0**（证明链路没断——"跳过"是语义而非失效）。
   */
  gate_rounds: Array<{ name: string; ops: number; texts: string[]; expect_skip: boolean }>
  /**
   * ★★门禁轮的**节点级**读数（P2-5 判据要从"发没发"升级到"**发给谁**"）。
   *   为什么必须（本仓真机实测踩到的判据缺陷）：夹具里同时有 once 节点与**同源的对照节点**——
   *   对照节点的更新是**正确行为**，按"整批文本里有没有 onceVal 的新值"判会把正确行为判成红。
   *   ⇒ 逐节点记录：判据核「once 节点 id **不在**受更新集里」且「对照节点 id **在**」。
   */
  gate_text_nodes: Array<{ name: string; entries: Array<{ nodeId: number; text: string }> }>
  /** ★once / memo 的**节点 id**（判据按 id 精确核对；-1 = 本端无该夹具） */
  once_node_id: number
  memo_node_id: number
  /**
   * ★★**更新后的文本串**（P2-2 第二半）：逐轮记录内核回执 `text_probe.text`。
   *   混合文本更新若不完整（丢静态段）⇒ 这里的串会缺前缀（判据核 `·` 仍在）。
   */
  text_probe_rounds: string[]
  // —— 渲染段（宿主侧读数，回执）——
  mount_ms: number
  mount_nodes: number
  host_layout_ms?: number
  host_cmds?: number
  // —— 增量段（订阅驱动 → 指令流 → 内核几何）——
  updates_run: number
  ops_bytes: number
  ops_ms: number
  apply_ms: number
  /** ★文本同步累计（回归锁：内核 text_updates 必须被宿主消费——本批修的缺陷） */
  text_synced_total: number
  /** 每轮：改了哪一行 / 内核报的变更集大小 / 重排范围（几何真的动了吗） */
  update_evidence: Array<{ round: number; row: number; ops: number; changed_rects: number; relayout: number; text_synced: number }>
  /** 首轮前后**几何真值对比**（readRects 读内核真源：目标行节点宽度应变） */
  geom_probe: Array<{ id: number; before: number; after: number }>
  /** ★★绘制通道探针（逐通道：读宿主真源，不是复述我们发下去的参数） */
  channels: Array<Record<string, unknown>>
  /* ── ★★交互闭环（2026-10-01）：事件 → 回调 → 改数据 → 订阅 → 指令 → 内核 ── */
  /** 编译产物里的事件绑定数 / handler 数 */
  ev_bindings: number
  ev_handlers: number
  /** ★P2-3：带**语义修饰符**（.stop/.self/.once）的绑定数——>0 时判据核「修饰符真的进了产物」 */
  ev_modifiers: number
  /** 注入的 tap 次数（本判据夹具体验：点"计数按钮"与"宽度按钮"各一次） */
  taps: number
  /** 每次 tap 的逐帧读数：命中节点 / 冒泡链 / 逐跳派发 / handler 跑了吗 / 源变化 / 内核变更集 / 几何真值 */
  tap_evidence: Array<{
    tap: number
    hit: number
    /** ★冒泡链（内核给的：target 自身 + 全部祖先，自深到浅）——2026-10-02 起随回调记录 */
    chain: number[]
    /** ★链上**真的跑了 handler** 的节点（≥2 即冒泡到祖先——判据"链没断"的机器证据） */
    fired: number[]
    handler: string
    source_after: unknown
    /** ★P2-3：本跳是否被 `.stop` 终止冒泡（修饰符真的生效的证据） */
    stopped?: boolean
    /** ★P2-3：因 `.self` 被挡下的节点（诊断用） */
    skipped_self?: number[]
    ops: number
    changed_rects: number
    geom_before: number
    geom_after: number
    /** ★tap 前后**内核几何真源**里真的变了的节点 id（"点一下屏幕真的变了"的证据） */
    geom_diff_ids: number[]
  }>
  // —— 观测 ——
  uninstantiated_slots: number
  notes: string[]
}

/** 生成 N 行数据（行内绑定 `item.w` / `item.title` 都覆盖到） */
function makeData(rows: number): Record<string, unknown> {
  return {
    list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 40 + (i % 5) * 12, title: `row ${i + 1}` })),
    // ★与夹具 script 的 `ref(120)` 一致：**初始数据必须给全**，否则 `:width="boxW"` 首帧是 0，
    //   tap 后变 30 的"对比基线"是零宽（几何差异虽真但语义不清——数据与声明要对齐）
    boxW: 120,
    // ★★冒泡锚（2026-10-02）：按钮外层容器的宽度源——容器上的 `@click="padW += 5"`
    //   是**祖先 handler**：tap 链 [按钮, 容器, root] 上两跳都要跑（判据核"链没断"）
    padW: 300,
    // ★★P2-3 修饰符夹具（2026-10-03）：内层 `@click.stop` 的宽度源 + 外层（无修饰）的宽度源
    //   ——判据 ⑨ 核"点了内层，**外层 handler 不许跑**"（.stop 真的终止了冒泡）
    stopOuterW: 300,
    stopInnerW: 120,
    // ★★P2-5 夹具（2026-10-03）：once 冻结 / memo 组门——判据 ⑪ 用（见 runShort 的更新轮）
    onceVal: 1,
    memoDep: 0,
    memoVal: 1,
    // ★★P2-6~P2-9 夹具（2026-10-03）：表达式能力（判据 ⑫ 核首帧文本）
    exprA: 3,
    exprArr: ['a', 'b'],
    exprObj: { inner: 'ok' },
    // ★P3-3 夹具：初始**不可见** ⇒ 判据里改 true ⇒ 触发入场过渡（见 drainTransitions）
    trVisible: false,
    // ★★★P1-3 夹具（组件 props 源——判据改它们验"父改 ⇒ 子更新"）
    kidLabel: 'k0',
    kidLabelW: 40,
    tapCount: 0,
    // ★★★P1-3 emits（2026-10-03）：子组件 @bump 的父级落点源（判据核"子 emit ⇒ 父 handler ⇒ 几何"）
    bumpTotal: 0,
    // ★★★P1-3 生命周期（2026-10-03）：@vue:mounted 动作的落点源（初值 0 ⇒ 挂载后变 250）
    lifeW: 0,
  }
}

/** 主入口（全同步——铁律 A-02；本入口不依赖微任务：`SlotRuntime.flush()` 是确定性驱动） */
export function __proteusVaporRun(argsJson: string): string {
  const args = JSON.parse(argsJson) as VaporArgs
  if (args.mode === 'list') return runVirtualList(args)
  if (args.mode === 'ab') return runAb(args)
  if (args.mode === 'stress') return runStress(args)
  return runShort(args)
}

/**
 * ★★★**六端 SFC 压力夹具渲染**（2026-10-02）——渲染 `examples/pages/consistency-stress.vue`
 *   的编译产物（`vapor-stress-artifacts.json`：LayoutTemplate + 订阅表 + **数据快照**）。
 *
 * 【与 runShort 的差别（为什么单独一个模式）】
 *   · runShort 用 `makeData(rows)` 的**合成数据**（行宽公式 40+(i%5)*12 / 标题 'row N'）；
 *     本模式用 `artifacts.data`——**从 SFC script 抽出的真实快照**（构建期 extractStressData）。
 *   · runShort 的夹具 SFC 是生成器里的内嵌字符串；本模式的 SFC 是 **examples 里的真实页面**
 *     （与 Web/MP 端跑的是同一个文件）。
 *   ⇒ 本模式产出的是"一份源码六端渲染"里**移动端的渲染**（另一条链是 Web/MP 的编译器）。
 *
 * 【报告口径】只报**渲染证据**（节点数 / 文本数 / 宿主几何耗时 / 绘制采样 / 通道），
 *   不做 A/B（那由 runAb + vapor-artifacts 承担）——本模式的判据在**截图侧**（六端像素对比）。
 */
function runStress(args: VaporArgs): string {
  const notes: string[] = []
  interface StressReport {
    ok: boolean
    error?: string
    src?: string
    tpl_nodes: number
    sub_l1: number
    inst_nodes: number
    inst_texts: number
    inst_rows: number
    data_rows: number
    mount_ms: number
    host_layout_ms: number
    host_measure_ms: number
    host_cmds: number
    painted_samples: number
    painted_colors: number
    viewport: string
    first_node_style: Record<string, unknown> | null
    anchor_rect: number[] | null
    notes: string[]
  }
  const rep: StressReport = {
    ok: false, tpl_nodes: 0, sub_l1: 0, inst_nodes: 0, inst_texts: 0, inst_rows: 0, data_rows: 0,
    mount_ms: 0, host_layout_ms: -1, host_measure_ms: -1, host_cmds: -1,
    painted_samples: -1, painted_colors: -1, viewport: '', first_node_style: null, anchor_rect: null,
    notes,
  }
  try {
    const artifacts = JSON.parse(args.artifacts) as {
      tpl: LayoutTemplate
      table: SubscriptionTable
      sfc: string
      data?: Record<string, unknown>
      /** ★★★P1-3（2026-10-03）：组件注册表（子组件编译产物——键名与生成器**必须一致**） */
      components?: Record<string, { tpl: LayoutTemplate; table: SubscriptionTable; data?: Record<string, unknown> }>
    }
    if (!artifacts.tpl.ok) {
      rep.error = '模板不可用（构建期诊断）'
      return JSON.stringify(rep)
    }
    rep.tpl_nodes = artifacts.tpl.nodes.length
    rep.sub_l1 = artifacts.table.stats.l1
    const data = (artifacts.data ?? {}) as Record<string, unknown>
    const listArr = Array.isArray(data.list) ? (data.list as unknown[]) : []
    rep.data_rows = listArr.length
    rep.src = 'examples/pages/consistency-stress.vue'

    // ── 实例化（同一份模板 + 同一份数据快照）──
    //
    // ★★★单位换算位置（2026-10-02 实测两轮收敛）：**不在这里**（JS 侧只改模板静态 style），
    //   而在宿主的 `VaporRenderHost.setLengthScale`（Java）——因为 **动态绑定的值
    //   （`:width="item.w"` → 求值器 → SET_STYLE）不经过模板字典**：第一版在 JS 侧缩放，
    //   实测 chip 高被缩放（96=32×3 ✅）而**宽没缩放**（40，应 120）。
    //   ⇒ 缩放统一放宿主的 `coreNodes()`（**所有几何进内核的必经点**，覆盖静态+动态全部路径）。
    //   ★viewport 同理：由宿主按 scale 换算（Java 侧 setLengthScale 前调 setViewportScale——
    //     见 StressSfcActivity 的调用序）。
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()
    const t0 = Date.now()
    const inst = instantiateTemplate(artifacts.tpl, {
      viewport: args.viewport,
      read,
      table: artifacts.table,
      registry,
    })
    rep.mount_ms = Date.now() - t0
    rep.inst_nodes = inst.nodes.length
    rep.inst_rows = inst.virtual?.rows.length ?? 0
    rep.inst_texts = inst.nodes.filter((n) => typeof (n as { text?: unknown }).text === 'string'
      && String((n as { text?: unknown }).text).length > 0).length
    // 首节点样式 + 锚点几何（诊断：确认渲染的是 SFC 的样式而非默认值）
    const first = inst.nodes[0] as unknown as Record<string, unknown>
    rep.first_node_style = (first?.style as Record<string, unknown>) ?? null
    rep.viewport = `${args.viewport.width}x${args.viewport.height}`

    // ── 宿主 mount（Rust 内核 + 指令 + 上屏）──
    const mountOut = JSON.parse(
      proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes })),
    ) as {
      ok?: boolean
      error?: string
      layout_ms?: number
      measure_ms?: number
      cmds?: number
      painted_samples?: number
      painted_colors?: number
    }
    if (mountOut.ok !== true) {
      rep.error = '宿主 mount 失败：' + (mountOut.error ?? '')
      return JSON.stringify(rep)
    }
    rep.host_layout_ms = mountOut.layout_ms ?? -1
    rep.host_measure_ms = mountOut.measure_ms ?? -1
    rep.host_cmds = mountOut.cmds ?? -1
    rep.painted_samples = mountOut.painted_samples ?? -1
    rep.painted_colors = mountOut.painted_colors ?? -1

    // 锚点节点矩形（id=1 = stress-anchor；截图侧的锚定归一可与之交叉验证）
    const anchorRect = readRectsByOrder([1])
    rep.anchor_rect = anchorRect.length > 0
      ? [anchorRect[0]!.x, anchorRect[0]!.y, anchorRect[0]!.width, anchorRect[0]!.height]
      : null

    rep.ok = rep.inst_nodes > 0 && rep.data_rows > 0
    notes.push('六端 SFC 压力夹具（Android）：渲染 examples/pages/consistency-stress.vue 的编译产物')
    notes.push('数据来自构建期快照（extractStressData）——与 Web/MP 端 script 字面量同源')
    return JSON.stringify(rep)
  } catch (e) {
    rep.error = String((e as Error)?.message ?? e)
    return JSON.stringify(rep)
  }
}

/**
 * ★★★**A/B 对照**：同一份 SFC 两条路各自建树 → 逐节点比几何。
 *
 * 【为什么这是"Vapor 能替换 Vue 运行时"的关键证据】此前所有读数都只证明"Vapor 这条路能跑"，
 *   但没有回答"它跑出来的东西**与 Vue 运行时是否等价**"。本模式把两条路放在同一台设备、
 *   同一份 SFC、同一个内核上跑，**逐节点比几何**（树序对齐）——
 *   等价性从"感觉差不多"变成"最大绝对差 0.xx px"。
 */
function runAb(args: VaporArgs): string {
  const t = (): number => Date.now()
  const rows = Math.max(1, args.rows ?? 8)
  const notes: string[] = []
  const rep: AbReport = {
    ok: false,
    nodes_a: 0, nodes_b: 0, texts_a: 0, texts_b: 0,
    samples: 0, max_delta: -1, mismatches: -1, first_mismatch: null,
    cost_a: { instantiate_ms: 0, host_ms: 0, total_ms: 0 },
    cost_b: { vue_ms: 0, request_ms: 0, serialize_ms: 0, host_ms: 0, total_ms: 0 },
    layout_ms_a: -1, layout_ms_b: -1,
    channels_a: -1, channels_b: -1,
    chan_a: null, chan_b: null, chan_match: false,
    ev_a: null, ev_b: null, ev_match: false, ev_before_delta: -1, ev_after_delta: -1,
    upd_rounds: 0, upd_a: [], upd_b: [],
    upd_samples: 0, upd_max_delta: -1, upd_mismatches: -1, upd_first_mismatch: null,
    upd_geom_rounds: [], upd_a_text_synced: 0, upd_b_text_applied: 0,
    notes,
  }
  try {
    const artifacts = JSON.parse(args.artifacts) as {
      tpl: LayoutTemplate
      table: SubscriptionTable
      sfc: string
      /** ★事件绑定 + handler 动作表（2026-10-01 第二批：事件路径 A/B 要用——纯数据，编译期产物）
       *  ★P2-3（2026-10-03）：绑定可带语义修饰符（stop/self/once）——见 slot-runtime 的 EventBinding */
      events?: EventBinding[]
      handlers?: Record<string, Array<{ op: string; source: string; program: unknown }>>
    }
    if (!artifacts.tpl.ok) {
      rep.error = '模板不可用（构建期诊断）'
      return JSON.stringify(rep)
    }
    // ★★数据给**两份独立副本**（2026-10-01 更新路径 A/B）：两条路从同一初值出发、
    //   各自承受同一序列的变更——比的是「同语义、两条路」，而不是「谁先改了共享数据」。
    //   ★为什么不在模块级 `abData` 上直接改：同一进程重复跑 `vaporAb` 时，上一轮的改动
    //     会污染下一轮的初值（本仓"装置污染读数"同族；副本把这个问题从根上消掉）。
    const data = JSON.parse(JSON.stringify(abData)) as Record<string, unknown>
    const dataB = JSON.parse(JSON.stringify(abData)) as Record<string, unknown>
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()

    /* ── 路 A：Vapor（编译产物 → 实例化 → 宿主） ── */
    const tA0 = t()
    const inst = instantiateTemplate(artifacts.tpl, { viewport: args.viewport, read, table: artifacts.table, registry })
    /** ★几何对比用：A 侧的**语义文本节点**（Vapor 里文本折在元素上，故就是带 text 的节点） */
    const textNodesAForAb = (inst.nodes as unknown as Array<Record<string, unknown>>)
      .filter((n) => typeof n.text === 'string' && n.text.length > 0)
      .map((n) => ({ id: Number(n.id), text: String(n.text) }))
    const tA1 = t()
    rep.nodes_a = inst.nodes.length
    rep.texts_a = inst.nodes.filter((n) => typeof n.text === 'string' && n.text.length > 0).length
    const mountA = JSON.parse(
      proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes })),
    ) as { ok?: boolean; layout_ms?: number; error?: string }
    const tA2 = t()
    rep.cost_a = { instantiate_ms: tA1 - tA0, host_ms: tA2 - tA1, total_ms: tA2 - tA0 }
    rep.layout_ms_a = mountA.layout_ms ?? -1
    if (mountA.ok !== true) {
      rep.error = 'A 路 mount 失败：' + (mountA.error ?? '')
      return JSON.stringify(rep)
    }
    // 读 A 的几何（**先读**——B 路 mount 会 destroy 掉 A 的句柄）
    // ★几何对比口径：只比**语义文本节点**（A 侧就是那些带 text 的节点；见对齐注释）
    const semIdsA = textNodesAForAb.map((n) => n.id)
    const rectsA = readRectsByOrder(semIdsA)
    // A 的绘制通道探针（同样先读）——★第二批：探**全部节点**且保留逐通道值（逐项对照用）
    const chARaw = probeChannelsRaw(inst.nodes.map((n) => Number(n.id)))

    /* ═══════════ ★★update 段 · 路 A：订阅驱动的增量（放在 B mount 之前） ═══════════
     *
     * 【为什么 A 的更新必须在 B mount 之前跑】宿主只有**一个句柄**：B 的 mount 会 destroy
     *   掉 A 的句柄（与 mount 几何"先读"是同一约束）。⇒ 顺序 = A mount/更新 → B mount/更新。
     *
     * 【和 runShort 的更新循环同一条链】改数据 → 触发订阅源 → `VaporRuntime.relink` →
     *   `slotRt.flush()`（确定性提交）→ 二进制指令 → 宿主 `applyOps` → 内核增量重排。
     *   逐轮读数（ops 字节 / 内核 changed 集 / 重排范围 / 文本同步）+ 逐轮几何真值快照。
     */
    const updRounds = Math.max(0, args.updates ?? 2)
    const updA: AbReport['upd_a'] = []
    const geomsA: Array<ReturnType<typeof readRectsByOrder>> = []
    // ★★A 路运行时**总建**（2026-10-01 第二批）：此前建在 `if (updRounds > 0)` 内，
    //   而**事件路径**（tap → handler → 订阅 → 指令）同样要用它 ⇒ updRounds=0 时 tap 无运行时可用。
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const captured: Uint8Array[] = []
    // ★sink 捕获字节；flush() 是**确定性驱动**（runShort 同款：微任务调度器在 eval 里不排空）
    const slotRt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes))
    const evals = VaporRuntime.buildEvaluators(artifacts.table.evaluators)
    const vapor = new VaporRuntime(artifacts.table, slotRt, evals, registry)
    const ctx = { read }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)          // 首轮值（与 mount 相同 ⇒ 指令无净变化）
    slotRt.flush()
    captured.length = 0        // ★丢掉首帧指令（初始值已由 instantiateTemplate 回填进树）
    if (updRounds > 0) {
      for (let r = 0; r < updRounds; r++) {
        const list = data.list as Array<{ id: number; w: number; title: string }>
        if (!Array.isArray(list) || list.length === 0) break
        const at = r % Math.min(list.length, rows)
        // 改数据：行内两处（文本 + 宽度）+ 标量源一处（boxW）——与 B 路逐字同语义
        list[at]!.title = `upd ${r}`
        list[at]!.w = 60 + (r % 4) * 20
        data.boxW = 150 + 30 * r

        const to = t()
        triggers.get('list')?.()
        triggers.get('boxW')?.()
        slotRt.flush()
        const opsMs = t() - to
        const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
        captured.length = 0
        let changedN = 0
        let relayout = -1
        let tsyn = 0
        let layoutMs = -1
        const ta = t()
        if (payload.length > 0) {
          const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload)))) as {
            ok?: boolean; applied?: number; changed?: number; rects?: Record<string, unknown>
            relayout?: number; text_synced?: number; layout_ms?: number; error?: string
            unsupported?: unknown[]
          }
          if (ao.ok === true) {
            changedN = ao.rects ? Object.keys(ao.rects).length : (ao.changed ?? 0)
            relayout = ao.relayout ?? -1
            tsyn = ao.text_synced ?? 0
            layoutMs = ao.layout_ms ?? -1
          }
          // ★内核拒收明细透传（宿主已读；JS 侧记 note——"指令被拒"不得伪装成"指令生效"）
          if (ao.unsupported && ao.unsupported.length > 0) {
            notes.push(`A 轮 ${r}：内核拒收 ${ao.unsupported.length} 条：${JSON.stringify(ao.unsupported).slice(0, 200)}`)
          }
        }
        const applyMs = t() - ta
        const geom = readRectsByOrder(semIdsA)
        geomsA.push(geom)
        const prevGeom = r === 0 ? rectsA : geomsA[r - 1]!
        updA.push({
          round: r, ops_bytes: payload.length, ops_ms: opsMs, apply_ms: applyMs,
          changed_rects: changedN, relayout, layout_ms: layoutMs, text_synced: tsyn,
          moved: maxGeomDelta(prevGeom, geom),
        })
        rep.upd_a_text_synced += tsyn
      }
    }

    /* ═══════════ ★★事件路径 · 路 A：tap → handler → 订阅 → 指令 → 内核几何 ═══════════
     *
     * 【为什么在 B mount 之前】宿主只有**一个句柄**：B 的 mount 会 destroy 掉 A 的句柄
     *   （与 mount 几何、"A 更新先跑"是同一条约束）。A 的 tap 必须打在 A 的树上。
     *
     * 【链路（与 runShort 的交互闭环同一套环节；数据用 runAb 的独立副本）】
     *   `proteusHost.tapAt`（宿主注入真 MotionEvent）→ 内核 `hitTest` 命中节点
     *   → `GestureListener` → JNI 反向调用 → `globalThis.__proteusVaporGesture`
     *   → 编译产物的动作表 `handlers` → 改数据 → 订阅触发 → `relink` → `flush`
     *   → `applyOps` → 内核重排 ⇒ **几何真值变**（判据读 readRects，不信任何自报）。
     */
    const harnessEvents = artifacts.events ?? []
    const harnessHandlers = artifacts.handlers ?? {}
    // ★P2-3：索引 + `.once` 状态走共享实现（runShort 用的同一套语义）
    const byNodeEvent = indexEventBindings(harnessEvents)
    const dispatchStateA = createDispatchState()
    /**
     * 全局反向通道名（C 侧**单一注册名**：`g_gesture_cb`）。
     * ★A/B 两相位**各自替换全局函数**——`nativeDispatchGesture` 每次按名字取当前函数，
     *   故"替换即切换相位"（不需要两次注册，也不能两次注册）。
     */
    const GESTURE_CB = '__proteusVaporGesture'
    if (typeof proteusHost.onGesture === 'function') proteusHost.onGesture(GESTURE_CB)
    /** 跑一个动作表（与 runShort 的 `runHandler` 同一形态：先算后写，顺序语义保留） */
    const runActions = (name: string, store: Record<string, unknown>): boolean => {
      const acts = harnessHandlers[name]
      if (!acts) return false
      for (const a of acts) {
        const v = evalExpr(a.program as never, { read: (n: string) => store[n] } as never)
        const cur = store[a.source]
        if (a.op === 'set') {
          store[a.source] = v
        } else {
          const base = typeof cur === 'number' && Number.isFinite(cur) ? cur : 0
          const delta = typeof v === 'number' && Number.isFinite(v) ? v : 0
          store[a.source] = base + delta
        }
      }
      return true
    }
    const readRectOf = (id: number): RectLike | null => {
      try {
        const r = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, RectLike> }
        return r.rects?.[String(id)] ?? null
      } catch {
        return null
      }
    }
    /** 内核几何全表（判据用：tap 前后各读一次，逐 id 比"谁真的动了"）——一次跨边界调用 */
    const readRectsAll = (): Record<string, RectLike> => {
      try {
        const r = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, RectLike> }
        return r.rects ?? {}
      } catch {
        return {}
      }
    }
    /** 两个矩形间的最大绝对差（px）；任一为空 ⇒ -1（**不是 0**——判据必须能区分"没读到"与"一致"） */
    const rectDelta = (a: RectLike | null, b: RectLike | null): number => {
      if (!a || !b) return -1
      return Math.round(Math.max(
        Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height),
      ) * 1000) / 1000
    }
    // ★按钮锚点：与 B 路**同一颜色锚**（`#2f6fed` 唯一）——A/B 都点"同一个盒子"的中心。
    //   为什么不取 events[0]：夹具现在有**两个** tap 绑定（按钮 + 外层容器），而"第一个事件"
    //   是容器（元素序在前）⇒ 取它会把对照锚点错位（两路比的就不是同一个按钮了）。
    const btnANode = (inst.nodes as unknown as Array<Record<string, unknown>>)
      .find((n) => n.backgroundColor === '#2f6fed')
    const tapBtnA = btnANode ? { nodeId: Number(btnANode.id) } : undefined
    if (tapBtnA && typeof proteusHost.tapAt === 'function') {
      const av: NonNullable<AbReport['ev_a']> = {
        node: tapBtnA.nodeId, hit: -1, chain: [], fired: [], fired_width_deltas: [], handler: '', ops_bytes: 0,
        applied: -1, relayout: -1, changed_rects: 0, before: null, after: null, width_delta: 0, tap_ms: 0,
      }
      ;(globalThis as unknown as Record<string, unknown>)[GESTURE_CB] = (type: string, nodeId: number, chainJson?: string): string => {
        // ★沿**内核给的冒泡链**派发（2026-10-02：此前只看 target 本身 ⇒ 祖先 handler 永不触发）
        const chain = parseChain(chainJson, nodeId)
        const hit = dispatchChainA(chain, type, byNodeEvent, dispatchStateA, (h) => runActions(h, data))
        const handler = hit.handler
        if (!handler) return JSON.stringify({ ok: false, reason: `链 ${chain.join('>')} 上没有 ${type} 的 handler` })
        // 触发全部订阅源（本夹具 tap 改 boxW；全触发 = "全量重算 + diff"，正确性优先）
        for (const [, cb] of triggers) cb()
        vapor.relink(ctx)
        slotRt.flush()
        const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
        captured.length = 0
        let applied = -1
        let relayout = -1
        let changed = 0
        if (payload.length > 0) {
          const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload)))) as {
            ok?: boolean; applied?: number; relayout?: number; relayout_count?: number
            rects?: Record<string, unknown>; error?: string
          }
          applied = ao.ok ? (ao.applied ?? -1) : -2
          relayout = ao.relayout_count ?? ao.relayout ?? -1
          changed = ao.rects ? Object.keys(ao.rects).length : 0
        }
        av.handler = handler
        av.fired = hit.fired
        av.chain = chain
        av.ops_bytes = payload.length
        av.applied = applied
        av.relayout = relayout
        av.changed_rects = changed
        return JSON.stringify({ ok: true, handler, fired: hit.fired, ops: payload.length, applied, relayout, changed_rects: changed })
      }
      av.before = readRectOf(tapBtnA.nodeId)
      const rectsAllBeforeA = readRectsAll()
      const tTap = t()
      if (av.before) {
        const c = { x: av.before.x + av.before.width / 2, y: av.before.y + av.before.height / 2 }
        const tp = JSON.parse(proteusHost.tapAt(JSON.stringify(c))) as {
          ok?: boolean; gestures_fired?: number; last?: { target?: number }
        }
        // ★★本次注入**真的触发了手势**才认 last（2026-10-02 实测抓出：第二次注入被
        //   GestureDetector 判成双击 ⇒ 无手势，而判据把上一次的陈旧探针读成新读数）
        if (tp.gestures_fired === 1) {
          av.hit = tp.last?.target ?? -1
        } else {
          notes.push(`★A 路 tap 未触发手势（gestures_fired=${tp.gestures_fired ?? '缺失'}）——hit 读数不可信`)
        }
      }
      av.tap_ms = t() - tTap
      av.after = readRectOf(tapBtnA.nodeId)
      if (av.before && av.after) av.width_delta = Math.round((av.after.width - av.before.width) * 1000) / 1000
      // ★逐跳宽度位移（fired 顺序 = 链序，target 在前）——判据据此核"祖先 handler 真的改了祖先几何"
      const rectsAllAfterA = readRectsAll()
      av.fired_width_deltas = av.fired.map((id) => {
        const b = rectsAllBeforeA[String(id)]
        const a2 = rectsAllAfterA[String(id)]
        return b && a2 ? Math.round((a2.width - b.width) * 1000) / 1000 : -999
      })
      rep.ev_a = av
      if (av.hit !== tapBtnA.nodeId) {
        notes.push(`★A 路 tap 命中 ${av.hit} ≠ 事件节点 ${tapBtnA.nodeId}（hitTest 与事件绑定不一致）`)
      }
    }

    /* ── 路 B：Vue 运行时（官方 render → runtime-core → selfdraw 适配器） ── */
    const adapter = createSelfDrawAdapter()
    const renderer = createAppRenderer(adapter)
    const container = adapter.createElement('p-view')
    adapter.root.children.push(container)
    container.parent = adapter.root
    const abList = ref(dataB.list)
    const abBoxW = ref(dataB.boxW)
    // ★冒泡锚：容器宽度源（容器 `@click="padW += 5"` 的祖先 handler 改它）
    const abPadW = ref(dataB.padW)
    // ★P2-3 修饰符夹具（B 路同样要提供源——否则 Vue 渲染时 `stopOuterW` 未定义 ⇒
    //   该节点无宽度 ⇒ A/B 几何对比假红；夹具源必须两路对齐）
    const abStopOuterW = ref(dataB.stopOuterW)
    const abStopInnerW = ref(dataB.stopInnerW)
    // ★P2-5 夹具（同上：B 路也要提供源，否则 Vue 侧读到 undefined ⇒ 文本序列不对齐）
    const abOnceVal = ref(dataB.onceVal)
    const abMemoDep = ref(dataB.memoDep)
    const abMemoVal = ref(dataB.memoVal)
    // ★P2-6~P2-9：B 路也要提供（否则 Vue 侧读到 undefined ⇒ 文本序列不对齐）
    const abExprA = ref(dataB.exprA)
    const abExprArr = ref(dataB.exprArr)
    const abExprObj = ref(dataB.exprObj)
    // ★P3-3：B 路（Vue）也要给（否则 Vue 侧读到 undefined ⇒ 文本/几何序列不对齐）
    const abTrVisible = ref(dataB.trVisible)
    // ★P1-3 emits：B 路（Vue）也要给 `bumpTotal`——A/B 共享同一份 SFC 编译产物，
    //   B 侧读到 undefined ⇒ 锚节点几何按"无宽度"算 ⇒ A/B 几何对比假红（本仓已踩同族坑）。
    const abBumpTotal = ref(dataB.bumpTotal)
    // ★P1-3 生命周期：B 路（Vue）同样要给 `lifeW`（A/B 共享 SFC ⇒ 缺它 B 侧几何按 0 宽算 ⇒ 假红）
    const abLifeW = ref(dataB.lifeW)
    /**
     * ★★B 路更新的**同步驱动柄**（2026-10-01 更新路径 A/B）。
     *
     * 【为什么需要它】Vue 的组件更新走**微任务调度**（`queueJob` → `resolvedPromise.then(flushJobs)`）
     *   ⇒ 单次 eval 内改 `ref` 不会立刻产出 patch，而本入口是**全同步**的（铁律 A-02）。
     * 【为什么这是"同一套机制"而非绕过】`instance.update` 就是调度器排的那个 job 本体
     *   （Vue 3.5 源码：`instance.update = effect.run.bind(effect)`）——
     *   这里只是把"何时跑"从微任务改成**显式同步调用**，patch 链路（render → patch → 适配器）一字未改。
     * 【取实例】`getCurrentInstance()` 在 setup 里调用拿到组件内部实例（`update` 属性在
     *   `setupRenderEffect` 里赋值——本入口在 mount 之后才调它，时序安全）。
     */
    let abRootInst: { update?: () => void } | null = null
    const AbApp = {
      name: 'VaporAbApp',
      setup() {
        abRootInst = getCurrentInstance() as unknown as { update?: () => void }
        return {
          list: abList, boxW: abBoxW, padW: abPadW, stopOuterW: abStopOuterW, stopInnerW: abStopInnerW,
          onceVal: abOnceVal, memoDep: abMemoDep, memoVal: abMemoVal,
          exprA: abExprA, exprArr: abExprArr, exprObj: abExprObj, trVisible: abTrVisible,
          bumpTotal: abBumpTotal,
          lifeW: abLifeW,
        }
      },
      render: abRender,
    }
    const tB0 = t()
    renderer.createApp(AbApp as never).mount(container as never)
    const tB1 = t()
    const req = adapter.toRequest(args.viewport)
    const tB2 = t()
    const treeJson = JSON.stringify(req)
    const tB3 = t()
    const mountB = JSON.parse(proteusHost.mount(treeJson)) as { ok?: boolean; layout_ms?: number; error?: string }
    const tB4 = t()
    rep.cost_b = {
      vue_ms: tB1 - tB0,
      request_ms: tB2 - tB1,
      serialize_ms: tB3 - tB2,
      host_ms: tB4 - tB3,
      total_ms: tB4 - tB0,
    }
    rep.layout_ms_b = mountB.layout_ms ?? -1
    if (mountB.ok !== true) {
      rep.error = 'B 路 mount 失败：' + (mountB.error ?? '')
      return JSON.stringify(rep)
    }
    // ★★声明"宿主已与我对齐"（本仓实测的必需调用，不是可选优化）：挂载期 createElement/createText
    //   置了 `structuralChange` 并累积 `createdNodes`——不清掉的话**第一次 `takePatches()` 必返 null**
    //   （"结构变化"标志语义是"自上次取走以来"）⇒ B 路更新永远退化成全量，而更新对照看起来"没 patch"。
    //   （iOS `entry-bench` 的 Vue 通路在每次全量后都调它——同款约定。）
    adapter.markFullSync()

    /* ── 逐节点对比（**跳过 B 的 2 个包装节点**：adapter.root + mount container） ── */
    //   【为什么跳过】Vue 路的树多两层：`adapter.root`（适配器根）与 `container`（mount 挂载点）——
    //   那是**宿主集成形态**的一部分，不是应用树。⇒ B 取 slice(2)，与 A 的"应用根"对齐。
    // ★★对齐口径（**两轮实测修正，这是 A/B 最本质的一条**）：
    //   A（Vapor）与 B（Vue 运行时）的**树形不同**——Vapor 模板编译器把 `<p-text>文本</p-text>`
    //   折成**一个节点**（文本即元素的 text 属性）；而 Vue 运行时按标准 vnode 树建**两层**
    //   （`p-text` 元素 + 匿名文本子节点，且字体/颜色从父元素继承——见适配器 `fillSpec` 注释）。
    //   另有 B 侧的包装层（`adapter.root` + `container` + 组件 resolve 层）。
    //   ⇒ **绝不能按 index 硬对齐**（首版这么做过：25 vs 36，几何差 1040px 全是错位假象）。
    //   ⇒ 正解：**按"有文本的语义节点"对齐**——
    //     A 侧：所有 `text` 非空的节点（Vapor 里文本就在元素上）；
    //     B 侧：所有 `text` 非空的节点（Vue 里文本是匿名子节点，其父才是语义元素）。
    //     两边的语义元素 = 该文本节点自身（A）/ 其父（B）—— 几何应指向**同一个盒子**。
    //     ★校验：两边的**文本内容序列**必须逐一相同（内容不同 ⇒ 对齐本身就错了，先报出来）。
    const textNodesA = textNodesAForAb
    const textNodesBAll = (req.nodes as unknown as Array<Record<string, unknown>>).filter(
      (n) => typeof n.text === 'string' && n.text.length > 0,
    )
    // B 的语义元素 = 文本节点的父（Vue 的 `p-text` 元素）
    const parentIdOf = new Map<number, number | null>()
    for (const n of req.nodes as unknown as Array<Record<string, unknown>>) {
      parentIdOf.set(Number(n.id), (n.parentId ?? null) as number | null)
    }
    const semB = textNodesBAll
      .map((t) => {
        const pid = parentIdOf.get(Number(t.id)) ?? null
        const parent = pid !== null ? (req.nodes as unknown as Array<Record<string, unknown>>).find((x) => Number(x.id) === pid) : undefined
        return { text: String(t.text), nodeId: parent ? Number(parent.id) : Number(t.id) }
      })
    const seqA = textNodesA.map((n) => n.text)
    const seqB = semB.map((x) => x.text)
    const seqSame = seqA.length === seqB.length && seqA.every((t, i) => t === seqB[i] as never)
    if (!seqSame) {
      notes.push(`★★文本序列不同（对齐失效——先看这个）：A=${JSON.stringify(seqA.slice(0, 6))} · B=${JSON.stringify(seqB.slice(0, 6))}`)
    }
    // B 的**全树规模**（含包装与文本叶——与 A 的"全树"并列，如实各报各的）
    rep.nodes_b = req.nodes.length
    // ★语义对齐后的 id 列表（用于几何逐项对比——这才是"同一个盒子"）
    const semIdsB = semB.map((x) => x.nodeId)
    // 文本节点数（两条路各自数——B 的"有文本节点"就是前面筛出来的那批）
    rep.texts_b = textNodesBAll.length
    const rectsB = readRectsByOrder(semIdsB)
    // ★★B 侧绘制探针**取全树**（2026-10-01 第二批修正——此前探 `semIdsB`（文本节点）：
    //   而绘制声明（圆角/渐变/发光/裁剪/描边）在**其它节点**上 ⇒ 探到恒 0 个非空通道，
    //   被上一版判据如实标成"探针口径未对齐"。绘制属性与"是不是文本节点"无关：
    //   两侧都按**全树**探，才能逐通道对照（逐项等价见下面的 channelSig）。
    const chBRaw = probeChannelsRaw((req.nodes as unknown as Array<Record<string, unknown>>).map((x) => Number(x.id)))
    // ★诊断（判据缺读数时用它定位）：两路的树形态摘要
    if (rep.nodes_a !== rep.nodes_b || rep.texts_a !== rep.texts_b || true) {
      const fmt = (ns: Array<Record<string, unknown>>): string =>
        ns.slice(0, 40).map((n) => `${n.id}${n.parentId === null ? '' : '<' + String(n.parentId)}:${String(n.tag ?? '')}${typeof n.text === 'string' && n.text ? '(' + String(n.text).slice(0, 6) + ')' : ''}`).join(' ')
      notes.push('A 树: ' + fmt(inst.nodes as unknown as Array<Record<string, unknown>>))
      notes.push('B 树: ' + fmt(req.nodes as unknown as Array<Record<string, unknown>>))
      // 带样式键的摘要（看"多出来的节点到底是什么"）
      const fmt2 = (ns: Array<Record<string, unknown>>): string =>
        ns
          .slice(0, 40)
          .map((n) => {
            // ★读**请求树形态**（样式平铺在顶层——`InstantiatedNode` 与 `SelfDrawNodeSpec` 同形；
            //   首版读 `n.style` 恒空 ⇒ 诊断误导"样式全丢"）
            const keys = Object.keys(n).filter(
              (k) => !['id', 'parentId', 'text'].includes(k),
            )
            return `${n.id}<${n.parentId ?? '-'}[${keys.slice(0, 3).join(',')}${keys.length > 3 ? '…' : ''}]${typeof n.text === 'string' && n.text ? '{' + String(n.text).slice(0, 5) + '}' : ''}`
          })
          .join(' ')
      notes.push('A 明细: ' + fmt2(inst.nodes as unknown as Array<Record<string, unknown>>))
      notes.push('B 明细: ' + fmt2(req.nodes as unknown as Array<Record<string, unknown>>))
    }

    if (rep.nodes_a !== rep.nodes_b) {
      notes.push(`★节点数不同：A=${rep.nodes_a} · B=${rep.nodes_b}（树规模就不一致——先看这个）`)
    }
    const n = Math.min(rectsA.length, rectsB.length)
    let maxD = 0
    let mism = 0
    let first: Record<string, unknown> | null = null
    for (let i = 0; i < n; i++) {
      const a = rectsA[i]
      const b = rectsB[i]
      if (!a || !b) continue
      const d = Math.max(
        Math.abs(a.x - b.x), Math.abs(a.y - b.y),
        Math.abs(a.width - b.width), Math.abs(a.height - b.height),
      )
      if (d > maxD) maxD = d
      if (d > 0.01) {
        mism++
        if (!first) first = { index: i, id_a: a.id, id_b: b.id, rect_a: a, rect_b: b, delta: Math.round(d * 1000) / 1000 }
      }
    }
    rep.samples = n
    rep.max_delta = Math.round(maxD * 1000) / 1000
    rep.mismatches = mism
    rep.first_mismatch = first

    // ★★绘制通道：两侧"非空通道节点数" + **逐通道值签名**（排序多重集）——
    //   逐项等价的判据在判据脚本里按 chan_a/chan_b 的 JSON 相等性判（本档只如实报）。
    const sigA = channelSig(chARaw)
    const sigB = channelSig(chBRaw)
    const nonEmptyCount = (probes: Array<Record<string, unknown>>): number =>
      probes.filter((c) => {
        for (const k of CHANNEL_KEYS) {
          const v = c[k]
          if (v === undefined || v === null) continue
          if (typeof v === 'number' && v !== 0) return true
          if (typeof v === 'string' && v.length > 0) return true
        }
        return false
      }).length
    rep.channels_a = nonEmptyCount(chARaw)
    rep.channels_b = nonEmptyCount(chBRaw)
    rep.chan_a = sigA
    rep.chan_b = sigB
    rep.chan_match = JSON.stringify(sigA) === JSON.stringify(sigB)

    /* ═══════════ ★★update 段 · 路 B：Vue patch → 适配器补丁 → 宿主 updatePatches ═══════════
     *
     * 【与 A 路逐字同语义的变更序列】行内（文本 + 宽度）+ 标量源（boxW）——两条路改的是
     *   同一序列的值（A 改 `data` 的镜像、B 改 `dataB` 的镜像，初值相同、互不污染）。
     *
     * 【驱动链（每一步都是产品形态里的真环节）】
     *   改 `abList`/`abBoxW`（reactive）→ `instance.update()` **同步**重渲染
     *   → Vue patch 打到适配器（`patchProp` 标 dirty / 文本走 `setText|setElementText` 标 textDirty）
     *   → `adapter.takePatches()` 产出 `[{id, style}]`
     *   → 宿主 `updatePatches`（度量 → 内核 update → 变化集 → 文本落层 → 增量指令）。
     */
    const updB: AbReport['upd_b'] = []
    const geomsB: Array<ReturnType<typeof readRectsByOrder>> = []
    if (updRounds > 0) {
      const listB = abList.value as Array<{ id: number; w: number; title: string }>
      for (let r = 0; r < updRounds; r++) {
        if (!Array.isArray(listB) || listB.length === 0) break
        const at = r % Math.min(listB.length, rows)
        // 与 A 路逐字同语义（同一序列的值）
        listB[at]!.title = `upd ${r}`
        listB[at]!.w = 60 + (r % 4) * 20
        abBoxW.value = 150 + 30 * r
        const t0 = t()
        // ★同步驱动（见 `abRootInst` 的注释）：调的就是调度器排的那个 job 本体
        //   （TS 收窄：`abRootInst` 只在 setup 回调里赋值，控制流分析到不了——显式断言恢复其真实类型）
        const rootInst = abRootInst as { update?: () => void } | null
        rootInst?.update?.()
        const patched = adapter.takePatches()
        const tPatch = t()
        let hostMs = -1
        let applied = -1
        let changedN = 0
        let relayout = -1
        let textLayers = 0
        if (patched === null) {
          // 结构性变化 ⇒ 适配器要求走全量。更新段**不测全量路径**（那是 mount 段的形态）
          // ⇒ 如实记一条 note（判据按"补丁为 null"判红——本夹具的变更不该触发结构）
          notes.push(`第 ${r} 轮 B 路 takePatches() === null（结构性变化）——夹具的文本/宽度变更不该触发结构`)
        } else {
          const hu = t()
          const ho = JSON.parse(proteusHost.updatePatches(JSON.stringify(patched))) as {
            ok?: boolean; applied?: number; changed_rects?: number; relayout?: number
            total_ms?: number; text_layers_applied?: number; error?: string
            unsupported?: unknown[]
          }
          hostMs = t() - hu
          if (ho.ok === true) {
            applied = ho.applied ?? -1
            changedN = ho.changed_rects ?? 0
            relayout = ho.relayout ?? -1
            textLayers = ho.text_layers_applied ?? 0
          } else {
            notes.push(`第 ${r} 轮 B 路 updatePatches 失败：${ho.error ?? ''}`)
          }
          if (ho.unsupported && ho.unsupported.length > 0) {
            notes.push(`B 轮 ${r}：内核拒收 ${ho.unsupported.length} 条：${JSON.stringify(ho.unsupported).slice(0, 200)}`)
          }
        }
        const geom = readRectsByOrder(semIdsB)
        geomsB.push(geom)
        const prevGeom = r === 0 ? rectsB : geomsB[r - 1]!
        updB.push({
          round: r, patches: patched === null ? -1 : patched.length,
          applied, changed_rects: changedN, relayout, host_ms: hostMs, text_layers: textLayers,
          moved: maxGeomDelta(prevGeom, geom), driver_ms: tPatch - t0,
        })
        rep.upd_b_text_applied += textLayers
        // ★★逐轮几何对照：A 轮 r 的快照（`geomsA[r]`）vs B 轮 r 的快照——同一语义两次更新后应仍一致
        const gA = geomsA[r]
        if (gA) {
          const { delta: dR, mismatches: mR, samples: sR } = geomDiff(gA, geom)
          rep.upd_geom_rounds.push({ round: r, delta: dR, mismatches: mR, samples: sR })
          if (!rep.upd_first_mismatch && mR > 0) {
            rep.upd_first_mismatch = { round: r, delta: dR }
          }
        }
      }
      rep.upd_rounds = updB.length
      rep.upd_b = updB
      // 汇总更新后几何对照（取每轮的最大值与样本和——与 mount 段同口径）
      let umax = 0
      let umism = 0
      let usamples = 0
      for (const g of rep.upd_geom_rounds) {
        if (g.delta > umax) umax = g.delta
        umism += g.mismatches
        usamples += g.samples
      }
      rep.upd_samples = usamples
      rep.upd_max_delta = Math.round(umax * 1000) / 1000
      rep.upd_mismatches = umism
    }
    rep.upd_a = updA

    /* ═══════════ ★★事件路径 · 路 B：tap → Vue onClick → patch → 宿主 → 内核 ═══════════
     *
     * 【与 A 路同一条宿主链】`tapAt` → 内核 hitTest → `GestureListener` → JNI 反向调用
     *   → 本相位替换的全局回调 → **适配器 `dispatchEvent`**（Vue 的 `onClick` 在此登记）
     *   → handler 改 `abBoxW`（ref）→ `instance.update()` 同步重渲染 → `takePatches()`
     *   → 宿主 `updatePatches` → 内核几何变（判据读 readRects 真值）。
     *
     * 【B 按钮怎么定位】夹具常量 `#2f6fed`（与 `gen-vapor-fixture.mjs` 的 SFC 同源）——
     *   在 B 的请求树里唯一命中；命中数不为 1 ⇒ 如实记 note（**判据红**，不静默换锚点）。
     *
     * 【冒泡链（2026-10-02）】`chainJson` 来自内核（`bubble_chain`：target + 全部祖先）——
     *   此前宿主的 `GestureSink` 只传 `(type, targetId)`、这里也按空链派发 ⇒ 祖先 handler 不触发；
     *   现在**原样把链交给适配器**（`dispatchEvent` 沿链找处理器，DOM 冒泡语义）。
     */
    const btnBCands = (req.nodes as unknown as Array<Record<string, unknown>>).filter(
      (x) => x.backgroundColor === '#2f6fed',
    )
    if (btnBCands.length === 1 && typeof proteusHost.tapAt === 'function') {
      const btnBId = Number(btnBCands[0]!.id)
      const bv: NonNullable<AbReport['ev_b']> = {
        node: btnBId, hit: -1, chain: [], fired: [], fired_width_deltas: [], errors: [], before: null, after: null,
        width_delta: 0, patches: -1, applied: -1, changed_rects: 0, text_layers: 0, driver_ms: 0,
      }
      ;(globalThis as unknown as Record<string, unknown>)[GESTURE_CB] = (type: string, nodeId: number, chainJson?: string): string => {
        // ★沿内核给的冒泡链派发（适配器按 DOM 冒泡语义逐个查处理器；链为空 ⇒ 兜底 [nodeId]）
        const chain = parseChain(chainJson, nodeId)
        bv.chain = chain
        const r = adapter.dispatchEvent(nodeId, chain, type, 0, 0)
        bv.fired = r.fired
        bv.errors = r.errors
        return JSON.stringify({ ok: r.errors.length === 0 && r.fired.length > 0, fired: r.fired, chain, errors: r.errors })
      }
      bv.before = readRectOf(btnBId)
      const rectsAllBeforeB = readRectsAll()
      const tTap = t()
      if (bv.before) {
        const c = { x: bv.before.x + bv.before.width / 2, y: bv.before.y + bv.before.height / 2 }
        const tp = JSON.parse(proteusHost.tapAt(JSON.stringify(c))) as {
          ok?: boolean; gestures_fired?: number; last?: { target?: number }
        }
        // ★同 A 相位：只有本次真的触发了手势才认 last（防陈旧探针；见 A 相位注释）
        if (tp.gestures_fired === 1) {
          bv.hit = tp.last?.target ?? -1
        } else {
          notes.push(`★B 路 tap 未触发手势（gestures_fired=${tp.gestures_fired ?? '缺失'}）——hit 读数不可信`)
        }
      }
      // ★同步驱动重渲染（handler 已改 ref；见 `abRootInst` 注释——把"何时跑"从微任务改成显式调用，
      //   patch 链路一字未改；若宿主回调里的微任务泵已跑过本 job，这里重跑也是幂等的：值相同 ⇒ 不标脏）
      const rootInstB = abRootInst as { update?: () => void } | null
      rootInstB?.update?.()
      const t0 = t()
      const patched = adapter.takePatches()
      bv.driver_ms = t() - t0
      if (patched === null) {
        notes.push('★B 路 tap 后 takePatches() === null（结构性变化）——夹具的 boxW 变更不该触发结构')
      } else {
        bv.patches = patched.length
        const ho = JSON.parse(proteusHost.updatePatches(JSON.stringify(patched))) as {
          ok?: boolean; applied?: number; changed_rects?: number; relayout?: number; text_layers_applied?: number; error?: string
        }
        if (ho.ok === true) {
          bv.applied = ho.applied ?? -1
          bv.changed_rects = ho.changed_rects ?? 0
          bv.text_layers = ho.text_layers_applied ?? 0
        } else {
          notes.push(`★B 路 tap 后 updatePatches 失败：${ho.error ?? ''}`)
        }
      }
      bv.after = readRectOf(btnBId)
      if (bv.before && bv.after) bv.width_delta = Math.round((bv.after.width - bv.before.width) * 1000) / 1000
      // ★逐跳宽度位移（fired 顺序 = 链序，target 在前）：判据据此核"祖先 handler 真的改了祖先几何"
      const rectsAllAfterB = readRectsAll()
      bv.fired_width_deltas = bv.fired.map((id) => {
        const b = rectsAllBeforeB[String(id)]
        const a2 = rectsAllAfterB[String(id)]
        return b && a2 ? Math.round((a2.width - b.width) * 1000) / 1000 : -999
      })
      rep.ev_b = bv
      if (bv.hit !== btnBId) {
        notes.push(`★B 路 tap 命中 ${bv.hit} ≠ 按钮节点 ${btnBId}（hitTest 与适配器登记不一致）`)
      }
    } else {
      notes.push(`★B 路按钮定位失败（#2f6fed 命中 ${btnBCands.length} 个，应恰 1 个）——事件等价判据将缺读数`)
    }

    // ── 事件路径等价（A/B 两路的按钮矩形 + 冒泡链 + 逐跳位移）──
    rep.ev_before_delta = rectDelta(rep.ev_a?.before ?? null, rep.ev_b?.before ?? null)
    rep.ev_after_delta = rectDelta(rep.ev_a?.after ?? null, rep.ev_b?.after ?? null)
    const bubblesOk = (e: AbReport['ev_a'] | AbReport['ev_b']): boolean =>
      !!e && e.chain.length >= 2 && e.fired.length >= 2 && e.chain[0] === e.hit
    const deltasMatch = ((): boolean => {
      const a = rep.ev_a?.fired_width_deltas ?? []
      const b = rep.ev_b?.fired_width_deltas ?? []
      if (a.length !== b.length || a.length < 2) return false
      return a.every((v, i) => Math.abs(v - b[i]!) <= 0.01 && v > 0 && b[i]! > 0)
    })()
    rep.ev_match = !!(rep.ev_a && rep.ev_b
      && rep.ev_before_delta >= 0 && rep.ev_before_delta <= 0.01
      && rep.ev_after_delta >= 0 && rep.ev_after_delta <= 0.01
      && Math.abs(rep.ev_a.width_delta - rep.ev_b.width_delta) <= 0.01
      && bubblesOk(rep.ev_a) && bubblesOk(rep.ev_b) && deltasMatch)
    if (rep.ev_a && rep.ev_b) {
      notes.push(`事件路径：A 命中 ${rep.ev_a.hit} · 链 [${rep.ev_a.chain.join('>')}] 派发 [${rep.ev_a.fired.join('>')}]`
        + ` · 宽 ${rep.ev_a.before?.width}→${rep.ev_a.after?.width}（指令 ${rep.ev_a.ops_bytes}B / applied ${rep.ev_a.applied}）；`
        + `B 命中 ${rep.ev_b.hit} · 链 [${rep.ev_b.chain.join('>')}] 派发 [${rep.ev_b.fired.join('>')}]`
        + ` · 宽 ${rep.ev_b.before?.width}→${rep.ev_b.after?.width}（补丁 ${rep.ev_b.patches} / applied ${rep.ev_b.applied}）`
        + ` · 逐跳位移 A=${JSON.stringify(rep.ev_a.fired_width_deltas)} vs B=${JSON.stringify(rep.ev_b.fired_width_deltas)}`)
    }

    rep.ok = true
    notes.push(`A 路 ${rep.cost_a.total_ms.toFixed(1)}ms（实例化 ${rep.cost_a.instantiate_ms} + 宿主 ${rep.cost_a.host_ms}）`)
    notes.push(`B 路 ${rep.cost_b.total_ms.toFixed(1)}ms（Vue mount ${rep.cost_b.vue_ms} + 请求 ${rep.cost_b.request_ms} + 序列化 ${rep.cost_b.serialize_ms} + 宿主 ${rep.cost_b.host_ms}）`)
    return JSON.stringify(rep)
  } catch (e) {
    rep.error = (e as { message?: string })?.message ?? String(e)
    return JSON.stringify(rep)
  }
}

/** AB 对照的**初值**（同一份数据模板）——入口内为两条路各拷一份独立副本（见 runAb 内的说明：
 *  同一进程重复跑 `vaporAb` 时，上一轮的改动不得污染下一轮的初值）。 */
const abData = makeData(8)

/** 按给定 id 顺序读内核几何（返回与 ids 等长的数组；缺失项为 null） */
function readRectsByOrder(ids: number[]): Array<{ id: number; x: number; y: number; width: number; height: number }> {
  const out: Array<{ id: number; x: number; y: number; width: number; height: number }> = []
  try {
    const all = JSON.parse(proteusHost.readRects()) as {
      rects?: Record<string, { x: number; y: number; width: number; height: number }>
    }
    const m = all.rects ?? {}
    for (const id of ids) {
      const r = m[String(id)]
      if (r) out.push({ id, x: r.x, y: r.y, width: r.width, height: r.height })
    }
  } catch {
    /* 读失败 ⇒ 返回已收集部分（判据按缺失判红） */
  }
  return out
}

/** 两次几何快照之间的**最大绝对差**（px；用于"本轮更新真的动了没"的逐轮读数） */
function maxGeomDelta(
  a: Array<{ x: number; y: number; width: number; height: number }>,
  b: Array<{ x: number; y: number; width: number; height: number }>,
): number {
  let m = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    const d = Math.max(Math.abs(x.x - y.x), Math.abs(x.y - y.y), Math.abs(x.width - y.width), Math.abs(x.height - y.height))
    if (d > m) m = d
  }
  return Math.round(m * 1000) / 1000
}

/** 两路几何快照的逐项对比（返回最大差 / 超容差数 / 样本数）——更新段与 mount 段同一口径 */
function geomDiff(
  a: Array<{ x: number; y: number; width: number; height: number }>,
  b: Array<{ x: number; y: number; width: number; height: number }>,
): { delta: number; mismatches: number; samples: number } {
  const n = Math.min(a.length, b.length)
  let delta = 0
  let mismatches = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    const d = Math.max(Math.abs(x.x - y.x), Math.abs(x.y - y.y), Math.abs(x.width - y.width), Math.abs(x.height - y.height))
    if (d > delta) delta = d
    if (d > 0.01) mismatches++
  }
  return { delta: Math.round(delta * 1000) / 1000, mismatches, samples: n }
}

/**
 * ★★**解析宿主下发的冒泡链**（`"[target, ...祖先]"`，自深到浅）。
 *   缺失 / 非法 / 空 ⇒ 退化为 `[nodeId]`（**不静默换链**：退化是显式的、且旧宿主兼容）。
 */
function parseChain(chainJson: unknown, nodeId: number): number[] {
  if (typeof chainJson === 'string' && chainJson.length > 0) {
    try {
      const arr = JSON.parse(chainJson) as unknown
      if (Array.isArray(arr) && arr.length > 0) {
        const ids = arr.map((x) => Number(x)).filter((x) => Number.isFinite(x))
        if (ids.length > 0) return ids
      }
    } catch {
      /* 解析失败 ⇒ 退化（下行） */
    }
  }
  return nodeId >= 0 ? [nodeId] : []
}


/**
 * ★★★**`<Transition>` 桥**（P3-3，2026-10-03）：可见性变化 → 宿主动画入口。
 *
 * 【为什么需要一个"桥"函数】两半信息在两个地方：
 *   · **有没有过渡声明** → 编译产物（`LayoutNode.transition`，模板侧）；
 *   · **可见性真的翻转了** → 运行时（`VaporRuntime.takeVisibilityChanges`，见其注释）。
 *   本函数把两半接起来：drain 变化 → 查模板 → 组动画规格 → 交宿主（`animStart`）。
 * 【诚实边界】宿主未实现 `animStart` ⇒ 记 note（不静默）；`v-if` 的**离场**（元素从树上摘除）
 *   不在此路径（结构级动画属 L2 通道，本批只做可见性切换）。
 */
function drainTransitions(
  tpl: { nodes: Array<{ id: number; transition?: { preset: string; enter: Array<{kind:number;from:number;to:number}>; leave: Array<{kind:number;from:number;to:number}>; durMs: number; curve: number } }> },
  vapor: { takeVisibilityChanges(): Array<{ nodeId: number; visible: boolean }> },
  notes: string[],
): number {
  const changes = vapor.takeVisibilityChanges()
  if (changes.length === 0) return 0
  const anims: Array<Record<string, unknown>> = []
  for (const ch of changes) {
    const node = tpl.nodes.find((n) => n.id === ch.nodeId)
    const tr = node?.transition
    if (!tr) continue   // 无过渡声明 ⇒ 只有可见性切换（正常路径，不记 note——否则每次 v-show 都刷屏）
    const channels = ch.visible ? tr.enter : tr.leave
    for (const c of channels) {
      anims.push({ nodeId: ch.nodeId, kind: c.kind, from: c.from, to: c.to, durMs: tr.durMs, curve: tr.curve })
    }
  }
  if (anims.length === 0) return 0
  if (typeof proteusHost.animStart !== 'function') {
    notes.push(`<Transition> 有 ${anims.length} 条动画待播，但宿主未实现 animStart（过渡不会发生）`)
    return 0
  }
  try {
    const out = JSON.parse(proteusHost.animStart(JSON.stringify({ anims }))) as { ok?: boolean; started?: number; error?: string }
    if (out.ok !== true) {
      notes.push(`animStart 失败：${out.error ?? '未知'}`)
      return 0
    }
    return out.started ?? anims.length
  } catch (e) {
    notes.push(`animStart 抛错：${String((e as Error)?.message ?? e)}`)
    return 0
  }
}

/**
 * ★★**沿冒泡链派发（A 路）**——`chain` 自深到浅（内核 `bubble_chain` 语义）；
 *   逐个查 `节点:事件 → handler`，命中即执行（**全部祖先都会跑**——DOM 冒泡语义）。
 *
 * 【为什么两处（runShort / runAb A 相位）共用这一份】这两条路此前都只对 **target 本身**
 *   派发 ⇒ 祖先 handler 永不触发（冒泡链在 JNI 下发后被丢——2026-10-02 修复）。
 *   同一语义只允许一处实现（本仓纪律）。
 *
 * ★诚实边界：A 路的 handler 是**动作列表**（无事件对象）⇒ 不支持 `stopPropagation`
 *   （B 路适配器的 `dispatchEvent` 支持）。本版判据覆盖"非终止冒泡"的等价；终止语义属后续批次。
 */
/**
 * ★★**沿冒泡链派发（A 路）**——`chain` 自深到浅（内核 `bubble_chain` 语义）；
 *   逐个查 `节点:事件 → handler`，命中即执行（**全部祖先都会跑**——DOM 冒泡语义）。
 *
 * 【为什么两处（runShort / runAb A 相位）共用这一份】这两条路此前都只对 **target 本身**
 *   派发 ⇒ 祖先 handler 永不触发（冒泡链在 JNI 下发后被丢——2026-10-02 修复）。
 *   同一语义只允许一处实现（本仓纪律）。
 *
 * ★★**2026-10-03 · P2-3：语义下沉到 `@proteus-vue/slot-runtime` 的共享派发器**
 *   （`dispatchGesture`）——本函数只是薄接线（转调 + 保持既有返回形状）。
 *   ⇒ 修饰符 `.stop` / `.self` / `.once` 与链序语义**三端共用一份实现**
 *     （此前这里内联、iOS/Harmony 各写一份必然漂移；且当时**不支持任何修饰符**）。
 *   ★诚实边界仍在但已**收窄**：A 路的 handler 是**动作列表**（无事件对象）⇒
 *     `preventDefault` 这类"事件对象上的方法"仍无对应物；而 `.stop`（终止冒泡）
 *     **已支持**（此前注释写的"不支持 stopPropagation"已过期——本批修正）。
 */
function dispatchChainA(
  chain: number[],
  type: string,
  index: EventIndex,
  state: DispatchState,
  /** ★P1-3 emits：第二参 = 本跳节点 id（组件事件路由要用——见 dispatchGesture 注释） */
  run: (name: string, nodeId: number) => boolean,
): { fired: number[]; handler: string; stopped: boolean; skippedSelf: number[]; skippedOnce: number[] } {
  return dispatchGesture(chain, type, index, state, run)
}

/** 逐节点探针绘制通道（返回与 ids 等长的"非空通道数"） */
function probeChannelsFor(ids: number[]): Array<{ id: number; nonEmpty: number }> {
  try {
    const r = JSON.parse(proteusHost.probeChannels(JSON.stringify(ids))) as {
      ok?: boolean
      channels?: Array<Record<string, unknown>>
    }
    return (r.channels ?? []).map((c) => {
      const id = Number(c.id ?? -1)
      let nonEmpty = 0
      for (const k of ['radius', 'grad', 'glow', 'clip', 'stroke_len', 'mask']) {
        const v = c[k]
        if (v === undefined || v === null) continue
        if (k === 'mask') { if (Number(v) > 0) nonEmpty++; continue }
        if (typeof v === 'number' && v > 0) nonEmpty++
        else if (typeof v === 'string' && v.length > 0) nonEmpty++
      }
      return { id, nonEmpty }
    })
  } catch {
    return []
  }
}

/** 六个绘制通道键（与宿主 `probeChannels` 的回执键逐字一致） */
const CHANNEL_KEYS = ['radius', 'grad', 'glow', 'clip', 'stroke_len', 'mask'] as const

/** 逐节点探针（**原始回执**——保留每个通道的值，供逐项对照） */
function probeChannelsRaw(ids: number[]): Array<Record<string, unknown>> {
  try {
    const r = JSON.parse(proteusHost.probeChannels(JSON.stringify(ids))) as {
      ok?: boolean
      channels?: Array<Record<string, unknown>>
    }
    return (r.channels ?? []).filter((c) => c && c.id !== undefined)
  } catch {
    return []
  }
}

/**
 * ★★**绘制通道逐项签名**（2026-10-01 第二批：B 侧探针口径对齐）——
 *   「哪个节点带哪个通道、值是多少」的**排序多重集**，而不是"非空通道数相等"。
 *
 * 【为什么多重集（本批最关键的口径设计）】两条路的**树形天然不同**：
 *   A（Vapor）把 `p-text` 文本折在元素上（文本即元素属性）；B（Vue 运行时）是标准
 *   vnode 树（`p-text` 元素 + 匿名文本子节点，文本子节点**继承**父的绘制属性）。
 *   ⇒ 按节点 id / 按 index 一一对照都必然错位（本仓 A/B mount 首版就吃过"错位假象"的亏）。
 *   而"同一份 SFC 两侧应产出**同一组语义绘制声明**"是成立的——故按**签名多重集**对照：
 *   同值同计数即等价（map 的键序差异、节点拆分差异都不影响结论）；
 *   缺失的签名会以 `-计数` 与 `+计数` 直接暴露（判据脚本给差集）。
 *
 * 【为什么 `clip` 要归一（0 与 undefined 同义）】宿主回执对"无裁剪"节点给 `clip: 0`
 *   （`clipKindOf` 的返回值），而缺该键时读作 undefined——两者是同一语义（没有裁剪），
 *   归一后再入签名，否则会出现"0 vs undefined"的**假差异**。
 *   ★同理 `mask`（0 = 无）与 `stroke_len`（0 = 未建描边层）——宿主对无描边的节点**不给键**，
 *     而给 `stroke_len: 0` 的节点存在 ⇒ 一并按"零值即无"归省（只保留非零值）。
 */
function channelSig(probes: Array<Record<string, unknown>>): { per_channel: Record<string, Record<string, number>>; total: number } {
  const per: Record<string, Record<string, number>> = {}
  for (const k of CHANNEL_KEYS) per[k] = {}
  const bump = (k: string, v: unknown): void => {
    const key = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v)
    const m = per[k]!
    m[key] = (m[key] ?? 0) + 1
  }
  let total = 0
  for (const c of probes) {
    for (const k of CHANNEL_KEYS) {
      const v = c[k]
      if (v === undefined || v === null) continue
      // 零值 = 该通道"没有"（与缺键同义）——归省，防假差异
      if (typeof v === 'number' && v === 0) continue
      if (typeof v === 'string' && v === '') continue
      bump(k, v)
      total++
    }
  }
  // 排序保证 JSON.stringify 稳定（键序无关的确定性比较）
  const sorted: Record<string, Record<string, number>> = {}
  for (const k of CHANNEL_KEYS) {
    const keys = Object.keys(per[k]!).sort()
    const m: Record<string, number> = {}
    for (const kk of keys) m[kk] = per[k]![kk]!
    sorted[k] = m
  }
  return { per_channel: sorted, total }
}

/**
 * ★★★**长列表虚拟化**（`mode: 'list'`）：整树进内核（几何正确）、宿主**只物化可见区**。
 *
 * 【它验什么（§9.3 长列表验收的端上缺口）】文档定义「4000 行 / 每行 40+ 元素」的端上规模
 *   此前未跑过（只有 Rust 纯逻辑读数与 iOS 的 1000 行 V12）。本入口跑 **1000 行**：
 *   · 整树 1000 行都在内核（几何正确）；
 *   · 宿主物化行数**有界**（与滚动距离无关）——这是虚拟化的唯一意义所在；
 *   · 30 帧下滚 + 30 帧上滚（回顶）：**回顶签名应恒等**（无累积漂移）；
 *   · 复用池的 acquire/release 由**核心给决策**（`recycleUpdate`），宿主只执行动作。
 */
function runVirtualList(args: VaporArgs): string {
  const t = (): number => Date.now()
  const rows = Math.max(2, args.rows ?? 1000)
  const notes: string[] = []
  const rep: VaporListReport = {
    ok: false, tpl_nodes: 0, sub_l1: 0, inst_nodes: 0, inst_rows: 0, inst_allocated_ids: 0,
    mount_ms: 0, row_count: 0, row_pitch: 0, rows_live_first: 0, cmds_live_first: 0,
    down_frames: 0, down_built_delta: 0, up_frames: 0, up_built_delta: 0, trail: [],
    moved_diff_pct: -1, back_top_diff_pct: -1, final_scroll: 0,
    row_frames_total: 0, built_total: 0, released_total: 0, uninstantiated_slots: 0, notes,
  }
  try {
    const artifacts = JSON.parse(args.artifacts) as { tpl: LayoutTemplate; table: SubscriptionTable; sfc: string }
    rep.tpl_nodes = artifacts.tpl.nodes.length
    rep.sub_l1 = artifacts.table.stats.l1
    if (!artifacts.tpl.ok) {
      rep.error = '模板不可用（构建期诊断）'
      return JSON.stringify(rep)
    }

    // ① 实例化（1000 行）——`virtual.rows` 就是虚拟化要的行描述
    const data = makeListData(rows)
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()
    const inst = instantiateTemplate(artifacts.tpl, { viewport: args.viewport, read, table: artifacts.table, registry })
    rep.inst_nodes = inst.nodes.length
    rep.inst_rows = inst.virtual?.rows.length ?? 0
    rep.inst_allocated_ids = inst.stats.allocatedIds
    if (!inst.virtual || inst.virtual.rows.length === 0) {
      rep.error = '实例化没有产出 virtual.rows（虚拟化不可用）'
      return JSON.stringify(rep)
    }

    // ② 虚拟化挂载（整树进内核、只物化可见区）
    const t2 = t()
    const mo = JSON.parse(
      proteusHost.mountVirtual(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes, rows: inst.virtual.rows })),
    ) as { ok?: boolean; node_count?: number; row_count?: number; row_pitch?: number; rows_live?: number; cmds_live?: number; error?: string }
    rep.mount_ms = t() - t2
    if (mo.ok !== true) {
      rep.error = 'mountVirtual 失败：' + (mo.error ?? '')
      return JSON.stringify(rep)
    }
    rep.row_count = mo.row_count ?? -1
    rep.row_pitch = mo.row_pitch ?? -1
    rep.rows_live_first = mo.rows_live ?? -1
    rep.cmds_live_first = mo.cmds_live ?? -1

    const probe = (): { live: number; cmds: number; built: number; released: number } => {
      const o = JSON.parse(proteusHost.scrollRows('{"dy":0}')) as {
        live_rows?: number; cmds_live?: number; built_total?: number; released_total?: number
      }
      return { live: o.live_rows ?? -1, cmds: o.cmds_live ?? -1, built: o.built_total ?? -1, released: o.released_total ?? -1 }
    }
    const p0 = probe()
    let builtPrev = p0.built

    // ③ 30 帧下滚（每帧 +100px = 一行）
    const step = (dir: 1 | -1, frames: number, label: string): { builtDelta: number; lastDiff: number } => {
      let builtDelta = 0
      let lastDiff = -1
      for (let i = 0; i < frames; i++) {
        const cap = i % 10 === 9
        const o = JSON.parse(proteusHost.scrollRows(JSON.stringify({ dy: dir * 100, capture: cap }))) as {
          ok?: boolean; scroll_y?: number; live_rows?: number; cmds_live?: number; built_total?: number
          released_total?: number; sig_diff_pct?: number; row_frames_total?: number; error?: string
        }
        if (o.ok !== true) {
          notes.push(`${label} 第 ${i} 帧失败：${o.error ?? ''}`)
          break
        }
        rep.final_scroll = o.scroll_y ?? 0
        rep.row_frames_total = o.row_frames_total ?? 0
        rep.built_total = o.built_total ?? 0
        rep.released_total = o.released_total ?? 0
        if (o.sig_diff_pct !== undefined) lastDiff = o.sig_diff_pct
        if (i % 10 === 0 || i === frames - 1) {
          rep.trail.push({ f: i, scroll: o.scroll_y ?? 0, live: o.live_rows ?? -1, cmds: o.cmds_live ?? -1, built: o.built_total ?? -1 })
        }
      }
      builtDelta = (rep.built_total || 0) - builtPrev
      builtPrev = rep.built_total || 0
      return { builtDelta, lastDiff }
    }
    const down = step(1, 30, '下滚')
    rep.down_frames = 30
    rep.down_built_delta = down.builtDelta
    rep.moved_diff_pct = down.lastDiff

    // ④ 30 帧上滚（回顶）+ 回顶签名对比
    const up = step(-1, 30, '上滚')
    rep.up_frames = 30
    rep.up_built_delta = up.builtDelta
    // 回顶帧：capture=true 对比顶部签名
    const top = JSON.parse(proteusHost.scrollRows('{"dy":0,"capture":true}')) as { sig_diff_pct?: number; scroll_y?: number }
    rep.back_top_diff_pct = top.sig_diff_pct ?? -1
    rep.final_scroll = top.scroll_y ?? rep.final_scroll

    rep.uninstantiated_slots = 0
    rep.ok = rep.down_frames > 0 && rep.up_frames > 0
    notes.push(`整树 ${rep.inst_nodes} 节点 / ${rep.row_count} 行 · 首帧物化 ${rep.rows_live_first} 行 / ${rep.cmds_live_first} 指令`)
    return JSON.stringify(rep)
  } catch (e) {
    rep.error = (e as { message?: string })?.message ?? String(e)
    return JSON.stringify(rep)
  }
}

/** 长列表数据（`item.w` 行内绑定 + `item.title` 插值——行内槽位都要有值） */
function makeListData(rows: number): Record<string, unknown> {
  return { list: Array.from({ length: rows }, (_, i) => ({ id: i + 1, w: 120, title: `row ${i + 1}` })) }
}

/** 短列表（缺省模式）：实例化 + 订阅驱动增量 */
function runShort(args: VaporArgs): string {
  const t = (): number => Date.now()
  const rows = Math.max(1, args.rows ?? 8)
  const notes: string[] = []
  const rep: VaporReport = {
    ok: false,
    tpl_nodes: 0, tpl_ok: false, sub_l1: 0, sub_l0: 0, sub_l1_rate: 0, sub_sources: [],
    inst_ms: 0, inst_nodes: 0, inst_reused_ids: 0, inst_allocated_ids: 0, inst_rows: 0,
    inst_values_filled: 0, inst_virtual_rows: 0, inst_text_filled: 0, inst_width_filled: 0,
    mix_text_probe: [], text_probe_rounds: [], gate_rounds: [], gate_text_nodes: [], once_node_id: -1, memo_node_id: -1, expr_probe: [], transition_started: 0, tpl_transition: [], component_mounts: 0, component_nodes: 0, component_kid_probe: {}, slot_probe: { texts: [], rects: [], fills: [], markers_left: -1 }, emit_probe: { emits: [], parent_source_after: undefined, geom_before: -1, geom_after: -1 }, scoped_probe: { texts: [], anchor_id: -1, anchor_width_field: -1, anchor_width_rect: -1 }, lifecycle_probe: { bindings: [], ran_handler: '', changed_sources: [], ops_bytes: 0, applied: 0, anchor_id: -1, geom_before: -1, geom_after: -1 }, dyn_probe: { texts: [], mounts: [], geom: [], dropped: -1, notes: [] }, directive_probe: { nodes: [], rounds: [], plays: [] }, mixed_probe: { texts: [], leaves: 0, geom: [] },
    mount_ms: 0, mount_nodes: 0,
    updates_run: 0, ops_bytes: 0, ops_ms: 0, apply_ms: 0, text_synced_total: 0, update_evidence: [], geom_probe: [], channels: [],
    ev_bindings: 0, ev_handlers: 0, ev_modifiers: 0, taps: 0, tap_evidence: [],
    uninstantiated_slots: 0, notes,
  }
  try {
    // ── ① 编译产物（构建期产出）──
    const artifacts = JSON.parse(args.artifacts) as {
      tpl: LayoutTemplate
      table: SubscriptionTable
      sfc: string
      /** ★★★P1-3（2026-10-03）：组件注册表（子组件编译产物——键名与生成器**必须一致**） */
      components?: Record<string, { tpl: LayoutTemplate; table: SubscriptionTable; data?: Record<string, unknown> }>
    }
    const tpl = artifacts.tpl
    const table = artifacts.table
    rep.tpl_nodes = tpl.nodes.length
    // ★P3-3：模板里声明的过渡（判据据此区分"夹具没声明"与"声明了但没驱动"）
    rep.tpl_transition = tpl.nodes
      .filter((n) => (n as { transition?: unknown }).transition)
      .map((n) => `${n.id}:${(n as { transition?: { preset?: string } }).transition?.preset ?? ''}`)
    rep.tpl_ok = tpl.ok
    rep.sub_l1 = table.stats.l1
    rep.sub_l0 = table.stats.l0
    rep.sub_l1_rate = table.stats.l1Rate
    rep.sub_sources = table.sources.map((s2) => s2.sourceName)
    if (!tpl.ok) {
      rep.error = '模板不可用（构建期诊断——见 gen-vapor-fixture.mjs 输出）'
      return JSON.stringify(rep)
    }

    // ── ② 设备端实例化：模板 + 数据 → 节点树 ──
    //
    // ★★数据源二选一（2026-10-02 · 六端 SFC 压力夹具）：
    //   · `artifacts.data` 存在 ⇒ **用它**（构建期从共享 SFC 的 spec 生成——与 Web/MP 端
    //     渲染的脚本字面量**逐字一致**；跨端像素比较的前提是"同一份数据"）；
    //   · 否则 ⇒ `makeData(rows)`（既有 A/B 与 list 场景的合成数据，行为零变化）。
    const embedded = (artifacts as { data?: Record<string, unknown> }).data
    const data = embedded
      ? (JSON.parse(JSON.stringify(embedded)) as Record<string, unknown>)
      : makeData(rows)
    /** 源读取（VaporRuntime 的 EvalContext 契约：按名取当前值；行内作用域由框架按 scope 绑定） */
    const read = (n: string): unknown => data[n]
    const registry = new ListRegistry()
    const t2 = t()
    // ★★★P1-3：把注册表从"产物形态"翻成"运行时形态"（ComponentDef）
    const componentDefs: Record<string, { template: LayoutTemplate; table?: SubscriptionTable; data?: Record<string, unknown> }> = {}
    for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
      componentDefs[nm] = { template: def.tpl, table: def.table, data: def.data }
    }
    const inst = instantiateTemplate(tpl, {
      viewport: args.viewport,
      read,
      table,
      registry,
      // ★P1-3：有注册表 ⇒ 组件内部被**展开**（无 ⇒ 保留边界标记、内部留空 + note）
      ...(Object.keys(componentDefs).length > 0 ? { components: componentDefs } : {}),
    })
    rep.inst_ms = t() - t2
    rep.inst_nodes = inst.nodes.length
    rep.inst_reused_ids = inst.stats.reusedTemplateIds
    rep.inst_allocated_ids = inst.stats.allocatedIds
    rep.inst_rows = inst.stats.rows
    rep.inst_values_filled = inst.stats.valuesFilled
    rep.inst_virtual_rows = inst.virtual?.rows.length ?? 0
    // ★回填证据（本仓实测踩过的缺陷形态：不回填 ⇒ 首帧空白/几何错，且**零报错**）
    rep.inst_text_filled = inst.nodes.filter((n) => typeof n.text === 'string' && n.text.length > 0).length
    rep.inst_width_filled = inst.nodes.filter((n) => typeof n.width === 'number').length
    // ★P2-2：多段拼接节点的首帧文本（模板里只有**段表**的节点——判据核"完整拼接"）
    const segNodes = tpl.nodes.filter((n) => (n as { textSegments?: unknown[] }).textSegments?.length)
    const segNodeIds = new Set(segNodes.map((n) => n.id))
    // ★静态段清单（判据做"子序列"校验：静态段按序都在文本里 ⇒ 拼接完整；
    //   写死某个字符（如 '·'）会把判据绑死在某一版夹具上——本仓实测踩到）
    const staticsOf = new Map(segNodes.map((n) => [
      n.id,
      ((n as { textSegments?: Array<{ text?: string }> }).textSegments ?? [])
        .filter((sg) => sg.text !== undefined && sg.text !== '')
        .map((sg) => String(sg.text)),
    ]))
    rep.mix_text_probe = inst.nodes
      .filter((n) => segNodeIds.has(n.id))
      .map((n) => ({ id: n.id, text: String((n as { text?: string }).text ?? ''), statics: staticsOf.get(n.id) ?? [] }))
    // ★P2-6~P2-9：按**首帧文本前缀**锚定表达式能力节点（前缀是夹具里写死的字面量段）
    const EXPR_PREFIXES = ['vt-', 'pi-', 'mx-', 'jn-', 'oc-']
    rep.expr_probe = inst.nodes
      .map((n) => ({ id: n.id, text: String((n as { text?: string }).text ?? '') }))
      .filter((n) => EXPR_PREFIXES.some((p2) => n.text.startsWith(p2)))
      .map((n) => ({ id: n.id, prefix: n.text.slice(0, 3), text: n.text }))
    if (rep.inst_text_filled === 0) notes.push('⚠ 实例树里没有任何非空文本——回填链可疑')

    // ── ③ 渲染：交给宿主（Rust 核心算几何 + 下发绘制指令）──
    const t3 = t()
    const mountOut = proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
    rep.mount_ms = t() - t3
    const mo = JSON.parse(mountOut) as { ok?: boolean; nodes?: number; layout_ms?: number; cmds?: number; error?: string }
    if (mo.ok !== true) {
      rep.error = '宿主 mount 失败：' + (mo.error ?? mountOut.slice(0, 200))
      return JSON.stringify(rep)
    }
    rep.mount_nodes = mo.nodes ?? -1
    rep.host_layout_ms = mo.layout_ms
    rep.host_cmds = mo.cmds

    // ── ④ 订阅驱动的增量：改数据 → VaporRuntime → 二进制指令 → 内核 ──
    //
    // 【为什么用 VaporRuntime 而不是手拼指令】这正是"编译产物驱动更新"的形态：
    //   订阅表声明了「哪个槽位听哪个源、怎么写」；运行时只做**求值 + 编码**。
    //   手拼指令会绕开订阅表 ⇒ 那条链等于没验（本入口存在的意义就是验它）。
    const keys = new PropKeyTable()
    const strings = new StringPool()
    const captured: Uint8Array[] = []
    // ★sink = 捕获字节（宿主 applyOps 的入参）；`flush()` 是**确定性驱动**入口——必需：
    //   本入口全同步，而 SlotRuntime 默认调度器是微任务（evaluateScript 期间不排空，本仓实测过）。
    const slotRt = new SlotRuntime(keys, strings, (bytes) => captured.push(bytes))
    const evals = VaporRuntime.buildEvaluators(table.evaluators)
    /* ═══════════ ★★★P1-3：**组件内部渲染**的运行时装配（2026-10-03）═══════════
     *
     * 【装配链（三层）】
     *   ① 构建期：子组件 SFC 编译成 `ComponentDef`（模板 + 订阅表 + data 快照）随产物下发；
     *   ② 实例化：命中组件的边界节点被**展开**成子树（id 平移），并产出 `componentMounts`
     *      （桥据此知道"哪个边界挂了哪个子组件、它的 props 是什么"）；
     *   ③ 运行时（这里）：每个挂载建一个**子 VaporRuntime**（自己的表/自己的注册表），
     *      并把父级的 `onComponentProp(boundaryLocalId, prop, value)` 路由到对应子运行时：
     *      props 改了 ⇒ 写进子组件的求值上下文 ⇒ 子运行时把变化编成**它自己的指令流**。
     *
     * 【为什么这样分层是对的】子组件的更新是"普通槽位更新"（它有自己的订阅表）——
     *   组件系统只是**多了一层子树 + 一次 props 赋值**，不引入新指令语义（内核零改动）。
     */
    const propCallLog: string[] = []
    let childEmitCount = 0
    const childRuntimes: Array<{
      mount: NonNullable<typeof inst.componentMounts>[number]
      vapor: VaporRuntime
      runtime: SlotRuntime
      /** ★P1-3 emits（2026-10-03）：子组件自己的事件绑定/动作表（handler 里可能有 `$emit`） */
      childEvents: EventBinding[]
      childHandlers: Record<string, Array<{ op: string; source?: string; program?: unknown; event?: string }>>
    }> = []
    const mountsByBoundary = new Map<number, (typeof childRuntimes)[number]>()
    if (inst.componentMounts) {
      for (const mount of inst.componentMounts) {
        // 子组件自己的指令流：追加到同一 sink（captured）⇒ 与父级共用一次 flush/一次 applyOps
        const childRt = new SlotRuntime(keys, strings, (bytes) => { captured.push(bytes); childEmitCount++ })
        // ★★nodeIdOffset（P1-3 实测缺陷②）：子组件的令牌表 nodeId 是**子树 local 空间**，
        //   而指令要打到**父树 id 空间**的同一个内核上 ⇒ 必须平移。
        //   ★偏移量 = 子树的起点 = 挂载记录里最小节点 id − 子树模板的 local 最小 id。
        //     这里直接用"子树节点 id 的最小值 − 子模板 local 最大值映射"不便算 ⇒
        //     让实例化把偏移**带出来**（`mount.idOffset`），桥只做透传。
        const childVapor = mount.table
          ? new VaporRuntime(
              mount.table, childRt, VaporRuntime.buildEvaluators(mount.table.evaluators), mount.registry,
              undefined, mount.idOffset ?? 0)
          : undefined
        if (childVapor && mount.table) {
          const triggers2 = new Map<string, () => void>()
          childVapor.load(mount.ctx, (n, cb) => triggers2.set(n, cb))
          childVapor.relink(mount.ctx)
          childRt.flush()
        }
        // ★P1-3 emits：子组件的**事件与动作表**（编译期产物里随组件注册表下发）
        const childDef = (artifacts as {
          components?: Record<string, { events?: EventBinding[]; handlers?: Record<string, Array<{ op: string; source?: string; program?: unknown; event?: string }>> }>
        }).components?.[mount.name]
        const entry2 = {
          mount, vapor: childVapor!, runtime: childRt,
          childEvents: childDef?.events ?? [],
          childHandlers: childDef?.handlers ?? {},
        }
        mountsByBoundary.set(mount.boundaryNodeId, entry2)
        childRuntimes.push(entry2)
      }
    }
    rep.component_mounts = childRuntimes.length
    rep.component_nodes = inst.stats.componentNodes
    /**
     * 父级 props 变化 → 对应子运行时（见上注释的装配链）。
     * ★boundaryNodeId 是**父树 local id**（订阅表里的 nodeId 空间——与模板序同源）。
     */
    const onComponentProp = (boundaryLocalId: number, propName: string, value: unknown): void => {
      const target = mountsByBoundary.get(boundaryLocalId)
      if (!target) {
        notes.push(`组件 props 变化找不到挂载记录（boundary=${boundaryLocalId} ${propName}）——内部渲染未装配？`)
        return
      }
      target.mount.props[propName] = value
      propCallLog.push(`${propName}=${String(value)}`)
      if (!target.vapor) {
        propCallLog.push('(no-vapor)')
        return
      }
      // 子组件的订阅表里，props 是**源**（`sourceName` = props 名）
      target.vapor.writeSlotsOfSource(propName, target.mount.ctx)
      target.runtime.flush()
    }
    const vapor = new VaporRuntime(table, slotRt, evals, registry, onComponentProp)
    const ctx = { read }
    const triggers = new Map<string, () => void>()
    vapor.load(ctx, (name, cb) => triggers.set(name, cb))
    vapor.relink(ctx)      // 写全部槽位（订阅建立 + 首轮值）
    slotRt.flush()
    captured.length = 0    // ★丢掉首帧指令：初始值已由 instantiateTemplate 回填进树
    rep.uninstantiated_slots = vapor.uninstantiatedSlots.length

    /* ═══════════════ ★★交互闭环（2026-10-01）═══════════════
     *
     * 链路：宿主 tap → hitTest 命中节点 → `GestureListener` → JNI 反向回调
     *       → 本函数（`__proteusVaporGesture`）→ 跑 handler（改数据）→ 触发订阅
     *       → 二进制指令 → 内核重排 → 几何真的变。
     *
     * 【为什么 handler 是"动作列表"而不是代码】见 `compileEvents` 头注：模板里的赋值/自增
     *   是**语句**（表达式编译器明确拒绝赋值），编译成 `{op:'set'|'add', source, program}`
     *   之后设备端只做**执行**（`evalExpr` 求值 + 写数据）——无 eval、无字符串解析。
     */
    const handlers = (artifacts as unknown as { handlers?: Record<string, Array<{ op: string; source: string; program: unknown }>> }).handlers ?? {}
    const events = (artifacts as unknown as { events?: EventBinding[] }).events ?? []
    rep.ev_bindings = events.length
    rep.ev_handlers = Object.keys(handlers).length

    // ★★★**emits 路由表**（P1-3 emits，2026-10-03）——父级写在组件边界上的自定义事件绑定。
    //   键 = `边界宿主 id:事件名`（`componentEmit` 绑定不参与手势派发，见 dispatch.ts 注释）。
    //   ★边界宿主 id = `boundaryNodeId + mount.treeOffset`（边界 id 是**该树 local 空间**的，
    //     顶层树 offset=0、嵌套挂载是子树的偏移——见 ComponentMount.treeOffset 注释）。
    const emitIndex = new Map<string, string>()
    for (const e of events) {
      if (e.componentEmit) emitIndex.set(`${e.nodeId}:${e.event}`, e.handler)
    }
    /**
     * ★★★**子组件事件路由**（P1-3 emits）：子组件自己的 `events`（nodeId 在**子模板 local 空间**）
     *   平移成宿主空间后并入派发索引，handler 名加 `@child:<序号>:` 前缀与父级区分。
     *   【为什么并入同一索引】手势链路只有一条（内核命中 → 链 → 派发）——子节点被点时
     *   与父节点走完全相同的路径；区别只在"跑哪个动作表"（子组件的）。
     */
    const mergedEvents: EventBinding[] = events.filter((e) => !e.componentEmit)
    for (let i = 0; i < childRuntimes.length; i++) {
      const cr = childRuntimes[i]!
      for (const e of cr.childEvents) {
        mergedEvents.push({ ...e, nodeId: e.nodeId + (cr.mount.idOffset ?? 0), handler: `@child:${i}:${e.handler}` })
      }
    }
    // 节点 → (事件 → handler)：宿主回来的 `(type, nodeId)` 据此找到该跑哪个 handler
    //   ★P2-3：索引与派发语义由 `@proteus-vue/slot-runtime` 提供（三端共用一份；
    //     含 `.stop`/`.self`/`.once` 修饰符语义与 `.once` 状态）
    const byNodeEvent = indexEventBindings(mergedEvents)
    const dispatchState = createDispatchState()
    rep.ev_modifiers = events.filter((e) => e.stop || e.self || e.once).length

    /** 跑一个 handler：按序执行动作（先算后写 ⇒ 顺序语义保留）★`$event` 可被载荷注入 */
    const runHandler = (name: string, _nodeId?: number, payload?: unknown): boolean => {
      const acts = handlers[name]
      if (!acts) return false
      for (const a of acts) {
        if ((a as { op: string }).op === 'emit') continue // 顶层 handler 里的 $emit 无处可去（如实 note，见 runChildHandler）
        const ctx2 = { read: (n: string) => (n === '$event' ? payload : data[n]) }
        const v = evalExpr(a.program as never, ctx2 as never)
        const cur = data[a.source]
        if (a.op === 'set') {
          data[a.source] = v
        } else {
          // add：数值累加（非数以 0 起——与 JS 的 `+` 语义不同，这里刻意收窄到数值：见 compileEvents 的形态说明）
          const base = typeof cur === 'number' && Number.isFinite(cur) ? cur : 0
          const delta = typeof v === 'number' && Number.isFinite(v) ? v : 0
          data[a.source] = base + delta
        }
      }
      return true
    }
    /**
     * ★★★**子组件 handler 执行 + $emit 路由**（P1-3 emits）。
     *
     * 【链路】子节点被点 → 派发到子组件的动作表（`@child:<i>:<h>`）→ 动作在**子作用域**求值
     *   （props/data/父级 read —— 与子运行时的求值上下文同源 `mount.ctx`）→ 遇 `emit` 动作：
     *   查 `emitIndex`（边界宿主 id + 事件名）→ 命中则跑**父级 handler**（`$event` = 载荷）。
     *
     * 【诚实边界（本条要在报告里可见，不静默）】① 子组件 handler 里的 `set`/`add`
     *   （子组件内部状态）本批**不生效**——子组件没有响应式状态（data 是构建期快照，
     *   见 instantiate 的边界说明）⇒ 记 note；② 子 emit 无对应父级监听 ⇒ 记 note（Vue 同样静默，
     *   但本仓纪律是"不静默"，至少留痕）。
     */
    const emitLog: Array<{ event: string; payload: unknown; routed: boolean; handler?: string }> = []
    const runChildHandler = (idx: number, name: string): boolean => {
      const cr = childRuntimes[idx]
      if (!cr) return false
      const acts = cr.childHandlers[name]
      if (!acts) return false
      for (const a of acts) {
        if (a.op === 'emit') {
          const evName = String(a.event ?? '')
          const payload = a.program ? evalExpr(a.program as never, cr.mount.ctx as never) : undefined
          const boundaryHostId = cr.mount.boundaryNodeId + (cr.mount.treeOffset ?? 0)
          const parentHandler = emitIndex.get(`${boundaryHostId}:${evName}`)
          if (!parentHandler) {
            emitLog.push({ event: evName, payload, routed: false })
            notes.push(`子组件 ${cr.mount.name} 的 $emit('${evName}') 没有父级监听（边界 ${boundaryHostId}）——未路由`)
            continue
          }
          runHandler(parentHandler, undefined, payload)
          emitLog.push({ event: evName, payload, routed: true, handler: parentHandler })
          continue
        }
        // 子组件内部状态：本批不支持（子组件无响应式状态——见注释的诚实边界）
        notes.push(`子组件 ${cr.mount.name} 的 handler 动作 \`${String(a.op)}\`（改 ${String(a.source)}）不生效——子组件无可变状态（构建期快照）`)
      }
      return true
    }

    /**
     * ★★**手势回调**（宿主 → JS 的反向通道）：注册到全局供 JNI 调用。
     * 返回本帧变化读数（指令字节数 + 源变化后的值），供宿主/判据记账。
     * ★2026-10-02：回调签名带 `chainJson`（冒泡链），**沿链派发**（此前只看 target 本身）。
     */
    const gestureHits: Array<{ tap: number; hit: number; chain: number[]; fired: number[]; handler: string; source_after: unknown; stopped?: boolean; skipped_self?: number[] }> = []
    ;(globalThis as unknown as Record<string, unknown>).__proteusVaporGesture = (type: string, nodeId: number, chainJson?: string): string => {
      const chain = parseChain(chainJson, nodeId)
      const before = { ...data }
      // ★P1-3 emits：派发走**路由化 run**——`@child:<i>:<h>` 前缀转到子组件动作表（见 runChildHandler）
      const hit = dispatchChainA(chain, type, byNodeEvent, dispatchState, (h: string, id: number) => {
        const m = /^@child:(\d+):(.+)$/.exec(h)
        if (m) return runChildHandler(Number(m[1]), m[2]!)
        return runHandler(h, id)
      })
      const handler = hit.handler
      if (!handler) return JSON.stringify({ ok: false, reason: `链 ${chain.join('>')} 上没有 ${type} 的 handler` })
      const ran = true
      // 触发订阅（源变化 → 按行/标量 diff → 二进制指令）
      const fire = triggers.get('list')
      // 本夹具的 tap 源（tapCount / boxW）不在 `list`，故**全源 relink**（参考实现形态：
      //   生产可按下标订源——`relink` 是"全量重算 + diff"，正确性优先）
      if (fire) fire()
      vapor.relink(ctx)
      slotRt.flush()
      const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
      const changedSources: Record<string, unknown> = {}
      for (const k of Object.keys(data)) {
        if (before[k] !== data[k]) changedSources[k] = data[k]
      }
      // ★★**把指令真的发给内核**并读回执（2026-10-01 修正：此前只报 JS 侧字节数 = 弱证据，
      //   而"数据变了屏幕没变"正是弱证据掩盖的形态——宿主回执才有 applied/relayout/changed）
      let applied = -1
      let relayout = -1
      let changedN = 0
      if (payload.length > 0) {
        try {
          const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(payload)))) as {
            ok?: boolean; applied?: number; relayout_count?: number; rects?: Record<string, unknown>; error?: string
          }
          applied = ao.ok ? (ao.applied ?? -1) : -2
          relayout = ao.relayout_count ?? -1
          changedN = ao.rects ? Object.keys(ao.rects).length : 0
        } catch {
          applied = -3
        }
      }
      gestureHits.push({
        tap: gestureHits.length + 1, hit: nodeId, chain, fired: hit.fired, handler, source_after: changedSources,
        // ★P2-3：终止/跳过读数（判据核「修饰符真的生效」——既有形态下恒 false/[]）
        stopped: hit.stopped, skipped_self: hit.skippedSelf,
      })
      return JSON.stringify({
        ok: ran, handler, fired: hit.fired, changed: changedSources, ops: payload.length,
        applied, relayout, changed_rects: changedN,
      })
    }
    if (typeof proteusHost.onGesture === 'function') {
      proteusHost.onGesture('__proteusVaporGesture')
    }

    // 几何真值探针：挑**第 2 行**的宽度槽位节点（首行是模板 id，命中它证明不了什么）
    const itemSlots = table.sources.flatMap((s2) => s2.slots).filter((x) => x.kind === 'list-item')
    const widthSlot = itemSlots.find((x) => x.propKey === 'layout.width')
    const probeId = widthSlot ? registry.resolveNode(widthSlot.listId!, '2', widthSlot.itemSlotId!) : undefined
    const rectsOf = (): Record<string, { width?: number }> => {
      try {
        const ro = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { width?: number }> }
        return ro.rects ?? {}
      } catch {
        return {}
      }
    }
    const before = probeId !== undefined ? (rectsOf()[String(probeId)]?.width ?? -1) : -1

    const updates = Math.max(0, args.updates ?? 3)
    const evidence: VaporReport['update_evidence'] = []
    for (let r = 0; r < updates; r++) {
      // 改数据（文本 + 宽度各一处，覆盖两类槽位）——第 2 行固定参与（与探针同源）
      const list = data.list as Array<{ id: number; w: number; title: string }>
      if (list.length < 2) break
      const at = r % Math.min(list.length, rows)
      list[at]!.title = `upd ${r}`
      list[at]!.w = 60 + (r % 4) * 20

      const to = t()
      const fire = triggers.get('list')
      if (!fire) {
        notes.push(`第 ${r} 轮：订阅表里没有 'list' 源（编译器未产出该源？）`)
        break
      }
      fire()               // 订阅触发：源变化 → onChange → 按行 diff → 只发变化行的指令
      slotRt.flush()       // 一次提交（每帧一次跨边界调用的前提）
      rep.ops_ms += t() - to

      const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
      rep.ops_bytes += payload.length
      if (!payload.length) {
        notes.push(`第 ${r} 轮：订阅表未产出指令（槽位未命中？）`)
        continue
      }
      const ta = t()
      const applyOut = proteusHost.applyOps(JSON.stringify(Array.from(payload)))
      rep.apply_ms += t() - ta
      const ao = JSON.parse(applyOut) as {
        ok?: boolean; applied?: number; rects?: Record<string, unknown>
        relayout?: number; text_synced?: number; text_synced_total?: number; error?: string
        /** ★P2-2：内核回执里最后一次文本更新的 {id, text}（宿主落绘制真源前的那份完整串） */
        text_probe?: { id: number; text: string }
      }
      if (ao.ok !== true) {
        notes.push(`第 ${r} 轮 applyOps 失败：${ao.error ?? ''}`)
        continue
      }
      const changed = ao.rects ? Object.keys(ao.rects).length : 0
      // ★P2-2：记录内核回执里的文本串（宿主已消费；判据核"完整拼接"没有退化）
      const probe = (ao as { text_probe?: { text?: string } }).text_probe
      if (probe?.text) rep.text_probe_rounds.push(String(probe.text))
      evidence.push({
        round: r, row: at + 1, ops: payload.length, changed_rects: changed,
        relayout: ao.relayout ?? -1,
        // ★文本同步（本批修的"读了没入表"缺陷的**回归锁**）：内核回 text_updates，
        //   宿主必须消费并把新文本落到绘制真源（否则文字改了屏幕还是旧字）
        text_synced: ao.text_synced ?? -1,
      })
      rep.text_synced_total += ao.text_synced ?? 0
      rep.updates_run++
    }
    rep.update_evidence = evidence

    /* ═══════════════ ★★交互闭环：注入 tap → 跑 handler → 几何真值对比 ═══════════════ */
    //
    // 【为什么由宿主注入 tap（不是 `adb shell input tap`）】真机 `input` 需 INJECT_EVENTS
    //   权限（本仓实测多次静默失败）⇒ 宿主 `dispatchTouchEvent` 注入真 MotionEvent，
    //   走完整 GestureDetector → hitTest → 语义手势 → 回调链（与真实触摸同一条路）。
    //
    // 【夹具体的按钮几何】宿主按**内核真值**取按钮节点的 rect（判据侧不在 JS 里算坐标——
    //   "几何只在核心里算"的纪律）。
    const tapButtons = events.filter((e) => e.event === 'tap')
    if (typeof proteusHost.tapAt === 'function' && tapButtons.length > 0) {
      for (const btn of tapButtons) {
        const rAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { x: number; y: number; width: number; height: number }> }
        const r = rAll.rects?.[String(btn.nodeId)]
        if (!r) continue
        const cx = r.x + r.width / 2
        const cy = r.y + r.height / 2
        // ① 点前：本次 handler 关心的源 + 全部几何签名（真值）
        const before = { ...data }
        const geomBefore = r.height  // 按钮自身高度（tap 不改它；用**被改节点的几何**更有意义）
        // ①b 采集"改前"的内核几何全表（逐 id —— 与改后比"哪几个节点真的动了"）
        let rectsBeforeTap: Record<string, { x: number; y: number; width: number; height: number }> = {}
        try {
          const rb = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { x: number; y: number; width: number; height: number }> }
          rectsBeforeTap = rb.rects ?? {}
        } catch {
          /* 缺读数 ⇒ 下面按 0 差异判（判据会红） */
        }
        // ② 注入 tap（宿主机内 → 命中 → 回调 → handler 已跑完，返回时数据已变）
        const tapOut = JSON.parse(proteusHost.tapAt(JSON.stringify({ x: cx, y: cy }))) as {
          ok?: boolean; gestures_fired?: number; dispatched?: number; last?: { type?: string; target?: number }
        }
        // ★★本次注入**真的触发了手势**才认 last（防陈旧探针；见宿主 tapAt 注释——
        //   连续注入会被 GestureDetector 判成双击吞掉，而 last 会读到上一次的旧值）
        const tapFired = tapOut.gestures_fired === 1
        if (!tapFired) {
          notes.push(`tap@${btn.nodeId} 未触发手势（gestures_fired=${tapOut.gestures_fired ?? '缺失'}）——读数不可信`)
        }
        // ★tapAt 是同步的：返回时 JS 回调（handler + applyOps）已跑完——回执在 gestureHits 末条
        rep.taps++
        // ③ 本次变化
        const changedSources: Record<string, unknown> = {}
        for (const k of Object.keys(data)) if (before[k] !== data[k]) changedSources[k] = data[k]
        // ④ ★几何真值（内核真源）：**被 handler 改的那个源，对应的节点几何变了吗**
        //    夹具的两个按钮的 handler 分别改 `tapCount`（文本源）与 `boxW`（宽度源）——
        //    `boxW` 改的是**行内 :width 绑定**（节点 12 一类），故这里比对"全表矩形签名"
        //    （改前/改后各读一次内核真源，逐 id 比 width/height/x/y）。
        let geomChanged = 0
        let geomAfter = 0
        let geomDiffIds: number[] = []
        try {
          const afterAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { x: number; y: number; width: number; height: number }> }
          const after = afterAll.rects ?? {}
          geomAfter = Object.keys(after).length
          const before = rectsBeforeTap
          geomDiffIds = Object.keys(after)
            .filter((k) => {
              const a = after[k]; const b = before[k]
              if (!b || !a) return true
              return a.width !== b.width || a.height !== b.height || a.x !== b.x || a.y !== b.y
            })
            .map((k) => Number(k))
          // ★诊断：把"被点节点自身"的宽度也记下来（判定"几何变的是不是它"）
          const selfBefore = before[String(btn.nodeId)]?.width
          const selfAfter = after[String(btn.nodeId)]?.width
          if (selfBefore !== undefined || selfAfter !== undefined) {
            notes.push(`tap@${btn.nodeId} 自身宽度 ${selfBefore} → ${selfAfter}` + (geomDiffIds.length === 0 ? '（几何无差异——可疑）' : ''))
          }
          geomChanged = geomDiffIds.length
        } catch {
          /* 读数失败 ⇒ 判据按缺失判红 */
        }
        const lastHit = gestureHits.length > 0 ? gestureHits[gestureHits.length - 1]! : null
        rep.tap_evidence.push({
          tap: rep.taps,
          hit: tapFired ? (tapOut.last?.target ?? -1) : -1,   // ★未触发手势 ⇒ 不认陈旧 last
          // ★冒泡链 + 逐跳派发（2026-10-02：判据据此核"链没断、祖先 handler 真的跑了"）
          chain: lastHit?.chain ?? [],
          fired: lastHit?.fired ?? [],
          handler: lastHit?.handler ?? '',
          source_after: lastHit?.source_after ?? null,
          // ★P2-3：该次 tap 是否被 .stop 终止（判据 ⑨ 用；无修饰符时恒 false）
          stopped: lastHit?.stopped ?? false,
          skipped_self: lastHit?.skipped_self ?? [],
          ops: tapOut.ok ? 1 : 0,
          changed_rects: geomChanged,
          geom_before: geomBefore,
          geom_after: geomAfter,
          geom_diff_ids: geomDiffIds,
        })
        void changedSources
      }
    }

    /* ═══════════ ★★P2-5 门禁轮（2026-10-03）：v-once 冻结 / v-memo 组门 ═══════════
     *
     * 【为什么单独一轮】前面几轮的判据是"改了数据 ⇒ 必须发指令"；而 P2-5 的语义恰好相反：
     *   **该跳过的必须跳过**（once 冻结 / memo 依赖净）。"没发指令"必须被区分成
     *   「正确跳过」与「链路断了」——区分方式 = 同一轮里既有**应跳过**的源、也有**应放行**的源。
     */
    const gateRounds: Array<{ name: string; ops: number; texts: string[]; expect_skip: boolean }> = []
    const gateTextNodes: Array<{ name: string; entries: Array<{ nodeId: number; text: string }> }> = []
    if (triggers.has('onceVal') || triggers.has('memoDep')) {
      // ★逐节点定位（P2-5 判据要"精确到节点"）：once 槽位的模板 nodeId 直接是**首行实例 id**
      //   （静态节点用模板序 id）；memo 槽位同理。
      const allSlotsFlat = table.sources.flatMap((s3) => s3.slots)
      rep.once_node_id = allSlotsFlat.find((x) => x.once)?.nodeId ?? -1
      rep.memo_node_id = allSlotsFlat.find((x) => x.memoId !== undefined)?.nodeId ?? -1
      const runGate = (name: string, mut: () => void, expectSkip: boolean): void => {
        mut()
        for (const [, cb] of triggers) cb()
        vapor.relink(ctx)
        slotRt.flush()
        const payload = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
        captured.length = 0
        const texts: string[] = []
        const entries: Array<{ nodeId: number; text: string }> = []
        if (payload.length > 0) {
          const d = decodeOps(payload)
          for (const op of d.ops) {
            if (op.op === OpCode.SET_TEXT) {
              const t = String(d.strings.valueOf((op as { textRef: number }).textRef))
              texts.push(t)
              entries.push({ nodeId: (op as { nodeId: number }).nodeId, text: t })
            }
          }
          try {
            proteusHost.applyOps(JSON.stringify(Array.from(payload)))
          } catch {
            /* 回执失败不阻断（判据看 JS 侧的"发了什么"） */
          }
        }
        gateRounds.push({ name, ops: payload.length, texts, expect_skip: expectSkip })
        gateTextNodes.push({ name, entries })
      }
      // ① v-once：改源 ⇒ 必须**跳过**（冻结）
      runGate('once-frozen', () => { data.onceVal = 42 }, true)
      // ② 对照：同轮改**普通**文本源（无 once）⇒ 必须放行（证明"跳过"不是链路断了）
      runGate('plain-updated', () => { data.tapCount = 7; (data.list as Array<{ title: string }>)[0]!.title = 'gate' }, false)
      // ③ v-memo 依赖净（改 memoVal、依赖 memoDep 不动）⇒ 跳过
      runGate('memo-clean', () => { data.memoVal = 99 }, true)
      // ④ v-memo 依赖脏（改 memoDep）⇒ 放行，且写出**最新** memoVal
      runGate('memo-dirty', () => { data.memoDep = 1 }, false)
      rep.gate_rounds = gateRounds
      rep.gate_text_nodes = gateTextNodes
    }

    /* ═══════════ ★★★P3-3 过渡驱动轮（2026-10-03）：改可见性 ⇒ 过渡真的交给宿主 ═══════════
     *
     * 【为什么单独一轮】`<Transition>` 的语义是"**可见性变化时**播动画"——它既不在首帧
     *   （初始不可见 ⇒ 无变化），也不在常规数据更新里（改的是别的源）。
     *   ⇒ 必须**显式制造一次可见性翻转**（`trVisible: false → true`），
     *     然后核：运行时有事件、模板有声明、宿主有动画（三层缺一不可）。
     */
    /* ═══════════ ★★★P1-3 组件 props 上行轮（2026-10-03）═══════════
     *
     * 【为什么单独一轮】props 的**下行**在首帧就能验（子节点带值）；而**上行**必须有一次
     *   "父源变化"才发生 ⇒ 显式改 `kidLabelW` 并核"子节点的宽度真的跟着变"。
     *   ★判据读的是**子节点探针**（不是"发了指令"）——指令发错节点也满足前者（本仓实测过）。
     */
    if (triggers.has('kidLabelW') && childRuntimes.length > 0) {
      // ★探针节点 = 组件子树里那个 p-text（判据核它的文本/宽度是否来自 props）
      //   ——用挂载记录的 nodeIds 过滤（不必依赖挂载顺序，也不必猜 id 规律）。
      const kidNodeIds = new Set(childRuntimes.flatMap((cr) => cr.mount.nodeIds))
      const kidText = inst.nodes.find((n) => kidNodeIds.has(n.id) && (n as { tag?: string }).tag === 'p-text')
      const kidTextNodeId = kidText?.id
      rep.component_kid_probe = {
        text: kidText ? String((kidText as { text?: string }).text ?? '') : undefined,
        width: kidText ? ((kidText as { width?: number }).width ?? undefined) : undefined,
      }
      // ★★上行判据的**内核几何真值**基线（不是"发了指令"——指令发错节点/写错键也会"发出去了"）：
      //   改数据前先读一次内核矩形（读不到 = undefined ⇒ 判据按缺失判红，不静默放行）。
      const kidRectBefore = kidTextNodeId !== undefined ? rectsOf()[String(kidTextNodeId)]?.width : undefined
      propCallLog.length = 0   // ★只统计**本轮**的 props 回调（否则日志混入历史 relink 的旧值）
      data.kidLabelW = 99
      data.kidLabel = 'k9'
      for (const [, cb] of triggers) cb()
      vapor.relink(ctx)
      slotRt.flush()
      for (const cr of childRuntimes) cr.runtime.flush()
      // ★★本轮可能有多条（父 relink 一条 + 各子运行时各一条）——**逐条都发给宿主**
      //   （首版只取最后一条 ⇒ 若子组件指令在前就漏发；本仓实测：子sink产出=3 而主链路取到 0）
      const kidPayloads = captured.slice()
      captured.length = 0
      for (const pl of kidPayloads) {
        if (pl.length === 0) continue
        try { proteusHost.applyOps(JSON.stringify(Array.from(pl))) } catch { /* 回执失败不阻断 */ }
      }
      // ★上行后从**全部本轮指令**里读子节点的新宽度（实例树是首帧快照，不会自己变）。
      //   ★必须遍历 `captured` **全部条目**（本仓实测的坑）：父级 relink 与子运行时各自 flush
      //     一次 ⇒ `captured` 有**两条**（父的在前、子的在后）；首版只取最后一条
      //     （`captured[length-1]`）——若子组件的指令恰在**前一条**，就读不到它的宽度（实测 None）。
      let afterW: number | undefined
      // ★逐个 payload 找子节点的宽度指令（见上：本轮可能有多条——父/子各自的 flush）
      //   ★★用 **payload 自带的键表**（`d.keys`）而不是桥的全局 `keys`（本仓实测的真缺陷）：
      //     `decodeOps` 返回的是**该 payload 内联的**键表（只含它用到的键，首现顺序由各运行时
      //     自己的 intern 顺序决定）——查全局表会得到**错的键名**（实测：keyId=0 在全局表里是
      //     `text.content`、在子 payload 里才是 `layout.width`）⇒ 判据永远读不到宽度。
      for (const b of kidPayloads) {
        try {
          const d = decodeOps(b)
          for (const op of d.ops) {
            if (op.op === OpCode.SET_STYLE) {
              const k = d.keys.keyOf((op as { keyId: number }).keyId)
              if (k === 'layout.width' && kidTextNodeId !== undefined && (op as { nodeId: number }).nodeId === kidTextNodeId) {
                afterW = (op as { value: number }).value
              }
            }
          }
        } catch { /* 单条解码失败不阻断其余（判据按缺失处理） */ }
      }
      rep.component_kid_probe = { ...rep.component_kid_probe, ...(afterW !== undefined ? { width_after: afterW } : {}) }
      // ★★上行**内核真值**（独立于指令解码的第二证据）：applyOps 后重读内核矩形——
      //   子节点的宽度必须真变（读不到 = 内核没这节点/没重排 ⇒ 判据缺失判红）。
      //   【为什么第二证据不可省（本仓实测）】只核"指令值"时，指令写到**别的节点**
      //   也可能值对（判据曾经用全局键表把 keyId=0 读成 text.content 还判过——见上）。
      const kidRectAfter = kidTextNodeId !== undefined ? rectsOf()[String(kidTextNodeId)]?.width : undefined
      rep.component_kid_probe = {
        ...rep.component_kid_probe,
        rect_before: kidRectBefore,
        rect_after: kidRectAfter,
      }
    }

    /* ═══════════ ★★★P1-3 emits 轮（2026-10-03）：子组件 $emit → 父级 handler → 内核几何 ═══════════
     *
     * 【链路】宿主 tap 子组件里的 emit 按钮 → 内核 hitTest → 冒泡链 → 派发到**子组件动作表**
     *   （mergedEvents 里的 `@child:i:h`）→ `$emit('bump', labelW)` → emitIndex 查「边界 + 事件名」
     *   → 跑**父级 handler**（`bumpTotal = $event + 100`）→ 父 relink → SET_STYLE → 内核重排。
     * 【判据读什么】① emit 记录（事件名/载荷/是否路由）② 父级落点源 ③ 锚节点**内核宽度**
     *   前后对比——"handler 跑了"与"几何真变"是两件事（本仓两类失效都踩过），故两者都记。
     */
    if (childRuntimes.length > 0 && typeof proteusHost.tapAt === 'function') {
      const emitBtn = inst.nodes.find((n) => (n as { text?: string }).text === 'emit-btn')
      // 锚节点 = 绑 `:width="bumpTotal"` 的那个节点（从订阅表反查——不猜 id 规律）
      const anchorSlot = table.sources
        .find((s) => s.sourceName === 'bumpTotal')
        ?.slots.find((sl) => sl.kind === 'style' && sl.propKey === 'layout.width')
      const anchorId = anchorSlot?.nodeId   // ★顶层树：idOffset = 0 ⇒ local id 即宿主 id
      if (emitBtn && anchorId !== undefined) {
        const rectsNow = rectsOf()
        const btnRect = rectsNow[String(emitBtn.id)] as { x?: number; y?: number; width?: number; height?: number } | undefined
        const geomBefore = rectsNow[String(anchorId)]?.width ?? -1
        emitLog.length = 0
        if (btnRect && typeof btnRect.x === 'number' && typeof btnRect.y === 'number') {
          const tapOut = JSON.parse(proteusHost.tapAt(JSON.stringify({
            x: btnRect.x + (btnRect.width ?? 0) / 2,
            y: btnRect.y + (btnRect.height ?? 0) / 2,
          }))) as { ok?: boolean; gestures_fired?: number; last?: { target?: number } }
          if (tapOut.gestures_fired !== 1) {
            notes.push(`emits 探针：tap 未触发手势（gestures_fired=${tapOut.gestures_fired ?? '缺失'}）——读数不可信`)
          }
        } else {
          notes.push(`emits 探针：emit 按钮（节点 ${emitBtn.id}）没有内核矩形——tap 无法注入`)
        }
        const rectsAfter = rectsOf()
        rep.emit_probe = {
          emits: emitLog.slice(),
          parent_source_after: data.bumpTotal,
          geom_before: geomBefore,
          geom_after: rectsAfter[String(anchorId)]?.width ?? -1,
        }
      } else {
        notes.push('emits 探针：夹具缺 emit 按钮或 bumpTotal 锚（节点未找到）——判据按缺失处理')
      }
    }

    /* ═══════════ ★★★P1-3 生命周期轮（2026-10-03）：@vue:mounted → 动作表 → 内核几何 ═══════════
     *
     * 【语义（本批的定义）】端上无"DOM 插入"动作 ⇒ mounted 定义为「**首帧 mount 完成之后**，
     *   把钩子动作跑一遍并路由到订阅更新链」（改源 ⇒ relink → 指令 → 内核重排——与 Vue 的
     *   "mounted 里改状态触发更新"**同一条链**）。
     * 【为什么此刻跑】上面 `proteusHost.mount()` 已成功（首帧树在内核里）——mounted 的语义
     *   是"挂载完成"，跑太早（挂载前）违语义、跑太晚（用户交互后）测不到。
     * 【诚实边界】动作在**顶层树作用域**求值（`@vue:mounted` 写在模板节点上——与 events 同一
     *   动作表语义）；`@vue:unmounted` / v-if 结构摘除未支持（编译期精确诊断——静态树模型
     *   没有"卸载时点"）。
     */
    {
      const lifecycle = (artifacts as { lifecycle?: Array<{ nodeId: number; phase: string; handler: string }> }).lifecycle ?? []
      if (lifecycle.length > 0) {
        // 锚 = 该绑定节点自身：核它的**内核宽度**在钩子前后真的变（夹具里钩子改 lifeW 而宽度绑它）
        const lifeNode = lifecycle[0]!
        const rectsBefore = rectsOf()
        const geomBefore = rectsBefore[String(lifeNode.nodeId)]?.width ?? -1
        const beforeVals = { ...data }
        let ranHandler = ''
        // ★动作表执行**复用 runHandler**（与事件同一套"先算后写"语义——一处实现）
        if (runHandler(lifeNode.handler)) ranHandler = lifeNode.handler
        // 路由到订阅更新链（改源 ⇒ 重算槽位 ⇒ 发指令 ⇒ 内核重排）
        vapor.relink(ctx)
        slotRt.flush()
        const lifePayloads = captured.slice()
        captured.length = 0
        let appliedTotal = 0
        for (const pl of lifePayloads) {
          if (pl.length === 0) continue
          try {
            const ao = JSON.parse(proteusHost.applyOps(JSON.stringify(Array.from(pl)))) as { ok?: boolean; applied?: number }
            appliedTotal += ao.applied ?? 0
          } catch { /* 回执失败不阻断（判据按几何真值判） */ }
        }
        const changedSources: Record<string, unknown> = {}
        for (const k of Object.keys(data)) if (beforeVals[k] !== data[k]) changedSources[k] = data[k]
        const rectsAfter = rectsOf()
        rep.lifecycle_probe = {
          bindings: lifecycle.map((b) => `${b.phase}@${b.nodeId}:${b.handler}`),
          ran_handler: ranHandler,
          changed_sources: Object.keys(changedSources),
          ops_bytes: lifePayloads.reduce((a, b) => a + b.length, 0),
          applied: appliedTotal,
          anchor_id: lifeNode.nodeId,
          geom_before: geomBefore,
          geom_after: rectsAfter[String(lifeNode.nodeId)]?.width ?? -1,
        }
      } else {
        rep.lifecycle_probe = { bindings: [], ran_handler: '', changed_sources: [], ops_bytes: 0, applied: 0, anchor_id: -1, geom_before: -1, geom_after: -1 }
      }
    }

    if (triggers.has('trVisible')) {
      const beforeTr = rep.transition_started
      data.trVisible = true
      for (const [, cb] of triggers) cb()
      vapor.relink(ctx)
      slotRt.flush()
      const payloadTr = captured.length ? captured[captured.length - 1]! : new Uint8Array(0)
      captured.length = 0
      if (payloadTr.length > 0) {
        try { proteusHost.applyOps(JSON.stringify(Array.from(payloadTr))) } catch { /* 回执失败不阻断 */ }
      }
      // ★过渡驱动（可见性翻转 → 查模板声明 → animStart）
      rep.transition_started = beforeTr + drainTransitions(tpl, vapor, notes)
    }

    // 说明：首帧的 `<Transition>`（`appear`）驱动**已在上方的过渡驱动轮里统一处理**——
    //   此处不再重复调用（本仓实测：重复调用会把 `transition_started` **覆盖回 0**，
    //   因为事件已被上一处 drain 取走 ⇒ 判据看到 0 ⇒ 误判"过渡没驱动"）。

    // 几何真值对比（内核真源：探针节点的宽度应随数据变——第 2 行参与每轮更新）
    if (probeId !== undefined) {
      const after = rectsOf()[String(probeId)]?.width ?? -1
      rep.geom_probe.push({ id: probeId, before, after })
    }

    // ★★绘制通道探针（5 个通道各一个节点：2 圆角 / 3 渐变 / 4 发光 / 5 裁剪 / 6 描边）
    try {
      const ch = JSON.parse(proteusHost.probeChannels('[2,3,4,5,6]')) as { ok?: boolean; channels?: Array<Record<string, unknown>> }
      if (ch.ok && ch.channels) rep.channels = ch.channels
    } catch {
      /* 探针失败不阻断主判据（notes 里会缺读数，判据按缺失判红） */
    }

    /* ═══════════ ★★★P1-3 插槽分发探针（2026-10-03）═══════════
     *
     * 【为什么独立挂载一份 slot 夹具树】插槽分发的验收对象是"**最终树**"（内容落位/后备遮蔽/
     *   孤儿不渲染），而主树（vapor-device.vue，28 节点）不含插槽结构——把它塞进主树会让
     *   既有的 14 项判据读数（节点数/文本/几何探针/门禁轮）全部漂移。⇒ 独立挂载、独立读数。
     * 【为什么读**内核**矩形而不是只看实例树】"树里有内容"与"内核里有几何"是两件事
     *   （本仓反复出现过的两类失效）——内容节点必须真被布局。
     * 【顺序】探针在主流程**全部读数之后**跑；结束后**重挂主树**，保证宿主侧读数
     *   （host_nodes/host_cmds/painted）仍是主树的（Java 侧读的是"最后一次 mount"）。
     */
    {
      const slotArt = (artifacts as { slot?: { tpl: LayoutTemplate; table: SubscriptionTable } }).slot
      if (slotArt?.tpl?.ok) {
        const slotDefs: Record<string, { template: LayoutTemplate; table?: SubscriptionTable }> = {}
        for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
          slotDefs[nm] = { template: def.tpl, table: def.table }
        }
        const slotRegistry = new ListRegistry()
        const slotInst = instantiateTemplate(slotArt.tpl, {
          viewport: args.viewport,
          read: () => undefined,
          table: slotArt.table,
          registry: slotRegistry,
          components: slotDefs,
        })
        try {
          const smOut = JSON.parse(
            proteusHost.mount(JSON.stringify({ viewport: slotInst.viewport, nodes: slotInst.nodes })),
          ) as { ok?: boolean; error?: string }
          if (smOut.ok === true) {
            // 内核几何：取内容节点的宽度（内容真被布局 ⇒ width > 0）
            const rectsAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { width?: number }> }
            const rects = rectsAll.rects ?? {}
            rep.slot_probe = {
              texts: slotInst.nodes
                .filter((n) => typeof n.text === 'string' && n.text.length > 0)
                .map((n) => String(n.text)),
              rects: slotInst.nodes
                .filter((n) => typeof n.text === 'string' && n.text.length > 0)
                .map((n) => ({ id: n.id, width: rects[String(n.id)]?.width ?? -1 })),
              fills: ((slotInst as { slotMounts?: Array<{ name: string; filled: boolean; contentIds: number[] }> }).slotMounts ?? [])
                .map((m) => ({ name: m.name, filled: m.filled, contentIds: m.contentIds })),
              markers_left: slotInst.nodes.filter((n) => (n as { slotFor?: unknown; slotOutlet?: unknown }).slotFor || (n as { slotFor?: unknown; slotOutlet?: unknown }).slotOutlet).length,
            }
          } else {
            notes.push(`插槽探针 mount 失败：${smOut.error ?? '未知'}`)
          }
        } catch (e) {
          notes.push(`插槽探针异常：${String((e as Error)?.message ?? e)}`)
        }
        // ★重挂主树（宿主读数归位——见上注释的顺序说明）
        try {
          proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
        } catch { /* 重挂失败不阻断：宿主读数会指向 slot 树，判据按 host_nodes 不符判红 */ }
      } else {
        notes.push('插槽探针：产物无 slot 段（夹具未覆盖 ⇒ 判据 ⑮ 按缺失处理）')
      }
    }

    /* ═══════════ ★★★P1-3 作用域插槽探针（2026-10-03）═══════════
     *
     * 【要证明什么】`#default="sp"` 内容真的按**出口 props** 求值了——
     *   ① 文本段（`cnt-{{ sp.count }}` ⇒ `cnt-7`）② **作用域样式**（`:width="sp.w"` ⇒ 内核宽度 70）。
     * 【为什么独立挂载】与 ⑮ 同一理由（不污染主树读数）；读数取**内核真值**（readRects）。
     */
    {
      const scopedArt = (artifacts as { scoped?: { tpl: LayoutTemplate; table: SubscriptionTable } }).scoped
      if (scopedArt?.tpl?.ok) {
        const scopedDefs: Record<string, { template: LayoutTemplate; table?: SubscriptionTable }> = {}
        for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
          scopedDefs[nm] = { template: def.tpl, table: def.table }
        }
        const scopedInst = instantiateTemplate(scopedArt.tpl, {
          viewport: args.viewport,
          // ★夹具的 `scopedN` 初值 7（与 SCODED_SFC 的 script 一致）——出口 props 的源头
          read: (n) => (n === 'scopedN' ? 7 : undefined),
          table: scopedArt.table,
          registry: new ListRegistry(),
          components: scopedDefs,
        })
        try {
          const scOut = JSON.parse(
            proteusHost.mount(JSON.stringify({ viewport: scopedInst.viewport, nodes: scopedInst.nodes })),
          ) as { ok?: boolean; error?: string }
          if (scOut.ok === true) {
            const rectsAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { width?: number }> }
            const rects = rectsAll.rects ?? {}
            // 锚 = 内容里那个带文本的节点（`cnt-` 前缀——判据不必猜 id 规律）
            const anchor = scopedInst.nodes.find((n) => typeof n.text === 'string' && n.text.startsWith('cnt-'))
            rep.scoped_probe = {
              texts: scopedInst.nodes
                .filter((n) => typeof n.text === 'string' && n.text.length > 0)
                .map((n) => String(n.text)),
              anchor_id: anchor?.id ?? -1,
              // ★节点字段（作用域样式写进去的）与**内核真值**（必须一致——"字段写了"与"内核认了"是两件事）
              anchor_width_field: anchor ? ((anchor as { width?: number }).width ?? -1) : -1,
              anchor_width_rect: anchor ? (rects[String(anchor.id)]?.width ?? -1) : -1,
            }
          } else {
            notes.push(`作用域插槽探针 mount 失败：${scOut.error ?? '未知'}`)
          }
        } catch (e) {
          notes.push(`作用域插槽探针异常：${String((e as Error)?.message ?? e)}`)
        }
        try {
          proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
        } catch { /* 同上：重挂失败 ⇒ 判据按 host_nodes 不符判红 */ }
      } else {
        notes.push('作用域插槽探针：产物无 scoped 段（夹具未覆盖 ⇒ 判据 ⑰ 按缺失处理）')
      }
    }

    /* ═══════════ ★★★P3 动态组件探针（2026-10-03）═══════════
     *
     * 【要证明什么】`<component :is="expr">` 的首帧解析真的组出**对应组件**的子树——
     *   ① 动态形态解析成 DynA（文本 DYNA 在、DYNB 不在——防"两个都渲染"/"一个都没渲染"）；
     *   ② 静态 `is="DynB"` 与静态组件等价（DYNB 在）；
     *   ③ 假值形态**整节点摘除**（不留空壳）；
     *   ④ 解析结果在**内核**里有几何（"树里有"与"内核认了"是两件事——本仓反复踩过）。
     * 【顺序】与其它探针同：主流程读数之后跑，结束后重挂主树（宿主读数归位）。
     */
    {
      const dynArt = (artifacts as { dyn?: { tpl: LayoutTemplate; table: SubscriptionTable } }).dyn
      if (dynArt?.tpl?.ok) {
        const dynDefs: Record<string, { template: LayoutTemplate; table?: SubscriptionTable }> = {}
        for (const [nm, def] of Object.entries(artifacts.components ?? {})) {
          dynDefs[nm] = { template: def.tpl, table: def.table }
        }
        const dynInst = instantiateTemplate(dynArt.tpl, {
          viewport: args.viewport,
          // ★夹具的 `dynWhich` 初值 'DynA'（与 DYN_SFC 的 script 一致）——动态解析的输入
          read: (n) => (n === 'dynWhich' ? 'DynA' : undefined),
          table: dynArt.table,
          registry: new ListRegistry(),
          components: dynDefs,
        })
        try {
          const dOut = JSON.parse(
            proteusHost.mount(JSON.stringify({ viewport: dynInst.viewport, nodes: dynInst.nodes })),
          ) as { ok?: boolean; error?: string }
          if (dOut.ok === true) {
            const rectsAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { width?: number }> }
            const rects = rectsAll.rects ?? {}
            const texts = dynInst.nodes
              .filter((n) => typeof n.text === 'string' && n.text.length > 0)
              .map((n) => String(n.text))
            rep.dyn_probe = {
              texts,
              // 解析出的组件边界节点（判据核"解析成了谁"——从挂载记录读，不猜 id 规律）
              mounts: (dynInst.componentMounts ?? []).map((m) => m.name),
              // 内容节点的**内核宽度**（> 0 = 内核真布局了该子树）
              geom: dynInst.nodes
                .filter((n) => typeof n.text === 'string' && n.text.length > 0)
                .map((n) => ({ id: n.id, width: rects[String(n.id)]?.width ?? -1 })),
              dropped: dynInst.stats.droppedNodeIds?.length ?? 0,
              notes: (dynInst.notes ?? []).slice(0, 4),
            }
          } else {
            notes.push(`动态组件探针 mount 失败：${dOut.error ?? '未知'}`)
          }
        } catch (e) {
          notes.push(`动态组件探针异常：${String((e as Error)?.message ?? e)}`)
        }
        try {
          proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
        } catch { /* 同上：重挂失败 ⇒ 判据按 host_nodes 不符判红 */ }
      } else {
        notes.push('动态组件探针：产物无 dyn 段（夹具未覆盖 ⇒ 判据 ⑲ 按缺失处理）')
      }
    }

    /* ═══════════ ★★★P3-5 宿主指令探针（2026-10-03）：v-animate 真的交给宿主动画 ═══════════
     *
     * 【要证明什么】自定义指令不是"编译期产物 + 一等诊断"就完了——`v-animate` 的三段语义要真跑：
     *   ① **首评 truthy ⇒ 播**（mounted 语义）② **值变化 ⇒ 再播**（updated 语义）③ **假值 ⇒ 不播**。
     *   每一段的证据都是**宿主回执**（`animStart` 的 started 计数——"报给宿主了"与"宿主收了"
     *   是两件事，本仓反复踩过）。
     * 【顺序】独立挂载 directive 夹具树（与 ⑮/⑰/⑲ 同规）⇒ 不污染主树读数；结束后重挂主树。
     */
    {
      const dirArt = (artifacts as { directive?: { tpl: LayoutTemplate; table: SubscriptionTable } }).directive
      if (dirArt?.tpl?.ok) {
        const dirInst = instantiateTemplate(dirArt.tpl, {
          viewport: args.viewport,
          read: () => undefined,
          table: dirArt.table,
          registry: new ListRegistry(),
        })
        try {
          const dOut = JSON.parse(
            proteusHost.mount(JSON.stringify({ viewport: dirInst.viewport, nodes: dirInst.nodes })),
          ) as { ok?: boolean; error?: string }
          if (dOut.ok === true) {
            // ★指令数据在**模板**上（节点 id 与实例树同源——顶层树 idOffset=0）
            const dirNodes = dirArt.tpl.nodes.filter((n) => (n as { directives?: unknown[] }).directives?.length)
            const animCalls: Array<{ nodeId: number; preset: string; started: number; fromValue: unknown; toValue: unknown }> = []
            // 指令触发状态：nodeId:name → 上一次的值 + 是否已见过（首评 = mounted 语义）
            const dirState = new Map<string, { prev: unknown; seen: boolean }>()
            /**
             * 跑一轮指令检查（与 `<Transition>` 的 drainTransitions 同一形态：查声明 → 报 animStart）。
             * @param values 本轮的值表（夹具按轮驱动——见下）
             */
            const runDirectiveRound = (values: Record<string, unknown>): number => {
              let startedTotal = 0
              for (const n of dirNodes) {
                const dirs = (n as { directives: Array<{ name: string; preset?: string; channels?: Array<{ kind: number; from: number; to: number }>; durMs?: number; curve?: number; value?: unknown; valueSrc?: string }> }).directives
                for (const d of dirs) {
                  // 值求值：夹具的驱动值表优先；有 valueSrc 时按名取，无（恒真）⇒ true
                  const cur = d.valueSrc !== undefined ? values[d.valueSrc] : true
                  const key = `${n.id}:${d.name}`
                  const st = dirState.get(key) ?? { prev: undefined, seen: false }
                  const should = directiveShouldPlay(st.prev, cur, st.seen)
                  dirState.set(key, { prev: cur, seen: true })
                  if (!should) {
                    animCalls.push({ nodeId: n.id, preset: d.preset ?? '', started: 0, fromValue: st.seen ? st.prev : undefined, toValue: cur })
                    continue
                  }
                  const channels = d.channels ?? []
                  const anims = channels.map((c) => ({
                    nodeId: n.id, kind: c.kind, from: c.from, to: c.to, durMs: d.durMs ?? 220, curve: d.curve ?? 1,
                  }))
                  let started = 0
                  if (anims.length > 0 && typeof proteusHost.animStart === 'function') {
                    try {
                      const out = JSON.parse(proteusHost.animStart(JSON.stringify({ anims }))) as { ok?: boolean; started?: number }
                      started = out.ok === true ? (out.started ?? anims.length) : 0
                    } catch { started = 0 }
                  }
                  startedTotal += started
                  animCalls.push({
                    nodeId: n.id, preset: d.preset ?? '', started,
                    fromValue: st.seen ? st.prev : undefined, toValue: cur,
                  })
                }
              }
              return startedTotal
            }
            // ① 首轮：pulse=true（falsy→truthy：**fromValue=false 是首评前写入的** ⇒ 用两轮表达）
            //    轮序：a) pulse=false（首评 falsy ⇒ 不播）b) pulse=true（变化 ⇒ 播：updated 语义）
            //          c) zoomTrigger=0（首评 falsy）d) zoomTrigger=1（变化 ⇒ 播）
            //          e) 恒真无值指令（slide-up）⇒ 首评即播（mounted 语义，在第一轮就播）
            const roundA = runDirectiveRound({ pulse: false, zoomTrigger: 0 })   // 恒真那条在此轮播
            const roundB = runDirectiveRound({ pulse: false, zoomTrigger: 0 })   // 同值 ⇒ 不播
            const roundC = runDirectiveRound({ pulse: true, zoomTrigger: 0 })    // pulse 变化 ⇒ 播一次
            const roundD = runDirectiveRound({ pulse: true, zoomTrigger: 1 })    // zoom 变化 ⇒ 播一次
            const roundE = runDirectiveRound({ pulse: false, zoomTrigger: 1 })   // pulse 变 false ⇒ 不播（falsy）
            rep.directive_probe = {
              nodes: dirNodes.map((n) => ({
                id: n.id,
                dirs: ((n as { directives: Array<{ name: string; preset?: string; channels?: unknown[] }> }).directives)
                  .map((d) => `${d.name}:${d.preset}:${d.channels?.length ?? 0}`),
              })),
              rounds: [
                { name: 'a:首评falsy', started: roundA },
                { name: 'b:同值', started: roundB },
                { name: 'c:pulse变true', started: roundC },
                { name: 'd:zoom变1', started: roundD },
                { name: 'e:pulse变false', started: roundE },
              ],
              plays: animCalls,
            }
          } else {
            notes.push(`宿主指令探针 mount 失败：${dOut.error ?? '未知'}`)
          }
        } catch (e) {
          notes.push(`宿主指令探针异常：${String((e as Error)?.message ?? e)}`)
        }
        try {
          proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
        } catch { /* 同上：重挂失败 ⇒ 判据按 host_nodes 不符判红 */ }
      } else {
        notes.push('宿主指令探针：产物无 directive 段（夹具未覆盖 ⇒ 判据 ⑳ 按缺失处理）')
      }
    }

    /* ═══════════ ★★★元素/文本混排探针（2026-10-03）═══════════
     *
     * 【要证明什么】`<p>文字 <b>x</b> 文字</p>` 的**每一段文本**都真的渲染了——
     *   ① 全部静态段在**内核树**里（此前整段丢失：只渲染元素）；
     *   ② 插值合成叶的**求值结果**在（段表 → 运行时拼接）；
     *   ③ 元素间单空格叶**保留**（Vue condense 语义——把真内容删掉是另一种静默错）；
     *   ④ 缩进换行**不产垃圾叶**（节点数守恒：合成叶总数与形态匹配）。
     *   【顺序】独立挂载 mixed 夹具树（与 ⑮/⑰/⑲/⑳ 同规）；结束后重挂主树。
     */
    {
      const mixArt = (artifacts as { mixed?: { tpl: LayoutTemplate; table: SubscriptionTable } }).mixed
      if (mixArt?.tpl?.ok) {
        const mixInst = instantiateTemplate(mixArt.tpl, {
          viewport: args.viewport,
          // ★夹具的 `mixN` 初值 4（与 MIXED_SFC 的 script 一致）——插值合成的输入
          read: (n) => (n === 'mixN' ? 4 : undefined),
          table: mixArt.table,
          registry: new ListRegistry(),
        })
        try {
          const mOut = JSON.parse(
            proteusHost.mount(JSON.stringify({ viewport: mixInst.viewport, nodes: mixInst.nodes })),
          ) as { ok?: boolean; error?: string }
          if (mOut.ok === true) {
            const rectsAll = JSON.parse(proteusHost.readRects()) as { rects?: Record<string, { width?: number }> }
            const rects = rectsAll.rects ?? {}
            const texts = mixInst.nodes
              .filter((n) => typeof n.text === 'string' && n.text.length > 0)
              .map((n) => String(n.text))
            rep.mixed_probe = {
              texts,
              // 合成叶总数（静态 + 段表叶——判据核与编译期一致，防"少合成多合成"）
              leaves: mixInst.nodes.filter((n) => n.tag === 'p-text' && (typeof n.text === 'string' && n.text.length > 0 || (n as { textSegments?: unknown[] }).textSegments?.length)).length,
              // 内核几何（合成叶有宽度 = 内核真布局了它们）
              geom: mixInst.nodes
                .filter((n) => typeof n.text === 'string' && n.text.length > 0)
                .map((n) => ({ id: n.id, text: String(n.text), width: rects[String(n.id)]?.width ?? -1 })),
            }
          } else {
            notes.push(`混排探针 mount 失败：${mOut.error ?? '未知'}`)
          }
        } catch (e) {
          notes.push(`混排探针异常：${String((e as Error)?.message ?? e)}`)
        }
        try {
          proteusHost.mount(JSON.stringify({ viewport: inst.viewport, nodes: inst.nodes }))
        } catch { /* 同上：重挂失败 ⇒ 判据按 host_nodes 不符判红 */ }
      } else {
        notes.push('混排探针：产物无 mixed 段（夹具未覆盖 ⇒ 判据 ㉑ 按缺失处理）')
      }
    }

    rep.ok = rep.updates_run > 0
    if (!rep.ok) notes.push('增量链未跑起来——见上方 notes')
    else notes.push(`实例树 ${inst.nodes.length} 节点 / 行 ${inst.stats.rows} / 虚拟化行 ${rep.inst_virtual_rows} / 增量 ${rep.updates_run} 轮`)
    return JSON.stringify(rep)
  } catch (e) {
    rep.error = (e as { message?: string })?.message ?? String(e)
    return JSON.stringify(rep)
  }
}

// ★挂到全局，供 Java 侧直接 eval 调用（IIFE 无模块系统——与其它 entry 同法）
;(globalThis as unknown as { __proteusVaporRun: typeof __proteusVaporRun }).__proteusVaporRun = __proteusVaporRun

export type { VaporReport }
