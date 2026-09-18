<!-- showcase/pages/playground.vue —— 在线编译（真交互：选源码 → 看编译产物） -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PText, PView, PButton } from '@proteus-vue/components'

const samples = ref([
  { key: 'basic', label: '基础绑定', src: '<p-text>{{ count }}</p-text>\n<p-button @click="count++">+1</p-button>' },
  { key: 'list', label: '列表渲染', src: '<p-view v-for="i in items" :key="i">{{ i }}</p-view>' },
  { key: 'cond', label: '条件渲染', src: '<p-text v-if="ok">显示</p-text>\n<p-text v-else>隐藏</p-text>' },
])
const activeKey = ref('basic')
const active = computed(() => samples.value.find((s) => s.key === activeKey.value) || samples.value[0])

// 展示"编译器看到的"语义映射（静态对照，非真实编译——真编译在 Web Playground）
const ir = computed(() => {
  const map: Record<string, string> = {
    basic: 'p-text → ui.text\np-button → ui.button\n  @click → 事件归一\n  {{count}} → 数据绑定',
    list: 'p-view → layout.box\n  v-for → wx:for\n  :key → wx:key',
    cond: 'p-text → ui.text\n  v-if → wx:if\n  v-else → wx:else',
  }
  return map[activeKey.value] || ''
})
</script>

<template>
  <page-shell title="在线编译" subtitle="选示例 → 看编译器眼中的语义映射">
    <p-view class="tabs">
      <p-button v-for="s in samples" :key="s.key" @click="activeKey = s.key">{{ s.label }}</p-button>
    </p-view>

    <p-text class="sec">Vue 源码</p-text>
    <p-view class="code">
      <p-text class="code-t">{{ active.src }}</p-text>
    </p-view>

    <p-text class="sec">CompilerIR 语义映射</p-text>
    <p-view class="code ir">
      <p-text class="code-t">{{ ir }}</p-text>
    </p-view>

    <p-text class="note">本节为语义映射静态对照；完整交互式编译器（实时产物 + 决策 trace）见官网 Playground——同一套 @proteus-vue/compiler。</p-text>
  </page-shell>
</template>

<style scoped>
.tabs { display: flex; flex-direction: row; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.sec { display: block; font-size: 14px; font-weight: 700; margin: var(--sp-3) 0 var(--sp-2); color: var(--sp-text); }
.code { display: block; background: #1c1b22; border-radius: var(--sp-radius-md); padding: var(--sp-4); }
.code.ir { background: #1a1430; }
.code-t { display: block; font-family: var(--sp-mono); font-size: 12px; line-height: 1.7; color: #d8d8e0; white-space: pre; }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; margin-top: var(--sp-3); }
</style>
