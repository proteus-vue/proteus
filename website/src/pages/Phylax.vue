<script setup lang="ts">
// website/src/pages/Phylax.vue —— ★★★Phylax：请求治理层 · 产品页
//
// 【★★★#1396：这一版为什么整个推翻重做（用户 2026-10-30 第三次纠正）】
//   用户原话：「你不能每个产品页都用一个模版啊，每个产品本身就是完全独立的，
//   不应该都去套用一个模版，应该是产品自己的特色匹配的产品页风格」。
//   ★第一版我错在哪：骨架照抄 CssEngine（`hero` 双栏 + `sec` 等权分节 + 卡片网格 +
//     表格 + 终端 + 边界列表），只换了配色与文案 —— **那就是套模板**。
//     取证也证实四个产品页骨架本来就各不相同：
//       Animation = 演示工作台（`demo-grid` + `curve-svg`）· LiquidGlass = 端舞台（`ends-stage`）·
//       Icons = 工具界面（`ic-bar` 搜索筛选 + `ic-grid`）· CssEngine = 案卷（`verdict` + `§NN` 案号）。
//
// 【★★本页的结构就是产品本身（没有"英雄区 + 并列分节"）】
//   请求治理的本质是**一个运行时过程**：一条请求发出，依次穿过若干道闸门，落到三种结局之一。
//   ⇒ 页面改成**单轴纵向管道**：
//     · 每个闸门节点的 `.gate-axis` 首尾相接画出**一条实体竖线**贯穿整页 —— 滚动 = 请求在前进；
//       ★判据（怎么算"没套模板"）：删掉任一节，管道就断；而套模板的页删掉一节毫无影响。
//     · 每道闸门是竖线上的节点（不是并列卡片），右侧直接标"不通过时会怎样"；
//     · 管道末端用 SVG **分叉成三条支路**（放行 / 拦下 / 挂账）—— 三态是同一流程的分岔，不是三张卡片；
//     · 判据数字不是大表格，是**贴在管道旁的仪表** + 末尾的副栏账本；
//     · 边界不是列表节，是管道尽头的**出口告示牌**。
//
// 【Phylax 是谁】φύλαξ = 古希腊的守卫/守备官。本层不替你把请求发出去（那是传输层），
//   而是守住边界、验明身份、留下记录 —— 所以视觉语言是**关卡**：栅格地面 + 一条纵向通路。
//
// 【★数据纪律】数字全部来自 `../data/request-engine-page`（SSOT：docs/generated/request-engine-numbers.json，
//   由 `scripts/gen-request-engine-numbers.mjs` **数**测试文件的 `it(` 得出）。防漂移：check:request-engine-*。
//
// 【★CSE lint】模板里**不得**用模板字符串拼类名（E-CSS-004：编译期无法枚举候选类）⇒ 一律对象语法。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { locale } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'
import PhylaxSigil from '../components/phylax/PhylaxSigil.vue'
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
    { threshold: 0.1 },
  )
  targets.forEach((el) => revealObserver?.observe(el))
})
onUnmounted(() => { revealObserver?.disconnect(); revealObserver = null })

/** 管道末端的三种结局（同一流程的分岔，不是三张并列卡片） */
const lanes = computed(() => {
  const zh = !isEn.value
  return [
    { id: 'success', tone: 'ok', label: zh ? '放行' : 'PASS', title: zh ? '确定成功' : 'Succeeded', desc: zh ? '业务正常走完。' : 'Business proceeds as normal.' },
    { id: 'failed', tone: 'bad', label: zh ? '拦下' : 'REJECT', title: zh ? '确定失败' : 'Failed', desc: zh ? '请求没被处理 ⇒ 回滚乐观值，可安全重试。' : 'Never processed ⇒ roll back the optimistic value; retry is safe.' },
    { id: 'unknown', tone: 'warn', label: zh ? '挂账' : 'HOLD', title: zh ? '结果未知' : 'Unknown', desc: zh ? '可能已生效 ⇒ 不回滚、不重试，去查单。' : 'May have taken effect ⇒ no rollback, no retry — reconcile.' },
  ]
})

