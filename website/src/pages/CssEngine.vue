<script setup lang="ts">
// website/src/pages/CssEngine.vue —— ★★★Themis：编译期 CSS 引擎 · 产品页（用户 2026-10-08
//   「把 CSS 引擎完整产品做到官网上，产品叙事参考白皮书」；「优化升级视觉体验，现在不像产品页像文档页」）
//
// 【这一页是什么】把 Proteus 内置的**编译期 CSS 引擎（Themis）**作为正式产品对外讲清楚——
//   形态对标 /animation（Morpheus）与 /consistency：Hero（双列 + 视觉阶段）· 装饰背景 ·
//   滚动显现分节 · 渐变卡片 + hover 抬升 · 大留白节奏 · 收尾 CTA。
//   叙事骨架取自《Proteus_Themis多端一致CSS引擎产品白皮书》。
//
// 【★数据纪律（本页最重要的约束）】页面里**没有一个手写数字**——全部来自
//   `../data/css-engine-page`（由 `website/scripts/gen-css-engine-data.mjs` 从
//   `docs/generated/css-engine-numbers.json` 读出；后者由 `scripts/gen-css-engine-numbers.mjs`
//   从各产物复算）。漂移由 `pnpm check:css-engine-data` + `check:css-engine-numbers` 双重门禁守着。
//
// 【★对外表述纪律（白皮书 §9 三条禁语）】本页遵守：
//   · 不说"像素级一致"——判据② 是 ≤0.5dp 数值等价；
//   · 不说"支持完整 CSS"——是"Profile 内完整语义 + Profile 外构建期拦截"；
//   · 不说"性能无成本"——成本前移到了编译期。
//
// 【D-2 门禁】零 @media（走 p-grid auto-fit + flex-wrap）、零三方 UI 库、零裸平台 API；
//   截图走 public 静态资产（非 URL/fetch）。滚动显现用 IntersectionObserver（与首页/动画页同机制）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'
import { CSS_ENGINE_PAGE as D } from '../data/css-engine-page'

const isEn = computed(() => locale.value === 'en')
const base = import.meta.env.BASE_URL || '/'
const N = D.numbers

