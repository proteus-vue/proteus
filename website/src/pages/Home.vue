<script setup lang="ts">
// website/src/pages/Home.vue —— 官网首页（★v3 构图对齐：用户评审「v3-plan 首页更专业」决策 #387）
//   结构对齐 docs/proteus-website-v3/index.html 的成熟视觉：
//   1. 居中 Hero（eyebrow chip + 渐变双行 H1 + 段落 + 双 CTA + G 系 pills）
//   2. Mini Playground 面板（TransformDemo + LIVE 徽标——真实编译，非示意图）
//   3. 编号三支柱（01 语义优先 / 02 全插层 SPI / 03 证明先于宣称）
//   4. 数字背书（stats.ts 可追溯）+ 能力矩阵
//   5. 对标表（与「翻译派」的本质分水岭）+ dogfooding 金句 + 快速开始
// ★D-2：布局标签 p-view/p-grid/p-stack/p-heading/p-text（禁裸 div 布局；table/pre 为内容语义标签）
// ★W-6 柔性框架优先：v-p-fluid clamp + p-grid/p-stack，零 @media
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { STATS, COMPARE_MATRIX } from '../stats'
import TransformDemo from '../components/TransformDemo.vue'
import FeatureIcon from '../components/FeatureIcon.vue'
// ★#475 首页国际化（chrome t() + 数据数组 locale 双份）
import { locale, t } from '../i18n'
// ★2026-09-11 风格收敛：移除 Hero 视差（--sp）与辉光/波浪——Hero 改静态左对齐构图

const homeEl = ref<{ $el?: HTMLElement } | null>(null)
// ★#389b 动效守卫：prefers-reduced-motion → 显现动效跳过
const motionOk = ref(true)
let revealObserver: IntersectionObserver | null = null

// ★#389c 数字滚动计数（数据背书卡进入视口时 0→N 补间；reduced-motion 直接终值）
const counters = ref<Record<number, string>>({})
let counted = false
function startCounters(): void {
  if (counted) return
  counted = true
  STATS.forEach((s, i) => {
    const n = Number.parseInt(s.value, 10)
    if (Number.isNaN(n)) return
    const dur = 950
    const startAt = performance.now()
    const tick = (now: number): void => {
      const p = Math.min(1, (now - startAt) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      counters.value[i] = String(Math.round(n * eased))
      if (p < 1) requestAnimationFrame(tick)
      else counters.value[i] = s.value
    }
    requestAnimationFrame(tick)
  })
}

onMounted(() => {
  motionOk.value = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const root = (homeEl.value?.$el as HTMLElement | undefined) ?? (homeEl.value as unknown as HTMLElement | null)
  const targets = root ? Array.from(root.querySelectorAll('[data-reveal]')) : []
  if (!motionOk.value || typeof IntersectionObserver !== 'function') {
    targets.forEach((el) => el.classList.add('revealed'))
    return
  }
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('revealed')
          // ★数据卡进入视口 → 启动数字计数
          if ((en.target as HTMLElement).classList.contains('stats')) startCounters()
          revealObserver?.unobserve(en.target)
        }
      }
    },
    { threshold: 0.12 },
  )
  targets.forEach((el) => revealObserver?.observe(el))
})
onUnmounted(() => {
  revealObserver?.disconnect()
  revealObserver = null
})

// ★#386 对标状态色接入 design-tokens 状态层（ok/warn/rec——llm-style-guide §2：✓ 用 ok / partial 用 warn / 规划用 dim）
function statusClass(status: string): string {
  return { '✅': 'st-ok', '🟡': 'st-warn', '📋': 'st-plan' }[status] ?? ''
}

// ★2026-09-11 Hero 数字行（3 项 headline 数字；精确值，不加修饰符；完整 8 项见「数字背书」区，值同源 stats.ts）
const heroStatsZh = [
  { value: '38', label: '@proteus-vue/* 包' },
  { value: String(STATS[1]?.value ?? '2006'), label: '单测全绿' },
  { value: '128', label: '语义原语 SSOT' },
]
const heroStatsEn = [
  { value: '38', label: '@proteus-vue/* packages' },
  { value: String(STATS[1]?.value ?? '2006'), label: 'unit tests green' },
  { value: '128', label: 'semantic primitives SSOT' },
]

