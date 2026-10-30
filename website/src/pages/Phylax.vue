<script setup lang="ts">
// website/src/pages/Phylax.vue —— ★★★Phylax：请求治理层 · 产品页（#1394）
//
// 【★为什么它必须和 /themis、/animation 平级，而不是藏在 /docs/system/ 里】
//   用户原话：「请求库是我们的框架衍生产品体系中的，和动画引擎、CSS 引擎、图标库这些是同等地位的」
//   「正式产品页一般都是沉浸式通栏那种啊，不是这种在柔性系统里面隐藏起来」。
//   ⇒ 引擎产品线的结构是：每个产品 = **独立路由 + 导航并列 + 自己的视觉语言 + 自己的 codename**。
//     动画 = Kairos(/animation) · CSS = Themis(/themis) · 玻璃 = Aether(/liquid-glass) ·
//     图标 = Keryx(/icons) · **请求治理 = Phylax(/phylax)**。文档仍在 /docs/*，两处职责分开。
//
// 【Phylax 是谁】φύλαξ = 古希腊的守卫/守备官。本层不"替你把请求发出去"（那是传输层），
//   而是守住边界、验明身份、留下记录 —— 视觉语言因此是 **哨卡（Checkpoint）**：
//     · 背景 = **关卡闸门**（横向栅线 + 一道竖向光缝），不是 Themis 的案卷横线纸、也不是动画页的星场；
//     · 分节 = **`CP-01` 哨位标头**（mono），不是 § 案号；
//     · 卡片 = **闸门票据**（左侧一条通行/拦截色带），不是案卷判词竖线；
//     · Hero 视觉 = **三态闸门**（一个请求走到闸口，被判定为 pass / reject / hold 三种放行结果），
//       直接演示本层的核心动作，而不是装饰图形。
//   ★配色沿用仓内单品牌纪律（`--brand` 紫）；三态语义色（ok green / rec red / warn amber）是本页签名。
//
// 【★数据纪律】页面**没有一个手写数字** —— 全部来自 `../data/request-engine-page`
//   （由 `website/scripts/gen-request-engine-data.mjs` 从 `docs/generated/request-engine-numbers.json` 读出，
//   后者由 `scripts/gen-request-engine-numbers.mjs` **数**测试文件里的 `it(` 得出）。
//   防漂移：`pnpm check:request-engine-data` / `check:request-engine-numbers`。
//
// 【D-2 门禁】零 @media · 三方 UI · 裸平台 API；布局一律落在原生 div/section
//   （`p-view` 默认 `flex-direction:column` 会盖掉行布局）。卡片网格用 `p-grid`（auto-fit）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'
import { REQUEST_ENGINE_PAGE as D } from '../data/request-engine-page'

const isEn = computed(() => locale.value === 'en')
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

/* ── Hero 视觉：三态闸门（一个请求走到闸口 → 三种放行结果） ── */
const gate = computed(() => {
  const zh = !isEn.value
  return {
    reqLabel: zh ? '一个请求到达闸口' : 'A request reaches the gate',
    checks: zh
      ? ['域名在白名单内？', '业务配额未满？', '方法允许重试？', '身份头参与去重？']
      : ['Domain allowlisted?', 'Quota available?', 'Method retryable?', 'Identity in dedupe key?'],
    lanes: [
      { tone: 'ok', label: zh ? '放行' : 'PASS', text: zh ? 'success · 确定成功' : 'success · definitely succeeded' },
      { tone: 'bad', label: zh ? '拦下' : 'REJECT', text: zh ? 'failed · 确定失败，可重试' : 'failed · never processed, retry safe' },
      { tone: 'warn', label: zh ? '挂账' : 'HOLD', text: zh ? 'unknown · 可能已生效，去查单' : 'unknown · may have landed, reconcile' },
    ],
    note: zh
      ? '判不出来时保守挂账（unknown）——宁可多查一次单，不能重复扣款'
      : 'When we cannot tell, we hold it as unknown — one extra reconciliation beats one duplicate charge',
  }
})

