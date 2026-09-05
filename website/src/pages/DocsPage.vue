<script setup lang="ts">
// website/src/pages/DocsPage.vue —— 文档页（★#390ii 四区通用 + ★#468 国际化）
// 内容即数据：各区 md 由 @proteus-vue/docs 引擎构建期编译（frontmatter/html/toc），运行时 v-html 零解析
// ★#468 chrome 双语（@proteus-vue/i18n dogfooding）+ 英文内容变体（en/ overlay——试点指南区；缺失 → 提示回中文）
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { findDoc, sections, enModule, enTitleFor } from '../docs-registry'
import { locale, setLocale, t, sectionName } from '../i18n'

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
const isEn = computed(() => locale.value === 'en')
// ★#468 内容层：英文变体优先（变体含 title/html/toc），无变体 → 中文 + 提示条
const variant = computed(() => enModule(section.value.base, slug.value))
const displayDoc = computed(() => (isEn.value && variant.value ? variant.value : current.value.doc))
const docHtml = computed(() => displayDoc.value?.html ?? '')
const tocFlat = computed(() => (variant.value && isEn.value ? variant.value.tocFlat : current.value.doc.tocFlat) ?? [])
const ends = computed(() => current.value?.doc.ends ?? undefined)
const noEn = computed(() => isEn.value && !variant.value)
const idx = computed(() => section.value.items.findIndex((g) => g.slug === slug.value))
const prev = computed(() => (idx.value > 0 ? section.value.items[idx.value - 1] : undefined))
const next = computed(() => (idx.value >= 0 && idx.value < section.value.items.length - 1 ? section.value.items[idx.value + 1] : undefined))
/** sidebar 条目标题：英文态下翻译过的页用 en title，未翻译保持中文（诚实混合） */
function itemTitle(slugOf: string, zhTitle: string): string {
  return isEn.value ? (enTitleFor(section.value.base, slugOf) ?? zhTitle) : zhTitle
}
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
      <button type="button" class="lang-switch" :aria-label="locale === 'zh' ? 'Switch to English' : '切换中文'" @click="setLocale(locale === 'zh' ? 'en' : 'zh')">
        {{ locale === 'zh' ? 'EN' : '中文' }}
      </button>
    </div>
  <p-sidebar :min-sidebar-width="720" :nav-width="224" :toggle-label="t('nav.toggle')" class="guide">
    <template #nav>
      <p-view class="sidebar-card">
        <span class="eyebrow">{{ t('toc.sidebar', { name: sectionName(section.key) }) }}</span>
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
          <!-- ★#468 未翻译提示（英文态下中文页——诚实降级：Vue docs 同款） -->
          <p-view v-if="noEn" class="no-en">
            <p-text class="no-en-title">{{ t('doc.noen.title') }}</p-text>
            <p-text class="no-en-body">{{ t('doc.noen.body') }}</p-text>
            <button type="button" class="no-en-back" @click="setLocale('zh')">{{ t('doc.noen.back') }}</button>
          </p-view>
          <!-- ★#415 端落地进度表（frontmatter.ends 声明的页面） -->
          <p-view v-if="ends" class="ends-progress">
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
          <!-- 文档引擎 html（md 内含 H1，页面头不再重复） -->
          <p-view class="doc-body" v-html="docHtml"></p-view>

          <!-- 上下篇 -->
          <p-stack direction="row" :gap="12" class="pager">
            <router-link v-if="prev" :to="`${section.base}/${prev.slug}`" class="pager-link">{{ t('doc.prev') }}</router-link>
            <router-link v-if="next" :to="`${section.base}/${next.slug}`" class="pager-link">{{ t('doc.next') }}</router-link>
          </p-stack>
        </p-view>

        <!-- 页内导读（右栏粘性） -->
        <p-view v-if="tocFlat.length" class="page-toc">
          <span class="eyebrow">{{ t('toc.onthepage') }}</span>
          <a v-for="toc in tocFlat" :key="toc.id" :href="`#${toc.id}`" class="page-toc-link" :class="`depth-${toc.depth}`">{{ toc.text }}</a>
        </p-view>
      </p-stack>
    </p-view>
  </p-sidebar>
  </p-view>
</template>

<style scoped>
/* ★#384：布局与折叠交互全部归 p-sidebar 组件；页面只写卡片视觉 */
.guide { padding-bottom: 48px; }
.docs-shell { display: block; }
.docs-topbar {
  position: sticky;
  top: var(--nav-h);
  z-index: 15;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  padding: 10px 64px 10px 24px;
  margin: 0 -24px 20px; /* 抵消 main 的横向 padding——横条通栏 */
}
/* ★#468 语言切换（横条右缘） */
.lang-switch {
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  border-radius: var(--radius-pill);
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
}
.lang-switch:hover { border-color: var(--brand); color: var(--brand); }
/* ★#468 未翻译提示条（诚实降级） */
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