// 编号三支柱（v3 三卡构图；文案对齐方法论三句话）
const pillarsZh = [
  {
    no: '01',
    icon: 'layers',
    title: '语义优先',
    desc: '组件即语义，不是 div 别名。p-grid 表达「网格意图」、p-stack 表达「流向」——布局语义编译期可校验，而不是靠 CSS 事后救。',
  },
  {
    no: '02',
    icon: 'plug',
    title: '全插层 SPI',
    desc: '编译 · UI · 能力 · 端，全部可插拔。Node/Rust 编译后端 × VueDom/Native/Flutter 渲染后端 × 能力桥——同一个语义 IR，换后端业务零改动。',
  },
  {
    no: '03',
    icon: 'shield',
    title: '证明先于宣称',
    desc: 'conformance test + 编译期拦截。每个后端过同一套契约测试；语义违规编译期报错——官网展示的每个数字都可追溯到验证脚本。',
  },
  {
    no: '04',
    icon: 'code',
    title: '标准 Vue 编写',
    desc: '业务只写标准 Vue SFC + 标准 HTML，不学新 DSL；跨端差异在编译期吸收——产物贴近手写、可读、可调试、可反查源码。',
  },
]

// 学习路径（★#398：对齐指南区 8 组旅程 IA——首页直达初学者线性路径）
const journeyZh = [
  {
    no: '01',
    title: '起步',
    desc: '是什么、为什么：三分钟理解 Proteus 与传统跨端框架的本质区别。',
    to: '/docs/01-intro',
  },
  {
    no: '02',
    title: '开始',
    desc: '创建工程 → 运行与预览 → 构建与发布：四个微页跑通 Web 与小程序双端。',
    to: '/docs/04-requirements',
  },
  {
    no: '03',
    title: '代码构成',
    desc: '目录结构、页面四段式、两层配置——认识工程里每个文件的职责。',
    to: '/docs/08-structure',
  },
  {
    no: '04',
    title: '基础概念',
    desc: '语义模型、p-* 语义组件、状态与路由：写页面前需要的心智模型。',
    to: '/docs/framework/11-semantic-model',
  },
  {
    no: '05',
    title: '渲染与能力',
    desc: '柔性布局、50 个能力 Hook、全终端适配——业务代码对后端零感知。',
    to: '/docs/17-fluid-layout',
  },
  {
    no: '06',
    title: '架构与工程',
    desc: '可插拔 SPI 全景、编译管线、测试与一致性验证——深入框架内部。',
    to: '/docs/framework/22-architecture',
  },
]

// 适用场景（★2026-09-11 参考构图：3 图标卡）
const scenariosZh = [
  { icon: 'layout', title: '中后台 / 企业应用', desc: '标准 Vue + 语义组件，Web 直出、小程序同源——一套代码覆盖管理后台与企业内部系统。' },
  { icon: 'chart', title: '数据可视化与图表', desc: 'Canvas / SVG 通道对齐（形状动画、路径运动、渐变裁剪），复杂图形在 Skyline 下逐帧重绘。' },
  { icon: 'app', title: '多端同屏与宿主容器', desc: '同一份语义按端形态推导界面：手机 / 平板 / PC / 车机 / 电视 / 手表，或嵌入超级 App 沙箱。' },
]
const scenariosEn = [
  { icon: 'layout', title: 'Admin & enterprise apps', desc: 'Standard Vue + semantic components — Web direct-out, Mini Program from the same source; one codebase for back-office and internal systems.' },
  { icon: 'chart', title: 'Data visualization & charts', desc: 'Canvas / SVG channel alignment (shape animation, path motion, gradient clipping); complex graphics redraw per frame under Skyline.' },
  { icon: 'app', title: 'Multi-device & host containers', desc: 'The same semantics derive per-target UI: phone / tablet / PC / car / TV / watch, or embedded in a super-app sandbox.' },
]

// 生态支持（技术栈）
const stackItems = [
  { name: 'Vue 3', short: 'V', color: '#42b883' },
  { name: 'Vite', short: '⚡', color: '#a996ff' },
  { name: 'TypeScript', short: 'TS', color: '#3178c6' },
  { name: 'Pinia', short: 'P', color: '#ffd54f' },
  { name: 'UnoCSS', short: 'U', color: '#e5e7eb' },
]

const capabilitiesZh = [
  {
    tag: 'G-27',
    title: '可插拔渲染底座',
    desc: 'RenderBackend SPI + 五官方后端（VueDom / Native×3 / Flutter）+ 混合渲染——同一 App 按页面选引擎，业务代码不变。',
  },
  {
    tag: 'G-29/38',
    title: '可插拔编译器',
    desc: 'config.compiler.backend 一个 flag 切 Node / Rust（同一 CompilerIR，语义等价 Golden 81 用例），SPI 冻结 + 增量会话。',
  },
  {
    tag: 'G-31/32',
    title: '语义原语 SSOT',
    desc: '128 语义原语单一事实源 → 59 个 p-* 组件 → 45 implemented 语义 × 6 后端 conformance 门禁 + 50 Capability Hook。',
  },
  {
    tag: 'G-41/42/43',
    title: '宿主层三件套',
    desc: '36 组合矩阵热切换 + 六容器策略（超级应用沙箱 / 崩溃隔离）+ 所有权与借用检查（use-after-move 编译期拦截）。',
  },
  {
    tag: 'G-45',
    title: '调试基座即宿主',
    desc: 'Install-Once Host：插件动态装载（签名 + conformance 快检）+ pending 回放——改原生插件永不重打基座。',
  },
  {
    tag: 'G-36',
    title: 'AI-native 全链路',
    desc: 'MCP Server + Agent Kit 自修复循环 + 三层护栏——AI 产出符合 IR 契约的标准代码，而非自由文本。',
  },
]

