<script setup lang="ts">
// website/src/pages/Playground.vue —— Website B3+B4：Playground 全功能页
// ★复用 TransformDemo（首页内嵌的是它的 compact 形态）+ 规则目录（69 条 AI 说明书）
// ★W-6 柔性框架优先：排版 v-p-fluid，零 @media
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import TransformDemo from '../components/TransformDemo.vue'
import { listTransformRules } from '@proteus-vue/compiler'
import { decodeSource } from '../playground/share'
// ★#478 Playground 页 chrome 双语（规则注册表数据为框架层中文——EN 完整版随编译器注册表双语落地）
import { t } from '../i18n'

const route = useRoute()

// 分享链接 ?code= 恢复（可复现）
const initialSource =
  typeof route.query.code === 'string' ? decodeSource(route.query.code) : ''

const rules = listTransformRules()
const ruleList = ref(rules)
</script>

<template>
  <div class="playground">
    <header v-p-fluid="'padding-top(24, 48) padding-bottom(24, 48)'" class="pg-head">
      <span class="eyebrow">{{ t('pg.eyebrow') }}</span>
      <p-heading :level="1" class="pg-title">{{ t('pg.title') }}</p-heading>
      <p-text class="pg-sub">
        {{ t('pg.sub', { n: String(ruleList.length) }) }}
      </p-text>
    </header>

    <TransformDemo :initial-source="initialSource" />

    <p-view v-p-fluid="'padding(16, 24)'" class="rules-section">
      <p-heading :level="2" class="rules-title">{{ t('pg.rulesTitle', { n: String(ruleList.length) }) }}</p-heading>
      <!-- ★#386 对比度：13px 说明文字不用 dim -->
      <p-text class="pg-dim">{{ t('pg.rulesDim') }}</p-text>
      <p-stack direction="column" :gap="6" class="rules-list">
        <p-stack v-for="r in ruleList" :key="r.id" direction="row" :gap="12" class="rule-item">
          <p-text class="rule-id">{{ r.id }}</p-text>
          <p-text class="rule-desc">{{ r.description }}</p-text>
        </p-stack>
      </p-stack>
    </p-view>
  </div>
</template>

<style scoped>
.playground { padding-bottom: 48px; }
.pg-head { max-width: 1180px; }
.pg-title { color: var(--ink); margin: 14px 0 10px; }
.pg-sub { color: var(--muted); font-size: 14px; line-height: 1.7; display: block; max-width: 720px; }
.rules-section { max-width: 1180px; }
.rules-title { color: var(--ink); margin: 10px 0 6px; }
.pg-dim { color: var(--muted); font-size: 13px; display: block; }
/* ★#386 布局归 p-stack 原语——页面类只留视觉 */
.rules-list { margin-top: 12px; }
.rule-item {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--sp-8) var(--sp-12);
  background: var(--panel);
}
.rule-id {
  color: var(--brand2);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  flex: 0 1 200px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rule-desc {
  min-width: 0;
  overflow-wrap: anywhere;
}
.rule-desc { color: var(--muted); font-size: 12px; }
</style>
