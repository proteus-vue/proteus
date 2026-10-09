<script setup lang="ts">
// website/src/pages/CssEngine.vue —— ★★★Themis：编译期 CSS 引擎 · 产品页
//
// 【★它凭什么和 /animation 不一样（用户 2026-10-08「CSS 引擎需要有自己的特色风格」）】
//   Themis = 希腊**律法与秩序女神**；CSS 层叠的本质是一场**法庭审判**（每条声明出示证据——特异性 /
//   @layer / 源序，由裁判判定谁赢）。⇒ 本页的视觉语言是 **「案卷台账」（Court Ledger）**：
//     · 背景 = **ruled 台账纸**（细横线 + 顶部微光），不是动画页的星场 / 放射光晕 / 方格网；
//     · 分节 = **`§ NN` 案号标头**（mono，如 `§03 THE HEARING`），不是动画页的 `sec-rule` 渐变线；
//     · 卡片 = **hairline 案卷记录 + 左侧判词竖线**（判决用色：赢=绿 / 输=红删除线），
//       不是动画页的渐变面板 + 紫光 hover；
//     · Hero 视觉 = **层叠裁决台**（三声宣言竞争 → 输者删除线 → 唯一胜出 → 四端同一结果），
//       直接演示引擎的核心动作，而不是装饰图形。
//   ★配色沿用仓内单品牌纪律（`--brand` 紫 = 裁判），**判决语义色**（`--ok` 赢 / `--rec` 输）是本页签名。
//
// 【★数据纪律】页面**没有一个手写数字**——全部来自 `../data/css-engine-page`（由
//   `website/scripts/gen-css-engine-data.mjs` 从 `docs/generated/css-engine-numbers.json` 读出）。
//   叙事骨架取自《Proteus_Themis多端一致CSS引擎产品白皮书》。
//
// 【对外表述纪律（白皮书 §9 三条禁语）】不说「像素级一致 / 支持完整 CSS / 性能无成本」。
// 【D-2 门禁】零 @media · 三方 UI · 裸平台 API；**布局一律落在原生 div/section**（`p-view` 默认
//   `flex-direction:column` 会盖掉行布局——本轮修复的正是这个）；卡片网格用 `p-grid`（auto-fit）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'
import { CSS_ENGINE_PAGE as D } from '../data/css-engine-page'

const isEn = computed(() => locale.value === 'en')
const base = import.meta.env.BASE_URL || '/'
const N = D.numbers

/* ── 滚动显现（reduced-motion 直接终态） ── */
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
        if (en.isIntersecting) { en.target.classList.add('revealed'); revealObserver?.unobserve(en.target) }
      }
    },
    { threshold: 0.12 },
  )
  targets.forEach((el) => revealObserver?.observe(el))
})
onUnmounted(() => { revealObserver?.disconnect(); revealObserver = null })

/* ── Hero 视觉：层叠裁决台（演示引擎的核心动作） ── */
const verdict = computed(() => {
  const zh = !isEn.value
  return {
    decls: [
      { sel: '.card', decl: 'margin: 0', w: '0,1,0', layer: 'base', win: false },
      { sel: '.page .card', decl: 'margin-top: 8px', w: '0,2,0', layer: 'base', win: false },
      { sel: '.card', decl: 'margin-top: 5px', w: '0,1,0', layer: 'components', win: true },
    ],
    winLabel: zh ? '胜出' : 'wins',
    loseLabel: zh ? '败诉' : 'loses',
    computedLabel: zh ? '计算值（编译期）' : 'computed (build time)',
    computed: 'margin-top: 5px',
    endsLabel: zh ? '四端同一结果' : 'identical on all four ends',
    note: zh ? '五级层叠在构建期裁决：!important → @layer → 特异性 → 源序' : 'Cascade decided at build time: !important → @layer → specificity → source order',
  }
})

/* ── 机器数字（原样来自 SSOT） ── */
const pct = (v: number): string => (v * 100).toFixed(2) + '%'
const metrics = computed(() => [
  { icon: 'code', value: String(N.ir.total), unit: isEn.value ? 'fields' : '字段', label: isEn.value ? 'StyleIR (closed set, versioned)' : 'StyleIR（闭集 · 版本化）', note: `semantic ${N.ir.semantic} + engine-only ${N.ir.engineOnly}` },
  { icon: 'target', value: `${N.parity.cases}/${N.parity.props}`, unit: isEn.value ? 'cases / items' : '用例 / 项', label: isEn.value ? 'Criterion ①-b · property parity' : '判据①-b · 逐属性对拍', note: isEn.value ? '≡ real Chromium getComputedStyle' : '≡ 真 Chromium getComputedStyle' },
  { icon: 'chart', value: pct(N.coverage.m1), unit: isEn.value ? 'coverage' : '覆盖率', label: isEn.value ? 'M1 · numeric consistency' : 'M1 · 数值一致性', note: isEn.value ? `union ${N.coverage.unionCovered}/${N.coverage.unionTotal}; expected = Web` : `并集 ${N.coverage.unionCovered}/${N.coverage.unionTotal}；expected = Web` },
  { icon: 'box', value: `≤${N.tolerance.conformanceGeomDp}`, unit: 'dp', label: isEn.value ? 'Criterion ② · geometry vs Web' : '判据② · 几何 ≡ Web', note: isEn.value ? `per-field ≤${N.tolerance.structureAbsPx}px / ≤${N.tolerance.structureRelPct}%` : `逐字段 ≤${N.tolerance.structureAbsPx}px / ≤${N.tolerance.structureRelPct}%` },
  { icon: 'shield', value: String(N.lint.total), unit: isEn.value ? 'debt' : '存量', label: isEn.value ? 'Profile-lint (ratcheted)' : 'Profile lint（棘轮）', note: isEn.value ? 'only shrinks, never grows' : '只减不增' },
  { icon: 'layers', value: String(N.inventory.total), unit: isEn.value ? 'features' : '能力项', label: isEn.value ? 'CSS inventory (Web superset)' : 'CSS 能力清单（Web 全量）', note: isEn.value ? `implemented ${N.inventory.implemented} · P0 ${N.inventory.actionableP0}` : `implemented ${N.inventory.implemented} · P0 ${N.inventory.actionableP0}` },
])

