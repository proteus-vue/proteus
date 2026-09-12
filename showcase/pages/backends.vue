<!-- showcase/pages/backends.vue —— 多渲染后端（真渲染：同一 IR 的多后端产物对照） -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import PageShell from '../components/page-shell/index.vue'
import { PText, PView, PSegment } from '@proteus-vue/components'

const active = ref('mp')
const backends = ref([
  { key: 'mp', name: '微信小程序', color: 'var(--sp-bk-mp)', target: '<view> + setData', status: '✅ 本页即产物' },
  { key: 'vue', name: 'Web (Vue DOM)', color: 'var(--sp-bk-vue)', target: '<div> + 响应式', status: '✅ 已落地' },
  { key: 'ios', name: 'iOS 原生', color: 'var(--sp-bk-ios)', target: 'UIKit 控件树', status: '🟡 端原型' },
  { key: 'android', name: 'Android 原生', color: 'var(--sp-bk-android)', target: 'Jetpack Compose', status: '🟡 端原型' },
  { key: 'flutter', name: 'Flutter', color: 'var(--sp-bk-flutter)', target: 'Widget 树', status: '🟡 组件级未验证' },
  { key: 'skia', name: 'Skia / Canvas', color: 'var(--sp-bk-skia)', target: '自绘指令', status: '🟡 通道验证' },
])

const code: Record<string, string> = {
  mp: '<!-- 本页产物（mp-weixin）-->\n<view class="card">\n  <text>{{count}}</text>\n</view>',
  vue: '<!-- Web 产物（vue-dom）-->\n<div class="card">\n  <span>{{count}}</span>\n</div>',
  ios: '// iOS（UIKit 后端）\nUIView + UILabel\n// 同一 IR 节点 → 原生控件',
  android: '// Android（Compose 后端）\nBox + Text\n// 同一 IR 节点 → 原生控件',
  flutter: '// Flutter 后端\nContainer + Text\n// 同一 IR 节点 → Widget',
  skia: '// Skia 后端\nDrawRect + DrawText\n// 同一 IR 节点 → 自绘指令',
}
// ★模板禁止内联箭头函数/map（`=>` 的 `>` 破坏 WXML 解析 → unmatched parenthesis）—— 移到 computed
const segOptions = computed(() => backends.value.map((b) => ({ label: b.name, value: b.key })))

function pick(e: unknown) {
  const d = (e as { detail?: { value?: string } })?.detail
  if (d && d.value) active.value = d.value
}
</script>

<template>
  <page-shell title="多渲染后端" subtitle="G-27 · 同一份语义 IR → 任意渲染引擎">
    <p-segment
      :options="segOptions"
      :active="active"
      @change="pick"
    />

    <p-view class="code">
      <p-text class="code-t">{{ code[active] }}</p-text>
    </p-view>

    <p-text class="sec">后端清单</p-text>
    <p-view class="row" v-for="b in backends" :key="b.key">
      <p-view class="dot" :style="'background:' + b.color" />
      <p-view class="row-main">
        <p-text class="row-name">{{ b.name }}</p-text>
        <p-text class="row-target">{{ b.target }}</p-text>
      </p-view>
      <p-text class="row-status">{{ b.status }}</p-text>
    </p-view>

    <p-text class="note">上方的分段切换展示「同一份语义」在各后端的目标产物形态——布局语义（layout.box）在每个后端映射为该引擎的原生容器。</p-text>
  </page-shell>
</template>

<style scoped>
.code { display: block; background: #1c1b22; border-radius: var(--sp-radius-md); padding: var(--sp-4); margin: var(--sp-4) 0; }
.code-t { display: block; font-family: var(--sp-mono); font-size: 12px; line-height: 1.7; color: #d8d8e0; white-space: pre; }
.sec { display: block; font-size: 14px; font-weight: 700; margin: var(--sp-4) 0 var(--sp-2); color: var(--sp-text); }
.row { display: flex; flex-direction: row; align-items: center; gap: var(--sp-3); background: var(--sp-surface); border: 1px solid var(--sp-line); border-radius: var(--sp-radius-md); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-2); }
.dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.row-main { flex: 1; min-width: 0; display: block; }
.row-name { display: block; font-size: 14px; font-weight: 600; color: var(--sp-text); }
.row-target { display: block; font-size: 11px; font-family: var(--sp-mono); color: var(--sp-text-3); margin-top: 2px; }
.row-status { flex-shrink: 0; font-size: 11px; color: var(--sp-text-2); }
.note { display: block; font-size: 12px; color: var(--sp-text-3); line-height: 1.6; margin-top: var(--sp-3); }
</style>
