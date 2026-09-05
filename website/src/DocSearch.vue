<script setup lang="ts">
// website/src/DocSearch.vue —— 全站本地搜索弹层（★#442 对标 VitePress mini-search / Algolia 的本地替代）
// ⌘K / Ctrl+K 唤起 · 居中弹层 · ↑↓ 选择 · Enter 打开 · Esc 关闭 · 分区面包屑 · 命中高亮
// 零网络：构建期引擎产出段落索引（doc.searchIndex）+ searchDocs 多词 AND 评分
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { sections } from './docs-registry'
import { searchDocs, type SearchIndexEntry } from '@proteus-vue/docs'
// ★#443 桌面语义原语：快捷键匹配/平台标签/焦点陷阱全部收口 @proteus-vue/desktop（G-24）——不裸写 window keydown 判定
import { matchShortcut, parseShortcutExpr, shortcutLabel, createFocusTrap, type KeyEventLike } from '@proteus-vue/desktop'

interface Hit extends SearchIndexEntry {
  /** 所属页标题（面包屑 分区 · 页） */
  pageTitle: string
}

const router = useRouter()
const SECTION_NAME: Record<string, string> = {
  docs: '指南', framework: '框架', component: '组件', capability: '能力',
  system: '柔性系统', plugin: '插件 API', reference: '工具链',
}
function sectionNameOf(path: string): string {
  const m = path.match(/^\/docs\/([a-z-]+)/)
  return SECTION_NAME[m?.[1] ?? 'docs'] ?? ''
}

// 聚合索引（模块级一次构建——全站 7 分区段落条目）
const fullIndex: Hit[] = sections.flatMap((s) =>
  s.items.flatMap((it) => {
    const title = typeof it.doc.title === 'string' ? it.doc.title : it.slug
    return (it.doc.searchIndex ?? []).map((e) => ({ path: `${s.base}/${it.slug}`, anchor: e.anchor, heading: e.heading, text: e.text, pageTitle: title }))
  }),
)

const open = ref(false)
const q = ref('')
const results = ref<Hit[]>([])
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const modalEl = ref<HTMLDivElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let trap: ReturnType<typeof createFocusTrap> | null = null

// 快捷键语义（desktop/shortcut 原语：mod 平台归一——Mac ⌘ / Win Ctrl）
const OPEN_KEYS = parseShortcutExpr('mod+k')!.keys
const ESC_KEYS = parseShortcutExpr('escape')!.keys
const PLATFORM = typeof navigator !== 'undefined' ? navigator.platform : 'web'
const shortcutKbd = shortcutLabel('mod+k', PLATFORM) // ⌘K / Ctrl+K（平台自适应——原语归一，不手判）

watch(q, (v) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    const qq = v.trim()
    results.value = qq.length >= 2 ? searchDocs(fullIndex, qq, 12).map((e) => e as Hit) : []
    active.value = 0
  }, 120)
})

watch(open, (v) => {
  if (v) {
    nextTick(() => {
      inputEl.value?.focus()
      inputEl.value?.select()
      // 弹层焦点圈闭（desktop/focus-trap——无障碍刚需，对标 VitePress modal）
      trap = modalEl.value ? createFocusTrap(modalEl.value) : null
    })
  } else {
    trap = null
  }
})

function toggle(force?: boolean): void {
  open.value = force ?? !open.value
}

// 全局键：快捷键语义由 desktop shortcut 原语判定（mod+k 开 / escape 关）
function onGlobalKey(ev: KeyboardEvent): void {
  if (matchShortcut(ev as KeyEventLike, OPEN_KEYS)) {
    ev.preventDefault()
    toggle(true)
  } else if (open.value && matchShortcut(ev as KeyEventLike, ESC_KEYS)) {
    toggle(false)
  }
}

function onInputKey(ev: KeyboardEvent): void {
  // Tab 循环由焦点陷阱接管（弹层内不逃逸到页面）
  if (ev.key === 'Tab') {
    const handled = trap?.trapTab({ shiftKey: ev.shiftKey, preventDefault: () => ev.preventDefault() }) ?? false
    if (handled) ev.preventDefault()
    return
  }
  if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    active.value = Math.min(active.value + 1, results.value.length - 1)
    scrollActiveIntoView()
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    active.value = Math.max(active.value - 1, 0)
    scrollActiveIntoView()
  } else if (ev.key === 'Enter' && results.value.length) {
    go(results.value[Math.min(active.value, results.value.length - 1)])
  }
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    listEl.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  })
}

function go(hit: Hit): void {
  const url = hit.anchor ? `${hit.path}#${hit.anchor}` : hit.path
  toggle(false)
  q.value = ''
  void router.push(url).then(() => {
    if (hit.anchor) setTimeout(() => document.getElementById(hit.anchor as string)?.scrollIntoView({ behavior: 'smooth' }), 60)
  })
}