const summary = computed(() => {
  const zh = !isEn.value
  return [
    { q: zh ? '这是什么' : 'What it is', a: zh ? '把完整 CSS 语义（层叠 / 继承 / 计算值 / 动态类 / 降级）搬进编译期的引擎，构建时全部算完' : 'An engine that moves full CSS semantics into build time — all computed ahead of shipping' },
    { q: zh ? '凭什么多端一致' : 'Why ends agree', a: zh ? '正确性不由引擎自定义——浏览器真实渲染是唯一基准，三层判据逐属性 / 逐 0.5dp / 逐像素对拍，全部棘轮' : 'The browser’s real rendering is the only baseline; three gate layers, all ratcheted' },
    { q: zh ? '与运行期引擎的区别' : 'vs runtime engines', a: zh ? '运行期零 CSS 解析：宿主只消费已折叠的 StyleIR，样式应用是 O(1) 查表' : 'Zero runtime CSS parsing: hosts consume folded StyleIR; applying styles is O(1)' },
    { q: zh ? '与 uni-app x / Taro' : 'vs uni-app x / Taro', a: zh ? '不是“子集尽量折叠”，是完整层叠 + 不能一致的写法全端禁用（构建期报错）' : 'Full cascade + banning anything that cannot land consistently (build-time error)' },
    { q: zh ? '与 RN / Flutter' : 'vs RN / Flutter', a: zh ? '不是“没有 CSS 所以没有分叉”，是有完整 CSS 且分叉可判定、可拦截、可对拍' : 'Full CSS with divergence that is decidable, interceptable and diffable' },
  ]
})

const pipeline = computed(() => {
  const zh = !isEn.value
  return zh
    ? [
        { n: '01', t: '解析 · 长手展开 · @layer 收集 · 特异性计算' },
        { n: '02', t: '索引匹配 · 按 key selector 分桶 · 右→左链匹配' },
        { n: '03', t: '五级层叠 · importance → @layer → 特异性 → 源序' },
        { n: '04', t: '继承 + 计算值 · var() 替换 · calc() 常量化 · env() 引用' },
        { n: '05', t: '动态类预计算 · 属性维度分解 · 互斥分组 · 爆炸保护' },
      ]
    : [
        { n: '01', t: 'Parse · longhand expansion · @layer collection · specificity' },
        { n: '02', t: 'Index & match · bucket by key selector · right-to-left chain' },
        { n: '03', t: 'Five-level cascade · importance → @layer → specificity → order' },
        { n: '04', t: 'Inherit + computed values · var() · calc() folding · env() refs' },
        { n: '05', t: 'Dynamic-class precompute · dimension split · exclusive groups · guard' },
      ]
})

const abilities = computed<Array<{ ic: string; t: string; d: string }>>(() => {
  const zh = !isEn.value
  return [
    { ic: 'layers', t: zh ? '全语义层叠' : 'Five-level cascade', d: zh ? '!important → @layer → id/类/元素特异性 → 源序，完整实现；支持 id 选择器、命名层、CSS 宽关键字、var() 含 fallback、结构伪类与 :not()。' : '!important → @layer → specificity → source order, fully implemented. id selectors, named layers, CSS-wide keywords, var() with fallback, structural pseudo-classes, :not().' },
    { ic: 'bolt', t: zh ? '动态样式 O(1)' : 'Dynamic styles O(1)', d: zh ? ':class="{ on: x }" 编译期按属性维度分解成小查找表（非 2ⁿ 全量枚举）；运行期位图 O(1) 查表——profile 实测读次数 == 字段数。' : ':class="{ on: x }" is decomposed by property dimension into small lookup tables at build time; runtime is a bitmap O(1) lookup — reads == field count.' },
    { ic: 'plug', t: zh ? '降级配方' : 'Degrade recipes', d: zh ? '某端不支持某字段时，编译期改写为语义等价形态（grid→flex 仅单行；gap→margin 半距法），再与「原 IR 在 Web 的渲染」对拍验证。' : 'When an end lacks a field, the IR is rewritten into a semantically equivalent form, then diffed against the Web rendering of the original IR.' },
    { ic: 'shield', t: zh ? '构建期拦截' : 'Build-time interception', d: zh ? 'E-CSS / W-CSS 诊断接入 Web 构建链：Profile 外写法在 Web 端也 rc=1 真实拦截。「Web 跑通 = 各端一致」由编译器保证。' : 'E-CSS / W-CSS diagnostics are wired into the Web build chain: anything outside the Profile fails the build. Guaranteed by the compiler.' },
    { ic: 'target', t: zh ? '三层一致性门禁' : 'Three ratcheted gates', d: zh ? '① 基准等价（编译期）：双后端逐字节 + IR 与 getComputedStyle 逐属性比对。② 数值等价（运行期）：各端 ≡ Web ≤0.5dp。③ 像素观察（非门禁）。全部棘轮。' : '① baseline equivalence (compile-time). ② numeric equivalence (runtime, ≤0.5dp). ③ pixel observation (non-gating). All ratcheted.' },
    { ic: 'code', t: zh ? '双后端同律' : 'Dual-backend parity', d: zh ? '同一 SFC，TypeScript 实现与 Rust 实现产出逐字节相同的 StyleIR——编译器自身也是被对拍的对象。' : 'The same SFC yields byte-identical StyleIR from the TypeScript and Rust implementations — the compiler itself is diffed.' },
    { ic: 'data', t: zh ? '全程可回放' : 'Fully replayable', d: zh ? 'proteus explain --style 追踪每条声明为什么赢 / 输：选择器匹配、命中的 @layer、特异性、源序、简写来源、继承链。' : 'proteus explain --style traces why each declaration wins or loses: matching, @layer, specificity, source order, shorthand source, inheritance.' },
  ]
})

