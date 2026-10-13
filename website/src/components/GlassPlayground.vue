<script setup lang="ts">
// website/src/components/GlassPlayground.vue —— ★液态玻璃实时调参（Playground · 决策 #884）
//   左侧调 preset / intensity / radius / noise / border / tint / fallback → 右侧实时 <pg-glass> + 解析结果。
//   ★数据来自 @proteus-vue/glass（resolveGlass / resolveGlassLevel）——与渲染层同源，非硬编码。
//   ★附「等价源码」：把当前调参折成一段可复制的 <pg-glass> 与纯逻辑调用，开发者直接抄走。
import { computed, ref } from 'vue'
import { GLASS_PRESET_NAMES, resolveGlass, resolveGlassLevel } from '@proteus-vue/glass'
import { locale } from '../i18n'

const isEn = computed(() => locale.value === 'en')

const preset = ref<string>('card')
const intensity = ref(1)
const radius = ref(16)
const noise = ref(0.04)
const border = ref(true)
const tint = ref('')
const fallback = ref<'solid' | 'flat'>('solid')

const INTENSITY_NAMES: Array<[string, string]> = [['none', '无'], ['thin', '薄'], ['regular', '常规'], ['thick', '厚'], ['ultra', '超厚']]
const intensityName = (k: string) => (INTENSITY_NAMES.find((x) => x[0] === k) ?? [k, k])[isEn.value ? 1 : 0]

const resolved = computed(() =>
  resolveGlass({
    preset: preset.value as never,
    intensity: intensity.value,
    radius: radius.value,
    noise: noise.value,
    border: border.value,
    tint: tint.value || undefined,
    fallback: fallback.value,
  }),
)
/** 当前环境（Web）下的可达层级——与渲染层同源（resolveGlassLevel）。 */
const level = computed(() => resolveGlassLevel({ platform: 'web', backdropFilter: true }))

/** 等价源码（可复制）：当前调参 → 一段 <pg-glass> + 纯逻辑调用。 */
const eqSource = computed(() => {
  const p: string[] = [`preset="${preset.value}"`]
  if (intensity.value !== 1) p.push(`:intensity="${intensity.value}"`)
  if (radius.value) p.push(`:radius="${radius.value}"`)
  if (noise.value) p.push(`:noise="${noise.value}"`)
  if (!border.value) p.push(':border="false"')
  if (tint.value) p.push(`tint="${tint.value}"`)
  if (fallback.value !== 'solid') p.push(`fallback="${fallback.value}"`)
  return `<pg-glass ${p.join(' ')}>\n  <view>…你的内容…</view>\n</pg-glass>`
})
const eqLogic = computed(() => {
  const p: string[] = [`preset: '${preset.value}'`]
  if (intensity.value !== 1) p.push(`intensity: ${intensity.value}`)
  if (radius.value) p.push(`radius: ${radius.value}`)
  if (noise.value) p.push(`noise: ${noise.value}`)
  if (!border.value) p.push('border: false')
  return `resolveGlass({ ${p.join(', ')} })\n// → ${JSON.stringify({ blurPx: resolved.value.blurPx, tint: resolved.value.tint, radiusPx: resolved.value.radiusPx, level: level.value })}`
})
</script>

