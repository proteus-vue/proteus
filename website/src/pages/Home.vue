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
import { onMounted, onUnmounted, ref } from 'vue'
import { STATS, COMPARE_MATRIX } from '../stats'
import TransformDemo from '../components/TransformDemo.vue'
// ★#389b 粒子场已上移至 App 壳（全站固定背景层）；Hero 保留辉光 + 内容滚动联动

const homeEl = ref<{ $el?: HTMLElement } | null>(null)
// ★#389b 动效守卫：prefers-reduced-motion → 粒子静态化 + 显现动效跳过 + 渐变流光关闭
const motionOk = ref(true)
let revealObserver: IntersectionObserver | null = null

// ★#389c Hero 滚动联动：--sp（0→1）驱动粒子/辉光/内容视差淡出（合成器属性，rAF 节流）
const scrollP = ref(0)
let scrollRaf = 0
function onScroll(): void {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const root = (homeEl.value?.$el as HTMLElement | undefined) ?? (homeEl.value as unknown as HTMLElement | null)
    if (!root) return
    const heroH = root.querySelector('.hero')?.getBoundingClientRect().height || 1
    scrollP.value = Math.max(0, Math.min(1, window.scrollY / heroH))
  })
}

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
  // ★#389c 滚动联动（motion-ok 才绑——reduced-motion 恒 0）
  if (motionOk.value) window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => {
  revealObserver?.disconnect()
  revealObserver = null
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  window.removeEventListener('scroll', onScroll)
})

// ★#386 对标状态色接入 design-tokens 状态层（ok/warn/rec——llm-style-guide §2：✓ 用 ok / partial 用 warn / 规划用 dim）
function statusClass(status: string): string {
  return { '✅': 'st-ok', '🟡': 'st-warn', '📋': 'st-plan' }[status] ?? ''
}

// G 系 pills（v3 hero 下方信息钉子——每个 pill 对应真实入库 plan）
const gPills = [
  'G-27 渲染可插拔',
  'G-28 能力可插拔',
  'G-29 编译可插拔',
  'G-30 任意端',
  'G-31/32 语义原语',
]

