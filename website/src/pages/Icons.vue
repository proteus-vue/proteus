<script setup lang="ts">
// website/src/pages/Icons.vue —— ★Keryx 图标库预览 / 审查页（Proteus UI 的"方言层"）
//
// 【这一页是什么】把 `@proteus-vue/icons`（Keryx 图标数据包）**全量可视化**——供设计/工程**预览与质量审查**：
//   每枚图标的矢量形态、多尺寸清晰度、名称与分类一目了然。
//
// 【数据从哪来（零手写）】全部来自 `@proteus-vue/icons` 的 `ICON_SET` / `normalizedIcon`
//   （SVG path 单一真源）。页面**不硬编码任何图标**——图标集改了，本页即时反映（"文档不可能说谎"）。
//
// 【为什么"图标即数据非字体"（图标库方案 §4）】icon font 跨端字体依赖、可渲染成 tofu；unicode 字形同病。
//   ⇒ 单一真源 = SVG path，三端（Web 内联 svg / MP Path2D / App 内核 svg_path）同源渲染，零字体依赖、零 tofu。
//
// 【D-2 门禁（官网 dogfooding）】零 @media（走 auto-fill/minmax 柔性网格）；零裸平台 API
//   （复制走框架原语 @proteus-vue/desktop 的 copyText，页面不直接摸 navigator）。
import { computed, ref } from 'vue'
import { ICON_SET, ICON_NAMES } from '@proteus-vue/icons'
import { copyText } from '@proteus-vue/desktop'
import { locale } from '../i18n'

const isEn = computed(() => locale.value === 'en')

/** 全部图标（数据来自 icons 包——零手写）。 */
const all = computed(() =>
  ICON_NAMES.map((name) => ({
    name,
    d: ICON_SET[name]!.d, // 原始设计师路径（Web 现代浏览器可直接渲染）
    viewBox: ICON_SET[name]!.viewBox ?? '0 0 24 24',
    category: ICON_SET[name]!.category ?? 'other',
  })),
)

/** 分类清单（从数据派生）。 */
const CATS = computed(() => {
  const set = new Set<string>()
  for (const ic of all.value) set.add(ic.category)
  return ['all', ...[...set].sort()]
})
const CAT_LABEL: Record<string, [string, string]> = {
  all: ['全部', 'All'],
  nav: ['导航', 'Navigation'],
  action: ['操作', 'Action'],
  status: ['状态', 'Status'],
  mark: ['标记', 'Mark'],
  arrow: ['箭头', 'Arrow'],
  other: ['其他', 'Other'],
}
const catText = (c: string) => (CAT_LABEL[c] ?? [c, c])[isEn.value ? 1 : 0]

const activeCat = ref('all')
const size = ref(32)
const SIZES = [24, 32, 48]
const q = ref('')

const list = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return all.value.filter(
    (ic) => (activeCat.value === 'all' || ic.category === activeCat.value) && (kw === '' || ic.name.toLowerCase().includes(kw)),
  )
})

/** 复制图标名（走框架 clipboard 原语，页面零平台 API）。 */
const copied = ref('')
async function copyName(name: string): Promise<void> {
  const r = await copyText(name)
  if (r.ok) {
    copied.value = name
    setTimeout(() => {
      if (copied.value === name) copied.value = ''
    }, 1100)
  }
}
</script>