/* ============ ★#475 首页国际化：英文数据层（locale 双份）+ 计算暴露（模板变量名不变） ============ */
const heroStats = computed(() => (enOn() ? heroStatsEn : heroStatsZh))

const pillarsEn = [
  { no: '01', icon: 'layers', title: 'Semantics first', desc: 'Components are semantics, not div aliases. p-grid says “grid intent”, p-stack says “flow” — layout semantics are checked at compile time, not patched with CSS afterwards.' },
  { no: '02', icon: 'plug', title: 'SPI at every layer', desc: 'Compiler · UI · capabilities · targets — all pluggable. Node/Rust compile backends × VueDom/Native/Flutter render backends × capability bridges — one semantic IR, zero business changes when swapping backends.' },
  { no: '03', icon: 'shield', title: 'Proof before claims', desc: 'conformance tests + compile-time interception. Every backend passes the same contract suite; semantic violations fail at compile time — every number on this site traces to a verification script.' },
  { no: '04', icon: 'code', title: 'Standard Vue authoring', desc: 'Business code is standard Vue SFC + standard HTML, no new DSL; cross-platform differences are absorbed at compile time — output stays close to hand-written, readable, debuggable, traceable to source.' },
]

const journeyEn = [
  { no: '01', title: 'Getting Started', desc: 'What & why: grasp Proteus’s fundamental difference from traditional cross-platform frameworks in three minutes.', to: '/docs/01-intro' },
  { no: '02', title: 'Start', desc: 'Create project → run & preview → build & release: four micro-pages get both Web and Mini Program running.', to: '/docs/04-requirements' },
  { no: '03', title: 'Code Anatomy', desc: 'Directory structure, page anatomy, two config layers — know what every file in the project is for.', to: '/docs/08-structure' },
  { no: '04', title: 'Core Concepts', desc: 'Semantic model, p-* semantic components, state and routing — the mental model you need before writing pages.', to: '/docs/framework/11-semantic-model' },
  { no: '05', title: 'Rendering & Capabilities', desc: 'Fluid layout, 50 capability Hooks, full-terminal adaptation — business code stays unaware of backends.', to: '/docs/17-fluid-layout' },
  { no: '06', title: 'Architecture & Engineering', desc: 'Pluggable SPI panorama, compile pipeline, testing & consistency — go deep inside the framework.', to: '/docs/framework/22-architecture' },
]

const capabilitiesEn = [
  { tag: 'G-27', title: 'Pluggable rendering', desc: 'RenderBackend SPI + five official backends (VueDom / Native×3 / Flutter) + hybrid rendering — pick an engine per page in the same app, business code unchanged.' },
  { tag: 'G-29/38', title: 'Pluggable compiler', desc: 'config.compiler.backend — one flag switches Node / Rust (same CompilerIR, semantic-equivalence Golden 81 cases), frozen SPI + incremental sessions.' },
  { tag: 'G-31/32', title: 'Semantic primitives SSOT', desc: '136 semantic primitives SSOT → 59 p-* components → 45 implemented semantics × 6 backends under conformance gates + 50 capability Hooks.' },
  { tag: 'G-41/42/43', title: 'Host layer trio', desc: '36-combination matrix hot-swap + six container strategies (super-app sandbox / crash isolation) + ownership with borrow-checking intercepting use-after-move at compile time.' },
  { tag: 'G-45', title: 'Dev host as host', desc: 'Install-Once Host: dynamic plugin loading (signature + conformance quick check) + pending replay — native plugin changes never re-package the host.' },
  { tag: 'G-36', title: 'AI-native end to end', desc: 'MCP Server + Agent Kit self-repair loop + three guard rails — AI emits IR-contract-conforming standard code, not free text.' },
]

/** stats 英文层（数字与 zh 同源同值——只翻 label/source） */
const STATS_EN = [
  { value: '38', label: '@proteus-vue/* packages', source: 'npm run check:pkg (38 packages, 0 errors)' },
  { value: '2006', label: 'unit tests green', source: 'npm test (official gate, e2e excluded)' },
  { value: '128', label: 'semantic primitives SSOT', source: 'PRIMITIVE_CATALOG (proteus audit coverage)' },
  { value: '45', label: 'implemented semantics × 6 backends', source: 'conformance gates' },
  { value: '59', label: 'p-* semantic components', source: 'proteus components:audit' },
  { value: '69', label: 'compile rules with AI explainers', source: 'listTransformRules (compiler transforms registry)' },
  { value: '8', label: 'conformance suites', source: 'RND/H/C/CMP/ABI/NAT-C series' },
  { value: '69', label: 'plan documents', source: 'docs/*-plan dirs (board-inventory index)' },
]

