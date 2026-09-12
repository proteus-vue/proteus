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
import WireframeCore from '../components/WireframeCore.vue'
import VectorOrb from '../components/VectorOrb.vue'
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
  { value: '40', label: '@proteus-vue/* 包' },
  { value: String(STATS[1]?.value ?? '2966'), label: '单测全绿' },
  { value: '154', label: '语义原语 SSOT' },
]
const heroStatsEn = [
  { value: '40', label: '@proteus-vue/* packages' },
  { value: String(STATS[1]?.value ?? '2966'), label: 'unit tests green' },
  { value: '154', label: 'semantic primitives SSOT' },
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
    desc: '柔性布局、51 个能力 Hook、全终端适配——业务代码对后端零感知。',
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
  { icon: 'phone', title: '小程序 / Web 同源复用', desc: '同一份标准 Vue SFC，Web 由渲染后端直出 DOM、小程序由编译器生成 Skyline 四件套——零 #ifdef。' },
  { icon: 'app', title: '多端同屏与宿主容器', desc: '同一份语义按端形态推导界面：手机 / 平板 / PC / 车机 / 电视 / 手表，或嵌入超级 App 沙箱。' },
  { icon: 'bolt', title: 'AI 原生开发流', desc: 'MCP Server + Agent Kit：AI 操作语义 IR 而非自由文本，产出天然通过 IR 契约校验——可自修复。' },
  { icon: 'box', title: '设计系统与组件库', desc: '154 语义原语 SSOT 驱动 66 个语义组件 + 设计 token；布局语义编译期可校验，而非 CSS 事后救。' },
]
const scenariosEn = [
  { icon: 'layout', title: 'Admin & enterprise apps', desc: 'Standard Vue + semantic components — Web direct-out, Mini Program from the same source; one codebase for back-office and internal systems.' },
  { icon: 'chart', title: 'Data visualization & charts', desc: 'Canvas / SVG channel alignment (shape animation, path motion, gradient clipping); complex graphics redraw per frame under Skyline.' },
  { icon: 'phone', title: 'Mini Program / Web reuse', desc: 'One standard Vue SFC: Web renders real DOM, Mini Program compiles to Skyline artifacts — zero #ifdef.' },
  { icon: 'app', title: 'Multi-device & host containers', desc: 'The same semantics derive per-target UI: phone / tablet / PC / car / TV / watch, or embedded in a super-app sandbox.' },
  { icon: 'bolt', title: 'AI-native development', desc: 'MCP Server + Agent Kit: AI operates the semantic IR, not free text — output naturally passes IR contract validation, self-repairable.' },
  { icon: 'box', title: 'Design systems & libraries', desc: '154 semantic primitives SSOT drive 66 semantic components + design tokens; layout semantics checked at compile time, not patched with CSS.' },
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
    desc: '154 语义原语单一事实源 → 66 个语义组件 → 48 implemented 语义 × 6 后端 conformance 门禁 + 65 Capability Hook。',
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
  { no: '05', title: 'Rendering & Capabilities', desc: 'Fluid layout, 51 capability Hooks, full-terminal adaptation — business code stays unaware of backends.', to: '/docs/17-fluid-layout' },
  { no: '06', title: 'Architecture & Engineering', desc: 'Pluggable SPI panorama, compile pipeline, testing & consistency — go deep inside the framework.', to: '/docs/framework/22-architecture' },
]

