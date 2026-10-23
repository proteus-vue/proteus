<script setup lang="ts">
// packages/studio/panels/CodePanel.vue —— 代码视图：**目录树** + 文件内容
//
// 【这一版改了什么（2026-10-23）】左侧从"300 条平铺列表"改成**真正的目录树**：
//   · 目录可折叠，折叠状态进会话状态（重启恢复 —— VS Code 同行为）；
//   · 默认**全展开**，因此存的是"折叠了谁"而不是"展开了谁"（新增目录自动可见）；
//   · 目录与文件分开排序（目录在前、再按名字），这是 IDE 的通用语汇，不是随机顺序。
//
// 【★编辑器（CodeMirror 6）为什么还没上】本目录不是 pnpm workspace 成员，装库要动**根**依赖；
//   而本机的 pnpm 在写 node_modules 时被环境拦截（`ERR_PNPM_CODEBROKER_BROKER_DENY`：
//   `symlink ... ENOENT`，`downloaded 0`），关掉沙箱也一样 ⇒ 依赖根本装不进来。
//   需要用户在自己终端跑一次：
//     pnpm add -w @codemirror/state @codemirror/view @codemirror/commands \
//                @codemirror/language @codemirror/lang-vue @codemirror/lang-rust
//   ★在此之前**不自己造编辑器内核**（G-56.1 红线）。所以这里仍是只读 `<pre>`：
//     宁可清楚地"少一块"，也不要一个自研的假编辑器。

import { computed, onMounted, ref } from 'vue'
import { hasBridge, listFiles, readText } from '../bridge'
import { useWorkspaceState } from '../useWorkspaceState'
import StudioIcon from '../icons/StudioIcon.vue'

/** ★G5：上次打开的文件 / 折叠的目录都存在工作区会话里（重启恢复）。 */
const ws = useWorkspaceState()

/** 列哪些子树（都是 Studio 自己的源码——显示它自己，一眼能核对"屏幕这段 == 仓库那段"） */
const ROOTS = ['packages/studio/ui/src', 'packages/studio/src', 'packages/studio/native'] as const
/** 树里展示的短路径前缀（去掉它更好读，`title` 里保留完整路径） */
const PREFIX = 'packages/studio/'

const files = ref<string[]>([])
const cur = ref('')
const text = ref('')
const err = ref('')
const loading = ref(false)

const lines = computed(() => (text.value ? text.value.replace(/\n$/, '').split('\n') : []))
const short = (p: string) => (p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p)

/* ─── 目录树 ────────────────────────────────────────────────────────────────
 * 用**扁平化**渲染（一次 v-for + 缩进），而不是递归组件：
 *   · 递归组件要多一个文件、多一层 props/emit，而这里只需要"行 + 缩进"；
 *   · 扁平化后行数 == 可见节点数，300 条也只是一次普通列表渲染。 */
interface TreeNode {
  name: string
  path: string
  dir: boolean
  children: TreeNode[]
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', dir: true, children: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!
      const isLeaf = i === parts.length - 1
      let next = node.children.find((c) => c.name === name)
      if (!next) {
        next = { name, path: parts.slice(0, i + 1).join('/'), dir: !isLeaf, children: [] }
        node.children.push(next)
      }
      node = next
    }
  }
  // 目录在前、文件在后，同级按名字（不区分大小写）——IDE 的通用排序
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    ns.forEach((n) => sort(n.children))
  }
  sort(root.children)
  return root.children
}

const tree = computed(() => buildTree(files.value))

interface Row {
  node: TreeNode
  depth: number
}

/** 可见行：折叠的目录不展开它的子树 */
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (ns: TreeNode[], depth: number) => {
    for (const n of ns) {
      out.push({ node: n, depth })
      if (n.dir && !ws.codeCollapsed.includes(n.path)) walk(n.children, depth + 1)
    }
  }
  walk(tree.value, 0)
  return out
})

function toggle(dir: string) {
  const i = ws.codeCollapsed.indexOf(dir)
  if (i >= 0) ws.codeCollapsed.splice(i, 1)
  else ws.codeCollapsed.push(dir)
}

/** 打开文件时把它所在的所有目录展开（否则文件被折叠在看不见的地方） */
function revealPath(path: string) {
  const parts = path.split('/')
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    const j = ws.codeCollapsed.indexOf(dir)
    if (j >= 0) ws.codeCollapsed.splice(j, 1)
  }
}

