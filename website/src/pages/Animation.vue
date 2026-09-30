<script setup lang="ts">
// website/src/pages/Animation.vue —— ★★Morpheus 动画引擎（旗舰产品页）
//
// 【这一页的规矩（与全站一致）】
//   · **零伪造**：页面上的两处演示都是**真跑**——
//     ① 转场播放器：真 `routeTransitionBatches()`（引擎给执行器的同一份指令）+ 真曲线求值
//        （`@proteus-vue/slot-runtime` 的 `animValue`——跨语言契约的 TS 半边，与 Rust 内核 golden 对拍 1e-5）；
//     ② 曲线求值器：真 65 点表（同上镜像），端点精确 0/1。
//   · **数字可追溯**：证据表的每一项都标注判据脚本（真机读数，非估算）。
//   · **诚实边界**：能力矩阵之外的"没做的"逐条列出（本仓铁律：宣称不得先于实现）。
//   · D-2/W-6：布局走 p-* 语义标签 + 柔性网格（零 @media、零裸 window/document 调用）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { locale, t } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'
import { highlight } from '@proteus-vue/docs'
// ★真引擎：转场规格/批次（引擎给执行器的同一份）+ 预设目录（ANIM_RULES 单一事实源）
import { ANIM_KIND_ID, CURVE_ID, appTransitions, listAnimRules, routeTransitionBatches } from '@proteus-vue/animation'
import type { EngineAnim } from '@proteus-vue/animation'
// ★真曲线求值：跨语言契约 TS 半边（`tests/anim-curve-golden.test.ts` 与 Rust 实测值对拍）
import { animValue, curveEval } from '@proteus-vue/slot-runtime'

const isEn = computed(() => locale.value === 'en')

/* ────────────────────────── 文案（zh / en 双语） ────────────────────────── */

