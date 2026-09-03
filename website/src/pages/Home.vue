<script setup lang="ts">
// website/src/pages/Home.vue —— 官网首页（B2：Hero + 能力卡；B4 深化：数据条 + 对标矩阵 + 方法论）
// ★W-6 柔性框架优先：Hero 排版 v-p-fluid clamp 流式插值；能力卡网格 = 柔性网格
//   （repeat(auto-fill, minmax(260px,1fr))——p-grid min-col-width 语义的 CSS 等价，列数随容器自动伸缩）
// ★G-24 桌面原语：v-p-hover 悬停语义（触屏天然降级）
import { STATS, COMPARE_MATRIX } from '../stats'

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
    desc: '69 条规则 AI 说明书 + MCP Server + Agent Kit 自修复循环 + 三层护栏——AI 产出符合 IR 契约的代码。',
  },
]

const slogan = 'One semantic model. Any render engine. Zero native glue.'
</script>

<template>
  <div class="home">
    <!-- Hero：柔性排版（W-6——clamp 流式，无断点跳变） -->
    <section v-p-fluid="'padding(56, 96)'" class="hero">
      <span class="eyebrow">◆ Proteus · 语义收敛的跨端应用框架</span>
      <h1 v-p-fluid="'font-size(30, 58)'" class="hero-title">
        One semantic model.<br /><em>Any render engine.</em> Zero native glue.
      </h1>
      <p v-p-fluid="'font-size(15, 19)'" class="hero-sub">
        一套语义内核，任意渲染引擎，任意原生能力。业务代码只和语义层对话——
        渲染底座、编译器、宿主容器、执行载体全部可插拔。不跨端翻译，做跨端操作系统。
      </p>
      <div class="hero-cta">
        <router-link to="/docs/quick-start" class="cta-primary">快速开始 →</router-link>
        <a class="cta-ghost" href="https://github.com/proteus-vue/proteus" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </section>

    <!-- 数据条（B4：数字可追溯到 stats.ts——来源注释指向验证脚本） -->
    <section v-p-fluid="'padding(24, 48)'" class="stats">
      <div class="stat-grid">
        <div v-for="s in STATS" :key="s.label" class="stat">
          <span class="stat-value">{{ s.value }}</span>
          <span class="stat-label">{{ s.label }}</span>
          <span class="stat-source">{{ s.source }}</span>
        </div>
      </div>
    </section>

    <!-- 能力矩阵：柔性网格（列数随宽度自动伸缩） -->
    <section v-p-fluid="'padding(24, 48)'" class="features">
      <span class="eyebrow">◆ 杀手特性</span>
      <h2 v-p-fluid="'font-size(20, 30)'" class="section-title">语义是内核，后端是驱动</h2>
      <div class="feature-grid">
        <article v-for="c in capabilities" :key="c.tag" v-p-hover class="feature-card">
          <span class="feature-tag">{{ c.tag }}</span>
          <h3 class="feature-title">{{ c.title }}</h3>
          <p class="feature-desc">{{ c.desc }}</p>
        </article>
      </div>
    </section>

    <!-- 对标矩阵（B4：positioning v3 §6——Proteus 列状态诚实标注） -->
    <section v-p-fluid="'padding(24, 48)'" class="compare">
      <span class="eyebrow">◆ 对标</span>
      <h2 v-p-fluid="'font-size(20, 30)'" class="section-title">不是又一个跨端方案，是方法论代际差</h2>
      <div class="table-wrap">
        <table class="cmp-table">
          <thead>
            <tr><th>维度</th><th>uni-app</th><th>React Native</th><th>Flutter</th><th>Proteus</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in COMPARE_MATRIX" :key="row.dim">
              <td class="cmp-dim">{{ row.dim }}</td>
              <td>{{ row.uniapp }}</td>
              <td>{{ row.rn }}</td>
              <td>{{ row.flutter }}</td>
              <td class="cmp-proteus">{{ row.proteus }} <span class="cmp-status">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="cmp-note">状态标注：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库——明确边界比无限承诺更有说服力。</p>
    </section>

    <!-- 方法论 -->
    <section v-p-fluid="'padding(24, 48)'" class="method">
      <span class="eyebrow">◆ 方法论</span>
      <h2 v-p-fluid="'font-size(20, 30)'" class="section-title">SPI-First：九次泛化的同一个动作</h2>
      <p class="method-body">
        找到系统中所有「换 X 要改很多文件」的 X，把它们逐一提升为
        <strong>语义接口 + ≥2 后端 + conformance + 诚实边界</strong>，直到业务层对任何具体实现零知识。
        操作系统长出驱动模型、数据库长出存储引擎、编辑器长出插件系统——
        Proteus 只是把这个结构显式化、可重复、配上了验证手段。
      </p>
      <div class="method-links">
        <router-link to="/docs/semantic-model" class="method-link">统一语义收敛 →</router-link>
        <a class="method-link" href="https://github.com/proteus-vue/proteus/tree/main/docs/spi-first-methodology" target="_blank" rel="noreferrer">SPI-First 五步法 →</a>
      </div>
    </section>

    <!-- 快速开始 -->
    <section v-p-fluid="'padding(24, 48)'" class="quickstart">
      <span class="eyebrow">◆ 快速开始</span>
      <h2 v-p-fluid="'font-size(20, 30)'" class="section-title">两分钟跑通双端</h2>
      <pre class="qs-code"><code>npm create @proteus-vue/proteus my-app