<template>
  <div class="ic-page">
    <header class="ic-head">
      <h2 class="ic-title">{{ isEn ? 'Icons · Keryx' : '图标库 · Keryx' }}</h2>
      <p class="ic-sub">
        {{
          isEn
            ? `${all.length} icons — SVG path as the single source of truth (not a font). Rendered identically on Web / mini-program / App (kernel svg_path). Zero font dependency, zero tofu. Click a card to copy its name.`
            : `${all.length} 枚图标 —— SVG path 单一真源（图标即数据，非字体）。Web / 小程序 / App（内核 svg_path）三端同源渲染，零字体依赖、零 tofu 风险。点击卡片复制名称。`
        }}
      </p>
    </header>

    <!-- 工具条：搜索 + 分类 + 尺寸（纯 Vue 状态，零平台 API） -->
    <div class="ic-bar">
      <div class="ic-search">
        <input v-model="q" type="search" class="ic-input" :placeholder="isEn ? 'Filter by name…' : '按名称筛选…'" />
      </div>
      <div class="ic-chips">
        <button
          v-for="c in CATS"
          :key="c"
          class="ic-chip"
          :class="{ 'ic-chip--on': activeCat === c }"
          @click="activeCat = c"
        >
          {{ catText(c) }}
        </button>
      </div>
      <div class="ic-chips ic-sizes">
        <button v-for="s in SIZES" :key="s" class="ic-chip" :class="{ 'ic-chip--on': size === s }" @click="size = s">
          {{ s }}
        </button>
      </div>
    </div>

    <div class="ic-count">{{ isEn ? `${list.length} shown` : `显示 ${list.length} 枚` }}</div>

    <!-- 图标网格（auto-fill 柔性网格——零 @media） -->
    <div class="ic-grid">
      <button
        v-for="ic in list"
        :key="ic.name"
        class="ic-cell"
        :class="{ 'ic-cell--copied': copied === ic.name }"
        :title="`${ic.name} · ${catText(ic.category)}`"
        @click="copyName(ic.name)"
      >
        <span class="ic-glyph" :style="{ width: size + 'px', height: size + 'px' }">
          <svg :viewBox="ic.viewBox" :width="size" :height="size" fill="currentColor" aria-hidden="true">
            <path :d="ic.d" />
          </svg>
        </span>
        <span class="ic-name">{{ ic.name }}</span>
        <span class="ic-cat">{{ catText(ic.category) }}</span>
        <span v-if="copied === ic.name" class="ic-copied">{{ isEn ? 'copied' : '已复制' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ic-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}
.ic-head {
  margin-bottom: 20px;
}
.ic-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.3px;
}
.ic-sub {
  margin-top: 8px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
  max-width: 760px;
}
.ic-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.ic-search {
  flex: 0 0 200px;
}
.ic-input {
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  font-size: 13px;
  outline: none;
}
.ic-input:focus {
  border-color: var(--brand);
}
.ic-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ic-sizes {
  margin-left: auto;
}
.ic-chip {
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.ic-chip:hover {
  color: var(--ink);
  border-color: var(--brand-ink);
}
.ic-chip--on {
  color: #fff;
  background: var(--brand);
  border-color: var(--brand);
}
.ic-count {
  margin: 14px 0 10px;
  color: var(--muted);
  font-size: 12px;
}
.ic-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.ic-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 0 0 104px;
  /* ★★★2026-10-11 方块统一：flex 项默认 `min-width:auto` ⇒ 长名字（nowrap）的 min-content 会把
     方块**撑宽**（实测 success_no_circle 127px vs 其余 104px = 用户报「标题长度撑开了」）。
     `min-width:0` 令方块严格用 flex-basis 的 104px；`overflow:hidden` 兜底任何内容不外溢。
     名字的省略号由 .ic-name 的 nowrap+ellipsis 承担。height 固定 ⇒ 长名也不会撑高。 */
  min-width: 0;
  overflow: hidden;
  height: 116px;
  border-radius: 12px;
  border: 1px solid var(--line-soft);
  background: var(--panel);
  color: var(--ink);
  cursor: pointer;
  transition: all 0.15s ease;
}
.ic-cell:hover {
  border-color: var(--brand-ink);
  background: var(--panel2);
  transform: translateY(-2px);
}
.ic-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ic-glyph svg {
  display: block;
}
.ic-name {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--mono, ui-monospace, monospace);
  max-width: 92%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ic-cat {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 10px;
  color: var(--muted);
  opacity: 0.6;
}
.ic-copied {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--brand-soft);
  color: var(--brand-ink);
  font-size: 12px;
  font-weight: 600;
}
</style>