const compareHead = computed(() => isEn.value ? ['Dimension', 'Themis (Proteus)', 'uni-app x / Taro', 'RN / Flutter', 'Kraken / Lynx / WebF'] : ['维度', 'Themis (Proteus)', 'uni-app x / Taro', 'RN / Flutter', 'Kraken / Lynx / WebF'])
const compareRows = computed<Array<{ dim: string; cells: string[] }>>(() => {
  const zh = !isEn.value
  return [
    { dim: zh ? 'CSS 语义完整度' : 'CSS semantic completeness', cells: zh ? ['完整层叠（@layer/id/特异性）+ 继承 + 计算值 + var()/calc()', '子集折叠，无完整层叠', '无 CSS（StyleSheet + Yoga）', '运行期子集引擎'] : ['Full cascade + inheritance + computed values + var()/calc()', 'Subset folding', 'No CSS (StyleSheet + Yoga)', 'Runtime subset engine'] },
    { dim: zh ? '样式计算时点' : 'When computed', cells: zh ? ['编译期', '编译期折叠', '运行期', '运行期'] : ['Build time', 'Build-time folding', 'Runtime', 'Runtime'] },
    { dim: zh ? '运行期样式成本' : 'Runtime style cost', cells: zh ? ['O(1) 查表', '匹配 + 容器开销', 'JS diff / rebuild', '解析 + 匹配 + 布局'] : ['O(1) lookup', 'match + container', 'JS diff / rebuild', 'parse + match + layout'] },
    { dim: zh ? '动态类样式' : 'Dynamic-class styles', cells: zh ? ['编译期属性分解 + 位图 O(1) + 爆炸保护', '运行期匹配', 'JS diff / rebuild', '运行期匹配'] : ['Build-time decomposition + bitmap O(1) + guard', 'runtime matching', 'JS diff / rebuild', 'runtime matching'] },
    { dim: zh ? '一致性的 expected' : 'The expected', cells: zh ? ['Web 真实渲染（唯一基准）+ 三层棘轮门禁 + golden 冻结', '无统一基准', '无', '引擎自定义（宿主间还会漂移）'] : ['Web real rendering (sole) + three ratchets + frozen golden', 'no unified baseline', 'none', 'engine-defined (drifts)'] },
    { dim: zh ? '能力不支持时' : 'When unsupported', cells: zh ? ['编译期报错，或配方降级（可对拍）；拒绝静默近似', '静默缺失或端差 / 端差手工兼容', '手写平台分支', '引擎内近似'] : ['Build-time error or a diffable degrade recipe; no silent approximation', 'silent gaps or per-end shims', 'hand-written branches', 'in-engine approximation'] },
    { dim: zh ? '可调试性' : 'Debuggability', cells: zh ? ['proteus explain 全 trace', '有限', '手段少', '各自 DevTools'] : ['proteus explain full trace', 'limited', 'few tools', 'separate DevTools'] },
    { dim: zh ? '编译器自证' : 'Compiler self-proof', cells: zh ? ['Node/Rust 逐字节对拍', '无', '—', '—'] : ['Node/Rust byte-identical diff', 'none', '—', '—'] },
  ]
})

const notDoing = computed(() => (isEn.value
  ? ['@media / @supports / @container / @import are skipped and counted — no pretending to be responsive; breakpoints go through components/JS', 'Sibling combinators, attribute selectors and pseudo-elements unsupported (recorded as skipped); descendant rules with dynamic classes warn only in v1', 'No pursuit of pixel-level Web-CSS parity; no Blink/WebF route; no self-built text infrastructure (fonts/BiDi/RTL/OpenType)']
  : ['@media / @supports / @container / @import 跳过并计数——不假装响应式；断点走组件/JS 通道', '兄弟组合、属性选择器、伪元素不支持（显式记 skipped）；含动态类的后代规则 v1 仅告警', '不追求「Web CSS 五端像素级兼容」；不引 Blink/WebF 路线；不自研文本基础设施（字体/BiDi/RTL/OpenType）']))
const forbidden = computed(() => (isEn.value
  ? ['Never “pixel-perfect” — criterion ② is ≤0.5dp numeric equivalence', 'Never “supports full CSS” — it is “full semantics inside the Profile, build-time interception outside”', 'Never “zero cost” — the cost is shifted to build time']
  : ['不得说「像素级一致」——判据② 是 ≤0.5dp 数值等价', '不得说「支持完整 CSS」——是「Profile 内完整语义 + Profile 外构建期拦截」', '不得说「性能无成本」——成本前移到了编译期']))

const evidence = computed(() => {
  const zh = !isEn.value
  return [
    { k: zh ? `${N.ir.total} IR 字段（semantic ${N.ir.semantic} / engine-only ${N.ir.engineOnly}）` : `${N.ir.total} IR fields (semantic ${N.ir.semantic} / engine-only ${N.ir.engineOnly})`, v: 'style-ir-registry.generated.ts', gate: 'check:style-ir-schema' },
    { k: zh ? `${N.parity.cases} 用例 / ${N.parity.props} 项 ≡ Chromium` : `${N.parity.cases} cases / ${N.parity.props} items ≡ Chromium`, v: 'tests/fixtures/cse-parity-cases.ts', gate: 'test:cse-parity' },
    { k: zh ? `M1 数值一致性 ${pct(N.coverage.m1)}` : `M1 numeric consistency ${pct(N.coverage.m1)}`, v: 'consistency-metrics.json', gate: 'check:consistency-metrics' },
    { k: zh ? `判据② 几何 ≡ Web ≤${N.tolerance.conformanceGeomDp}dp` : `Criterion ② geometry ≡ Web ≤${N.tolerance.conformanceGeomDp}dp`, v: 'tests/appliers-conformance.test.ts', gate: 'test:coupled' },
    { k: zh ? `Profile lint 存量棘轮 ${N.lint.total}` : `Profile-lint debt ${N.lint.total}`, v: '{examples,showcase,css-conformance,website}/cse-lint-baseline.json', gate: 'check:cse-lint-baseline' },
    { k: zh ? `三端能力对齐矩阵 ${N.alignment.rows} 行 × ${N.alignment.ends} 端` : `Three-end matrix ${N.alignment.rows} rows × ${N.alignment.ends} ends`, v: 'css-capability-alignment.json', gate: 'check:css-capability-alignment' },
    { k: zh ? `CSS 能力清单 ${N.inventory.total} 项（P0 ${N.inventory.actionableP0}）` : `CSS inventory ${N.inventory.total} items (P0 ${N.inventory.actionableP0})`, v: 'css-feature-inventory.json', gate: 'check:css-inventory' },
    { k: zh ? '本页数字单一事实源' : 'Single source of truth', v: 'docs/generated/css-engine-numbers.json', gate: 'check:css-engine-numbers' },
  ]
})

function shotUrl(pub: string): string { return `${base}css-engine/${pub}` }
const demoSets = computed(() => D.demoPages.map((p) => ({
  slug: p.slug,
  title: isEn.value ? p.en : p.zh,
  shots: D.shots.filter((s) => s.page === p.slug).map((s) => ({ pub: s.pub, label: isEn.value ? s.labelEn : s.labelZh })),
})))
</script>