async function open(path: string) {
  cur.value = path
  ws.codeFile = path
  revealPath(path)
  loading.value = true
  err.value = ''
  try {
    text.value = await readText(path)
  } catch (e) {
    text.value = ''
    err.value = String((e as Error)?.message ?? e)
  } finally {
    loading.value = false
  }
}

async function boot() {
  if (!hasBridge()) {
    err.value = '无 Tauri 桥（浏览器直开时属正常）'
    return
  }
  try {
    files.value = await listFiles([...ROOTS])
  } catch (e) {
    err.value = String((e as Error)?.message ?? e)
    return
  }
  if (files.value.length === 0) {
    err.value = '文件列表为空（仓库根可达但没匹配到源码）'
    return
  }
  // 优先级：**上次打开的文件**（若还在列表里）> App.vue（自证）> 第一条
  // ★上次那个文件可能已被删/改名 ⇒ 找不到就体面回退，而不是报错
  const pref =
    files.value.find((f) => f === ws.codeFile) ??
    files.value.find((f) => f.endsWith('ui/src/App.vue')) ??
    files.value[0]!
  await open(pref)
}

onMounted(boot)
</script>

<template>
  <div class="codepane">
    <div class="bar">
      <span class="path" id="codePath" :title="cur">{{ cur || '—' }}</span>
      <span class="meta" id="codeMeta">{{ loading ? '读取中…' : `${lines.length} 行` }}</span>
      <span style="flex: 1" />
      <span class="note" id="codeNote">只读 · 编辑器待装依赖（见面板注释 / README）</span>
    </div>
    <div class="split">
      <nav class="files" id="codeFiles">
        <button
          v-for="r in rows"
          :key="r.node.path"
          :class="{ on: r.node.path === cur, dir: r.node.dir }"
          :style="{ paddingLeft: `${8 + r.depth * 12}px` }"
          :title="r.node.path"
          :data-dir="r.node.dir ? r.node.path : undefined"
          :data-file="r.node.dir ? undefined : r.node.path"
          :aria-expanded="r.node.dir ? !ws.codeCollapsed.includes(r.node.path) : undefined"
          @click="r.node.dir ? toggle(r.node.path) : open(r.node.path)"
        >
          <!-- 折叠箭头 + 类型图标：箭头只占位不显示在文件行上，这样同级名字都对齐 -->
          <span
            class="caret"
            :class="{ open: r.node.dir && !ws.codeCollapsed.includes(r.node.path) }"
          >
            <StudioIcon v-if="r.node.dir" name="chevron" :size="12" />
          </span>
          <StudioIcon :name="r.node.dir ? 'folder' : 'file'" :size="13" class="ico" />
          <span class="name">{{ r.node.name }}</span>
        </button>
      </nav>
      <div class="pane">
        <div v-if="err" class="err" id="codeErr">{{ err }}</div>
        <div v-else class="body">
          <div class="gutter">
            <div v-for="(_, i) in lines" :key="i">{{ i + 1 }}</div>
          </div>
          <pre class="src">{{ text }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.codepane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--sp2);
  height: 32px;
  padding: 0 var(--sp3);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}
.path {
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.meta {
  font-variant-numeric: tabular-nums;
}
.note {
  color: var(--fg-subtle);
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}
/* 目录树（次级侧栏）：行高 24px，落在 4px 网格上 */
.files {
  width: 232px;
  flex: none;
  overflow: auto;
  padding: var(--sp1) 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
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
/* 折叠箭头：12px 固定宽度（文件行的空占位同宽，保证同级名字左对齐） */
.caret {
  flex: none;
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  transition: transform var(--dur) var(--ease);
}
.caret.open {
  transform: rotate(90deg);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.err {
  margin: var(--sp4);
  padding: var(--sp2) var(--sp3);
  border: 1px solid var(--bad);
  border-radius: var(--r-md);
  background: var(--bad-weak);
  color: var(--bad);
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  user-select: text;
}
.body {
  display: flex;
  font: var(--fs-sm) / 1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.gutter {
  padding: var(--sp2) var(--sp2) var(--sp2) var(--sp3);
  text-align: right;
  color: var(--fg-subtle);
  opacity: 0.65;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.src {
  margin: 0;
  padding: var(--sp2) var(--sp4);
  color: var(--fg);
  white-space: pre;
  user-select: text;
}
</style>
