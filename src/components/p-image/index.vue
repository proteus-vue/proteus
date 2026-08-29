<!-- src/components/p-image/index.vue —— 图片（组件库 B2）
     矩阵 01 §3：mode 裁剪（Web object-fit 映射 / MP 原生 mode 透传）+ lazy-load（Web loading=lazy / MP lazy-load）+ placeholder
     双端同源码：img → image（编译期映射）；@load/@error 事件归一
     注意：不用 computed 块体（编译器仅支持箭头表达式体），mode 的 Web 映射走 CSS 类（p-image--<mode>） -->
<template>
  <img
    class="p-image"
    :class="'p-image--' + (mode || 'scaleToFill')"
    :src="src"
    :alt="alt"
    :loading="lazyLoad ? 'lazy' : 'eager'"
    :lazy-load="lazyLoad ? 'true' : ''"
    :mode="mode"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    @load="onLoad"
    @error="onError"
  />
</template>

<script setup lang="ts">
const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  src: { type: String, default: '' },
  alt: { type: String, default: '' },
  mode: { type: String, default: 'aspectFill' }, // aspectFill / widthFix / scaleToFill
  lazyLoad: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})

const emit = defineEmits(['load', 'error'])

function onLoad(e: unknown) {
  emit('load', e)
}
function onError(e: unknown) {
  emit('error', e)
}
</script>

<style scoped>
/* mode 的 Web 语义映射（MP 端由原生 mode 属性承担）：aspectFill=cover / widthFix=宽满高自适应 / scaleToFill=fill */
.p-image {
  display: block;
  width: 100%;
}
.p-image--aspectFill {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.p-image--widthFix {
  height: auto;
}
.p-image--scaleToFill {
  width: 100%;
  height: 100%;
  object-fit: fill;
}
</style>
