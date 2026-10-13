<script setup lang="ts">
// website/src/pages/LiquidGlass.vue —— ★液态玻璃引擎产品页（代号 Aether · 决策 #882）
//
// 【这一页是什么】把「液态玻璃引擎（G-07）」当**产品**对外呈现——真跑演示（不是截图）：
//   ① 七预设实时渲染；② 强度/圆角/噪点/边框 交互调节；③ 端能力矩阵（诚实标注边界）；
//   ④ 三级降级真演示（`resolveGlassLevel` 纯函数，页面零平台 API）。
//
// 【数据从哪来（零手写）】预设表 / 强度档位 / 端能力矩阵 / 降级决策**全部来自 `@proteus-vue/glass`**
//   （纯逻辑 SSOT）——页面只做展示，不硬编码任何玻璃参数（与 Icons.vue 同纪律）。
//
// 【诚实边界（写在页面上）】Web/MP 走纯 CSS `backdrop-filter`（无边缘折射）；真折射 = 原生端自绘（决策 #877）。
import { computed, ref } from 'vue'
import {
  GLASS_PRESET_NAMES,
  GLASS_CAPABILITY,
  getGlassPreset,
  resolveGlass,
  resolveGlassLevel,
} from '@proteus-vue/glass'
import { locale } from '../i18n'

const isEn = computed(() => locale.value === 'en')

// —— ① 七预设（数据来自 glass 包）——
const presets = GLASS_PRESET_NAMES
const presetDesc: Record<string, [string, string]> = {
  navigationBar: ['顶部导航条', 'Top navigation bar'],
  tabBar: ['底部标签栏', 'Bottom tab bar'],
  modal: ['模态面板', 'Modal panel'],
  card: ['内容卡片', 'Content card'],
  floating: ['浮动控件', 'Floating control'],
  sidebar: ['侧边栏', 'Sidebar'],
  custom: ['自定义', 'Custom'],
}
const pdesc = (p: string) => (presetDesc[p] ?? [p, p])[isEn.value ? 1 : 0]

// —— ② 交互演示状态 ——
const preset = ref<string>('card')
const intensity = ref(1) // 数字直接用（0..2）
const radius = ref(16)
const noise = ref(0.04)
const border = ref(true)
const INTENSITY_NAMES: Array<[string, string]> = [
  ['none', '无'], ['thin', '薄'], ['regular', '常规'], ['thick', '厚'], ['ultra', '超厚'],
]
const intensityName = (k: string) => (INTENSITY_NAMES.find((x) => x[0] === k) ?? [k, k])[isEn.value ? 1 : 0]
const activePreset = computed(() => getGlassPreset(preset.value))
/** 交互演示的解析结果（页面消费 glass 包的唯一真源——与渲染层同源）。 */
const resolved = computed(() =>
  resolveGlass({
    preset: preset.value as never,
    intensity: intensity.value,
    radius: radius.value,
    noise: noise.value,
    border: border.value,
  }),
)

// —— ③ 端能力矩阵（数据来自 glass 包）——
const END_LABEL: Record<string, [string, string]> = {
  ios: ['iOS 原生', 'iOS native'],
  harmony: ['鸿蒙原生', 'HarmonyOS native'],
  android: ['Android 原生', 'Android native'],
  web: ['Web SPA', 'Web SPA'],
  skyline: ['微信小程序', 'WeChat Mini Program'],
}
const ends = Object.entries(GLASS_CAPABILITY)
const endLabel = (k: string) => (END_LABEL[k] ?? [k, k])[isEn.value ? 1 : 0]

