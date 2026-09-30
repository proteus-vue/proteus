<script setup lang="ts">
// website/src/pages/Animation.vue —— ★★Morpheus 动画引擎（旗舰产品页 · v2 视觉精修）
//
// 【v2 相比 v1 的升级（用户：「产品页做得还是太粗糙了，视觉效果包括排版要大幅升级」）】
//   · **Hero**：左文右真机（MobileStage）双栏构图 + 品牌光晕 + 网格底纹 + 数据 pills
//   · **三大杀手锏**：编号 01/02/03 + 图标底 + 关键数字三栏 + hover 抬升
//   · **演示区**：真机舞台（真指令）+ **指令时间轴**（按真实 durMs/delayMs 画的甘特条）+ 读数面板
//   · **预设库**：每张卡**真预设缩略预览**（PresetPreview——真编译真求值），不再只有文字
//   · **曲线**：真采样曲线 + 参考线 + 端点/实时数值三读数 + 滑杆
//   · **证据区**：表格 → **数据卡网格**（大数字 + 判据脚注）
//   · **滚动显现**：`data-reveal` 分节入场（与首页同机制；reduced-motion 直接终态）
//   · 零 @media / 零裸平台 API（D-2 + W-6 门禁守着）；响应式走柔性网格
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'
import MobileStage from '../components/anim/MobileStage.vue'
import PresetPreview from '../components/anim/PresetPreview.vue'
import { highlight } from '@proteus-vue/docs'
// ★真引擎：批次/规格/预设目录/跨语言契约常量
import { ANIM_KIND_ID, CURVE_ID, appTransitions, listAnimRules, routeTransitionBatches } from '@proteus-vue/animation'
import type { EngineAnim, RouteTransitionPlan } from '@proteus-vue/animation'
// ★真曲线求值（与 Rust 内核 golden 对拍的 TS 镜像）
import { curveEval } from '@proteus-vue/slot-runtime'

const isEn = computed(() => locale.value === 'en')
/** ★静态资产基路径（GitHub Pages 子路径部署：vite 的 BASE_URL 带前导斜杠） */
const base = import.meta.env.BASE_URL || '/'

/* ══════════════════════════════ 文案 ══════════════════════════════ */

