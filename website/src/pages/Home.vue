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
    title: '语义优先',
    desc: '组件即语义，不是 div 别名。p-grid 表达「网格意图」、p-stack 表达「流向」——布局语义编译期可校验，而不是靠 CSS 事后救。',
  },
  {
    no: '02',
    title: '全插层 SPI',
    desc: '编译 · UI · 能力 · 端，全部可插拔。Node/Rust 编译后端 × VueDom/Native/Flutter 渲染后端 × 能力桥——同一个语义 IR，换后端业务零改动。',
  },
  {
    no: '03',
    title: '证明先于宣称',
    desc: 'conformance test + 编译期拦截。每个后端过同一套契约测试；语义违规编译期报错——官网展示的每个数字都可追溯到验证脚本。',
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
  { no: '01', title: 'Semantics first', desc: 'Components are semantics, not div aliases. p-grid says “grid intent”, p-stack says “flow” — layout semantics are checked at compile time, not patched with CSS afterwards.' },
  { no: '02', title: 'SPI at every layer', desc: 'Compiler · UI · capabilities · targets — all pluggable. Node/Rust compile backends × VueDom/Native/Flutter render backends × capability bridges — one semantic IR, zero business changes when swapping backends.' },
  { no: '03', title: 'Proof before claims', desc: 'conformance tests + compile-time interception. Every backend passes the same contract suite; semantic violations fail at compile time — every number on this site traces to a verification script.' },
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
const statItems = computed(() => (enOn() ? STATS_EN : STATS))
const compareRows = computed(() => (enOn() ? COMPARE_EN : COMPARE_MATRIX))
</script>

<template>
  <p-page ref="homeEl" class="home" :class="{ 'no-motion': !motionOk }">
    <!-- 1. Hero（★2026-09-11 风格收敛：左对齐两行标题 + 数字行，去掉辉光/波浪/流光——对齐专业组件库构图） -->
    <p-view v-p-fluid="'padding-top(52, 96) padding-bottom(36, 56)'" class="hero">
      <p-view class="hero-content">
        <span class="eyebrow">{{ t('home.eyebrow') }}</span>
        <p-heading :level="1" v-p-fluid="'font-size(32, 56)'" class="hero-title">
          {{ t('home.heroTitle1') }}<br />
          <em>{{ t('home.heroTitle2') }}</em>
        </p-heading>
        <p-text v-p-fluid="'font-size(15, 17)'" class="hero-sub">
          {{ t('home.heroSub') }}
        </p-text>
        <p-stack direction="row" :gap="12" class="hero-cta">
          <router-link to="/docs/04-requirements" class="cta-primary">
            <p-text class="cta-text">{{ t('home.ctaStart') }}</p-text>
          </router-link>
          <router-link to="/playground" class="cta-ghost">
            <p-text class="cta-text">{{ t('home.ctaPlay') }}</p-text>
          </router-link>
        </p-stack>
      </p-view>
      <!-- 数字行（可追溯；完整 8 项见下方「数字背书」区） -->
      <p-stack direction="row" :gap="44" wrap class="hero-stats">
        <p-view v-for="h in heroStats" :key="h.label" class="hero-stat">
          <p-text class="hs-value">{{ h.value }}</p-text>
          <p-text class="hs-label">{{ h.label }}</p-text>
        </p-view>
      </p-stack>
    </p-view>

    <!-- 2. Mini Playground 面板（真实编译 · LIVE） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(20, 44)'" class="live-demo">
      <TransformDemo compact panel-title="Mini Playground" />
    </p-view>

    <!-- 3. 编号三支柱（v3 三卡构图；★#389 v-p-hover 全卡覆盖；★#389b 滚动显现） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(20, 44)'" data-reveal class="pillars">
      <p-grid :min-col-width="280" :gap="14">
        <p-view v-for="(p, i) in pillars" :key="p.no" v-p-hover class="pillar-card" :style="{ '--stagger-i': String(i) }">
          <p-text class="pillar-no">{{ p.no }}</p-text>
          <p-heading :level="3" class="pillar-title">{{ p.title }}</p-heading>
          <p-text class="pillar-desc">{{ p.desc }}</p-text>
        </p-view>
      </p-grid>
    </p-view>

    <!-- 4. 数字背书（stats.ts 可追溯；★#389 v-p-hover + 玻璃卡片 G-07 preset=card） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(20, 44)'" data-reveal class="stats">
      <p-grid :min-col-width="200" :gap="12">
        <pg-glass
          v-for="(s, i) in statItems"
          :key="s.label"
          preset="card"
          intensity="thin"
          :radius="14"
          :noise="0.03"
          class="stat"
          :style="{ '--stagger-i': String(i) }"
        >
          <p-text class="stat-value">{{ counters[i] ?? s.value }}</p-text>
          <p-text class="stat-label">{{ s.label }}</p-text>
          <p-text class="stat-source">{{ s.source }}</p-text>
        </pg-glass>
      </p-grid>
    </p-view>

    <!-- 能力矩阵 -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(20, 44)'" data-reveal class="features">
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">{{ t('home.featuresTitle') }}</p-heading>
      <p-grid :min-col-width="280" :gap="14">
        <p-view
          v-for="(c, i) in capabilities"
          :key="c.tag"
          v-p-hover
          class="feature-card"
          :style="{ '--stagger-i': String(i) }"
        >
          <p-text class="feature-tag">{{ c.tag }}</p-text>
          <p-heading :level="3" class="feature-title">{{ c.title }}</p-heading>
          <p-text class="feature-desc">{{ c.desc }}</p-text>
        </p-view>
      </p-grid>
    </p-view>

    <!-- 5. 对标表（v3：与「翻译派」的本质分水岭） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(20, 44)'" data-reveal class="compare">
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">{{ t('home.compareTitle') }}</p-heading>
      <p-text class="section-sub center">{{ t('home.compareSub') }}</p-text>
      <div class="table-wrap">
        <table class="cmp-table">
          <thead>
            <tr><th>{{ t('home.dim') }}</th><th>uni-app</th><th>React Native</th><th>Flutter</th><th class="cmp-proteus-head">Proteus</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in compareRows" :key="row.dim">
              <td class="cmp-dim">{{ row.dim }}</td>
              <td>{{ row.uniapp }}</td>
              <td>{{ row.rn }}</td>
              <td>{{ row.flutter }}</td>
              <td class="cmp-proteus">{{ row.proteus }} <span class="cmp-status" :class="statusClass(row.status)">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p-text class="cmp-note center-block">{{ t('home.cmpNote') }}</p-text>
    </p-view>

    <!-- 6. dogfooding 金句（v3 收尾构图） -->
    <p-view v-p-fluid="'padding-top(36, 72) padding-bottom(36, 72)'" data-reveal class="quote">
      <p-heading :level="2" v-p-fluid="'font-size(20, 34)'" class="quote-line">
        「{{ t('home.quote1') }}」<br />
        {{ t('home.quote2a') }}<em>&lt;p-grid&gt;</em>{{ t('home.quote2b') }}
      </p-heading>
      <p-text class="quote-sub">{{ t('home.quoteSubPre') }}<strong class="grad">dogfooding</strong>{{ t('home.quoteSubPost') }}</p-text>
      <p-stack direction="row" :gap="18" class="quote-links">
        <router-link to="/docs/framework/11-semantic-model" class="method-link">{{ t('home.linkSemantic') }}</router-link>
        <a class="method-link" href="https://github.com/proteus-vue/proteus/tree/main/docs/spi-first-methodology" target="_blank" rel="noreferrer">{{ t('home.linkSpi') }}</a>
      </p-stack>
    </p-view>

    <!-- 7. 快速开始（01-home §5：3 步） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(36, 64)'" data-reveal class="quickstart">
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">{{ t('home.quickTitle') }}</p-heading>
      <pre class="qs-code"><code>npm create @proteus-vue/proteus my-app
cd my-app
npm run dev:web      <span class="qs-dim">{{ t('home.qsWeb') }}</span>
npm run build:mp     <span class="qs-dim">{{ t('home.qsMp') }}</span></code></pre>
      <p-text class="qs-note center-block">
        {{ t('home.quickNote') }}
      </p-text>
    </p-view>

    <!-- 9. 学习路径（★#398 对齐小程序文档旅程 IA：初学者从首页直接进入线性学习路径） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(48, 80)'" data-reveal class="journey">
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">{{ t('home.journeyTitle') }}</p-heading>
      <p-text class="section-sub center">{{ t('home.journeySub') }}</p-text>
      <p-grid :min-col-width="220" :gap="12">
        <router-link
          v-for="(s, i) in journey"
          :key="s.title"
          :to="s.to"
          v-p-hover
          class="journey-card"
          :style="{ '--stagger-i': String(i) }"
        >
          <p-text class="pillar-no">{{ s.no }}</p-text>
          <p-heading :level="3" class="pillar-title">{{ s.title }}</p-heading>
          <p-text class="pillar-desc">{{ s.desc }}</p-text>
          <p-text class="journey-go">{{ t('home.journeyGo') }}</p-text>
        </router-link>
      </p-grid>
    </p-view>
  </p-page>
</template>

<style scoped>
/* ---- Hero（★2026-09-11 左对齐构图：标题两行 + 数字行；无辉光/波浪/流光） ---- */
.hero { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 44px; }
.hero-content { max-width: 760px; }
.eyebrow {
  color: var(--brand2);
  font-size: 12.5px;
  letter-spacing: 0.4px;
  border: 1px solid rgba(124, 92, 255, 0.3);
  border-radius: var(--radius-pill);
  padding: var(--sp-4) var(--sp-12);
  display: inline-block;
  width: fit-content;
  background: var(--brand-soft);
}
.hero-title { color: var(--ink); line-height: 1.12; letter-spacing: -0.02em; font-weight: 800; margin: 22px 0 18px; }
.hero-title em { font-style: normal; color: var(--brand-ink); }
.hero-sub { color: var(--muted); line-height: 1.75; margin: 0 0 28px; max-width: 620px; display: block; }
.hero-cta { align-items: center; }
.cta-primary {
  color: #fff;
  background: var(--brand);
  padding: 11px 22px;
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: background 0.15s;
}
.cta-primary:hover { background: #6a4cf0; }
.cta-text { color: #fff; font-weight: 600; font-size: 14px; white-space: nowrap; }
.cta-ghost {
  border: 1px solid var(--line);
  padding: 11px 22px;
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: border-color 0.15s;
}
.cta-ghost:hover { border-color: var(--brand); }
.cta-ghost .cta-text { color: var(--ink); font-size: 14px; white-space: nowrap; }
/* ---- Hero 数字行 ---- */
.hero-stats { align-items: flex-start; }
.hero-stat { display: flex; flex-direction: column; gap: 4px; }
.hs-value { color: var(--ink); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.hs-label { color: var(--muted); font-size: 13px; }

/* ---- 滚动显现（data-reveal；reduced-motion / 无 IO 直接显现）+ 网格子项 stagger ---- */
[data-reveal] {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 0.7s ease, transform 0.7s cubic-bezier(0.2, 0.7, 0.3, 1);
}
[data-reveal].revealed {
  opacity: 1;
  transform: none;
}
.no-motion [data-reveal] {
  opacity: 1;
  transform: none;
  transition: none;
}
.pillars .pillar-card,
.stats .stat,
.features .feature-card,
.journey .journey-card {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 0.55s ease,
    transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1),
    border-color 0.15s;
  transition-delay: calc(var(--stagger-i, 0) * 70ms);
}
.revealed .pillar-card,
.revealed .stat,
.revealed .feature-card,
.revealed .journey-card {
  opacity: 1;
  transform: none;
}
.no-motion .pillar-card,
.no-motion .stat,
.no-motion .feature-card,
.no-motion .journey-card {
  opacity: 1;
  transform: none;
  transition: none;
}

/* ---- 通用节标题（v3 居中型） ---- */
.section-title.center, .section-sub.center { text-align: center; }
.section-title { color: var(--ink); margin: 0 0 10px; }
.section-sub { color: var(--muted); font-size: 14px; margin: 0 0 24px; display: block; }

/* ---- 三支柱（编号卡） ---- */
.pillar-card { border: 1px solid var(--line); border-radius: var(--radius-xl); padding: var(--sp-18); background: var(--panel); }
.pillar-no { color: var(--brand2); font-size: 12px; letter-spacing: 1px; }
.pillar-title { color: var(--ink); margin: 8px 0; }
.pillar-desc { color: var(--muted); font-size: 13px; line-height: 1.7; }

/* ---- 学习路径（★#398：同语言编号卡，router-link 整卡可点） ---- */
.journey-card { display: block; text-decoration: none; border: 1px solid var(--line); border-radius: var(--radius-xl); padding: var(--sp-18); background: var(--panel); height: 100%; transition: border-color 0.15s; }
.journey-card:hover { border-color: var(--brand); }
.journey-go { color: var(--brand2); font-size: 12px; margin: 10px 0 0; display: block; }

/* ---- 数字背书 ---- */
/* ---- 数字背书（★#389 pg-glass 卡：布局归 grid，视觉归玻璃组件；hover 微交互对齐 v3） ---- */
.stat {
  padding: var(--sp-14);
  height: 100%;
  transition: border-color 0.15s;
}
.stat:hover { border-color: var(--brand); }
.stat-value { color: var(--brand); font-size: 26px; font-weight: 700; }
.stat-label { color: var(--ink); font-size: 13px; }
.stat-source { color: var(--muted); font-size: 11px; }

/* ---- 能力矩阵（v3 卡片微交互：hover 仅边框变色） ---- */
.feature-card { border: 1px solid var(--line); border-radius: var(--radius-xl); padding: var(--sp-18); background: var(--panel); transition: border-color 0.15s; }
.feature-card:hover { border-color: var(--brand); }
.feature-tag { color: var(--brand2); font-size: 11px; letter-spacing: 1px; }
.feature-title { color: var(--ink); margin: 8px 0; }
.feature-desc { color: var(--muted); font-size: 13px; line-height: 1.65; }

/* ---- 对标表（Proteus 列着色；★#386 flex item min-width:0 —— #383 教训：宽内容表格不得撑破祖先） ---- */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-xl); min-width: 0; max-width: 100%; }
.cmp-table { border-collapse: collapse; width: 100%; font-size: 13px; min-width: 640px; }
.cmp-table th { color: var(--ink); background: var(--panel2); padding: 10px 14px; text-align: left; white-space: nowrap; }
.cmp-table td { color: var(--muted); border-top: 1px solid var(--line); padding: 10px 14px; }
.cmp-dim { color: var(--ink); font-weight: 600; white-space: nowrap; }
.cmp-proteus-head, .cmp-proteus { color: var(--ink); background: var(--brand-soft); }
.cmp-status { font-size: 11px; }
.cmp-status.st-ok { color: var(--ok); }
.cmp-status.st-warn { color: var(--warn); }
.cmp-status.st-plan { color: var(--dim); }
.cmp-note { color: var(--muted); font-size: 12px; margin-top: 10px; display: block; }
.center-block { text-align: center; }

/* ---- dogfooding 金句（v3 收尾） ---- */
.quote { max-width: 880px; margin: 0 auto; text-align: center; }
.quote-line { color: var(--ink); line-height: 1.4; margin: 0 0 12px; }
.quote-line em { font-style: normal; color: var(--brand-ink); font-weight: 800; }
.quote-sub { color: var(--muted); font-size: 15px; display: block; }
.quote-sub .grad { color: var(--brand-ink); font-weight: 600; }
.quote-links { justify-content: center; margin-top: 20px; }
.method-link { color: var(--brand2); text-decoration: none; font-size: 14px; }
.method-link:hover { text-decoration: underline; }

/* ---- 快速开始 ---- */
.qs-code {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: var(--sp-18) 20px;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.8;
  overflow-x: auto;
  /* ★#386 交叉轴居中 + 收缩：margin auto 会令 stretch 失效（回落 min-content 撞破容器）——
     显式 width:100% + max-width 居中，flex item min-width:0 允许收缩（#383 教训） */
  width: 100%;
  max-width: 640px;
  min-width: 0;
  margin: 0 auto 14px;
  text-align: left;
}
.qs-dim { color: var(--muted); }
.qs-note { color: var(--muted); font-size: 13px; line-height: 1.7; max-width: 640px; margin: 0 auto; display: block; }
</style>
