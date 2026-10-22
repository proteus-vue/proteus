<script setup lang="ts">
import { computed } from 'vue'
import PanelShell from './PanelShell.vue'
import { pct, type Stats } from '../useStats'

const props = defineProps<{ s: Stats | null }>()
const emptyRatio = computed(() => {
  const s = props.s
  if (!s || s.ticks <= 0) return '—'
  return `${s.empty} / ${s.ticks}`
})
</script>

<template>
  <PanelShell title="运行">
    <div class="kv">
      <b>出帧</b><span id="kframes">{{ s?.frames ?? 0 }}</span>
      <b>迟到</b><span id="klate">{{ (s?.late ?? 0) + ' 帧' }}</span>
      <b>入队 AU</b><span id="kaus">{{ s?.aus ?? 0 }}</span>
      <b>空转拍</b><span id="kempty">{{ emptyRatio }}</span>
      <b>CPU</b><span id="kcpu">{{ s ? pct(s.cpu_pct) + ' 单核' : '—' }}</span>
    </div>
    <template #note>
      空转拍 = 没有新 AU 的渲染拍；它偏高说明取样节拍比流快（不是丢帧）。
    </template>
  </PanelShell>
</template>

<style scoped>
.kv{display:grid;grid-template-columns:86px 1fr;gap:5px 10px;font-size:12px}
.kv b{font-weight:500;color:var(--dim)}
.kv span{color:var(--fg);font-variant-numeric:tabular-nums}
</style>