/* ── 机器数字（原样来自 SSOT，一个都不手写） ── */
const metrics = computed(() => {
  const c = N.criteria
  const zh = !isEn.value
  return [
    { icon: 'shield', value: String(c.total), unit: zh ? '条判据' : 'criteria', label: zh ? '可执行判据总数' : 'Executable criteria', note: zh ? `${c.files} 组 · 数自测试文件的 it(` : `${c.files} groups · counted from it( in test files` },
    { icon: 'target', value: String(N.painPoints.answered), unit: zh ? '条痛点' : 'pain points', label: zh ? '各有答案' : 'Each with an answer', note: zh ? '不是"又一个 axios"——是治理层' : 'Not "another axios" — a governance layer' },
    { icon: 'bolt', value: String(N.outcomes.states.length), unit: zh ? '态' : 'states', label: zh ? '结果三态' : 'Tri-state outcome', note: zh ? 'success / failed / unknown' : 'success / failed / unknown' },
    { icon: 'layers', value: String(N.packages.kernel.files.length + N.packages.vueLayer.files.length), unit: zh ? '源文件' : 'source files', label: zh ? '内核 + 产品层' : 'Kernel + product layer', note: zh ? '内核零 vue 依赖 · 产品层 vue 为 peer' : 'kernel has zero Vue · layer has vue as peer' },
    { icon: 'chart', value: N.channels.websocket ? '2' : '1', unit: zh ? '条通道' : 'channels', label: zh ? '共用同一套策略链' : 'Sharing one policy chain', note: zh ? 'HTTP + WebSocket' : 'HTTP + WebSocket' },
    { icon: 'box', value: String(N.criteria.groups.find((g) => g.file.includes('vue-composables'))?.count ?? 0), unit: zh ? '条' : 'criteria', label: zh ? 'Vue 产品层判据' : 'Vue layer criteria', note: zh ? '含真 watchEffect 响应式验证' : 'incl. real watchEffect reactivity check' },
  ]
})

const groups = computed(() => N.criteria.groups)
const boundaries = computed(() => D.boundaries)
const layers = computed(() => D.layers)
</script>