/** 对标矩阵英文层（状态列与 zh 同——只翻文案列） */
const COMPARE_EN = [
  { dim: 'Rendering base', uniapp: 'WebView', rn: 'Native (locked)', flutter: 'Skia (locked)', proteus: 'Pluggable (Vue/Native/Flutter/Skia)', status: '✅' },
  { dim: 'Multi-backend per app', uniapp: '❌', rn: '❌', flutter: '❌', proteus: 'Per-page switch + hybrid rendering', status: '✅' },
  { dim: 'Compiler', uniapp: 'Locked', rn: 'Locked (Metro)', flutter: 'Locked', proteus: 'SPI pluggable (Node/Rust, one flag)', status: '🟡' },
  { dim: 'Authoring', uniapp: 'view/text DSL', rn: 'JSX + native components', flutter: 'Dart', proteus: 'Standard HTML + standard Vue SFC', status: '✅' },
  { dim: 'Layout adaptation', uniapp: 'rpx (unit conversion)', rn: 'LayoutBuilder', flutter: 'AdaptiveScaffold', proteus: 'System fluid layout (p-*)', status: '✅' },
  { dim: 'Memory governance', uniapp: 'GC fallback', rn: 'GC fallback', flutter: 'GC + manual', proteus: 'Ownership + borrow-check interception at compile time', status: '✅' },
  { dim: 'AI involvement', uniapp: 'No IR, text replace', rn: 'Same', flutter: 'Same', proteus: 'Operates IR + enforced validation + self-repair', status: '✅' },
  { dim: 'Hand-written native plugins', uniapp: 'Plugin-market lottery', rn: 'Must write Native Module', flutter: 'Must write Plugin', proteus: 'Semantic interface + NativeBackend', status: '📋' },
]

const enOn = (): boolean => locale.value === 'en'
const pillars = computed(() => (enOn() ? pillarsEn : pillarsZh))
const journey = computed(() => (enOn() ? journeyEn : journeyZh))
const capabilities = computed(() => (enOn() ? capabilitiesEn : capabilitiesZh))
const scenarios = computed(() => (enOn() ? scenariosEn : scenariosZh))
const statItems = computed(() => (enOn() ? STATS_EN : STATS))
const compareRows = computed(() => (enOn() ? COMPARE_EN : COMPARE_MATRIX))
</script>