<template>
  <p-page ref="rootEl" class="ce">
    <!-- 背景层：案卷台账纸（细横线 + 顶部微光）——区别于动画页的星场/放射光晕 -->
    <div class="ce-bg" aria-hidden="true"><span class="ce-ledger" /></div>

    <div class="ce-wrap">
      <!-- ═══ Hero（案卷头版：文案 + 层叠裁决台） ═══ -->
      <p-grid :min-col-width="380" :gap="52" class="hero">
        <div class="hero-copy">
          <span class="chip"><FeatureIcon name="bolt" />{{ isEn ? 'COMPILE-TIME CSS ENGINE' : '编译期 CSS 引擎' }} · THEMIS</span>
          <h1 class="hero-h1">
            <span class="h1-l1">{{ isEn ? 'Every declaration goes to court.' : '每条声明，都上法庭。' }}</span>
            <span class="h1-l2">{{ isEn ? 'One verdict. Every end identical.' : '一次裁决，所有端同一个样。' }}</span>
          </h1>
          <p class="hero-lead">
            {{ isEn
              ? 'Themis is Proteus’s compile-time CSS engine: cascade, inheritance, computed values, dynamic classes and degrade are all judged at build time. Runtime only does an O(1) table lookup.'
              : 'Themis 是 Proteus 的编译期 CSS 引擎：层叠、继承、计算值、动态类、降级在构建期全部裁决完毕。运行期只做 O(1) 查表。' }}
          </p>
          <div class="hero-cta">
            <a href="#verdict" class="btn btn-primary">{{ isEn ? 'See the four-end verdict' : '看四端裁决' }}</a>
            <!-- ★CSS 支持参考入口（用户「CSS 文档入口太深」）：产品页首屏直达逐属性多端支持情况 -->
            <router-link to="/docs/reference/css-support" class="btn btn-ghost">{{ isEn ? 'Full CSS support reference' : 'CSS 支持参考' }}</router-link>
            <router-link to="/consistency" class="btn btn-ghost">{{ isEn ? 'Consistency standard' : '一致性标准' }}</router-link>
          </div>
          <div class="hero-pills">
            <span class="pill">{{ isEn ? `${N.ir.total} IR fields` : `${N.ir.total} IR 字段` }}</span>
            <span class="pill">{{ isEn ? 'baseline = Web (sole)' : '基准 = Web（唯一）' }}</span>
            <span class="pill">{{ isEn ? 'zero runtime CSS' : '运行期零 CSS 解析' }}</span>
          </div>
        </div>

        <!-- 层叠裁决台 -->
        <div class="verdict">
          <div class="verdict-head">
            <span class="vh-title">{{ isEn ? 'CASCADE · margin-top' : '层叠裁决 · margin-top' }}</span>
            <span class="vh-seal">THEMIS</span>
          </div>
          <div v-for="(d, i) in verdict.decls" :key="i" class="decl" :class="{ win: d.win }">
            <span class="decl-mark">{{ d.win ? '✓' : '✕' }}</span>
            <div class="decl-body">
              <div class="decl-line"><span class="decl-sel">{{ d.sel }}</span><span class="decl-prop">{{ d.decl }}</span></div>
              <div class="decl-meta">
                <span class="meta-i">{{ isEn ? 'spec' : '特异性' }} {{ d.w }}</span>
                <span class="meta-i">{{ isEn ? 'layer' : '层' }} {{ d.layer }}</span>
              </div>
            </div>
            <span class="decl-verdict">{{ d.win ? verdict.winLabel : verdict.loseLabel }}</span>
          </div>
          <div class="verdict-out">
            <span class="vo-arrow">▼</span>
            <span class="vo-label">{{ verdict.computedLabel }}</span>
            <code class="vo-code">{{ verdict.computed }}</code>
          </div>
          <div class="verdict-ends">
            <span v-for="e in ['Web', 'Skyline', 'iOS', 'Android']" :key="e" class="ve">
              <span class="ve-swatch" />{{ e }}
            </span>
          </div>
          <p class="verdict-note">{{ verdict.endsLabel }} · {{ verdict.note }}</p>
        </div>
      </p-grid>

      <!-- ═══ §01 案由 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§01</span><h2 class="sec-title">{{ isEn ? 'The case' : '案由' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Before Themis the styling chain was three unrelated implementations: Web (native CSSOM), Skyline (the WeChat container), and App (whose docs said “no CSS engine”). One stylesheet, three interpretations — “looks about the same” by eye, “where it differs” found by users.'
            : '在 Themis 之前，样式链路是三套互不相干的实现：Web（原生 CSSOM）、Skyline（微信容器）、App（当时原话是「App 端无 CSS 引擎」）。同一份样式表、三个端各自解释——「看起来差不多」靠肉眼，「哪里不一样」靠用户上线后发现。' }}
        </p>
        <p-grid :min-col-width="240" :gap="14">
          <div class="end-card end-card--web" :style="{ '--stagger-i': '0' }"><span class="end-k">Web</span><span class="end-tag">{{ isEn ? 'the baseline' : '基准' }}</span><p class="end-d">{{ isEn ? 'Native CSSOM — complete, and the baseline' : '浏览器原生 CSSOM——完整，且是基准' }}</p></div>
          <div class="end-card end-card--mp" :style="{ '--stagger-i': '1' }"><span class="end-k">Skyline</span><span class="end-tag">{{ isEn ? 'rigid' : '刚性' }}</span><p class="end-d">{{ isEn ? 'WeChat container — the rigid constraint' : '微信容器——唯一刚性外部约束' }}</p></div>
          <div class="end-card end-card--app" :style="{ '--stagger-i': '2' }"><span class="end-k">App</span><span class="end-tag">{{ isEn ? 'self-drawn' : '自绘' }}</span><p class="end-d">{{ isEn ? 'Self-drawn Rust engine — the face we define' : '自研自绘 Rust 引擎——面由我们定义' }}</p></div>
        </p-grid>
      </section>

      <!-- ═══ §02 判词三条 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§02</span><h2 class="sec-title">{{ isEn ? 'Three rulings' : '判词三条' }}</h2><span class="sec-line" /></header>
        <p-grid :min-col-width="280" :gap="16">
          <div class="claim" :style="{ '--stagger-i': '0' }">
            <div class="claim-head"><span class="claim-no">01</span><span class="card-ic"><FeatureIcon name="bolt" /></span></div>
            <h3 class="claim-t">{{ isEn ? 'Compute, then ship.' : '算完，再上线。' }}</h3>
            <p class="claim-d">{{ isEn ? 'All CSS semantics are computed and computed correctly at build time. Runtime only does an O(1) table lookup and field application.' : 'CSS 的全部语义在构建期算完并算对。运行期只做 O(1) 位图查表与字段应用。' }}</p>
          </div>
          <div class="claim" :style="{ '--stagger-i': '1' }">
            <div class="claim-head"><span class="claim-no">02</span><span class="card-ic"><FeatureIcon name="target" /></span></div>
            <h3 class="claim-t">{{ isEn ? 'One truth only.' : '真值只有一个。' }}</h3>
            <p class="claim-d">{{ isEn ? 'The expected for cross-end consistency has exactly one source: the browser’s real rendering. Ends are never compared pairwise to define “correct”.' : '多端一致性的 expected 只有一个来源：Web 端浏览器真实渲染。端间互比只能用于诊断，不得定案。' }}</p>
          </div>
          <div class="claim" :style="{ '--stagger-i': '2' }">
            <div class="claim-head"><span class="claim-no">03</span><span class="card-ic"><FeatureIcon name="shield" /></span></div>
            <h3 class="claim-t">{{ isEn ? 'Fail loudly.' : '失败要响亮。' }}</h3>
            <p class="claim-d">{{ isEn ? 'Anything that cannot land consistently fails the Web build; anything that cannot be degraded equivalently is honestly rejected with a reason.' : '不能多端一致落地的写法，在 Web 构建期就报错；不能语义等价降级的字段，如实拒绝并给出原因。' }}</p>
          </div>
        </p-grid>
      </section>

      <!-- ═══ §03 审理流程 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§03</span><h2 class="sec-title">{{ isEn ? 'The hearing · five steps' : '审理流程 · 五步' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'The key design is longhand-level cascade: “margin: 0” and a later “margin-top: 5px” compete for the same property — folding at the shorthand level (what most subset engines do) cannot do this. Themis stores longhand declarations and takes the unique winner per longhand, the only way to converge to 100% against getComputedStyle.'
            : '关键设计——长手层层叠：margin: 0 与后写的 margin-top: 5px 竞争的是同一属性；在简写层折叠（多数子集引擎的做法）做不到。Themis 存长手声明、层叠后逐长手取唯一胜者——唯一能和 getComputedStyle 对拍收敛到 100% 的做法。' }}
        </p>
        <div class="pipe">
          <div class="pipe-rail">
            <div v-for="(s, i) in pipeline" :key="s.n" class="pipe-step" :style="{ '--stagger-i': String(i) }">
              <span class="pipe-n">{{ s.n }}</span>
              <span class="pipe-t">{{ s.t }}</span>
            </div>
          </div>
          <div class="pipe-out"><span class="po-arrow">▼</span><code class="po-ir">StyleIR · {{ N.ir.total }} {{ isEn ? 'fields' : '字段' }}</code></div>
          <div class="pipe-ends">
            <span class="pipe-end">Web Applier</span>
            <span class="pipe-end">Skyline Applier</span>
            <span class="pipe-end">App Applier</span>
          </div>
          <div class="pipe-gate">{{ isEn ? 'three consistency gates · all ratcheted · expected = Web' : '三层一致性门禁 · 全棘轮 · expected = Web' }}</div>
        </div>
      </section>

      <!-- ═══ §04 七项能力 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§04</span><h2 class="sec-title">{{ isEn ? 'Seven capabilities' : '七项能力' }}</h2><span class="sec-line" /></header>
        <p-grid :min-col-width="280" :gap="16">
          <div v-for="(a, i) in abilities" :key="a.t" class="ab" :style="{ '--stagger-i': String(i) }">
            <span class="card-ic"><FeatureIcon :name="a.ic" /></span>
            <h3 class="ab-t">{{ a.t }}</h3>
            <p class="ab-d">{{ a.d }}</p>
          </div>
        </p-grid>
        <!-- ★CSS 支持参考入口（用户「CSS 文档入口太深」）：七项能力 → 逐属性可查、逐能力可锚定 -->
        <p class="sec-note">
          {{ isEn ? 'Want the property-by-property detail? ' : '想看逐属性的细节？' }}
          <router-link to="/docs/reference/css-support" class="ref-link">{{ isEn ? 'Full CSS support reference — every capability, with jumpable anchors' : 'CSS 多端支持参考——每项能力都有可跳转锚点' }}</router-link>
        </p>
      </section>

      <!-- ═══ §05 卷宗数字 ═══ -->
      <section id="numbers" data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§05</span><h2 class="sec-title">{{ isEn ? 'The record · numbers' : '卷宗数字' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Every figure is recomputed from repository artifacts on every check — no hand-written numbers. Source of truth: docs/generated/css-engine-numbers.json, guarded by check:css-engine-numbers.'
            : '每个数字都在每次校验时从仓库产物重新读出——没有一个手写数字。单一事实源：docs/generated/css-engine-numbers.json（check:css-engine-numbers 守着）。' }}
        </p>
        <p-grid :min-col-width="250" :gap="14">
          <div v-for="(m, i) in metrics" :key="m.label" class="metric" :style="{ '--stagger-i': String(i) }">
            <span class="card-ic"><FeatureIcon :name="m.icon" /></span>
            <div class="metric-value"><span class="mv-num">{{ m.value }}</span><span class="mv-unit">{{ m.unit }}</span></div>
            <p class="metric-label">{{ m.label }}</p>
            <p class="metric-note">{{ m.note }}</p>
          </div>
        </p-grid>
      </section>

      <!-- ═══ §06 对照 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§06</span><h2 class="sec-title">{{ isEn ? 'Cross-examination' : '横向对照' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Other frameworks treat cross-end consistency as a wish; Themis treats it as a decidable gate. The price is a narrower CSS surface — and that is the product decision: a syntax enters the Profile not by “is it standard CSS” but by “can it land consistently across ends”.'
            : '其他框架把「跨端一致」当作愿望；Themis 当作可判定的门禁。代价是收窄了 CSS 面——这正是产品决策：一条写法是否进 Profile，判据不是「是否符合 CSS 标准」，而是「它能否多端一致地落地」。' }}
        </p>
        <div class="table">
          <div class="tr th"><span v-for="(h, i) in compareHead" :key="h" :class="{ 'col-win': i === 1 }">{{ h }}</span></div>
          <div v-for="r in compareRows" :key="r.dim" class="tr">
            <span class="td-dim">{{ r.dim }}</span>
            <span v-for="(c, i) in r.cells" :key="i" class="td" :class="{ 'col-win': i === 0 }">{{ c }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ §07 工具 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§07</span><h2 class="sec-title">{{ isEn ? 'Tools · error is the fix' : '工具 · 错误即修复指引' }}</h2><span class="sec-line" /></header>
        <div class="term">
          <div class="term-bar"><span class="tdot td-r" /><span class="tdot td-y" /><span class="tdot td-g" /><span class="term-name">build</span></div>
          <pre class="term-pre"><code>error E-CSS-004: :class {{ isEn ? 'expression cannot be statically enumerated' : '表达式无法静态枚举' }} (:class="runtimeVar")
  → Profile L5 {{ isEn ? 'forbidden. Use a finite candidate set, or converge dynamic styles to mutually-exclusive groups.' : '禁止项。改用有限候选集（对象/数组/三元字面量），或将动态样式收敛为互斥分组。' }}

warn CSE_DYNCLASS_TABLE_EXPLOSION: {{ isEn ? 'single-node table > 16 (now 23)' : '单节点动态类表 > 16（当前 23）' }}
  → {{ isEn ? 'Split the binding or merge candidate classes.' : '拆分绑定或合并候选类，减少属性维度。' }}</code></pre>
        </div>
        <div class="term">
          <div class="term-bar"><span class="tdot td-r" /><span class="tdot td-y" /><span class="tdot td-g" /><span class="term-name">proteus explain</span></div>
          <pre class="term-pre"><code>$ proteus explain --style --node page-header
margin-top: 5px    ← margin-top (style.css:42) · specificity (0,1,0) · source order wins
                     over margin (style.css:17, expanded to margin-top: 0)
                     layer: components &gt; base</code></pre>
        </div>
      </section>

      <!-- ═══ §08 边界与禁语 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§08</span><h2 class="sec-title">{{ isEn ? 'Limits & wording' : '边界与禁语' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">{{ isEn ? 'Themis writes “what it does not support” into the product docs — that itself is the biggest difference from other frameworks.' : 'Themis 把「不支持什么」写进产品文档——这本身就是与其他框架最大的不同。' }}</p>
        <p-grid :min-col-width="300" :gap="16">
          <div class="bound" :style="{ '--stagger-i': '0' }">
            <span class="bound-h">{{ isEn ? 'v1 does not do' : 'v1 不做' }}</span>
            <ul class="bound-list"><li v-for="(b, i) in notDoing" :key="i">{{ b }}</li></ul>
          </div>
          <div class="bound bound--ban" :style="{ '--stagger-i': '1' }">
            <span class="bound-h">{{ isEn ? 'Never say' : '禁语' }}</span>
            <ul class="bound-list"><li v-for="(f, i) in forbidden" :key="i">{{ f }}</li></ul>
          </div>
        </p-grid>
      </section>

      <!-- ═══ §09 四端裁决（证据） ═══ -->
      <section id="verdict" data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§09</span><h2 class="sec-title">{{ isEn ? 'The verdict · one SFC, four renderers' : '四端裁决 · 同一份 SFC，四种渲染器' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Not hand-written fixtures — the same .vue acceptance pages compiled and rendered by four real targets: browser, Android device, iOS and HarmonyOS. Each is a real engine. Same element, cropped and compared end by end.'
            : '不是手写夹具——同一批 .vue 验收页由四种真实目标编译并渲染：浏览器、Android 真机、iOS、鸿蒙。每个都是真实引擎。下面按同一元素逐端并排。' }}
        </p>
        <div v-for="set in demoSets" :key="set.slug" class="demo">
          <p class="demo-title">{{ set.title }}</p>
          <div class="shots">
            <figure v-for="s in set.shots" :key="s.pub" class="shot">
              <img class="shot-img" :src="shotUrl(s.pub)" :alt="s.label" loading="lazy" />
              <figcaption class="shot-cap">{{ s.label }}</figcaption>
            </figure>
          </div>
        </div>
        <p class="sec-note">{{ isEn ? 'Deliberately absent: any claim of pixel-perfect cross-platform identity.' : '刻意不写：任何「跨端逐像素一致」的宣称。' }}</p>
      </section>

      <!-- ═══ §10 证据链 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§10</span><h2 class="sec-title">{{ isEn ? 'Chain of evidence' : '证据链' }}</h2><span class="sec-line" /></header>
        <div class="ev">
          <div v-for="e in evidence" :key="e.v + e.gate" class="ev-row">
            <span class="ev-k">{{ e.k }}</span>
            <code class="ev-v">{{ e.v }}</code>
            <span class="ev-gate">{{ e.gate }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ 结案 ═══ -->
      <section data-reveal class="sec cta">
        <span class="cta-seal" aria-hidden="true">THEMIS</span>
        <h2 class="cta-title">{{ isEn ? 'Case heard. One verdict. Every end the same.' : '庭已审毕，一纸裁决，所有端同一个样。' }}</h2>
        <p class="cta-sub">{{ isEn ? 'Every declaration has been to court; every pixel is on the record.' : '每条声明都上过法庭，每个像素都有据可查。' }}</p>
        <div class="cta-actions">
          <router-link to="/docs/01-intro" class="btn btn-primary">{{ isEn ? 'Get started' : '开始使用' }}</router-link>
          <router-link to="/docs/reference/css-support" class="btn btn-ghost">{{ isEn ? 'CSS support reference' : 'CSS 支持参考' }}</router-link>
          <router-link to="/consistency" class="btn btn-ghost">{{ isEn ? 'Consistency standard' : '一致性标准' }}</router-link>
          <a class="btn btn-ghost" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      </section>
    </div>
  </p-page>
</template>

<style scoped>
.ce { position: relative; }
/* ★身份 1：背景 = 案卷台账纸（细横线 + 顶部微光）——非动画页的星场/放射光晕/方格网 */
.ce-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.ce-bg::before {
  content: '';
  position: absolute; top: -240px; left: 50%; transform: translateX(-50%);
  width: 900px; height: 460px;
  background: radial-gradient(50% 50% at 50% 50%, rgba(124, 92, 255, 0.14), transparent 70%);
}
.ce-ledger {
  position: absolute; inset: 0;
  background-image: repeating-linear-gradient(180deg, rgba(255, 255, 255, 0.024) 0 1px, transparent 1px 42px);
  mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.35) 42%, transparent 78%);
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.35) 42%, transparent 78%);
}
.ce-wrap { position: relative; max-width: 1160px; margin: 0 auto; padding: 92px 28px 110px; }

