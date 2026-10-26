<script setup lang="ts">
// ui/src/panels/TabBar.vue —— 编辑器标签栏（决策 #1217 引入，#1247 从 CodePanel.vue 拆出）
//
// 【职责边界】只画标签 + 发事件。**缓冲与 undo 历史在 CodePanel 的 states 池里**，
//   本组件不碰 —— 切标签必须恢复同一份 EditorState，谁持有它谁负责（拆出组件时最容易
//   犯的错就是把"点标签"顺手写成"重新读盘"，那会同时丢掉未保存内容与撤销历史）。
//
// 【布局硬约束（判据 ㉓）】它必须待在右栏 `.pane` 里：标签跨到左栏压住文件树
//   曾经是真实缺陷（决策 #1218），而当时 35 条判据全在测行为、没有一条测"在哪儿"。
defineProps<{
  tabs: string[]
  cur: string
  /** 有未保存改动的标签（小圆点） */
  dirty: string[]
}>()
const emit = defineEmits<{
  open: [path: string]
  close: [path: string]
  menu: [e: MouseEvent, path: string]
}>()
</script>

<template>
  <div v-if="tabs.length" class="tabs" id="codeTabs">
    <button
      v-for="p in tabs"
      :key="p"
      class="tab"
      :class="{ on: p === cur }"
      :title="p"
      :data-tab="p"
      @click="emit('open', p)"
      @contextmenu.prevent.stop="emit('menu', $event, p)"
    >
      <span class="tname">{{ p.split('/').pop() }}</span>
      <span v-if="dirty.includes(p)" class="tdot" aria-label="未保存" />
      <span class="tclose" role="button" aria-label="关闭" @click.stop="emit('close', p)">×</span>
    </button>
  </div>
</template>

<style scoped>
/* 行高 28px（4px 网格）；活动标签用底部 2px 强调条，不靠"变亮"单维度 */
.tabs {
  flex: none;
  display: flex;
  align-items: stretch;
  height: 28px;
  padding: 0 var(--sp1);
  gap: 2px;
  overflow-x: auto;
  background: var(--bg-canvas);
  border-bottom: 1px solid var(--border-subtle);
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--sp1);
  max-width: 220px;
  padding: 0 var(--sp2);
  border: 0;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 28px ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}
.tab:hover {
  background: var(--bg-surface);
  color: var(--fg);
}
.tab.on {
  background: var(--bg-surface);
  color: var(--fg);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.tname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 未保存：一个 5px 圆点（与顶栏 chip 用同一语汇），不抢文字宽度 */
.tdot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--warn);
}
/* 关闭：hover 才显形，常驻会显得很吵（IDE 的通用做法） */
.tclose {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: var(--r-sm);
  color: var(--fg-subtle);
  font-size: 13px;
  line-height: 13px;
  text-align: center;
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.tab:hover .tclose,
.tab.on .tclose,
.tclose:focus-visible {
  opacity: 1;
}
.tclose:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
</style>