<template>
  <p-page ref="homeEl" class="home" :class="{ 'no-motion': !motionOk }">
    <!-- 1. Hero：双栏（左文案 + 右产品视觉）——参考「专业组件库官网」构图 -->
    <p-view v-p-fluid="'padding-top(56, 112) padding-bottom(40, 76)'" class="hero">
      <p-grid :min-col-width="380" :gap="40" class="hero-grid">
        <p-view class="hero-copy">
          <span class="eyebrow">{{ t('home.eyebrow') }}</span>
          <p-heading :level="1" v-p-fluid="'font-size(32, 54)'" class="hero-title">
            {{ t('home.heroTitle1') }}<br />
            <em>{{ t('home.heroTitle2') }}</em>
          </p-heading>
          <p-text v-p-fluid="'font-size(15, 17)'" class="hero-sub">{{ t('home.heroSub') }}</p-text>
          <p-stack direction="row" :gap="12" class="hero-cta">
            <router-link to="/docs/04-requirements" class="btn btn-primary">
              <p-text class="btn-text">{{ t('home.ctaStart') }}</p-text>
            </router-link>
            <router-link to="/playground" class="btn btn-ghost">
              <p-text class="btn-text ghost">{{ t('home.ctaPlay') }}</p-text>
            </router-link>
          </p-stack>
        </p-view>
        <!-- 产品视觉：同一份语义 → 多端产物（纯 CSS 玻璃窗 mock；不依赖特效） -->
        <p-view class="hero-visual" aria-hidden="true">
          <span class="hv-glow" />
          <p-view class="hv-frame">
            <p-stack direction="row" :gap="6" class="hv-bar"><span class="hv-dot" /><span class="hv-dot" /><span class="hv-dot" /></p-stack>
            <p-stack direction="row" :gap="0" class="hv-body">
              <p-view class="hv-side">
                <p-text class="hv-item on">源码</p-text>
                <p-text class="hv-item">Compile</p-text>
                <p-text class="hv-item">Render</p-text>
                <p-text class="hv-item">Capability</p-text>
              </p-view>
              <p-view class="hv-main">
                <p-text class="hv-line w80" />
                <p-text class="hv-line w60" />
                <p-stack direction="row" :gap="10" class="hv-cards">
                  <p-view class="hv-card"><p-text class="hv-ring" /><p-text class="hv-cap">Web</p-text></p-view>
                  <p-view class="hv-card"><p-stack direction="row" :gap="4" class="hv-bars"><i /><i /><i /></p-stack><p-text class="hv-cap">小程序</p-text></p-view>
                  <p-view class="hv-card"><p-text class="hv-ring alt" /><p-text class="hv-cap">Native</p-text></p-view>
                </p-stack>
              </p-view>
            </p-stack>
          </p-view>
        </p-view>
      </p-grid>
      <!-- 数字行（可追溯；完整项见下方「数字背书」区） -->
      <p-stack direction="row" :gap="44" wrap class="hero-stats">
        <p-view v-for="h in heroStats" :key="h.label" class="hero-stat">
          <p-text class="hs-value">{{ h.value }}</p-text>
          <p-text class="hs-label">{{ h.label }}</p-text>
        </p-view>
      </p-stack>
    </p-view>

    <!-- 2. 为什么选择（eyebrow + 居中标题 + 四图标卡） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec why">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.whyEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.featuresTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.whySub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="250" :gap="14">
        <p-view v-for="(p, i) in pillars" :key="p.no" v-p-hover class="card icon-card" :style="{ '--stagger-i': String(i) }">
          <span class="card-icon"><FeatureIcon :name="p.icon" /></span>
          <p-heading :level="3" class="card-title">{{ p.title }}</p-heading>
          <p-text class="card-desc">{{ p.desc }}</p-text>
        </p-view>
      </p-grid>
    </p-view>

    <!-- 3. 更少的代码（左文案 + 右代码/预览双栏） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec code-sec">
      <p-grid :min-col-width="360" :gap="36" class="hero-grid code-grid">
        <p-view class="hero-copy">
          <span class="sec-eyebrow">{{ t('home.codeEyebrow') }}</span>
          <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title left">{{ t('home.codeTitle') }}</p-heading>
          <p-text class="sec-sub left">{{ t('home.codeSub') }}</p-text>
          <router-link to="/docs/08-structure" class="btn btn-ghost">
            <p-text class="btn-text ghost">{{ t('home.codeCta') }}</p-text>
          </router-link>
        </p-view>
        <p-view class="code-demo">
          <TransformDemo compact panel-title="Mini Playground" />
        </p-view>
      </p-grid>
    </p-view>

    <!-- 4. 数字背书（stats.ts 可追溯） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec stats">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.statsEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.statsTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.statsSub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="200" :gap="12">
        <pg-glass v-for="(s, i) in statItems" :key="s.label" preset="card" intensity="thin" :radius="14" :noise="0.03" class="stat" :style="{ '--stagger-i': String(i) }">
          <p-text class="stat-value">{{ counters[i] ?? s.value }}</p-text>
          <p-text class="stat-label">{{ s.label }}</p-text>
          <p-text class="stat-source">{{ s.source }}</p-text>
        </pg-glass>
      </p-grid>
    </p-view>

    <!-- 5. 适用场景（3 图标卡） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec scenarios">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.scenEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.scenTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.scenSub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="260" :gap="14">
        <p-view v-for="(s, i) in scenarios" :key="s.title" v-p-hover class="card icon-card" :style="{ '--stagger-i': String(i) }">
          <span class="card-icon"><FeatureIcon :name="s.icon" /></span>
          <p-heading :level="3" class="card-title">{{ s.title }}</p-heading>
          <p-text class="card-desc">{{ s.desc }}</p-text>
        </p-view>
      </p-grid>
    </p-view>

    <!-- 5b. 核心能力（G 系能力矩阵——框架价值主张） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec features">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.capEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.capTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.capSub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="280" :gap="14">
        <p-view v-for="(c, i) in capabilities" :key="c.tag" v-p-hover class="card feature-card" :style="{ '--stagger-i': String(i) }">
          <p-text class="feature-tag">{{ c.tag }}</p-text>
          <p-heading :level="3" class="card-title">{{ c.title }}</p-heading>
          <p-text class="card-desc">{{ c.desc }}</p-text>
        </p-view>
      </p-grid>
    </p-view>

    <!-- 6. 生态支持（技术栈 logo 行） -->
    <p-view v-p-fluid="'padding-top(36, 76) padding-bottom(36, 76)'" data-reveal class="sec stack">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.stackEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ t('home.stackTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.stackSub') }}</p-text>
      </p-view>
      <p-stack direction="row" :gap="14" wrap class="stack-row">
        <span v-for="s in stackItems" :key="s.name" class="stack-chip">
          <span class="stack-badge" :style="{ color: s.color }">{{ s.short }}</span>
          <p-text class="stack-name">{{ s.name }}</p-text>
        </span>
      </p-stack>
    </p-view>

    <!-- 7. 对标表（与「翻译派」的本质分水岭） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec compare">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.compareEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.compareTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.compareSub') }}</p-text>
      </p-view>
      <div class="table-wrap">
        <table class="cmp-table">
          <thead>
            <tr><th>{{ t('home.dim') }}</th><th>uni-app</th><th>React Native</th><th>Flutter</th><th class="cmp-proteus-head">Proteus</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in compareRows" :key="row.dim">
              <td class="cmp-dim">{{ row.dim }}</td>
              <td data-label="uni-app">{{ row.uniapp }}</td>
              <td data-label="React Native">{{ row.rn }}</td>
              <td data-label="Flutter">{{ row.flutter }}</td>
              <td class="cmp-proteus" data-label="Proteus">{{ row.proteus }} <span class="cmp-status" :class="statusClass(row.status)">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p-text class="cmp-note center-block">{{ t('home.cmpNote') }}</p-text>
    </p-view>

    <!-- 8. dogfooding 金句 -->
    <p-view v-p-fluid="'padding-top(40, 84) padding-bottom(40, 84)'" data-reveal class="sec quote">
      <p-heading :level="2" v-p-fluid="'font-size(20, 32)'" class="quote-line">
        「{{ t('home.quote1') }}」<br />
        {{ t('home.quote2a') }}<em>&lt;p-grid&gt;</em>{{ t('home.quote2b') }}
      </p-heading>
      <p-text class="quote-sub">{{ t('home.quoteSubPre') }}<strong class="grad">dogfooding</strong>{{ t('home.quoteSubPost') }}</p-text>
      <p-stack direction="row" :gap="18" class="quote-links">
        <router-link to="/docs/framework/11-semantic-model" class="method-link">{{ t('home.linkSemantic') }}</router-link>
        <a class="method-link" href="https://github.com/proteus-vue/proteus/tree/main/docs/spi-first-methodology" target="_blank" rel="noreferrer">{{ t('home.linkSpi') }}</a>
      </p-stack>
    </p-view>

    <!-- 9. 学习路径 -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec journey">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.journeyEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.journeyTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.journeySub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="220" :gap="12">
        <router-link v-for="(s, i) in journey" :key="s.title" :to="s.to" v-p-hover class="card journey-card" :style="{ '--stagger-i': String(i) }">
          <p-text class="pillar-no">{{ s.no }}</p-text>
          <p-heading :level="3" class="card-title">{{ s.title }}</p-heading>
          <p-text class="card-desc">{{ s.desc }}</p-text>
          <p-text class="journey-go">{{ t('home.journeyGo') }}</p-text>
        </router-link>
      </p-grid>
    </p-view>

    <!-- 10. 底部 CTA 横幅 -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(56, 100)'" data-reveal class="sec cta-banner">
      <p-view class="cta-panel">
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="cta-title">{{ t('home.endTitle') }}</p-heading>
        <p-text class="cta-sub">{{ t('home.endSub') }}</p-text>
        <p-stack direction="row" :gap="12" class="cta-actions">
          <router-link to="/docs/04-requirements" class="btn btn-primary"><p-text class="btn-text">{{ t('home.ctaStart') }}</p-text></router-link>
          <a class="btn btn-ghost" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer"><p-text class="btn-text ghost">GitHub ↗</p-text></a>
        </p-stack>
      </p-view>
    </p-view>
  </p-page>