/* ══ Hero ══ */
.hero { align-items: center; padding-bottom: 24px; }
.hero-copy { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
.chip {
  display: flex; align-items: center; gap: 9px; width: fit-content;
  font-family: var(--mono); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--brand-ink); background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.35); border-radius: var(--radius-pill); padding: 8px 16px;
}
.hero-h1 { color: var(--ink); line-height: 1.14; letter-spacing: -0.025em; font-weight: 800; margin: 2px 0 0; }
.h1-l1 { display: block; }
.h1-l2 { display: block; font-style: normal; color: var(--brand-ink); }
.hero-lead { color: var(--muted); line-height: 1.9; max-width: 560px; font-size: 14.5px; margin: 0; }
.hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
.btn {
  display: flex; width: fit-content; align-items: center; justify-content: center;
  padding: 11px 22px; border-radius: var(--radius-md); font-size: 14.5px; font-weight: 650;
  text-decoration: none; border: 1px solid var(--line); color: var(--ink);
  transition: transform 0.18s ease, border-color 0.18s ease;
}
.btn:hover { transform: translateY(-2px); }
.btn-primary { background: var(--brand); border-color: transparent; color: #fff; box-shadow: 0 8px 26px -14px rgba(124, 92, 255, 0.9); }
.btn-ghost { background: var(--panel); }
.btn-ghost:hover { border-color: var(--brand); }
.hero-pills { display: flex; gap: 10px; flex-wrap: wrap; }
.pill { font-size: 12px; color: var(--muted); border: 1px solid var(--line); background: rgba(20, 20, 25, 0.7); border-radius: var(--radius-pill); padding: 4px 11px; }

/* ★身份 2：Hero 视觉 = 层叠裁决台（判决语义色：绿=赢 / 红=输） */
.verdict { width: 100%; max-width: 460px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: rgba(17, 17, 23, 0.9); padding: 16px; display: flex; flex-direction: column; gap: 9px; }
.verdict-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid var(--line-soft); }
.vh-title { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.08em; color: var(--muted); }
.vh-seal { font-family: var(--mono); font-size: 10px; letter-spacing: 0.2em; color: var(--brand-ink); border: 1px solid rgba(124, 92, 255, 0.4); border-radius: var(--radius-chip); padding: 2px 7px; }
.decl { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid var(--line-soft); border-left: 2px solid var(--dim); border-radius: var(--radius-sm); background: rgba(11, 11, 15, 0.5); }
.decl.win { border-left-color: var(--ok); background: rgba(61, 220, 151, 0.06); }
.decl-mark { font-size: 12px; color: var(--rec); width: 12px; }
.decl.win .decl-mark { color: var(--ok); }
.decl-body { flex: 1; min-width: 0; }
.decl-line { display: flex; align-items: baseline; gap: 8px; }
.decl-sel { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); }
.decl-prop { font-family: var(--mono); font-size: 12px; color: var(--ink); text-decoration: line-through; text-decoration-color: var(--rec); }
.decl.win .decl-prop { text-decoration: none; }
.decl-meta { display: flex; gap: 10px; margin-top: 3px; }
.meta-i { font-family: var(--mono); font-size: 10px; color: var(--dim); }
.decl-verdict { font-size: 10.5px; color: var(--rec); font-family: var(--mono); }
.decl.win .decl-verdict { color: var(--ok); }
.verdict-out { display: flex; align-items: center; gap: 9px; padding: 4px 2px; }
.vo-arrow { color: var(--ok); font-size: 11px; }
.vo-label { font-size: 11px; color: var(--muted); }
.vo-code { font-family: var(--mono); font-size: 12px; color: var(--ok); background: rgba(61, 220, 151, 0.1); border-radius: var(--radius-sm); padding: 3px 9px; }
.verdict-ends { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.ve { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); font-size: 10.5px; color: var(--muted); }
.ve-swatch { width: 100%; height: 22px; border-radius: 6px; background: var(--brand); }
.verdict-note { font-size: 10.5px; color: var(--dim); line-height: 1.6; margin: 2px 0 0; }

