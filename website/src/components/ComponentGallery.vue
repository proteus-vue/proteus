<script setup lang="ts">
// website/src/components/ComponentGallery.vue —— 组件总览页卡片画廊（2026-09-26 重做）
// 数据 SSOT：website/src/data/component-index.ts（gen-content.mjs 从组件源码产出，
// 与 md 总览同一 indexRows——props/events 数字不可能与实现漂移）。
// 结构参考主流组件库「组件概览」：大标题 + 域分区（计数徽标）+ 插画卡片网格；
// 视觉对齐本站深色设计语言（panel/line 明度分层 + 单一品牌强调，不搞霓虹渐变）。
import { computed } from 'vue'
import { componentIndex } from '../data/component-index'
import ComponentGlyph from './ComponentGlyph.vue'
import { locale } from '../i18n'

/** 组件中文名（展示用；en 名由 tag 派生：p-action-sheet → Action Sheet） */
const ZH: Record<string, string> = {
  'p-adaptive': '自适应', 'p-aspect': '宽高比', 'p-box': '容器', 'p-divider': '分割线', 'p-fit': '自适应裁剪',
  'p-grid': '栅格', 'p-inline': '行内布局', 'p-masonry': '瀑布流', 'p-safe': '安全区', 'p-scroll': '滚动',
  'p-scroll-view': '滚动视图', 'p-sidebar': '侧边栏', 'p-spacer': '占位', 'p-stack': '层叠', 'p-view': '视图容器',
  'p-virtual-list': '虚拟列表', 'p-zone': '断点分区',
  'p-avatar': '头像', 'p-button': '按钮', 'p-camera': '相机', 'p-canvas': '画布', 'p-checkbox': '复选框',
  'p-form': '表单', 'p-heading': '标题', 'p-icon': '图标', 'p-image': '图片', 'p-input': '输入框',
  'p-label': '标签', 'p-list-view': '列表', 'p-loading': '加载', 'p-map': '地图', 'p-media': '媒体',
  'p-nav-bar': '导航栏', 'p-picker': '选择器', 'p-progress': '进度条', 'p-radio': '单选框', 'p-rich-text': '富文本',
  'p-scale': '字号缩放', 'p-select': '下拉选择', 'p-selection': '选择组', 'p-skeleton': '骨架屏', 'p-slider': '滑块',
  'p-svg': '矢量图', 'p-switch': '开关', 'p-text': '文本', 'p-textarea': '文本域',
  'p-action-sheet': '动作面板', 'p-ad': '广告位', 'p-drawer': '抽屉', 'p-keyboard-accessory': '键盘附件',
  'p-mask': '遮罩', 'p-modal': '对话框', 'p-nav': '导航', 'p-page': '页面', 'p-page-container': '页面容器',
  'p-popover': '气泡', 'p-popup': '弹层', 'p-segment': '分段器', 'p-split': '分栏', 'p-tabbar': '标签栏',
  'p-toast': '轻提示', 'p-toolbar': '工具栏', 'p-webview': '内嵌网页',
  'p-draggable': '拖拽', 'p-scrollable': '可滚动',
  'p-animate': '动效', 'p-error-boundary': '错误边界', 'p-router-link': '路由链接', 'p-share-element': '共享元素',
  'p-transition': '过渡',
  'p-location': '定位', 'p-pick-photo': '选照片', 'p-scan-qr': '扫码',
}

/** en 展示名：p-action-sheet → Action Sheet */
function enName(dir: string): string {
  return dir
    .replace(/^p-/, '')
    .split('-')
    .map((s) => (s === 'ui' ? 'UI' : s[0]!.toUpperCase() + s.slice(1)))
    .join(' ')
}

const isEn = computed(() => locale.value === 'en')
const domainName = (key: string, en: string) => (isEn.value ? en : key)
const cardName = (dir: string) => (isEn.value ? enName(dir) : `${enName(dir)} ${ZH[dir] ?? ''}`.trim())
const subtitle = computed(() =>
  isEn.value
    ? `${componentIndex.total} semantic components in ${componentIndex.domains.length} domains — props/events generated from source (single source of truth).`
    : `${componentIndex.total} 个语义组件（${componentIndex.domains.length} 域）——props/events 由源码 SSOT 生成，与框架实现实时一致。点击卡片查看组件文档。`,
)
</script>