const T = {
  zh: {
    chip: 'Morpheus · 声明式动画引擎',
    h1line1: '把动画变成',
    h1line2: '编译期问题',
    tagline: '会不会掉帧，编译期就知道。',
    lead: '一句话声明演出。曲线与物理在 Rust 内核求值，宿主零曲线数学；布局动画几乎白送，因为几何本来就在内核；转场直通系统渲染线程——不自绘，零主线程参与。',
    ctaDocs: '读文档',
    ctaDemo: '看真机演示',
    heroPills: ['Rust 内核求值', '零主线程参与', '编译期拦截'],
    stageCaption: '真指令驱动 · 非示意图',
    pillars: [
      {
        ic: 'layers',
        n: '01',
        title: '布局动画，几乎白送',
        desc: '传统 FLIP 要在变更前后各读一次几何——VDOM 框架里很贵。我们的几何本来就在 Rust 内核：两次快照都在内核完成，直接生成 Δ→0 补间，零跨边界查询。',
        metrics: [
          ['215', '节点同屏补间'],
          ['0.7ms', '帧耗时 p95'],
          ['0.08ms', '全量重排'],
        ],
      },
      {
        ic: 'bolt',
        n: '02',
        title: '转场零主线程参与',
        desc: '不自绘，所以直接用系统渲染线程（Android RenderThread / iOS CoreAnimation render server）。Flutter 自绘，才被迫自建 raster thread——我们不必。',
        metrics: [
          ['0', '动画期主线程绘制'],
          ['1.0ms', '600ms 窗口 CPU'],
          ['17.4ms', 'tick 路径对照'],
        ],
      },
      {
        ic: 'shield',
        n: '03',
        title: '编译期拦截，零静默降级',
        desc: '合成属性（transform / opacity）在编译期判定；转场里误改布局属性编译报错、宿主明确拒绝——「会不会掉帧」不再靠调参赌。',
        metrics: [
          ['5', '约束被编译期拦下'],
          ['26', '条 AI 说明书'],
          ['11/12', '验收项达标'],
        ],
      },
    ],
    showcaseTitle: '炫技场 · 真机跑给你看',
    showcaseLead:
      '800 片瓦片同屏编舞的**整场演出**：星尘凝聚 → 聚字开场语 → 涟漪 → 多米诺 → 风暴（800×5 条指令并发）→ 全量重排 ×2 → 漩涡 → 聚字谢幕语，共 12 幕一幕到底、幕间零停顿。**全部由一句句声明式编排写出来**（相位序 + 构型预设，无一行手写循环），曲线与物理在 Rust 内核求值。这不是录屏特效，是 iPhone 12 上一次跑完的真实读数。',
    showcaseNote: '★为什么"别人不敢试"：Web/VDOM 框架 800 节点逐节点动画 = 每帧 800 次样式写入 + 布局失效；RN/小程序每个节点是原生视图，800 视图同屏是内存与桥接的双重灾难；Flutter 能跑但走 Dart 层求值。我们把曲线/物理放在内核，每帧只跨一次边界。',
    showcaseImgAlt: 'Morpheus 炫技场真机截图：800 片瓦片聚成点阵文字 800 TILES，四周星尘环绕',
    showcaseCaption: '真机截图（iPhone 12 · 谢幕语定格）：800 片聚成 800 TILES',
    showcaseCmd: '复跑：bash hosts/ios/run-selfdraw.sh --showcase ｜ 演示 App：iPhone 上点开 Morpheus 即循环演出',
    demoTitle: '真机演示',
    demoNote: '演示播放的是引擎交给执行器的同一份指令（routeTransitionBatches）；曲线求值走与 Rust 内核 golden 对拍过的 TS 镜像。',
    dirLabel: '方向',
    dirFwd: 'push 新页进入',
    dirBack: 'pop 返回 · 镜像对',
    dismissNote: '★退场型预设：exit 描述"被关闭页下滑"——只有 pop 方向能看到它；forward 下新页静止（如实语义）',
    timeline: '指令时间轴',
    timelineNote: '每条动画按真实 durMs / delayMs 画成时间条——两页并发、一次提交。',
    readout: '引擎收到的指令（原样）',
    curveTitle: '曲线与内核同源',
    curveNote: '65 点采样表 + 线性插值；与 Rust 内核实测值对拍（容差 1e-5）、端点精确钉死 0 / 1。拖动滑杆——数值就是引擎每一帧用的值。',
    curveU: '进度 u',
    presetsTitle: '预设库',
    presetsNote: '预设优先于参数——常见演出都是一句话。缩略图由真预设真编译驱动（滚动与共享元素需外部驱动源，如实标注不假装）。',
    presetsMore: '另有',
    evidenceTitle: '真机证据',
    evidenceNote: '每一项都可复跑；数字来自真机读数，不是估算。',
    codeTitle: '怎么写',
    codeNote: '路由级一行声明，三端各自兑现；元素级一句话演出。',
    boundaryTitle: '诚实边界',
    boundaryNote: '还没做到的，逐条列出——宣称不得先于实现。',
    docCta: '完整文档：架构 / 声明面 / 转场 / 边界',
  },
  en: {
    chip: 'Morpheus · Declarative Animation Engine',
    h1line1: 'Animation is a',
    h1line2: 'compile-time question',
    tagline: 'Will it jank? You know at compile time.',
    lead: 'One line of declaration. Curves and physics are evaluated in the Rust kernel; hosts do zero curve math; layout animation is nearly free because the geometry already lives there; transitions ride the system render thread — no custom renderer, zero main-thread involvement.',
    ctaDocs: 'Read the docs',
    ctaDemo: 'See it on a device',
    heroPills: ['Kernel-evaluated', 'Zero main-thread', 'Compile-time gates'],
    stageCaption: 'Real instructions · not a mockup',
    pillars: [
      {
        ic: 'layers',
        n: '01',
        title: 'Layout animation, nearly free',
        desc: 'Classic FLIP reads geometry twice — expensive in a VDOM framework. Ours already lives in the Rust core: both snapshots happen inside the kernel, which emits the Δ→0 tween. Zero cross-boundary queries.',
        metrics: [
          ['215', 'nodes tweening'],
          ['0.7ms', 'frame cost p95'],
          ['0.08ms', 'full relayout'],
        ],
      },
      {
        ic: 'bolt',
        n: '02',
        title: 'Transitions, zero main thread',
        desc: 'Because we do not self-draw, transitions run on the system render thread (Android RenderThread / iOS CoreAnimation render server). Flutter self-draws and had to build its own raster thread — we do not.',
        metrics: [
          ['0', 'main-thread draws'],
          ['1.0ms', 'CPU per 600ms'],
          ['17.4ms', 'tick path control'],
        ],
      },
      {
        ic: 'shield',
        n: '03',
        title: 'Compile-time gates, no silent downgrade',
        desc: 'Composited properties (transform / opacity) are decided at compile time; touching layout properties inside a transition fails compilation and is rejected by the host — jank stops being a tuning gamble.',
        metrics: [
          ['5', 'constraints gated'],
          ['26', 'AI manual entries'],
          ['11/12', 'acceptance items met'],
        ],
      },
    ],
    showcaseTitle: 'Showcase · verified on a device',
    showcaseLead:
      'A full 12-act show on 800 tiles at once: stardust gathering → a clocked opening title → ripples → dominoes → a storm (800×5 concurrent instructions) → two full re-layouts → a spiral → a clocked finale, running end to end with no pause between acts. Every act is written as one declarative choreography (phase order + formation presets, zero hand-written loops), with curves and physics evaluated in the Rust kernel. Not a filmed effect: these are readings from one run on an iPhone 12.',
    showcaseNote: '★Why others do not attempt it: in Web/VDOM frameworks, animating 800 nodes means 800 style writes and a layout invalidation every frame; in RN/mini-programs every node is a native view, so 800 views on screen is a memory and bridge disaster; Flutter can do it but evaluates in Dart. We keep curves and physics in the kernel and cross the boundary once per frame.',
    showcaseImgAlt: 'Morpheus showcase device screenshot: 800 tiles forming the pixel text 800 TILES, ringed by stardust',
    showcaseCaption: 'Device screenshot (iPhone 12 · finale): 800 tiles spell out 800 TILES',
    showcaseCmd: 'Re-run: bash hosts/ios/run-selfdraw.sh --showcase | Demo app: tap Morpheus on iPhone for a looping show',
    demoTitle: 'Device demo',
    demoNote: 'The demo plays the very same instructions the engine hands to the executor (routeTransitionBatches); curve evaluation uses the TS mirror golden-tested against the Rust kernel.',
    dirLabel: 'Direction',
    dirFwd: 'push (new screen)',
    dirBack: 'pop (return · mirror pair)',
    dismissNote: '★Dismiss-type preset: exit describes the closing screen sliding away — only visible in the pop direction; in forward the new screen is static (honest semantics)',
    timeline: 'Instruction timeline',
    timelineNote: 'Every animation is drawn as a time bar using its real durMs / delayMs — two screens in parallel, one commit.',
    readout: 'Instructions the engine receives (verbatim)',
    curveTitle: 'Curves are kernel-sourced',
    curveNote: '65-point sampled table + linear interpolation; golden-tested against the Rust kernel (1e-5), endpoints pinned exactly to 0 / 1. Drag the slider — this is the value the engine uses every frame.',
    curveU: 'Progress u',
    presetsTitle: 'Preset library',
    presetsNote: 'Presets over parameters — common motions are one-liners. Thumbnails are driven by real presets compiled for real (scroll and shared elements need external drivers — honestly labelled, never faked).',
    presetsMore: 'Plus',
    evidenceTitle: 'Device evidence',
    evidenceNote: 'Every reading is re-runnable; numbers come from devices, not estimates.',
    codeTitle: 'How you write it',
    codeNote: 'One declaration per route, honoured per target; one line per element motion.',
    boundaryTitle: 'Honest boundaries',
    boundaryNote: 'What is not done yet, item by item — claims never precede implementation.',
    docCta: 'Full docs: architecture / surface / transitions / boundaries',
  },
} as const
const C = computed(() => T[isEn.value ? 'en' : 'zh'])

