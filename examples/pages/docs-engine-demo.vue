<!-- examples/pages/docs-engine-demo.vue —— ★文档引擎演示（官网 B2：md → 编译 → 渲染闭环可视化） -->
<route>
{
  "webOnly": true
}
</route>
<template>
  <view class="page">
    <view class="hero">
      <text class="hero-title">文档引擎</text>
      <text class="hero-sub">本页内容由 Markdown 经 @proteus-vue/docs 编译渲染——文档也是编译产物</text>
    </view>

    <view class="search-bar">
      <input class="search-input" :value="query" placeholder="搜索文档内容…" @input="onQuery" />
      <text class="search-count">{{ hits.length }} 条命中</text>
    </view>

    <view class="doc-card">
      <view v-if="query.trim() === ''">
        <text class="doc-title">{{ doc.title }}</text>
        <view class="doc-body web-only-html" v-html="doc.html"></view>
      </view>
      <view v-else>
        <view v-for="(h, i) in hits" :key="i" class="hit">
          <text class="hit-heading">{{ h.heading || h.text }}</text>
          <text class="hit-path">{{ h.path }}{{ h.anchor ? '#' + h.anchor : '' }}</text>
        </view>
      </view>
    </view>

    <view class="meta-card">
      <text class="meta-line">TOC 条目：{{ doc.tocFlat.length }} · frontmatter.title：{{ doc.title }}</text>
      <text class="meta-line">搜索索引条目：{{ doc.searchEntries.length }}（构建期生成）</text>
    </view>
  </view>
</template>

<script>
// ★文档引擎两种用法：
//   构建期：docsMdPlugin 把 .md import 编译为组件模块（本工程 vite.config 已接线——web 构建）
//   运行时：parseMarkdown 纯逻辑零依赖（本 demo 采用——MP/小程序端也可用，证明引擎跨端）
import { parseMarkdown, renderDocHtml, buildToc, searchDocs } from '@proteus-vue/docs'

const MD_SOURCE = [
  '---',
  'title: 快速开始',
  '---',
  '',
  '# 快速开始',
  '',
  'Proteus 是**渲染引擎无关**的跨端框架：用统一语义模型描述 UI，通过可插拔渲染后端自由接入 Vue DOM、Flutter、原生 UIKit/Jetpack/ArkUI。',
  '',
  '## 安装',
  '',
  '```bash',
  'npm create @proteus-vue/proteus my-app',
  '```',
  '',
  '## 第一个页面',
  '',
  '```vue',
  '<template>',
  '  <p-page title="首页">',
  '    <p-stack gap="md">',
  '      <p-text content="Hello Proteus" />',
  '      <p-button variant="primary" label="开始" />',
  '    </p-stack>',
  '  </p-page>',
  '</template>',
  '```',
  '',
  '## 核心概念',
  '',
  '- **语义原语**：p-* 组件是唯一的 UI 词汇表',
  '- **渲染后端**：同一份代码跑 Web/小程序/原生（换一个 flag）',
  '- **文档引擎**：本页即由 @proteus-vue/docs 编译渲染',
  '',
  '> 提示：官网本身就是用 Proteus 构建的——你现在看到的每一个标题、代码块都是框架的编译产物。',
].join('\n')

const parsed = parseMarkdown(MD_SOURCE)

export default {
  data() {
    return {
      doc: {
        title: typeof parsed.frontmatter.title === 'string' ? parsed.frontmatter.title : '',
        html: renderDocHtml(parsed),
        tocFlat: buildToc(parsed.blocks).flatMap((t) => [t, ...t.children]),
        searchEntries: buildToc(parsed.blocks).map((t) => ({ anchor: t.id, text: t.text })),
      },
      query: '',
      hits: [],
    }
  },
  methods: {
    onQuery(e) {
      this.query = e.detail?.value ?? e.target?.value ?? ''
      this.hits = searchDocs(this.doc.searchEntries, this.query)
    },
  },
}
</script>

<style>
.page {
  padding: 40rpx 32rpx;
}
.hero {
  padding: 24rpx 0;
}
.hero-title {
  font-size: 40rpx;
  font-weight: 700;
}
.hero-sub {
  font-size: 24rpx;
  color: #666a73;
}
.search-bar {
  margin: 16rpx 0;
  padding: 16rpx;
  border: 1px solid #e3e6eb;
  border-radius: 12rpx;
}
.search-input {
  font-size: 28rpx;
}
.search-count {
  font-size: 22rpx;
  color: #9aa0aa;
}
.doc-card {
  padding: 24rpx;
  border: 1px solid #e3e6eb;
  border-radius: 12rpx;
}
.doc-title {
  font-size: 36rpx;
  font-weight: 700;
  margin-bottom: 16rpx;
}
.doc-body {
  font-size: 28rpx;
  line-height: 1.7;
}
.hit {
  padding: 12rpx 0;
  border-bottom: 1px solid #f0f1f3;
}
.hit-heading {
  font-size: 28rpx;
  font-weight: 600;
}
.hit-path {
  font-size: 22rpx;
  color: #9aa0aa;
}
.meta-card {
  margin-top: 24rpx;
  padding: 16rpx 24rpx;
  background: #f5f6f8;
  border-radius: 12rpx;
}
.meta-line {
  font-size: 22rpx;
  color: #666a73;
}
</style>