<template>
  <div class="gp">
    <div class="gp-bar">
      <span class="gp-k">{{ isEn ? 'LIVE TUNING' : '实时调参' }}</span>
      <span class="gp-h">{{ isEn ? 'Glass playground' : '玻璃调参' }}</span>
    </div>
    <div class="gp-body">
      <div class="gp-controls">
        <label class="ctl"><span class="ctl-k">{{ isEn ? 'preset' : '预设' }}</span>
          <select v-model="preset" class="select"><option v-for="p in GLASS_PRESET_NAMES" :key="p" :value="p">{{ p }}</option></select>
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
        <label class="ctl"><span class="ctl-k">{{ isEn ? 'tint' : '着色' }}</span>
          <input v-model="tint" type="text" class="input" :placeholder="isEn ? 'e.g. rgba(124,92,255,0.2)' : '如 rgba(124,92,255,0.2)'" />
        </label>
        <label class="ctl"><span class="ctl-k">{{ isEn ? 'fallback' : '降级' }}</span>
          <select v-model="fallback" class="select"><option value="solid">solid</option><option value="flat">flat</option></select>
        </label>
        <label class="ctl ctl--row"><input v-model="border" type="checkbox" /><span class="ctl-k">{{ isEn ? 'highlight edge' : '高光边' }}</span></label>
      </div>

      <div class="gp-preview">
        <div class="gp-stage">
          <div class="gp-backdrop" aria-hidden="true" />
          <pg-glass :preset="preset" :intensity="intensity" :radius="radius" :noise="noise" :border="border" :tint="tint" :fallback="fallback" class="gp-glass">
            <div class="gp-in">
              <span class="gp-t">{{ isEn ? 'Glass panel' : '玻璃面板' }}</span>
              <span class="gp-s">blur {{ resolved.blurPx }}px · radius {{ resolved.radiusPx }}px · {{ resolved.intensity }} · {{ level }}</span>
            </div>
          </pg-glass>
        </div>
      </div>
    </div>

    <div class="gp-code">
      <div class="gp-cblock"><span class="gp-ck">Vue</span><pre class="gp-pre"><code>{{ eqSource }}</code></pre></div>
      <div class="gp-cblock"><span class="gp-ck">{{ isEn ? 'Logic' : '纯逻辑' }}</span><pre class="gp-pre"><code>{{ eqLogic }}</code></pre></div>
    </div>
  </div>
</template>

<style scoped>
.gp { max-width: 1180px; margin: 8px 0 28px; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--panel); }
.gp-bar { display: flex; align-items: baseline; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.gp-k { font-family: var(--mono); font-size: 11px; letter-spacing: 0.12em; color: var(--brand-ink); }
.gp-h { font-size: 15px; font-weight: 650; color: var(--ink); }
.gp-body { display: flex; flex-wrap: wrap; gap: 18px; padding: 18px; }
.gp-controls { flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 13px; }
.ctl { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 13px; color: var(--muted); }
.ctl--row { justify-content: flex-start; }
.ctl-k { color: var(--ink); font-size: 12px; flex: 0 0 62px; }
.ctl-v { font-family: var(--mono); font-size: 12px; color: var(--brand-ink); margin-left: auto; min-width: 84px; text-align: right; }
.select, .range, .input { flex: 1 1 120px; min-width: 0; }
.select, .input { height: 32px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel2); color: var(--ink); font-size: 13px; padding: 0 8px; }
.range { accent-color: var(--brand); }
.gp-preview { flex: 1 1 320px; min-width: 0; display: flex; align-items: center; justify-content: center; }
.gp-stage { position: relative; width: 100%; border-radius: 14px; overflow: hidden; border: 1px solid var(--line); padding: 30px 22px; display: flex; align-items: center; justify-content: center; }
.gp-backdrop { position: absolute; inset: 0; background:
  radial-gradient(60% 80% at 20% 24%, rgba(124, 92, 255, 0.6), transparent 62%),
  radial-gradient(60% 80% at 80% 34%, rgba(60, 200, 180, 0.55), transparent 60%),
  radial-gradient(70% 90% at 55% 92%, rgba(230, 120, 90, 0.5), transparent 60%),
  linear-gradient(135deg, #1a1a24, #101018); }
.gp-glass { position: relative; min-width: 220px; }
.gp-in { padding: 22px 22px; display: flex; flex-direction: column; gap: 6px; }
.gp-t { font-size: 15px; font-weight: 600; color: var(--ink); }
.gp-s { font-size: 11px; color: var(--muted); font-family: var(--mono); }
.gp-code { display: flex; flex-wrap: wrap; gap: 1px; background: var(--line); }
.gp-cblock { flex: 1 1 300px; min-width: 0; background: var(--panel2); padding: 12px 16px; }
.gp-ck { font-family: var(--mono); font-size: 11px; color: var(--brand-ink); }
.gp-pre { margin-top: 6px; overflow-x: auto; }
.gp-pre code { font-family: var(--mono); font-size: 12px; color: var(--ink); line-height: 1.6; white-space: pre; }
</style>
