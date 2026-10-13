<script setup lang="ts">
// website/src/pages/LiquidGlass.vue —— ★★★液态玻璃引擎产品页（代号 Aether · 决策 #884）
//
// 【★旗舰产品页形态（对齐 /themis、/animation）】Hero（一句主张 + CTA + 定位 pills + 签名视觉）
//   + 叙事分节（§01 缘起 … §10 边界与禁语）+ 数字/证据链 + CTA。
//   ★签名主张 = 「**一份声明，各端最强玻璃**」——同一份 `<pg-glass>` 声明，各端映射到该端最强实现
//     （原生端自绘玻璃遍 = 真边缘折射；Web / 小程序 = CSS backdrop-filter）。签名视觉 = 四端并排。
//
// 【★数据纪律（与 /themis 同源精神）】预设 / 强度档位 / 端能力矩阵 / 降级决策**全部来自
//   `@proteus-vue/glass`**（纯逻辑 SSOT）——本页**零硬编码玻璃参数**；引擎改了页面自动跟。
//
// 【诚实边界（写进页面 §10）】Web / 小程序 = 纯 CSS，**无边缘折射**（决策 #877）；原生真折射的
//   真机截图属端到端验收（G0），本页为 Web 端真渲染。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  GLASS_PRESET_NAMES,
  GLASS_INTENSITY_SCALE,
  GLASS_CAPABILITY,
  getGlassPreset,
  resolveGlass,
  resolveGlassLevel,
} from '@proteus-vue/glass'
import { locale } from '../i18n'
import FeatureIcon from '../components/FeatureIcon.vue'

const isEn = computed(() => locale.value === 'en')

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

/* ══════════ Hero 签名：四端并排（一份声明 → 各端最强） ══════════ */
const endsRow = computed(() => {
  const zh = !isEn.value
  return [
    { k: 'iOS', mode: zh ? '自绘玻璃遍 · 真边缘折射' : 'self-drawn pass · real refraction', native: true },
    { k: 'Android', mode: zh ? '自绘玻璃遍 · 真边缘折射' : 'self-drawn pass · real refraction', native: true },
    { k: '鸿蒙', mode: zh ? '离屏 Vulkan · 真边缘折射' : 'offscreen Vulkan · real refraction', native: true },
    { k: 'Web / 小程序', mode: zh ? 'CSS backdrop-filter · 仅模糊' : 'CSS backdrop-filter · blur only', native: false },
  ]
})

/* ══════════ §01 缘起（三端过去的做法） ══════════ */
const past = computed(() => {
  const zh = !isEn.value
  return [
    { k: 'iOS', d: zh ? '手写 CoreImage kernel / UIVisualEffectView（随系统版本变）' : 'hand-written CoreImage kernel / UIVisualEffectView (varies by OS)' },
    { k: 'Android', d: zh ? '手写 AGSL 串（<31 无 RenderEffect，各 ROM 行为不一）' : 'hand-written AGSL (no RenderEffect <31; ROMs differ)' },
    { k: '鸿蒙', d: zh ? 'CPU 移植或系统材质（跨进程取不到背后像素）' : 'CPU port or system material (can’t read backdrop cross-process)' },
    { k: 'Web / 小程序', d: zh ? '散落页面的裸 backdrop-filter（无障碍/降级无人处理）' : 'raw backdrop-filter scattered in pages' },
  ]
})

/* ══════════ §02 三层承诺（L1/L2/L3） ══════════ */
const tiers = computed(() => {
  const zh = !isEn.value
  return [
    { lv: 'L1', t: zh ? '基础玻璃' : 'Base glass', d: zh ? 'blur + tint + radius + border' : 'blur + tint + radius + border', who: zh ? '全端必达' : 'all ends' },
    { lv: 'L2', t: zh ? '高级质感' : 'Rich texture', d: zh ? '噪点层 + 高光边 + 滚动联动' : 'noise + highlight edge + scroll coupling', who: zh ? 'Web / 小程序（CSS）' : 'Web / Mini Program (CSS)' },
    { lv: 'L3', t: zh ? '真实折射' : 'Real refraction', d: zh ? '边缘倒角厚板 · 折射 + 磨砂 + Fresnel 高光' : 'beveled slab · refraction + frost + Fresnel', who: zh ? '原生端（自绘玻璃遍）' : 'native (self-drawn pass)' },
  ]
})

