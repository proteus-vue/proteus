<script setup lang="ts">
/**
 * DiagPanel.vue —— 「问题」面板（类型诊断）· 决策 #1409
 *
 * 【它做什​么】点「检查」→ 调后端固定命令（vue-tsc，参数写死）→ 列出 `文件:行:列 + 消息`，
 * 点某条 → 切到代码视图并跳到那一行（交给父组件的 `jump` 事件，本组件不碰编辑器）。
 *
 * 【为什么不自动跑】实测冷启 17s / 增量 12s —— 自动跑会在每次进代码视图时白占十几秒 CPU。
 *   这里坚持**手动触发**，并把"上次检查时间/耗时"显示出来，让用户知道结果是不是新的。
 *
 * 【边界】只发事件、只显示；不写文件、不修代码（`--fix` 这类能力一律不做，见 diag.rs 的安全边界）。
 */
import { computed, ref } from 'vue'
import { diagTsc, hasBridge, type Diag } from '../bridge'
import PanelShell from './PanelShell.vue'
import Icon from '../ui/Icon.vue'
import { pushToast } from '../toast'

const emit = defineEmits<{ jump: [path: string, line: number] }>()

const list = ref<Diag[]>([])
const running = ref(false)
const err = ref('')
const checkedAt = ref('')
const cost = ref(0)

const title = computed(() => (list.value.length ? `问题（${list.value.length}）` : '问题'))

async function run() {
  if (running.value) return
  if (!hasBridge()) {
    err.value = '需要在 Studio 里运行（浏览器直开没有后端）'
    return
  }
  running.value = true
  err.value = ''
  const t0 = performance.now()
  try {
    list.value = await diagTsc()
    cost.value = Math.round(performance.now() - t0)
    checkedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (e) {
    err.value = String((e as Error)?.message ?? e).slice(0, 200)
    pushToast(`诊断失败：${err.value}`, 'err')
  } finally {
    running.value = false
  }
}

function pick(d: Diag) {
  emit('jump', d.path, d.line)
}
</script>

<template>
  <PanelShell :title="title">
    <div class="dbar">
      <button class="run" :disabled="running" @click="run">
        <Icon name="search" :size="12" />
        {{ running ? '检查中…' : '检查类型' }}
      </button>
      <span v-if="checkedAt" class="meta">{{ checkedAt }} · {{ cost }}ms</span>
    </div>
    <p v-if="err" class="err">{{ err }}</p>
    <p v-else-if="!list.length && checkedAt" class="ok">没有类型问题</p>
    <button v-for="d in list" :key="d.path + d.line + d.col + d.code" class="ditem" @click="pick(d)" :title="d.message">
      <span class="dmsg">{{ d.message }}</span>
      <span class="dloc">{{ d.path.split('/').pop() }}:{{ d.line }}</span>
    </button>
    <template #note>
      只读检查（vue-tsc --noEmit，范围限定 Studio UI）。命令与参数写在后端，不接受前端传入。
    </template>
  </PanelShell>
</template>

<style scoped>
.dbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.run {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  background: var(--bg-overlay);
  color: var(--fg-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.run:hover:not(:disabled) { color: var(--fg); border-color: var(--accent); }
.run:disabled { opacity: .6; cursor: default; }
.meta { font-size: 10px; color: var(--fg-subtle); }
.err { margin: 4px 0 0; font-size: 11px; color: #f87171; }
.ok { margin: 4px 0 0; font-size: 11px; color: #4ade80; }
.ditem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ditem:hover { background: var(--bg-overlay); color: var(--fg); }
.dmsg {
  font-size: 11px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dloc { font-size: 10px; color: var(--fg-subtle); }
</style>
