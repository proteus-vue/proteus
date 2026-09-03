<script setup lang="ts">
// website/src/pages/Playground.vue —— Website B3+B4：Playground 全功能页
// ★复用 TransformDemo（首页内嵌的是它的 compact 形态）+ 规则目录（69 条 AI 说明书）
// ★W-6 柔性框架优先：排版 v-p-fluid，零 @media
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import TransformDemo from '../components/TransformDemo.vue'
import { listTransformRules } from '@proteus-vue/compiler'
import { decodeSource } from '../playground/share'

const route = useRoute()

// 分享链接 ?code= 恢复（可复现）
const initialSource =
  typeof route.query.code === 'string' ? decodeSource(route.query.code) : ''

const rules = listTransformRules()
const ruleList = ref(rules)
</script>

<template>
  <div class="playground">
    <header v-p-fluid="'padding(28, 48)'" class="pg-head">
      <span class="eyebrow">◆ Playground · 透明编译</span>
      <p-heading :level="1" class="pg-title">左边写标准 Vue，右边看编译器在想什么</p-heading>
      <p-text class="pg-sub">
        浏览器内实时编译——同一套 @proteus-vue/compiler（与本地 build 同源）：
        Skyline 产物、CompilerIR 中间表示、决策 trace（哪一行触发了哪条规则）、
        {{ ruleList.length }} 条规则的 AI 说明书全部可查——拒绝黑盒。
      </p-text>
    </header>

    <TransformDemo :initial-source="initialSource" />

    <p-view v-p-fluid="'padding(16, 24)'" class="rules-section">
      <p-heading :level="2" class="rules-title">规则注册表 · AI 说明书（{{ ruleList.length }} 条）</p-heading>
      <p-text class="pg-dim">每条规则自带 what / why / when / example / verify——产物可枚举、可查询、可反查源码。</p-text>
      <p-view class="rules-list">
        <p-view v-for="r in ruleList" :key="r.id" class="rule-item">
          <p-text class="rule-id">{{ r.id }}</p-text>
          <p-text class="rule-desc">{{ r.description }}</p-text>
        </p-view>
      </p-view>
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
.pg-dim { color: var(--dim); font-size: 13px; display: block; }
.rules-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.rule-item {
  display: flex;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
  background: var(--panel);
}
.rule-id { color: var(--brand2); font-family: ui-monospace, Menlo, monospace; font-size: 12px; min-width: 180px; }
.rule-desc { color: var(--muted); font-size: 12px; }
</style>