/* ── 滚动显现（与首页/动画页同机制；reduced-motion 直接终态） ── */
const rootEl = ref<HTMLElement | null>(null)
let revealObserver: IntersectionObserver | null = null
onMounted(() => {
  const root = (rootEl.value as unknown as { $el?: HTMLElement })?.$el ?? (rootEl.value as HTMLElement | null)
  const targets = root ? Array.from(root.querySelectorAll('[data-reveal]')) : []
  const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (!motionOk || typeof IntersectionObserver !== 'function') {
    targets.forEach((el) => el.classList.add('revealed'))
    return
  }
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('revealed')
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

/* ── 机器数字（原样来自 SSOT；页面只做格式化，不重算） ── */
const pct = (v: number): string => (v * 100).toFixed(2) + '%'
const metrics = computed(() => [
  {
    icon: 'code',
    value: String(N.ir.total),
    unit: isEn.value ? 'fields' : '字段',
    label: isEn.value ? 'StyleIR (closed set, versioned)' : 'StyleIR（闭集 · 版本化）',
    note: isEn.value
      ? `semantic ${N.ir.semantic} + engine-only ${N.ir.engineOnly}`
      : `semantic ${N.ir.semantic} + engine-only ${N.ir.engineOnly}`,
  },
  {
    icon: 'target',
    value: `${N.parity.cases}/${N.parity.props}`,
    unit: isEn.value ? 'cases / items' : '用例 / 项',
    label: isEn.value ? 'Criterion ①-b · property parity' : '判据①-b · 逐属性对拍',
    note: isEn.value ? '≡ real Chromium getComputedStyle' : '≡ 真 Chromium getComputedStyle',
  },
  {
    icon: 'chart',
    value: pct(N.coverage.m1),
    unit: isEn.value ? 'coverage' : '覆盖率',
    label: isEn.value ? 'M1 · numeric consistency' : 'M1 · 数值一致性',
    note: isEn.value
      ? `union ${N.coverage.unionCovered}/${N.coverage.unionTotal}; expected = Web`
      : `并集 ${N.coverage.unionCovered}/${N.coverage.unionTotal}；expected = Web`,
  },
  {
    icon: 'box',
    value: `≤${N.tolerance.conformanceGeomDp}`,
    unit: 'dp',
    label: isEn.value ? 'Criterion ② · geometry vs Web' : '判据② · 几何 ≡ Web',
    note: isEn.value
      ? `per-field ≤${N.tolerance.structureAbsPx}px / ≤${N.tolerance.structureRelPct}%`
      : `逐字段 ≤${N.tolerance.structureAbsPx}px / ≤${N.tolerance.structureRelPct}%`,
  },
  {
    icon: 'shield',
    value: String(N.lint.total),
    unit: isEn.value ? 'debt' : '存量',
    label: isEn.value ? 'Profile-lint (ratcheted)' : 'Profile lint（棘轮）',
    note: isEn.value ? 'only shrinks, never grows' : '只减不增',
  },
  {
    icon: 'layers',
    value: String(N.inventory.total),
    unit: isEn.value ? 'features' : '能力项',
    label: isEn.value ? 'CSS inventory (Web superset)' : 'CSS 能力清单（Web 全量）',
    note: isEn.value
      ? `implemented ${N.inventory.implemented} · P0 ${N.inventory.actionableP0}`
      : `implemented ${N.inventory.implemented} · P0 ${N.inventory.actionableP0}`,
  },
])

/* ── 结论摘要（30 秒读完）——白皮书 §0 ── */
const summary: Array<{ q: string; qEn: string; a: string; aEn: string }> = [
  {
    q: '这是什么', qEn: 'What it is',
    a: '把完整 CSS 语义（层叠 / 继承 / 计算值 / 动态类 / 降级）搬进编译期的引擎，构建时全部算完',
    aEn: 'An engine that moves full CSS semantics (cascade / inheritance / computed values / dynamic classes / degrade) into build time — all computed ahead of shipping',
  },
  {
    q: '凭什么多端一致', qEn: 'Why ends agree',
    a: '正确性不由引擎自定义——浏览器真实渲染是唯一基准，三层判据逐属性 / 逐 0.5dp / 逐像素对拍，全部棘轮',
    aEn: 'Correctness is not self-declared — the browser’s real rendering is the only baseline; three gate layers compare property-by-property, within 0.5dp, and per-pixel, all ratcheted',
  },
  {
    q: '与运行期 CSS 引擎（Kraken/Lynx/WebF）的区别', qEn: 'vs runtime CSS engines',
    a: '运行期零 CSS 解析：宿主只消费已折叠的 StyleIR，样式应用是 O(1) 查表',
    aEn: 'Zero runtime CSS parsing: hosts only consume the already-folded StyleIR; applying styles is an O(1) lookup',
  },
  {
    q: '与 uni-app x / Taro 的区别', qEn: 'vs uni-app x / Taro',
    a: '不是“CSS 子集尽量折叠”，是完整层叠 + 不能一致的写法全端禁用（构建期报错）',
    aEn: 'Not “fold a CSS subset as far as possible”, but full cascade + banning anything that cannot land consistently across ends (build-time error)',
  },
  {
    q: '与 RN / Flutter 的区别', qEn: 'vs RN / Flutter',
    a: '不是“没有 CSS 所以没有分叉”，是有完整 CSS 且分叉可判定、可拦截、可对拍',
    aEn: 'Not “no CSS so no divergence”, but full CSS with divergence that is decidable, interceptable and diffable',
  },
]

/* ── 五步管线 —— 白皮书 §4 ── */
const pipeline: Array<{ n: string; zh: string; en: string }> = [
  { n: '01', zh: '解析 · 长手展开 · @layer 收集 · 特异性计算', en: 'Parse · longhand expansion · @layer collection · specificity' },
  { n: '02', zh: '索引匹配 · 按 key selector 分桶 · 右→左链匹配', en: 'Index & match · bucket by key selector · right-to-left chain matching' },
  { n: '03', zh: '五级层叠 · importance → @layer → 特异性 → 源序', en: 'Five-level cascade · importance → @layer → specificity → source order' },
  { n: '04', zh: '继承 + 计算值 · var() 替换 · calc() 常量化 · env() 引用', en: 'Inherit + computed values · var() substitution · calc() constant-folding · env() refs' },
  { n: '05', zh: '动态类预计算 · 属性维度分解 · 互斥分组 · 爆炸保护', en: 'Dynamic-class precompute · dimension decomposition · exclusive groups · explosion guard' },
]

/* ── 七大能力 —— 白皮书 §5 ── */
const abilities = computed<Array<{ ic: string; t: string; d: string }>>(() => [
  {
    ic: 'layers',
    t: isEn.value ? 'Five-level cascade' : '全语义层叠',
    d: isEn.value
      ? '!important → @layer → id/class/element specificity → source order, fully implemented. id selectors, named layers, CSS-wide keywords (inherit/initial/unset), var() with fallback, structural pseudo-classes and :not().'
      : '!important → @layer → id/类/元素特异性 → 源序，完整实现；支持 id 选择器、命名层、CSS 宽关键字（inherit/initial/unset）、var() 含 fallback、结构伪类与 :not()。',
  },
  {
    ic: 'bolt',
    t: isEn.value ? 'Dynamic styles at O(1)' : '动态样式 O(1)',
    d: isEn.value
      ? ':class="{ on: x }" is decomposed by property dimension into small lookup tables at build time (not 2ⁿ enumeration); runtime is a bitmap O(1) lookup — profile shows reads == field count.'
      : ':class="{ on: x }" 编译期按属性维度分解成小查找表（非 2ⁿ 全量枚举）；运行期位图 O(1) 查表——profile 实测读次数 == 字段数。',
  },
  {
    ic: 'plug',
    t: isEn.value ? 'Degrade recipes' : '降级配方',
    d: isEn.value
      ? 'When an end lacks a field, the IR is rewritten into a semantically equivalent form (grid→flex single-row only; gap→margin half-distance), then diffed against the Web rendering of the original IR.'
      : '某端不原生支持某字段时，编译期把 IR 改写为语义等价形态（grid→flex 仅单行；gap→margin 半距法），再与「原 IR 在 Web 的渲染」对拍验证。',
  },
  {
    ic: 'shield',
    t: isEn.value ? 'Build-time interception' : '构建期拦截',
    d: isEn.value
      ? 'E-CSS / W-CSS diagnostics are wired into the Web build chain: anything outside the Profile fails the Web build with rc=1. “Web builds ⇒ all ends consistent” is guaranteed by the compiler.'
      : 'E-CSS / W-CSS 诊断接入 Web 构建链：Profile 外写法在 Web 端也 rc=1 真实拦截。「Web 跑通 = 各端一致」由编译器保证。',
  },
  {
    ic: 'target',
    t: isEn.value ? 'Three ratcheted gates' : '三层一致性门禁',
    d: isEn.value
      ? '① baseline equivalence (compile-time): Node/Rust backends byte-identical + IR vs getComputedStyle. ② numeric equivalence (runtime): each end ≡ Web ≤0.5dp. ③ pixel observation (non-gating). All ratcheted.'
      : '① 基准等价（编译期）：双后端逐字节 + IR 与 getComputedStyle 逐属性比对。② 数值等价（运行期）：各端 ≡ Web ≤0.5dp。③ 像素观察（非门禁）。三层全部棘轮。',
  },
  {
    ic: 'code',
    t: isEn.value ? 'Dual-backend parity' : '双后端同律',
    d: isEn.value
      ? 'The same SFC yields byte-identical StyleIR from the TypeScript and the Rust implementation — the compiler itself is also diffed, with real binary comparison and destructive verification.'
      : '同一 SFC，TypeScript 实现与 Rust 实现产出逐字节相同的 StyleIR——编译器自身也是被对拍的对象，有真二进制对拍与破坏性验证。',
  },
  {
    ic: 'data',
    t: isEn.value ? 'Fully replayable' : '全程可回放',
    d: isEn.value
      ? 'proteus explain --style traces why every declaration wins or loses: selector matching, hit @layer, specificity, source order, shorthand source, inheritance chain. Compile-time CSS gets its own DevTools.'
      : 'proteus explain --style 追踪每条声明为什么赢 / 输：选择器匹配、命中的 @layer、特异性、源序、简写来源、继承链。编译期 CSS 也有 DevTools。',
  },
])

/* ── 横向对比 —— 白皮书 §7 ── */
const compareHead = computed(() => (isEn.value
  ? ['Dimension', 'Themis (Proteus)', 'uni-app x / Taro', 'RN / Flutter', 'Kraken / Lynx / WebF']
  : ['维度', 'Themis (Proteus)', 'uni-app x / Taro', 'RN / Flutter', 'Kraken / Lynx / WebF']))
const compareRows = computed<Array<{ dim: string; cells: string[] }>>(() => {
  const zh = !isEn.value
  return [
    {
      dim: zh ? 'CSS 语义完整度' : 'CSS semantic completeness',
      cells: zh
        ? ['完整层叠（@layer/id/特异性）+ 继承 + 计算值 + var()/calc()', '子集折叠，无完整层叠', '无 CSS（StyleSheet + Yoga）', '运行期子集引擎']
        : ['Full cascade (@layer/id/specificity) + inheritance + computed values + var()/calc()', 'Subset folding, no full cascade', 'No CSS (StyleSheet + Yoga)', 'Runtime subset engine'],
    },
    {
      dim: zh ? '样式计算时点' : 'When styles are computed',
      cells: zh ? ['编译期', '编译期折叠', '运行期', '运行期'] : ['Build time', 'Build-time folding', 'Runtime', 'Runtime'],
    },
    {
      dim: zh ? '运行期样式成本' : 'Runtime style cost',
      cells: zh ? ['O(1) 查表', '匹配 + 容器开销', 'JS diff / rebuild', '解析 + 匹配 + 布局'] : ['O(1) lookup', 'match + container overhead', 'JS diff / rebuild', 'parse + match + layout'],
    },
    {
      dim: zh ? '动态类样式' : 'Dynamic-class styles',
      cells: zh ? ['编译期属性分解 + 位图 O(1) + 爆炸保护', '运行期匹配', 'JS diff / rebuild', '运行期匹配'] : ['Build-time decomposition + bitmap O(1) + explosion guard', 'runtime matching', 'JS diff / rebuild', 'runtime matching'],
    },
    {
      dim: zh ? '一致性的 expected' : 'The expected for consistency',
      cells: zh
        ? ['Web 真实渲染（唯一基准）+ 三层棘轮门禁 + golden 冻结', '无统一基准', '无', '引擎自定义（宿主间还会漂移）']
        : ['Web real rendering (sole baseline) + three ratcheted gates + frozen golden', 'no unified baseline', 'none', 'engine-defined (drifts across hosts)'],
    },
    {
      dim: zh ? '能力不支持时' : 'When unsupported',
      cells: zh
        ? ['编译期报错，或配方降级（可对拍）；拒绝静默近似', '静默缺失或端差 / 端差手工兼容', '手写平台分支', '引擎内近似']
        : ['Build-time error, or a diffable degrade recipe; no silent approximation', 'silent gaps or per-end shims', 'hand-written platform branches', 'in-engine approximation'],
    },
    {
      dim: zh ? '可调试性' : 'Debuggability',
      cells: zh ? ['proteus explain 全 trace', '有限', '手段少', '各自 DevTools'] : ['proteus explain full trace', 'limited', 'few tools', 'separate DevTools'],
    },
    {
      dim: zh ? '编译器自证' : 'Compiler self-proof',
      cells: zh ? ['Node/Rust 逐字节对拍', '无', '—', '—'] : ['Node/Rust byte-identical diff', 'none', '—', '—'],
    },
  ]
})

/* ── 边界与承诺 —— 白皮书 §9 ── */
const notDoing = computed<Array<{ zh: string; en: string }>>(() => [
  { zh: '@media / @supports / @container / @import 跳过并计数——不假装响应式；断点走组件/JS 通道', en: '@media / @supports / @container / @import are skipped and counted — no pretending to be responsive; breakpoints go through components/JS' },
  { zh: '兄弟组合、属性选择器、伪元素不支持（显式记 skipped）；含动态类的后代规则 v1 仅告警', en: 'Sibling combinators, attribute selectors and pseudo-elements unsupported (recorded as skipped); descendant rules with dynamic classes warn only in v1' },
  { zh: '不追求「Web CSS 五端像素级兼容」；不引 Blink/WebF 路线；不自研文本基础设施（字体/BiDi/RTL/OpenType）', en: 'No pursuit of pixel-level Web-CSS parity across ends; no Blink/WebF route; no self-built text infrastructure (fonts/BiDi/RTL/OpenType)' },
])
const forbidden = computed<Array<{ zh: string; en: string }>>(() => [
  { zh: '不得说「像素级一致」——判据② 是 ≤0.5dp 数值等价', en: 'Never “pixel-perfect” — criterion ② is ≤0.5dp numeric equivalence' },
  { zh: '不得说「支持完整 CSS」——是「Profile 内完整语义 + Profile 外构建期拦截」', en: 'Never “supports full CSS” — it is “full semantics inside the Profile, build-time interception outside”' },
  { zh: '不得说「性能无成本」——成本前移到了编译期', en: 'Never “zero cost” — the cost is shifted to build time' },
])

/* ── 证据索引 —— 每条数字指向仓内产物 + 门禁 ── */
const evidence = computed<Array<{ k: string; v: string; gate: string }>>(() => {
  const zh = !isEn.value
  return [
    { k: zh ? `${N.ir.total} IR 字段（semantic ${N.ir.semantic} / engine-only ${N.ir.engineOnly}）` : `${N.ir.total} IR fields (semantic ${N.ir.semantic} / engine-only ${N.ir.engineOnly})`, v: 'style-ir-registry.generated.ts', gate: 'check:style-ir-schema' },
    { k: zh ? `${N.parity.cases} 用例 / ${N.parity.props} 项 ≡ Chromium` : `${N.parity.cases} cases / ${N.parity.props} items ≡ Chromium`, v: 'tests/fixtures/cse-parity-cases.ts', gate: 'test:cse-parity' },
    { k: zh ? `M1 数值一致性 ${pct(N.coverage.m1)}` : `M1 numeric consistency ${pct(N.coverage.m1)}`, v: 'consistency-metrics.json', gate: 'check:consistency-metrics' },
    { k: zh ? `判据② 几何 ≡ Web ≤${N.tolerance.conformanceGeomDp}dp` : `Criterion ② geometry ≡ Web ≤${N.tolerance.conformanceGeomDp}dp`, v: 'tests/appliers-conformance.test.ts', gate: 'test:coupled' },
    { k: zh ? `Profile lint 存量棘轮 ${N.lint.total}` : `Profile-lint debt ${N.lint.total}`, v: '{examples,showcase,css-conformance,website}/cse-lint-baseline.json', gate: 'check:cse-lint-baseline' },
    { k: zh ? `三端能力对齐矩阵 ${N.alignment.rows} 行 × ${N.alignment.ends} 端` : `Three-end capability matrix ${N.alignment.rows} rows × ${N.alignment.ends} ends`, v: 'css-capability-alignment.json', gate: 'check:css-capability-alignment' },
    { k: zh ? `CSS 能力清单 ${N.inventory.total} 项（P0 ${N.inventory.actionableP0}）` : `CSS inventory ${N.inventory.total} items (P0 ${N.inventory.actionableP0})`, v: 'css-feature-inventory.json', gate: 'check:css-inventory' },
    { k: zh ? '本页数字单一事实源' : 'Single source of truth for this page', v: 'docs/generated/css-engine-numbers.json', gate: 'check:css-engine-numbers' },
  ]
})

function shotUrl(pub: string): string {
  return `${base}css-engine/${pub}`
}
const demoSets = computed(() => D.demoPages.map((p) => ({
  slug: p.slug,
  title: isEn.value ? p.en : p.zh,
  shots: D.shots.filter((s) => s.page === p.slug).map((s) => ({ pub: s.pub, label: isEn.value ? s.labelEn : s.labelZh })),
})))
</script>

<template>
  <p-page ref="rootEl" class="ce">
    <!-- 装饰背景层（品牌光晕 + 细网格；纯装饰） -->
    <p-view class="ce-bg" aria-hidden="true"><span class="ce-glow" /><span class="ce-grid" /></p-view>

    <p-view class="ce-wrap">
      <!-- ═══════════ Hero（双列：文案 + 视觉阶段） ═══════════ -->
      <p-grid :min-col-width="360" :gap="56" class="ce-hero">
        <p-stack direction="column" :gap="20" class="hero-copy">
          <p-text class="chip">
            <FeatureIcon name="bolt" />
            <span>{{ isEn ? 'Compile-time CSS Engine' : '编译期 CSS 引擎' }} · Themis</span>
          </p-text>
          <p-heading :level="1" v-p-fluid="'font-size(34, 56)'" class="hero-h1">
            <span class="h1-l1">{{ isEn ? 'Write styles once.' : '写一次样式，' }}</span>
            <span class="h1-l2">{{ isEn ? 'Every end looks the same.' : '所有端长一个样。' }}</span>
          </p-heading>
          <p-text v-p-fluid="'font-size(16, 19)'" class="hero-tag">
            {{ isEn ? 'And that can be proven.' : '——并且这可以被证明。' }}
          </p-text>
          <p-text class="hero-lead">
            {{ isEn
              ? 'Themis takes the full CSS semantics — cascade, inheritance, computed values, dynamic classes, degrade — and computes them at build time. Runtime only does an O(1) table lookup; selector matching, cascade and unit conversion never appear in the call stack.'
              : 'Themis 把完整 CSS 语义——层叠、继承、计算值、动态类、降级——在构建期全部算完。运行期只做 O(1) 查表，选择器匹配 / 层叠 / 单位换算在调用栈中零出现。' }}
          </p-text>
          <p-stack direction="row" :gap="12" wrap class="hero-cta">
            <a href="#evidence" class="btn btn-primary">{{ isEn ? 'See four-end proof' : '看四端真渲染证据' }}</a>
            <a href="#numbers" class="btn btn-ghost">{{ isEn ? 'See the numbers' : '看数字' }}</a>
            <router-link to="/consistency" class="btn btn-ghost">{{ isEn ? 'Consistency standard' : '一致性标准' }}</router-link>
          </p-stack>
          <p-stack direction="row" :gap="10" wrap class="hero-pills">
            <span class="pill">{{ isEn ? `${N.ir.total} IR fields` : `${N.ir.total} IR 字段` }}</span>
            <span class="pill">{{ isEn ? 'baseline = Web (sole)' : '基准 = Web（唯一）' }}</span>
            <span class="pill">{{ isEn ? 'zero runtime CSS parsing' : '运行期零 CSS 解析' }}</span>
            <span class="pill">{{ isEn ? 'O(1) dynamic styles' : '动态样式 O(1)' }}</span>
          </p-stack>
          <p-view class="proof">
            <span class="proof-dot" aria-hidden="true" />
            <span class="proof-label">{{ isEn ? 'This page is built by Proteus itself (dogfooding)' : '本页由 Proteus 自身编译构建（dogfooding）' }}</span>
          </p-view>
        </p-stack>

        <!-- 视觉阶段：一条声明 → 四端同一个样（Hero 图形，纯 CSS 布局） -->
        <p-view class="hero-stage">
          <p-view class="viz">
            <p-view class="viz-code">
              <span class="viz-dot r" /><span class="viz-dot y" /><span class="viz-dot g" />
              <code>.card { border-radius: 12px; background: #7c5cff }</code>
            </p-view>
            <p-view class="viz-arrow"><span>▼</span><code>StyleIR · {{ N.ir.total }}</code></p-view>
            <div class="viz-ends">
              <div v-for="e in ['Web', 'Skyline', 'iOS', 'Android']" :key="e" class="viz-end">
                <span class="viz-swatch" />
                <span class="viz-end-l">{{ e }}</span>
              </div>
            </div>
            <p-view class="viz-caption">{{ isEn ? 'one declaration → identical on every end' : '一条声明 → 每个端都一样' }}</p-view>
          </p-view>
        </p-view>
      </p-grid>

      <!-- ═══════════ 结论摘要（30 秒读完） ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'In 30 seconds' : '30 秒读完' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-view class="summary">
          <div v-for="(s, i) in summary" :key="s.qEn" class="sum-row" :style="{ '--stagger-i': String(i) }">
            <span class="sum-q">{{ isEn ? s.qEn : s.q }}</span>
            <span class="sum-a">{{ isEn ? s.aEn : s.a }}</span>
          </div>
        </p-view>
      </p-view>

      <!-- ═══════════ 三个端，三套真相（问题） ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Three ends, three truths' : '三个端，三套真相' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'Before Themis the styling chain was three unrelated implementations: Web (native CSSOM — the only complete one), Skyline (the WeChat container — the one rigid external constraint), and App — whose docs literally said “the App end has no CSS engine”. One stylesheet, three interpretations, “looks about the same” verified by eye, “where it differs” discovered by users after launch.'
            : '在 Themis 之前，样式链路是三套互不相干的实现：Web（浏览器原生 CSSOM——唯一完整实现）、Skyline（微信容器——唯一刚性外部约束）、App（当时仓内原话是「App 端无 CSS 引擎」）。同一份样式表、三个端各自解释、「看起来差不多」靠肉眼验收、「哪里不一样」靠上线后用户发现。' }}
        </p-text>
        <p-grid :min-col-width="240" :gap="14">
          <p-view class="end-card end-card--web" :style="{ '--stagger-i': '0' }">
            <span class="end-k">Web</span>
            <span class="end-tag">{{ isEn ? 'the baseline' : '基准' }}</span>
            <p-text class="end-d">{{ isEn ? 'Native CSSOM — complete, and the baseline' : '浏览器原生 CSSOM——完整，且是基准' }}</p-text>
          </p-view>
          <p-view class="end-card end-card--mp" :style="{ '--stagger-i': '1' }">
            <span class="end-k">Skyline</span>
            <span class="end-tag">{{ isEn ? 'rigid' : '刚性' }}</span>
            <p-text class="end-d">{{ isEn ? 'WeChat container — the rigid constraint' : '微信容器——唯一刚性外部约束' }}</p-text>
          </p-view>
          <p-view class="end-card end-card--app" :style="{ '--stagger-i': '2' }">
            <span class="end-k">App</span>
            <span class="end-tag">{{ isEn ? 'self-drawn' : '自绘' }}</span>
            <p-text class="end-d">{{ isEn ? 'Self-drawn Rust engine — the face we define' : '自研自绘 Rust 引擎——面由我们定义' }}</p-text>
          </p-view>
        </p-grid>
      </p-view>

      <!-- ═══════════ 产品主张（三条） ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Three claims' : '产品主张（三条）' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-grid :min-col-width="280" :gap="16">
          <p-view class="claim" :style="{ '--stagger-i': '0' }">
            <p-stack direction="row" align="center" :gap="12" class="claim-head">
              <span class="claim-no">01</span>
              <span class="card-ic"><FeatureIcon name="bolt" /></span>
            </p-stack>
            <p-heading :level="3" class="claim-t">{{ isEn ? 'Compute, then ship.' : '算完，再上线。' }}</p-heading>
            <p-text class="claim-d">{{ isEn
              ? 'All CSS semantics are computed and computed correctly at build time. Runtime only does O(1) table lookup and field application.'
              : 'CSS 的全部语义在构建期算完并算对。运行期只做 O(1) 位图查表与字段应用。' }}</p-text>
          </p-view>
          <p-view class="claim" :style="{ '--stagger-i': '1' }">
            <p-stack direction="row" align="center" :gap="12" class="claim-head">
              <span class="claim-no">02</span>
              <span class="card-ic"><FeatureIcon name="target" /></span>
            </p-stack>
            <p-heading :level="3" class="claim-t">{{ isEn ? 'One truth only.' : '真值只有一个。' }}</p-heading>
            <p-text class="claim-d">{{ isEn
              ? 'The expected for cross-end consistency has exactly one source: the browser’s real rendering. Ends are never compared pairwise to define “correct”.'
              : '多端一致性的 expected 只有一个来源：Web 端浏览器真实渲染。端间互比只能用于诊断，不得定案。' }}</p-text>
          </p-view>
          <p-view class="claim" :style="{ '--stagger-i': '2' }">
            <p-stack direction="row" align="center" :gap="12" class="claim-head">
              <span class="claim-no">03</span>
              <span class="card-ic"><FeatureIcon name="shield" /></span>
            </p-stack>
            <p-heading :level="3" class="claim-t">{{ isEn ? 'Fail loudly.' : '失败要响亮。' }}</p-heading>
            <p-text class="claim-d">{{ isEn
              ? 'Anything that cannot land consistently fails the Web build; anything that cannot be degraded equivalently is honestly rejected with a reason.'
              : '不能多端一致落地的写法，在 Web 构建期就报错；不能语义等价降级的字段，如实拒绝并给出原因。' }}</p-text>
          </p-view>
        </p-grid>
      </p-view>

      <!-- ═══════════ 工作原理：一条五步管线 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'How it works' : '工作原理' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'The key design is longhand-level cascade: “margin: 0” and a later “margin-top: 5px” compete for the same property. Folding at the shorthand level (what most subset engines do) cannot do this — Themis stores longhand declarations and takes the unique winner per longhand, the only way to converge to 100% against getComputedStyle.'
            : '关键设计——长手层层叠：margin: 0 与后写的 margin-top: 5px 竞争的是同一属性。在简写层折叠（多数子集引擎的做法）做不到这一点；Themis 存长手声明、层叠后逐长手取唯一胜者——唯一能和 getComputedStyle 对拍收敛到 100% 的做法。' }}
        </p-text>
        <p-view class="pipe">
          <p-view class="pipe-src"><code>&lt;style&gt; · SFC</code></p-view>
          <p-view class="pipe-steps">
            <p-view v-for="(s, i) in pipeline" :key="s.n" class="pipe-step" :style="{ '--stagger-i': String(i) }">
              <span class="pipe-n">{{ s.n }}</span>
              <span class="pipe-t">{{ isEn ? s.en : s.zh }}</span>
            </p-view>
          </p-view>
          <p-view class="pipe-out"><span class="pipe-arrow">▼</span><code class="pipe-ir">StyleIR · {{ N.ir.total }} {{ isEn ? 'fields' : '字段' }}</code></p-view>
          <div class="pipe-ends">
            <span v-for="e in ['Web Applier', 'Skyline Applier', 'App Applier']" :key="e" class="pipe-end">{{ e }}</span>
          </div>
          <p-view class="pipe-gate">{{ isEn ? 'three consistency gates · all ratcheted · expected = Web' : '三层一致性门禁 · 全棘轮 · expected = Web' }}</p-view>
        </p-view>
      </p-view>

      <!-- ═══════════ 七大能力 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Seven capabilities' : '七大能力' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-grid :min-col-width="280" :gap="16">
          <p-view v-for="(a, i) in abilities" :key="a.t" class="ab" :style="{ '--stagger-i': String(i) }">
            <span class="card-ic"><FeatureIcon :name="a.ic" /></span>
            <p-heading :level="3" class="ab-t">{{ a.t }}</p-heading>
            <p-text class="ab-d">{{ a.d }}</p-text>
          </p-view>
        </p-grid>
      </p-view>

      <!-- ═══════════ 数字页（全部机器生成） ═══════════ -->
      <p-view id="numbers" data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'The numbers' : '数字页' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'Every figure is recomputed from repository artifacts on every check — no hand-written numbers. Source of truth: docs/generated/css-engine-numbers.json, guarded by check:css-engine-numbers.'
            : '每个数字都在每次校验时从仓库产物重新读出——没有一个手写数字。单一事实源：docs/generated/css-engine-numbers.json，由 check:css-engine-numbers 守着。' }}
        </p-text>
        <p-grid :min-col-width="250" :gap="14">
          <p-view v-for="(m, i) in metrics" :key="m.label" class="metric" :style="{ '--stagger-i': String(i) }">
            <span class="card-ic"><FeatureIcon :name="m.icon" /></span>
            <p-view class="metric-value"><span class="mv-num">{{ m.value }}</span><span class="mv-unit">{{ m.unit }}</span></p-view>
            <p-text class="metric-label">{{ m.label }}</p-text>
            <p-text class="metric-note">{{ m.note }}</p-text>
          </p-view>
        </p-grid>
      </p-view>

      <!-- ═══════════ 横向对比 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Side by side' : '横向对比' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'Other frameworks treat cross-end consistency as a wish; Themis treats it as a decidable gate. The price is a narrower CSS surface — and that is the product decision: a syntax enters the Profile not by “is it standard CSS” but by “can it land consistently across ends”.'
            : '其他框架把「跨端一致」当作愿望；Themis 把它当作可判定的门禁。代价是收窄了 CSS 面——而这正是产品决策：一条写法是否进 Profile，判据不是「是否符合 CSS 标准」，而是「它能否多端一致地落地」。' }}
        </p-text>
        <p-view class="table">
          <div class="tr th">
            <span v-for="(h, i) in compareHead" :key="h" :class="{ 'col-win': i === 1 }">{{ h }}</span>
          </div>
          <div v-for="r in compareRows" :key="r.dim" class="tr">
            <span class="td-dim">{{ r.dim }}</span>
            <span v-for="(c, i) in r.cells" :key="i" class="td" :class="{ 'col-win': i === 0 }">{{ c }}</span>
          </div>
        </p-view>
      </p-view>

      <!-- ═══════════ 开发者体验 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Developer experience' : '开发者体验' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">{{ isEn ? 'A wrong style fails the build, and the error message is the fix.' : '写错即构建失败，错误信息即修复指引。' }}</p-text>
        <p-view class="code-box">
          <p-view class="code-bar"><span class="cd r" /><span class="cd y" /><span class="cd g" /><span class="code-name">build · error</span></p-view>
          <pre class="code-pre"><code>error E-CSS-004: :class {{ isEn ? 'expression cannot be statically enumerated' : '表达式无法静态枚举' }} (:class="runtimeVar")
  → Profile L5 {{ isEn ? 'forbidden. Use a finite candidate set (object/array/ternary literals), or converge dynamic styles to mutually-exclusive groups.' : '禁止项。改用有限候选集（对象/数组/三元字面量），或将动态样式收敛为互斥分组的枚举写法。' }}