cd my-app
npm run dev:web      <span class="qs-dim"># Web 端：标准 Vue SPA 直跑</span>
npm run build:mp     <span class="qs-dim"># 小程序端：Skyline 原生四件套</span></code></pre>
      <p class="qs-note">
        同一份标准 Vue SFC：Web 端由渲染后端直出 DOM，小程序端由编译器生成 WXML/WXSS/JS——
        接入 Native / Flutter 后端时，这行代码不改。
      </p>
    </section>
  </div>
</template>

<style>
.hero { max-width: 860px; }
.eyebrow {
  color: var(--brand2);
  font-size: 12px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px;
  display: inline-block;
}
.hero-title {
  color: var(--ink);
  line-height: 1.15;
  margin: 20px 0 16px;
}
.hero-title em {
  font-style: normal;
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub { color: var(--muted); line-height: 1.7; margin: 0 0 28px; max-width: 640px; }
.hero-cta { display: flex; gap: 14px; flex-wrap: wrap; }
.cta-primary {
  color: #0a0a0c;
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  padding: 10px 20px;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 600;
  font-size: 14px;
}
.cta-ghost {
  color: var(--ink);
  border: 1px solid var(--line);
  padding: 10px 20px;
  border-radius: 10px;
  text-decoration: none;
  font-size: 14px;
}
.cta-ghost:hover, .cta-primary:hover { filter: brightness(1.1); }

.section-title { color: var(--ink); margin: 14px 0 22px; }
.feature-grid {
  display: grid;
  /* ★柔性网格（W-6）：auto-fill + minmax = 列数随容器宽度自动伸缩，零 @media */
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.feature-card {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px;
  background: var(--panel);
  transition: border-color 0.2s, transform 0.2s;
}
.feature-card:hover { border-color: var(--brand); transform: translateY(-2px); }
.feature-tag { color: var(--brand2); font-size: 11px; letter-spacing: 1px; }
.feature-title { color: var(--ink); font-size: 16px; margin: 8px 0; }
.feature-desc { color: var(--muted); font-size: 13px; line-height: 1.65; margin: 0; }

.quickstart { padding-bottom: 64px; }

/* ---- B4 数据条 ---- */
.stats { max-width: 1180px; }
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.stat {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--panel);
}
.stat-value { color: var(--brand); font-size: 26px; font-weight: 700; }
.stat-label { color: var(--ink); font-size: 13px; }
.stat-source { color: var(--dim); font-size: 11px; }

/* ---- B4 对标矩阵 ---- */
/* ---- B4 对标矩阵 ---- */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; }
.cmp-table { border-collapse: collapse; width: 100%; font-size: 13px; min-width: 640px; }
.cmp-table th { color: var(--ink); background: var(--panel2); padding: 10px 14px; text-align: left; white-space: nowrap; }
.cmp-table td { color: var(--muted); border-top: 1px solid var(--line); padding: 10px 14px; }
.cmp-dim { color: var(--ink); font-weight: 600; white-space: nowrap; }
.cmp-proteus { color: var(--ink); }
.cmp-status { color: var(--brand2); font-size: 11px; }
.cmp-note { color: var(--dim); font-size: 12px; margin-top: 10px; }
.method-body { color: var(--muted); font-size: 14px; line-height: 1.8; max-width: 720px; }
.method-body strong { color: var(--ink); }
.method-links { display: flex; gap: 18px; margin-top: 14px; }
.method-link { color: var(--brand2); text-decoration: none; font-size: 14px; }
.method-link:hover { text-decoration: underline; }
.qs-code {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 20px;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.8;
  overflow-x: auto;
}
.qs-dim { color: var(--dim); }
.qs-note { color: var(--muted); font-size: 13px; line-height: 1.7; max-width: 640px; }
</style>