</template>

<style scoped>
/* ============ Home（★2026-09-11 按参考构图重排：双栏 Hero + eyebrow 区块头 + 图标卡 + 技术栈 + CTA 横幅） ============ */
.home { display: block; }

/* ---- 通用按钮 ---- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 11px 22px;
  border-radius: var(--radius-md);
  text-decoration: none;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, filter 0.15s;
  white-space: nowrap;
}
.btn-primary { background: var(--brand); }
.btn-primary:hover { background: #6a4cf0; }
.btn-ghost { border-color: var(--line); }
.btn-ghost:hover { border-color: var(--brand); }
.btn-text { color: #fff; font-weight: 600; font-size: 14px; }
.btn-text.ghost { color: var(--ink); }

/* ---- 通用区块头（eyebrow + 居中标题 + 副标题） ---- */
.sec { max-width: 1180px; margin: 0 auto; }
.sec-head { text-align: center; max-width: 700px; margin: 0 auto 48px; align-items: center; }
.sec-eyebrow {
  display: inline-block;
  width: fit-content;
  color: var(--brand-ink);
  font-size: 12.5px;
  letter-spacing: 0.3px;
  border: 1px solid rgba(124, 92, 255, 0.3);
  background: var(--brand-soft);
  border-radius: var(--radius-pill);
  padding: 4px 12px;
  margin-bottom: 14px;
}
.sec-title { color: var(--ink); margin: 0 0 14px; font-weight: 700; letter-spacing: -0.01em; }
.sec-title.left, .sec-sub.left { text-align: left; }
.sec-sub { color: var(--muted); font-size: 15px; line-height: 1.7; margin: 0; display: block; }

