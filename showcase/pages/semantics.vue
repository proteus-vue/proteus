<!-- showcase/pages/semantics.vue —— 语义与编译分区（tab）
     核心主张可视化：一份 Vue 源码 → CompilerIR 中间表示 → 多端产物。 -->
<script setup lang="ts">
import { ref } from 'vue'
import PageShell from '../components/page-shell/index.vue'

const source = ref(`const count = ref(0)

<template>
  <p-view class="card">
    <p-text>{{ count }}</p-text>
    <p-button @click="count++">+1</p-button>
  </p-view>
</template>`)

const pipeline = ref([
  { n: '01', name: 'SFC 源码', desc: '标准 Vue 单文件组件——开发者只写一份', color: 'var(--sp-bk-vue)' },
  { n: '02', name: '语义 IR', desc: 'CompilerIR：标签 → 语义原语（p-view → layout.box）', color: 'var(--sp-brand)' },
  { n: '03', name: '编译后端', desc: '可插拔：Node / Rust 编译器（语义等价校验）', color: 'var(--sp-bk-skia)' },
  { n: '04', name: '多端产物', desc: '小程序 WXML+JS / Web DOM / 原生控件树', color: 'var(--sp-bk-mp)' },
])

const targets = ref([
  { name: '微信小程序', code: 'view + setData', color: 'var(--sp-bk-mp)' },
  { name: 'Web Vue DOM', code: 'div + 响应式', color: 'var(--sp-bk-vue)' },
  { name: 'iOS / Android', code: 'UIKit / Jetpack', color: 'var(--sp-bk-ios)' },
  { name: 'Flutter / Skia', code: 'Widget / Canvas', color: 'var(--sp-bk-flutter)' },
])
</script>

<template>
  <page-shell title="语义与编译" subtitle="一份源码 · 语义 IR · 可插拔编译后端">
    <p-text class="section">编译链路</p-text>
    <p-view class="pipe" v-for="p in pipeline" :key="p.n">
      <p-view class="pipe-n" :style="'background:' + p.color">{{ p.n }}</p-view>
      <p-view class="pipe-main">
        <p-text class="pipe-name">{{ p.name }}</p-text>
        <p-text class="pipe-desc">{{ p.desc }}</p-text>
      </p-view>
    </p-view>

    <p-text class="section">你写的源码</p-text>
    <p-view class="code">
      <p-text class="code-text">{{ source }}</p-text>
    </p-view>

    <p-text class="section">编译到多端</p-text>
    <p-view class="target" v-for="t in targets" :key="t.name">
      <p-view class="t-dot" :style="'background:' + t.color" />
      <p-text class="t-name">{{ t.name }}</p-text>
      <p-text class="t-code">{{ t.code }}</p-text>
    </p-view>
  </page-shell>
</template>

<style scoped>
.section {
  display: block;
  font-size: 16px;
  font-weight: 700;
  margin: var(--sp-5) 0 var(--sp-3);
  color: var(--sp-text);
}
.pipe {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-3);
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-2);
}
.pipe-n {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: var(--sp-radius-sm);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.pipe-main { flex: 1; min-width: 0; display: block; }
.pipe-name { display: block; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.pipe-desc { display: block; font-size: 12px; color: var(--sp-text-3); margin-top: 2px; }
.code {
  display: block;
  background: #1c1b22;
  border-radius: var(--sp-radius-md);
  padding: var(--sp-4);
  overflow: hidden;
}
.code-text {
  display: block;
  font-family: var(--sp-mono);
  font-size: 12px;
  line-height: 1.7;
  color: #d8d8e0;
  white-space: pre;
}
.target {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-3);
  background: var(--sp-surface);
  border: 1px solid var(--sp-line);
  border-radius: var(--sp-radius-md);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-2);
}
.t-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.t-name { flex: 1; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.t-code { font-family: var(--sp-mono); font-size: 11px; color: var(--sp-text-3); }
</style>