// —— ④ 降级演示（resolveGlassLevel 纯函数）——
type DemoEnv = { key: string; label: [string, string]; env: Parameters<typeof resolveGlassLevel>[0] }
const DEMOS: DemoEnv[] = [
  { key: 'ios26', label: ['iOS 26（系统材质）', 'iOS 26 (system material)'], env: { platform: 'ios', systemMaterial: true, backdropFilter: true } },
  { key: 'ios15', label: ['iOS 15（无系统材质）', 'iOS 15 (no system material)'], env: { platform: 'ios', backdropFilter: true } },
  { key: 'web', label: ['Web（支持 backdrop-filter）', 'Web (backdrop-filter ok)'], env: { platform: 'web', backdropFilter: true } },
  { key: 'web-no', label: ['Web（不支持 backdrop-filter）', 'Web (no backdrop-filter)'], env: { platform: 'web', backdropFilter: false } },
  { key: 'low', label: ['低端机 / 减弱透明度', 'Low-tier / reduced transparency'], env: { platform: 'web', backdropFilter: true, reducedTransparency: true, tier: 'low' } },
]
const demos = DEMOS.map((d) => ({ ...d, level: resolveGlassLevel(d.env) }))
const demoLabel = (d: DemoEnv) => d.label[isEn.value ? 1 : 0]
/** 降级后实色（level==='solid' 时页面给实色块）。 */
const demoSolid = resolveGlass({ preset: 'card' }).solid
</script>