/* ══════════ §03 一份算法，三端自绘（管线） ══════════ */
const pipeline = computed(() => {
  const zh = !isEn.value
  return [
    { n: '01', t: zh ? '一份 WGSL（Rust 内核的真源）' : 'one WGSL (Rust source of truth)' },
    { n: '02', t: zh ? 'naga 落地 · MSL / AGSL / SPIR-V' : 'naga lowering · MSL / AGSL / SPIR-V' },
    { n: '03', t: zh ? '宿主编译生成物 · 建管线' : 'host compiles generated shader · builds the pipeline' },
    { n: '04', t: zh ? '捕获背后内容 → 玻璃遍 → 贴回' : 'capture backdrop → glass pass → composite' },
  ]
})

/* ══════════ §04 七预设（真渲染） ══════════ */
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

/* ══════════ §05 交互调参（真渲染） ══════════ */
const preset = ref<string>('card')
const intensity = ref(1)
const radius = ref(16)
const noise = ref(0.04)
const border = ref(true)
const INTENSITY_NAMES: Array<[string, string]> = [['none', '无'], ['thin', '薄'], ['regular', '常规'], ['thick', '厚'], ['ultra', '超厚']]
const intensityName = (k: string) => (INTENSITY_NAMES.find((x) => x[0] === k) ?? [k, k])[isEn.value ? 1 : 0]
const resolved = computed(() =>
  resolveGlass({ preset: preset.value as never, intensity: intensity.value, radius: radius.value, noise: noise.value, border: border.value }),
)

/* ══════════ §06 端能力矩阵（诚实） ══════════ */
const END_LABEL: Record<string, [string, string]> = {
  ios: ['iOS 原生', 'iOS native'], harmony: ['鸿蒙原生', 'HarmonyOS native'], android: ['Android 原生', 'Android native'],
  web: ['Web SPA', 'Web SPA'], skyline: ['微信小程序', 'WeChat Mini Program'],
}
const ends = Object.entries(GLASS_CAPABILITY)
const endLabel = (k: string) => (END_LABEL[k] ?? [k, k])[isEn.value ? 1 : 0]

/* ══════════ §07 降级不崩溃（真决策） ══════════ */
type DemoEnv = { key: string; label: [string, string]; env: Parameters<typeof resolveGlassLevel>[0] }
const DEMOS: DemoEnv[] = [
  { key: 'ios26', label: ['iOS 26（系统材质可用）', 'iOS 26 (system material)'], env: { platform: 'ios', systemMaterial: true, backdropFilter: true } },
  { key: 'ios15', label: ['iOS 15（无系统材质）', 'iOS 15 (no system material)'], env: { platform: 'ios', backdropFilter: true } },
  { key: 'web', label: ['Web（支持 backdrop-filter）', 'Web (backdrop-filter ok)'], env: { platform: 'web', backdropFilter: true } },
  { key: 'no', label: ['Web（无 backdrop-filter）', 'Web (no backdrop-filter)'], env: { platform: 'web', backdropFilter: false } },
  { key: 'low', label: ['低端机 / 减弱透明度', 'Low-tier / reduced transparency'], env: { platform: 'web', backdropFilter: true, reducedTransparency: true, tier: 'low' } },
]
const demos = DEMOS.map((d) => ({ ...d, level: resolveGlassLevel(d.env) }))
const demoLabel = (d: DemoEnv) => d.label[isEn.value ? 1 : 0]
const demoSolid = resolveGlass({ preset: 'card' }).solid

/* ══════════ §08 横向对照 ══════════ */
const compareHead = computed(() => (isEn.value ? ['Dimension', 'Aether (Proteus)', 'Hand-written per end', 'CSS-only library'] : ['维度', 'Aether（Proteus）', '各端手写着色器', '纯 CSS 库']))
const compareRows = computed<Array<{ dim: string; cells: string[] }>>(() => {
  const zh = !isEn.value
  return [
    { dim: zh ? '算法来源' : 'Algorithm source', cells: zh ? ['一份 Rust WGSL（单源）', '三份手写（iOS/Android/鸿蒙 各一份，必然漂移）', '无（仅 CSS）'] : ['one Rust WGSL (single source)', 'three hand-written copies (drift)'] },
    { dim: zh ? '衰减一致性' : 'Drift control', cells: zh ? ['四端生成物 + 像素等价门禁（MSL ⇄ CPU oracle）', '无（各写各的）', '—'] : ['generated + pixel-equivalence gate (MSL ⇄ CPU oracle)', 'none'] },
    { dim: zh ? '真边缘折射' : 'Real refraction', cells: zh ? ['原生端自绘玻璃遍', '需自研（且三端各异）', '❌ 无'] : ['native self-drawn pass', 'must self-build (per end)'] },
    { dim: zh ? '降级不崩溃' : 'Never blank', cells: zh ? ['三级降级（设备/版本/性能）+ 无障碍偏好 → 实色', '常白块/黑块', '视实现'] : ['three-tier + a11y pref → solid', 'often blank'] },
    { dim: zh ? '治理' : 'Governance', cells: zh ? ['audit glass（裸 backdrop-filter 即红）+ 能力/像素门禁', '无', '无'] : ['audit glass (raw backdrop-filter fails) + gates', 'none'] },
  ]
})

