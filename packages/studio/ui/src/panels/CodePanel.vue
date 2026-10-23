<script setup lang="ts">
// packages/studio/ui/src/panels/CodePanel.vue
// ★★★G4 第一块砖（决策 #1190 后续）：**代码视图的文件通路**
//
// 【这一版只做"只读展示"，不引 CodeMirror】按 G-56.1 红线，编辑器内核只用现成的；
//   但"接 CodeMirror"是一次独立改动（新依赖 + binding），不该和"文件通路"混在一单里。
//   ⇒ 先用 `<pre>` 把通路跑通：**能读到真文件、能显示行号、读不到会明确报错**。
//     下一单把 `<pre>` 换成 CodeMirror 6，其余不动。
//
// 【为什么文件列表是写死的三个】这是**自证**：显示的是 Studio 自己的源码，
//   一眼能核对"屏幕上这段 == 仓库里那段"。真做成文件树需要 G4 的工程目录选择，
//   不在这一版（`read_file` 的边界也写清楚了：仓库内 + ≤512KB）。
//
// 【错误必须显示出来】打包成 .app 后仓库根不可达（编译期路径失效）⇒ 这里会看到
//   「仓库根不可达」——那是**如实**的，不是空白面板。

import { computed, onMounted, ref } from 'vue'
import { hasBridge, readText } from '../bridge'

const FILES = [
  { label: 'ui/src/App.vue', path: 'packages/studio/ui/src/App.vue' },
  { label: 'src/main.rs', path: 'packages/studio/src/main.rs' },
  { label: 'native/embed_view.m', path: 'packages/studio/native/embed_view.m' },
] as const

const cur = ref<string>(FILES[0].path)
const text = ref('')
const err = ref('')
const loading = ref(false)

const lines = computed(() => (text.value ? text.value.replace(/\n$/, '').split('\n') : []))

async function load() {
  if (!hasBridge()) {
    err.value = '无 Tauri 桥（浏览器直开时属正常）'
    text.value = ''
    return
  }
  loading.value = true
  err.value = ''
  try {
    text.value = await readText(cur.value)
  } catch (e) {
    text.value = ''
    err.value = String((e as Error)?.message ?? e)
  } finally {
    loading.value = false
  }
}

async function pick(e: Event) {
  cur.value = (e.target as HTMLSelectElement).value
  await load()
}

onMounted(load)
</script>

<template>
  <div class="codepane">
    <div class="bar">
      <select :value="cur" @change="pick">
        <option v-for="f in FILES" :key="f.path" :value="f.path">{{ f.label }}</option>
      </select>
      <span class="meta" id="codeMeta">
        {{ loading ? '读取中…' : `${lines.length} 行` }}
      </span>
      <span style="flex: 1" />
      <span class="note">只读 · 编辑在下一单（CodeMirror 6）</span>
    </div>
    <div v-if="err" class="err" id="codeErr">{{ err }}</div>
    <div v-else class="body">
      <div class="gutter">
        <div v-for="(_, i) in lines" :key="i">{{ i + 1 }}</div>
      </div>
      <pre class="src">{{ text }}</pre>
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
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  font-size: 12px;
  color: var(--fg-muted);
}
.bar select {
  background: var(--bg-elevated);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 6px;
  font: inherit;
}
.meta {
  font-variant-numeric: tabular-nums;
}
.note {
  color: var(--fg-muted);
  opacity: 0.8;
}
.err {
  margin: 14px;
  padding: 10px 12px;
  border: 1px solid var(--bad);
  border-radius: 8px;
  color: var(--bad);
  background: var(--bad-weak);
  font-size: 12px;
  white-space: pre-wrap;
  user-select: text;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: auto;
  font: var(--fs-sm)/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.gutter {
  padding: 8px 8px 8px 12px;
  text-align: right;
  color: var(--fg-muted);
  opacity: 0.6;
  border-right: 1px solid var(--border);
  background: var(--bg-surface);
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.src {
  margin: 0;
  padding: 8px 14px;
  color: var(--fg);
  white-space: pre;
  user-select: text;
}
</style>
