<script setup lang="ts">
// ui/src/DiffView.vue —— 代码视图的 Diff 面板（决策 #1245）
//
// 比的是"**磁盘上的基线** vs **当前缓冲**"——即"我改了什么还没保存"。
// ★不做 git 对比：git 只读是路线的下一刀，接口留着（把 original 换成 `git show HEAD:path` 即可）。
import { computed } from 'vue'
import { diffLines } from './diff'

const props = defineProps<{
  original: string
  modified: string
  path: string
  /** 基准来源：磁盘基线 / git HEAD（只读） */
  source: 'disk' | 'head'
  /** HEAD 里没有这个文件（未跟踪/新增） */
  missing: boolean
}>()
const emit = defineEmits<{ switch: [src: 'disk' | 'head'] }>()

const result = computed(() => diffLines(props.original, props.modified))
const clean = computed(() => result.value.added === 0 && result.value.removed === 0)
</script>

<template>
  <div class="diff" id="diffView" :data-added="result.added" :data-removed="result.removed">
    <div class="head">
        <!-- 基准来源：磁盘基线 / HEAD（决策 #1246）。只读，不提供暂存/提交 -->
        <span class="seg">
          <button class="sbtn" :class="{ on: source === 'disk' }" data-src="disk" @click="emit('switch', 'disk')">磁盘</button>
          <button class="sbtn" :class="{ on: source === 'head' }" data-src="head" @click="emit('switch', 'head')">HEAD</button>
        </span>
        <span v-if="missing" class="warn">HEAD 里没有这个文件</span>
      <span class="stat"><b class="add">+{{ result.added }}</b> <b class="del">−{{ result.removed }}</b></span>
      <span v-if="result.truncated" class="warn">文件太大，已退化为整块替换</span>
    </div>
    <!-- ★来源切换必须**常驻**：切到 HEAD 时"本地没改动"不等于"和 HEAD 一样"，
         恰恰是没改动的时候最需要看 HEAD 差了什么（这是第一版把它塞进 v-else 里的 bug）。 -->
    <div v-if="clean" class="empty">{{ source === 'head' ? '与 HEAD 相同' : '没有未保存的改动' }}</div>
    <template v-else>
      <div class="rows">
        <div v-for="(r, i) in result.rows" :key="i" class="row" :class="r.kind">
          <span class="ln">{{ r.a ?? '' }}</span>
          <span class="ln">{{ r.b ?? '' }}</span>
          <span class="sign">{{ r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : r.kind === 'gap' ? '' : ' ' }}</span>
          <span v-if="r.kind === 'gap'" class="gapmark">⋯ {{ ' ' }}</span>
          <span v-else class="txt">{{ r.text || ' ' }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.diff {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--bg-canvas);
}
.empty {
  display: grid;
  place-items: center;
  flex: 1;
  color: var(--fg-subtle);
  font: var(--fs-xs) / 1.6 -apple-system, 'PingFang SC', sans-serif;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp3);
  height: 26px;
  padding: 0 var(--sp3);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  font: 11.5px/1 -apple-system, 'PingFang SC', sans-serif;
  color: var(--fg-subtle);
}
.head .seg {
  display: inline-flex;
  gap: 2px;
}
.head .sbtn {
  height: 18px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-subtle);
  font: inherit;
  cursor: pointer;
}
.head .sbtn:hover {
  color: var(--fg);
}
.head .sbtn.on {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--border);
  color: var(--fg);
}
.head .path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head .stat {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.head b {
  font-weight: 600;
}
.head .add {
  color: var(--syn-string);
}
.head .del {
  color: var(--bad);
}
.head .warn {
  color: var(--warn);
}
.rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font: 12px/20px ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}
.row {
  display: flex;
  align-items: baseline;
  white-space: pre;
  color: var(--fg);
}
.row .ln {
  flex: none;
  width: 44px;
  padding-right: 8px;
  text-align: right;
  color: var(--fg-subtle);
  opacity: 0.55;
  user-select: none;
}
.row .sign {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--fg-subtle);
  user-select: none;
}
.row .txt {
  flex: 1;
  padding-right: 12px;
}
/* 只用**极低饱和的底色**标行：IDE 的 diff 靠底色 + 左边一条细线，不靠整行高饱和 */
.row.add {
  background: rgba(74, 222, 128, 0.08);
}
.row.del {
  background: rgba(248, 113, 113, 0.08);
}
.row.add .sign {
  color: var(--syn-string);
}
.row.del .sign {
  color: var(--bad);
}
.row.gap {
  color: var(--fg-subtle);
  opacity: 0.6;
}
.gapmark {
  padding-left: 44px;
}
</style>
