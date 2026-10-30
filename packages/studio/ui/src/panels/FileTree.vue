<script setup lang="ts">
// ui/src/panels/FileTree.vue —— 左栏目录树（决策 #1247 从 CodePanel.vue 拆出）
//
// 【它负责什么】把扁平路径列表画成树（缩进表达层级）、目录两态图标、文件类型图标、
//   以及**树自己的右键菜单**（折叠/打开/复制路径/刷新）。
// 【它不负责什么】读盘、打开文件的副作用（读文件、建 EditorState、切 Diff）——
//   一律 `emit('open')` 交给 CodePanel，因为只有那里持有 EditorView 与缓冲池。
//
// 【两条从真实缺陷换来的约定】
//   ① **不画折叠箭头**（决策 #1238）：目录图标本身就是开关，闭合与展开是两套形状；
//      去掉 12px 箭头后，同级文件名的左边界才真正对齐。
//   ② **布局必须有几何判据**（决策 #1218 的教训）：文件树宽度/行高变化会被判据 ㉓ 盯住。
import { computed, ref } from 'vue'
import { buildTree, flatten, toggleCollapsed, type TreeNode } from '../fileTree'
import { useWorkspaceState } from '../useWorkspaceState'
import { git } from '../git'
import { openMenu } from '../contextmenu'
import FileIcon from '../icons/FileIcon.vue'
import FolderIcon from '../icons/FolderIcon.vue'
import { fileTypeIcon } from '../fileIcons'

const props = defineProps<{
  files: string[]
  cur: string
}>()
const emit = defineEmits<{
  open: [path: string]
  copy: [path: string]
  refresh: []
}>()

const ws = useWorkspaceState()
/* ★文件树上的改动徽标（决策 #1404）：`git_status` 已经是**只读**查询（决策 #1246 的安全边界：
   只跑 status/rev-parse/show，永不 stage/commit），所以这里只是把它显示到树上。
   用 Map 而不是每次 find：树有上千行，render 里线性查会明显卡。 */
const gitMark = computed(() => {
  const m = new Map<string, string>()
  for (const f of git.value?.files ?? []) m.set(f.path, f.status)
  return m
})
const mark = (p: string) => gitMark.value.get(p) ?? ''

const tree = computed(() => buildTree(props.files))
const rows = computed(() => flatten(tree.value, ws.codeCollapsed))

/* ★文件树过滤（决策 #1406）：仓库上千文件时，靠折叠点进去找太慢。
   过滤时改为**平铺匹配文件**（全路径），不再维护"过滤后的树形"——
   树形过滤要处理"父目录保留但只剩一个子项"的合并规则，复杂度远高于收益。 */
const q = ref('')
const filteredRows = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return rows.value
  return props.files
    .filter((f) => f.toLowerCase().includes(needle))
    .slice(0, 300)
    .map((f) => ({ node: { path: f, name: f.slice(f.lastIndexOf('/') + 1), dir: false, children: [] } as TreeNode, depth: 0 }))
})

function toggle(dir: string) {
  toggleCollapsed(dir, ws.codeCollapsed)
}

/** 树行图标：目录分展开/折叠；文件按扩展名取类型图标与类型色 */
function nodeIcon(node: { path: string; dir: boolean }): { name: string; color?: string } {
  if (node.dir) return { name: ws.codeCollapsed.includes(node.path) ? 'folder' : 'folderOpen' }
  const t = fileTypeIcon(node.path)
  return t ? { name: t.icon, color: t.color } : { name: 'file' }
}

function onNodeMenu(e: MouseEvent, node: TreeNode) {
  const collapsed = ws.codeCollapsed.includes(node.path)
  openMenu(
    e,
    [
      node.dir
        ? { id: 'toggle', label: collapsed ? '展开目录' : '折叠目录' }
        : { id: 'open', label: '打开' },
      { id: 's1', label: '', sep: true },
      { id: 'copyPath', label: '复制相对路径' },
      { id: 'refresh', label: '刷新文件树' },
    ],
    (id) => {
      if (id === 'toggle') toggle(node.path)
      else if (id === 'open') emit('open', node.path)
      else if (id === 'copyPath') emit('copy', node.path)
      else if (id === 'refresh') emit('refresh')
    },
  )
}
</script>

<template>
  <div class="ffilter">
    <input
      id="fileFilter"
      v-model="q"
      placeholder="过滤文件（按路径）"
      spellcheck="false"
      @keydown.esc.prevent="q = ''"
    />
    <span v-if="q" class="fcount">{{ filteredRows.length }}</span>
  </div>
  <nav class="files" id="codeFiles">
    <button
      v-for="r in filteredRows"
      :key="r.node.path"
      :class="{ on: r.node.path === cur, dir: r.node.dir }"
      :style="{ paddingLeft: `${8 + r.depth * 14}px` }"
      :title="r.node.path"
      :data-dir="r.node.dir ? r.node.path : undefined"
      :data-file="r.node.dir ? undefined : r.node.path"
      :aria-expanded="r.node.dir ? !ws.codeCollapsed.includes(r.node.path) : undefined"
      :data-icon="nodeIcon(r.node).name"
      @click="r.node.dir ? toggle(r.node.path) : emit('open', r.node.path)"
      @contextmenu.prevent.stop="onNodeMenu($event, r.node)"
    >
      <FolderIcon v-if="r.node.dir" :open="!ws.codeCollapsed.includes(r.node.path)" :size="16" class="ico" />
      <FileIcon v-else :path="r.node.path" :size="16" class="ico" />
      <span class="name" :title="q ? r.node.path : undefined">{{ q ? r.node.path : r.node.name }}</span>
      <span v-if="!r.node.dir && mark(r.node.path)" class="gst" :data-s="mark(r.node.path)">{{
        mark(r.node.path)
      }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* 目录树（次级侧栏）：行高 24px，落在 4px 网格上 */
.files {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp1) 0;
}
.ffilter {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--sp1) var(--sp2) 2px;
}
.ffilter input {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-canvas);
  color: var(--fg);
  font: inherit;
  font-size: 11px;
  outline: none;
}
.ffilter input:focus { border-color: var(--accent); }
.fcount { margin-left: 5px; font-size: 10px; color: var(--fg-subtle); }

.gst {
  margin-left: auto;
  padding-left: 6px;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: .95;
}
.gst[data-s='M'] { color: #e0b341; }
.gst[data-s='A'] { color: #4ade80; }
.gst[data-s='D'] { color: #f87171; }
.gst[data-s='R'] { color: #60a5fa; }
.gst[data-s='U'] { color: #c084fc; }
.gst[data-s='?'] { color: var(--fg-subtle); }

.files button {
  display: flex;
  align-items: center;
  gap: var(--sp1);
  width: 100%;
  height: 24px;
  padding-right: var(--sp2);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 24px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}
.files button:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
.files button.on {
  background: var(--bg-elevated);
  color: var(--fg);
  /* 选中态：左侧 2px 强调条（与活动栏同一套语汇，不靠"变亮"单维度区分） */
  box-shadow: inset 2px 0 0 var(--accent);
}
.files button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.files button.dir {
  color: var(--fg);
}
.ico {
  flex: none;
  opacity: 0.8;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
