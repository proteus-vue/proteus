<!-- examples/pages/glass-demo.vue —— ★G-07 液态玻璃演示（proteus-glass-plan B1：Web/Skyline L1+L2）
     · 七 preset 一览：navigationBar / tabBar / modal / card / floating / sidebar / custom
     · intensity 档位：none / thin / regular / thick（同 preset 不同模糊厚度）
     · L2 质感：噪点层（noise）+ 高光边（border）
     · 降级演示：preset→level 决策（resolveGlassLevel）——无 backdrop-filter / 减弱透明度 → 实色
     ★MP 安全：pg-glass 内 globalThis 探测 + 无 backdrop-filter → 实色降级（不白屏/不黑块） -->
<route>
  { "title": "液态玻璃（G-07）" }
</route>
<template>
  <div class="page">
    <p-heading :level="1">液态玻璃（G-07）</p-heading>
    <p-text class="desc">统一入口 &lt;pg-glass&gt; → 各端映射到该端最强玻璃；L1 基础玻璃全端必达，降级不崩溃</p-text>

    <section class="block">
      <p-heading :level="2">① 七预设（09-presets）</p-heading>
      <p-text class="hint">preset = 经验证的最佳参数组合，业务优先用 preset；下方为各预设默认外观</p-text>
      <div class="preset-grid">
        <div v-for="p in presets" :key="p" class="preset-cell">
          <pg-glass :preset="p" class="glass-card">
            <p-text class="cell-label">{{ p }}</p-text>
          </pg-glass>
        </div>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">② 强度档位（intensity）</p-heading>
      <p-text class="hint">同一 custom 预设，不同模糊厚度（none=0 → ultra 最厚）</p-text>
      <div class="preset-grid">
        <div v-for="i in intensities" :key="i" class="preset-cell">
          <pg-glass preset="floating" :intensity="i" class="glass-card">
            <p-text class="cell-label">{{ i }}</p-text>
          </pg-glass>
        </div>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">③ L2 质感（噪点 + 高光边）</p-heading>
      <p-text class="hint">noise &gt; 0 渲染噪点层；border 控制高光边（Web/Skyline CSS 模拟）</p-text>
      <div class="preset-grid">
        <div class="preset-cell">
          <pg-glass preset="card" :noise="0.08" class="glass-card">
            <p-text class="cell-label">noise 0.08</p-text>
          </pg-glass>
        </div>
        <div class="preset-cell">
          <pg-glass preset="card" :border="false" class="glass-card">
            <p-text class="cell-label">border=false</p-text>
          </pg-glass>
        </div>
        <div class="preset-cell">
          <pg-glass preset="custom" :radius="32" tint="rgba(99,102,241,0.35)" class="glass-card">
            <p-text class="cell-label">custom 紫</p-text>
          </pg-glass>
        </div>
      </div>
    </section>

    <section class="block">
      <p-heading :level="2">④ 降级决策（resolveGlassLevel）</p-heading>
      <p-text class="hint">props → 环境 → 层级：能力不足降实色，绝不白屏/黑块</p-text>
      <pre class="level-table" data-testid="glass-levels">{{ levelText }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PHeading, PText, PgGlass } from '@proteus-vue/components'
import { GLASS_PRESET_NAMES, resolveGlass, resolveGlassLevel } from '@proteus-vue/glass'
import type { GlassIntensity, GlassPlatform } from '@proteus-vue/glass'

const presets = GLASS_PRESET_NAMES
const intensities: GlassIntensity[] = ['none', 'thin', 'regular', 'thick']

// ★降级决策展示：同 preset 在不同环境下解析出的层级（纯逻辑 SSOT——组件与各端 Backend 共用）
const levelText = computed(() => {
  const rows: string[] = ['env'.padEnd(34) + 'level  blurPx']
  const envs: Array<{ label: string; platform: GlassPlatform; backdropFilter?: boolean; reducedTransparency?: boolean; systemMaterial?: boolean; tier?: 'low' | 'mid' | 'high' }> = [
    { label: 'web（支持 backdrop-filter）', platform: 'web' },
    { label: 'web（无 backdrop-filter）', platform: 'web', backdropFilter: false },
    { label: 'web（减弱透明度偏好）', platform: 'web', reducedTransparency: true },
    { label: 'web（低端设备 tier=low）', platform: 'web', tier: 'low' },
    { label: 'skyline', platform: 'skyline' },
    { label: 'ios（有系统材质 L3）', platform: 'ios', systemMaterial: true },
    { label: 'ios（无系统材质）', platform: 'ios' },
  ]
  for (const e of envs) {
    const level = resolveGlassLevel(e)
    const r = resolveGlass({ preset: 'card' })
    rows.push(e.label.padEnd(34) + level.padEnd(7) + String(r.blurPx))
  }
  return rows.join('\n')
})
</script>

<style scoped>
.page {
  padding: 16px;
}
.desc {
  display: block;
  margin: 4px 0 16px;
  color: #666;
  font-size: 13px;
}
.block {
  margin-bottom: 28px;
}
.hint {
  display: block;
  margin: 6px 0 12px;
  color: #888;
  font-size: 12px;
}
/* 玻璃卡片需有背景可透出（父容器给渐变底），否则 backdrop-filter 无从体现 */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  padding: 20px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c5cff 0%, #39d0c4 50%, #ff6b9d 100%);
}
.preset-cell {
  min-height: 76px;
}
.glass-card {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 76px;
  padding: 12px;
}
.cell-label {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.level-table {
  margin: 0;
  padding: 12px 14px;
  background: #14141a;
  color: #9fd3c7;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
}
</style>