/* ══════════════════════════════ 演示状态 ══════════════════════════════ */

const TRANSITIONS = appTransitions()
const picked = ref('slideUp')
const direction = ref<'forward' | 'back'>('forward')

const plan = computed<RouteTransitionPlan>(() =>
  routeTransitionBatches(picked.value, { incoming: 1, outgoing: 2 }, { direction: direction.value }),
)
const hasAnims = computed(() => plan.value.incoming.anims.length + plan.value.outgoing.anims.length > 0)
const totalMs = computed(() => Math.max(1, plan.value.durationMs))

/**
 * ★★进场页的**形态**（面板 / 全屏页）——转场语义的一部分，不是装饰：
 *   · `halfScreen` 是"只动进场页 + `opaque:false`（下层可见）" ⇒ 进场页是**半屏面板**；
 *   · 其余转场是**全屏页**。
 * ★若把半屏渲染成全屏页：视觉变成"页面推入一半停住"，且 `opaque:false` 的声明被遮死
 *   （用户反馈「半屏这个对不上」的根因）。
 */
const stageShape = computed<'page' | 'sheet'>(() => (picked.value === 'halfScreen' ? 'sheet' : 'page'))
/**
 * ★**退场型**（dismiss，如 `slideDown`）：其 `exit` 描述"被关闭页下滑"（pop 语义）
 *   ⇒ 只有 **pop（返回）** 方向能看到它；forward 下新页静止（如实语义，不是 bug）。
 */
const isDismiss = computed(() => plan.value.role === 'dismiss')
watch(picked, () => {
  // 选中退场型 ⇒ 自动切到它有意义的方向（pop），让默认观感正确
  if (plan.value.role === 'dismiss' && direction.value === 'forward') direction.value = 'back'
})

/** 时间轴：每条动画按真实 delayMs/durMs 换算成甘特条 */
interface Bar {
  pane: 'in' | 'out'
  label: string
  curve: string
  left: number
  width: number
}
const KIND_LABEL: Record<number, string> = {
  [ANIM_KIND_ID.translateX]: 'translateX',
  [ANIM_KIND_ID.translateY]: 'translateY',
  [ANIM_KIND_ID.scale]: 'scale',
  [ANIM_KIND_ID.rotate]: 'rotate',
  [ANIM_KIND_ID.opacity]: 'opacity',
}
const CURVE_LABEL: Record<number, string> = {
  [CURVE_ID.linear]: 'linear',
  [CURVE_ID.easeOut]: 'easeOut',
  [CURVE_ID.easeIn]: 'easeIn',
  [CURVE_ID.easeInOut]: 'easeInOut',
  [CURVE_ID.springApprox]: 'springApprox',
}
const bars = computed<Bar[]>(() => {
  const total = totalMs.value
  const mk = (anims: readonly EngineAnim[], pane: 'in' | 'out'): Bar[] =>
    anims.map((a) => ({
      pane,
      label: KIND_LABEL[a.kind] ?? `kind ${a.kind}`,
      curve: CURVE_LABEL[a.curve] ?? `#${a.curve}`,
      left: (((a.delayMs ?? 0) / total) * 100),
      width: Math.max(7, ((a.durMs ?? 0) / total) * 100),
    }))
  return [...mk(plan.value.incoming.anims, 'in'), ...mk(plan.value.outgoing.anims, 'out')]
})

const compiledReadout = computed(() =>
  JSON.stringify(
    {
      direction: direction.value,
      transition: plan.value.transition,
      durationMs: plan.value.durationMs,
      incoming: plan.value.incoming.anims.map((a) => ({ nodeId: a.nodeId, kind: a.kind, from: a.from, to: a.to, curve: a.curve, durMs: a.durMs })),
      outgoing: plan.value.outgoing.anims.map((a) => ({ nodeId: a.nodeId, kind: a.kind, from: a.from, to: a.to, curve: a.curve, durMs: a.durMs })),
    },
    null,
    1,
  ),
)

/* ── 曲线区 ── */
const CURVES = Object.entries(CURVE_ID) as Array<[string, number]>
const curveId = ref<number>(CURVE_ID.easeOut)
const curveU = ref(0.5)
const curveValue = computed(() => curveEval(curveId.value, curveU.value))
const curvePath = computed(() => {
  const N = 64
  const pts: string[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const v = curveEval(curveId.value, u)
    pts.push(`${(u * 200).toFixed(1)},${(100 - v * 100).toFixed(1)}`)
  }
  return 'M' + pts.join(' L')
})
const marker = computed(() => ({ x: (curveU.value * 200).toFixed(1), y: (100 - curveValue.value * 100).toFixed(1) }))
const endpoints = computed(() => ({ at0: curveEval(curveId.value, 0).toFixed(4), at1: curveEval(curveId.value, 1).toFixed(4) }))

/* ── 预设区 ── */
const RULES = listAnimRules()
const PRESETS = RULES.filter((r) => r.kind === 'preset')
type PreviewKind =
  | 'route.slideUp'
  | 'route.bottomSheet'
  | 'route.zoom'
  | 'route.slideDown'
  | 'element.press'
  | 'element.shake'
  | 'element.fadeIn'
  | 'list.shift'
  | 'needs-scroll'
  | 'needs-geometry'
function previewOf(id: string): PreviewKind {
  if (id === 'preset/route.slideUp') return 'route.slideUp'
  if (id === 'preset/route.bottomSheet') return 'route.bottomSheet'
  if (id === 'preset/route.zoom') return 'route.zoom'
  if (id === 'preset/route.slideDown') return 'route.slideDown'
  if (id === 'preset/element.press') return 'element.press'
  if (id === 'preset/element.shake') return 'element.shake'
  if (id === 'preset/element.fadeIn') return 'element.fadeIn'
  if (id === 'preset/list.shift') return 'list.shift'
  if (id === 'preset/element.sharedElement') return 'needs-geometry'
  if (id.startsWith('preset/scroll.')) return 'needs-scroll'
  if (id.includes('cupertinoModal')) return 'route.bottomSheet'
  return 'element.fadeIn'
}
const ruleCounts = computed(() => ({
  primitive: RULES.filter((r) => r.kind === 'primitive').length,
  constraint: RULES.filter((r) => r.kind === 'constraint').length,
  boundary: RULES.filter((r) => r.kind === 'boundary').length,
}))

