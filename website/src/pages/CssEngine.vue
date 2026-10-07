<script setup lang="ts">
// website/src/pages/CssEngine.vue —— ★★★Themis：编译期 CSS 引擎 · 产品页（用户 2026-10-08
//   「把 CSS 引擎完整产品做到官网上，产品叙事参考白皮书」）
//
// 【这一页是什么】把 Proteus 内置的**编译期 CSS 引擎（Themis）**作为正式产品对外讲清楚——
//   对标 /animation（Morpheus 动画引擎）与 /consistency（一致性标准）两页的形态。
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
// 【D-2 门禁】零 @media、零三方 UI 库、零裸平台 API；截图走 public 静态资产（非 URL/fetch）。
import { computed } from 'vue'
import { locale } from '../i18n'
import DemoIcon from '../components/DemoIcon.vue'
import { CSS_ENGINE_PAGE as D } from '../data/css-engine-page'

const isEn = computed(() => locale.value === 'en')
const base = import.meta.env.BASE_URL || '/'
const N = D.numbers

/* ── 机器数字（原样来自 SSOT；页面只做格式化，不重算） ── */
const pct = (v: number): string => (v * 100).toFixed(2) + '%'
const metrics = computed(() => [
  {
    icon: 'blocks',
    value: String(N.ir.total),
    label: isEn.value ? 'StyleIR fields (closed set, versioned)' : 'StyleIR 字段（闭集 · 版本化）',
    note: isEn.value
      ? `semantic ${N.ir.semantic} + engine-only ${N.ir.engineOnly}`
      : `semantic ${N.ir.semantic} + engine-only ${N.ir.engineOnly}`,
  },
  {
    icon: 'bolt',
    value: `${N.parity.cases} / ${N.parity.props}`,
    label: isEn.value ? 'Criterion ①-b · property-by-property parity' : '判据①-b · 逐属性对拍',
    note: isEn.value ? 'cases / property items ≡ real Chromium getComputedStyle' : '用例 / 属性项 ≡ 真 Chromium getComputedStyle',
  },
  {
    icon: 'signal',
    value: pct(N.coverage.m1),
    label: isEn.value ? 'M1 · numeric consistency coverage' : 'M1 · 数值一致性覆盖率',
    note: isEn.value
      ? `union across layers ${N.coverage.unionCovered}/${N.coverage.unionTotal}; expected = Web`
      : `任意层并集 ${N.coverage.unionCovered}/${N.coverage.unionTotal}；expected = Web`,
  },
  {
    icon: 'bookmark',
    value: `≤ ${N.tolerance.conformanceGeomDp}`,
    label: isEn.value ? 'Criterion ② · geometry vs Web (dp)' : '判据② · 几何 ≡ Web（dp）',
    note: isEn.value
      ? `per-field tolerance ≤${N.tolerance.structureAbsPx}px / ≤${N.tolerance.structureRelPct}%; no global threshold`
      : `逐字段容差 ≤${N.tolerance.structureAbsPx}px / ≤${N.tolerance.structureRelPct}%；禁全局阈值`,
  },
  {
    icon: 'search',
    value: String(N.lint.total),
    label: isEn.value ? 'Profile-lint debt (ratcheted)' : 'Profile lint 存量（棘轮）',
    note: isEn.value
      ? `${Object.entries(N.lint.byProject).map(([k, v]) => `${k} ${v}`).join(' · ')} — only shrinks`
      : `${Object.entries(N.lint.byProject).map(([k, v]) => `${k} ${v}`).join(' · ')} — 只减不增`,
  },
  {
    icon: 'globe',
    value: String(N.inventory.total),
    label: isEn.value ? 'CSS feature inventory (Web superset)' : 'CSS 能力清单（Web 全量口径）',
    note: isEn.value
      ? `implemented ${N.inventory.implemented} · actionable ${N.inventory.actionable} · P0 ${N.inventory.actionableP0}`
      : `implemented ${N.inventory.implemented} · 可推项 ${N.inventory.actionable} · P0 ${N.inventory.actionableP0}`,
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
  { n: '①', zh: '解析 · 长手展开 · @layer 收集 · 特异性计算', en: 'Parse · longhand expansion · @layer collection · specificity' },
  { n: '②', zh: '索引匹配 · 按 key selector 分桶 · 右→左链匹配', en: 'Index & match · bucket by key selector · right-to-left chain matching' },
  { n: '③', zh: '五级层叠 · importance → @layer → 特异性 → 源序', en: 'Five-level cascade · importance → @layer → specificity → source order' },
  { n: '④', zh: '继承 + 计算值 · var() 替换 · calc() 常量化 · env() 引用', en: 'Inherit + computed values · var() substitution · calc() constant-folding · env() refs' },
  { n: '⑤', zh: '动态类预计算 · 属性维度分解 · 互斥分组 · 爆炸保护', en: 'Dynamic-class precompute · dimension decomposition · mutually-exclusive groups · explosion guard' },
]

/* ── 七大能力 —— 白皮书 §5 ── */
const abilities = computed<Array<{ t: string; d: string }>>(() => [
  {
    t: isEn.value ? 'Five-level cascade' : '全语义层叠',
    d: isEn.value
      ? '!important → @layer → id/class/element specificity → source order, fully implemented. id selectors, named layers, CSS-wide keywords (inherit/initial/unset), var() with fallback, structural pseudo-classes and :not().'
      : '!important → @layer → id/类/元素特异性 → 源序，完整实现；支持 id 选择器、命名层、CSS 宽关键字（inherit/initial/unset）、var() 含 fallback、结构伪类与 :not()。',
  },
  {
    t: isEn.value ? 'Dynamic styles at O(1)' : '动态样式 O(1)',
    d: isEn.value
      ? ':class="{ on: x }" is decomposed by property dimension into small lookup tables at build time (not 2ⁿ enumeration); runtime is a bitmap O(1) lookup — profile shows reads == field count.'
      : ':class="{ on: x }" 编译期按属性维度分解成小查找表（非 2ⁿ 全量枚举）；运行期位图 O(1) 查表——profile 实测读次数 == 字段数。',
  },
  {
    t: isEn.value ? 'Degrade recipes' : '降级配方',
    d: isEn.value
      ? 'When an end lacks a field, the IR is rewritten into a semantically equivalent form (grid→flex single-row only; gap→margin half-distance). Every recipe returns container + child fields + an equivalence note, then is diffed against the Web rendering of the original IR.'
      : '某端不原生支持某字段时，编译期把 IR 改写为语义等价形态（grid→flex 仅单行；gap→margin 半距法）。每个配方返回容器字段 + 子项叠加字段 + 等价性说明，再与「原 IR 在 Web 的渲染」对拍验证。',
  },
  {
    t: isEn.value ? 'Build-time interception' : '构建期拦截',
    d: isEn.value
      ? 'E-CSS / W-CSS diagnostics are wired into the Web build chain: anything outside the Profile fails the Web build with rc=1. “Web builds ⇒ all ends consistent” is guaranteed by the compiler, not by convention.'
      : 'E-CSS / W-CSS 诊断接入 Web 构建链：Profile 外写法在 Web 端也 rc=1 真实拦截。「Web 跑通 = 各端一致」由编译器保证，不由约定保证。',
  },
  {
    t: isEn.value ? 'Three ratcheted gates' : '三层一致性门禁',
    d: isEn.value
      ? '① baseline equivalence (compile-time): Node/Rust backends emit byte-identical IR; IR diffed against browser getComputedStyle per property. ② numeric equivalence (runtime): each end ≡ Web within ≤0.5dp. ③ pixel observation (runtime, non-gating). All ratcheted.'
      : '① 基准等价（编译期）：Node/Rust 双后端 IR 逐字节相同；IR 与浏览器 getComputedStyle 逐属性比对。② 数值等价（运行期）：各端 ≡ Web ≤0.5dp。③ 像素观察（运行期·非门禁）。三层全部棘轮。',
  },
  {
    t: isEn.value ? 'Dual-backend parity' : '双后端同律',
    d: isEn.value
      ? 'The same SFC yields byte-identical StyleIR from the TypeScript and the Rust implementation — the compiler itself is also diffed, with real binary comparison and destructive verification.'
      : '同一 SFC，TypeScript 实现与 Rust 实现产出逐字节相同的 StyleIR——编译器自身也是被对拍的对象，有真二进制对拍与破坏性验证。',
  },
  {
    t: isEn.value ? 'Fully replayable (proteus explain)' : '全程可回放（proteus explain）',
    d: isEn.value
      ? 'Every declaration’s why-win / why-lose is traced: selector matching, hit @layer, specificity, source order, shorthand expansion source, inheritance chain. Compile-time CSS gets its own DevTools.'
      : '每条声明为什么赢 / 为什么输，完整 trace：选择器匹配、命中的 @layer、特异性、源序、简写展开来源、继承链。编译期 CSS 也有 DevTools。',
  },
])

/* ── 横向对比 —— 白皮书 §7 ── */
const compareHead = computed(() => (isEn.value
  ? ['Dimension', 'Themis (Proteus)', 'uni-app x / Taro', 'RN / Flutter', 'Kraken / Lynx / WebF']
  : ['维度', 'Themis (Proteus)', 'uni-app x / Taro', 'RN / Flutter', 'Kraken / Lynx / WebF']))
const compareRows = computed<Array<{ dim: string; cells: string[]; win?: number }>>(() => {
  const zh = !isEn.value
  return [
    {
      dim: zh ? 'CSS 语义完整度' : 'CSS semantic completeness',
      cells: zh
        ? ['完整层叠（@layer/id/特异性）+ 继承 + 计算值 + var()/calc()', '子集折叠，无完整层叠', '无 CSS（StyleSheet + Yoga）', '运行期子集引擎']
        : ['Full cascade (@layer/id/specificity) + inheritance + computed values + var()/calc()', 'Subset folding, no full cascade', 'No CSS (StyleSheet + Yoga)', 'Runtime subset engine'],
      win: 0,
    },
    {
      dim: zh ? '样式计算时点' : 'When styles are computed',
      cells: zh ? ['编译期', '编译期折叠', '运行期', '运行期'] : ['Build time', 'Build-time folding', 'Runtime', 'Runtime'],
      win: 0,
    },
    {
      dim: zh ? '运行期样式成本' : 'Runtime style cost',
      cells: zh ? ['O(1) 查表', '匹配 + 容器开销', 'JS diff / rebuild', '解析 + 匹配 + 布局'] : ['O(1) lookup', 'match + container overhead', 'JS diff / rebuild', 'parse + match + layout'],
      win: 0,
    },
    {
      dim: zh ? '动态类样式' : 'Dynamic-class styles',
      cells: zh ? ['编译期属性分解 + 位图 O(1) + 爆炸保护', '运行期匹配', 'JS diff / rebuild', '运行期匹配'] : ['Build-time decomposition + bitmap O(1) + explosion guard', 'runtime matching', 'JS diff / rebuild', 'runtime matching'],
      win: 0,
    },
    {
      dim: zh ? '一致性的 expected' : 'The expected for consistency',
      cells: zh
        ? ['Web 真实渲染（唯一基准）+ 三层棘轮门禁 + golden 冻结', '无统一基准', '无', '引擎自定义（宿主间还会漂移）']
        : ['Web real rendering (sole baseline) + three ratcheted gates + frozen golden', 'no unified baseline', 'none', 'engine-defined (drifts across hosts)'],
      win: 0,
    },
    {
      dim: zh ? '能力不支持时' : 'When a capability is unsupported',
      cells: zh
        ? ['编译期报错，或配方降级（可对拍）；拒绝静默近似', '静默缺失或端差 / 端差手工兼容', '手写平台分支', '引擎内近似']
        : ['Build-time error, or a diffable degrade recipe; no silent approximation', 'silent gaps or per-end shims', 'hand-written platform branches', 'in-engine approximation'],
      win: 0,
    },
    {
      dim: zh ? '可调试性' : 'Debuggability',
      cells: zh ? ['proteus explain 全 trace', '有限', '手段少', '各自 DevTools'] : ['proteus explain full trace', 'limited', 'few tools', 'separate DevTools'],
      win: 0,
    },
    {
      dim: zh ? '编译器自证' : 'Compiler self-proof',
      cells: zh ? ['Node/Rust 逐字节对拍', '无', '—', '—'] : ['Node/Rust byte-identical diff', 'none', '—', '—'],
      win: 0,
    },
  ]
})

/* ── 边界与承诺 —— 白皮书 §9 ── */
const notDoing = computed<Array<{ zh: string; en: string }>>(() => [
  {
    zh: '@media / @supports / @container / @import 跳过并计数——不假装响应式；断点适配走组件/JS 通道',
    en: '@media / @supports / @container / @import are skipped and counted — no pretending to be responsive; breakpoints go through components/JS',
  },
  {
    zh: '兄弟组合、属性选择器、伪元素不支持（显式记 skipped）；含动态类的后代规则 v1 仅告警',
    en: 'Sibling combinators, attribute selectors and pseudo-elements unsupported (explicitly recorded as skipped); descendant rules with dynamic classes warn only in v1',
  },
  {
    zh: '不追求「Web CSS 五端像素级兼容」；不引 Blink/WebF 路线；不自研文本基础设施（字体/BiDi/RTL/OpenType）',
    en: 'No pursuit of pixel-level Web-CSS parity across ends; no Blink/WebF route; no self-built text infrastructure (fonts/BiDi/RTL/OpenType)',
  },
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
  <div class="ce">
    <!-- ═══ Hero ═══ -->
    <header class="ce-head">
      <span class="ce-eyebrow">{{ isEn ? 'Compile-time CSS Engine · Themis' : '编译期 CSS 引擎 · Themis' }}</span>
      <h1 class="ce-title">
        {{ isEn
          ? 'Write styles once. Every end looks the same — and that can be proven.'
          : '写一次样式，所有端长一个样——并且这可以被证明。' }}
      </h1>
      <p class="ce-sub">
        {{ isEn
          ? 'Themis is Proteus’s built-in CSS engine: it takes the full CSS semantics — cascade, inheritance, computed values, dynamic classes, degrade — and computes them at build time. Runtime does an O(1) table lookup; selector matching, cascade and unit conversion never appear in the call stack.'
          : 'Themis 是 Proteus 内置的 CSS 引擎：把完整 CSS 语义——层叠、继承、计算值、动态类、降级——在构建期全部算完。运行期只做 O(1) 查表，选择器匹配 / 层叠 / 单位换算在调用栈中零出现。' }}
      </p>
      <div class="ce-pills">
        <span class="ce-pill">{{ isEn ? 'Name · Themis (goddess of law & order)' : '命名 · Themis（律法与秩序女神）' }}</span>
        <span class="ce-pill">{{ isEn ? `${N.ir.total} IR fields` : `${N.ir.total} IR 字段` }}</span>
        <span class="ce-pill">{{ isEn ? 'baseline = Web (sole)' : '基准 = Web（唯一）' }}</span>
        <span class="ce-pill">{{ isEn ? 'zero runtime CSS parsing' : '运行期零 CSS 解析' }}</span>
      </div>
    </header>

    <!-- ═══ 结论摘要（30 秒读完） ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'In 30 seconds' : '30 秒读完' }}</p>
      <div class="ce-summary">
        <div v-for="s in summary" :key="s.qEn" class="ce-sum-row">
          <span class="ce-sum-q">{{ isEn ? s.qEn : s.q }}</span>
          <span class="ce-sum-a">{{ isEn ? s.aEn : s.a }}</span>
        </div>
      </div>
    </section>

    <!-- ═══ 三个端，三套真相（问题） ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Three ends, three truths' : '三个端，三套真相' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Before Themis the styling chain was three unrelated implementations: Web (native CSSOM — the only complete one), Skyline (the WeChat container — the one rigid external constraint), and App — whose docs literally said “the App end has no CSS engine”. Everyone who has written cross-end styles knows this: one stylesheet, three interpretations, “looks about the same” verified by eye, “where it differs” discovered by users after launch.'
          : '在 Themis 之前，样式链路是三套互不相干的实现：Web（浏览器原生 CSSOM——唯一完整实现）、Skyline（微信容器——唯一刚性外部约束）、App（当时仓内原话是「App 端无 CSS 引擎」）。每一个写过跨端样式的人都认识这个局面：同一份样式表、三个端各自解释、「看起来差不多」靠肉眼验收、「哪里不一样」靠上线后用户发现。' }}
      </p>
      <div class="ce-3ends">
        <article class="ce-end ce-end--web">
          <span class="ce-end-k">Web</span>
          <p class="ce-end-d">{{ isEn ? 'Native CSSOM — complete, and the baseline' : '浏览器原生 CSSOM——完整，且是基准' }}</p>
        </article>
        <article class="ce-end ce-end--mp">
          <span class="ce-end-k">Skyline</span>
          <p class="ce-end-d">{{ isEn ? 'WeChat container — the rigid constraint' : '微信容器——唯一刚性外部约束' }}</p>
        </article>
        <article class="ce-end ce-end--app">
          <span class="ce-end-k">App</span>
          <p class="ce-end-d">{{ isEn ? 'Self-drawn Rust engine — the face we define' : '自研自绘 Rust 引擎——面由我们定义' }}</p>
        </article>
      </div>
    </section>

    <!-- ═══ 产品主张（三条） ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Three claims' : '产品主张（三条）' }}</p>
      <div class="ce-claims">
        <article class="ce-claim">
          <span class="ce-claim-n">01</span>
          <h3 class="ce-claim-t">{{ isEn ? 'Compute, then ship.' : '算完，再上线。' }}</h3>
          <p class="ce-claim-d">{{ isEn
            ? 'All CSS semantics — the five-level cascade, inheritance, var()/calc(), dynamic-class impact — are computed and computed correctly at build time. Runtime only does O(1) table lookup and field application.'
            : 'CSS 的全部语义——五级层叠、继承、var()/calc()、动态类影响——在构建期算完并算对。运行期只做 O(1) 位图查表与字段应用。' }}</p>
        </article>
        <article class="ce-claim">
          <span class="ce-claim-n">02</span>
          <h3 class="ce-claim-t">{{ isEn ? 'One truth only.' : '真值只有一个。' }}</h3>
          <p class="ce-claim-d">{{ isEn
            ? 'The expected for cross-end consistency has exactly one source: the browser’s real rendering. Ends are never compared pairwise to define “correct”.'
            : '多端一致性的 expected 只有一个来源：Web 端浏览器真实渲染。端间互比只能用于诊断，不得定案。' }}</p>
        </article>
        <article class="ce-claim">
          <span class="ce-claim-n">03</span>
          <h3 class="ce-claim-t">{{ isEn ? 'Fail loudly.' : '失败要响亮。' }}</h3>
          <p class="ce-claim-d">{{ isEn
            ? 'Anything that cannot land consistently fails the Web build; anything that cannot be degraded with equivalent semantics is honestly rejected with a reason. Build failure in exchange for silent misalignment.'
            : '不能多端一致落地的写法，在 Web 构建期就报错；不能语义等价降级的字段，如实拒绝并给出原因。用构建失败换静默错位。' }}</p>
        </article>
      </div>
    </section>

    <!-- ═══ 工作原理：一条五步管线 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'How it works · a five-step pipeline' : '工作原理 · 一条五步管线' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'The key design is longhand-level cascade: CSS cascades by longhand property, so “margin: 0” and a later “margin-top: 5px” compete for the same property. Folding at the shorthand level (what most subset engines do) cannot do this — Themis stores longhand declarations, takes the unique winner per longhand, and that is the only way to converge to 100% against getComputedStyle.'
          : '关键设计——长手层层叠：CSS 层叠按长手属性判定，margin: 0 与后写的 margin-top: 5px 竞争的是同一属性。在简写层折叠（多数子集引擎的做法）做不到这一点；Themis 的规则表存长手声明，层叠后逐长手取唯一胜者——这是唯一能和浏览器 getComputedStyle 对拍收敛到 100% 的做法。' }}
      </p>
      <div class="ce-pipe">
        <div class="ce-pipe-src"><code>&lt;style&gt; · SFC</code></div>
        <ol class="ce-pipe-steps">
          <li v-for="s in pipeline" :key="s.n" class="ce-pipe-step">
            <span class="ce-pipe-n">{{ s.n }}</span>
            <span class="ce-pipe-t">{{ isEn ? s.en : s.zh }}</span>
          </li>
        </ol>
        <div class="ce-pipe-out">
          <span class="ce-pipe-arrow">▼</span>
          <code class="ce-pipe-ir">StyleIR · {{ N.ir.total }} {{ isEn ? 'fields (closed set, versioned)' : '字段（闭集 · 版本化）' }}</code>
        </div>
        <div class="ce-pipe-ends">
          <span class="ce-pipe-end">Web Applier</span>
          <span class="ce-pipe-end">Skyline Applier</span>
          <span class="ce-pipe-end">App Applier</span>
        </div>
        <div class="ce-pipe-gate">{{ isEn ? 'three consistency gates · all ratcheted · expected = Web' : '三层一致性门禁 · 全棘轮 · expected = Web' }}</div>
      </div>
    </section>

    <!-- ═══ 七大能力 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Seven capabilities' : '七大能力' }}</p>
      <div class="ce-abilities">
        <article v-for="a in abilities" :key="a.t" class="ce-ab">
          <h3 class="ce-ab-t">{{ a.t }}</h3>
          <p class="ce-ab-d">{{ a.d }}</p>
        </article>
      </div>
    </section>

    <!-- ═══ 数字页（全部机器生成） ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'The numbers' : '数字页' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Every figure below is recomputed from repository artifacts on every check — this page contains no hand-written numbers. The single source of truth is docs/generated/css-engine-numbers.json, guarded by check:css-engine-numbers.'
          : '下面每个数字都在每次校验时从仓库产物重新读出——本页没有一个手写数字。单一事实源是 docs/generated/css-engine-numbers.json，由 check:css-engine-numbers 守着。' }}
      </p>
      <div class="ce-grid">
        <article v-for="m in metrics" :key="m.label" class="ce-card">
          <DemoIcon class="ce-ic" :name="m.icon" />
          <p class="ce-value">{{ m.value }}</p>
          <p class="ce-label">{{ m.label }}</p>
          <p class="ce-note">{{ m.note }}</p>
        </article>
      </div>
    </section>

    <!-- ═══ 横向对比 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Side by side' : '横向对比' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Other frameworks treat cross-end consistency as a wish — implement as far as possible, document the convention, verify by eye. Themis treats it as a decidable gate: one baseline, property-by-property diffing, monotonic ratchets, a baseline that cannot self-certify. The price is a narrower CSS surface — and that is the product decision: whether a syntax enters the Profile is judged not by “is it standard CSS” but by “can it land consistently across ends”.'
          : '其他框架把「跨端一致」当作愿望——各端尽量实现、文档约定、肉眼验收；Themis 把它当作可判定的门禁——基准唯一、逐属性对拍、棘轮只增不减、基准不得自证。代价是收窄了 CSS 面——而这正是产品决策：一条写法是否进 Profile，判据不是「是否符合 CSS 标准」，而是「它能否多端一致地落地」。' }}
      </p>
      <div class="ce-table" :style="{ '--cols': String(compareHead.length) }">
        <div class="ce-tr ce-th">
          <span v-for="h in compareHead" :key="h">{{ h }}</span>
        </div>
        <div v-for="r in compareRows" :key="r.dim" class="ce-tr">
          <span class="ce-td-dim">{{ r.dim }}</span>
          <span
            v-for="(c, i) in r.cells"
            :key="i"
            class="ce-td"
            :class="{ win: r.win === i }"
          >{{ c }}</span>
        </div>
      </div>
    </section>

    <!-- ═══ 开发者体验 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Developer experience' : '开发者体验' }}</p>
      <p class="ce-sec-note">
        {{ isEn ? 'A wrong style fails the build, and the error message is the fix.' : '写错即构建失败，错误信息即修复指引。' }}
      </p>
      <div class="ce-code">
        <pre class="ce-pre"><code>error E-CSS-004: :class {{ isEn ? 'expression cannot be statically enumerated' : '表达式无法静态枚举' }} (:class="runtimeVar")
  → Profile L5 {{ isEn ? 'forbidden. Use a finite candidate set (object/array/ternary literals), or converge dynamic styles to mutually-exclusive groups.' : '禁止项。改用有限候选集（对象/数组/三元字面量），或将动态样式收敛为互斥分组的枚举写法。' }}

