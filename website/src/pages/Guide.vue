<script setup lang="ts">
// website/src/pages/Guide.vue —— 文档页（B2 验收：侧边栏自动生成 + md 构建期编译渲染）
// ★内容即数据：guides/*.md 由 @proteus-vue/docs 引擎在 vite 构建期编译（frontmatter/html/toc），
//   运行时只做 v-html + TOC 渲染，零 markdown 解析
// ★D-2（#377）：布局标签 p-view/p-text 语义组件
// ★W-6 柔性框架优先：柔性网格 + v-p-fluid，零 @media
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { findGuide, guideGroups, guides } from '../guides'

const route = useRoute()
const slug = computed(() => (route.params.slug as string) ?? '')
const current = computed(() => findGuide(slug.value) ?? guides[0])
const docHtml = computed(() => current.value?.doc.html ?? '')
const idx = computed(() => guides.findIndex((g) => g.slug === slug.value))
const prev = computed(() => (idx.value > 0 ? guides[idx.value - 1] : undefined))
const next = computed(() => (idx.value >= 0 && idx.value < guides.length - 1 ? guides[idx.value + 1] : undefined))
</script>

<template>
  <!-- ★p-sidebar（G-22 Fluid System S3）：自适应侧边栏原语——容器 ≥720px 走左侧栏、
       窄容器自动切顶部横向导航（createContainerQuery 按容器而非视口求解——分屏/多窗口自适应）；
       附送车机 d-pad 焦点导航 + reduced-motion。业务页面零布局代码（W-1/W-6 兑现） -->
  <p-sidebar :min-sidebar-width="720" :nav-width="240" class="guide">
    <template #nav>
      <p-view class="sidebar-card">
        <span class="eyebrow">◆ 指南</span>
        <!-- ★分组导航：frontmatter.group → 组标题 + 组内链接（组序 = 组内最小 order） -->
        <p-view v-for="grp in guideGroups" :key="grp.name" class="toc-group">
          <p-text class="toc-group-name">{{ grp.name }}</p-text>
          <p-view class="toc-nav">
            <router-link
              v-for="g in grp.items"
              :key="g.slug"
              :to="`/docs/${g.slug}`"
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
          <!-- 文档引擎 html：块级/行内全转义 + 语义类名（docs-*），样式见 style.css（md 内含 H1，页面头不再重复） -->
          <p-view class="doc-body" v-html="docHtml"></p-view>

          <!-- 上下篇 -->
          <p-stack direction="row" :gap="12" class="pager">
            <router-link v-if="prev" :to="`/docs/${prev.slug}`" class="pager-link">← 上一篇</router-link>
            <router-link v-if="next" :to="`/docs/${next.slug}`" class="pager-link">下一篇 →</router-link>
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
</template>

<style scoped>
/* ★#384：布局与折叠交互全部归 p-sidebar 组件（collapsed 模式内建切换条）——
   页面只写卡片视觉；side-rail 态侧栏卡片 sticky 避让导航 */
.guide { padding-bottom: 48px; }
.sidebar-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  padding: var(--sp-16);
  background: var(--panel);
}
/* side-rail（宽容器）态：侧栏卡片 sticky 避让导航（collapsed 态随文档流，无需 sticky）；
   29 页长清单 → 卡片限高滚动 */
.p-sidebar-side-rail .sidebar-card {
  position: sticky;
  top: calc(var(--nav-h) + 16px);
  max-height: calc(100vh - var(--nav-h) - 32px);
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
.page-toc {
  flex: 1 1 224px;
  max-width: 300px;
  box-sizing: border-box; /* p-view 默认 content-box——宽+padding 组合必须显式（铁律） */
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
</style>