const COPY = {
  zh: {
    eyebrow: 'MORPHEUS · 声明式动画引擎',
    h1a: '让动画回到',
    h1b: '编译期',
    tagline: '把「会不会掉帧」变成编译期问题。',
    lead: '一句话声明演出。曲线求值与物理积分在 Rust 内核；布局动画几乎白送（几何本就在内核）；转场直通系统渲染线程——不自绘，零主线程参与。',
    ctaDocs: '读文档',
    ctaDemo: '看演示',
    pillarTitle: '三个杀手锏',
    pillars: [
      {
        icon: 'layers',
        title: '布局动画，几乎白送',
        desc: '传统 FLIP 要在变更前后各读一次几何——在 VDOM 框架里很贵。我们的几何本来就在 Rust 核心里：变更前后快照都在内核，直接生成 Δ→0 补间，零跨边界查询。',
        fact: '215 节点同屏补间 · 帧耗时 p95 0.7ms · 4 001 节点全量重排 0.08ms',
      },
      {
        icon: 'bolt',
        title: '转场零主线程参与',
        desc: '不自绘，所以直接用系统的渲染线程（Android RenderThread / iOS CoreAnimation render server）。Flutter 自绘，才被迫自建 raster thread——我们不必。',
        fact: '动画全程主线程 0 绘制 · 600ms 窗口 CPU 1.0ms（对照 tick 路径 17.4ms）',
      },
      {
        icon: 'shield',
        title: '编译期拦截，零静默降级',
        desc: '合成属性集合（transform / opacity）在编译期判定；在转场里误改布局属性（width / margin）编译期报错、宿主明确拒绝——「会不会掉帧」不再靠调参赌。',
        fact: '5 条会静默出错的约束被编译期拦下 · conformance 对账不过就不出文档',
      },
    ],
    demoTitle: '转场播放器',
    demoNote: '演示直接播放引擎给执行器的同一份指令（routeTransitionBatches）；曲线求值走与 Rust 内核 golden 对拍过的 TS 镜像。',
    demoDir: '方向',
    demoForward: 'push（新页进入）',
    demoBack: 'pop（返回·镜像对）',
    demoReplay: '重放',
    demoInstant: '瞬切（不做动画）',
    demoCompiled: '引擎收到的指令',
    curveTitle: '曲线与内核同源',
    curveNote: '65 点采样表 + 线性插值；与 Rust 内核实测值对拍（容差 1e-5）、端点精确钉死 0 / 1。',
    curveProgress: '进度',
    presetsTitle: '预设库',
    presetsNote: '预设优先于参数——常见演出都是一句话。下列条目从 ANIM_RULES（单一事实源）实时读取，与 AI 说明书同源。',
    presetsOther: '另有',
    evidenceTitle: '真机证据',
    evidenceNote: '每一项都有可复跑的判据脚本；数字来自真机读数，不是估算。',
    codeTitle: '怎么写',
    codeNote: '路由级一行声明，三端各自兑现；元素级一句话演出。',
    boundaryTitle: '诚实边界',
    boundaryNote: '还没做到的，逐条列出——宣称不得先于实现。',
    docCta: '完整文档（架构 / 声明面 / 转场 / 布局与滚动 / 边界）',
  },
  en: {
    eyebrow: 'MORPHEUS · DECLARATIVE ANIMATION ENGINE',
    h1a: 'Animation is a',
    h1b: 'compile-time concern',
    tagline: "Make “will it jank?” a compile-time question.",
    lead: 'One line of declaration. Curve evaluation and spring physics live in the Rust core; layout animation is nearly free (the geometry is already there); transitions ride the system render thread — no custom renderer, zero main-thread involvement.',
    ctaDocs: 'Read the docs',
    ctaDemo: 'See the demos',
    pillarTitle: 'Three differentiators',
    pillars: [
      {
        icon: 'layers',
        title: 'Layout animation, nearly free',
        desc: 'Classic FLIP reads geometry twice (before/after) — expensive in a VDOM framework. Our geometry already lives in the Rust core: both snapshots are taken inside the kernel, which then emits the Δ→0 tween. Zero cross-boundary geometry queries.',
        fact: '215-node FLIP · frame cost p95 0.7ms · full relayout of 4,001 nodes in 0.08ms',
      },
      {
        icon: 'bolt',
        title: 'Transitions with zero main-thread involvement',
        desc: 'Because we do not self-draw, transitions run directly on the system render thread (Android RenderThread / iOS CoreAnimation render server). Flutter self-draws, and therefore had to build its own raster thread — we do not.',
        fact: '0 main-thread draws during animation · 1.0ms CPU in a 600ms window (tick path: 17.4ms)',
      },
      {
        icon: 'shield',
        title: 'Compile-time interception, no silent downgrade',
        desc: 'The composited-property set (transform / opacity) is decided at compile time; touching layout properties (width / margin) inside a transition fails compilation and is explicitly rejected by the host — “will it jank?” stops being a tuning gamble.',
        fact: '5 silent-failure constraints caught at compile time · no doc is generated if conformance fails',
      },
    ],
    demoTitle: 'Transition player',
    demoNote: 'This demo plays the very same instructions the engine hands to the executor (routeTransitionBatches); curve evaluation uses the TS mirror that is golden-tested against the Rust kernel.',
    demoDir: 'Direction',
    demoForward: 'push (new screen enters)',
    demoBack: 'pop (return · mirror pair)',
    demoReplay: 'Replay',
    demoInstant: 'Instant (no animation)',
    demoCompiled: 'Instructions the engine receives',
    curveTitle: 'Curves are kernel-sourced',
    curveNote: '65-point sampled table + linear interpolation; golden-tested against Rust kernel readings (1e-5 tolerance), endpoints pinned exactly to 0 / 1.',
    curveProgress: 'Progress',
    presetsTitle: 'Preset library',
    presetsNote: 'Presets over parameters — common motions are one-liners. Entries are read live from ANIM_RULES (single source of truth), shared with the AI manual.',
    presetsOther: 'Plus',
    evidenceTitle: 'Device evidence',
    evidenceNote: 'Every row points to a re-runnable assertion script; numbers are real device readings, not estimates.',
    codeTitle: 'How you write it',
    codeNote: 'One declaration per route, honoured by each target; one line per element motion.',
    boundaryTitle: 'Honest boundaries',
    boundaryNote: 'What is not done yet, listed item by item — claims never precede implementation.',
    docCta: 'Full documentation (architecture / surface / transitions / layout & scroll / boundaries)',
  },
} as const

const C = computed(() => COPY[isEn.value ? 'en' : 'zh'])

/* ────────────────────────── ① 转场播放器（真指令 + 真曲线） ────────────────────────── */

