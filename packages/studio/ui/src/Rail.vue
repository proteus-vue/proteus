<script setup lang="ts">
/**
 * Rail.vue —— 左侧图标栏（设备 / 代码 / 终端 / 设置）· 决策 #1411
 *
 * 【为什么抽出来】`App.vue` 涨到 1049 行，越过 `check:file-size` 的 1000 行硬上限。
 *   图标栏是纯展示 + 四个点击事件，抽出去对 App 的逻辑零影响。
 *
 * 【★不要往这里插节点】分隔条（grip）挂在 `.app` 上做绝对定位 ——
 *   历史上往 `.rail` 里插节点把 `button:nth-child(N)` 的序号整体后移，
 *   门禁点到"设备"而不是"代码"（决策 #1343）。
 */
defineProps<{ view: string; termMode: string }>()
const emit = defineEmits<{ device: []; code: []; term: []; settings: [] }>()
import StudioIcon from './icons/StudioIcon.vue'
</script>

<template>
<div class="rail">
  <button
    :class="{ on: view === 'device' }"
    :aria-pressed="view === 'device'"
    aria-label="设备画布"
    title="设备画布"
    @click="emit('device')"
  >
    <StudioIcon name="device" :size="18" />
  </button>
  <button
    :class="{ on: view === 'code' }"
    :aria-pressed="view === 'code'"
    aria-label="代码（只读）"
    title="代码（只读）"
    @click="emit('code')"
  >
    <StudioIcon name="code" :size="18" />
  </button>
  <button
    :class="{ on: termMode !== 'off' }"
    :aria-pressed="termMode !== 'off'"
    aria-label="终端"
    title="终端面板（⌘J）· ⌘⇧J 最大化"
    id="railTerm"
    @click="emit('term')"
  >
    <StudioIcon name="terminal" :size="18" />
  </button>
  <div class="sep" />
  <button aria-label="断言（未实现）" title="断言（未实现）" disabled><StudioIcon name="assert" :size="18" /></button>
  <button aria-label="录制（未实现）" title="录制（未实现）" disabled><StudioIcon name="record" :size="18" /></button>
  <div class="sep" />
  <!-- 设置（决策 #1267）：开**独立窗口**，不是右栏小面板 -->
  <button id="openSettings" aria-label="设置" title="设置（⌘,）" @click="emit('settings')">
    <StudioIcon name="settings" :size="18" />
  </button>
</div>
</template>
