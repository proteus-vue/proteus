<script setup lang="ts">
import { computed } from 'vue'
import PanelShell from './PanelShell.vue'
import { num, type Stats } from '../useStats'

const props = defineProps<{ s: Stats | null }>()

const device = computed(() => props.s?.device ?? null)
const stream = computed(() => {
  const s = props.s
  if (!s) return '—'
  const mbps = s.mbps < 0 ? '—' : `${s.mbps.toFixed(1)} Mbps`
  return `H.264 · ${s.width}×${s.height} · ${mbps}`
})
const decode = computed(() => (props.s ? (props.s.hwdec ? 'VideoToolbox 硬解' : '软件解码') : '—'))
const fps = computed(() => (props.s ? num(props.s.fps, 1, ' fps') : '—'))
const iv = computed(() =>
  props.s ? `p50 ${num(props.s.iv_p50, 1)} / p95 ${num(props.s.iv_p95, 1)} ms` : '—',
)
</script>

<template>
  <PanelShell title="设备与流">
    <div class="kv">
      <b>机型</b><span id="kdev">{{ device ?? '未知（adb 未探测到）' }}</span>
      <b>画面</b><span id="kstream">{{ stream }}</span>
      <b>解码</b><span id="kdec">{{ decode }}</span>
      <b>帧率</b><span id="kfps">{{ fps }}</span>
      <b>到达间隔</b><span id="kiv">{{ iv }}</span>
    </div>
    <template #note>
      <span v-if="!device">注：没查到机型时不编造型号；画面尺寸来自解码器而非设备上报。</span>
      <span v-else>码率按入队 AU 字节（含起始码）估，略高于 <code>--bit-rate</code> 目标值。</span>
    </template>
  </PanelShell>
</template>

<style scoped>
.kv{display:grid;grid-template-columns:86px 1fr;gap:5px 10px;font-size:12px}
.kv b{font-weight:500;color:var(--dim)}
.kv span{color:var(--fg);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
code{background:var(--panel2);border:1px solid var(--line);border-radius:4px;padding:0 4px;font-size:11px}
</style>