/** 统一枚举成员（从映射表推导，不手写第二份） */
const TRANSITIONS = appTransitions()
const TRANSITION_LABEL: Record<string, string> = {
  slideUp: 'slideUp · 全屏上推',
  slideDown: 'slideDown · 下滑关闭',
  halfScreen: 'halfScreen · 半屏弹窗',
  scaleDown: 'scaleDown · 缩放下沉',
  none: 'none · 瞬切',
}

const picked = ref<string>('slideUp')
const direction = ref<'forward' | 'back'>('forward')

/** ★真批次：引擎交给执行器的同一份（含 back 方向的两组反向声明——镜像对） */
const batch = computed(() =>
  routeTransitionBatches(picked.value, { incoming: 1, outgoing: 2 }, { direction: direction.value }),
)
const totalMs = computed(() => Math.max(1, batch.value.durationMs))
const hasAnims = computed(() => batch.value.incoming.anims.length + batch.value.outgoing.anims.length > 0)

interface PaneStyle {
  transform: string
  opacity: number
}
/** 按时间求值一批引擎指令（kind 编号用 ANIM_KIND_ID——不写字面量，防跨语言契约漂移） */
function paneStyle(anims: readonly EngineAnim[], tMs: number): PaneStyle {
  let tx = 0
  let ty = 0
  let sc = 1
  let rot = 0
  let op = 1
  for (const a of anims) {
    const dur = a.durMs > 0 ? a.durMs : 1
    const u = Math.min(1, Math.max(0, (tMs - (a.delayMs ?? 0)) / dur))
    const v = animValue(a.curve, a.from, a.to, u)
    if (a.kind === ANIM_KIND_ID.translateX) tx = v
    else if (a.kind === ANIM_KIND_ID.translateY) ty = v
    else if (a.kind === ANIM_KIND_ID.scale) sc = v
    else if (a.kind === ANIM_KIND_ID.rotate) rot = v
    else if (a.kind === ANIM_KIND_ID.opacity) op = v
  }
  return { transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`, opacity: op }
}

const tMs = ref(0)
const playing = ref(false)
let raf = 0
const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

const paneIn = computed(() => paneStyle(batch.value.incoming.anims, tMs.value))
const paneOut = computed(() => paneStyle(batch.value.outgoing.anims, tMs.value))
/** 前进：新页在上层；返回：旧页在上层（滑出后露出下层） */
const zIn = computed(() => (direction.value === 'forward' ? 2 : 1))
const zOut = computed(() => (direction.value === 'forward' ? 1 : 2))

function stop(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  playing.value = false
}
function play(): void {
  stop()
  if (!hasAnims.value || !motionOk) {
    tMs.value = hasAnims.value ? totalMs.value : 0 // reduced-motion：直接终态（不做补间）
    return
  }
  playing.value = true
  const start = performance.now()
  const step = (now: number): void => {
    const t = now - start
    tMs.value = Math.min(t, totalMs.value)
    if (t < totalMs.value) raf = requestAnimationFrame(step)
    else {
      playing.value = false
      raf = 0
    }
  }
  raf = requestAnimationFrame(step)
}
watch([picked, direction], () => play())
onMounted(play)
onUnmounted(stop)

/** 指令读数（引擎收到什么，页面上就显示什么——不是示意图） */
const compiledReadout = computed(() =>
  JSON.stringify(
    {
      direction: direction.value,
      transition: batch.value.transition,
      durationMs: batch.value.durationMs,
      incoming: batch.value.incoming.anims.map((a) => ({ nodeId: a.nodeId, kind: a.kind, from: a.from, to: a.to, curve: a.curve, durMs: a.durMs })),
      outgoing: batch.value.outgoing.anims.map((a) => ({ nodeId: a.nodeId, kind: a.kind, from: a.from, to: a.to, curve: a.curve, durMs: a.durMs })),
    },
    null,
    1,
  ),
)

/* ────────────────────────── ② 曲线求值器（真 65 点表） ────────────────────────── */

const CURVES = Object.entries(CURVE_ID) as Array<[string, number]> // [名字, 契约编号]
const curveId = ref<number>(CURVE_ID.easeOut)
const curveU = ref<number>(0.5)
const curveValue = computed(() => curveEval(curveId.value, curveU.value))
/** 真采样画曲线（同一条 curveEval——页面上没有第二套曲线数学） */
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
const curveMarker = computed(() => ({
  x: (curveU.value * 200).toFixed(1),
  y: (100 - curveValue.value * 100).toFixed(1),
}))

/* ────────────────────────── ③ 预设目录（ANIM_RULES 单一事实源） ────────────────────────── */

const RULES = listAnimRules()
const PRESETS = RULES.filter((r) => r.kind === 'preset')
const ruleCounts = computed(() => ({
  primitive: RULES.filter((r) => r.kind === 'primitive').length,
  constraint: RULES.filter((r) => r.kind === 'constraint').length,
  boundary: RULES.filter((r) => r.kind === 'boundary').length,
}))

/* ────────────────────────── ④ 真机证据 / ⑤ 边界 ────────────────────────── */

const EVIDENCE: Array<{ label: string; labelEn: string; value: string; src: string }> = [
  { label: '转场帧率', labelEn: 'Transition frame rate', value: '59.3 FPS（iPhone 12 · 60Hz 上限）', src: 'check-anim-rt2.py E 组' },
  { label: '帧耗时 p95', labelEn: 'Frame cost p95', value: '0.679 ms（预算 8.33ms）', src: 'check-anim-rt2.py E 组' },
  { label: '掉帧', labelEn: 'Dropped frames', value: '0 / 179 帧（3.0s 持续测量）', src: 'check-anim-rt2.py E 组' },
  { label: '主线程参与（转场）', labelEn: 'Main-thread CPU (transition)', value: '1.0 ms vs tick 对照 17.4ms（600ms 窗口 · OS 级会计）', src: 'MA0-RT 实测（阳性对照）' },
  { label: '主线程绘制（Android 容器级）', labelEn: 'Main-thread draws (Android)', value: 'onDrawCount 增量 = 0', src: 'check-platform-anim.py B2' },
  { label: '布局动画 FLIP', labelEn: 'Layout animation (FLIP)', value: '215 节点同屏补间 · p95 0.713ms', src: 'check-anim-rt2.py F/H' },
  { label: '指令路径 vs JS 路径', labelEn: 'Instruction path vs JS path', value: '10.5× – 84.5×（N=50 → 1000）', src: 'rt0-anim-spike.md' },
  { label: '路由转场双向', labelEn: 'Route transition (both ways)', value: 'forward 800→0 ↔ back 0→800（镜像对）', src: 'check-app-stack.py ⑦ 组（双端）' },
]

const BOUNDARIES: Array<{ zh: string; en: string }> = [
  {
    zh: '共享元素：同视图树形态已落地；跨页面的稳态几何回传需页面栈层配合（未做）',
    en: 'Shared elements: same-tree form landed; cross-page steady-state geometry handoff needs the page-stack layer (not done)',
  },
  {
    zh: '滚动联动：驱动接口与输入源解耦；真机手指拖拽手势未接线',
    en: 'Scroll-linked: driver interface decoupled from input source; real finger-drag gesture not wired yet',
  },
  { zh: '120 FPS 目标需 ProMotion 设备（iPhone 12 为 60Hz——如实标注，未声称）', en: '120 FPS target needs a ProMotion device (iPhone 12 is 60Hz — honestly noted, not claimed)' },
  { zh: '手势协商（嵌套滚动冲突 / 多指）：按方案设计不属本引擎，独立立项', en: 'Gesture negotiation (nested scroll / multi-touch): by design not part of this engine, tracked separately' },
  { zh: '逃生口率：统计装置就绪（escapes.format()），业务用量待采数', en: 'Escape-hatch ratio: instrumentation ready (escapes.format()), business usage pending' },
]

/* ────────────────────────── 代码示例（高亮走文档引擎同一套） ────────────────────────── */

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
</script>

<template>
  <p-page class="anim-page">
    <p-view class="wrap">
      <!-- ─────────── Hero ─────────── -->
      <p-stack direction="column" :gap="18" class="hero">
        <p-text class="eyebrow"><FeatureIcon name="bolt" />{{ C.eyebrow }}</p-text>
        <p-heading :level="1" v-p-fluid="'font-size(34, 54)'" class="hero-h1">{{ C.h1a }}<em>{{ C.h1b }}</em></p-heading>
        <p-text class="hero-tagline">{{ C.tagline }}</p-text>
        <p-text class="hero-lead">{{ C.lead }}</p-text>
        <p-stack direction="row" :gap="10" wrap class="hero-cta">
          <router-link to="/docs/animation/00-overview" class="btn btn-primary">{{ C.ctaDocs }}</router-link>
          <a href="#demo" class="btn btn-ghost">{{ C.ctaDemo }}</a>
        </p-stack>
      </p-stack>

      <!-- ─────────── 三个杀手锏 ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title">{{ C.pillarTitle }}</p-heading>
      <p-grid :min-col-width="280" :gap="14">
        <p-view v-for="(p, i) in C.pillars" :key="i" class="card pillar">
          <p-text class="pillar-ic"><FeatureIcon :name="p.icon" /></p-text>
          <p-heading :level="3" class="pillar-title">{{ p.title }}</p-heading>
          <p-text class="pillar-desc">{{ p.desc }}</p-text>
          <p-text class="pillar-fact">{{ p.fact }}</p-text>
        </p-view>
      </p-grid>

      <!-- ─────────── ① 转场播放器 ─────────── -->
      <!-- ─────────── ① 转场播放器 ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title" id="demo">{{ C.demoTitle }}</p-heading>
      <p-text class="sec-note">{{ C.demoNote }}</p-text>
      <p-grid :min-col-width="300" :gap="18" class="demo-grid">
        <!-- 手机框：两页叠放，各自动画 -->
        <p-view class="phone">
          <p-view class="phone-screen">
            <p-view class="pane pane-out" :style="{ ...paneOut, zIndex: zOut }">
              <p-view class="mock-bar" /><p-view class="mock-hero mock-hero--dim" />
              <p-view class="mock-row" /><p-view class="mock-row" /><p-view class="mock-row mock-row--short" />
              <p-text class="pane-tag">B</p-text>
            </p-view>
            <p-view class="pane pane-in" :style="{ ...paneIn, zIndex: zIn }">
              <p-view class="mock-bar mock-bar--brand" /><p-view class="mock-hero" />
              <p-view class="mock-row" /><p-view class="mock-row" /><p-view class="mock-row mock-row--short" />
              <p-text class="pane-tag pane-tag--brand">A</p-text>
            </p-view>
          </p-view>
        </p-view>
        <!-- 控制区 -->
        <p-stack direction="column" :gap="10" class="demo-ctrl">
          <p-stack direction="row" :gap="8" wrap>
            <button
              v-for="tr in TRANSITIONS"
              :key="tr"
              class="chip"
              :class="{ active: picked === tr }"
              @click="picked = tr"
            >
              {{ TRANSITION_LABEL[tr] ?? tr }}
            </button>
          </p-stack>
          <p-stack direction="row" :gap="8" wrap>
            <button class="chip" :class="{ active: direction === 'forward' }" @click="direction = 'forward'">{{ C.demoForward }}</button>
            <button class="chip" :class="{ active: direction === 'back' }" @click="direction = 'back'">{{ C.demoBack }}</button>
            <button class="chip chip-play" :disabled="playing" @click="play">{{ C.demoReplay }}</button>
          </p-stack>
          <p-text v-if="!hasAnims" class="demo-hint">{{ C.demoInstant }}</p-text>
          <p-view class="readout">
            <p-text class="readout-title">{{ C.demoCompiled }}</p-text>
            <pre>{{ compiledReadout }}</pre>
          </p-view>
        </p-stack>
      </p-grid>

      <!-- ─────────── ② 曲线求值器 ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title">{{ C.curveTitle }}</p-heading>
      <p-text class="sec-note">{{ C.curveNote }}</p-text>
      <p-grid :min-col-width="300" :gap="18" class="demo-grid demo-grid--curve">
        <p-view class="curve-box">
          <svg viewBox="0 0 200 100" class="curve-svg" role="img">
            <line x1="0" y1="100" x2="200" y2="100" class="curve-axis" />
            <line x1="0" y1="0" x2="0" y2="100" class="curve-axis" />
            <path :d="curvePath" class="curve-line" />
            <circle :cx="curveMarker.x" :cy="curveMarker.y" r="3.2" class="curve-dot" />
          </svg>
        </p-view>
        <p-stack direction="column" :gap="10" class="demo-ctrl">
          <p-stack direction="row" :gap="8" wrap>
            <button v-for="[name, id] in CURVES" :key="name" class="chip" :class="{ active: curveId === id }" @click="curveId = id">
              {{ name }} <span class="chip-id">#{{ id }}</span>
            </button>
          </p-stack>
          <p-text class="demo-hint">{{ C.curveProgress }} u = {{ curveU.toFixed(2) }} → v = <b>{{ curveValue.toFixed(4) }}</b></p-text>
          <input v-model.number="curveU" type="range" min="0" max="1" step="0.01" class="slider" />
        </p-stack>
      </p-grid>

      <!-- ─────────── ③ 预设目录（live） ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title">{{ C.presetsTitle }}</p-heading>
      <p-text class="sec-note">{{ C.presetsNote }}</p-text>
      <p-grid :min-col-width="240" :gap="12">
        <p-view v-for="r in PRESETS" :key="r.id" class="card preset">
          <p-stack direction="row" :gap="8" align="center" wrap>
            <code class="preset-id">{{ r.id }}</code>
            <span class="status" :class="`status--${r.status}`">{{ r.status }}</span>
          </p-stack>
          <p-heading :level="3" class="preset-title">{{ r.title }}</p-heading>
          <p-text class="preset-when">{{ r.when }}</p-text>
        </p-view>
      </p-grid>
      <p-text class="sec-note">
        {{ C.presetsOther }}：primitive × {{ ruleCounts.primitive }} · constraint × {{ ruleCounts.constraint }} · boundary ×
        {{ ruleCounts.boundary }}（共 {{ RULES.length }} 条 AI 说明书，与编译器规则同构）
      </p-text>

      <!-- ─────────── ④ 真机证据 ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title">{{ C.evidenceTitle }}</p-heading>
      <p-text class="sec-note">{{ C.evidenceNote }}</p-text>
      <p-view class="table-wrap">
        <table class="ev-table">
          <thead>
            <tr>
              <th>{{ isEn ? 'Metric' : '指标' }}</th>
              <th>{{ isEn ? 'Reading' : '读数' }}</th>
              <th>{{ isEn ? 'Assertion' : '判据' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in EVIDENCE" :key="i">
              <td>{{ isEn ? e.labelEn : e.label }}</td>
              <td class="ev-value">{{ e.value }}</td>
              <td><code>{{ e.src }}</code></td>
            </tr>
          </tbody>
        </table>
      </p-view>

      <!-- ─────────── ⑤ 怎么写 ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title">{{ C.codeTitle }}</p-heading>
      <p-text class="sec-note">{{ C.codeNote }}</p-text>
      <p-view class="code-box"><pre v-html="CODE"></pre></p-view>

      <!-- ─────────── ⑥ 诚实边界 ─────────── -->
      <p-heading :level="2" v-p-fluid="'font-size(22, 28)'" class="sec-title">{{ C.boundaryTitle }}</p-heading>
      <p-text class="sec-note">{{ C.boundaryNote }}</p-text>
      <p-stack direction="column" :gap="8" class="boundaries">
        <p-text v-for="(b, i) in BOUNDARIES" :key="i" class="boundary"><span class="dot">◐</span>{{ isEn ? b.en : b.zh }}</p-text>
      </p-stack>

      <!-- ─────────── CTA ─────────── -->
      <p-view class="cta-card">
        <router-link to="/docs/animation/00-overview" class="btn btn-primary">{{ C.docCta }}</router-link>
        <p-text class="cta-sub">Morpheus · {{ isEn ? 'Declarative animation engine' : '声明式动画引擎' }} · {{ isEn ? 'docs' : '文档' }} v0.3</p-text>
      </p-view>
    </p-view>
  </p-page>
</template>

<style scoped>
.wrap {
  max-width: 1080px;
  margin: 0 auto;
  padding: 96px 20px 80px;
}
.hero {
  padding: 26px 0 10px;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: 5px 12px;
  width: fit-content;
}
.hero-h1 {
  font-size: var(--p-heading-size-1, clamp(34px, 5vw, 54px));
  line-height: 1.08;
  letter-spacing: -0.02em;
}
.hero-h1 em {
  font-style: normal;
  color: var(--brand-ink);
}
.hero-tagline {
  font-size: clamp(16px, 2.2vw, 20px);
  color: var(--ink);
  font-weight: 600;
}
.hero-lead {
  color: var(--muted);
  line-height: 1.75;
  max-width: 780px;
}
.hero-cta {
  margin-top: 6px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid var(--line);
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.btn:hover {
  transform: translateY(-1px);
}
.btn-primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.btn-ghost {
  color: var(--ink);
  background: var(--panel);
}
.sec-title {
  margin: 56px 0 6px;
  font-size: clamp(22px, 3vw, 28px);
  letter-spacing: -0.01em;
}
.sec-note {
  color: var(--dim);
  font-size: 13.5px;
  line-height: 1.7;
  margin-bottom: 14px;
  max-width: 860px;
}
/* ── 卡片 ── */
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 18px 16px;
}
.pillar-ic {
  color: var(--brand-ink);
  font-size: 18px;
}
.pillar-title {
  margin: 8px 0 6px;
  font-size: 16.5px;
}
.pillar-desc {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.72;
}
.pillar-fact {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  color: var(--brand-ink);
  font-size: 12.5px;
  line-height: 1.6;
}
/* ── 演示区 ── */
/* 演示区两栏：布局归 p-grid（minColWidth 自动堆叠——零 @media，W-6） */
.demo-grid {
  align-items: start;
}
.phone {
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 26px;
  padding: 12px;
}
.phone-screen {
  position: relative;
  height: 380px;
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid var(--line-soft);
}
.pane {
  position: absolute;
  inset: 0;
  will-change: transform, opacity;
  transform-origin: center center;
}
.pane-out {
  background: linear-gradient(180deg, #17171d, #101015);
}
.pane-in {
  background: linear-gradient(180deg, #1a1830, #12111d);
}
.pane-tag {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--dim);
}
.pane-tag--brand {
  color: var(--brand-ink);
}
.mock-bar {
  height: 34px;
  margin: 10px 10px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
}
.mock-bar--brand {
  background: var(--brand-soft);
  border: 1px solid var(--brand);
}
.mock-hero {
  height: 96px;
  margin: 0 10px 10px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.5), rgba(124, 92, 255, 0.16));
}
.mock-hero--dim {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.05));
}
.mock-row {
  height: 26px;
  margin: 0 10px 8px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.07);
}
.mock-row--short {
  width: 60%;
}
.demo-ctrl {
  min-width: 0;
}
.chip {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: 7px 12px;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease;
}
.chip:hover {
  border-color: var(--brand);
}
.chip.active {
  color: var(--ink);
  border-color: var(--brand);
  background: var(--brand-soft);
}
.chip-id {
  color: var(--dim);
  font-size: 10.5px;
}
.chip-play {
  color: var(--brand-ink);
}
.chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.demo-hint {
  font-size: 12.5px;
  color: var(--dim);
}
.readout {
  background: #101016;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}
.readout-title {
  font-size: 11.5px;
  color: var(--dim);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.readout pre {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--brand-ink);
}
/* ── 曲线 ── */
.curve-box {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 10px;
}
.curve-svg {
  width: 100%;
  height: auto;
  display: block;
}
.curve-axis {
  stroke: var(--line);
  stroke-width: 0.6;
}
.curve-line {
  fill: none;
  stroke: var(--brand-ink);
  stroke-width: 1.6;
}
.curve-dot {
  fill: var(--accent);
}
.slider {
  width: 100%;
  accent-color: var(--brand);
}
/* ── 预设 ── */
.preset-id {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--brand-ink);
}
.status {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--line);
  color: var(--muted);
}
.status--implemented {
  color: var(--ok);
  border-color: rgba(61, 220, 151, 0.4);
}
.preset-title {
  margin: 8px 0 4px;
  font-size: 14.5px;
}
.preset-when {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.6;
}
/* ── 证据表 ── */
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.ev-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ev-table th {
  text-align: left;
  font-weight: 600;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.05em;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--panel2);
}
.ev-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--ink);
  vertical-align: top;
}
.ev-table tr:last-child td {
  border-bottom: none;
}
.ev-value {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--brand-ink);
}
.ev-table code {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--dim);
}
/* ── 代码 ── */
.code-box {
  background: #101016;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  overflow-x: auto;
}
.code-box pre {
  margin: 0;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.75;
}
/* ── 边界 ── */
.boundaries {
  border-left: 2px solid var(--line);
  padding-left: 14px;
}
.boundary {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.7;
}
.boundary .dot {
  color: var(--warn);
  margin-right: 8px;
}
/* ── CTA ── */
.cta-card {
  margin-top: 56px;
  padding: 26px;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, var(--brand-soft), transparent 70%);
}
.cta-card .btn {
  justify-content: center;
}
.cta-sub {
  margin-top: 10px;
  color: var(--dim);
  font-size: 12.5px;
}
</style>