/* ── 证据区（数据卡） ── */
const EVIDENCE = computed<Array<{ v: string; u: string; l: string; src: string }>>(() =>
  isEn.value
    ? [
        { v: '59.3', u: 'FPS', l: 'Transition frame rate (iPhone 12 · at the 60Hz ceiling)', src: 'check-anim-rt2.py' },
        { v: '0.679', u: 'ms', l: 'Frame cost p95 (budget 8.33ms)', src: 'check-anim-rt2.py' },
        { v: '0', u: '/ 179', l: 'Dropped frames over 3.0s', src: 'check-anim-rt2.py' },
        { v: '1.0', u: 'ms', l: 'Main-thread CPU per 600ms (tick path: 17.4ms)', src: 'MA0-RT' },
        { v: '0', u: 'delta', l: 'Main-thread draws during animation (Android)', src: 'check-platform-anim.py' },
        { v: '215', u: 'nodes', l: 'FLIP layout animation, p95 0.713ms', src: 'check-anim-rt2.py' },
        { v: '84.5', u: '×', l: 'Instruction path vs JS path at N=1000', src: 'rt0-anim-spike.md' },
        { v: '1:1', u: 'mirror', l: 'Route transition, both directions, both targets', src: 'check-app-stack.py' },
      ]
    : [
        { v: '59.3', u: 'FPS', l: '转场帧率（iPhone 12 · 已达 60Hz 上限）', src: 'check-anim-rt2.py' },
        { v: '0.679', u: 'ms', l: '帧耗时 p95（预算 8.33ms）', src: 'check-anim-rt2.py' },
        { v: '0', u: '/ 179', l: '3.0s 持续测量零掉帧', src: 'check-anim-rt2.py' },
        { v: '1.0', u: 'ms', l: '600ms 窗口主线程 CPU（tick 对照 17.4ms）', src: 'MA0-RT' },
        { v: '0', u: 'delta', l: '动画期主线程绘制增量（Android）', src: 'check-platform-anim.py' },
        { v: '215', u: '节点', l: 'FLIP 布局动画 · p95 0.713ms', src: 'check-anim-rt2.py' },
        { v: '84.5', u: '×', l: '指令路径 vs JS 路径（N=1000）', src: 'rt0-anim-spike.md' },
        { v: '1:1', u: '镜像', l: '路由转场双向 · 双端', src: 'check-app-stack.py' },
      ],
)

/**
 * ★炫技场真机读数（iPhone 12 · `hosts/ios/results/showcase.json`，判据 `check-showcase.py`）。
 * ★数字与截图同源同一轮：截图是那次跑完的收尾帧，读数来自同一次运行的宿主记账。
 */
const SHOWCASE_STATS = [
  { v: '800', u: isEn.value ? 'tiles' : '片瓦片', l: isEn.value ? 'On screen at once · 20×40 grid, centred' : '同屏编舞 · 20×40 网格居中', lEn: 'On screen at once · 20×40 grid, centred' },
  { v: '58.3', u: 'FPS', l: 'iPhone 12（60Hz 上限）', lEn: 'iPhone 12 (60Hz ceiling)' },
  { v: '2.509', u: 'ms', l: '每帧成本 p95（预算 16.7ms）', lEn: 'Frame cost p95 (budget 16.7ms)' },
  { v: '0.135', u: 'ms', l: '每帧成本 p50', lEn: 'Frame cost p50' },
  { v: '17', u: isEn.value ? '/ 1900' : '/ 1900 帧', l: isEn.value ? 'Dropped frames (0.89%)' : '掉帧（0.89%）', lEn: 'Dropped frames (0.89%)' },
  { v: '800', u: isEn.value ? 'tiles' : '片全量重排', l: isEn.value ? 'FLIP full re-layout (kernel 1.64ms)' : 'FLIP 全量重排（内核 1.64ms）', lEn: 'FLIP full re-layout (kernel 1.64ms)' },
] as Array<{ v: string; u: string; l: string; lEn?: string }>

const BOUNDARIES = computed(() =>
  isEn.value
    ? [
        'Shared elements: same-tree form landed; cross-page steady-state geometry handoff needs the page-stack layer (not done)',
        'Scroll-linked: driver interface decoupled from input; real finger-drag gesture not wired',
        '120 FPS needs a ProMotion device (iPhone 12 is 60Hz — honestly noted, not claimed)',
        'Gesture negotiation (nested scroll / multi-touch) is by design not part of this engine, tracked separately',
        'Escape-hatch ratio: instrumentation ready (escapes.format()), business usage pending',
      ]
    : [
        '共享元素：同视图树形态已落地；跨页面的稳态几何回传需页面栈层配合（未做）',
        '滚动联动：驱动接口与输入源解耦；真机手指拖拽手势未接线',
        '120 FPS 目标需 ProMotion 设备（iPhone 12 为 60Hz——如实标注，未声称）',
        '手势协商（嵌套滚动冲突 / 多指）：按方案设计不属本引擎，独立立项',
        '逃生口率：统计装置就绪（escapes.format()），业务用量待采数',
      ],
)