/* ---- 1. Hero 双栏 ---- */
.hero { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 64px; }
/* 布局归 p-grid（:min-col-width/:gap）；这里只做交叉轴对齐 */
.hero-grid { align-items: center; }
.hero-copy { max-width: 620px; }
.eyebrow {
  display: inline-block;
  width: fit-content;
  color: var(--brand-ink);
  font-size: 12.5px;
  letter-spacing: 0.3px;
  border: 1px solid rgba(124, 92, 255, 0.3);
  background: var(--brand-soft);
  border-radius: var(--radius-pill);
  padding: 4px 12px;
}
.hero-title { color: var(--ink); line-height: 1.1; letter-spacing: -0.02em; font-weight: 800; margin: 20px 0 16px; }
.hero-title em { font-style: normal; color: var(--brand-ink); }
.hero-sub { color: var(--muted); line-height: 1.75; margin: 0 0 26px; display: block; }
.hero-cta { align-items: center; }
/* 产品视觉（纯 CSS 玻璃窗 mock） */
.hero-visual { position: relative; }
.hv-glow {
  position: absolute;
  inset: -8% -6%;
  background: radial-gradient(60% 60% at 60% 30%, rgba(124, 92, 255, 0.22), transparent 70%);
  filter: blur(30px);
  pointer-events: none;
}
.hv-frame {
  position: relative;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.42);
}
.hv-bar { padding: 10px 14px; border-bottom: 1px solid var(--line); }
.hv-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--panel2); border: 1px solid var(--line); }
.hv-body { min-height: 176px; align-items: stretch; }
.hv-side { width: 108px; border-right: 1px solid var(--line); padding: 12px 10px; display: flex; flex-direction: column; gap: 11px; flex-shrink: 0; }
.hv-item { color: var(--dim); font-size: 12.5px; }
.hv-item.on { color: var(--brand-ink); font-weight: 600; }
.hv-main { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.hv-line { display: block; height: 9px; border-radius: 5px; background: var(--panel2); }
.hv-line.w80 { width: 80%; }
.hv-line.w60 { width: 60%; }
.hv-cards { margin-top: auto; }
.hv-card {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: var(--bg);
}
.hv-ring { display: block; width: 30px; height: 30px; border-radius: 50%; border: 3px solid var(--brand); border-right-color: var(--line); }
.hv-ring.alt { border-color: var(--brand2); border-top-color: var(--line); }
.hv-bars { align-items: flex-end; height: 30px; }
.hv-bars i { width: 6px; border-radius: 3px; background: var(--brand2); }
.hv-bars i:nth-child(1) { height: 14px; }
.hv-bars i:nth-child(2) { height: 22px; }
.hv-bars i:nth-child(3) { height: 30px; }
.hv-cap { color: var(--muted); font-size: 12px; }
/* Hero 数字行 */
.hero-stats { align-items: flex-start; }
.hero-stat { display: flex; flex-direction: column; gap: 4px; }
.hs-value { color: var(--ink); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.hs-label { color: var(--muted); font-size: 13px; }

/* ---- 卡片（图标卡 / 能力卡 / 学习路径卡） ---- */
.card {
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: 24px;
  background: var(--panel);
  transition: border-color 0.15s;
}
.card:hover { border-color: var(--brand); }
.card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius-md);
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.25);
  margin-bottom: 14px;
}
.card-title { color: var(--ink); margin: 0 0 10px; font-size: 16.5px; }
.card-desc { color: var(--muted); font-size: 13.5px; line-height: 1.75; }
.feature-tag { color: var(--brand-ink); font-size: 12px; letter-spacing: 0.8px; display: block; margin-bottom: 8px; }
.feature-card { display: flex; flex-direction: column; }

/* ---- 学习路径卡（整卡可点） ---- */
.journey-card { display: block; text-decoration: none; height: 100%; }
.journey-go { color: var(--brand-ink); font-size: 12px; margin: 12px 0 0; display: block; }
.pillar-no { color: var(--brand-ink); font-size: 12px; letter-spacing: 1px; display: block; margin-bottom: 6px; }

/* ---- 3. 代码/编译双栏 ---- */
.code-sec { }
.code-grid { align-items: center; }
.code-demo { min-width: 0; }