/** 闸门（有序 —— 顺序就是产品语义） */
const gates = computed(() => D.gates)

/** 贴在管道旁的仪表（不是大表格） */
const gauges = computed(() => {
  const c = N.criteria
  const zh = !isEn.value
  return [
    { value: String(c.total), unit: zh ? '判据' : 'criteria', note: zh ? `${c.files} 组 · 数自 it(` : `${c.files} groups · counted from it(` },
    { value: String(N.painPoints.answered), unit: zh ? '痛点' : 'pain points', note: zh ? '各有答案' : 'each answered' },
    { value: String(N.outcomes.states.length), unit: zh ? '结局' : 'outcomes', note: 'success / failed / unknown' },
    { value: N.channels.websocket ? '2' : '1', unit: zh ? '通道' : 'channels', note: zh ? 'HTTP + WS · 同一链' : 'HTTP + WS · one chain' },
  ]
})

const groups = computed(() => N.criteria.groups)
/** 条形宽度：相对**最大组**的百分比（长度可比，而不是随便画一根） */
const maxGroup = computed(() => Math.max(...N.criteria.groups.map((g) => g.count)))
const barWidth = (n: number): string => `${Math.max(6, Math.round((n / maxGroup.value) * 100))}%`
</script>

<template>
  <p-page ref="rootEl" class="px">
    <!-- 背景：关卡地面（整页铺底；纵向通路由管道自身承担） -->
    <div class="px-floor" aria-hidden="true" />

    <div class="px-doc">
      <!-- ═══════════ 道口标题（通栏，不再双栏 hero） ═══════════ -->
      <header class="px-head">
        <!-- ★品牌锚点：本产品自己的徽记（六边形守卫框 + 纵向轴 + 三闸 + 三态分岔），
             与 Kairos 的圆形叠层徽记几何完全不同 —— 见组件头注释 -->
        <div class="px-brand">
          <PhylaxSigil :size="168" />
          <div class="px-brand-copy">
            <span class="px-badge"><FeatureIcon name="shield" />{{ isEn ? 'REQUEST GOVERNANCE' : '请求治理层' }} · PHYLAX</span>
            <span class="px-brand-name">PHYLAX<span class="px-brand-gloss">φύλαξ · {{ isEn ? 'the guard' : '守卫' }}</span></span>
          </div>
        </div>
        <h1 class="px-title">
          {{ isEn ? 'One request. Five gates. Three fates.' : '一条请求，五道闸，三种命。' }}
        </h1>
        <p class="px-lede">
          {{ isEn
            ? 'Every outbound call — HTTP or WebSocket — walks the same corridor. Each gate can pass it, hold it, or reject it. What comes out the far end is not always success or failure: the third outcome is the whole point.'
            : '每个出网请求——HTTP 或 WebSocket——都走同一条通道。每道闸可以放行、拦下或挂账。走到尽头拿到的，不只有成功和失败两种答案：第三种结局才是这层的全部意义。' }}
        </p>
        <div class="px-links">
          <router-link to="/docs/system/14-request-quickstart" class="px-link">{{ isEn ? 'Cookbook' : '使用手册' }} →</router-link>
          <router-link to="/docs/system/13-request-governance" class="px-link">{{ isEn ? 'Rationale' : '设计理由' }} →</router-link>
        </div>
      </header>

      <!-- ═══════════ 管道：请求从这里进入，一直到出口 ═══════════ -->
      <div class="pipe">
        <!-- 入口：请求本体 -->
        <div class="pipe-entry" data-reveal>
          <span class="gate-axis" aria-hidden="true" />
          <span class="entry-tag">{{ isEn ? 'REQUEST' : '请求' }}</span>
          <code class="entry-code">POST /order · Authorization: Bearer tenant-a · Idempotency-Key: ord_7f3</code>
        </div>

        <!-- 闸门序列（有序 = 产品语义） -->
        <div
          v-for="(g, i) in gates"
          :key="g.no"
          class="gate"
          data-reveal
          :class="{ 'gate--bad': g.tone === 'bad', 'gate--warn': g.tone === 'warn', 'gate--ok': g.tone === 'ok' }"
        >
          <span class="gate-axis" aria-hidden="true"><span class="gate-knot" /></span>

          <div class="gate-body">
            <div class="gate-head">
              <!-- 闸口微图：每道闸一个（几何各不相同，表达"它在检什么"），下面按序号切换 -->
              <svg class="gate-glyph" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <g v-if="g.no === '01'" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <!-- 白名单：三行条目 + 右侧一道闸线（"逐条筛过闸"） -->
                  <path d="M5 9h9M5 16h9M5 23h9" stroke-opacity="0.5" />
                  <path d="M20 5v22" />
                  <path d="M25 16h4" stroke-opacity="0.8" />
                </g>
                <g v-else-if="g.no === '02'" fill="currentColor">
                  <!-- 配额：两条计量条（上满下空） -->
                  <rect x="5" y="9" width="22" height="5" rx="2.5" fill-opacity="0.22" />
                  <rect x="5" y="9" width="15" height="5" rx="2.5" fill-opacity="0.95" />
                  <rect x="5" y="19" width="22" height="5" rx="2.5" fill-opacity="0.22" />
                  <rect x="5" y="19" width="6" height="5" rx="2.5" fill-opacity="0.6" />
                </g>
                <g v-else-if="g.no === '03'" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
                  <!-- 幂等键：指纹（三条弧 + 核心点） -->
                  <path d="M16 6c-5 0-9 4-9 9 0 3 .8 5.6 2.2 7.8" />
                  <path d="M16 6c5 0 9 4 9 9 0 3-.8 5.6-2.2 7.8" />
                  <path d="M16 12c-1.7 0-3 1.3-3 3 0 4 1 7 2.4 9.4" stroke-opacity="0.55" />
                  <circle cx="16" cy="15.6" r="1.6" fill="currentColor" stroke="none" />
                </g>
                <g v-else-if="g.no === '04'" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <!-- 重试门禁：循环箭头 + 一道斜杠（不可重试） -->
                  <path d="M10 8.5a9 9 0 1 1-1.4 12" stroke="currentColor" stroke-width="2" />
                  <path d="M9 4.6v4.6h4.6" stroke="currentColor" stroke-width="2" />
                  <path d="M23 24 9 8" stroke="#ff6b6b" stroke-width="2" stroke-opacity="0.9" />
                </g>
                <g v-else fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <!-- 去重身份：两条线汇成一点（合并点） -->
                  <path d="M5 8c6 0 5 8 11 8" stroke-opacity="0.5" />
                  <path d="M5 24c6 0 5-8 11-8" stroke-opacity="0.5" />
                  <path d="M16 16h9" />
                  <circle cx="27" cy="16" r="2.4" fill="currentColor" stroke="none" />
                </g>
              </svg>
              <span class="gate-no">{{ g.no }}</span>
              <h2 class="gate-name">{{ isEn ? g.en : g.zh }}</h2>
            </div>
            <p class="gate-check">{{ isEn ? g.enCheck : g.zhCheck }}</p>
            <p class="gate-note">{{ isEn ? g.enNote : g.zhNote }}</p>
            <p class="gate-onfail">
              <span class="onfail-key">{{ isEn ? 'if it fails' : '不通过时' }}</span>
              <span class="onfail-val">{{ isEn ? g.enOnFail : g.zhOnFail }}</span>
            </p>

            <!-- 仪表：贴在管道旁（第 1、3 道各挂一块，避免整页都是大数字） -->
            <div v-if="i === 0 || i === 2" class="gauge-strip">
              <div v-for="gg in (i === 0 ? gauges.slice(0, 2) : gauges.slice(2))" :key="gg.unit" class="gauge">
                <span class="gauge-v">{{ gg.value }}</span>
                <span class="gauge-u">{{ gg.unit }}</span>
                <span class="gauge-n">{{ gg.note }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 出网：两条通道，同一套链 -->
        <div class="egress" data-reveal>
          <span class="gate-axis" aria-hidden="true"><span class="gate-knot gate-knot--wide" /></span>
          <div class="egress-body">
            <div class="egress-head">
              <span class="gate-no">06</span>
              <h2 class="gate-name">{{ isEn ? 'Egress' : '出网' }}</h2>
            </div>
            <p class="egress-note">
              {{ isEn
                ? 'Past the gates, the request leaves through one of two wires — and both carry the same audit trail, the same tenant tag, the same redaction rules.'
                : '过了闸，请求从两条线之一出去——两条线都带同样的审计、同样的租户标记、同样的脱敏规则。' }}
            </p>
            <div class="egress-wires">
              <div class="wire">
                <span class="wire-k">HTTP</span>
                <span class="wire-v">OkHttp / URLSession / RCP</span>
                <span class="wire-ok">{{ isEn ? 'audited · tagged · redacted' : '审计 · 标租户 · 脱敏' }}</span>
              </div>
              <div class="wire">
                <span class="wire-k">WebSocket</span>
                <span class="wire-v">wss:// · {{ isEn ? 'long-lived duplex' : '常驻双向' }}</span>
                <span class="wire-ok">{{ isEn ? 'same chain · never logs payload' : '同一套链 · 绝不记载荷' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 分岔：一条管道裂成三条（三态的正确画法） -->
        <div class="fork" aria-hidden="true">
          <span class="fork-stem" />
          <svg class="fork-svg" viewBox="0 0 1000 120" preserveAspectRatio="none">
            <path d="M500 0 C500 62, 180 58, 180 120" class="fork-lane fork-lane--ok" />
            <path d="M500 0 L500 120" class="fork-lane fork-lane--bad" />
            <path d="M500 0 C500 62, 820 58, 820 120" class="fork-lane fork-lane--warn" />
          </svg>
        </div>

        <!-- 三种结局 -->
        <div class="lanes">
          <div
            v-for="l in lanes"
            :key="l.id"
            class="lane"
            data-reveal
            :class="{ 'lane--ok': l.tone === 'ok', 'lane--bad': l.tone === 'bad', 'lane--warn': l.tone === 'warn' }"
          >
            <span class="lane-id">{{ l.id }}</span>
            <span class="lane-label">{{ l.label }}</span>
            <h3 class="lane-title">{{ l.title }}</h3>
            <p class="lane-desc">{{ l.desc }}</p>
          </div>
        </div>

        <!-- 出口告示牌（边界不是列表节，是管道尽头的告示） -->
        <footer class="sign" data-reveal>
          <div class="sign-head">
            <span class="sign-k">{{ isEn ? 'NOTICE BOARD' : '出口告示' }}</span>
            <span class="sign-t">{{ isEn ? 'What this layer will not do' : '这层不做什么' }}</span>
          </div>
          <ul class="sign-list">
            <li v-for="(b, i) in D.boundaries" :key="i">{{ isEn ? b.en : b.zh }}</li>
          </ul>
        </footer>
      </div>

      <!-- ═══════════ 副栏账本（附在管道一侧的记录，不是正节） ═══════════ -->
      <section class="side-ledger" data-reveal>
        <div class="sl-head">
          <span class="sl-k">{{ isEn ? 'THE LEDGER' : '判据账本' }}</span>
          <span class="sl-note">{{ isEn ? 'every figure is counted from repository artifacts' : '每个数字都从仓库产物重新数出' }}</span>
        </div>
        <div class="sl-bars">
          <div v-for="g in groups" :key="g.file" class="sl-bar-row">
            <div class="sl-bar-meta">
              <span class="sl-name">{{ isEn ? g.en : g.zh }}</span>
              <span class="sl-count">{{ g.count }}</span>
            </div>
            <div class="sl-bar-track">
              <div class="sl-bar-fill" :style="{ width: barWidth(g.count) }" />
            </div>
            <p class="sl-what">{{ isEn ? g.whatEn : g.what }}</p>
          </div>
        </div>
        <p class="sl-foot">
          {{ isEn
            ? 'Source of truth: docs/generated/request-engine-numbers.json — recounted on every check, so a deleted criterion cannot stay in the copy.'
            : '单一事实源：docs/generated/request-engine-numbers.json —— 每次校验重算，删掉的判据不可能还留在文案里。' }}
        </p>
      </section>
    </div>
  </p-page>
</template>

<style scoped>
/* ═══════ 整页：一块关卡地面，中央一条通路 ═══════ */
.px { position: relative; }
.px-floor {
  position: absolute; inset: 0; pointer-events: none;
  background-image: repeating-linear-gradient(to bottom, transparent 0 47px, rgba(255, 255, 255, 0.022) 47px 48px);
  mask-image: linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%);
}
.px-doc {
  position: relative;
  display: flex; flex-direction: column;
  padding: 76px 24px 140px; max-width: 900px; margin: 0 auto;
}

/* ═══════ 标题：通栏（不再双栏 hero），左缘对齐管道 ═══════ */
.px-head { display: flex; flex-direction: column; gap: 16px; padding-bottom: 44px; }
/* ★品牌区：徽记 + 名称（与其它引擎页的"纯文字 chip"区分开 —— 产品要有自己的品牌锚点） */
.px-brand {
  display: flex; flex-direction: row; align-items: center; gap: 22px;
  margin: 0 0 10px -18px;   /* 徽记略超出正文左缘 —— 形成品牌重心 */
}
.px-brand-copy { display: flex; flex-direction: column; gap: 8px; }
.px-brand-name {
  display: flex; align-items: baseline; gap: 10px;
  font-size: 26px; font-weight: 700; letter-spacing: 0.2em;
  color: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.px-brand-gloss {
  font-size: 11.5px; font-weight: 400; letter-spacing: 0.06em;
  color: rgba(171, 155, 255, 0.62); font-family: inherit;
}
/* ★闸口微图：每道闸一个（几何各不同，见模板） */
.gate-glyph {
  width: 34px; height: 34px; flex: none;
  color: var(--brand-ink); opacity: 0.92;
  /* ★从"文字流里的小图标"抬到"节点标记"：与 gate-name 基线对齐，左侧微留白 */
  align-self: center; margin-top: 1px;
}
.gate--bad .gate-glyph { color: rgba(255, 107, 107, 0.92); }
.gate--warn .gate-glyph { color: rgba(255, 180, 84, 0.92); }
.gate--ok .gate-glyph { color: rgba(61, 220, 151, 0.92); }
.px-badge {
  display: inline-flex; align-items: center; gap: 7px; align-self: flex-start;
  padding: 5px 11px; border-radius: 3px; font-size: 10.5px; letter-spacing: 0.16em;
  color: var(--brand-ink); background: var(--brand-soft); border: 1px solid rgba(124, 92, 255, 0.26);
}
.px-title {
  margin: 0; font-size: clamp(30px, 4.6vw, 52px); line-height: 1.1; letter-spacing: -0.025em;
  color: var(--ink); font-weight: 650;
}
.px-lede { margin: 0; max-width: 68ch; color: rgba(244, 244, 247, 0.66); font-size: 15px; line-height: 1.8; }
.px-links { display: flex; flex-direction: row; flex-wrap: wrap; gap: 18px; margin-top: 2px; }
.px-link { font-size: 13px; color: var(--brand-ink); text-decoration: none; border-bottom: 1px solid rgba(124, 92, 255, 0.3); padding-bottom: 2px; }
.px-link:hover { color: var(--ink); border-bottom-color: var(--brand); }

/* ═══════ 管道：左轴 + 右内容（整页唯一主轴） ═══════ */
.pipe { display: flex; flex-direction: column; position: relative; padding-left: 22px; }
/* ★整页唯一主轴：一条从入场到告示牌的实体竖线（不是每个节点各画一段 —— 那会断） */
.pipe::before {
  content: ""; position: absolute; left: 1px; top: 0; bottom: 0; width: 2px;
  background: linear-gradient(to bottom, rgba(124, 92, 255, 0.55) 0%, rgba(124, 92, 255, 0.3) 62%, rgba(124, 92, 255, 0.1) 100%);
}
/* 竖线由每个节点的 .gate-axis 首尾相接 —— 删掉任一节点管道就断（结构即产品） */
/* 节点：不再自己画线（线在 .pipe 上一次性画到底），只做 knot 的定位参照 */
.gate-axis { position: absolute; left: -22px; top: 0; bottom: 0; width: 2px; }
.gate-knot {
  position: absolute; left: 0; top: 22px; width: 11px; height: 11px; margin-left: -5.5px;
  border-radius: 50%; background: var(--bg); border: 2px solid var(--brand);
  box-shadow: 0 0 0 4px rgba(124, 92, 255, 0.08);
}
.gate-knot--wide { width: 13px; height: 13px; margin-left: -6.5px; top: 18px; }

/* 入口 */
.pipe-entry { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 0 0 36px 0; }
.entry-tag { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; letter-spacing: 0.2em; color: rgba(244, 244, 247, 0.4); }
.entry-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.7;
  color: var(--brand-ink); background: rgba(124, 92, 255, 0.07);
  border: 1px solid rgba(124, 92, 255, 0.2); border-radius: 8px; padding: 11px 14px;
  overflow-x: auto; white-space: nowrap;
}

/* 闸门节点 */
.gate { position: relative; display: flex; flex-direction: row; padding: 0 0 40px 0; }
.gate-body { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
.gate-head { display: flex; flex-direction: row; align-items: center; gap: 11px; }
.gate-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  letter-spacing: 0.14em; color: rgba(244, 244, 247, 0.34); flex: none;
}
.gate-name { margin: 0; font-size: 19px; color: var(--ink); letter-spacing: -0.01em; }
.gate--bad .gate-knot { border-color: var(--rec); box-shadow: 0 0 0 4px rgba(255, 107, 107, 0.09); }
.gate--warn .gate-knot { border-color: var(--warn); box-shadow: 0 0 0 4px rgba(255, 180, 84, 0.09); }
.gate--ok .gate-knot { border-color: var(--ok); box-shadow: 0 0 0 4px rgba(61, 220, 151, 0.09); }
.gate-check { margin: 0; font-size: 14px; line-height: 1.65; color: rgba(244, 244, 247, 0.8); }
.gate-note { margin: 0; font-size: 12.5px; line-height: 1.7; color: rgba(244, 244, 247, 0.48); }
.gate-onfail {
  display: flex; flex-direction: row; align-items: baseline; gap: 10px; margin: 2px 0 0;
  padding: 7px 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.023);
  border-left: 2px solid transparent;
}
.gate--bad .gate-onfail { border-left-color: var(--rec); }
.gate--warn .gate-onfail { border-left-color: var(--warn); }
.gate--ok .gate-onfail { border-left-color: var(--ok); }
.onfail-key { font-size: 10.5px; letter-spacing: 0.12em; color: rgba(244, 244, 247, 0.36); flex: none; }
.onfail-val { font-size: 12.5px; line-height: 1.6; color: rgba(244, 244, 247, 0.7); }

/* 贴在管道旁的仪表 */
.gauge-strip { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.gauge {
  display: flex; flex-direction: row; align-items: baseline; gap: 5px; flex-wrap: wrap;
  padding: 8px 12px; border-radius: 7px; background: rgba(255, 255, 255, 0.022);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.gauge-v { font-size: 19px; font-weight: 650; color: var(--ink); font-variant-numeric: tabular-nums; }
.gauge-u { font-size: 11px; color: rgba(244, 244, 247, 0.45); }
.gauge-n { font-size: 10.5px; color: rgba(244, 244, 247, 0.34); width: 100%; }

/* 出网 */
.egress { position: relative; display: flex; flex-direction: row; padding: 0 0 34px 0; }
.egress-body { display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 0; }
.egress-head { display: flex; flex-direction: row; align-items: baseline; gap: 12px; }
.egress-note { margin: 0; font-size: 13px; line-height: 1.7; color: rgba(244, 244, 247, 0.55); }
.egress-wires { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; }
.wire {
  display: flex; flex-direction: column; gap: 3px; flex: 1 1 240px;
  padding: 11px 14px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.022); border: 1px solid rgba(255, 255, 255, 0.06);
}
.wire-k { font-size: 12.5px; color: var(--ink); font-weight: 600; }
.wire-v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: rgba(244, 244, 247, 0.42); }
.wire-ok { font-size: 11px; color: var(--ok); }

/* 分岔：SVG 三条支路 */
.fork { position: relative; height: 120px; }
.fork-stem { position: absolute; left: -21px; top: 0; width: 2px; height: 22px; background: rgba(124, 92, 255, 0.4); }
.fork-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.fork-lane { fill: none; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.fork-lane--ok { stroke: rgba(61, 220, 151, 0.55); }
.fork-lane--bad { stroke: rgba(255, 107, 107, 0.5); }
.fork-lane--warn { stroke: rgba(255, 180, 84, 0.5); }

/* 三态 */
.lanes { display: flex; flex-direction: row; flex-wrap: wrap; gap: 16px; padding-top: 4px; }
.lane {
  display: flex; flex-direction: column; gap: 6px; flex: 1 1 240px;
  padding: 18px 18px 20px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.022); border: 1px solid rgba(255, 255, 255, 0.065);
  border-top-width: 3px; border-top-style: solid;
}
.lane--ok { border-top-color: var(--ok); }
.lane--bad { border-top-color: var(--rec); }
.lane--warn { border-top-color: var(--warn); }
.lane-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: 0.1em; }
.lane--ok .lane-id { color: var(--ok); }
.lane--bad .lane-id { color: var(--rec); }
.lane--warn .lane-id { color: var(--warn); }
.lane-label { font-size: 10.5px; letter-spacing: 0.2em; color: rgba(244, 244, 247, 0.34); }
.lane-title { margin: 2px 0 0; font-size: 16px; color: var(--ink); }
.lane-desc { margin: 0; font-size: 12.5px; line-height: 1.7; color: rgba(244, 244, 247, 0.58); }