function splitHit(text: string, qq: string): Array<{ t: string; hit: boolean }> {
  if (!qq.trim()) return [{ t: text, hit: false }]
  const low = text.toLowerCase()
  const terms = qq.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // 高亮以首个词为锚（VitePress 同款——整句高亮后续迭代）
  const anchor = terms[0]
  const out: Array<{ t: string; hit: boolean }> = []
  let i = 0
  let pos = low.indexOf(anchor)
  while (pos >= 0) {
    if (pos > i) out.push({ t: text.slice(i, pos), hit: false })
    out.push({ t: text.slice(pos, pos + anchor.length), hit: true })
    i = pos + anchor.length
    pos = low.indexOf(anchor, i)
  }
  if (i < text.length) out.push({ t: text.slice(i), hit: false })
  return out
}

onMounted(() => window.addEventListener('keydown', onGlobalKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey, true))

const placeholder = computed(() => `搜索文档…（${shortcutKbd}）`)
</script>

<template>
  <button class="docsearch-trigger" type="button" aria-label="搜索文档" @click="toggle(true)">
    <span class="ds-icon" aria-hidden="true">⌕</span>
    <span class="ds-placeholder">搜索文档…</span>
    <kbd class="ds-kbd">{{ shortcutKbd }}</kbd>
  </button>

  <Teleport to="body">
    <div v-if="open" class="docsearch-overlay" @click.self="toggle(false)">
      <div ref="modalEl" class="docsearch-modal" role="dialog" aria-modal="true">
        <div class="docsearch-inputrow">
          <span class="ds-icon" aria-hidden="true">⌕</span>
          <input ref="inputEl" v-model="q" type="search" class="docsearch-input" :placeholder="placeholder" @keydown="onInputKey" />
          <kbd class="ds-kbd">Esc</kbd>
        </div>
        <div v-if="q.trim().length >= 2" class="docsearch-body">
          <p-text v-if="!results.length" class="docsearch-empty">无匹配结果——换个关键词试试</p-text>
          <div v-else ref="listEl" class="docsearch-list">
            <button
              v-for="(r, i) in results"
              :key="r.path + r.anchor + i"
              type="button"
              class="docsearch-item"
              :class="{ active: i === active }"
              @mouseenter="active = i"
              @click="go(r)"
            >
              <span class="ds-crumb">{{ sectionNameOf(r.path) }} · {{ r.pageTitle }}</span>
              <span class="ds-heading">
                <template v-for="(c, ci) in splitHit(r.heading, q)" :key="ci"><span :class="{ hl: c.hit }">{{ c.t }}</span></template>
              </span>
              <span v-if="r.anchor === '' && r.text !== r.heading" class="ds-text">
                <template v-for="(c, ci) in splitHit(r.text, q)" :key="ci"><span :class="{ hl: c.hit }">{{ c.t }}</span></template>
              </span>
            </button>
          </div>
        </div>
        <div v-else class="docsearch-hint">输入 ≥2 字符全站搜索（指南 / 框架 / 组件 / 能力 / 柔性系统 / 插件 API / 工具链）</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.docsearch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--panel);
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s, color 0.15s;
}
.docsearch-trigger:hover { border-color: var(--brand); color: var(--ink); }
.ds-placeholder { display: inline; }
.ds-kbd {
  font-size: 10px;
  color: var(--dim);
  border: 1px solid var(--line);
  border-radius: var(--radius-chip);
  padding: 1px 5px;
  background: var(--panel2);
}
.ds-icon { font-size: 15px; line-height: 1; }

/* 弹层 */
.docsearch-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 10vh 16px 16px;
}
.docsearch-modal {
  width: min(680px, 100%);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}
.docsearch-inputrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.docsearch-input {
  flex: 1;
  border: none;
  outline: none;
  background: none;
  font-size: 16px;
  color: var(--ink);
}
.docsearch-body { overflow-y: auto; }
.docsearch-list { display: flex; flex-direction: column; }
.docsearch-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 10px 18px;
  border: none;
  border-bottom: 1px solid var(--line);
  background: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.docsearch-item:last-child { border-bottom: none; }
.docsearch-item.active { background: var(--brand-soft); }
.ds-crumb { color: var(--dim); font-size: 11px; }
.ds-heading { color: var(--ink); font-size: 14px; font-weight: 600; }
.ds-text {
  color: var(--muted);
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hl { color: var(--brand); font-weight: 600; }
.docsearch-empty, .docsearch-hint { padding: 18px; color: var(--dim); font-size: 13px; }
</style>