warn CSE_DYNCLASS_TABLE_EXPLOSION: {{ isEn ? 'single-node dynamic-class table > 16 (now 23)' : '单节点动态类表 > 16（当前 23）' }}
  → {{ isEn ? 'Split the binding or merge candidate classes to cut property dimensions.' : '拆分绑定或合并候选类，减少属性维度。' }}</code></pre>
        <pre class="ce-pre"><code>$ proteus explain --style --node page-header
margin-top: 5px    ← margin-top (style.css:42) · specificity (0,1,0) · source order wins
                     over margin (style.css:17, expanded to margin-top: 0)
                     layer: components &gt; base</code></pre>
      </div>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Built-in env vars work out of the box: var(--pf-status-bar-height), var(--pf-inset-top), env(safe-area-inset-*), calc(<env> ± Npx) are recognised at build time as runtime environment references — the variable name resolves to a field index, and runtime is a single table lookup.'
          : '内置 env 变量开箱即用：var(--pf-status-bar-height)、var(--pf-inset-top)、env(safe-area-inset-*)、calc(<env> ± Npx) 编译期识别为运行期环境引用——变量名解析成字段索引，运行期一次表查找。' }}
      </p>
    </section>

    <!-- ═══ 边界与承诺 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Boundaries & promises' : '边界与承诺' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Themis writes “what it does not support” into the product docs — that itself is the biggest difference from other frameworks.'
          : 'Themis 把「不支持什么」写进产品文档——这本身就是与其他框架最大的不同。' }}
      </p>
      <div class="ce-bounds">
        <div class="ce-bound-group">
          <span class="ce-bound-h">{{ isEn ? 'v1 does not do' : 'v1 不做' }}</span>
          <ul class="ce-bound-list">
            <li v-for="(b, i) in notDoing" :key="i">{{ isEn ? b.en : b.zh }}</li>
          </ul>
        </div>
        <div class="ce-bound-group">
          <span class="ce-bound-h">{{ isEn ? 'Wording discipline (never say)' : '对外表述纪律（禁语）' }}</span>
          <ul class="ce-bound-list ce-bound-list--ban">
            <li v-for="(f, i) in forbidden" :key="i">{{ isEn ? f.en : f.zh }}</li>
          </ul>
        </div>
      </div>
      <p class="ce-sec-note ce-bounds-note">
        {{ isEn
          ? 'Standing risk: the layout-semantics gap between Taffy and Blink (margin collapsing, percentage baselines) is structural. Pre-registered upgrade criteria E1–E4 (criterion caps out / spinning in place / baseline unstable / degrade not converging — each needs an evidence pack proving “not an implementation defect”). “It feels too hard to align” is not a trigger.'
          : '常驻风险：Taffy ⇄ Blink 的布局语义差（margin 折叠、百分比基准等）是结构性的。已预登记 A→B 升级触发准则 E1–E4（判据封顶 / 原地打转 / 基准不稳 / 降级不可收敛——均需证据包确认「非实现缺陷」才可触发）。「感觉对齐太难」不构成触发。' }}
      </p>
    </section>

    <!-- ═══ 多端真渲染证据 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Evidence · one SFC, four real renderers' : '证据 · 同一份 SFC，四种真实渲染器' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Not hand-written fixtures — the same .vue acceptance pages compiled and rendered by four real targets: the browser, an Android device, iOS and HarmonyOS. Each is a real engine, not a screenshot mock. Anchored crops of one element are compared directly.'
          : '不是手写夹具——同一批 .vue 验收页由四种真实目标编译并渲染：浏览器、Android 真机、iOS、鸿蒙。每个都是真实引擎，不是截图贴图。下面按同一元素逐端并排。' }}
      </p>
      <div v-for="set in demoSets" :key="set.slug" class="ce-demo">
        <p class="ce-demo-title">{{ set.title }}</p>
        <div class="ce-shots">
          <figure v-for="s in set.shots" :key="s.pub" class="ce-shot">
            <img class="ce-shot-img" :src="shotUrl(s.pub)" :alt="s.label" loading="lazy" />
            <figcaption class="ce-shot-cap">{{ s.label }}</figcaption>
          </figure>
        </div>
      </div>
      <p class="ce-note">
        {{ isEn
          ? 'Deliberately absent: any claim of pixel-perfect cross-platform identity.'
          : '刻意不写：任何「跨端逐像素一致」的宣称。' }}
      </p>
    </section>

    <!-- ═══ 证据索引 ═══ -->
    <section class="ce-sec">
      <p class="ce-sec-title">{{ isEn ? 'Evidence chain' : '证据链' }}</p>
      <p class="ce-sec-note">
        {{ isEn
          ? 'Every claim above points to a machine artifact kept in the repository, each guarded by a gate that fails on drift.'
          : '上面每一个主张都指向仓库里可查的机器产物，每一项都有门禁守着防漂移。' }}
      </p>
      <div class="ce-ev">
        <div v-for="e in evidence" :key="e.v + e.gate" class="ce-ev-row">
          <span class="ce-ev-k">{{ e.k }}</span>
          <code class="ce-ev-v">{{ e.v }}</code>
          <span class="ce-ev-gate">{{ e.gate }}</span>
        </div>
      </div>
    </section>

    <p class="ce-foot">
      {{ isEn
        ? 'Themis — every declaration has been to court; every pixel is on the record.'
        : 'Themis——每条声明都上过法庭，每个像素都有据可查。' }}
    </p>
  </div>