/* 出口告示牌 */
.sign {
  margin-top: 52px; padding: 20px 22px; border-radius: 10px;
  background: rgba(0, 0, 0, 0.22); border: 1px solid rgba(255, 255, 255, 0.07);
}
.sign-head { display: flex; flex-direction: row; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.sign-k { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; letter-spacing: 0.2em; color: rgba(255, 107, 107, 0.7); }
.sign-t { font-size: 14px; color: rgba(244, 244, 247, 0.72); }
.sign-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0 0 0 16px; }
.sign-list li { font-size: 12.5px; line-height: 1.7; color: rgba(244, 244, 247, 0.55); }

/* 副栏账本（附在管道一侧的记录，不是正节） */
.side-ledger {
  margin-top: 64px; padding: 20px 22px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07); background: rgba(255, 255, 255, 0.016);
}
.sl-head { display: flex; flex-direction: row; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.sl-k { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; letter-spacing: 0.2em; color: var(--brand-ink); }
.sl-note { font-size: 11px; color: rgba(244, 244, 247, 0.36); }
/* ★判据账本 = 横向条形（不是三列文字表 —— 表格读起来像 changelog，条形才有"仪表盘"感） */
.sl-bars { display: flex; flex-direction: column; gap: 14px; }
.sl-bar-row { display: flex; flex-direction: column; gap: 5px; }
.sl-bar-meta { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between; gap: 12px; }
.sl-name { font-size: 12.5px; color: rgba(244, 244, 247, 0.82); }
.sl-count {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
  color: var(--brand-ink); font-variant-numeric: tabular-nums;
}
.sl-bar-track {
  position: relative; height: 5px; border-radius: 3px; overflow: hidden;
  background: rgba(255, 255, 255, 0.055);
}
.sl-bar-fill {
  height: 100%; border-radius: 3px;
  background: linear-gradient(to right, rgba(124, 92, 255, 0.85), rgba(171, 155, 255, 0.55));
  transition: width 0.5s ease;
}
.sl-what { margin: 0; font-size: 11px; line-height: 1.6; color: rgba(244, 244, 247, 0.42); }
.sl-foot { margin: 12px 0 0; font-size: 11px; line-height: 1.6; color: rgba(244, 244, 247, 0.34); }

/* 显现 */
[data-reveal] { opacity: 0; transform: translateY(12px); transition: opacity 0.5s ease, transform 0.5s ease; }
[data-reveal].revealed { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1; transform: none; transition: none; }
}
</style>