// 编号三支柱（v3 三卡构图；文案对齐方法论三句话）
const pillars = [
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

const capabilities = [
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
</script>

<template>
  <p-page ref="homeEl" class="home" :class="{ 'no-motion': !motionOk }">
    <!-- 1. 居中 Hero（v3 构图 + ★#389 品牌辉光 + ★#389c 滚动联动视差；粒子场在全站背景层） -->
    <p-view
      v-p-fluid="'padding-top(48, 96) padding-bottom(36, 64)'"
      class="hero"
      :style="{ '--sp': String(scrollP) }"
    >
      <span class="hero-glow" aria-hidden="true" />
      <p-view class="hero-content">
        <span class="eyebrow">◆ SEMANTIC MODEL ARCHITECTURE</span>
      <p-heading :level="1" v-p-fluid="'font-size(30, 60)'" class="hero-title">
        One semantic model.<br />
        <em>Any engine — at every layer.</em>
      </p-heading>
      <p-text v-p-fluid="'font-size(14, 17)'" class="hero-sub">
        不是又一个「小程序跨端框架」。Proteus 定义跨端语义内核，让编译、UI 渲染、原生能力、端接入全部成为可插拔后端——
        Web、小程序、Flutter、原生 UIKit / Jetpack / ArkUI，都是 SPI 的一种实现。
      </p-text>
      <p-stack direction="row" :gap="14" class="hero-cta">
        <router-link to="/docs/04-requirements" class="cta-primary">
          <p-text class="cta-text">⚡ 快速开始</p-text>
        </router-link>
        <router-link to="/playground" class="cta-ghost">
          <p-text class="cta-text">在线体验</p-text>
        </router-link>
      </p-stack>
      <p-stack direction="row" :gap="8" wrap class="hero-pills">
        <span v-for="p in gPills" :key="p" class="g-pill">{{ p }}</span>
      </p-stack>
      </p-view>
      <!-- ★#389e 海浪装饰（双层 SVG 波形缓漂——海神意象收尾） -->
      <span class="hero-waves" aria-hidden="true">
        <svg class="wave w1" viewBox="0 0 2880 64" preserveAspectRatio="none">
          <path d="M0,40 C120,16 240,16 360,40 S600,64 720,40 S960,16 1080,40 S1320,64 1440,40 S1680,16 1800,40 S2040,64 2160,40 S2400,16 2520,40 S2760,64 2880,40 L2880,64 L0,64 Z" />
        </svg>
        <svg class="wave w2" viewBox="0 0 2880 64" preserveAspectRatio="none">
          <path d="M0,44 C160,24 320,24 480,44 S800,60 960,44 S1280,24 1440,44 S1760,60 1920,44 S2240,24 2400,44 S2720,60 2880,44 L2880,64 L0,64 Z" />
        </svg>
      </span>
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
          v-for="(s, i) in STATS"
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
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">语义是内核，后端是驱动</p-heading>
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
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">与「翻译派」的本质分水岭</p-heading>
      <p-text class="section-sub center">传统框架把小程序 API 当标准去翻译；Proteus 定义自己的语义 IR，各端来实现。</p-text>
      <div class="table-wrap">
        <table class="cmp-table">
          <thead>
            <tr><th>维度</th><th>uni-app</th><th>React Native</th><th>Flutter</th><th class="cmp-proteus-head">Proteus</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in COMPARE_MATRIX" :key="row.dim">
              <td class="cmp-dim">{{ row.dim }}</td>
              <td>{{ row.uniapp }}</td>
              <td>{{ row.rn }}</td>
              <td>{{ row.flutter }}</td>
              <td class="cmp-proteus">{{ row.proteus }} <span class="cmp-status" :class="statusClass(row.status)">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p-text class="cmp-note center-block">状态标注：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库——明确边界比无限承诺更有说服力。</p-text>
    </p-view>

    <!-- 6. dogfooding 金句（v3 收尾构图） -->
    <p-view v-p-fluid="'padding-top(36, 72) padding-bottom(36, 72)'" data-reveal class="quote">
      <p-heading :level="2" v-p-fluid="'font-size(20, 34)'" class="quote-line">
        「我们用 Proteus 建了 Proteus 官网」<br />
        你审查这份页面的源码，看到真实的 <em>&lt;p-grid&gt;</em>——它正在渲染你眼前的页面。
      </p-heading>
      <p-text class="quote-sub">这就是 <strong class="grad">dogfooding</strong>。</p-text>
      <p-stack direction="row" :gap="18" class="quote-links">
        <router-link to="/docs/11-semantic-model" class="method-link">统一语义收敛 →</router-link>
        <a class="method-link" href="https://github.com/proteus-vue/proteus/tree/main/docs/spi-first-methodology" target="_blank" rel="noreferrer">SPI-First 五步法 →</a>
      </p-stack>
    </p-view>

    <!-- 7. 快速开始（01-home §5：3 步） -->
    <p-view v-p-fluid="'padding-top(20, 44) padding-bottom(36, 64)'" data-reveal class="quickstart">
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title center">两分钟跑通双端</p-heading>
      <pre class="qs-code"><code>npm create @proteus-vue/proteus my-app
cd my-app
npm run dev:web      <span class="qs-dim"># Web SPA 直跑</span>
npm run build:mp     <span class="qs-dim"># Skyline 四件套</span></code></pre>
      <p-text class="qs-note center-block">
        同一份标准 Vue SFC：Web 端由渲染后端直出 DOM，小程序端由编译器生成 WXML/WXSS/JS——
        接入 Native / Flutter 后端时，这行代码不改。
      </p-text>
    </p-view>
  </p-page>
</template>

<style scoped>
/* ---- Hero（居中构图 + ★#389c 滚动联动：--sp 0→1 驱动辉光/内容视差淡出——纯合成器属性；粒子场在全站背景层） ---- */
.hero { max-width: 880px; margin: 0 auto; text-align: center; position: relative; }
.hero-glow {
  position: absolute;
  inset: 0;
  height: 340px;
  pointer-events: none;
  z-index: 0;
  opacity: calc(1 - var(--sp, 0));
  /* ★#389f 辉光零溢出 + 零裁剪感：渐变用百分比椭圆（相对元素尺寸，衰减在元素内部完成——
     任何宽度都不会像固定 px 半径那样在边界被硬切）+ blur(26px) 二次软化 */
  background:
    radial-gradient(52% 44% at 27% 26%, rgba(124, 92, 255, 0.18), transparent 66%),
    radial-gradient(52% 44% at 75% 30%, rgba(0, 224, 198, 0.14), transparent 68%);
  filter: blur(26px);
}
.hero-content {
  transform: translateY(calc(var(--sp, 0) * 60px));
  opacity: calc(1 - var(--sp, 0) * 1.15);
}
.hero-waves {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  height: 64px;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
.hero-waves .wave {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 200%;
  height: 100%;
}
.hero-waves .w1 {
  fill: rgba(124, 92, 255, 0.07);
  animation: wave-drift 26s linear infinite;
}
.hero-waves .w2 {
  fill: rgba(0, 224, 198, 0.05);
  animation: wave-drift 38s linear infinite reverse;
  bottom: -6px;
}
@keyframes wave-drift {
  to { transform: translateX(-50%); }
}
.no-motion .hero-waves .wave { animation: none; }
/* 内容层浮于辉光/粒子之上 */
.hero .eyebrow,
.hero .hero-title,
.hero .hero-sub,
.hero .hero-cta,
.hero .hero-pills { position: relative; z-index: 1; }
/* ★#389b 渐变流光（motion-ok 时启用；reduced-motion 关闭） */
.motion-ok .hero-title em { background-size: 200% auto; animation: hero-shimmer 7s linear infinite; }
@keyframes hero-shimmer {
  to { background-position: 200% center; }
}
/* ---- 滚动显现（data-reveal；reduced-motion / 无 IO 直接显现）+ ★#389c 网格子项 stagger ---- */
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
.features .feature-card {
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
.revealed .feature-card {
  opacity: 1;
  transform: none;
}
.no-motion .pillar-card,
.no-motion .stat,
.no-motion .feature-card {
  opacity: 1;
  transform: none;
  transition: none;
}
.eyebrow {
  color: var(--brand2);
  white-space: nowrap;
  font-size: 12px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: var(--sp-4) var(--sp-12);
  display: inline-block;
  background: var(--brand-soft);
  border-color: rgba(124, 92, 255, 0.3);
}
.hero-title { color: var(--ink); line-height: 1.12; letter-spacing: -0.02em; font-weight: 800; margin: 20px 0 18px; }
.hero-title em {
  font-style: normal;
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub { color: var(--muted); line-height: 1.75; margin: 0 auto 28px; max-width: 640px; display: block; }
.hero-cta { justify-content: center; align-items: center; }
.cta-primary {
  color: var(--bg);
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  padding: 10px 22px;
  border-radius: var(--radius-md);
  text-decoration: none;
}
.cta-text { color: var(--bg); font-weight: 600; font-size: 14px; white-space: nowrap; }
.cta-ghost {
  border: 1px solid var(--line);
  padding: 10px 22px;
  border-radius: var(--radius-md);
  text-decoration: none;
}
.cta-ghost .cta-text { color: var(--ink); font-size: 14px; white-space: nowrap; }
.cta-ghost:hover, .cta-primary:hover { filter: brightness(1.1); }
.hero-pills { justify-content: center; margin-top: 26px; }
.g-pill {
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  padding: var(--sp-4) var(--sp-12);
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
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
.quote-line em {
  font-style: normal;
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 800;
}
.quote-sub { color: var(--muted); font-size: 15px; display: block; }
.quote-sub .grad {
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
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
