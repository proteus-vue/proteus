<!-- showcase/pages/system-glass.vue —— 液态玻璃（真渲染 pg-glass + 强度调节） -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PButton, PSlider, PText, PView } from '@proteus-vue/components'
import PgGlass from '@proteus-vue/components/pg-glass/index.vue'

const intensity = ref(60)
const preset = ref('light')
function cyclePreset() {
  preset.value = preset.value === 'light' ? 'strong' : 'light'
}
</script>

<template>
  <page-shell title="液态玻璃" subtitle="G-07 玻璃拟态原语 · 实时调节">
    <p-view class="stage">
      <p-view class="backdrop">
        <p-view class="blob blob-a" />
        <p-view class="blob blob-b" />
        <p-view class="blob blob-c" />
      </p-view>
      <pg-glass class="glass" :preset="preset" :intensity="intensity">
        <p-text class="glass-t">玻璃面板</p-text>
        <p-text class="glass-s">preset={{ preset }} · intensity={{ intensity }}</p-text>
      </pg-glass>
    </p-view>

    <p-view class="demo">
      <p-view class="ctrl">
        <p-text class="ctrl-k">模糊强度</p-text>
        <p-slider v-model="intensity" :min="0" :max="100" />
        <p-text class="ctrl-v">{{ intensity }}</p-text>
      </p-view>
      <p-view class="ctrl">
        <p-text class="ctrl-k">预设</p-text>
        <p-button @click="cyclePreset">{{ preset }}</p-button>
      </p-view>
    </p-view>

    <p-text class="note">诚实边界：小程序端模糊能力受基础库限制，不足时框架自动降级为半透明实底（不伪造模糊）。</p-text>
  </page-shell>
</template>

<style scoped>
.stage {
  position: relative;
  height: 220px;
  border-radius: var(--sp-radius-lg);
  overflow: hidden;
  background: linear-gradient(135deg, #eef1ff, #ffe9f3 60%, #fff3e6);
}
.backdrop { position: absolute; inset: 0; }
.blob { position: absolute; border-radius: 50%; filter: blur(6px); opacity: 0.85; }
.blob-a { width: 120px; height: 120px; background: #7c5cff; left: 18px; top: 20px; }
.blob-b { width: 100px; height: 100px; background: #34d399; right: 26px; top: 52px; }
.blob-c { width: 130px; height: 130px; background: #ff8a5c; left: 120px; bottom: -40px; }
.glass {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 200px;
  margin-left: -100px;
  margin-top: -55px;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: var(--sp-radius-lg);
}
.glass-t { display: block; font-size: 16px; font-weight: 700; color: #1c1b22; }
.glass-s { display: block; font-size: 11px; font-family: var(--sp-mono); color: #4a4756; margin-top: 4px; }
.demo {
  display: block;
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-lg);
  padding: var(--sp-4);
  margin-top: var(--sp-4);
}
.ctrl { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
.ctrl-k { display: block; font-size: 13px; color: var(--sp-text-2); min-width: 64px; }
.ctrl-v { display: block; font-size: 13px; font-family: var(--sp-mono); color: var(--sp-brand-ink); }
.note {
  display: block;
  font-size: 12px;
  color: var(--sp-text-3);
  line-height: 1.6;
  margin-top: var(--sp-3);
}
</style>
