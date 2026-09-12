<script setup lang="ts">
// website/src/pages/DocsPage.vue —— 文档页（★#390ii 四区通用 + ★#468 国际化）
// 内容即数据：各区 md 由 @proteus-vue/docs 引擎构建期编译（frontmatter/html/toc），运行时 v-html 零解析
// ★#468 chrome 双语（@proteus-vue/i18n dogfooding）+ 英文内容变体（en/ overlay——试点指南区；缺失 → 提示回中文）
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { findDoc, sections, enModule, enTitleFor } from '../docs-registry'
import { locale, setLocale, t, sectionName, groupName } from '../i18n'

const route = useRoute()
// 区 key 从路由前缀推导：/docs/component/:slug → components
const sectionKey = computed(() => {
  const first = route.path.split('/').filter(Boolean)[1] ?? ''
  if (first === 'component') return 'components'
  if (first === 'capability') return 'capabilities'
  if (first === 'system') return 'system'
  if (first === 'primitives') return 'primitives'
  if (first === 'plugin') return 'plugins'
  if (first === 'reference') return 'reference'
  if (first === 'framework') return 'framework'
  return 'guide'
})
const section = computed(() => sections.find((s) => s.key === sectionKey.value) ?? sections[0]!)
const slug = computed(() => (route.params.slug as string) ?? '')
const current = computed(() => findDoc(section.value.base, slug.value) ?? section.value.items[0])
/** ★稳健活动 slug：以实际展示文档为准（URL 未命中 → 回退首项）——高亮/前后页/侧栏折叠三处同源 */
const activeSlug = computed(() => current.value?.slug ?? slug.value)
const isEn = computed(() => locale.value === 'en')
// ★#468 内容层：英文变体优先（变体含 title/html/toc），无变体 → 中文 + 提示条
const variant = computed(() => enModule(section.value.base, slug.value))
const displayDoc = computed(() => (isEn.value && variant.value ? variant.value : current.value.doc))
const docHtml = computed(() => displayDoc.value?.html ?? '')
// ★TOC 优化（防御）：目录文本剥 markdown 标记（`code`/**bold**/[link](x) 等）——无论 docs 引擎版本/缓存如何，目录始终纯文本
function stripMd(text: string): string {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](href) → text
    .replace(/[*_`~]/g, '') // 行内标记符
    .trim()
}
const tocFlat = computed(() =>
  ((variant.value && isEn.value ? variant.value.tocFlat : current.value.doc.tocFlat) ?? []).map((t2: { depth: number; text: string; id: string }) => ({ ...t2, text: stripMd(t2.text) })),
)
// ★导航体验（2026-09-11）：① 锚点跳转不被吸顶栏遮挡（scroll-margin 见 style）
//   ② 目录滚动高亮（scroll-spy）：监听正文标题，命中当前视口顶部者标 active
const activeId = ref('')
const NAV_OFFSET = 185 // --nav-h(97) + docs-topbar(~71) + 余量——与 scroll-margin-top 对齐
let spyTargets: Array<{ id: string; el: HTMLElement }> = []

/** 滚动线法（比 IntersectionObserver 窄带稳）：取滚动线以上最后一个标题为当前项 */
function updateSpy(): void {
  if (!spyTargets.length) return
  const line = NAV_OFFSET + 8
  let current = spyTargets[0]!.id
  for (const t of spyTargets) {
    if (t.el.getBoundingClientRect().top <= line) current = t.id
    else break
  }
  // 滚到底：强制高亮最后一项（末段条目常在线下）
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8) {
    current = spyTargets[spyTargets.length - 1]!.id
  }
  activeId.value = current
}

function setupSpy(): void {
  spyTargets = tocFlat.value
    .map((t) => ({ id: t.id, el: document.getElementById(t.id) }))
    .filter((t): t is { id: string; el: HTMLElement } => !!t.el)
  updateSpy()
}

function onScrollSpy(): void {
  updateSpy()
}

watch(
  [() => route.fullPath, docHtml],
  async () => {
    activeId.value = ''
    await nextTick()
    setupSpy()
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  spyTargets = []
  if (typeof window !== 'undefined') window.removeEventListener('scroll', onScrollSpy)
})
if (typeof window !== 'undefined') window.addEventListener('scroll', onScrollSpy, { passive: true })

const ends = computed(() => current.value?.doc.ends ?? undefined)
const noEn = computed(() => isEn.value && !variant.value)
const idx = computed(() => section.value.items.findIndex((g) => g.slug === activeSlug.value))
const prev = computed(() => (idx.value > 0 ? section.value.items[idx.value - 1] : undefined))
const next = computed(() => (idx.value >= 0 && idx.value < section.value.items.length - 1 ? section.value.items[idx.value + 1] : undefined))
/** sidebar 条目标题：英文态下翻译过的页用 en title，未翻译保持中文（诚实混合） */
function itemTitle(slugOf: string, zhTitle: string): string {
  return isEn.value ? (enTitleFor(section.value.base, slugOf) ?? zhTitle) : zhTitle
}

// ★侧栏折叠（2026-09-12）：一级域手风琴——默认仅展开「当前页所在域」，其余折叠（侧栏不再平铺过长）。
//   交互：点域标题切换；导航到某页时自动展开其所属域（手动折叠的当前域也会被导航重新展开，符合预期）。
const expandedGroups = ref(new Set<string>())
/** 当前域：以实际展示文档（activeSlug）推导 */
const activeGroupName = computed(() => section.value.groups.find((grp) => grp.items.some((g) => g.slug === activeSlug.value))?.name ?? '')
function isGroupOpen(name: string): boolean {
  return expandedGroups.value.has(name)
}
function toggleGroup(name: string): void {
  const set = new Set(expandedGroups.value)
  if (set.has(name)) set.delete(name)
  else set.add(name)
  expandedGroups.value = set
}
/** 切区/切页：确保当前域展开（切区时重置为「仅当前域」，避免跨区残留展开态） */
watch(
  [sectionKey, slug],
  ([key], [oldKey]) => {
    const active = activeGroupName.value
    if (key !== oldKey) {
      expandedGroups.value = active ? new Set([active]) : new Set()
    } else if (active) {
      const set = new Set(expandedGroups.value)
      set.add(active)
      expandedGroups.value = set
    }
  },
  { immediate: true },
)
</script>

<template>
  <!-- ★#390iii 分区横条（参考小程序文档 IA）：大分类顶部横条切换，小分类（分组）留在左侧栏 -->
  <p-view class="docs-shell">
    <div class="docs-topbar">
      <p-stack direction="row" :gap="16" class="section-switch">
        <router-link
          v-for="s in sections"
          :key="s.key"
          :to="`${s.base}/${s.items[0]?.slug ?? ''}`"
          class="section-tab"
          :class="{ active: s.key === sectionKey }"
        >
          <p-text class="section-tab-text">{{ sectionName(s.key) }}</p-text>
          <span class="section-tab-count">{{ s.items.length }}</span>
        </router-link>
      </p-stack>
    </div>
  <p-sidebar :min-sidebar-width="720" :nav-width="224" :toggle-label="t('nav.toggle')" class="guide">
    <template #nav>
      <p-view class="sidebar-card">
        <span class="eyebrow">{{ t('toc.sidebar', { name: sectionName(section.key) }) }}</span>
        <!-- 当前区分组导航（★一级域手风琴：点标题折叠/展开，默认仅展开当前域） -->
        <p-view v-for="grp in section.groups" :key="grp.name" class="toc-group" :class="{ 'toc-group--collapsed': !isGroupOpen(grp.name) }">
          <button
            type="button"
            class="toc-group-name"
            :class="{ 'toc-group-name--open': isGroupOpen(grp.name) }"
            :aria-expanded="isGroupOpen(grp.name)"
            @click="toggleGroup(grp.name)"
          >
            <span class="toc-chevron" aria-hidden="true" />
            <span class="toc-group-label">{{ groupName(grp.name) }}</span>
            <span class="toc-group-count">{{ grp.items.length }}</span>
          </button>
          <p-view v-show="isGroupOpen(grp.name)" class="toc-nav">
            <router-link
              v-for="g in grp.items"
              :key="g.slug"
              :to="`${section.base}/${g.slug}`"
              class="toc-link"
              :class="{ active: g.slug === activeSlug }"
            >
              <p-text class="toc-text">{{ itemTitle(g.slug, g.title) }}</p-text>
            </router-link>
          </p-view>
        </p-view>
      </p-view>
    </template>

    <!-- 正文：docs 引擎构建期产物 -->
    <p-view class="doc">
      <p-stack direction="row" :gap="28" wrap class="doc-area">
        <p-view class="doc-main">
          <!-- ★#468 未翻译提示（英文态下隐藏中文正文——诚实降级，不混排） -->
          <p-view v-if="noEn" class="no-en">
            <p-text class="no-en-title">{{ t('doc.noen.title') }}</p-text>
            <p-text class="no-en-body">{{ t('doc.noen.body') }}</p-text>
            <button type="button" class="no-en-back" @click="setLocale('zh')">{{ t('doc.noen.back') }}</button>
          </p-view>
          <!-- ★#415 端落地进度表（frontmatter.ends 声明的页面） -->
          <p-view v-if="ends && !noEn && (!isEn || variant?.ends)" class="ends-progress">
            <p-text class="ends-title">{{ t('doc.ends.title') }}</p-text>
            <table class="ends-table">
              <thead><tr><th>端</th><th>状态</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="e in ends" :key="e.id">
                  <td>{{ e.name }}</td>
                  <td class="ends-status">{{ e.status }}</td>
                  <td class="ends-note">{{ e.note || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p-text class="ends-footnote">端状态取自端注册表；端架构对照见 <a href="#/docs/framework/ends-matrix">端与成熟度</a>。</p-text>
          </p-view>
          <!-- 文档引擎 html（md 内含 H1，页面头不再重复）——未翻译页在英文态下不渲染中文正文 -->
          <p-view v-if="!noEn" class="doc-body" v-html="docHtml"></p-view>

          <!-- 上下篇 -->
          <p-stack v-if="!noEn" direction="row" :gap="12" class="pager">
            <router-link v-if="prev" :to="`${section.base}/${prev.slug}`" class="pager-link">{{ t('doc.prev') }}</router-link>
            <router-link v-if="next" :to="`${section.base}/${next.slug}`" class="pager-link">{{ t('doc.next') }}</router-link>
          </p-stack>
        </p-view>

        <!-- 页内导读（右栏粘性）——未翻译页在英文态下不显示中文 TOC -->
        <p-view v-if="tocFlat.length && !noEn" class="page-toc">
          <span class="eyebrow">{{ t('toc.onthepage') }}</span>
          <a
            v-for="toc in tocFlat"
            :key="toc.id"
            :href="`#${toc.id}`"
            class="page-toc-link"
            :class="[`depth-${toc.depth}`, { active: activeId === toc.id }]"
            @click="activeId = toc.id"
          >{{ toc.text }}</a>
        </p-view>
      </p-stack>
    </p-view>
  </p-sidebar>
  </p-view>
</template>

<style scoped>
/* ★#384：布局与折叠交互全部归 p-sidebar 组件（collapsed 模式内建切换条）——
   页面只写卡片视觉；side-rail 态侧栏卡片 sticky 避让导航 */
.guide { padding-bottom: 48px; }
/* ★#390iii 分区横条（小程序文档式按钮卡片版）：居中一排明显的大按钮卡片——
   未激活 = 卡片描边（panel2 底 + muted 文字）；激活 = 品牌实心 + 白字（对应参考图绿色实心钮） */
.docs-shell { display: block; }
.docs-topbar {
  position: sticky;
  top: var(--nav-h);
  z-index: 15;
  display: flex;
  justify-content: center;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 10px 24px;
  margin: 0 -24px 20px; /* 抵消 main 的横向 padding——横条通栏 */
}
.section-switch {
  align-items: stretch;
  /* ★#434 移动端：单行横向滚动（不换行占多行）——微信 docs/小程序文档移动端同款 */
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.section-switch::-webkit-scrollbar { display: none; }
/* 居中 + 溢出左对齐（flex 居中在溢出时会把开头裁到滚不到——first/last margin auto 经典解法） */
.section-switch > :first-child { margin-left: auto; }
.section-switch > :last-child { margin-right: auto; }
.section-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto; /* 不收缩不换行——横滑由容器承担 */
  min-width: 128px;
  padding: 12px 24px;
  text-decoration: none;
  border-radius: var(--radius-sm);
  background: var(--panel2);
  border: 1px solid var(--line);
  transition: background 0.15s, border-color 0.15s;
}
.section-tab-text { color: var(--muted); font-size: 15px; font-weight: 600; transition: color 0.15s; }
.section-tab-count { margin-left: 8px; font-size: 12px; color: var(--dim); }
.section-tab:hover { background: var(--panel); border-color: var(--brand); }
.section-tab:hover .section-tab-text { color: var(--ink); }
/* 激活态：品牌实心 + 白字（明显可点的那个） */
.section-tab.active {
  background: var(--brand);
  border-color: var(--brand);
}
.section-tab.active .section-tab-text { color: #fff; }
.section-tab.active .section-tab-count { color: rgba(255, 255, 255, 0.75); }
.section-tab.active:hover { background: var(--brand); }
.sidebar-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: var(--sp-16);
  background: var(--panel);
}
/* side-rail（宽容器）态：侧栏卡片 sticky 避让导航——现在还要避开分区横条（约 60px） */
.p-sidebar-side-rail .sidebar-card {
  position: sticky;
  top: calc(var(--nav-h) + 72px);
  max-height: calc(100vh - var(--nav-h) - 88px);
  overflow-y: auto;
}
.toc-group { display: flex; flex-direction: column; gap: 2px; }
.toc-group + .toc-group { margin-top: 6px; }
/* ★一级域标题：可点击折叠按钮（reset 原生 button 样式，视觉沿用原品牌色小标题） */
.toc-group-name {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 10px;
  margin: 0 -10px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  color: var(--brand);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  font-family: inherit;
  transition: background 0.15s;
}
.toc-group-name:hover { background: var(--panel2); }
.toc-group-label { flex: 1 1 auto; }
/* 折叠态域计数（弱化——仅提示该域条目数） */
.toc-group-count {
  flex: 0 0 auto;
  color: var(--muted);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0;
}
/* 折叠指示：纯 CSS 三角（展开朝下、折叠朝右——不依赖图标集） */
.toc-chevron {
  flex: 0 0 auto;
  width: 0;
  height: 0;
  border-left: 4px solid currentColor;
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  transition: transform 0.18s ease;
  transform: rotate(90deg); /* 展开：朝下 */
}
.toc-group--collapsed .toc-chevron { transform: rotate(0deg); }
.toc-nav { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }
.toc-link {
  display: block;
  position: relative;
  padding: 5px 10px;
  margin: 0 -10px; /* 内边距外扩用负 margin 回补——链接文字与组标题左对齐 */
  text-decoration: none;
  border-radius: var(--radius-sm);
}
.toc-text { color: var(--muted); font-size: 13px; transition: color 0.15s; }
.toc-link:hover { background: var(--panel2); }
.toc-link:hover .toc-text { color: var(--ink); }
.toc-link.active { background: var(--brand-soft); }
.toc-link.active .toc-text { color: var(--brand); font-weight: 600; }
/* ★激活态左侧品牌色竖条（不挤占文本位置——absolute 悬浮） */
.toc-link.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 1px;
  background: var(--brand);
}
.doc { flex: 1 1 480px; min-width: 0; }
/* ★本页导读右栏：p-stack row+wrap 双栏（行向语义归组件——不用 p-view 再跟框架默认打优先级） */
.doc-main { flex: 1 1 480px; min-width: 0; }
/* ★双类选择器提特异性：p-view 自带 scoped 的 content-box/flex-column（同特异性但级联靠后）——border-box 必须显式打赢（铁律） */
.page-toc.page-toc {
  flex: 0 0 236px; /* 定宽不参与增长——多余空间全部让给正文（★TOC 优化：微加宽容纳方法名） */
  box-sizing: border-box;
  align-self: flex-start;
  position: sticky;
  top: calc(var(--nav-h) + 16px);
  max-height: calc(100vh - var(--nav-h) - 32px);
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: var(--sp-16);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.page-toc-link {
  color: var(--muted);
  text-decoration: none;
  width: 100%;
  box-sizing: border-box;
  line-height: 1.5;
  overflow-wrap: anywhere; /* ★长方法名换行不溢出容器 */
  padding: 3px 8px 3px 10px; /* ★一级：左内边距给 active 竖条留呼吸位（原先 0 → 竖条贴字） */
  border-left: 2px solid transparent;
  border-radius: 0 6px 6px 0;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.page-toc-link:hover { color: var(--brand); background: var(--panel2); }
/* ★导航体验：目录当前项高亮（scroll-spy）——品牌色 + 加粗 + 左侧竖条 + 浅底 */
.page-toc-link.active {
  color: var(--brand);
  font-weight: 600;
  border-left-color: var(--brand);
  background: var(--brand-soft);
}
/* ★TOC 层级：一级 h2（正文节）/ 二级 h3（方法、类型）/ 三级 h4（扩展接口方法）——逐级缩进 */
.page-toc-link.depth-2 { font-weight: 600; font-size: 13px; }
.page-toc-link.depth-3 {
  padding-left: 24px;
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  color: var(--muted);
}
.page-toc-link.depth-4 {
  padding-left: 38px;
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  color: var(--muted);
  opacity: 0.86;
}
.page-toc-link.depth-3.active,
.page-toc-link.depth-4.active { color: var(--brand); opacity: 1; }
.pager { margin-top: 20px; }
.pager-link { color: var(--brand); text-decoration: none; font-size: 14px; }
.pager-link:hover { text-decoration: underline; }
/* ★#415 端落地进度表（frontmatter.ends 声明的页面——与组件/能力页兼容表同构） */
.ends-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--panel);
  padding: var(--sp-16);
  margin-bottom: 20px;
}
.ends-title { color: var(--ink); font-size: 15px; font-weight: 700; }
.ends-table { border-collapse: collapse; width: 100%; font-size: 14px; }
.ends-table th, .ends-table td { border: 1px solid var(--line); padding: 7px 12px; text-align: left; }
.ends-table th { color: var(--ink); background: var(--panel2); }
.ends-table td { color: var(--muted); }
.ends-status { white-space: nowrap; color: var(--ink); }
.ends-note { color: var(--muted); }
.ends-footnote { color: var(--dim); font-size: 12px; }
.ends-footnote a { color: var(--brand2); text-decoration: none; }
</style>
<style scoped>
/* ★#468 叠加：未翻译提示条（诚实降级） */
.no-en {
  border: 1px dashed var(--line);
  background: var(--panel2);
  border-radius: var(--radius-xl);
  padding: 16px 18px;
  margin-bottom: 20px;
}
.no-en-title { font-weight: 700; color: var(--ink); }
.no-en-body { display: block; color: var(--muted); font-size: 13px; margin-top: 4px; }
.no-en-back {
  margin-top: 10px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--brand);
  border-radius: var(--radius-chip);
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}
</style>