/* ---- 数字背书 ---- */
.stat { padding: var(--sp-14); height: 100%; transition: border-color 0.15s; }
.stat:hover { border-color: var(--brand); }
.stat-value { color: var(--brand-ink); font-size: 26px; font-weight: 700; }
.stat-label { color: var(--ink); font-size: 13px; }
.stat-source { color: var(--muted); font-size: 12px; }

/* ---- 生态支持（技术栈行） ---- */
.stack-row { justify-content: center; }
.stack-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: var(--radius-pill);
  padding: 10px 20px 10px 12px;
}
.stack-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 800;
}
.stack-name { color: var(--ink); font-size: 14px; font-weight: 600; }

/* ---- 对标表（★2026-09-11：窄容器卡片化——@container 驱动，免横向滚动） ---- */
.compare { container-type: inline-size; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-xl); min-width: 0; max-width: 100%; }
/* 窄容器：每行变一张卡（thead 隐藏，cell 带 data-label 左标签） */

.cmp-table { border-collapse: collapse; width: 100%; font-size: 13px; min-width: 640px; }
.cmp-table th { color: var(--ink); background: var(--panel2); padding: 11px 14px; text-align: left; white-space: nowrap; }
.cmp-table td { color: var(--muted); border-top: 1px solid var(--line); padding: 11px 14px; }
.cmp-dim { color: var(--ink); font-weight: 600; white-space: nowrap; }
.cmp-proteus-head, .cmp-proteus { color: var(--ink); background: var(--brand-soft); }
.cmp-status { font-size: 12px; }
.cmp-status.st-ok { color: var(--ok); }
.cmp-status.st-warn { color: var(--warn); }
.cmp-status.st-plan { color: var(--dim); }
.cmp-note { color: var(--muted); font-size: 12px; margin-top: 12px; display: block; }
/* 窄容器卡片化（置于基础规则之后——同优先级后写胜出，覆盖 min-width 640） */
@container (max-width: 720px) {
  .table-wrap { overflow: visible; border: none; }
  .cmp-table { display: block; min-width: 0; font-size: 13.5px; }
  .cmp-table thead { display: none; }
  .cmp-table tbody { display: block; }
  .cmp-table tr {
    display: block;
    border: 1px solid var(--line);
    border-radius: var(--radius-xl);
    background: var(--panel);
    margin-bottom: 12px;
    overflow: hidden;
  }
  .cmp-table td { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; border-top: 1px solid var(--line-soft); padding: 11px 16px; }
  .cmp-table td:first-child { border-top: none; }
  .cmp-table td.cmp-dim { display: block; background: var(--panel2); color: var(--ink); font-weight: 700; padding: 13px 16px; }
  .cmp-table td:not(.cmp-dim)::before { content: attr(data-label); color: var(--dim); font-weight: 500; flex-shrink: 0; }
  .cmp-table td.cmp-proteus { background: var(--brand-soft); }
}
.center-block { text-align: center; }

/* ---- dogfooding 金句 ---- */
.quote { max-width: 880px; margin: 0 auto; text-align: center; }
.quote-line { color: var(--ink); line-height: 1.45; margin: 0 0 12px; }
.quote-line em { font-style: normal; color: var(--brand-ink); font-weight: 800; }
.quote-sub { color: var(--muted); font-size: 15px; display: block; }
.quote-sub .grad { color: var(--brand-ink); font-weight: 600; }
.quote-links { justify-content: center; margin-top: 20px; }
.method-link { color: var(--brand-ink); text-decoration: none; font-size: 14px; }
.method-link:hover { text-decoration: underline; }

/* ---- 底部 CTA 横幅 ---- */
.cta-panel {
  text-align: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(60% 120% at 50% 0%, rgba(124, 92, 255, 0.16), transparent 70%),
    var(--panel);
  padding: 52px 24px;
}
.cta-title { color: var(--ink); margin: 0 0 10px; }
.cta-sub { color: var(--muted); font-size: 14.5px; margin: 0 0 24px; display: block; }
.cta-actions { justify-content: center; }

/* ---- 滚动显现 + stagger ---- */
[data-reveal] { opacity: 0; transform: translateY(18px); transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.2, 0.7, 0.3, 1); }
[data-reveal].revealed { opacity: 1; transform: none; }
.no-motion [data-reveal] { opacity: 1; transform: none; transition: none; }
.why .card, .stats .stat, .features .card, .scenarios .card, .journey .journey-card {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.55s ease, transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1), border-color 0.15s;
  transition-delay: calc(var(--stagger-i, 0) * 70ms);
}
.revealed .card, .revealed .stat { opacity: 1; transform: none; }
.no-motion .card, .no-motion .stat { opacity: 1; transform: none; transition: none; }
</style>
