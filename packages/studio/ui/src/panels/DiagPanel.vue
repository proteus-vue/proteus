<script setup lang="ts">
/**
 * DiagPanel.vue —— 「问题」面板 · 决策 #1409 引入 · #1416 分组 + 双诊断源
 *
 * 【数据从哪来】`../diag.ts`（唯一真源）：tsc 类型诊断 + eslint（都是后端固定命令）。
 *   本组件**只显示**，点击发 `jump` 事件，由父组件切视图并跳行 —— 编辑器逻辑不在这里。
 *
 * 【为什么按文件分组】两个源合并后条数会到几十条，平铺列表在右栏（~300px）里滚起来很难受；
 *   分组后一眼能看出"哪个文件问题最多"，也能逐个文件修完。
 *
 * 【手动触发仍保留】自动检测在进视图/保存时跑（见 diag.ts），但排查时想立刻刷新就点按钮；
 *   按钮右侧显示上次时刻与耗时，避免"以为刚跑过"。
 */
import { computed, ref } from 'vue'
import { diagAt, diagCost, diagErr, diagList, diagRunning, runDiag } from '../diag'
import PanelShell from './PanelShell.vue'
import Icon from '../ui/Icon.vue'
import { pushToast } from '../toast'
import type { Diag } from '../bridge'

const emit = defineEmits<{ jump: [path: string, line: number] }>()

const errors = computed(() => diagList.value.filter((d) => d.severity !== 'warning').length)
const warnings = computed(() => diagList.value.length - errors.value)

const title = computed(() => {
  if (!diagList.value.length) return '问题'
  const parts: string[] = []
  if (errors.value) parts.push(`${errors.value} 错误`)
  if (warnings.value) parts.push(`${warnings.value} 警告`)
  return `问题（${parts.join(' · ')}）`
})
const checkedAt = computed(() =>
  diagAt.value ? new Date(diagAt.value).toLocaleTimeString('zh-CN', { hour12: false }) : '',
)

/** 按文件分组（顺序沿用 diagList 已排好的顺序，不重新排序） */
const groups = computed(() => {
  const map = new Map<string, Diag[]>()
  for (const d of diagList.value) {
    const arr = map.get(d.path)
    if (arr) arr.push(d)
    else map.set(d.path, [d])
  }
  return [...map.entries()].map(([path, items]) => ({
    path,
    items,
    errors: items.filter((i) => i.severity !== 'warning').length,
  }))
})

/** 折叠集合为空 = 全部展开（问题通常不多，展开更好扫） */
const collapsed = ref<string[]>([])
const isOpen = (p: string) => !collapsed.value.includes(p)
function toggle(p: string) {
  const i = collapsed.value.indexOf(p)
  if (i >= 0) collapsed.value.splice(i, 1)
  else collapsed.value.push(p)
}

async function run() {
  await runDiag(true)
  if (diagErr.value) pushToast(`诊断失败：${diagErr.value}`, 'err')
}

function pick(d: Diag) {
  emit('jump', d.path, d.line)
}
</script>

<template>
  <PanelShell :title="title">
    <div class="dbar">
      <button class="run" :disabled="diagRunning" @click="run">
        <Icon name="search" :size="12" />
        {{ diagRunning ? '检查中…' : '检查' }}
      </button>
      <span v-if="checkedAt" class="meta">{{ checkedAt }} · {{ diagCost }}ms</span>
    </div>
    <p v-if="diagErr" class="err">{{ diagErr }}</p>
    <p v-else-if="!diagList.length && checkedAt" class="ok">没有类型 / Lint 问题</p>

    <div v-for="g in groups" :key="g.path" class="dgroup">
      <button class="ghead" :title="g.path" @click="toggle(g.path)">
        <span class="chev">{{ isOpen(g.path) ? '▾' : '▸' }}</span>
        <span class="gname">{{ g.path.split('/').pop() }}</span>
        <span class="gdir">{{ g.path.slice(0, g.path.lastIndexOf('/') + 1) }}</span>
        <span class="gcount" :class="{ bad: g.errors }">{{ g.items.length }}</span>
      </button>
      <template v-if="isOpen(g.path)">
        <button
          v-for="d in g.items"
          :key="d.path + d.line + d.col + d.code"
          class="ditem"
          :class="{ warn: d.severity === 'warning' }"
          :title="`${d.source ?? 'tsc'} · ${d.code}\n${d.message}`"
          @click="pick(d)"
        >
          <span class="dot" />
          <span class="dtxt">
            <span class="dmsg">{{ d.message }}</span>
            <span class="dloc">{{ d.line }}:{{ d.col }} · {{ d.source ?? 'tsc' }}</span>
          </span>
        </button>
      </template>
    </div>
    <template #note>
      只读检查：vue-tsc + eslint（范围限 Studio UI），命令与参数写在后端、不接受前端传入，也不自动改代码。
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

/* 文件组头：文件名 + 目录（弱化）+ 条数 */
.dgroup { margin-top: 2px; }
.ghead {
  display: flex;
  align-items: baseline;
  gap: 4px;
  width: 100%;
  padding: 3px 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.ghead:hover { background: var(--bg-overlay); color: var(--fg); }
.chev { width: 8px; color: var(--fg-subtle); }
.gname { font-weight: 600; }
.gdir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--fg-subtle);
  direction: rtl; /* 路径过长时保留尾部（目录名）而不是开头 */
  text-align: left;
}
.gcount { font-size: 10px; color: var(--fg-subtle); font-variant-numeric: tabular-nums; }
.gcount.bad { color: #f87171; }

.ditem {
  display: flex;
  gap: 6px;
  width: 100%;
  padding: 3px 4px 3px 14px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ditem:hover { background: var(--bg-overlay); color: var(--fg); }
.dot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: #f87171;
}
.ditem.warn .dot { background: #e0b341; }
.dtxt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
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
