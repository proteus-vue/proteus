<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../ui/Icon.vue'
// 右栏面板的公共外壳：标题 + 内容 + 可选脚注。
// ★所有面板共用它，避免"每个面板各写一套 padding/标题样式"——那是手写 HTML 版的通病。
/* ★可折叠（决策 #1395）：VS Code 的活动栏式 —— 标题就是折叠条，点一下收起内容。
   状态按**标题**持久化到 localStorage（`studio.panels.v1`），重开保持上次的展开/收起。
   默认**展开**：判据（门禁）读的是面板正文，默认收起会让一票判据读不到内容。 */
const props = withDefaults(defineProps<{ title: string; note?: string; collapsible?: boolean }>(), {
  collapsible: true,
})

const KEY = 'studio.panels.v1'
function loadOpen(): boolean {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
    return m[props.title] !== false
  } catch {
    return true
  }
}

const open = ref(props.collapsible ? loadOpen() : true)
const ROT = computed(() => (open.value ? 'rotate(0deg)' : 'rotate(-90deg)'))

function toggle() {
  if (!props.collapsible) return
  open.value = !open.value
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
    m[props.title] = open.value
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* localStorage 不可用（隐私模式）就算了，不影响功能 */
  }
}
</script>

<template>
  <section class="sec" :class="{ closed: !open }">
    <header class="hd" :class="{ btn: props.collapsible }" :title="props.collapsible ? '点击折叠/展开' : ''" @click="toggle">
      <span v-if="props.collapsible" class="chev" :style="{ transform: ROT }"><Icon name="chevron-down" :size="12" /></span>
      <h3>{{ title }}</h3>
    </header>
    <div v-if="open" class="body"><slot /></div>
    <!-- ★`note || $slots.note`（决策 #1315）：原来只看 `note` **属性**，
         而 DeviceSwitcher 用的是 `#note` **插槽** ⇒ 那段说明**从来没渲染过**。
         用户报"切换时没有任何提示"时，其中一部分就是这个（行内提示是新加的，底部说明一直在丢）。 -->
    <div v-if="open && (note || $slots.note)" class="note"><slot name="note">{{ note }}</slot></div>
  </section>
</template>

<style scoped>
/* 面板外壳（生产口径）：小号弱色标题 + 统一内边距 + 细分隔线。
   标题不抢内容注意力——IDE 里面板标题是"定位标签"，不是内容。 */
.sec{padding:var(--sp3) var(--sp4);border-bottom:1px solid var(--border-subtle)}
.sec.closed{padding-top:calc(var(--sp3) - 2px);padding-bottom:calc(var(--sp3) - 2px)}
.hd{display:flex;align-items:center;gap:4px;margin:0 0 var(--sp2);user-select:none}
.sec.closed .hd{margin-bottom:0}
.hd.btn{cursor:pointer;margin-left:-4px;padding:2px 4px;border-radius:5px}
.hd.btn:hover{background:var(--bg-overlay)}
.chev{display:inline-flex;color:var(--fg-subtle);transition:transform .12s ease}
h3{margin:0;font-size:var(--fs-xs);font-weight:600;color:var(--fg-muted);letter-spacing:.04em}
.note{margin-top:var(--sp2);font-size:var(--fs-xs);color:var(--fg-subtle);line-height:1.6}
</style>