const CODE = computed(() =>
  highlight(
    isEn.value
      ? `// Route level: one declaration, honoured per target
meta: { transition: 'halfScreen' }
// Web → CSS transition · Mini Program → routeType · App → kernel animation (Morpheus)

// Element level: one line
const spec = presets.route.bottomSheet()          // half-screen sheet sliding up
const batch = compileRoute(spec, { enter: a, exit: b })
// → engine instructions; curves/springs evaluated in the Rust kernel,
//   the platform-commit path hands ONE CAKeyframeAnimation to the render server.`
      : `// 路由级：一行声明，三端各自兑现
meta: { transition: 'halfScreen' }
// Web → CSS 转场 · 小程序 → routeType · App → 内核动画（Morpheus）

// 元素级：一句话演出
const spec = presets.route.bottomSheet()          // 半屏弹窗从底部滑入
const batch = compileRoute(spec, { enter: a, exit: b })
// → 引擎指令；曲线/物理在 Rust 内核求值，
//   平台零参与路径把一条 CAKeyframeAnimation 交给系统渲染进程。`,
    'ts',
  ),
)

/* ── 滚动显现（与首页同机制） ── */
const rootEl = ref<{ $el?: HTMLElement } | null>(null)
const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
let io: IntersectionObserver | null = null
onMounted(() => {
  const el = rootEl.value?.$el
  const nodes = el ? Array.from(el.querySelectorAll('[data-reveal]')) : []
  if (!motionOk || typeof IntersectionObserver !== 'function') {
    nodes.forEach((n) => n.classList.add('revealed'))
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          ;(e.target as HTMLElement).classList.add('revealed')
          io?.unobserve(e.target)
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  )
  nodes.forEach((n) => io?.observe(n))
})
onUnmounted(() => {
  io?.disconnect()
  io = null
})
</script>