warn CSE_DYNCLASS_TABLE_EXPLOSION: {{ isEn ? 'single-node dynamic-class table > 16 (now 23)' : '单节点动态类表 > 16（当前 23）' }}
  → {{ isEn ? 'Split the binding or merge candidate classes to cut property dimensions.' : '拆分绑定或合并候选类，减少属性维度。' }}</code></pre>
        </p-view>
        <p-view class="code-box">
          <p-view class="code-bar"><span class="cd r" /><span class="cd y" /><span class="cd g" /><span class="code-name">terminal</span></p-view>
          <pre class="code-pre"><code>$ proteus explain --style --node page-header
margin-top: 5px    ← margin-top (style.css:42) · specificity (0,1,0) · source order wins
                     over margin (style.css:17, expanded to margin-top: 0)
                     layer: components &gt; base</code></pre>
        </p-view>
        <p-text class="sec-note">
          {{ isEn
            ? 'Built-in env vars work out of the box: var(--pf-status-bar-height), var(--pf-inset-top), env(safe-area-inset-*), calc(<env> ± Npx) are recognised at build time as runtime environment references — the name resolves to a field index, runtime is one lookup.'
            : '内置 env 变量开箱即用：var(--pf-status-bar-height)、var(--pf-inset-top)、env(safe-area-inset-*)、calc(<env> ± Npx) 编译期识别为运行期环境引用——变量名解析成字段索引，运行期一次表查找。' }}
        </p-text>
      </p-view>

      <!-- ═══════════ 边界与承诺 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Boundaries & promises' : '边界与承诺' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'Themis writes “what it does not support” into the product docs — that itself is the biggest difference from other frameworks.'
            : 'Themis 把「不支持什么」写进产品文档——这本身就是与其他框架最大的不同。' }}
        </p-text>
        <p-grid :min-col-width="300" :gap="16">
          <p-view class="bound" :style="{ '--stagger-i': '0' }">
            <span class="bound-h">{{ isEn ? 'v1 does not do' : 'v1 不做' }}</span>
            <ul class="bound-list"><li v-for="(b, i) in notDoing" :key="i">{{ isEn ? b.en : b.zh }}</li></ul>
          </p-view>
          <p-view class="bound bound--ban" :style="{ '--stagger-i': '1' }">
            <span class="bound-h">{{ isEn ? 'Wording discipline (never say)' : '对外表述纪律（禁语）' }}</span>
            <ul class="bound-list"><li v-for="(f, i) in forbidden" :key="i">{{ isEn ? f.en : f.zh }}</li></ul>
          </p-view>
        </p-grid>
        <p-text class="sec-note bound-note">
          {{ isEn
            ? 'Standing risk: the layout-semantics gap between Taffy and Blink is structural. Pre-registered upgrade criteria E1–E4 (criterion caps out / spinning in place / baseline unstable / degrade not converging — each needs an evidence pack proving “not an implementation defect”). “It feels too hard to align” is not a trigger.'
            : '常驻风险：Taffy ⇄ Blink 的布局语义差（margin 折叠、百分比基准等）是结构性的。已预登记 A→B 升级触发准则 E1–E4（判据封顶 / 原地打转 / 基准不稳 / 降级不可收敛——均需证据包确认「非实现缺陷」才可触发）。「感觉对齐太难」不构成触发。' }}
        </p-text>
      </p-view>

      <!-- ═══════════ 多端真渲染证据 ═══════════ -->
      <p-view id="evidence" data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Evidence · one SFC, four renderers' : '证据 · 同一份 SFC，四种渲染器' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'Not hand-written fixtures — the same .vue acceptance pages compiled and rendered by four real targets: browser, Android device, iOS and HarmonyOS. Each is a real engine. Same element, cropped and compared end by end.'
            : '不是手写夹具——同一批 .vue 验收页由四种真实目标编译并渲染：浏览器、Android 真机、iOS、鸿蒙。每个都是真实引擎。下面按同一元素逐端并排。' }}
        </p-text>
        <p-view v-for="set in demoSets" :key="set.slug" class="demo">
          <p-text class="demo-title">{{ set.title }}</p-text>
          <div class="shots">
            <figure v-for="s in set.shots" :key="s.pub" class="shot">
              <img class="shot-img" :src="shotUrl(s.pub)" :alt="s.label" loading="lazy" />
              <figcaption class="shot-cap">{{ s.label }}</figcaption>
            </figure>
          </div>
        </p-view>
        <p-text class="sec-note">{{ isEn ? 'Deliberately absent: any claim of pixel-perfect cross-platform identity.' : '刻意不写：任何「跨端逐像素一致」的宣称。' }}</p-text>
      </p-view>

      <!-- ═══════════ 证据链 ═══════════ -->
      <p-view data-reveal class="sec">
        <p-stack direction="row" align="center" :gap="12" class="sec-head" wrap>
          <p-heading :level="2" v-p-fluid="'font-size(22, 30)'" class="sec-title">{{ isEn ? 'Evidence chain' : '证据链' }}</p-heading>
          <span class="sec-rule" />
        </p-stack>
        <p-text class="sec-note">
          {{ isEn
            ? 'Every claim above points to a machine artifact kept in the repository, each guarded by a gate that fails on drift.'
            : '上面每一个主张都指向仓库里可查的机器产物，每一项都有门禁守着防漂移。' }}
        </p-text>
        <p-view class="ev">
          <p-view v-for="e in evidence" :key="e.v + e.gate" class="ev-row">
            <span class="ev-k">{{ e.k }}</span>
            <code class="ev-v">{{ e.v }}</code>
            <span class="ev-gate">{{ e.gate }}</span>
          </p-view>
        </p-view>
      </p-view>

      <!-- ═══════════ 收尾 CTA ═══════════ -->
      <p-view data-reveal class="sec cta">
        <p-view class="cta-glow" aria-hidden="true" />
        <p-heading :level="2" v-p-fluid="'font-size(24, 34)'" class="cta-title">
          {{ isEn ? 'One stylesheet. Every end the same — and provable.' : '一份样式表，每个端都一样——并且可被证明。' }}
        </p-heading>
        <p-text class="cta-sub">
          {{ isEn ? 'Themis — every declaration has been to court; every pixel is on the record.' : 'Themis——每条声明都上过法庭，每个像素都有据可查。' }}
        </p-text>
        <p-stack direction="row" :gap="12" wrap class="cta-actions">
          <router-link to="/docs/01-intro" class="btn btn-primary">{{ isEn ? 'Get started' : '开始使用' }}</router-link>
          <router-link to="/consistency" class="btn btn-ghost">{{ isEn ? 'Consistency standard' : '一致性标准' }}</router-link>
          <a class="btn btn-ghost" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">GitHub ↗</a>
        </p-stack>
      </p-view>
    </p-view>
  </p-page>
