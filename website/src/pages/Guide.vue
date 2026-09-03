<script setup lang="ts">
// website/src/pages/Guide.vue —— 文档页（B2 验收：侧边栏自动生成 + md 构建期编译渲染）
// ★内容即数据：guides/*.md 由 @proteus-vue/docs 引擎在 vite 构建期编译（frontmatter/html/toc），
//   运行时只做 v-html + TOC 渲染，零 markdown 解析
// ★D-2（#377）：布局标签 p-view/p-text 语义组件
// ★W-6 柔性框架优先：柔性网格 + v-p-fluid，零 @media
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { findGuide, guides } from '../guides'

const route = useRoute()
const slug = computed(() => (route.params.slug as string) ?? '')
const current = computed(() => findGuide(slug.value) ?? guides[0])
const docHtml = computed(() => current.value?.doc.html ?? '')
const idx = computed(() => guides.findIndex((g) => g.slug === slug.value))
const prev = computed(() => (idx.value > 0 ? guides[idx.value - 1] : undefined))
const next = computed(() => (idx.value >= 0 && idx.value < guides.length - 1 ? guides[idx.value + 1] : undefined))
</script>

<template>
  <p-stack direction="row" :gap="32" wrap class="guide">
    <!-- 侧边栏：guides.ts 自动生成（新增 md 零改动） -->
    <p-view class="sidebar">
      <span class="eyebrow">◆ 指南</span>
      <p-view class="toc-nav">
        <router-link
          v-for="g in guides"
          :key="g.slug"
          :to="`/docs/${g.slug}`"
          class="toc-link"
          :class="{ active: g.slug === slug }"
        >
          <p-text class="toc-text">{{ g.title }}</p-text>
        </router-link>
      </p-view>
    </p-view>

    <!-- 正文：docs 引擎构建期产物 -->
    <p-view class="doc">
      <!-- 文档引擎 html：块级/行内全转义 + 语义类名（docs-*），样式见 style.css（md 内含 H1，页面头不再重复） -->
      <p-view class="doc-body" v-html="docHtml"></p-view>

      <!-- 页内 TOC + 上下篇 -->
      <p-view v-if="current?.doc.tocFlat.length" class="page-toc">
        <span class="eyebrow">◆ 本页目录</span>
        <a v-for="t in current.doc.tocFlat" :key="t.id" :href="`#${t.id}`" class="page-toc-link" :class="`depth-${t.depth}`">{{ t.text }}</a>
      </p-view>
      <p-stack direction="row" :gap="12" class="pager">
        <router-link v-if="prev" :to="`/docs/${prev.slug}`" class="pager-link">← 上一篇</router-link>
        <router-link v-if="next" :to="`/docs/${next.slug}`" class="pager-link">下一篇 →</router-link>
      </p-stack>
    </p-view>
  </p-stack>
</template>

<style scoped>
.guide {
  /* ★柔性侧边栏（W-6 零 @media）：p-stack row+wrap 承担方向/换行/间距（内联 style 必赢级联），
     页面类只管对齐与子项弹性——侧边栏 flex 0 1 240px、正文 flex 1 1 480px（不够宽自动堆叠） */
  align-items: flex-start;
  padding-bottom: 48px;
}
.sidebar {
  flex: 0 1 240px;
  min-width: 200px;
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
.toc-link { text-decoration: none; border-radius: 8px; }
.toc-text { color: var(--muted); font-size: 13px; }
.toc-link:hover { background: var(--panel2); }
.toc-link:hover .toc-text { color: var(--ink); }
.toc-link.active { background: rgba(124, 92, 255, 0.12); }
.toc-link.active .toc-text { color: var(--brand); }
.doc { flex: 1 1 480px; min-width: 0; }
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
.pager { margin-top: 20px; }
.pager-link { color: var(--brand); text-decoration: none; font-size: 14px; }
.pager-link:hover { text-decoration: underline; }
</style>