<template>
  <p-page ref="rootEl" class="px">
    <!-- 背景层：关卡闸门（横向栅线 + 一道竖向光缝）——区别于 Themis 的案卷横线纸 -->
    <div class="px-bg" aria-hidden="true"><span class="px-gate" /><span class="px-slit" /></div>

    <div class="px-wrap">
      <!-- ═══ Hero（通栏：文案 + 三态闸门） ═══ -->
      <p-grid :min-col-width="380" :gap="52" class="hero">
        <div class="hero-copy">
          <span class="chip"><FeatureIcon name="shield" />{{ isEn ? 'REQUEST GOVERNANCE LAYER' : '请求治理层' }} · {{ D.codename.toUpperCase() }}</span>
          <h1 class="hero-h1">
            <span class="h1-l1">{{ isEn ? 'Every request passes a checkpoint.' : '每个请求，都过一道哨卡。' }}</span>
            <span class="h1-l2">{{ isEn ? 'Not every answer is success or failure.' : '不是每个答案，都只有成功和失败。' }}</span>
          </h1>
          <p class="hero-lead">
            {{ isEn
              ? 'Phylax is the governance layer for outbound requests: tri-state outcomes, idempotency, circuit breaking, offline queue, audit and multi-tenant isolation — enforced identically on HTTP and WebSocket. The kernel is platform-neutral; the Vue layer makes it reactive.'
              : 'Phylax 是出网请求的治理层：三态结果、幂等、熔断、离线队列、审计、多业务隔离——HTTP 与 WebSocket 两条通道同一套策略链。内核平台中立，Vue 层负责让它变成响应式。' }}
          </p>
          <div class="hero-cta">
            <a href="#gate" class="btn btn-primary">{{ isEn ? 'See the three lanes' : '看三态闸门' }}</a>
            <router-link to="/docs/system/14-request-quickstart" class="btn btn-ghost">{{ isEn ? 'Cookbook · zero to first request' : '使用手册 · 从零到跑通' }}</router-link>
            <router-link to="/docs/system/13-request-governance" class="btn btn-ghost">{{ isEn ? 'Design rationale' : '设计理由' }}</router-link>
          </div>
          <div class="hero-pills">
            <span class="pill">{{ N.criteria.total }} {{ isEn ? 'criteria' : '条判据' }}</span>
            <span class="pill">{{ isEn ? 'tri-state · unknown ≠ failure' : '三态 · unknown ≠ 失败' }}</span>
            <span class="pill">{{ isEn ? 'HTTP + WS · one policy chain' : 'HTTP + WS · 同一策略链' }}</span>
          </div>
        </div>

        <!-- 三态闸门 -->
        <div id="gate" class="gate">
          <div class="gate-head">
            <span class="gh-title">{{ gate.reqLabel }}</span>
            <span class="gh-seal">{{ D.codename.toUpperCase() }}</span>
          </div>
          <div class="gate-checks">
            <span v-for="(c, i) in gate.checks" :key="i" class="gk"><span class="gk-dot" />{{ c }}</span>
          </div>
          <div class="gate-lanes">
            <div v-for="l in gate.lanes" :key="l.tone" class="lane" :class="{ 'lane--ok': l.tone === 'ok', 'lane--bad': l.tone === 'bad', 'lane--warn': l.tone === 'warn' }">
              <span class="lane-tag">{{ l.label }}</span>
              <span class="lane-text">{{ l.text }}</span>
            </div>
          </div>
          <p class="gate-note">{{ gate.note }}</p>
        </div>
      </p-grid>

      <!-- ═══ CP-01 三个不可让步的判断 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-01</span><h2 class="sec-title">{{ isEn ? 'Three non-negotiables' : '三个不可让步的判断' }}</h2><span class="sec-line" /></header>
        <p-grid :min-col-width="280" :gap="16">
          <div v-for="(c, i) in D.claims" :key="c.no" class="claim" :style="{ '--stagger-i': String(i) }" :class="{ 'claim--ok': i === 0, 'claim--bad': i === 1, 'claim--warn': i === 2 }">
            <div class="claim-head"><span class="claim-no">{{ c.no }}</span><span class="card-ic"><FeatureIcon :name="i === 0 ? 'bolt' : i === 1 ? 'layers' : 'shield'" /></span></div>
            <h3 class="claim-t">{{ isEn ? c.en : c.zh }}</h3>
            <p class="claim-d">{{ isEn ? c.bodyEn : c.bodyZh }}</p>
          </div>
        </p-grid>
      </section>

      <!-- ═══ CP-02 三态 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-02</span><h2 class="sec-title">{{ isEn ? 'Three outcomes, not two' : '三态，而不是两态' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Most request libraries give you success or error. For a payment, a timeout is neither: the request may have landed. Treating it as failure and retrying is how you charge twice. So the third state exists, and it is the design starting point of this whole layer.'
            : '多数请求库只给你成功或失败。而对支付来说，超时两者都不是——请求可能已经落地了。把它当失败然后重试，就是重复扣款。所以第三个状态必须存在，而它正是整层的设计起点。' }}
        </p>
        <p-grid :min-col-width="250" :gap="14">
          <div v-for="(o, i) in D.outcomes" :key="o.id" class="oc" :class="{ 'oc--ok': o.tone === 'ok', 'oc--bad': o.tone === 'bad', 'oc--warn': o.tone === 'warn' }" :style="{ '--stagger-i': String(i) }">
            <span class="oc-id">{{ o.id }}</span>
            <h3 class="oc-t">{{ isEn ? o.en : o.zh }}</h3>
            <p class="oc-hint">{{ isEn ? o.enHint : o.zhHint }}</p>
          </div>
        </p-grid>
      </section>

      <!-- ═══ CP-03 两条通道 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-03</span><h2 class="sec-title">{{ isEn ? 'One policy chain, two channels' : '一套策略链，两条通道' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Hardening only HTTP is the industry\'s most common vulnerability shape: the business switches one API call and bypasses everything. A WebSocket looks like "just a connection" in the audit log while being able to send and receive indefinitely.'
            : '加固只做在 HTTP 上是行业里最常见的漏洞形态：业务换一个 API 就绕过了全部。而 WebSocket 在审计里看着"只是条连接"，却能无限期收发——最适合把数据悄悄外传。' }}
        </p>
        <div class="table">
          <div class="tr th"><span>{{ isEn ? 'Policy' : '策略' }}</span><span>HTTP</span><span>WebSocket</span></div>
          <div v-for="r in D.channelRows" :key="r.en" class="tr">
            <span class="td-dim">{{ isEn ? r.en : r.zh }}</span>
            <span class="td" :class="r.http ? 'td-yes' : 'td-no'">{{ r.http ? '✓' : '—' }}</span>
            <span class="td" :class="r.ws ? 'td-yes' : 'td-no'">{{ r.ws ? '✓' : '—' }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ CP-04 三层结构 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-04</span><h2 class="sec-title">{{ isEn ? 'Three layers, split on purpose' : '三层，刻意分开' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Why reactivity is a separate package: the kernel must run in Mini Program logic layers and Node, where there is no Vue. Embedding Vue would kill that. Template re-rendering is Vue-specific, so it lives one layer up.'
            : '为什么响应式要单独成包：内核要能跑在小程序逻辑层和 Node——那里没有 Vue。把 Vue 塞进去就废了这个能力。而"模板自动重渲染"是 Vue 特有的，所以它在上层。' }}
        </p>
        <div class="layers">
          <div v-for="(l, i) in layers" :key="l.en" class="layer" :style="{ '--stagger-i': String(i) }">
            <div class="layer-head">
              <code class="layer-name">{{ isEn ? l.en : l.zh }}</code>
              <span class="layer-role">{{ isEn ? l.enRole : l.zhRole }}</span>
            </div>
            <p class="layer-what">{{ isEn ? l.enWhat : l.zhWhat }}</p>
            <span v-if="i < layers.length - 1" class="layer-arrow">▼</span>
          </div>
        </div>
      </section>

      <!-- ═══ CP-05 判据账本（数字全部来自 SSOT） ═══ -->
      <section id="numbers" data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-05</span><h2 class="sec-title">{{ isEn ? 'The ledger · criteria' : '判据账本' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Every figure below is read out of the repository on every check — no hand-written numbers. The criteria count is literally counted from it( in the test files. Source of truth: docs/generated/request-engine-numbers.json.'
            : '下面的每个数字都在每次校验时从仓库重新读出——没有一个手写数字。「判据条数」是真的去数测试文件里的 it(。单一事实源：docs/generated/request-engine-numbers.json。' }}
        </p>
        <p-grid :min-col-width="250" :gap="14">
          <div v-for="(m, i) in metrics" :key="m.label" class="metric" :style="{ '--stagger-i': String(i) }">
            <span class="card-ic"><FeatureIcon :name="m.icon" /></span>
            <div class="metric-value"><span class="mv-num">{{ m.value }}</span><span class="mv-unit">{{ m.unit }}</span></div>
            <p class="metric-label">{{ m.label }}</p>
            <p class="metric-note">{{ m.note }}</p>
          </div>
        </p-grid>

        <!-- 分组明细：每组守什么 -->
        <div class="table ledger">
          <div class="tr th"><span>{{ isEn ? 'Group' : '分组' }}</span><span class="num-col">{{ isEn ? 'Criteria' : '判据' }}</span><span>{{ isEn ? 'What it guards' : '守什么' }}</span></div>
          <div v-for="g in groups" :key="g.file" class="tr">
            <span class="td-dim">{{ isEn ? g.en : g.zh }}</span>
            <span class="td num-col">{{ g.count }}</span>
            <span class="td td-what">{{ isEn ? g.whatEn : g.what }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ CP-06 代码：同一个请求，三种处置 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-06</span><h2 class="sec-title">{{ isEn ? 'The same request, three decisions' : '同一个请求，三种处置' }}</h2><span class="sec-line" /></header>
        <div class="term">
          <div class="term-bar"><span class="tdot td-r" /><span class="tdot td-y" /><span class="tdot td-g" /><span class="term-name">order.ts</span></div>
          <pre class="term-pre"><code>const r = await client.post('/order', data)

if (r.ok) return done()

if (r.outcome === 'failed') {
  // {{ isEn ? 'definitely not processed — retry is safe (with an idempotency key)' : '确定没被处理 —— 可以重试（带幂等键）' }}
  return retryWithIdempotencyKey()
}

// {{ isEn ? 'unknown: it may have landed. Do NOT retry — reconcile.' : 'unknown：可能已经落地了。**不要重试** —— 去查单。' }}
await refreshOrders()
routeTo('/orders?pending=1')</code></pre>
        </div>
        <div class="term">
          <div class="term-bar"><span class="tdot td-r" /><span class="tdot td-y" /><span class="tdot td-g" /><span class="term-name">TodoList.vue</span></div>
          <pre class="term-pre"><code>{{ isEn ? '// Vue layer: reactive by construction — the template re-renders' : '// Vue 层：天然响应式 —— 模板会自己重渲染' }}
const todos = useQuery&lt;Todo[]&gt;('/api/todos')

const create = useMutation&lt;Todo, { title: string }&gt;('/api/todos', {
  optimistic: (v) =&gt; ({ id: 'tmp', title: v.title, done: false }),
  onError: (_e, outcome) =&gt; {
    // {{ isEn ? 'unknown is kept, not rolled back: it may have been created' : 'unknown 不回滚：可能已经创建成功了' }}
    if (outcome === 'unknown') toast('{{ isEn ? 'Result unknown — refresh to confirm' : '结果未知，请刷新确认' }}')
  },
})</code></pre>
        </div>
      </section>

      <!-- ═══ CP-07 边界 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">CP-07</span><h2 class="sec-title">{{ isEn ? 'Boundaries · what it does not do' : '边界 · 它不做什么' }}</h2><span class="sec-line" /></header>
        <div class="bounds">
          <div v-for="(b, i) in boundaries" :key="i" class="bound" :style="{ '--stagger-i': String(i) }">
            <span class="bound-mark">—</span>
            <p class="bound-t">{{ isEn ? b.en : b.zh }}</p>
          </div>
        </div>
        <p class="sec-note">
          {{ isEn
            ? 'The last one matters most: the tri-state model exists to make the need to reconcile visible, not to reconcile on the business\'s behalf. A business that treats unknown as failed will still double-charge with the best library underneath.'
            : '最后一条最重要：三态模型的价值是让业务**看见**该去查单，不是替业务去查。把 unknown 当 failed 处理的业务，用再好的库也还是会重复下单。' }}
        </p>
      </section>

      <!-- ═══ 出口 ═══ -->
      <section data-reveal class="sec sec--end">
        <header class="sec-head"><span class="sec-k">OUT</span><h2 class="sec-title">{{ isEn ? 'Go further' : '继续深入' }}</h2><span class="sec-line" /></header>
        <div class="outs">
          <router-link v-for="l in D.links" :key="l.to" :to="l.to" class="out">
            <span class="out-t">{{ isEn ? l.en : l.zh }}</span>
            <span class="out-arrow">→</span>
          </router-link>
        </div>
        <p class="end-note">
          {{ isEn ? D.codenameNote : D.codenameNote }}
        </p>
      </section>
    </div>
  </p-page>
</template>

<style scoped>
/* ══════════════════ 背景：关卡闸门 ══════════════════ */
.px { position: relative; }
.px-bg { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
/* 横向栅线（关卡地面） */
.px-gate {
  position: absolute; inset: 0;
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0 39px,
    rgba(255, 255, 255, 0.028) 39px 40px
  );
  mask-image: radial-gradient(ellipse 90% 70% at 50% 12%, #000 20%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 50% 12%, #000 20%, transparent 78%);
}
/* 竖向光缝（闸口） */
.px-slit {
  position: absolute; left: 50%; top: 0; width: 1px; height: 62vh; transform: translateX(-50%);
  background: linear-gradient(to bottom, transparent, var(--brand) 22%, rgba(124, 92, 255, 0.25) 62%, transparent);
  opacity: 0.5;
}
.px-wrap { position: relative; display: flex; flex-direction: column; gap: 92px; padding: 72px 24px 120px; max-width: 1180px; margin: 0 auto; }

/* ══════════════════ Hero ══════════════════ */
.hero { align-items: center; }
.hero-copy { display: flex; flex-direction: column; gap: 18px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; align-self: flex-start;
  padding: 5px 11px; border-radius: 999px; font-size: 11px; letter-spacing: 0.08em;
  color: var(--brand-ink); background: var(--brand-soft); border: 1px solid rgba(124, 92, 255, 0.28);
}
.hero-h1 { display: flex; flex-direction: column; gap: 8px; margin: 0; font-size: clamp(28px, 4vw, 46px); line-height: 1.18; letter-spacing: -0.02em; }
.h1-l1 { color: var(--ink); }
.h1-l2 { color: var(--brand-ink); }
.hero-lead { margin: 0; color: rgba(244, 244, 247, 0.72); font-size: 15px; line-height: 1.75; max-width: 60ch; }
.hero-cta { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; }
.btn { display: inline-flex; align-items: center; padding: 9px 18px; border-radius: 10px; font-size: 13.5px; text-decoration: none; border: 1px solid transparent; transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease; }
.btn-primary { background: var(--brand); color: #fff; }
.btn-primary:hover { transform: translateY(-1px); background: #8b6dff; }
.btn-ghost { color: var(--brand-ink); border-color: rgba(124, 92, 255, 0.32); background: rgba(124, 92, 255, 0.06); }
.btn-ghost:hover { border-color: var(--brand); background: rgba(124, 92, 255, 0.13); }
.hero-pills { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; }
.pill { padding: 4px 10px; border-radius: 999px; font-size: 11.5px; color: rgba(244, 244, 247, 0.62); border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.025); }

/* ── 三态闸门 ── */
.gate {
  display: flex; flex-direction: column; gap: 14px; padding: 20px 20px 18px;
  border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.09);
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012));
  box-shadow: 0 24px 60px -32px rgba(0, 0, 0, 0.9);
}
.gate-head { display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
.gh-title { font-size: 12px; letter-spacing: 0.06em; color: rgba(244, 244, 247, 0.56); }
.gh-seal { font-size: 10.5px; letter-spacing: 0.22em; color: var(--brand-ink); opacity: 0.8; }
.gate-checks { display: flex; flex-direction: column; gap: 7px; padding: 12px; border-radius: 10px; background: rgba(0, 0, 0, 0.24); border: 1px solid rgba(255, 255, 255, 0.055); }
.gk { display: flex; flex-direction: row; align-items: center; gap: 9px; font-size: 12.5px; color: rgba(244, 244, 247, 0.74); }
.gk-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--brand); opacity: 0.8; flex: none; }
.gate-lanes { display: flex; flex-direction: column; gap: 8px; }
.lane { display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 11px 13px; border-radius: 10px; border-left: 3px solid transparent; }
.lane--ok { background: rgba(61, 220, 151, 0.085); border-left-color: var(--ok); }
.lane--bad { background: rgba(255, 107, 107, 0.075); border-left-color: var(--rec); }
.lane--warn { background: rgba(255, 180, 84, 0.095); border-left-color: var(--warn); }
.lane-tag { font-size: 10.5px; font-weight: 600; letter-spacing: 0.14em; flex: none; }
.lane--ok .lane-tag { color: var(--ok); }
.lane--bad .lane-tag { color: var(--rec); }
.lane--warn .lane-tag { color: var(--warn); }
.lane-text { font-size: 12.5px; color: rgba(244, 244, 247, 0.78); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.gate-note { margin: 2px 0 0; font-size: 11.5px; line-height: 1.6; color: rgba(255, 180, 84, 0.82); }

/* ══════════════════ 分节 ══════════════════ */
.sec { display: flex; flex-direction: column; gap: 20px; }
.sec-head { display: flex; flex-direction: row; align-items: center; gap: 14px; }
.sec-k { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; letter-spacing: 0.16em; color: var(--brand-ink); opacity: 0.85; flex: none; }
.sec-title { margin: 0; font-size: clamp(19px, 2.2vw, 25px); color: var(--ink); letter-spacing: -0.01em; }
.sec-line { flex: 1; height: 1px; background: linear-gradient(to right, rgba(124, 92, 255, 0.28), transparent); }
.sec-note { margin: 0; font-size: 14px; line-height: 1.8; color: rgba(244, 244, 247, 0.66); max-width: 82ch; }

/* ── 判断卡 ── */
.claim { display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.022); border-left: 3px solid transparent; }
.claim--ok { border-left-color: var(--ok); }
.claim--bad { border-left-color: var(--rec); }
.claim--warn { border-left-color: var(--warn); }
.claim-head { display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
.claim-no { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: 0.16em; color: rgba(244, 244, 247, 0.42); }
.card-ic { display: inline-flex; width: 26px; height: 26px; align-items: center; justify-content: center; border-radius: 8px; background: var(--brand-soft); color: var(--brand-ink); font-size: 13px; }
.claim-t { margin: 0; font-size: 16px; color: var(--ink); line-height: 1.45; }
.claim-d { margin: 0; font-size: 13px; line-height: 1.75; color: rgba(244, 244, 247, 0.64); }

/* ── 三态卡 ── */
.oc { display: flex; flex-direction: column; gap: 7px; padding: 20px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.022); border-top: 3px solid transparent; }
.oc--ok { border-top-color: var(--ok); }
.oc--bad { border-top-color: var(--rec); }
.oc--warn { border-top-color: var(--warn); }
.oc-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; letter-spacing: 0.08em; }
.oc--ok .oc-id { color: var(--ok); }
.oc--bad .oc-id { color: var(--rec); }
.oc--warn .oc-id { color: var(--warn); }
.oc-t { margin: 0; font-size: 15px; color: var(--ink); }
.oc-hint { margin: 0; font-size: 12.5px; line-height: 1.7; color: rgba(244, 244, 247, 0.6); }

