<script setup lang="ts">
// website/src/pages/Home.vue —— 官网首页（★对齐 website-plan/01-home.md 结构）
//   1. Hero（slogan + 副标题「透明编译 · AI-native · 产物可审计」+ 双 CTA）
//   2. 三大卖点（透明编译 / AI-native / 一份内容双端——≤20 字/条）
//   3. ★实时 Transform 演示（全站最核心交互——TransformDemo 内嵌）
//   4. 数字背书区（stats.ts 可追溯）+ 对标矩阵（状态诚实标注）
//   5. 快速开始（3 步）+ 方法论节
// ★D-2（#377）：布局标签 p-view/p-grid/p-heading/p-text/p-stack/p-button（禁裸 div 布局）
// ★W-6 柔性框架优先：v-p-fluid clamp + 柔性网格，零 @media
// ★G-24 桌面原语：v-p-hover 悬停语义（触屏天然降级）
import { STATS, COMPARE_MATRIX } from '../stats'
import TransformDemo from '../components/TransformDemo.vue'

const sellingPoints = [
  { title: '透明编译', desc: '每条转换规则独立可查，产物可反查源码' },
  { title: 'AI-native', desc: '规则自带 AI 说明书，Agent 产码可验证' },
  { title: '一份内容双端', desc: '标准 Vue SFC → Web SPA + 小程序四件套' },
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
  <p-page class="home">
    <!-- 1. Hero（01-home §1） -->
    <p-view v-p-fluid="'padding(56, 96)'" class="hero">
      <span class="eyebrow">◆ Proteus · 语义收敛的跨端应用框架</span>
      <p-heading :level="1" v-p-fluid="'font-size(22, 58)'" class="hero-title">
        One semantic model.<br /><em>Any render engine.</em> Zero native glue.
      </p-heading>
      <p-text v-p-fluid="'font-size(15, 19)'" class="hero-sub">
        透明编译 · AI-native · 产物可审计——把系统能力收敛成语义，
        让 Vue、Flutter、原生 UIKit/Jetpack/ArkUI、Skia 全部通过统一 SPI 插拔。
      </p-text>
      <p-stack direction="row" :gap="14" class="hero-cta">
        <router-link to="/docs/quick-start" class="cta-primary">
          <p-text class="cta-text">快速开始 →</p-text>
        </router-link>
        <router-link to="/playground" class="cta-ghost">
          <p-text class="cta-text">在线体验</p-text>
        </router-link>
      </p-stack>
    </p-view>

    <!-- 2. 三大卖点（01-home §2，≤20 字/条） -->
    <p-view v-p-fluid="'padding(24, 48)'" class="points">
      <div class="point-grid">
        <p-view v-for="p in sellingPoints" :key="p.title" class="point-card">
          <p-heading :level="3" class="point-title">{{ p.title }}</p-heading>
          <p-text class="point-desc">{{ p.desc }}</p-text>
        </p-view>
      </div>
    </p-view>

    <!-- 3. ★实时 Transform 演示（01-home §3 全站最核心交互） -->
    <p-view v-p-fluid="'padding(24, 48)'" class="live-demo">
      <span class="eyebrow">◆ 实时演示 · 透明编译</span>
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title">左边写标准 Vue，右边看编译器在想什么</p-heading>
      <TransformDemo compact />
      <p-text class="live-note">
        浏览器内实时编译——与本地 build 同一套 @proteus-vue/compiler；IR 为 G-29 NodeBackend 真实中间表示，非示意图。
        <router-link to="/playground" class="live-link">打开完整 Playground →</router-link>
      </p-text>
    </p-view>

    <!-- 4. 数字背书（stats.ts 可追溯） + 能力矩阵 -->
    <p-view v-p-fluid="'padding(24, 48)'" class="stats">
      <div class="stat-grid">
        <p-view v-for="s in STATS" :key="s.label" class="stat">
          <p-text class="stat-value">{{ s.value }}</p-text>
          <p-text class="stat-label">{{ s.label }}</p-text>
          <p-text class="stat-source">{{ s.source }}</p-text>
        </p-view>
      </div>
    </p-view>

    <p-view v-p-fluid="'padding(24, 48)'" class="features">
      <span class="eyebrow">◆ 杀手特性</span>
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title">语义是内核，后端是驱动</p-heading>
      <p-grid :min-col-width="280" :gap="14">
        <p-view v-for="c in capabilities" :key="c.tag" v-p-hover class="feature-card">
          <p-text class="feature-tag">{{ c.tag }}</p-text>
          <p-heading :level="3" class="feature-title">{{ c.title }}</p-heading>
          <p-text class="feature-desc">{{ c.desc }}</p-text>
        </p-view>
      </p-grid>
    </p-view>

    <!-- 对标矩阵（B4：positioning v3 §6——Proteus 列状态诚实标注） -->
    <p-view v-p-fluid="'padding(24, 48)'" class="compare">
      <span class="eyebrow">◆ 对标</span>
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title">不是又一个跨端方案，是方法论代际差</p-heading>
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
      <p-text class="cmp-note">状态标注：✅ 已落地可验证 · 🟡 部分落地 · 📋 规划已入库——明确边界比无限承诺更有说服力。</p-text>
    </p-view>

    <!-- 方法论 -->
    <p-view v-p-fluid="'padding(24, 48)'" class="method">
      <span class="eyebrow">◆ 方法论</span>
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title">SPI-First：九次泛化的同一个动作</p-heading>
      <p-text class="method-body">
        找到系统中所有「换 X 要改很多文件」的 X，把它们逐一提升为
        <strong>语义接口 + ≥2 后端 + conformance + 诚实边界</strong>，直到业务层对任何具体实现零知识。
        操作系统长出驱动模型、数据库长出存储引擎、编辑器长出插件系统——
        Proteus 只是把这个结构显式化、可重复、配上了验证手段。
      </p-text>
      <p-stack direction="row" :gap="18" class="method-links">
        <router-link to="/docs/semantic-model" class="method-link">统一语义收敛 →</router-link>
        <a class="method-link" href="https://github.com/proteus-vue/proteus/tree/main/docs/spi-first-methodology" target="_blank" rel="noreferrer">SPI-First 五步法 →</a>
      </p-stack>
    </p-view>

    <!-- 5. 快速开始（01-home §5：3 步） -->
    <p-view v-p-fluid="'padding(24, 48)'" class="quickstart">
      <span class="eyebrow">◆ 快速开始</span>
      <p-heading :level="2" v-p-fluid="'font-size(20, 30)'" class="section-title">两分钟跑通双端</p-heading>
      <pre class="qs-code"><code>npm create @proteus-vue/proteus my-app
cd my-app
npm run dev:web      <span class="qs-dim"># Web 端：标准 Vue SPA 直跑</span>
npm run build:mp     <span class="qs-dim"># 小程序端：Skyline 原生四件套</span></code></pre>
      <p-text class="qs-note">
        同一份标准 Vue SFC：Web 端由渲染后端直出 DOM，小程序端由编译器生成 WXML/WXSS/JS——
        接入 Native / Flutter 后端时，这行代码不改。
      </p-text>
    </p-view>
  </p-page>
</template>

<style scoped>
.hero { max-width: 860px; }
.eyebrow {
  color: var(--brand2);
  white-space: nowrap;
  font-size: 12px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px;
  display: inline-block;
}
.hero-title { color: var(--ink); line-height: 1.15; margin: 20px 0 16px; }
.hero-title em {
  font-style: normal;
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-sub { color: var(--muted); line-height: 1.7; margin: 0 0 28px; max-width: 640px; display: block; }
.hero-cta { align-items: center; }
.cta-primary {
  color: #0a0a0c;
  background: linear-gradient(100deg, var(--brand), var(--brand2));
  padding: 10px 20px;
  border-radius: 10px;
  text-decoration: none;
}
.cta-text { color: #0a0a0c; font-weight: 600; font-size: 14px; white-space: nowrap; }
.cta-ghost {
  border: 1px solid var(--line);
  padding: 10px 20px;
  border-radius: 10px;
  text-decoration: none;
}
.cta-ghost .cta-text { color: var(--ink); font-size: 14px; white-space: nowrap; }
.cta-ghost:hover, .cta-primary:hover { filter: brightness(1.1); }

.section-title { color: var(--ink); margin: 14px 0 22px; }
.point-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.point-card { border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: var(--panel); }
.point-title { color: var(--ink); margin: 0 0 8px; }
.point-desc { color: var(--muted); font-size: 13px; line-height: 1.65; }
.live-demo { max-width: 1180px; }
.live-note { color: var(--muted); font-size: 13px; display: block; margin-top: 12px; }
.live-link { color: var(--brand2); text-decoration: none; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.stat { border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--panel); }
.stat-value { color: var(--brand); font-size: 26px; font-weight: 700; }
.stat-label { color: var(--ink); font-size: 13px; }
.stat-source { color: var(--dim); font-size: 11px; }

.feature-card { border: 1px solid var(--line); border-radius: 14px; padding: 18px; background: var(--panel); }
.feature-tag { color: var(--brand2); font-size: 11px; letter-spacing: 1px; }
.feature-title { color: var(--ink); margin: 8px 0; }
.feature-desc { color: var(--muted); font-size: 13px; line-height: 1.65; }

.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; }
.cmp-table { border-collapse: collapse; width: 100%; font-size: 13px; min-width: 640px; }
.cmp-table th { color: var(--ink); background: var(--panel2); padding: 10px 14px; text-align: left; white-space: nowrap; }
.cmp-table td { color: var(--muted); border-top: 1px solid var(--line); padding: 10px 14px; }
.cmp-dim { color: var(--ink); font-weight: 600; white-space: nowrap; }
.cmp-proteus { color: var(--ink); }
.cmp-status { color: var(--brand2); font-size: 11px; }
.cmp-note { color: var(--dim); font-size: 12px; margin-top: 10px; display: block; }

.method-body { color: var(--muted); font-size: 14px; line-height: 1.8; max-width: 720px; display: block; }
.method-body strong { color: var(--ink); }
.method-links { align-items: center; }
.method-link { color: var(--brand2); text-decoration: none; font-size: 14px; }
.method-link:hover { text-decoration: underline; }

.quickstart { padding-bottom: 64px; }
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
.qs-note { color: var(--muted); font-size: 13px; line-height: 1.7; max-width: 640px; display: block; }
</style>