</template>

<style scoped>
.ce { position: relative; }
.ce-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.ce-glow {
  position: absolute;
  top: -320px;
  left: 50%;
  transform: translateX(-50%);
  width: 1100px;
  height: 700px;
  /* ★不用 filter:blur（L3 opt-in，见 profile 边界）——radial-gradient 本身已柔和淡出 */
  background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.22), transparent 68%);
}
.ce-grid {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(72% 46% at 50% 6%, #000 0%, transparent 78%);
  -webkit-mask-image: radial-gradient(72% 46% at 50% 6%, #000 0%, transparent 78%);
}
.ce-wrap { position: relative; max-width: 1180px; margin: 0 auto; padding: 96px 28px 110px; }

/* ══ Hero ══ */
.ce-hero { align-items: center; padding-bottom: 30px; }
.hero-copy { min-width: 0; }
.chip {
  display: flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.35);
  border-radius: var(--radius-pill);
  padding: 8px 16px;
}
.hero-h1 { color: var(--ink); line-height: 1.12; letter-spacing: -0.025em; font-weight: 800; margin: 4px 0 0; }
.h1-l1 { display: block; }
.h1-l2 {
  display: block;
  font-style: normal;
  background: linear-gradient(96deg, var(--brand-ink), var(--brand) 55%, var(--accent));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-tag { color: var(--ink); font-weight: 650; line-height: 1.5; }
.hero-lead { color: var(--muted); line-height: 1.9; max-width: 620px; font-size: 15px; }
.hero-cta { margin-top: 8px; }
.btn {
  display: flex;
  width: fit-content;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: var(--radius-md);
  font-size: 14.5px;
  font-weight: 650;
  text-decoration: none;
  border: 1px solid var(--line);
  color: var(--ink);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.btn:hover { transform: translateY(-2px); }
.btn-primary {
  background: linear-gradient(120deg, var(--brand), #6a4bf0);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 10px 30px -12px rgba(124, 92, 255, 0.9);
}
.btn-ghost { background: var(--panel); }
.btn-ghost:hover { border-color: var(--brand); }
.hero-pills { margin-top: 6px; }
.pill { font-size: 12px; color: var(--muted); border: 1px solid var(--line); background: rgba(20, 20, 25, 0.7); border-radius: var(--radius-pill); padding: 4px 11px; }
.proof {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  margin-top: 6px;
  padding: 9px 14px;
  border: 1px solid rgba(124, 92, 255, 0.28);
  border-radius: var(--radius-md);
  background: rgba(124, 92, 255, 0.06);
  width: fit-content;
}
.proof-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 10px rgba(124, 92, 255, 0.9); animation: proof-pulse 2.4s ease-in-out infinite; }
@keyframes proof-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.proof-label { font-size: 12px; color: var(--muted); }

/* Hero 视觉阶段 */
.hero-stage { display: flex; justify-content: center; align-items: center; }
.viz {
  width: 100%;
  max-width: 440px;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, rgba(24, 24, 31, 0.92), rgba(17, 17, 23, 0.92));
  box-shadow: 0 30px 80px -40px rgba(124, 92, 255, 0.55);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.viz-code { display: flex; align-items: center; gap: 7px; padding: 12px 14px; background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; }
.viz-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.viz-dot.r { background: #ff5f57; } .viz-dot.y { background: #febc2e; } .viz-dot.g { background: #28c840; }
.viz-code code { font-family: var(--mono); font-size: 11.5px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 4px; }
.viz-arrow { display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--brand-ink); font-size: 12px; }
.viz-arrow span { color: var(--brand); animation: viz-bob 2s ease-in-out infinite; }
@keyframes viz-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
.viz-arrow code { font-family: var(--mono); font-size: 11.5px; color: var(--brand-ink); background: var(--brand-soft); border: 1px solid rgba(124, 92, 255, 0.3); border-radius: var(--radius-pill); padding: 3px 10px; }
.viz-ends { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.viz-end { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 12px 6px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); }
.viz-swatch { width: 100%; height: 26px; border-radius: 7px; background: var(--brand); }
.viz-end-l { font-size: 10.5px; color: var(--muted); }
.viz-caption { text-align: center; font-size: 11.5px; color: var(--dim); }

/* ══ 分节通式 ══ */
.sec { margin-top: 116px; }
.sec-head { margin-bottom: 12px; }
.sec-title { color: var(--ink); letter-spacing: -0.015em; }
.sec-rule { flex: 1; min-width: 40px; height: 1px; background: linear-gradient(90deg, var(--line), transparent); }
.sec-note { color: var(--muted); font-size: 14.5px; line-height: 1.85; margin: 0 0 26px; max-width: 880px; }
[data-reveal] { opacity: 0; transform: translateY(18px); transition: opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1), transform 0.65s cubic-bezier(0.22, 1, 0.36, 1); }
[data-reveal].revealed { opacity: 1; transform: none; }
.card-ic {
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.3);
}
/* 卡片通用：渐变面 + hover 抬升 + 进入错峰 */
.claim, .ab, .metric, .end-card, .bound, .sum-row {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.55s ease, transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1), border-color 0.18s ease;
  transition-delay: calc(var(--stagger-i, 0) * 60ms);
}
[data-reveal].revealed .claim,
[data-reveal].revealed .ab,
[data-reveal].revealed .metric,
[data-reveal].revealed .end-card,
[data-reveal].revealed .bound,
[data-reveal].revealed .sum-row { opacity: 1; transform: none; }