/* ══ 分节：§ 案号标头（身份 3） ══ */
.sec { margin-top: 108px; }
.sec-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; }
.sec-k { font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: var(--brand-ink); }
.sec-title { color: var(--ink); font-size: 24px; font-weight: 800; letter-spacing: -0.015em; margin: 0; }
.sec-line { flex: 1; height: 1px; background: var(--line); align-self: center; }
.sec-note { color: var(--muted); font-size: 14px; line-height: 1.85; margin: 0 0 24px; max-width: 860px; }
/* ★CSS 支持参考入口（首屏/§04 深链）：品牌色下划线强调——与正文 note 区分 */
.ref-link { color: var(--brand); font-weight: 600; text-decoration: none; border-bottom: 1px solid rgba(124, 92, 255, 0.4); transition: border-color 0.15s, color 0.15s; }
.ref-link:hover { color: var(--brand-ink); border-bottom-color: var(--brand); }
[data-reveal] { opacity: 0; transform: translateY(18px); transition: opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1), transform 0.65s cubic-bezier(0.22, 1, 0.36, 1); }
[data-reveal].revealed { opacity: 1; transform: none; }
.card-ic { display: flex; width: 34px; height: 34px; align-items: center; justify-content: center; border-radius: 10px; color: var(--brand-ink); background: var(--brand-soft); border: 1px solid rgba(124, 92, 255, 0.3); }
/* ★身份 4：卡片 = 案卷记录（hairline + 左判词竖线），非渐变面板 + 紫光 hover */
.claim, .ab, .metric, .end-card, .bound {
  opacity: 0; transform: translateY(14px);
  transition: opacity 0.55s ease, transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1), border-color 0.18s ease;
  transition-delay: calc(var(--stagger-i, 0) * 60ms);
}
[data-reveal].revealed .claim, [data-reveal].revealed .ab, [data-reveal].revealed .metric,
[data-reveal].revealed .end-card, [data-reveal].revealed .bound { opacity: 1; transform: none; }
.claim, .ab { position: relative; padding: 24px 22px 24px 24px; border: 1px solid var(--line); border-left: 2px solid rgba(124, 92, 255, 0.5); border-radius: var(--radius-md); background: var(--panel); }
.claim:hover, .ab:hover, .metric:hover { transform: translateY(-2px); border-left-color: var(--brand); }
.claim-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.claim-no { font-family: var(--mono); font-size: 12px; letter-spacing: 0.1em; color: var(--dim); }
.claim-t, .ab-t { color: var(--ink); font-size: 16px; margin: 2px 0 8px; }
.claim-d, .ab-d { color: var(--muted); font-size: 13px; line-height: 1.8; margin: 0; }