<template>
  <div class="lg-page">
    <header class="lg-head">
      <p class="lg-eyebrow">{{ isEn ? '◆ Liquid Glass Engine · Aether' : '◆ 液态玻璃引擎 · Aether' }}</p>
      <h2 class="lg-title">{{ isEn ? 'Liquid Glass Engine' : '液态玻璃引擎' }}</h2>
      <p class="lg-sub">
        {{
          isEn
            ? 'One declaration, every end. Glass algorithm is a single source (Rust WGSL → MSL / AGSL / SPIR-V); the API surface is the zero-dependency @proteus-vue/glass package. Native ends get real edge refraction (self-drawn glass pass); Web / Mini Program get CSS backdrop-filter (blur only). Business writes <pg-glass>; built-in Aether lg-* components render <pg-glass> internally.'
            : '一份声明，各端映射到该端最强实现。玻璃算法单源（Rust WGSL → MSL / AGSL / SPIR-V）；能力面 = 零依赖的 @proteus-vue/glass 包。原生端得真实边缘折射（自绘玻璃遍）；Web / 小程序得 CSS backdrop-filter（仅模糊）。业务写 <pg-glass>；内置 Aether lg-* 组件内部渲染 <pg-glass>。'
        }}
      </p>
      <div class="lg-tags">
        <span class="lg-tag">{{ isEn ? 'algorithm single-source' : '算法单源' }}</span>
        <span class="lg-tag">{{ isEn ? '3 native backends' : '三端原生后端' }}</span>
        <span class="lg-tag">{{ isEn ? 'zero-dependency core' : '零依赖内核' }}</span>
        <span class="lg-tag">{{ isEn ? 'auto degradation' : '自动降级' }}</span>
      </div>
    </header>

    <!-- ① 七预设（真渲染 <pg-glass>） -->
    <section class="lg-sec">
      <h3 class="lg-h3">{{ isEn ? 'Presets' : '预设' }}</h3>
      <p class="lg-note">{{ isEn ? 'Seven built-in presets (from @proteus-vue/glass). Rendered live below.' : '七内置预设（来自 @proteus-vue/glass），下方为实时渲染。' }}</p>
      <div class="lg-stage">
        <div class="lg-backdrop" aria-hidden="true" />
        <div class="lg-grid">
          <pg-glass v-for="p in presets" :key="p" preset="card" :radius="14" class="lg-cell">
            <div class="lg-cell-in">
              <span class="lg-cell-k">{{ p }}</span>
              <span class="lg-cell-d">{{ pdesc(p) }}</span>
            </div>
          </pg-glass>
        </div>
      </div>
    </section>

    <!-- ② 交互演示 -->
    <section class="lg-sec">
      <h3 class="lg-h3">{{ isEn ? 'Interactive' : '交互演示' }}</h3>
      <div class="lg-play">
        <div class="lg-controls">
          <label class="lg-ctl">
            <span class="lg-ctl-k">{{ isEn ? 'preset' : '预设' }}</span>
            <select v-model="preset" class="lg-select">
              <option v-for="p in presets" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label class="lg-ctl">
            <span class="lg-ctl-k">{{ isEn ? 'intensity' : '强度' }}</span>
            <input v-model.number="intensity" type="range" min="0" max="2" step="0.1" class="lg-range" />
            <span class="lg-ctl-v">{{ intensity.toFixed(1) }} · {{ intensityName(resolved.intensity) }}</span>
          </label>
          <label class="lg-ctl">
            <span class="lg-ctl-k">{{ isEn ? 'radius' : '圆角' }}</span>
            <input v-model.number="radius" type="range" min="0" max="48" step="1" class="lg-range" />
            <span class="lg-ctl-v">{{ radius }}px</span>
          </label>
          <label class="lg-ctl">
            <span class="lg-ctl-k">{{ isEn ? 'noise' : '噪点' }}</span>
            <input v-model.number="noise" type="range" min="0" max="0.2" step="0.01" class="lg-range" />
            <span class="lg-ctl-v">{{ resolved.noise.toFixed(2) }}</span>
          </label>
          <label class="lg-ctl lg-ctl--row">
            <input v-model="border" type="checkbox" />
            <span class="lg-ctl-k">{{ isEn ? 'border' : '高光边' }}</span>
          </label>
        </div>
        <div class="lg-stage lg-stage--play">
          <div class="lg-backdrop" aria-hidden="true" />
          <pg-glass
            :preset="preset"
            :intensity="intensity"
            :radius="radius"
            :noise="noise"
            :border="border"
            class="lg-demo-glass"
          >
            <div class="lg-demo-in">
              <span class="lg-demo-t">{{ isEn ? 'Glass panel' : '玻璃面板' }}</span>
              <span class="lg-demo-s">blur {{ resolved.blurPx }}px · radius {{ resolved.radiusPx }}px · {{ resolved.intensity }}</span>
            </div>
          </pg-glass>
        </div>
      </div>
    </section>

    <!-- ③ 端能力矩阵（诚实标注） -->
    <section class="lg-sec">
      <h3 class="lg-h3">{{ isEn ? 'Per-end capability' : '端能力矩阵' }}</h3>
      <p class="lg-note">
        {{
          isEn
            ? 'Honest boundary: real edge refraction is native-only (self-drawn glass pass). Web / Mini Program use CSS backdrop-filter — blur + tint + radius, no refraction.'
            : '诚实边界：真实边缘折射仅原生端（自绘玻璃遍）。Web / 小程序走 CSS backdrop-filter —— 模糊 + 着色 + 圆角，无折射。'
        }}
      </p>
      <div class="lg-matrix">
        <div v-for="[k, gate] in ends" :key="k" class="lg-mrow">
          <span class="lg-m-end">{{ endLabel(k) }}</span>
          <span class="lg-m-badge" :class="{ 'lg-m-badge--l3': gate.l3 }">{{ gate.l3 ? (isEn ? 'L3 system material' : 'L3 系统材质') : (isEn ? 'L1–L2 self/CSS' : 'L1–L2 自绘/CSS') }}</span>
          <span class="lg-m-note">{{ (gate.l3 ? (isEn ? 'since ' : '自 ') + gate.l3 : (isEn ? 'no system material' : '无系统材质')) }}</span>
        </div>
      </div>
    </section>

    <!-- ④ 降级演示（resolveGlassLevel） -->
    <section class="lg-sec">
      <h3 class="lg-h3">{{ isEn ? 'Degradation' : '降级演示' }}</h3>
      <p class="lg-note">{{ isEn ? 'resolveGlassLevel() picks the highest reachable level; unsupported → solid (never blank/black).' : 'resolveGlassLevel() 选最高可达层级；能力不足 → 实色（绝不白屏/黑块）。' }}</p>
      <div class="lg-demos">
        <div v-for="d in demos" :key="d.key" class="lg-dcell">
          <div class="lg-dbox" :style="{ background: d.level === 'solid' ? demoSolid : undefined }">
            <div v-if="d.level !== 'solid'" class="lg-backdrop lg-backdrop--mini" aria-hidden="true" />
            <pg-glass v-if="d.level !== 'solid'" preset="card" :radius="12" class="lg-dglass">
              <span class="lg-dt">{{ d.level.toUpperCase() }}</span>
            </pg-glass>
            <span v-else class="lg-dt lg-dt--solid">{{ isEn ? 'SOLID' : '实色' }}</span>
          </div>
          <span class="lg-dlabel">{{ demoLabel(d) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lg-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 20px 72px;
}
.lg-head {
  margin-bottom: 26px;
}
.lg-eyebrow {
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--brand-ink);
  margin-bottom: 8px;
}
.lg-title {
  font-size: 30px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.4px;
}
.lg-sub {
  margin-top: 10px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
  max-width: 900px;
}
.lg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.lg-tag {
  font-size: 12px;
  color: var(--brand-ink);
  background: var(--brand-soft);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px;
}
.lg-sec {
  margin-top: 34px;
}
.lg-h3 {
  font-size: 18px;
  font-weight: 650;
  color: var(--ink);
  margin-bottom: 6px;
}
.lg-note {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  margin-bottom: 14px;
  max-width: 880px;
}
/* 玻璃舞台：需有背景可透出，否则 backdrop-filter 无从体现 */
.lg-stage {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  padding: 22px;
  border: 1px solid var(--line);
}
.lg-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 80% at 18% 22%, rgba(124, 92, 255, 0.55), transparent 60%),
    radial-gradient(55% 70% at 82% 30%, rgba(60, 200, 180, 0.5), transparent 62%),
    radial-gradient(70% 90% at 60% 88%, rgba(230, 120, 90, 0.5), transparent 60%),
    linear-gradient(135deg, #1a1a24, #101018);
}
.lg-grid {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.lg-cell {
  flex: 0 0 168px;
  min-width: 0;
}
.lg-cell-in {
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lg-cell-k {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  font-family: var(--mono);
}
.lg-cell-d {
  font-size: 12px;
  color: var(--muted);
}
/* 交互演示 */
.lg-play {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: stretch;
}
.lg-controls {
  flex: 1 1 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
}
.lg-ctl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
}
.lg-ctl--row {
  justify-content: flex-start;
}
.lg-ctl-k {
  color: var(--ink);
  font-size: 12px;
  flex: 0 0 62px;
}
.lg-ctl-v {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--brand-ink);
  margin-left: auto;
  min-width: 84px;
  text-align: right;
}
.lg-select,
.lg-range {
  flex: 1 1 120px;
  min-width: 0;
}
.lg-select {
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel2);
  color: var(--ink);
  font-size: 13px;
  padding: 0 8px;
}
.lg-range {
  accent-color: var(--brand);
}
.lg-stage--play {
  flex: 1 1 320px;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lg-demo-glass {
  position: relative;
  min-width: 220px;
}
.lg-demo-in {
  padding: 26px 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lg-demo-t {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}
.lg-demo-s {
  font-size: 12px;
  color: var(--muted);
  font-family: var(--mono);
}
/* 矩阵 */
.lg-matrix {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.lg-mrow {
  flex: 1 1 210px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.lg-m-end {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.lg-m-badge {
  align-self: flex-start;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--panel2);
  border: 1px solid var(--line);
}
.lg-m-badge--l3 {
  color: var(--brand-ink);
  background: var(--brand-soft);
}
.lg-m-note {
  font-size: 12px;
  color: var(--muted);
}
/* 降级 */
.lg-demos {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.lg-dcell {
  flex: 0 0 220px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lg-dbox {
  position: relative;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lg-backdrop--mini {
  background:
    radial-gradient(60% 90% at 25% 30%, rgba(124, 92, 255, 0.6), transparent 62%),
    radial-gradient(70% 90% at 78% 75%, rgba(60, 200, 180, 0.55), transparent 60%),
    linear-gradient(135deg, #1a1a24, #101018);
}
.lg-dglass {
  position: relative;
}
.lg-dt {
  display: block;
  padding: 14px 22px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  font-family: var(--mono);
}
.lg-dt--solid {
  color: var(--ink);
}
.lg-dlabel {
  font-size: 12px;
  color: var(--muted);
}
</style>
