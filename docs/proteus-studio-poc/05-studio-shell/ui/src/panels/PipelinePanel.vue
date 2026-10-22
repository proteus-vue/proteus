<script setup lang="ts">
import { computed } from 'vue'
import PanelShell from './PanelShell.vue'
import { ms, type Stats } from '../useStats'

const props = defineProps<{ s: Stats | null }>()
const v = (k: keyof Stats) => (props.s ? ms(props.s[k] as number) : '—')

// 合计用 p50/p95；四段用 p50 —— 便于一眼看出"合计 ≈ 四段之和"
const stages = computed(() => [
  { label: '队列等待', key: 'qw_p50' as const, id: 'kqw' },
  { label: '解码', key: 'dec_p50' as const, id: 'kdecms' },
  { label: '合成', key: 'cmp_p50' as const, id: 'kcmp' },
  { label: '上屏', key: 'pres_p50' as const, id: 'kpres' },
])
</script>

<template>
  <PanelShell title="管线（首字节到达 → 上屏）">
    <div class="kv">
      <b>合计 p50</b><span id="klat">{{ v('lat_p50') }}</span>
      <b>合计 p95</b><span id="klat95">{{ v('lat_p95') }}</span>
      <!-- ★必须成对渲染：grid 是两列，写成两个独立 v-for 会变成"标签一列、数值一列" -->
      <template v-for="st in stages" :key="st.key">
        <b>{{ st.label }}</b><span class="sub" :id="st.id">{{ v(st.key) }}</span>
      </template>
    </div>
    <template #note>合计 ≈ 上四段之和；数值来自原生侧滑动窗口（最近 240 帧）。</template>
  </PanelShell>
</template>

<style scoped>
.kv{display:grid;grid-template-columns:86px 1fr;gap:5px 10px;font-size:12px}
.kv b{font-weight:500;color:var(--dim)}
.kv span{color:var(--fg);font-variant-numeric:tabular-nums}
/* 缩进体现"合计 = 四段之和"，避免读成四个并列指标 */
.sub{padding-left:14px;color:#c3c9d4}
.sub:before{content:"└ ";color:#5c626e}
</style>