<template>
  <p-page ref="rootEl" class="ap">
    <!-- 背景层（品牌光晕 + 细网格；纯装饰） -->
    <p-view class="ap-bg" aria-hidden="true"><span class="ap-grid" /></p-view>

    <p-view class="ap-wrap">
      <!-- ═══════════ Hero（布局归 p-grid：窄容器自动堆叠，零 @media） ═══════════ -->
      <p-grid :min-col-width="340" :gap="56" class="hero">
        <p-stack direction="column" :gap="22" class="hero-copy">
          <p-text class="chip"><FeatureIcon name="bolt" /><span>{{ C.chip }}</span></p-text>
          <p-heading :level="1" v-p-fluid="'font-size(36, 58)'" class="hero-h1">
            <span class="h1-l1">{{ C.h1line1 }}</span>
            <em class="h1-l2">{{ C.h1line2 }}</em>
          </p-heading>
          <p-text v-p-fluid="'font-size(17, 21)'" class="hero-tag">{{ C.tagline }}</p-text>
          <p-text class="hero-lead">{{ C.lead }}</p-text>
          <p-stack direction="row" :gap="14" wrap class="hero-cta">
            <router-link to="/docs/animation/00-overview" class="btn btn-primary">{{ C.ctaDocs }}</router-link>
            <a href="#demo" class="btn btn-ghost">{{ C.ctaDemo }}</a>
          </p-stack>
          <p-stack direction="row" :gap="10" wrap class="hero-pills">
            <span v-for="p in C.heroPills" :key="p" class="pill">{{ p }}</span>
          </p-stack>
        </p-stack>
        <p-view class="hero-stage">
          <MobileStage
            :incoming="plan.incoming.anims"
            :outgoing="plan.outgoing.anims"
            :duration-ms="plan.durationMs"
            :direction="direction"
            :shape="stageShape"
            size="lg"
            :caption="C.stageCaption"
          />
        </p-view>
      </p-grid>

      <!-- ═══════════ 三个杀手锏 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-grid :min-col-width="300" :gap="22">
          <p-view v-for="p in C.pillars" :key="p.n" class="pcard">
            <p-stack direction="row" align="center" :gap="12" class="pcard-head">
              <span class="pcard-no">{{ p.n }}</span>
              <span class="pcard-ic"><FeatureIcon :name="p.ic" /></span>
            </p-stack>
            <p-heading :level="3" class="pcard-title">{{ p.title }}</p-heading>
            <p-text class="pcard-desc">{{ p.desc }}</p-text>
            <p-view class="pcard-metrics">
              <p-view v-for="m in p.metrics" :key="m[1]" class="metric">
                <span class="metric-v">{{ m[0] }}</span>
                <span class="metric-l">{{ m[1] }}</span>
              </p-view>
            </p-view>
          </p-view>
        </p-grid>
      </p-view>

      <!-- ═══════════ 演示 ═══════════ -->
      <p-view id="demo" data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.demoTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.demoNote }}</p-text>

        <p-grid :min-col-width="300" :gap="32" class="demo-grid">
          <p-view class="demo-stage">
            <MobileStage
              :incoming="plan.incoming.anims"
              :outgoing="plan.outgoing.anims"
              :duration-ms="plan.durationMs"
              :direction="direction"
              :shape="stageShape"
              size="md"
              :autoplay="true"
            />
            <p-text v-if="!hasAnims" class="demo-hint">none · 瞬切（无动画）</p-text>
          </p-view>

          <p-stack direction="column" :gap="20" class="demo-side">
            <p-stack direction="column" :gap="12">
              <p-text class="ctrl-label">{{ C.dirLabel }}</p-text>
              <p-stack direction="row" :gap="8" wrap>
                <button class="chip" :class="{ on: direction === 'forward' }" @click="direction = 'forward'">{{ C.dirFwd }}</button>
                <button class="chip" :class="{ on: direction === 'back' }" @click="direction = 'back'">{{ C.dirBack }}</button>
              </p-stack>
              <p-text v-if="isDismiss" class="dismiss-note">{{ C.dismissNote }}</p-text>
              <p-stack direction="row" :gap="8" wrap>
                <button
                  v-for="tr in TRANSITIONS"
                  :key="tr"
                  class="chip"
                  :class="{ on: picked === tr }"
                  @click="picked = tr"
                >
                  {{ tr }}
                </button>
              </p-stack>
            </p-stack>

            <p-view class="tl">
              <p-stack direction="row" align="center" :gap="8" class="tl-head">
                <span class="tl-title">{{ C.timeline }}</span>
                <span class="tl-total">{{ totalMs }}ms</span>
              </p-stack>
              <p-view class="tl-rows">
                <p-view v-for="(b, i) in bars" :key="i" class="tl-row" :class="`tl-row--${b.pane}`">
                  <span class="tl-pane">{{ b.pane === 'in' ? 'A' : 'B' }}</span>
                  <span class="tl-bar" :style="{ marginLeft: b.left + '%', width: b.width + '%' }">
                    <span class="tl-bar-text">{{ b.label }} · {{ b.curve }}</span>
                  </span>
                </p-view>
                <p-text v-if="!bars.length" class="tl-empty">none（无动画）</p-text>
              </p-view>
              <p-text class="tl-note">{{ C.timelineNote }}</p-text>
            </p-view>

            <p-view class="readout">
              <p-text class="readout-title">{{ C.readout }}</p-text>
              <pre>{{ compiledReadout }}</pre>
            </p-view>
          </p-stack>
        </p-grid>
      </p-view>

      <!-- ═══════════ 曲线 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.curveTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.curveNote }}</p-text>
        <p-grid :min-col-width="320" :gap="26" class="curve-grid">
          <p-view class="curve-card">
            <svg viewBox="-8 -8 216 116" class="curve-svg" role="img">
              <defs>
                <linearGradient id="curveStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#7c5cff" />
                  <stop offset="100%" stop-color="#ab9bff" />
                </linearGradient>
              </defs>
              <line x1="0" y1="100" x2="200" y2="100" class="axis" />
              <line x1="0" y1="0" x2="0" y2="100" class="axis" />
              <line :x1="marker.x" :y1="100" :x2="marker.x" :y2="marker.y" class="guide" />
              <line x1="0" :y1="marker.y" :x2="marker.x" :y2="marker.y" class="guide" />
              <path :d="curvePath" class="curve" />
              <circle :cx="marker.x" :cy="marker.y" r="3.4" class="dot" />
              <circle cx="0" cy="100" r="2.4" class="anchor" />
              <circle cx="200" cy="0" r="2.4" class="anchor" />
            </svg>
            <p-stack direction="row" align="center" :gap="12" wrap class="curve-facts">
              <span class="fact">f(0) = <b>{{ endpoints.at0 }}</b></span>
              <span class="fact">f(1) = <b>{{ endpoints.at1 }}</b></span>
              <span class="fact fact--live">f({{ curveU.toFixed(2) }}) = <b>{{ curveValue.toFixed(4) }}</b></span>
            </p-stack>
          </p-view>
          <p-stack direction="column" :gap="18" class="curve-side">
            <p-grid :min-col-width="150" :gap="10">
              <button v-for="[name, id] in CURVES" :key="name" class="curve-chip" :class="{ on: curveId === id }" @click="curveId = id">
                <span class="cc-name">{{ name }}</span><span class="cc-id">#{{ id }}</span>
              </button>
            </p-grid>
            <p-view class="slider-box">
              <p-stack direction="row" align="center" :gap="10" class="slider-head">
                <span class="ctrl-label">{{ C.curveU }}</span>
                <span class="slider-val">{{ curveU.toFixed(2) }}</span>
              </p-stack>
              <input v-model.number="curveU" type="range" min="0" max="1" step="0.01" class="slider" />
            </p-view>
          </p-stack>
        </p-grid>
      </p-view>

      <!-- ═══════════ 预设库 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.presetsTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.presetsNote }}</p-text>
        <p-grid :min-col-width="240" :gap="18">
          <p-view v-for="r in PRESETS" :key="r.id" class="preset">
            <PresetPreview :kind="previewOf(r.id)" />
            <p-stack direction="row" align="center" :gap="7" wrap class="preset-head">
              <code class="preset-id">{{ r.id }}</code>
              <span class="status" :class="`status--${r.status}`">{{ r.status }}</span>
            </p-stack>
            <p-text class="preset-title">{{ r.title }}</p-text>
            <p-text class="preset-when">{{ r.when }}</p-text>
          </p-view>
        </p-grid>
        <p-text class="presets-more">
          {{ C.presetsMore }}：primitive × {{ ruleCounts.primitive }} · constraint × {{ ruleCounts.constraint }} ·
          boundary × {{ ruleCounts.boundary }}（共 {{ RULES.length }} 条 AI 说明书，与编译器规则同构）
        </p-text>
      </p-view>

      <!-- ═══════════ 炫技场（真机截图 + 读数） ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.showcaseTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.showcaseLead }}</p-text>
        <p-grid :min-col-width="320" :gap="22" class="sc-grid">
          <p-view class="sc-shot">
            <img :src="`${base}morpheus-showcase.png`" :alt="C.showcaseImgAlt" class="sc-img" loading="lazy" />
            <p-text class="sc-cap">{{ C.showcaseCaption }}</p-text>
          </p-view>
          <p-stack direction="column" :gap="14" class="sc-side">
            <p-grid :min-col-width="132" :gap="12">
              <p-view v-for="(e, i) in SHOWCASE_STATS" :key="i" class="sc-stat">
                <p-stack direction="row" align="baseline" :gap="5" class="ev-num">
                  <span class="ev-v sc-v">{{ e.v }}</span><span class="ev-u">{{ e.u }}</span>
                </p-stack>
                <p-text class="ev-l">{{ isEn ? e.lEn : e.l }}</p-text>
              </p-view>
            </p-grid>
            <p-text class="sc-note">{{ C.showcaseNote }}</p-text>
            <code class="ev-src">{{ C.showcaseCmd }}</code>
          </p-stack>
        </p-grid>
      </p-view>

      <!-- ═══════════ 证据 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.evidenceTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.evidenceNote }}</p-text>
        <p-grid :min-col-width="204" :gap="18">
          <p-view v-for="(e, i) in EVIDENCE" :key="i" class="ev">
            <p-stack direction="row" align="baseline" :gap="6" class="ev-num">
              <span class="ev-v">{{ e.v }}</span><span class="ev-u">{{ e.u }}</span>
            </p-stack>
            <p-text class="ev-l">{{ e.l }}</p-text>
            <code class="ev-src">{{ e.src }}</code>
          </p-view>
        </p-grid>
      </p-view>

      <!-- ═══════════ 怎么写 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.codeTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.codeNote }}</p-text>
        <p-view class="code-box"><pre v-html="CODE"></pre></p-view>
      </p-view>

      <!-- ═══════════ 边界 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(24, 32)'" class="sec-title">{{ C.boundaryTitle }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ C.boundaryNote }}</p-text>
        <p-stack direction="column" :gap="14" class="boundaries">
          <p-text v-for="(b, i) in BOUNDARIES" :key="i" class="boundary"><span class="b-dot">◐</span>{{ b }}</p-text>
        </p-stack>
      </p-view>

      <!-- ═══════════ CTA ═══════════ -->
      <p-view data-reveal class="cta">
        <p-view class="cta-glow" aria-hidden="true" />
        <p-heading :level="3" v-p-fluid="'font-size(20, 26)'" class="cta-title">Morpheus</p-heading>
        <p-text class="cta-sub">{{ isEn ? 'Declarative animation engine' : '声明式动画引擎' }} · v0.3</p-text>
        <router-link to="/docs/animation/00-overview" class="btn btn-primary cta-btn">{{ C.docCta }}</router-link>
      </p-view>
    </p-view>
  </p-page>
