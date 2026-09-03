<script setup lang="ts">
// website/src/pages/Guide.vue —— 文档页（B2 验收：侧边栏自动生成 + md 构建期编译渲染）
// ★内容即数据：guides/*.md 由 @proteus-vue/docs 引擎在 vite 构建期编译（frontmatter/html/toc），
//   运行时只做 v-html + TOC 渲染，零 markdown 解析
// ★W-6 柔性框架优先：布局响应式 = 柔性网格 + v-p-fluid，零 @media
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { findGuide, guides } from '../guides'

const route = useRoute()
const slug = computed(() => (route.params.slug as string) ?? '')
const current = computed(() => findGuide(slug.value) ?? guides[0])
const docHtml = computed(() => current.value?.doc.html ?? '')
</script>

<template>
  <div class="guide">
    <!-- 侧边栏：guides.ts 自动生成（新增 md 零改动） -->
    <aside class="sidebar">
      <span class="eyebrow">◆ 指南</span>
      <nav class="toc-nav">
        <router-link
          v-for="g in guides"
          :key="g.slug"
          :to="`/docs/${g.slug}`"
          class="toc-link"
          :class="{ active: g.slug === slug }"
        >{{ g.title }}</router-link>
      </nav>
    </aside>

    <!-- 正文：docs 引擎构建期产物 -->
    <article class="doc">
      <h1 class="doc-title">{{ current?.title }}</h1>
      <!-- 文档引擎 html：块级/行内全转义 + 语义类名（docs-*），样式见 style.css -->
      <div class="doc-body" v-html="docHtml"></div>

      <!-- 页内 TOC + 上下篇 -->
      <nav v-if="current?.doc.tocFlat.length" class="page-toc">
        <span class="eyebrow">◆ 本页目录</span>
        <a v-for="t in current.doc.tocFlat" :key="t.id" :href="`#${t.id}`" class="page-toc-link" :class="`depth-${t.depth}`">{{ t.text }}</a>
      </nav>
      <div class="pager">
        <router-link
          v-if="guides[guides.findIndex((g) => g.slug === slug) - 1]"
          :to="`/docs/${guides[guides.findIndex((g) => g.slug === slug) - 1].slug}`"
          class="pager-link"
        >← 上一篇</router-link>
        <router-link
          v-if="guides[guides.findIndex((g) => g.slug === slug) + 1]"
          :to="`/docs/${guides[guides.findIndex((g) => g.slug === slug) + 1].slug}`"
          class="pager-link"
        >下一篇 →</router-link>
      </div>
    </article>
  </div>
</template>

<style>
.guide {
  display: grid;
  /* ★柔性网格（W-6）：侧边栏固定最小宽 + 正文弹性，窄容器自动单列——零 @media */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 32px;
  align-items: start;
  padding-bottom: 48px;
}
.sidebar {
  position: sticky;
  top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  background: var(--panel);
}
.toc-nav { display: flex; flex-direction: column; gap: 2px; }
.toc-link {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 8px;
}
.toc-link:hover { color: var(--ink); background: var(--panel2); }
.toc-link.active { color: var(--brand); background: rgba(124, 92, 255, 0.12); }
.doc { min-width: 0; }
.doc-title { color: var(--ink); font-size: 28px; margin: 8px 0 18px; }
.page-toc {
  margin-top: 32px;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.page-toc-link { color: var(--muted); text-decoration: none; font-size: 13px; }
.page-toc-link:hover { color: var(--brand); }
.page-toc-link.depth-3 { padding-left: 16px; }
.pager { display: flex; justify-content: space-between; margin-top: 20px; gap: 12px; }
.pager-link { color: var(--brand); text-decoration: none; font-size: 14px; }
.pager-link:hover { text-decoration: underline; }
</style>