/* ══════════ §09 证据链 ══════════ */
const evidence = computed(() => {
  const zh = !isEn.value
  return [
    { k: zh ? '算法真源（Rust WGSL）+ 四端生成物一致' : 'algorithm source (Rust WGSL) + generated parity', v: 'packages/shader-codegen-rust/src/materials/glass.wgsl', gate: 'check:shader-generated' },
    { k: zh ? '宿主无残留手写着色器' : 'no hand-written shaders in hosts', v: 'hosts/{ios,android,harmony}/**', gate: 'check:shader-capability' },
    { k: zh ? 'Metal 落地 ⇄ CPU oracle 逐像素等价' : 'Metal landing ⇄ CPU oracle pixel parity', v: 'hosts/ios/lib/glass-metal-parity.swift', gate: 'check:glass-pixel-parity' },
    { k: zh ? '鸿蒙 SPIR-V ⇄ oracle（真机）' : 'HarmonyOS SPIR-V ⇄ oracle (device)', v: 'hosts/harmony/check-glass-parity.sh', gate: 'check:glass-parity-harmony' },
    { k: zh ? 'tab 栏玻璃值 = glass 包预设（单源）' : 'tab-bar glass == glass preset (single source)', v: 'packages/render-backend/src/tab-bar-spec.ts', gate: 'check:glass-capability' },
    { k: zh ? '单入口铁律（裸 backdrop-filter 即红）' : 'single-entry rule (raw backdrop-filter fails)', v: 'packages/cli/src/glass-audit.ts', gate: 'check:glass-audit' },
    { k: zh ? '产物自省（折叠玻璃清单）' : 'artifact introspection (folded glass manifest)', v: 'dist/app/<platform>/glass-manifest.json', gate: 'proteus build' },
  ]
})

const notDoing = computed(() => (isEn.value
  ? ['Web / Mini Program have no edge refraction — pure CSS, honest boundary (decision #877)', 'Pixel-identical glass across ends is not promised (native material vs CSS differ by nature)', 'Third-party glass libraries are not wrapped (OS-level only via the native self-drawn pass)']
  : ['Web / 小程序**无边缘折射**——纯 CSS，诚实边界（决策 #877）', '不承诺「各端玻璃逐像素一致」（原生材质与 CSS 本质不同）', '不做第三方玻璃库套壳（OS 级仅经原生自绘玻璃遍）']))
const forbidden = computed(() => (isEn.value
  ? ['Never “all ends look identical” — native is refraction, Web/MP is blur only', 'Never “pixel-perfect”', 'Never “works on every old device” — low-tier degrades to solid (that is the promise, not a failure)']
  : ['不得说「各端看起来一样」——原生是折射，Web/小程序只有模糊', '不得说「像素级一致」', '不得说「所有老旧设备都能跑」——低端降级实色（这正是承诺，不是失败）']))
</script>