</template>

<style scoped>
/* ═══════════ 背景 ═══════════ */
.ap { position: relative; background: var(--bg); }
.ap-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.ap-bg::before {
  content: '';
  position: absolute;
  top: -320px;
  left: 50%;
  transform: translateX(-50%);
  width: 1100px;
  height: 700px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.2), transparent 70%);
  filter: blur(24px);
}
.ap-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(70% 46% at 50% 8%, #000 0%, transparent 78%);
  -webkit-mask-image: radial-gradient(70% 46% at 50% 8%, #000 0%, transparent 78%);
}
.ap-wrap { position: relative; max-width: 1240px; margin: 0 auto; padding: 120px 28px 120px; }
/* ═══════════ Hero ═══════════ */
.hero { align-items: center; padding-bottom: 44px; }
.hero-copy { min-width: 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.35);
  border-radius: var(--radius-pill);
  padding: 8px 16px;
}
.hero-h1 {
  color: var(--ink);
  line-height: 1.14;
  letter-spacing: -0.025em;
  font-weight: 800;
  margin: 6px 0 4px;
}
/* ★确定性两行构图：每行独立块级（不依赖容器宽度断行——`把动画变成 / 编译期问题`
   不会被折成孤立单字；英文同理）。行距是两行版式的呼吸来源。 */