/* ══ 30 秒摘要 ══ */
.summary { display: flex; flex-direction: column; gap: 8px; }
.sum-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.72fr) 2fr;
  gap: 14px;
  padding: 13px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(24, 24, 31, 0.7), rgba(17, 17, 23, 0.7));
}
.sum-q { color: var(--brand-ink); font-size: 12.5px; font-weight: 700; }
.sum-a { color: var(--ink); font-size: 13px; line-height: 1.6; }

/* ══ 三个端 ══ */
.end-card { display: flex; flex-direction: column; gap: 6px; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(17, 17, 23, 0.9)); }
.end-card--web { border-color: rgba(124, 92, 255, 0.5); }
.end-card--mp { border-color: rgba(255, 180, 84, 0.5); }
.end-card--app { border-color: rgba(61, 220, 151, 0.5); }
.end-k { color: var(--ink); font-size: 17px; font-weight: 800; }
.end-tag { font-size: 11px; color: var(--muted); font-family: var(--mono); }
.end-d { color: var(--muted); font-size: 12.5px; line-height: 1.6; margin: 4px 0 0; }

/* ══ 主张 / 能力 / 数字 卡 ══ */
.claim, .ab { position: relative; padding: 26px 22px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(17, 17, 23, 0.9)); }
.claim:hover, .ab:hover, .metric:hover { transform: translateY(-3px); border-color: rgba(124, 92, 255, 0.45); }
.claim-head { margin-bottom: 12px; }
.claim-no { font-family: var(--mono); font-size: 12px; letter-spacing: 0.1em; color: var(--dim); }
.claim-t, .ab-t { color: var(--ink); font-size: 17px; margin: 2px 0 8px; }
.claim-d, .ab-d { color: var(--muted); font-size: 13px; line-height: 1.8; margin: 0; }

