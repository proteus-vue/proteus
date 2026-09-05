<script setup lang="ts">
// website/src/pages/DocsPage.vue —— 文档页（★#390ii 四区通用：指南/组件/能力/柔性系统）
// 内容即数据：各区 md 由 @proteus-vue/docs 引擎构建期编译（frontmatter/html/toc），运行时 v-html 零解析
// 布局三栏：左分区侧边栏（分组）+ 正文 + 右侧「本页导读」粘性栏（p-stack row+wrap，窄容器自动换行）
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { findDoc, sections } from '../docs-registry'

const route = useRoute()
// 区 key 从路由前缀推导：/docs/component/:slug → components
const sectionKey = computed(() => {
  const first = route.path.split('/').filter(Boolean)[1] ?? ''
  if (first === 'component') return 'components'
  if (first === 'capability') return 'capabilities'
  if (first === 'system') return 'system'
  if (first === 'plugin') return 'plugins'
  if (first === 'reference') return 'reference'
  if (first === 'framework') return 'framework'
  return 'guide'
})
const section = computed(() => sections.find((s) => s.key === sectionKey.value) ?? sections[0]!)
const slug = computed(() => (route.params.slug as string) ?? '')
const current = computed(() => findDoc(section.value.base, slug.value) ?? section.value.items[0])
const docHtml = computed(() => current.value?.doc.html ?? '')
// ★#415 端指令：frontmatter.ends 展开的端表（SSOT = ends.ts + end-notes，构建期展开零漂移）
const ends = computed(() => current.value?.doc.ends ?? undefined)
const idx = computed(() => section.value.items.findIndex((g) => g.slug === slug.value))
const prev = computed(() => (idx.value > 0 ? section.value.items[idx.value - 1] : undefined))
const next = computed(() => (idx.value >= 0 && idx.value < section.value.items.length - 1 ? section.value.items[idx.value + 1] : undefined))
</script>

<template>
  <!-- ★#390iii 分区横条（参考小程序文档 IA）：大分类（四区）顶部横条切换，小分类（分组）留在左侧栏——侧栏不再两套层级拥挤 -->
  <p-view class="docs-shell">
    <div class="docs-topbar">
      <p-stack direction="row" :gap="16" wrap class="section-switch">
        <router-link
          v-for="s in sections"
          :key="s.key"
          :to="`${s.base}/${s.items[0]?.slug ?? ''}`"
          class="section-tab"
          :class="{ active: s.key === sectionKey }"
        >
          <p-text class="section-tab-text">{{ s.name }}</p-text>
          <span class="section-tab-count">{{ s.items.length }}</span>
        </router-link>
      </p-stack>
    </div>
  <p-sidebar :min-sidebar-width="720" :nav-width="224" class="guide">
    <template #nav>
      <p-view class="sidebar-card">
        <span class="eyebrow">◆ {{ section.name }}</span>
        <!-- 当前区分组导航 -->
        <p-view v-for="grp in section.groups" :key="grp.name" class="toc-group">
          <p-text class="toc-group-name">{{ grp.name }}</p-text>
          <p-view class="toc-nav">
            <router-link
              v-for="g in grp.items"
              :key="g.slug"
              :to="`${section.base}/${g.slug}`"
              class="toc-link"
              :class="{ active: g.slug === slug }"
            >
              <p-text class="toc-text">{{ g.title }}</p-text>
            </router-link>
          </p-view>
        </p-view>
      </p-view>
    </template>

    <!-- 正文：docs 引擎构建期产物 -->
    <p-view class="doc">
      <!-- ★本页导读右栏化：p-stack row+wrap 双栏——宽容器正文+右侧粘性 TOC，窄容器自动换行到正文下方（容器驱动，零 @media） -->
      <p-stack direction="row" :gap="28" wrap class="doc-area">
        <p-view class="doc-main">
          <!-- ★#415 端落地进度表（frontmatter.ends 声明的页面）：与组件/能力页兼容表同构 -->
          <p-view v-if="ends" class="ends-progress">
            <p-text class="ends-title">终端落地进度</p-text>
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
          <!-- 文档引擎 html：块级/行内全转义 + 语义类名（docs-*），样式见 style.css（md 内含 H1，页面头不再重复） -->
          <p-view class="doc-body" v-html="docHtml"></p-view>

          <!-- 上下篇 -->
          <p-stack direction="row" :gap="12" class="pager">
            <router-link v-if="prev" :to="`${section.base}/${prev.slug}`" class="pager-link">← 上一篇</router-link>
            <router-link v-if="next" :to="`${section.base}/${next.slug}`" class="pager-link">下一篇 →</router-link>
          </p-stack>
        </p-view>

        <!-- 页内导读（右栏粘性——滚动到哪一节一目了然） -->
        <p-view v-if="current?.doc.tocFlat.length" class="page-toc">
          <span class="eyebrow">◆ 本页导读</span>
          <a v-for="t in current.doc.tocFlat" :key="t.id" :href="`#${t.id}`" class="page-toc-link" :class="`depth-${t.depth}`">{{ t.text }}</a>
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
.section-switch { align-items: stretch; }
.section-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.toc-group + .toc-group { margin-top: 12px; }
.toc-group-name {
  color: var(--brand);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.toc-nav { display: flex; flex-direction: column; gap: 2px; }
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
  flex: 0 0 220px; /* 定宽不参与增长——多余空间全部让给正文 */
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
.page-toc-link { color: var(--muted); text-decoration: none; font-size: 13px; }
.page-toc-link:hover { color: var(--brand); }
.page-toc-link.depth-3 { padding-left: 16px; }
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