.h1-l1 { display: block; }
.h1-l2 { display: block; font-style: normal; }
.hero-h1 .h1-l2 {
  background: linear-gradient(96deg, var(--brand-ink), var(--brand) 55%, var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-tag { color: var(--ink); font-weight: 650; line-height: 1.55; }
.hero-lead { color: var(--muted); line-height: 1.95; max-width: 640px; font-size: 15.5px; }
.hero-cta { margin-top: 12px; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: var(--radius-md);
  font-size: 14.5px;
  font-weight: 650;
  text-decoration: none;
  border: 1px solid var(--line);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.btn:hover { transform: translateY(-2px); }
.btn-primary {
  background: linear-gradient(120deg, var(--brand), #6a4bf0);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 10px 30px -12px rgba(124, 92, 255, 0.9);
}
.btn-ghost { color: var(--ink); background: var(--panel); }
.btn-ghost:hover { border-color: var(--brand); }
.hero-pills { margin-top: 10px; }
.pill { font-size: 12px; color: var(--muted); border: 1px solid var(--line); background: rgba(20, 20, 25, 0.7); border-radius: var(--radius-pill); padding: 4px 11px; }
.hero-stage { display: flex; justify-content: center; }
/* ═══════════ 分节通式 ═══════════ */
.sec { margin-top: 128px; }
.sec-head { margin-bottom: 12px; }
.sec-title { color: var(--ink); letter-spacing: -0.015em; }
.sec-rule { flex: 1; min-width: 40px; height: 1px; background: linear-gradient(90deg, var(--line), transparent); }
.sec-note { color: var(--muted); font-size: 14.5px; line-height: 1.85; margin-bottom: 30px; max-width: 860px; }
[data-reveal] {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1), transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
[data-reveal].revealed { opacity: 1; transform: none; }
/* ═══════════ 杀手锏卡 ═══════════ */
.pcard {
  position: relative;
  background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(17, 17, 23, 0.9));
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: 30px 26px 26px;
  transition: transform 0.22s ease, border-color 0.22s ease;
}
.pcard:hover { transform: translateY(-3px); border-color: rgba(124, 92, 255, 0.45); }
.pcard-head { margin-bottom: 10px; }
.pcard-no { font-family: var(--mono); font-size: 12px; letter-spacing: 0.1em; color: var(--dim); }
.pcard-ic {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.3);
}
.pcard-title { color: var(--ink); font-size: 17px; margin: 2px 0 8px; }
.pcard-desc { color: var(--muted); font-size: 14.5px; line-height: 1.9; }
.pcard-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px dashed var(--line);
}
.metric { display: block; min-width: 0; }
.metric-v { display: block; font-family: var(--mono); font-size: 19px; color: var(--brand-ink); font-weight: 600; letter-spacing: -0.01em; }
.metric-l { display: block; font-size: 11.5px; color: var(--dim); line-height: 1.55; margin-top: 5px; }
/* ═══════════ 演示区 ═══════════ */
.demo-grid { align-items: start; }
.demo-stage { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.demo-hint { font-size: 12.5px; color: var(--dim); }
.dismiss-note { font-size: 12px; color: var(--warn); line-height: 1.65; }
.demo-side { min-width: 0; }
.ctrl-label { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); }
.chip {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: 7px 13px;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
}
.chip:hover { border-color: var(--brand); }
.chip.on { color: var(--ink); border-color: var(--brand); background: var(--brand-soft); }
.tl { background: #101016; border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 18px 20px; }
.tl-head { margin-bottom: 14px; }
.tl-title { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.tl-total { margin-left: auto; font-family: var(--mono); font-size: 11.5px; color: var(--brand-ink); }
.tl-rows { display: flex; flex-direction: column; gap: 10px; }
.tl-row { display: flex; align-items: center; gap: 8px; }
.tl-pane { width: 16px; font-family: var(--mono); font-size: 11px; color: var(--dim); flex: none; }
.tl-bar {
  display: flex;
  align-items: center;
  height: 20px;
  border-radius: 6px;
  padding: 0 7px;
  overflow: hidden;
  min-width: 40px;
  transition: margin 0.3s ease, width 0.3s ease;
}
.tl-row--in .tl-bar { background: linear-gradient(120deg, rgba(124, 92, 255, 0.55), rgba(124, 92, 255, 0.3)); border: 1px solid rgba(124, 92, 255, 0.5); }
.tl-row--out .tl-bar { background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.1); }
.tl-bar-text { font-family: var(--mono); font-size: 10.5px; color: var(--ink); white-space: nowrap; }
.tl-empty { font-family: var(--mono); font-size: 12px; color: var(--dim); }
.tl-note { margin-top: 14px; font-size: 12px; color: var(--dim); line-height: 1.7; }
.readout { background: #101016; border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 18px 20px; }
.readout-title { font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); margin-bottom: 14px; }
.readout pre { margin: 0; max-height: 220px; overflow: auto; font-family: var(--mono); font-size: 12px; line-height: 1.8; color: var(--brand-ink); }
/* ═══════════ 曲线 ═══════════ */
.curve-grid { align-items: stretch; }
.curve-card {
  background: linear-gradient(180deg, rgba(24, 24, 31, 0.85), rgba(16, 16, 22, 0.85));
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: 24px;
}
.curve-svg { width: 100%; height: auto; display: block; }
.axis { stroke: var(--line); stroke-width: 0.7; }
.guide { stroke: rgba(255, 138, 92, 0.4); stroke-width: 0.7; stroke-dasharray: 3 3; }
.curve { fill: none; stroke: url(#curveStroke); stroke-width: 2; stroke-linecap: round; }
.dot { fill: var(--accent); }
.anchor { fill: var(--brand-ink); }
.curve-facts { margin-top: 20px; }
.fact { font-family: var(--mono); font-size: 12.5px; color: var(--dim); }
.fact b { color: var(--muted); font-weight: 600; }
.fact--live { color: var(--accent); }
.fact--live b { color: var(--accent); }
.curve-side { min-width: 0; }
.curve-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 9px 11px;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
}
.curve-chip.on { color: var(--ink); border-color: var(--brand); background: var(--brand-soft); }
.cc-id { font-size: 10.5px; color: var(--dim); }
.slider-box { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 18px 20px; }
.slider-head { margin-bottom: 14px; }
.slider-val { margin-left: auto; font-family: var(--mono); font-size: 13px; color: var(--accent); }
.slider { width: 100%; accent-color: var(--brand); }
/* ═══════════ 预设 ═══════════ */
.preset {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 16px 16px 18px;
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.preset:hover { transform: translateY(-2px); border-color: rgba(124, 92, 255, 0.4); }
.preset-head { margin: 16px 0 9px; }
.preset-id { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); }
.status { font-size: 10px; padding: 2px 7px; border-radius: var(--radius-pill); border: 1px solid var(--line); color: var(--muted); }
.status--implemented { color: var(--ok); border-color: rgba(61, 220, 151, 0.4); }
.preset-title { color: var(--ink); font-size: 14.5px; font-weight: 600; line-height: 1.55; display: block; }
.preset-when { color: var(--dim); font-size: 12.5px; line-height: 1.65; margin-top: 6px; display: block; }
.presets-more { margin-top: 24px; font-size: 13px; color: var(--dim); line-height: 1.7; }
/* ── 炫技场 ── */
.sc-grid { align-items: start; }
.sc-shot {
  background: #06060a;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: 14px;
  overflow: hidden;
}
.sc-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 520px;
  object-fit: contain;
  border-radius: var(--radius-lg);
  background: #000;
}
.sc-cap { margin-top: 12px; font-size: 12.5px; color: var(--dim); line-height: 1.6; }
.sc-side { min-width: 0; }
.sc-stat {
  background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(16, 16, 22, 0.9));
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 16px 16px 14px;
}
.sc-v { font-size: 22px; }
.sc-note { font-size: 12.5px; color: var(--muted); line-height: 1.8; }
/* ═══════════ 证据卡 ═══════════ */
.ev {
  background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(16, 16, 22, 0.9));
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 22px 22px 20px;
}
.ev-num { margin-bottom: 12px; }
.ev-v {
  font-family: var(--mono);
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
  background: linear-gradient(96deg, var(--brand-ink), var(--brand));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.ev-u { font-family: var(--mono); font-size: 12px; color: var(--dim); }
.ev-l { color: var(--muted); font-size: 13.5px; line-height: 1.7; display: block; }
.ev-src { display: block; margin-top: 14px; font-size: 11px; color: var(--dim); }
/* ═══════════ 代码 / 边界 / CTA ═══════════ */
.code-box { background: #101016; border: 1px solid var(--line); border-radius: var(--radius-xl); padding: 26px 28px; overflow-x: auto; }
.code-box pre { margin: 0; font-family: var(--mono); font-size: 13px; line-height: 2; }
.boundaries { border-left: 2px solid var(--line); padding-left: 22px; }
.boundary { color: var(--muted); font-size: 14px; line-height: 1.95; }
.b-dot { color: var(--warn); margin-right: 9px; }
.cta {
  position: relative;
  margin-top: 120px;
  padding: 56px 28px;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: linear-gradient(180deg, rgba(124, 92, 255, 0.08), transparent 62%);
}
.cta-glow {
  position: absolute;
  left: 50%;
  bottom: -160px;
  transform: translateX(-50%);
  width: 560px;
  height: 320px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.28), transparent 70%);
  filter: blur(20px);
  pointer-events: none;
}
.cta-title { color: var(--ink); }
.cta-sub { color: var(--dim); font-size: 13px; margin: 10px 0 28px; display: block; }
.cta-btn { position: relative; }
</style>