.metric { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 22px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(17, 17, 23, 0.9)); }
.metric-value { display: flex; align-items: baseline; gap: 7px; }
.mv-num { color: var(--ink); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
.mv-unit { color: var(--dim); font-size: 11.5px; font-family: var(--mono); }
.metric-label { color: var(--ink); font-size: 12.5px; font-weight: 700; margin: 0; }
.metric-note { color: var(--muted); font-size: 11.5px; line-height: 1.55; margin: 0; }

/* ══ 管线 ══ */
.pipe { display: flex; flex-direction: column; gap: 10px; padding: 24px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: linear-gradient(180deg, rgba(24, 24, 31, 0.7), rgba(17, 17, 23, 0.7)); }
.pipe-src { display: flex; justify-content: center; }
.pipe-src code, .pipe-ir { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 7px 14px; }
.pipe-steps { display: flex; flex-direction: column; gap: 8px; }
.pipe-step { display: flex; align-items: baseline; gap: 12px; padding: 11px 15px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); }
.pipe-n { font-family: var(--mono); font-size: 12px; font-weight: 800; color: var(--brand-ink); }
.pipe-t { color: var(--ink); font-size: 13px; }
.pipe-out { display: flex; align-items: center; justify-content: center; gap: 10px; }
.pipe-arrow { color: var(--brand); font-size: 12px; }
.pipe-ends { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.pipe-end { text-align: center; font-size: 12.5px; font-weight: 700; color: var(--ink); background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 11px 6px; }
.pipe-gate { text-align: center; font-size: 12px; font-weight: 700; color: var(--brand-ink); background: var(--brand-soft); border-radius: var(--radius-pill); padding: 8px 14px; margin-top: 2px; }

/* ══ 对比表 ══ */
.table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-xl); overflow: hidden; }
.tr { display: grid; grid-template-columns: 1.15fr 1.75fr 1.15fr 1.15fr 1.25fr; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--panel); }
.tr:first-child { border-top: none; }
.th { background: var(--panel2); color: var(--brand-ink); font-size: 11.5px; font-weight: 800; letter-spacing: 0.3px; }
.td-dim { color: var(--ink); font-size: 12.5px; font-weight: 700; }
.td { color: var(--muted); font-size: 11.5px; line-height: 1.6; }
.col-win { color: var(--ink); font-weight: 600; }

