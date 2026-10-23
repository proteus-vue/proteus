<script setup lang="ts">
import { computed } from 'vue'
import PanelShell from './PanelShell.vue'
import { num, type Stats } from '../useStats'

const props = defineProps<{ s: Stats | null }>()

const device = computed(() => props.s?.device ?? null)
const stream = computed(() => {
  const s = props.s
  // ★无尺寸时显示 "—" 而不是 "0×0"：面板统一原则是「没数据就明说，不摆一个像真值的 0」
  if (!s || s.width <= 0) return '—'
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

<!-- 样式全部提到全局 styles.css（.kv / code）：
     .kv 此前在 Device/Pipeline/Runtime 三处一字不差抄了三遍，改一次要改三处 ⇒ 统一为单一实现。 -->