const capabilitiesEn = [
  { tag: 'G-27', title: 'Pluggable rendering', desc: 'RenderBackend SPI + five official backends (VueDom / Native×3 / Flutter) + hybrid rendering — pick an engine per page in the same app, business code unchanged.' },
  { tag: 'G-29/38', title: 'Pluggable compiler', desc: 'config.compiler.backend — one flag switches Node / Rust (same CompilerIR, semantic-equivalence Golden 81 cases), frozen SPI + incremental sessions.' },
  { tag: 'G-31/32', title: 'Semantic primitives SSOT', desc: '154 semantic primitives SSOT → 66 semantic components → 48 implemented semantics × 6 backends under conformance gates + 65 capability Hooks.' },
  { tag: 'G-41/42/43', title: 'Host layer trio', desc: '36-combination matrix hot-swap + six container strategies (super-app sandbox / crash isolation) + ownership with borrow-checking intercepting use-after-move at compile time.' },
  { tag: 'G-45', title: 'Dev host as host', desc: 'Install-Once Host: dynamic plugin loading (signature + conformance quick check) + pending replay — native plugin changes never re-package the host.' },
  { tag: 'G-36', title: 'AI-native end to end', desc: 'MCP Server + Agent Kit self-repair loop + three guard rails — AI emits IR-contract-conforming standard code, not free text.' },
]