<template>
  <div class="cg">
    <!-- 头部：大标题 + 说明 + 克制的装饰（品牌柔光圆，不做霓虹渐变） -->
    <header class="cg-head">
      <div class="cg-head-main">
        <h2 class="cg-title">{{ isEn ? 'Components' : '组件总览' }}</h2>
        <p class="cg-sub">{{ subtitle }}</p>
      </div>
      <div class="cg-deco" aria-hidden="true">
        <span class="cg-deco-pill" />
        <span class="cg-deco-dot" />
        <span class="cg-deco-dot cg-deco-dot--2" />
      </div>
    </header>

    <!-- 域分区 → 卡片网格 -->
    <section v-for="d in componentIndex.domains" :key="d.key" class="cg-domain">
      <h3 class="cg-domain-title">
        {{ domainName(d.key, d.en) }}
        <span class="cg-count">{{ d.components.length }}</span>
      </h3>
      <div class="cg-grid">
        <router-link
          v-for="c in d.components"
          :key="c.dir"
          class="cg-card"
          :to="`/docs/component/${c.dir}`"
        >
          <span class="cg-stage"><ComponentGlyph :tag="c.dir" /></span>
          <span class="cg-meta">
            <span class="cg-tag">{{ c.dir }}</span>
            <span class="cg-name">{{ cardName(c.dir) }}</span>
            <span class="cg-nums">{{ c.props }}·{{ c.emits }}</span>
          </span>
        </router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cg { margin-top: 4px; }

/* ── 头部 ── */
.cg-head {
  position: relative;
  padding: 10px 0 6px;
  margin-bottom: 6px;
  overflow: hidden;
}
.cg-title {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--ink);
}
.cg-sub {
  margin: 8px 0 0;
  font-size: 13.5px;
  color: var(--muted);
  max-width: 640px;
  line-height: 1.7;
}
/* 装饰：品牌柔光胶囊 + 点（低透明度、blur；对齐「克制」纪律） */
.cg-deco {
  position: absolute;
  top: 0;
  right: -10px;
  width: 250px;
  height: 120px;
  pointer-events: none;
}
/* 窄屏隐藏装饰：说明文字全区可读（装饰是纯点缀，不值得与文案争空间） */
@media (max-width: 720px) {
  .cg-deco { display: none; }
}
.cg-deco-pill {
  position: absolute;
  right: 22px;
  top: 14px;
  width: 150px;
  height: 50px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(124, 92, 255, 0.32), rgba(171, 155, 255, 0.1));
  filter: blur(2px);
  transform: rotate(-18deg);
}
.cg-deco-dot {
  position: absolute;
  right: 8px;
  top: 62px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--brand-soft);
  border: 1px solid rgba(124, 92, 255, 0.35);
}
.cg-deco-dot--2 {
  right: 152px;
  top: 76px;
  width: 13px;
  height: 13px;
  border: none;
  background: rgba(124, 92, 255, 0.4);
}

/* ── 域分区 ── */
.cg-domain { margin-top: 26px; }
.cg-domain-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}
.cg-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-ink);
  font-size: 11.5px;
  font-weight: 700;
}

/* ── 卡片网格 ── */
.cg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 13px;
}
.cg-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 10px 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  text-decoration: none;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}
.cg-card:hover {
  transform: translateY(-2px);
  border-color: rgba(124, 92, 255, 0.55);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.36);
}
.cg-card:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}
.cg-stage {
  display: block;
  height: 128px;
  padding: 10px 14px;
  background: var(--panel2);
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  overflow: hidden;
}
.cg-meta {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  column-gap: 8px;
  padding: 0 4px;
}
.cg-tag {
  grid-column: 1 / -1;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--brand-ink);
  letter-spacing: 0.2px;
}
.cg-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.cg-nums {
  font-size: 10.5px;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
</style>