/* ── 表格 ── */
.table { display: flex; flex-direction: column; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.075); overflow: hidden; }
.tr { display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 12px; padding: 12px 16px; font-size: 13px; align-items: center; }
.ledger .tr { grid-template-columns: 0.9fr 0.24fr 2.2fr; }
.tr.th { background: rgba(255, 255, 255, 0.04); color: rgba(244, 244, 247, 0.55); font-size: 11.5px; letter-spacing: 0.06em; }
.tr:not(.th) { border-top: 1px solid rgba(255, 255, 255, 0.05); color: rgba(244, 244, 247, 0.8); }
.td-dim { color: rgba(244, 244, 247, 0.72); }
.td { text-align: center; }
.num-col { text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--brand-ink); }
.td-what { text-align: left; font-size: 12.5px; line-height: 1.65; color: rgba(244, 244, 247, 0.6); }
.td-yes { color: var(--ok); }
.td-no { color: rgba(255, 107, 107, 0.72); }

/* ── 三层 ── */
.layers { display: flex; flex-direction: column; gap: 0; }
.layer { position: relative; display: flex; flex-direction: column; gap: 7px; padding: 16px 18px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.022); margin-bottom: 26px; }
.layer:last-child { margin-bottom: 0; }
.layer-head { display: flex; flex-direction: row; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.layer-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; color: var(--brand-ink); }
.layer-role { font-size: 11.5px; color: rgba(244, 244, 247, 0.45); }
.layer-what { margin: 0; font-size: 12.5px; line-height: 1.7; color: rgba(244, 244, 247, 0.66); }
.layer-arrow { position: absolute; left: 50%; bottom: -20px; transform: translateX(-50%); font-size: 11px; color: rgba(124, 92, 255, 0.42); }