/** stats 英文层（数字与 zh 同源同值——只翻 label/source） */
const STATS_EN = [
  { value: '40', label: '@proteus-vue/* packages', source: 'npm run check:pkg (40 packages, 0 errors)' },
  { value: '2966', label: 'unit tests green', source: 'npm test (official gate, e2e excluded)' },
  { value: '154', label: 'semantic primitives SSOT', source: 'PRIMITIVE_CATALOG (proteus audit coverage)' },
  { value: '48', label: 'implemented semantics × 6 backends', source: 'conformance gates' },
  { value: '66', label: 'semantic components (p-*/pg-*)', source: 'proteus components:audit src/components' },
  { value: '106', label: 'compile rules with AI explainers', source: 'listTransformRules (compiler transforms registry)' },
  { value: '8', label: 'conformance suites', source: 'RND/H/C/CMP/ABI/NAT-C series' },
  { value: '81', label: 'plan documents', source: 'docs/*-plan dirs (board-inventory index)' },
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
    <!-- 0. 发布状态条（参考图首屏顶部：版本 / 许可 / 构建号；弱视觉、信息性） -->
    <p-stack direction="row" :gap="18" wrap class="release-bar">
      <span class="rb-item"><span class="rb-dot" />{{ t('home.relVersion') }}</span>
      <span class="rb-item">{{ t('home.relLicense') }}</span>
      <span class="rb-item">{{ t('home.relBuild') }}</span>
      <router-link to="/docs/01-intro" class="rb-link">{{ t('home.relMore') }}</router-link>
    </p-stack>
    <!-- 1. Hero：双栏（左文案 + 右产品视觉）——参考「专业组件库官网」构图 -->
    <p-view v-p-fluid="'padding-top(24, 44) padding-bottom(40, 76)'" class="hero">
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
        <!-- 产品视觉：真实 IDE/控制台 mock（纯 CSS + 语法着色；aria-hidden 装饰层） -->
        <p-view class="hero-visual" aria-hidden="true">
          <span class="hv-glow" />
          <!-- ★零依赖 WebGL 线框核心（icosahedron）——进首页即可见的「炫技」：
               比 IDE 窗口大一圈 → 几何体外沿环绕应用窗口（应用浮于 3D 结构之中）。 -->
          <WireframeCore class="hv-core" color="#7c5cff" :alpha="0.7" :speed="0.2" :scale="1.25" />
          <p-view class="hv-frame">
            <!-- 标题栏：窗口控件 + 当前文件 tab + 运行态徽标 -->
            <p-stack direction="row" :gap="10" class="hv-bar">
              <span class="hv-dots"><span class="hv-dot" /><span class="hv-dot" /><span class="hv-dot" /></span>
              <span class="hv-tab"><span class="hv-tab-dot" />ProductDetail.vue</span>
              <span class="hv-live">LIVE</span>
            </p-stack>
            <p-stack direction="row" :gap="0" class="hv-body">
              <!-- 资源管理器（文件树） -->
              <p-view class="hv-side">
                <p-text class="hv-side-title">EXPLORER</p-text>
                <p-text class="hv-file dir">src</p-text>
                <p-text class="hv-file">App.vue</p-text>
                <p-text class="hv-file on">ProductDetail.vue</p-text>
                <p-text class="hv-file dir">components</p-text>
                <p-text class="hv-file">p-grid</p-text>
                <p-text class="hv-file">p-stack</p-text>
              </p-view>
              <!-- 编辑器：行号 + 语法着色代码 -->
              <p-view class="hv-main">
                <pre class="hv-code"><code><span class="hv-cl"><span class="hv-ln">1</span><span class="hv-ct"><span class="tk-tag">&lt;script</span> <span class="tk-attr">setup</span><span class="tk-tag">&gt;</span></span></span>
<span class="hv-cl"><span class="hv-ln">2</span><span class="hv-ct"><span class="tk-kw">import</span> { <span class="tk-fn">ref</span> } <span class="tk-kw">from</span> <span class="tk-str">'vue'</span></span></span>
<span class="hv-cl"><span class="hv-ln">3</span><span class="hv-ct"></span></span>
<span class="hv-cl"><span class="hv-ln">4</span><span class="hv-ct"><span class="tk-kw">const</span> product = <span class="tk-fn">ref</span>({ name: <span class="tk-str">'Proteus'</span> })</span></span>
<span class="hv-cl"><span class="hv-ln">5</span><span class="hv-ct"><span class="tk-kw">const</span> qty = <span class="tk-fn">ref</span>(<span class="tk-num">1</span>)</span></span>
<span class="hv-cl"><span class="hv-ln">6</span><span class="hv-ct"></span></span>
<span class="hv-cl"><span class="hv-ln">7</span><span class="hv-ct"><span class="tk-kw">function</span> <span class="tk-fn">addToCart</span>() { qty.<span class="tk-attr">value</span><span class="tk-op">++</span> }</span></span>
<span class="hv-cl"><span class="hv-ln">8</span><span class="hv-ct"><span class="tk-tag">&lt;/script&gt;</span></span></span>
<span class="hv-cl"><span class="hv-ln">9</span><span class="hv-ct"></span></span>
<span class="hv-cl"><span class="hv-ln">10</span><span class="hv-ct"><span class="tk-tag">&lt;template&gt;</span></span></span>
<span class="hv-cl"><span class="hv-ln">11</span><span class="hv-ct">  <span class="tk-tag">&lt;p-grid</span> <span class="tk-attr">:min-col-width</span>=<span class="tk-str">"240"</span><span class="tk-tag">&gt;</span></span></span>
<span class="hv-cl"><span class="hv-ln">12</span><span class="hv-ct">    <span class="tk-tag">&lt;p-card</span> <span class="tk-attr">v-for</span>=<span class="tk-str">"c in cards"</span> <span class="tk-attr">:key</span>=<span class="tk-str">"c.id"</span> <span class="tk-tag">/&gt;</span></span></span>
<span class="hv-cl"><span class="hv-ln">13</span><span class="hv-ct">  <span class="tk-tag">&lt;/p-grid&gt;</span></span></span>
<span class="hv-cl"><span class="hv-ln">14</span><span class="hv-ct"><span class="tk-tag">&lt;/template&gt;</span></span></span></code></pre>
              </p-view>
            </p-stack>
            <!-- 状态栏（仿编辑器底栏：分支 / 诊断 / 编译耗时） -->
            <p-stack direction="row" :gap="16" class="hv-foot">
              <span class="hv-st"><span class="hv-branch">⑂</span> main</span>
              <span class="hv-st ok"><span class="hv-orb" />0 errors</span>
              <span class="hv-st">compile 2ms</span>
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

    <!-- 3. 更少的代码（★2026-09-11 改版：文案在上、Playground 全宽在下——
         此前左右两栏使右侧仅 548px < TransformDemo 并排门槛 880px → 代码/产物被迫上下堆叠
         成 1164px 高，左栏文案被垂直居中而上下大片空白。全宽后 demo 有 ~1180px → 真并排、矮一半） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec code-sec">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.codeEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.codeTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.codeSub') }}</p-text>
        <router-link to="/docs/08-structure" class="btn btn-ghost code-cta">
          <p-text class="btn-text ghost">{{ t('home.codeCta') }}</p-text>
        </router-link>
      </p-view>
      <p-view class="code-demo">
        <TransformDemo compact panel-title="Mini Playground" />
      </p-view>
    </p-view>

    <!-- 4. 数字背书（stats.ts 可追溯） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec stats">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.statsEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.statsTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.statsSub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="270" :gap="12">
        <pg-glass v-for="(s, i) in statItems" :key="s.label" preset="card" intensity="thin" :radius="14" :noise="0.03" class="stat" :style="{ '--stagger-i': String(i) }">
          <p-text class="stat-value">{{ counters[i] ?? s.value }}</p-text>
          <span class="stat-bar" />
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
      <p-grid :min-col-width="340" :gap="14">
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

    <!-- 5c. 渲染通道（★炫技：同一份语义 → 两条渲染通道——SVG 矢量 + WebGL 结构，均为框架自身能力） -->
    <p-view v-p-fluid="'padding-top(40, 88) padding-bottom(40, 88)'" data-reveal class="sec channels">
      <p-view class="sec-head">
        <span class="sec-eyebrow">{{ t('home.chanEyebrow') }}</span>
        <p-heading :level="2" v-p-fluid="'font-size(22, 32)'" class="sec-title">{{ t('home.chanTitle') }}</p-heading>
        <p-text class="sec-sub">{{ t('home.chanSub') }}</p-text>
      </p-view>
      <p-grid :min-col-width="380" :gap="16">
        <p-view class="chan-card">
          <p-view class="chan-stage"><VectorOrb /></p-view>
          <p-stack direction="row" :gap="8" class="chan-meta">
            <span class="chan-tag">SVG</span>
            <p-text class="chan-name">{{ t('home.chanV1') }}</p-text>
          </p-stack>
          <p-text class="chan-desc">{{ t('home.chanVSub') }}</p-text>
        </p-view>
        <p-view class="chan-card">
          <p-view class="chan-stage"><WireframeCore class="chan-core" color="#7c5cff" :alpha="0.85" :speed="0.35" :scale="1.05" /></p-view>
          <p-stack direction="row" :gap="8" class="chan-meta">
            <span class="chan-tag">WebGL</span>
            <p-text class="chan-name">{{ t('home.chanW1') }}</p-text>
          </p-stack>
          <p-text class="chan-desc">{{ t('home.chanWSub') }}</p-text>
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
      <p-grid :min-col-width="340" :gap="12">
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
        <!-- ★零依赖 WebGL 线框核心（icosahedron）——底部 CTA 背景：慢速旋转 3D 结构（工程炫技自证，
             零第三方依赖；纯合成器动画）。此区块留白充足，几何体完整可见而不遮挡文字。 -->
        <WireframeCore class="cta-core" color="#7c5cff" :alpha="0.62" :speed="0.16" />
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
/* sec-head 内的 CTA 按钮：自适应宽度（flex 子项默认 stretch 会拉满整行） */
.code-cta { width: fit-content; margin: 20px auto 0; }

/* ---- 0. 发布状态条 ---- */
.release-bar {
  max-width: 1180px;
  margin: 0 auto;
  padding-top: 26px;
  align-items: center;
  gap: 18px;
}
.rb-item { color: var(--dim); font-size: 12.5px; display: inline-flex; align-items: center; gap: 7px; }
.rb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px rgba(61, 220, 151, 0.16); }
.rb-link { color: var(--brand-ink); font-size: 12.5px; text-decoration: none; margin-left: auto; }
.rb-link:hover { text-decoration: underline; }

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
.hero-visual { position: relative; container-type: inline-size; }
.hv-glow {
  position: absolute;
  inset: -8% -6%;
  background: radial-gradient(60% 60% at 60% 30%, rgba(124, 92, 255, 0.22), transparent 70%);
  filter: blur(30px);
  pointer-events: none;
}
.hv-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 116%;
  height: 116%;
  transform: translate(-50%, -50%);
  z-index: 0;
}
.hv-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 156%;
  height: 156%;
  transform: translate(-50%, -50%);
  z-index: 0;
}
.hv-frame {
  position: relative;
  z-index: 1;
  /* 窗口微透明：背后线框几何体隐隐透出（浮于 3D 结构之上的观感），仍保证代码可读 */
  background: rgba(20, 20, 25, 0.82);
  /* d2-exempt: Hero IDE 窗口 chrome 的半透明磨砂（装饰层，非玻璃面——窗口微透明透出背后线框） */
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.42);
}
.hv-bar { padding: 11px 14px; border-bottom: 1px solid var(--line); align-items: center; gap: 10px; }
.hv-dots { display: flex; flex-direction: row; gap: 6px; flex-shrink: 0; }
.hv-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--panel2); border: 1px solid var(--line); }
.hv-tab { display: inline-flex; align-items: center; gap: 7px; color: var(--ink); font-size: 12.5px; background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 4px 12px; }
.hv-tab-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); flex-shrink: 0; }
.hv-live { color: var(--ok); font-size: 12px; letter-spacing: 0.5px; margin-left: auto; }
.hv-live::before { content: '● '; animation: hv-pulse 1.8s ease-in-out infinite; }
@keyframes hv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }
/* 编译扫描线：窗口顶部一条高光横向扫过（「正在编译」的观感；纯合成器动画） */
.hv-frame::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--brand), var(--brand2), transparent);
  background-size: 42% 100%;
  background-repeat: no-repeat;
  animation: hv-scan 3.4s ease-in-out infinite;
  pointer-events: none;
  z-index: 2;
}
@keyframes hv-scan {
  0% { background-position: -45% 0; }
  100% { background-position: 145% 0; }
}
.no-motion .hv-live::before, .no-motion .hv-frame::after { animation: none; }
.hv-body { min-height: clamp(230px, 19vw, 296px); align-items: stretch; }
.hv-side { width: clamp(122px, 9.5vw, 156px); border-right: 1px solid var(--line); padding: 14px 12px; display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; background: var(--bg); }
.hv-side-title { color: var(--dim); font-size: 12px; letter-spacing: 1px; margin-bottom: 7px; }
.hv-file { color: var(--muted); font-size: 12.5px; padding: 3px 8px; border-radius: var(--radius-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hv-file.dir { color: var(--dim); }
.hv-file.on { color: var(--brand-ink); background: var(--brand-soft); font-weight: 600; }
.hv-main { flex: 1; padding: 14px 18px; min-width: 0; overflow: hidden; }
/* ★<pre> 内 span 间的换行会被 white-space:pre 渲染成空行（14 行→27 行）——
   把 <code> 设为 flex 容器：子项成为 flex item，空白文本节点被忽略（不产生空行） */
.hv-code { margin: 0; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.7; }
.hv-code code { display: flex; flex-direction: column; }
.hv-cl { display: flex; flex-direction: row; gap: 12px; }
.hv-ln { color: var(--dim); width: 16px; text-align: right; flex-shrink: 0; }
.hv-ct { white-space: pre; }
.tk-tag { color: var(--syn-tag); }
.tk-attr { color: var(--syn-attr); }
.tk-str { color: var(--syn-str); }
.tk-kw { color: var(--syn-kw); }
.tk-fn { color: var(--syn-fn); }
.tk-num { color: var(--syn-attr); }
.tk-op { color: var(--muted); }
.hv-foot { padding: 8px 16px; border-top: 1px solid var(--line); background: var(--bg); align-items: center; }
.hv-st { color: var(--dim); font-size: 12px; display: inline-flex; align-items: center; gap: 5px; }
.hv-st.ok { color: var(--ok); }
.hv-branch { color: var(--brand-ink); }
/* 运行时核心（SVG 通道在 Hero 的落点）：小径向渐变圆核 + 脉冲——读作「引擎在跑」 */
.hv-orb {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 45%, #d6ccff, var(--brand) 52%, transparent 74%);
  box-shadow: 0 0 9px rgba(124, 92, 255, 0.75);
  animation: hv-orb-pulse 1.7s ease-in-out infinite;
}
@keyframes hv-orb-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.7); opacity: 0.55; }
}
.no-motion .hv-orb { animation: none; }
/* 窄容器：收起资源管理器，代码区获得全宽 */
@container (max-width: 520px) {
  /* ★特异性：p-view 自带 .p-view{display:flex}（同为 0,1,1）按捆绑顺序抢胜 → .hv-body .hv-side（0,2,1）压过 */
  .hv-body .hv-side { display: none; }
}
/* Hero 数字行 */
.hero-stats { align-items: flex-start; }
.hero-stat { display: flex; flex-direction: column; gap: 4px; }
.hs-value { color: var(--ink); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.hs-label { color: var(--muted); font-size: 13px; }

/* ---- 区块环境光晕（弱，去「死黑」；纯装饰层） ---- */
.channels { position: relative; }
.channels::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 30%;
  width: min(900px, 92vw);
  height: 420px;
  transform: translate(-50%, -30%);
  background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.10), transparent 70%);
  filter: blur(10px);
  pointer-events: none;
  z-index: 0;
}
.channels .sec-head, .channels .p-grid { position: relative; z-index: 1; }
/* ---- 渲染通道卡（深面 + 舞台 + 标签） ---- */
.chan-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, var(--panel2), var(--panel));
  padding: 20px;
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s;
}
.chan-card:hover { border-color: var(--brand); }
.chan-stage {
  position: relative;
  height: clamp(210px, 22vw, 268px);
  border-radius: var(--radius-lg);
  background: radial-gradient(60% 60% at 50% 42%, rgba(124, 92, 255, 0.14), transparent 72%), var(--bg);
  border: 1px solid var(--line-soft);
  overflow: hidden;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chan-core { position: absolute; inset: 0; width: 100%; height: 100%; }
.chan-meta { align-items: center; margin-bottom: 6px; }
.chan-tag {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.3);
  border-radius: var(--radius-chip);
  padding: 2px 8px;
}
.chan-name { color: var(--ink); font-size: 14.5px; font-weight: 600; }
.chan-desc { color: var(--muted); font-size: 13px; line-height: 1.65; }

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

