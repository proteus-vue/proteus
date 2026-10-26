<script setup lang="ts">
// ui/src/panels/GitBar.vue —— Git 只读条 + 改动清单（决策 #1246 引入，#1247 拆出并加联动）
//
// 【这一版新加的东西（决策 #1247）】点清单里的文件 = **一次点击回答"这个文件相对 HEAD 改了什么"**：
//   父组件收到 `open` 后会打开文件并把 Diff 切到 HEAD（VS Code 的 SCM 点文件语义）。
//   本组件只负责"发事件 + 显示"，不知道 Diff 存在 —— 谁有能力谁做，别在这里埋编辑器逻辑。
//
// 【视觉】一条 24px 的细带放在文件树上方：分支 / ↑↓ / 改动数。**不抢注意力**，
//   但一眼能看到"我在哪个分支、有几处没提交"。清单点开时压住文件树（同一时刻一个列表）。
import { git, gitOpen } from '../git'

defineProps<{
  /** 当前打开的文件 —— 清单里属于它的那一行要高亮（双向联动的另一半） */
  cur: string
}>()
const emit = defineEmits<{ open: [path: string] }>()
</script>

<template>
  <div v-if="git?.isRepo" class="gitbar" id="gitBar">
    <button class="gbranch" @click="gitOpen = !gitOpen" :title="`分支：${git?.branch}（只读）`">
      <span class="bmark">⎇</span><span class="bname" id="gitBranch">{{ git?.branch }}</span>
      <span v-if="git?.ahead || git?.behind" class="ab">↑{{ git?.ahead }} ↓{{ git?.behind }}</span>
    </button>
    <button class="gcount" id="gitCount" :class="{ clean: !git?.files.length }" @click="gitOpen = !gitOpen">
      {{ git?.files.length ? `${git?.files.length} 处改动` : '干净' }}
    </button>
  </div>
  <div v-if="git?.isRepo && gitOpen && git?.files.length" class="gitlist" id="gitList">
    <button
      v-for="f in git?.files ?? []"
      :key="f.path"
      class="gitem"
      :class="{ cur: f.path === cur }"
      :data-git="f.path"
      :title="`${f.path}（点开看相对 HEAD 的改动）`"
      @click="emit('open', f.path)"
    >
      <span class="gst" :data-st="f.status">{{ f.status }}</span>
      <span class="gpath">{{ f.path.split('/').pop() }}</span>
    </button>
  </div>
</template>

<style scoped>
/* 一条 24px 的细带：分支与改动数。不抢注意力，但一眼能看到 */
.gitbar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 var(--sp2);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  font: 11px/1 -apple-system, 'PingFang SC', sans-serif;
}
.gitbar button {
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font: inherit;
  padding: 2px 4px;
  border-radius: var(--r-sm);
}
.gitbar button:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
.gbranch {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.bmark {
  opacity: 0.6;
}
.bname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
}
.ab {
  color: var(--fg-subtle);
}
.gcount {
  margin-left: auto;
  flex: none;
}
.gcount.clean {
  color: var(--fg-subtle);
}
.gitlist {
  max-height: 180px;
  overflow: auto;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.gitem {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 22px;
  padding: 0 var(--sp2);
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  font: 11.5px/22px -apple-system, 'PingFang SC', sans-serif;
  text-align: left;
  cursor: pointer;
}
.gitem:hover {
  background: var(--bg-overlay);
  color: var(--fg);
}
/* 当前打开的那个文件：与文件树同一套"选中"语汇（左侧强调条），不靠整行高亮 */
.gitem.cur {
  color: var(--fg);
  box-shadow: inset 2px 0 0 var(--accent);
}
.gst {
  flex: none;
  width: 12px;
  text-align: center;
  font-weight: 600;
}
.gst[data-st='M'] {
  color: var(--syn-number);
}
.gst[data-st='A'] {
  color: var(--syn-string);
}
.gst[data-st='D'] {
  color: var(--bad);
}
.gst[data-st='?'] {
  color: var(--fg-subtle);
}
.gst[data-st='R'] {
  color: var(--syn-type);
}
.gst[data-st='U'] {
  color: var(--warn);
}
.gpath {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
