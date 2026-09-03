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
  <!-- ★p-sidebar（G-22 Fluid System S3）：自适应侧边栏原语——容器 ≥720px 走左侧栏、
       窄容器自动切顶部横向导航（createContainerQuery 按容器而非视口求解——分屏/多窗口自适应）；
       附送车机 d-pad 焦点导航 + reduced-motion。业务页面零布局代码（W-1/W-6 兑现） -->
  <p-sidebar :min-sidebar-width="720" :nav-width="240" class="guide">
    <template #nav>
      <p-view class="sidebar-card">
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
    </template>

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
  </p-sidebar>
</template>

<style scoped>
/* 布局（方向/换行/宽度）全部由 p-sidebar 组件承担——页面只写卡片视觉 + 按模式适配呈现 */
.guide { padding-bottom: 48px; }
.sidebar-card {
  position: sticky;
  top: calc(var(--nav-h) + 16px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  background: var(--panel);
}
/* ★bottom-bar 模式（窄容器）：导航卡横向紧凑化（组件根类 p-sidebar-bottom-bar 暴露状态——页面按状态适配呈现） */
.p-sidebar-bottom-bar .sidebar-card {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 12px 16px;
}
.p-sidebar-bottom-bar .toc-nav {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 2px 10px;
}
.p-sidebar-bottom-bar .eyebrow { display: none; }
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
