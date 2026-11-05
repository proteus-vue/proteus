<script setup lang="ts">
/**
 * DefPeek.vue —— ⌘ 长按时的**定义预览卡**（决策 #1436 / 交互重做 #1438）
 *
 * 【交互要点】
 *   · 鼠标可以移到卡片上：`setPeekPinned` 钉住，卡片不消失（这是"能复制"的前提）；
 *   · 正文**可选中**：`user-select: text`，可拖拽选区、⌘C 复制；
 *   · 顶部「复制」按钮复制整块预览代码（走 Tauri `copy_text`，webview 的
 *     `navigator.clipboard` 在非安全上下文不一定可用）；
 *   · 跳转**只由「跳转」按钮触发**（原来整卡可点 ⇒ 想选代码就会误跳）。
 *
 * 【为什么 fixed 定位】`coordsAtPos` 给的是视口坐标，用 absolute 还要自己减容器偏移、
 * 滚动时还得跟随；fixed 直接对齐。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { peekState, setPeekPinned, type PeekData } from './modPeek'
import { copyText } from './bridge'
import { effectiveLangId } from './editorLang'
import { highlightLines } from './syntaxTheme'
import type { DefTarget } from './nav'

const emit = defineEmits<{ (e: 'jump', t: DefTarget): void }>()

const data = computed<PeekData | null>(() => peekState.value as PeekData | null)

/** 路径显示：末两级足够分辨，完整路径在窄卡里会撑爆 */
const shortPath = computed(() => {
  const p = data.value?.target.path ?? ''
  if (!p) return ''
  if (p.startsWith('/')) return `…/${p.split('/').filter(Boolean).slice(-2).join('/')}`
  return p.split('/').slice(-2).join('/')
})

/* ── 语法高亮（决策 #1441）───────────────────────────────────────────────
   复用主编辑器的 `studioHighlight`（同一个实例 ⇒ 类名与 CSS 完全一致），
   把整块代码交给 `highlightLines` 切成逐行 HTML。
   ★必须传**整段连续代码**：跨行的块注释/模板字符串要靠上下文才能正确着色，
     逐行独立解析会把它们当普通代码。 */
const codeHtml = computed(() => {
  const d = data.value
  if (!d?.lines.length) return []
  return highlightLines(d.lines.map((l) => l.text).join('\n'), effectiveLangId(d.target.path))
})

/* ── 复制 ─────────────────────────────────────────────────────────────── */
const copied = ref(false)
async function copy(): Promise<void> {
  const d = data.value
  if (!d?.lines.length) return
  /* 复制的是**纯代码**（不含行号），并保留原始缩进 */
  await copyText(d.lines.map((l) => l.text).join('\n')).catch(() => {})
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1200)
}

/* ── 定位：默认贴符号下方；下方放不下就翻到上方 ─────────────────────────── */
const el = ref<HTMLElement | null>(null)
const measured = ref(320)