.end-card { display: flex; flex-direction: column; gap: 6px; padding: 20px 20px 20px 22px; border: 1px solid var(--line); border-left-width: 2px; border-radius: var(--radius-md); background: var(--panel); }
.end-card--web { border-left-color: var(--brand); }
.end-card--mp { border-left-color: var(--warn); }
.end-card--app { border-left-color: var(--ok); }
.end-k { color: var(--ink); font-size: 16px; font-weight: 800; }
.end-tag { font-size: 11px; color: var(--muted); font-family: var(--mono); }
.end-d { color: var(--muted); font-size: 12.5px; line-height: 1.6; margin: 4px 0 0; }

.metric { display: flex; flex-direction: column; gap: 8px; padding: 22px 22px 22px 24px; border: 1px solid var(--line); border-left: 2px solid rgba(124, 92, 255, 0.5); border-radius: var(--radius-md); background: var(--panel); }
.metric-value { display: flex; align-items: baseline; gap: 7px; }
.mv-num { color: var(--ink); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
.mv-unit { color: var(--dim); font-size: 11.5px; font-family: var(--mono); }
.metric-label { color: var(--ink); font-size: 12.5px; font-weight: 700; margin: 0; }
.metric-note { color: var(--muted); font-size: 11.5px; line-height: 1.55; margin: 0; }

/* ══ 管线 ══ */
.pipe { display: flex; flex-direction: column; gap: 10px; padding: 22px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--panel); }
.pipe-rail { display: flex; flex-direction: column; }
.pipe-step { display: flex; align-items: baseline; gap: 14px; padding: 12px 4px; border-bottom: 1px dashed var(--line-soft); }
.pipe-step:last-child { border-bottom: none; }
.pipe-n { font-family: var(--mono); font-size: 12px; font-weight: 800; color: var(--brand-ink); }
.pipe-t { color: var(--ink); font-size: 13px; }
.pipe-out { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 0; }
.po-arrow { color: var(--ok); font-size: 11px; }
.po-ir { font-family: var(--mono); font-size: 12px; color: var(--ok); background: rgba(61, 220, 151, 0.1); border-radius: var(--radius-pill); padding: 5px 14px; }
.pipe-ends { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.pipe-end { text-align: center; font-size: 12.5px; font-weight: 700; color: var(--ink); background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 11px 6px; }
.pipe-gate { text-align: center; font-size: 12px; font-weight: 700; color: var(--brand-ink); background: var(--brand-soft); border-radius: var(--radius-pill); padding: 8px 14px; }

/* ══ 对照表 ══ */
.table { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; }
.tr { display: grid; grid-template-columns: 1.15fr 1.75fr 1.15fr 1.15fr 1.25fr; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--line); background: var(--panel); }
.tr:first-child { border-top: none; }
.th { background: var(--panel2); color: var(--brand-ink); font-size: 11.5px; font-weight: 800; letter-spacing: 0.3px; }
.td-dim { color: var(--ink); font-size: 12.5px; font-weight: 700; }
.td { color: var(--muted); font-size: 11.5px; line-height: 1.6; }
.col-win { color: var(--ink); font-weight: 600; }