</template>

<style scoped>
.ce { max-width: 1080px; margin: 0 auto; padding: 18px 0 46px; }
.ce-head { margin-bottom: 26px; }
.ce-eyebrow {
  display: inline-block;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 4px 12px;
}
.ce-title { color: var(--ink); font-size: 32px; font-weight: 800; line-height: 1.35; margin: 14px 0 0; max-width: 900px; }
.ce-sub { color: var(--muted); font-size: 14px; line-height: 1.8; margin: 12px 0 0; max-width: 800px; }
.ce-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.ce-pill {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 11px;
}

.ce-sec { margin-top: 30px; }
.ce-sec-title { color: var(--ink); font-size: 19px; font-weight: 800; margin: 0 0 6px; }
.ce-sec-note { color: var(--muted); font-size: 13px; line-height: 1.75; margin: 0 0 14px; max-width: 860px; }

/* 结论摘要 */
.ce-summary { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.ce-sum-row { display: grid; grid-template-columns: minmax(160px, 0.8fr) 2fr; gap: 12px; padding: 11px 14px; border-top: 1px solid var(--line); background: var(--panel); }
.ce-sum-row:first-child { border-top: none; }
.ce-sum-q { color: var(--brand-ink); font-size: 12.5px; font-weight: 700; }
.ce-sum-a { color: var(--ink); font-size: 12.5px; line-height: 1.6; }

/* 三个端 */
.ce-3ends { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.ce-end { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.ce-end-k { color: var(--ink); font-size: 15px; font-weight: 800; }
.ce-end-d { color: var(--muted); font-size: 12px; line-height: 1.6; margin: 6px 0 0; }
.ce-end--web { border-color: var(--brand); }
.ce-end--mp { border-color: var(--warn); }
.ce-end--app { border-color: var(--ok); }

/* 产品主张 */
.ce-claims { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.ce-claim { padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.ce-claim-n { color: var(--brand-ink); font-family: var(--mono); font-size: 12px; font-weight: 800; }
.ce-claim-t { color: var(--ink); font-size: 16px; font-weight: 800; margin: 6px 0 0; }
.ce-claim-d { color: var(--muted); font-size: 12.5px; line-height: 1.7; margin: 8px 0 0; }

/* 管线 */
.ce-pipe { display: flex; flex-direction: column; align-items: stretch; gap: 8px; border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: var(--panel); }
.ce-pipe-src, .ce-pipe-out { display: flex; justify-content: center; }
.ce-pipe-src code, .ce-pipe-ir { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; }
.ce-pipe-steps { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ce-pipe-step { display: flex; align-items: baseline; gap: 10px; padding: 9px 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel2); }
.ce-pipe-n { color: var(--brand-ink); font-weight: 800; font-size: 12px; min-width: 18px; }
.ce-pipe-t { color: var(--ink); font-size: 12.5px; }
.ce-pipe-arrow { color: var(--dim); font-size: 12px; text-align: center; }
.ce-pipe-ends { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.ce-pipe-end { text-align: center; font-size: 12px; font-weight: 700; color: var(--ink); background: var(--panel2); border: 1px solid var(--line); border-radius: 9px; padding: 9px 6px; }
.ce-pipe-gate { text-align: center; font-size: 11.5px; font-weight: 700; color: var(--brand-ink); background: var(--brand-soft); border-radius: 999px; padding: 6px 12px; margin-top: 4px; }

/* 能力 */
.ce-abilities { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.ce-ab { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.ce-ab-t { color: var(--ink); font-size: 14px; font-weight: 800; margin: 0; }
.ce-ab-d { color: var(--muted); font-size: 12px; line-height: 1.7; margin: 8px 0 0; }

/* 数字卡 */
.ce-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.ce-card { display: flex; flex-direction: column; gap: 6px; padding: 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; }
.ce-ic { font-size: 20px; line-height: 1; color: var(--brand-ink); }
.ce-value { color: var(--ink); font-size: 26px; font-weight: 800; margin: 2px 0 0; line-height: 1.15; }
.ce-label { color: var(--ink); font-size: 12.5px; font-weight: 700; margin: 0; }
.ce-note { color: var(--muted); font-size: 11.5px; line-height: 1.6; margin: 0; }

/* 对比表 */
.ce-table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.ce-tr { display: grid; grid-template-columns: 1.2fr 1.7fr 1.2fr 1.2fr 1.3fr; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--line); background: var(--panel); }
.ce-tr:first-child { border-top: none; }
.ce-th { background: var(--panel2); color: var(--brand-ink); font-size: 11.5px; font-weight: 800; letter-spacing: 0.3px; }
.ce-td-dim { color: var(--ink); font-size: 12.5px; font-weight: 700; }
.ce-td { color: var(--muted); font-size: 11.5px; line-height: 1.55; }
.ce-td.win { color: var(--ink); font-weight: 600; }

/* 代码 */
.ce-code { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
.ce-pre { margin: 0; padding: 14px 16px; background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; overflow-x: auto; }
.ce-pre code { font-family: var(--mono); font-size: 12px; line-height: 1.7; color: var(--ink); white-space: pre; }

/* 边界 */
.ce-bounds { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.ce-bound-group { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.ce-bound-h { color: var(--ink); font-size: 13px; font-weight: 800; }
.ce-bound-list { margin: 10px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; line-height: 1.7; }
.ce-bound-list li { margin-bottom: 6px; }
.ce-bound-list--ban li { color: var(--rec); }
.ce-bounds-note { margin-top: 14px; }

/* 多端证据 */
.ce-demo { margin-bottom: 16px; }
.ce-demo-title { color: var(--ink); font-size: 13px; font-weight: 700; margin: 0 0 10px; }
/* ★四端整屏截图可读性（决定性对比）：2 列放大（~500px/端）+ 限高裁到内容区顶部
   （与 /consistency 的 SFC 区同法——整屏真截图的**展示**归一，不为比较做归一）。
   源是设备整屏（1200×2608 ≈ 2.17:1），按 204px 缩略时字号不可读 ⇒ 放大 + 顶裁。 */
.ce-shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.ce-shot { margin: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.ce-shot-img {
  width: 100%;
  max-height: 560px;
  object-fit: cover;
  object-position: top;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--panel2);
}
.ce-shot-cap { color: var(--muted); font-size: 11.5px; text-align: center; }

/* 证据链 */
.ce-ev { display: flex; flex-direction: column; gap: 6px; }
.ce-ev-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); }
.ce-ev-k { color: var(--ink); font-size: 12px; min-width: 280px; }
.ce-ev-v { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); background: var(--panel2); border-radius: 6px; padding: 2px 8px; }
.ce-ev-gate { color: var(--muted); font-size: 10.5px; }

.ce-foot { color: var(--dim); font-size: 12px; text-align: center; margin-top: 34px; }
</style>