/* ══ 代码 ══ */
.code-box { margin-bottom: 14px; border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; background: var(--panel2); }
.code-bar { display: flex; align-items: center; gap: 7px; padding: 9px 14px; background: rgba(11, 11, 15, 0.6); border-bottom: 1px solid var(--line); }
.cd { width: 10px; height: 10px; border-radius: 50%; }
.cd.r { background: #ff5f57; } .cd.y { background: #febc2e; } .cd.g { background: #28c840; }
.code-name { font-family: var(--mono); font-size: 11px; color: var(--dim); margin-left: 6px; }
.code-pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.code-pre code { font-family: var(--mono); font-size: 12px; line-height: 1.75; color: var(--ink); white-space: pre; }

/* ══ 边界 ══ */
.bound { padding: 20px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(17, 17, 23, 0.9)); }
.bound--ban { border-color: rgba(255, 107, 107, 0.4); }
.bound-h { color: var(--ink); font-size: 13.5px; font-weight: 800; }
.bound-list { margin: 10px 0 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.75; }
.bound-list li { margin-bottom: 7px; }
.bound--ban .bound-list li { color: var(--rec); }
.bound-note { margin-top: 18px; }

/* ══ 多端证据 ══ */
.demo { margin-bottom: 20px; }
.demo-title { color: var(--ink); font-size: 13px; font-weight: 700; margin: 0 0 12px; }
.shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.shot { margin: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.shot-img {
  width: 100%;
  max-height: 560px;
  object-fit: cover;
  object-position: top;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: var(--panel2);
  box-shadow: 0 24px 60px -40px rgba(0, 0, 0, 0.9);
}
.shot-cap { color: var(--muted); font-size: 11.5px; text-align: center; }

/* ══ 证据链 ══ */
.ev { display: flex; flex-direction: column; gap: 8px; }
.ev-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; padding: 11px 15px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); transition: border-color 0.18s ease; }
.ev-row:hover { border-color: rgba(124, 92, 255, 0.4); }
.ev-k { color: var(--ink); font-size: 12.5px; min-width: 300px; }
.ev-v { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); background: var(--panel2); border-radius: var(--radius-sm); padding: 2px 8px; }
.ev-gate { color: var(--muted); font-size: 10.5px; font-family: var(--mono); }

/* ══ 收尾 CTA ══ */
.cta { position: relative; overflow: hidden; text-align: center; padding: 54px 28px; border: 1px solid var(--line); border-radius: var(--radius-xl); background: linear-gradient(180deg, rgba(24, 24, 31, 0.9), rgba(17, 17, 23, 0.9)); }
.cta-glow { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(420px, 86%); height: min(420px, 86%); background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.28), transparent 70%); pointer-events: none; }
.cta-title { position: relative; color: var(--ink); margin: 0 0 10px; }
.cta-sub { position: relative; color: var(--muted); font-size: 14px; margin: 0 0 22px; }
.cta-actions { position: relative; justify-content: center; }
</style>