/* ══ 终端（macOS 窗口 chrome） ══ */
.term { margin-bottom: 14px; border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; background: var(--panel2); }
.term-bar { display: flex; align-items: center; gap: 7px; padding: 9px 14px; background: rgba(11, 11, 15, 0.6); border-bottom: 1px solid var(--line); }
.tdot { width: 11px; height: 11px; border-radius: 50%; flex: none; display: block; }
.td-r { background: #ff5f57; } .td-y { background: #febc2e; } .td-g { background: #28c840; }
.term-name { font-family: var(--mono); font-size: 11px; color: var(--dim); margin-left: 8px; }
.term-pre { margin: 0; padding: 14px 16px; overflow-x: auto; }
.term-pre code { font-family: var(--mono); font-size: 12px; line-height: 1.75; color: var(--ink); white-space: pre; }

/* ══ 边界 ══ */
.bound { padding: 20px 20px 20px 22px; border: 1px solid var(--line); border-left: 2px solid rgba(124, 92, 255, 0.5); border-radius: var(--radius-md); background: var(--panel); }
.bound--ban { border-left-color: var(--rec); }
.bound-h { color: var(--ink); font-size: 13.5px; font-weight: 800; }
.bound-list { margin: 10px 0 0; padding-left: 18px; color: var(--muted); font-size: 12.5px; line-height: 1.75; }
.bound-list li { margin-bottom: 7px; }
.bound--ban .bound-list li { color: var(--rec); }

/* ══ 多端证据 ══ */
.demo { margin-bottom: 20px; }
.demo-title { color: var(--ink); font-size: 13px; font-weight: 700; margin: 0 0 12px; }
.shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.shot { margin: 0; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.shot-img { width: 100%; max-height: 560px; object-fit: cover; object-position: top; border-radius: var(--radius-lg); border: 1px solid var(--line); background: var(--panel2); }
.shot-cap { color: var(--muted); font-size: 11.5px; text-align: center; }

/* ══ 证据链 ══ */
.ev { display: flex; flex-direction: column; gap: 8px; }
.ev-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; padding: 11px 15px; border: 1px solid var(--line); border-left: 2px solid rgba(124, 92, 255, 0.4); border-radius: var(--radius-sm); background: var(--panel); transition: border-left-color 0.18s ease; }
.ev-row:hover { border-left-color: var(--brand); }
.ev-k { color: var(--ink); font-size: 12.5px; min-width: 300px; }
.ev-v { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); background: var(--panel2); border-radius: var(--radius-sm); padding: 2px 8px; }
.ev-gate { color: var(--muted); font-size: 10.5px; font-family: var(--mono); }

/* ══ 结案（seal 风，非光晕 CTA） ══ */
.cta { position: relative; text-align: center; padding: 52px 28px; border: 1px solid var(--line); border-top: 2px solid var(--brand); border-radius: var(--radius-lg); background: var(--panel); }
.cta-seal { display: block; font-family: var(--mono); font-size: 11px; letter-spacing: 0.34em; color: var(--brand-ink); margin-bottom: 16px; }
.cta-title { color: var(--ink); font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 10px; }
.cta-sub { color: var(--muted); font-size: 14px; margin: 0 0 22px; }
.cta-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
</style>