<template>
  <p-page ref="rootEl" class="lgp">
    <!-- 背景层：柔和光晕（玻璃页面主题） -->
    <div class="lgp-bg" aria-hidden="true" />

    <div class="lgp-wrap">
      <!-- ═══ Hero（一句主张 + 签名视觉：四端并排） ═══ -->
      <p-grid :min-col-width="380" :gap="52" class="hero">
        <div class="hero-copy">
          <span class="chip"><FeatureIcon name="layers" />{{ isEn ? 'LIQUID GLASS ENGINE' : '液态玻璃引擎' }} · AETHER</span>
          <h1 class="hero-h1">
            <span class="h1-l1">{{ isEn ? 'One declaration.' : '一份声明。' }}</span>
            <span class="h1-l2">{{ isEn ? 'Every end’s strongest glass.' : '各端最强玻璃。' }}</span>
          </h1>
          <p class="hero-lead">
            {{ isEn
              ? 'Write <pg-glass> once. Native ends render real edge refraction (a self-drawn glass pass from a single Rust WGSL); Web and Mini Program map to CSS backdrop-filter. The algorithm is one source; the API core is a zero-dependency package.'
              : '只写一次 <pg-glass>。原生端渲染真实边缘折射（由一份 Rust WGSL 自绘玻璃遍）；Web 与小程序映射到 CSS backdrop-filter。算法单一真源；API 内核零依赖。' }}
          </p>
          <div class="hero-cta">
            <a href="#presets" class="btn btn-primary">{{ isEn ? 'See the seven presets' : '看七预设' }}</a>
            <router-link to="/docs/31-liquid-glass" class="btn btn-ghost">{{ isEn ? 'Integration guide' : '接入文档' }}</router-link>
            <router-link to="/playground" class="btn btn-ghost">Playground</router-link>
          </div>
          <div class="hero-pills">
            <span class="pill">{{ isEn ? 'algorithm single-source' : '算法单源' }}</span>
            <span class="pill">{{ isEn ? '3 native backends' : '三端原生后端' }}</span>
            <span class="pill">{{ isEn ? 'zero-dependency core' : '零依赖内核' }}</span>
            <span class="pill">{{ isEn ? 'never blank' : '降级不崩溃' }}</span>
          </div>
        </div>

        <!-- 签名视觉：四端并排（同一份声明） -->
        <div class="ends-stage">
          <div class="ends-backdrop" aria-hidden="true" />
          <div class="ends-grid">
            <div v-for="(e, i) in endsRow" :key="e.k" class="ends-cell" :style="{ '--stagger-i': String(i) }">
              <pg-glass preset="card" :radius="12" :noise="0.03" class="ends-glass">
                <div class="ends-in">
                  <span class="ends-k">{{ e.k }}</span>
                  <span class="ends-mode" :class="{ 'ends-mode--native': e.native }">{{ e.mode }}</span>
                </div>
              </pg-glass>
            </div>
          </div>
          <p class="ends-note">{{ isEn ? 'Same <pg-glass preset="card" /> — mapped per end. Native shots are device evidence (E2E); this page is real Web rendering.' : '同一份 <pg-glass preset="card" />——逐端映射。原生端截图为真机证据（端到端）；本页为 Web 真渲染。' }}</p>
        </div>
      </p-grid>

      <!-- ═══ §01 缘起 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§01</span><h2 class="sec-title">{{ isEn ? 'The case' : '缘起' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'Glass used to be three unrelated implementations — a hand-written shader on each native end, a raw backdrop-filter scattered across Web/Mini Program pages. Three copies drift; nothing watches accessibility or degradation.'
            : '玻璃过去是三套互不相干的实现——每个原生端一份手写着色器、Web/小程序页面散落裸 backdrop-filter。三份实现必然漂移；无障碍与降级无人处理。' }}
        </p>
        <p-grid :min-col-width="240" :gap="14">
          <div v-for="(p, i) in past" :key="p.k" class="end-card" :style="{ '--stagger-i': String(i) }">
            <span class="end-k">{{ p.k }}</span>
            <p class="end-d">{{ p.d }}</p>
          </div>
        </p-grid>
      </section>

      <!-- ═══ §02 三层承诺 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§02</span><h2 class="sec-title">{{ isEn ? 'Three tiers' : '三层承诺' }}</h2><span class="sec-line" /></header>
        <p-grid :min-col-width="280" :gap="16">
          <div v-for="(t, i) in tiers" :key="t.lv" class="claim" :style="{ '--stagger-i': String(i) }">
            <div class="claim-head"><span class="claim-no">{{ t.lv }}</span><span class="card-ic"><FeatureIcon name="layers" /></span></div>
            <h3 class="claim-t">{{ t.t }}</h3>
            <p class="claim-d">{{ t.d }}</p>
            <span class="claim-who">{{ t.who }}</span>
          </div>
        </p-grid>
      </section>

      <!-- ═══ §03 一份算法，三端自绘 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§03</span><h2 class="sec-title">{{ isEn ? 'One algorithm, three ends' : '一份算法，三端自绘' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">
          {{ isEn
            ? 'The glass algorithm is written once, in Rust WGSL, and lowered by naga into Metal(MSL), AGSL and SPIR-V. Every host compiles the generated shader — no host hand-writes glass. Change the WGSL and all ends follow.'
            : '玻璃算法只写一次（Rust WGSL），由 naga 落成 Metal(MSL) / AGSL / SPIR-V。各端宿主编译生成物——没有任何宿主手写玻璃。改 WGSL，三端一起变。' }}
        </p>
        <div class="pipe">
          <div class="pipe-rail">
            <div v-for="(s, i) in pipeline" :key="s.n" class="pipe-step" :style="{ '--stagger-i': String(i) }">
              <span class="pipe-n">{{ s.n }}</span><span class="pipe-t">{{ s.t }}</span>
            </div>
          </div>
          <div class="pipe-out"><span class="po-arrow">▼</span><code class="po-ir">glass.wgsl → MSL · AGSL · SPIR-V</code></div>
          <div class="pipe-ends"><span class="pipe-end">iOS Metal</span><span class="pipe-end">Android AGSL</span><span class="pipe-end">鸿蒙 Vulkan</span></div>
          <div class="pipe-gate">{{ isEn ? 'pixel-equivalence gate · MSL ⇄ CPU oracle' : '像素等价门禁 · MSL ⇄ CPU oracle' }}</div>
        </div>
      </section>

      <!-- ═══ §04 七预设（真渲染） ═══ -->
      <section id="presets" data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§04</span><h2 class="sec-title">{{ isEn ? 'Seven presets' : '七预设' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">{{ isEn ? 'Seven built-in presets, straight from @proteus-vue/glass. Live below.' : '七内置预设，直接来自 @proteus-vue/glass。下方为实时渲染。' }}</p>
        <div class="stage">
          <div class="stage-backdrop" aria-hidden="true" />
          <div class="stage-grid">
            <pg-glass v-for="p in presets" :key="p" preset="card" :radius="14" class="stage-cell">
              <div class="stage-in"><span class="stage-k">{{ p }}</span><span class="stage-d">{{ pdesc(p) }}</span></div>
            </pg-glass>
          </div>
        </div>
      </section>

      <!-- ═══ §05 交互调参（真渲染） ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§05</span><h2 class="sec-title">{{ isEn ? 'Tune it live' : '交互调参' }}</h2><span class="sec-line" /></header>
        <div class="play">
          <div class="controls">
            <label class="ctl"><span class="ctl-k">{{ isEn ? 'preset' : '预设' }}</span>
              <select v-model="preset" class="select"><option v-for="p in presets" :key="p" :value="p">{{ p }}</option></select>
            </label>
            <label class="ctl"><span class="ctl-k">{{ isEn ? 'intensity' : '强度' }}</span>
              <input v-model.number="intensity" type="range" min="0" max="2" step="0.1" class="range" />
              <span class="ctl-v">{{ intensity.toFixed(1) }} · {{ intensityName(resolved.intensity) }}</span>
            </label>
            <label class="ctl"><span class="ctl-k">{{ isEn ? 'radius' : '圆角' }}</span>
              <input v-model.number="radius" type="range" min="0" max="48" step="1" class="range" />
              <span class="ctl-v">{{ radius }}px</span>
            </label>
            <label class="ctl"><span class="ctl-k">{{ isEn ? 'noise' : '噪点' }}</span>
              <input v-model.number="noise" type="range" min="0" max="0.2" step="0.01" class="range" />
              <span class="ctl-v">{{ resolved.noise.toFixed(2) }}</span>
            </label>
            <label class="ctl ctl--row"><input v-model="border" type="checkbox" /><span class="ctl-k">{{ isEn ? 'highlight edge' : '高光边' }}</span></label>
          </div>
          <div class="stage stage--play">
            <div class="stage-backdrop" aria-hidden="true" />
            <pg-glass :preset="preset" :intensity="intensity" :radius="radius" :noise="noise" :border="border" class="demo-glass">
              <div class="demo-in">
                <span class="demo-t">{{ isEn ? 'Glass panel' : '玻璃面板' }}</span>
                <span class="demo-s">blur {{ resolved.blurPx }}px · radius {{ resolved.radiusPx }}px · {{ resolved.intensity }}</span>
              </div>
            </pg-glass>
          </div>
        </div>
      </section>

      <!-- ═══ §06 端能力矩阵 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§06</span><h2 class="sec-title">{{ isEn ? 'Per-end capability' : '端能力矩阵' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">{{ isEn ? 'Honest per-end table (from @proteus-vue/glass). Real edge refraction is native-only; Web / Mini Program stop at CSS.' : '诚实的端能力表（来自 @proteus-vue/glass）。真实边缘折射仅原生端；Web / 小程序止步于 CSS。' }}</p>
        <div class="matrix">
          <div v-for="[k, gate] in ends" :key="k" class="mrow">
            <span class="m-end">{{ endLabel(k) }}</span>
            <span class="m-badge" :class="{ 'm-badge--l3': gate.l3 }">{{ gate.l3 ? (isEn ? 'L3 system material' : 'L3 系统材质') : (isEn ? 'L1–L2 self / CSS' : 'L1–L2 自绘 / CSS') }}</span>
            <span class="m-note">{{ gate.l3 ? (isEn ? 'since ' : '自 ') + gate.l3 : (isEn ? 'no system material' : '无系统材质') }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ §07 降级不崩溃 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§07</span><h2 class="sec-title">{{ isEn ? 'Never blank' : '降级不崩溃' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">{{ isEn ? 'resolveGlassLevel() picks the highest reachable level; when a capability is missing it degrades to solid — never blank, never black.' : 'resolveGlassLevel() 选最高可达层级；能力不足一律降实色——绝不白屏、绝不黑块。' }}</p>
        <div class="demos">
          <div v-for="d in demos" :key="d.key" class="dcell">
            <div class="dbox" :style="{ background: d.level === 'solid' ? demoSolid : undefined }">
              <div v-if="d.level !== 'solid'" class="dbackdrop" aria-hidden="true" />
              <pg-glass v-if="d.level !== 'solid'" preset="card" :radius="12" class="dglass"><span class="dt">{{ d.level.toUpperCase() }}</span></pg-glass>
              <span v-else class="dt dt--solid">{{ isEn ? 'SOLID' : '实色' }}</span>
            </div>
            <span class="dlabel">{{ demoLabel(d) }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ §08 横向对照 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§08</span><h2 class="sec-title">{{ isEn ? 'Cross-examination' : '横向对照' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">{{ isEn ? 'The difference is not “we have glass too” — it is that the algorithm has one source and every end was proven equivalent by a gate.' : '区别不在「我们也有玻璃」——而在算法只有一个源头，且每一端都被门禁证明过等价。' }}</p>
        <div class="table">
          <div class="tr th"><span v-for="(h, i) in compareHead" :key="h" :class="{ 'col-win': i === 1 }">{{ h }}</span></div>
          <div v-for="r in compareRows" :key="r.dim" class="tr">
            <span class="td-dim">{{ r.dim }}</span>
            <span v-for="(c, i) in r.cells" :key="i" class="td" :class="{ 'col-win': i === 0 }">{{ c }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ §09 证据链 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§09</span><h2 class="sec-title">{{ isEn ? 'Chain of evidence' : '证据链' }}</h2><span class="sec-line" /></header>
        <p class="sec-note">{{ isEn ? 'Every claim above traces to a gate.' : '上面每条主张，都对应一道门禁。' }}</p>
        <div class="ev">
          <div v-for="e in evidence" :key="e.v + e.gate" class="ev-row">
            <span class="ev-k">{{ e.k }}</span><code class="ev-v">{{ e.v }}</code><span class="ev-gate">{{ e.gate }}</span>
          </div>
        </div>
      </section>

      <!-- ═══ §10 边界与禁语 ═══ -->
      <section data-reveal class="sec">
        <header class="sec-head"><span class="sec-k">§10</span><h2 class="sec-title">{{ isEn ? 'Limits & wording' : '边界与禁语' }}</h2><span class="sec-line" /></header>
        <p-grid :min-col-width="300" :gap="16">
          <div class="bound" :style="{ '--stagger-i': '0' }">
            <span class="bound-h">{{ isEn ? 'Honest boundary' : '诚实边界' }}</span>
            <ul class="bound-list"><li v-for="(b, i) in notDoing" :key="i">{{ b }}</li></ul>
          </div>
          <div class="bound bound--ban" :style="{ '--stagger-i': '1' }">
            <span class="bound-h">{{ isEn ? 'Never say' : '禁语' }}</span>
            <ul class="bound-list"><li v-for="(f, i) in forbidden" :key="i">{{ f }}</li></ul>
          </div>
        </p-grid>
      </section>

      <!-- ═══ CTA ═══ -->
      <section data-reveal class="sec cta">
        <span class="cta-seal" aria-hidden="true">AETHER</span>
        <h2 class="cta-title">{{ isEn ? 'One declaration. Every end’s strongest glass.' : '一份声明，各端最强玻璃。' }}</h2>
        <p class="cta-sub">{{ isEn ? 'Native refraction, Web/Mini Program CSS — one algorithm behind all of them.' : '原生真折射，Web/小程序 CSS——背后是同一份算法。' }}</p>
        <div class="cta-row">
          <router-link to="/docs/31-liquid-glass" class="btn btn-primary">{{ isEn ? 'Read the integration guide' : '读接入文档' }}</router-link>
          <router-link to="/playground" class="btn btn-ghost">Playground</router-link>
        </div>
      </section>
    </div>
  </p-page>
</template>

<style scoped>
.lgp { position: relative; }
.lgp-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; background:
  radial-gradient(520px 520px at 8% 2%, rgba(124, 92, 255, 0.16), transparent 70%),
  radial-gradient(460px 460px at 96% 24%, rgba(60, 200, 180, 0.13), transparent 70%),
  radial-gradient(500px 500px at 42% 98%, rgba(230, 120, 90, 0.12), transparent 72%); }
.lgp-wrap { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 40px 20px 72px; }

/* Hero */
.hero { align-items: center; margin-bottom: 18px; }
.hero-copy { display: flex; flex-direction: column; gap: 16px; }
.chip { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 0.12em; color: var(--brand-ink); text-transform: uppercase; }
.hero-h1 { display: flex; flex-direction: column; gap: 2px; font-size: 40px; font-weight: 750; line-height: 1.12; letter-spacing: -0.8px; color: var(--ink); }
.h1-l1 { color: var(--ink); }
.h1-l2 { background: linear-gradient(92deg, var(--brand-ink), #7ce0d0); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero-lead { font-size: 15px; line-height: 1.75; color: var(--muted); max-width: 560px; }
.hero-cta { display: flex; flex-wrap: wrap; gap: 10px; }
.btn { display: inline-flex; align-items: center; height: 40px; padding: 0 18px; border-radius: 10px; font-size: 14px; text-decoration: none; transition: all 0.15s ease; }
.btn-primary { background: var(--brand); color: #fff; }
.btn-primary:hover { background: var(--brand-ink); }
.btn-ghost { border: 1px solid var(--line); color: var(--ink); }
.btn-ghost:hover { border-color: var(--brand-ink); color: var(--brand-ink); }
.hero-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill { font-size: 12px; color: var(--brand-ink); background: var(--brand-soft); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }

/* Hero signature: four ends */
.ends-stage { position: relative; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); padding: 20px; }
.ends-backdrop { position: absolute; inset: 0; background:
  radial-gradient(60% 80% at 16% 20%, rgba(124, 92, 255, 0.55), transparent 60%),
  radial-gradient(55% 70% at 84% 26%, rgba(60, 200, 180, 0.5), transparent 62%),
  radial-gradient(70% 90% at 56% 90%, rgba(230, 120, 90, 0.5), transparent 60%),
  linear-gradient(135deg, #1a1a24, #101018); }
.ends-grid { position: relative; display: flex; flex-wrap: wrap; gap: 12px; }
.ends-cell { flex: 1 1 44%; min-width: 0; }
.ends-glass { display: block; }
.ends-in { padding: 14px 14px; display: flex; flex-direction: column; gap: 5px; }
.ends-k { font-size: 14px; font-weight: 650; color: var(--ink); }
.ends-mode { font-size: 11px; color: var(--muted); }
.ends-mode--native { color: var(--brand-ink); }
.ends-note { position: relative; margin-top: 12px; font-size: 11px; color: var(--muted); line-height: 1.6; }

/* Section shell */
.sec { margin-top: 46px; }
.sec-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.sec-k { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); letter-spacing: 0.1em; }
.sec-title { font-size: 22px; font-weight: 680; color: var(--ink); }
.sec-line { flex: 1; height: 1px; background: linear-gradient(90deg, var(--line), transparent); }
.sec-note { font-size: 14px; line-height: 1.75; color: var(--muted); margin-bottom: 18px; max-width: 900px; }

/* end cards (§01) */
.end-card { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.end-k { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); }
.end-d { margin-top: 8px; font-size: 13px; line-height: 1.6; color: var(--muted); }

/* claims (§02) */
.claim { display: flex; flex-direction: column; gap: 8px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.claim-head { display: flex; align-items: center; justify-content: space-between; }
.claim-no { font-family: var(--mono); font-size: 13px; color: var(--brand-ink); }
.card-ic { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; background: var(--brand-soft); color: var(--brand-ink); }
.claim-t { font-size: 16px; font-weight: 650; color: var(--ink); }
.claim-d { font-size: 13px; line-height: 1.65; color: var(--muted); }
.claim-who { font-size: 11px; color: var(--brand-ink); }

/* pipeline (§03) */
.pipe { padding: 20px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.pipe-rail { display: flex; flex-wrap: wrap; gap: 10px; }
.pipe-step { flex: 1 1 200px; min-width: 0; display: flex; gap: 10px; padding: 12px; border-radius: 10px; background: var(--panel2); border: 1px solid var(--line-soft); }
.pipe-n { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); }
.pipe-t { font-size: 13px; color: var(--ink); line-height: 1.5; }
.pipe-out { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.po-arrow { color: var(--brand-ink); }
.po-ir { font-family: var(--mono); font-size: 13px; color: var(--ink); background: var(--panel2); padding: 6px 12px; border-radius: 8px; }
.pipe-ends { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.pipe-end { font-size: 12px; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 5px 12px; }
.pipe-gate { margin-top: 12px; font-size: 12px; color: var(--muted); }

/* stage (real glass) */
.stage { position: relative; border-radius: 16px; overflow: hidden; padding: 22px; border: 1px solid var(--line); }
.stage-backdrop { position: absolute; inset: 0; background:
  radial-gradient(60% 80% at 18% 22%, rgba(124, 92, 255, 0.55), transparent 60%),
  radial-gradient(55% 70% at 82% 30%, rgba(60, 200, 180, 0.5), transparent 62%),
  radial-gradient(70% 90% at 60% 88%, rgba(230, 120, 90, 0.5), transparent 60%),
  linear-gradient(135deg, #1a1a24, #101018); }
.stage-grid { position: relative; display: flex; flex-wrap: wrap; gap: 12px; }
.stage-cell { flex: 0 0 168px; min-width: 0; }
.stage-in { padding: 16px 14px; display: flex; flex-direction: column; gap: 4px; }
.stage-k { font-size: 13px; font-weight: 600; color: var(--ink); font-family: var(--mono); }
.stage-d { font-size: 12px; color: var(--muted); }

/* interactive (§05) */
.play { display: flex; flex-wrap: wrap; gap: 18px; align-items: stretch; }
.controls { flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 14px; padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.ctl { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 13px; color: var(--muted); }
.ctl--row { justify-content: flex-start; }
.ctl-k { color: var(--ink); font-size: 12px; flex: 0 0 62px; }
.ctl-v { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); margin-left: auto; min-width: 84px; text-align: right; }
.select, .range { flex: 1 1 120px; min-width: 0; }
.select { height: 32px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel2); color: var(--ink); font-size: 13px; padding: 0 8px; }
.range { accent-color: var(--brand); }
.stage--play { flex: 1 1 320px; min-width: 0; display: flex; align-items: center; justify-content: center; }
.demo-glass { position: relative; min-width: 220px; }
.demo-in { padding: 26px 24px; display: flex; flex-direction: column; gap: 6px; }
.demo-t { font-size: 16px; font-weight: 600; color: var(--ink); }
.demo-s { font-size: 12px; color: var(--muted); font-family: var(--mono); }

/* matrix (§06) */
.matrix { display: flex; flex-wrap: wrap; gap: 10px; }
.mrow { flex: 1 1 210px; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.m-end { font-size: 14px; font-weight: 600; color: var(--ink); }
.m-badge { align-self: flex-start; font-size: 11px; padding: 3px 10px; border-radius: 999px; color: var(--muted); background: var(--panel2); border: 1px solid var(--line); }
.m-badge--l3 { color: var(--brand-ink); background: var(--brand-soft); }
.m-note { font-size: 12px; color: var(--muted); }

/* degradation (§07) */
.demos { display: flex; flex-wrap: wrap; gap: 12px; }
.dcell { flex: 0 0 220px; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dbox { position: relative; height: 96px; border-radius: 12px; overflow: hidden; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; }
.dbackdrop { position: absolute; inset: 0; background:
  radial-gradient(60% 90% at 25% 30%, rgba(124, 92, 255, 0.6), transparent 62%),
  radial-gradient(70% 90% at 78% 75%, rgba(60, 200, 180, 0.55), transparent 60%),
  linear-gradient(135deg, #1a1a24, #101018); }
.dglass { position: relative; }
.dt { display: block; padding: 14px 22px; font-size: 13px; font-weight: 600; color: var(--ink); font-family: var(--mono); }
.dlabel { font-size: 12px; color: var(--muted); }

/* table (§08) */
.table { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.tr { display: flex; border-top: 1px solid var(--line-soft); }
.tr:first-child { border-top: none; }
.tr > span { flex: 1; min-width: 0; padding: 11px 14px; font-size: 13px; color: var(--muted); }
.th > span { color: var(--ink); font-weight: 600; background: var(--panel2); }
.td-dim { color: var(--ink); font-weight: 600; flex: 0 0 150px; }
.col-win { color: var(--brand-ink); }

/* evidence (§09) */
.ev { display: flex; flex-direction: column; gap: 1px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.ev-row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; background: var(--panel); flex-wrap: wrap; }
.ev-k { flex: 1 1 320px; min-width: 0; font-size: 13px; color: var(--ink); }
.ev-v { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.ev-gate { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); margin-left: auto; }

/* bounds (§10) */
.bound { padding: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
.bound--ban { border-color: rgba(230, 120, 90, 0.4); }
.bound-h { font-size: 13px; font-weight: 650; color: var(--ink); }
.bound-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.bound-list li { font-size: 13px; line-height: 1.6; color: var(--muted); padding-left: 16px; position: relative; }
.bound-list li::before { content: '—'; position: absolute; left: 0; color: var(--brand-ink); }

/* CTA */
.cta { position: relative; text-align: center; padding: 40px 24px; border: 1px solid var(--line); border-radius: 18px; background: var(--panel); overflow: hidden; }
.cta-seal { position: absolute; top: 18px; right: 24px; font-family: var(--mono); font-size: 12px; letter-spacing: 0.3em; color: var(--brand-soft); }
.cta-title { font-size: 24px; font-weight: 700; color: var(--ink); }
.cta-sub { margin-top: 8px; font-size: 14px; color: var(--muted); }
.cta-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 20px; }

/* reveal */
[data-reveal] { opacity: 0; transform: translateY(16px); transition: opacity 0.5s ease, transform 0.5s ease; }
[data-reveal].revealed { opacity: 1; transform: none; }
</style>
