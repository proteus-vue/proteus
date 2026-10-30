<script setup lang="ts">
/**
 * CodeSidebar.vue —— 代码视图的**左栏**（拖动条 + 仓库搜索 + Git 条 + 文件树）· 决策 #1410
 *
 * 【为什么抽出来】`CodePanel.vue` 涨到 1137 行，越过 `check:file-size` 的 1000 行硬上限。
 *   这一块与编辑器内核（EditorView / 缓冲池 / 保存）**没有耦合**，只是"列文件 + 发事件"，
 *   搬出去风险最低：搬完 CodePanel 只剩"编辑器列"。
 *
 * 【边界】本组件不读盘、不打开文件 —— 只把 `open / changed / jump / refresh / copy` 往上抛，
 *   谁有能力谁做（与 FileTree/TabBar 的既有约定一致）。
 */
import { ref } from 'vue'
import SearchBox from './SearchBox.vue'
import GitBar from './GitBar.vue'
import FileTree from './FileTree.vue'
import { startDrag, treeHidden, treeW } from '../layout'
import type { SearchHit } from '../bridge'

const props = defineProps<{
  files: string[]
  cur: string
  searchActive: boolean
}>()
const emit = defineEmits<{
  open: [path: string]
  changed: [path: string]
  /** 原样转发 SearchBox 的跳转请求（`SearchHit` 带 path/line/col，语义由父组件解释） */
  jump: [hit: SearchHit]
  refresh: []
  copy: [path: string]
  active: [v: boolean]
}>()

const searchBox = ref<{ focus: () => void } | null>(null)
/** ⇧⌘F：焦点送进搜索框（父组件调用） */
function focusSearch() {
  searchBox.value?.focus()
}
defineExpose({ focusSearch })
</script>

<template>
    <div
      class="side"
      :class="{ hidden: treeHidden }"
      :style="{ width: (treeHidden ? 0 : treeW) + 'px' }"
    >
      <!-- 拖动条（决策 #1344）：代码视图的"左栏"就是这棵文件树，宽度可拖、可收起。
           ★放在 `.side` 内部是安全的：门禁按 `#codeFiles button[data-file]` 选文件，
             不做 nth-child 序号假设（与 rail 的情况不同，那里不能插节点）。 -->
      <div class="treegrip" title="拖动调整文件树宽度（⌘B 收起/展开）" @pointerdown="startDrag('tree', $event)" />
      <!-- 搜索框常驻顶部；一旦有查询，结果列表**替换**目录树（VS Code 同款：同一时刻一个列表） -->
      <SearchBox ref="searchBox" @jump="(hit) => emit('jump', hit)" @active="(v) => emit('active', v)" />
      <!-- Git 只读条（决策 #1246 · #1247 拆成组件）：分支 + 改动数；点清单项 = 打开 + 看 HEAD diff -->
      <GitBar :cur="props.cur" @open="(p) => emit('changed', p)" />
      <!-- 文件树（#1247 拆成组件）：只在没有搜索查询时显示（同一时刻只有一个列表） -->
      <FileTree
        v-if="!props.searchActive"
        :files="props.files"
        :cur="props.cur"
        @open="(p) => emit('open', p)"
        @copy="(p) => emit('copy', p)"
        @refresh="emit('refresh')"
      />
    </div>
</template>

<style scoped>
/* 左栏容器（决策 #1222/#1223）：上面是 SearchBox（它自带样式），下面要么目录树、要么结果 */
.side {
  /* 宽度由内联 style 控制（决策 #1344）；这里只保留结构性约束 */
  position: relative;
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
/* 文件树收起时：不留边距与边框，否则会剩一条"空壳" */
.side.hidden { padding: 0; border-right: none; overflow: hidden; }
/* 拖拽条：贴在文件树右缘（6px 命中区，hover 才亮） */
.treegrip { position: absolute; top: 0; bottom: 0; right: -3px; width: 6px;
            cursor: col-resize; z-index: 5; background: transparent; transition: background .12s; }
.treegrip:hover { background: var(--accent); opacity: .35; }
</style>
