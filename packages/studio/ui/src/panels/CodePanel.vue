<script setup lang="ts">
// packages/studio/ui/src/panels/CodePanel.vue
// ★★★G4：代码视图 —— 文件列表 + 只读展示（决策 #1190 后续）
//
// 【这一版仍是只读，但不只是"看三个写死的文件"】左侧是从 Rust 侧列的**真实文件列表**
//   （`list_files`：仓库内 · 扩展名白名单 · 跳过构建产物 · ≤300 条），点谁读谁。
//   文件通路的边界全在 Rust 侧（`repo_root` / `read_text`），前端不做路径拼接。
//
// 【还是没引 CodeMirror】按 G-56.1 红线编辑器内核只用现成的，但那是**独立一单**：
//   装依赖要改根 lockfile（本目录刻意无 package.json）。这一版把"浏览 + 打开"做扎实，
//   下一单把右侧 `<pre>` 换成 CodeMirror 6，其余不动。
//
// 【错误必须显示】打包成 .app 后仓库根不可达（编译期路径失效）⇒ 会看到「仓库根不可达」，
//   那是如实报错，不是空白面板。

import { computed, onMounted, ref } from 'vue'
import { hasBridge, listFiles, readText } from '../bridge'
import { useWorkspaceState } from '../useWorkspaceState'

/** ★G5：上次打开的文件存在工作区会话里（重启恢复）。 */
const ws = useWorkspaceState()

/** 列哪些子树（都是 Studio 自己的源码——显示它自己，一眼能核对"屏幕这段 == 仓库那段"） */
const ROOTS = ['packages/studio/ui/src', 'packages/studio/src', 'packages/studio/native'] as const
/** 列表里展示的短路径前缀（去掉它更好读，`title` 里保留完整路径） */
const PREFIX = 'packages/studio/'

const files = ref<string[]>([])
const cur = ref('')
const text = ref('')
const err = ref('')
const loading = ref(false)

const lines = computed(() => (text.value ? text.value.replace(/\n$/, '').split('\n') : []))
const short = (p: string) => (p.startsWith(PREFIX) ? p.slice(PREFIX.length) : p)

async function open(path: string) {
  cur.value = path
  ws.codeFile = path
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
      <span class="note">只读 · 编辑在下一单（CodeMirror 6）</span>
    </div>
    <div class="split">
      <nav class="files" id="codeFiles">
        <button v-for="f in files" :key="f" :class="{ on: f === cur }" :title="f" @click="open(f)">
          {{ short(f) }}
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
.split {
  flex: 1;
  min-height: 0;
  display: flex;
}
/* 文件列表（次级侧栏）：条目 26px，落在 4px 网格上 */
.files {
  width: 208px;
  flex: none;
  overflow: auto;
  padding: var(--sp1);
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
.files button {
  display: block;
  width: 100%;
  height: 26px;
  padding: 0 var(--sp2);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-muted);
  font: var(--fs-xs) / 26px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