/* ── 指标 ── */
.metric { display: flex; flex-direction: column; gap: 8px; padding: 18px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.075); background: rgba(255, 255, 255, 0.022); }
.metric-value { display: flex; flex-direction: row; align-items: baseline; gap: 6px; }
.mv-num { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
.mv-unit { font-size: 11.5px; color: rgba(244, 244, 247, 0.48); }
.metric-label { margin: 0; font-size: 13px; color: rgba(244, 244, 247, 0.82); }
.metric-note { margin: 0; font-size: 11.5px; line-height: 1.6; color: rgba(244, 244, 247, 0.46); }

/* ── 终端 ── */
.term { border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.085); background: rgba(0, 0, 0, 0.34); overflow: hidden; }
.term-bar { display: flex; flex-direction: row; align-items: center; gap: 7px; padding: 9px 13px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); background: rgba(255, 255, 255, 0.022); }
.tdot { width: 9px; height: 9px; border-radius: 50%; }
.td-r { background: #ff5f57; }
.td-y { background: #febc2e; }
.td-g { background: #28c840; }
.term-name { margin-left: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: rgba(244, 244, 247, 0.42); }
.term-pre { margin: 0; padding: 15px 16px; overflow-x: auto; }
.term-pre code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.8; color: rgba(244, 244, 247, 0.78); white-space: pre; }

/* ── 边界 ── */
.bounds { display: flex; flex-direction: column; gap: 0; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.075); overflow: hidden; }
.bound { display: flex; flex-direction: row; align-items: flex-start; gap: 12px; padding: 13px 16px; }
.bound + .bound { border-top: 1px solid rgba(255, 255, 255, 0.05); }
.bound-mark { color: rgba(255, 107, 107, 0.6); flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.bound-t { margin: 0; font-size: 13px; line-height: 1.7; color: rgba(244, 244, 247, 0.68); }

/* ── 出口 ── */
.sec--end { padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
.outs { display: flex; flex-direction: row; flex-wrap: wrap; gap: 12px; }
.out { display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 11px; border: 1px solid rgba(124, 92, 255, 0.28); background: rgba(124, 92, 255, 0.07); text-decoration: none; transition: background 0.16s ease, border-color 0.16s ease; }
.out:hover { background: rgba(124, 92, 255, 0.14); border-color: var(--brand); }
.out-t { font-size: 13.5px; color: var(--brand-ink); }
.out-arrow { color: rgba(171, 155, 255, 0.6); }
.end-note { margin: 8px 0 0; font-size: 12.5px; line-height: 1.7; color: rgba(244, 244, 247, 0.42); }

/* ── 滚动显现 ── */
[data-reveal] { opacity: 0; transform: translateY(14px); transition: opacity 0.5s ease, transform 0.5s ease; }
[data-reveal].revealed { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1; transform: none; transition: none; }
}
</style>