/** 视觉宽度估算：等宽字体里中文/全角差不多是 ASCII 的两倍 */
function visualLen(s: string): number {
  let w = 0
  for (const ch of s) w += /[\u1100-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 11 : 6.3
  return w
}

/** 宽度随内容（短块不留大片空白，长行最多 660px，再多横向滚动） */
const cardW = computed(() => {
  const d = data.value
  if (!d?.lines.length) return 360
  let max = 24
  for (const l of d.lines) max = Math.max(max, visualLen(l.text))
  return Math.min(660, Math.max(340, Math.round(max) + 56))
})

const box = computed(() => {
  const d = data.value
  if (!d) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const H = measured.value
  const W = cardW.value
  const left = Math.max(8, Math.min(d.anchor.left, vw - W - 8))
  const below = d.anchor.bottom + 6
  const top = below + H > vh - 8 ? Math.max(8, d.anchor.top - H - 6) : below
  /* ★`maxHeight` **不能绑测量值**：面板被 max-height 裁剪后 `offsetHeight` 就是裁剪值，
     再喂回去会让卡片越量越矮（实测 6 行的函数只显示 2 行）。这里只按视口定上限。 */
  return { left: `${left}px`, top: `${top}px`, width: `${W}px`, maxHeight: `${Math.min(520, vh - 16)}px` }
})

/* 卡片换内容后重新量高度（不同定义块行数差很多，估死会出现"上下颠倒但没翻"） */
watch(
  () => data.value,
  async () => {
    if (!data.value) return
    await nextTick()
    /* `scrollHeight` = **内容真实高度**（不受 max-height 裁剪），用它决定"往下贴还是往上翻" */
    const h = el.value?.scrollHeight ?? 0
    if (h) measured.value = Math.min(h, Math.min(520, window.innerHeight - 16))
  },
)
</script>

<template>
  <div
    v-if="data"
    ref="el"
    class="defpeek"
    :style="box"
    @mouseenter="setPeekPinned(true)"
    @mouseleave="setPeekPinned(false)"
    @mousedown.stop
  >
    <div class="dphead">
      <span class="dpname">{{ shortPath }}</span>
      <span class="dpline">:{{ data.target.line }}</span>
      <span v-if="data.readonly" class="dpro">只读</span>
      <span class="dpspacer" />
      <button class="dpbtn" :class="{ ok: copied }" title="复制这段代码" @click="copy">
        {{ copied ? '已复制' : '复制' }}
      </button>
      <button class="dpbtn primary" title="跳到定义" @click="emit('jump', data.target)">跳转</button>
    </div>
    <pre v-if="data.lines.length" class="dpcode"><div
        v-for="(l, i) in data.lines"
        :key="l.no"
        class="dprow"
        :class="{ hit: l.no === data.target.line }"
      ><span class="dpno">{{ l.no }}</span><span class="dptext" v-html="codeHtml[i]" /></div></pre>
    <div v-else class="dpempty">读不到文件内容（可能过大或不可读）</div>
    <div v-if="data.truncated" class="dptrunc">已截断 · 共 {{ data.span }} 行，点「跳转」看全文</div>
  </div>
</template>

<style scoped>
.defpeek {
  position: fixed;
  /* ★必须高于 CodeMirror 的 tooltip（`.cm-tooltip` 是 z-index: 200，见 baseTheme） */
  z-index: 250;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 1px solid #3a3f47;
  border-radius: 6px;
  background: #1f2228;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  /* 整卡不再是点击区：想选代码就选，不会误跳 */
  cursor: default;
}
.dphead {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid #2a2d33;
  color: #8b93a1;
  font: 11px/1.4 system-ui, -apple-system, 'PingFang SC', sans-serif;
}
.dpname {
  overflow: hidden;
  color: #e6e9ef;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dpline {
  color: #4c8dff;
}
.dpro {
  padding: 0 4px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  font-size: 10px;
}
.dpspacer {
  flex: 1;
}
/* 顶部按钮：小、可点、与卡片同色系 */
.dpbtn {
  flex: none;
  padding: 1px 7px;
  border: 1px solid #3f4550;
  border-radius: 3px;
  background: transparent;
  color: #a9b2c0;
  font: 10.5px/1.6 system-ui, -apple-system, 'PingFang SC', sans-serif;
  cursor: pointer;
}
.dpbtn:hover {
  border-color: #4c8dff;
  color: #e6e9ef;
}
.dpbtn.ok {
  border-color: #3f7a55;
  color: #6cc08b;
}
.dpbtn.primary {
  border-color: #3f5f96;
  color: #8fb4ff;
}
.dpcode {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  /* ★可选中：拖拽选区 / ⌘C 都要靠它（Studio 全局是 user-select: none） */
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
}
.dprow {
  display: flex;
  gap: 8px;
  padding: 0 8px;
  white-space: pre;
  user-select: text;
  -webkit-user-select: text;
}
/* 定义所在行高亮：预览的全部意义就是"一眼看到它" */
.dprow.hit {
  background: rgba(76, 141, 255, 0.14);
}
.dpno {
  flex: none;
  min-width: 30px;
  color: #5d6673;
  text-align: right;
  /* 行号不参与复制：它不属于代码 */
  user-select: none;
  -webkit-user-select: none;
}
.dptext {
  color: #c9d1d9;
}
.dpempty {
  padding: 8px;
  color: #8b93a1;
  font-size: 11px;
}
.dptrunc {
  flex: none;
  padding: 3px 8px;
  border-top: 1px solid #2a2d33;
  color: #8b93a1;
  font-size: 10px;
}
</style>