.code-grid { align-items: center; }
.code-demo { min-width: 0; }

/* ---- 数字背书 ---- */
.stat { padding: var(--sp-14); height: 100%; transition: border-color 0.15s; }
.stat:hover { border-color: var(--brand); }
/* ★pg-glass 卡片非 flex-column → p-text(span) 会 inline 挤在同一行（「38@proteus-vue/* 包」）——
   显式 display:block 让数值/标签/来源各占一行 */
.stat-value { display: block; color: var(--brand-ink); font-size: 26px; font-weight: 700; line-height: 1.2; text-shadow: 0 0 20px rgba(124, 92, 255, 0.38); }
/* 强调条：显现时从左画出（与计数动画同步的「强调下划线」，非数据进度——不伪造百分比） */
.stat-bar {
  display: block;
  height: 2px;
  border-radius: 2px;
  margin: 10px 0 3px;
  background: linear-gradient(90deg, var(--brand), var(--brand2));
  transform-origin: 0 50%;
  transform: scaleX(0);
  transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.3, 1);
  transition-delay: calc(var(--stagger-i, 0) * 70ms);
}
.revealed .stat-bar { transform: scaleX(1); }
.no-motion .stat-bar { transform: scaleX(1); transition: none; }
.stat-label { display: block; color: var(--ink); font-size: 13px; margin-top: 2px; }
.stat-source { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }

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
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: clamp(320px, 34vw, 440px);
  text-align: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(60% 120% at 50% 0%, rgba(124, 92, 255, 0.16), transparent 70%),
    var(--panel);
  padding: 52px 24px;
}
.cta-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(400px, 84vw);
  height: min(400px, 84vw);
  transform: translate(-50%, -50%);
  z-index: 0;
}
.cta-title, .cta-sub, .cta-actions { position: relative; z-index: 1; }
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
