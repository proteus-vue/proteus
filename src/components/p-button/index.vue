<!-- src/components/p-button/index.vue —— 按钮（组件库 B2）
     矩阵 01 §7：disabled/loading 原生映射 + throttle 防重复点击（runtime 内置）
     双端同源码：button 原生透传（tag/passthrough）；@click → bindtap -->
<template>
  <button
    class="p-button"
    :class="{ 'is-loading': loading }"
    :disabled="disabled || loading || undefined"
    :loading="loading || undefined"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  throttle: { type: Number, default: 0 }, // 防重复点击间隔 ms（0 = 不节流）
})

const emit = defineEmits(['click'])

const lastClick = ref(0)

function onClick(e: unknown) {
  const now = Date.now()
  if (props.throttle > 0 && now - lastClick.value < props.throttle) return
  lastClick.value = now
  // ★MP 事件跨组件边界（2026-09-11）：click 带 bubbles+composed 发射——
  //   插槽内 p-button 作为「父组件（如 p-popover trigger wrapper）的原生 bindtap 目标」时，
  //   小程序原生 tap 不跨自定义组件边界 → 须由组件 emit 冒泡事件、父级以 bind:click 接收。
  //   Web（Vue emit）第 3 参被忽略/透传为多余实参，无副作用。
  emit('click', e, { bubbles: true, composed: true })
}
</script>

<style scoped>
/* ★跨端归一（2026-08 真机实测）：浏览器 <button> 默认样式（buttonface 背景/outset 边框）与微信原生 <button>
   默认样式（灰底/圆角/::after 边框线/hover 变暗）完全不同——纯透传时双端视觉不一致。
   显式定义统一按钮外观（双端同源码同视觉），覆盖两端原生默认差异 */
.p-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  background: #1a7af8;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 8px 20px;
  font-size: 14px;
  line-height: 1.5;
}
/* 微信原生 button::after 边框线（WebView 模式默认样式）清除；Skyline 无此默认，规则被忽略也无害 */
.p-button::after {
  border: none;
}
.p-button.is-loading {
  opacity: 0.7;
}
</style>
