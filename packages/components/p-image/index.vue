<!-- src/components/p-image/index.vue —— 图片（组件库 B2）
     矩阵 01 §3：mode 裁剪（Web object-fit 映射 / MP 原生 mode 透传）+ lazy-load（Web loading=lazy / MP lazy-load）+ placeholder
     双端同源码：img → image（编译期映射）；@load/@error 事件归一
     注意：不用 computed 块体（编译器仅支持箭头表达式体），mode 的 Web 映射走 CSS 类（p-image--<mode>）
     ★2026-09-14 Web 修复：根节点由 `<img>` 改 **`<image>`**（Web 插件改写 proteus-image，复用模拟层的
       mode 映射 + show-menu-by-longpress 长按菜单 + load/error；MP 端同为原生 image，产物不变）。
       注意：不用 computed 块体（编译器仅支持箭头表达式体），mode 的 Web 映射走 CSS 类（p-image--<mode>）。 -->
<template>
  <image
    class="p-image"
    :class="{
      'p-image--aspectFill': mode === 'aspectFill',
      'p-image--widthFix': mode === 'widthFix',
      'p-image--scaleToFill': mode === 'scaleToFill',
      'is-fade-in': fadeIn,
    }"
    :src="src"
    :alt="alt"
    :lazy-load="lazyLoad ? 'true' : ''"
    :mode="mode"
    :placeholder="placeholder"
    :show-menu-by-longpress="showMenuByLongpress ? 'true' : ''"
    :preload="preload ? 'true' : ''"
    :webp="webp ? 'true' : ''"
    :referrerpolicy="(referrerPolicy as any)"
    :aria-label="ariaLabel"
    @load="onLoad"
    @error="onError"
  ></image>
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
  // ── ★官方 <image> 属性（2026-09-14 对齐） ──
  /** 长按图片显示菜单（发送给朋友/保存/识别二维码等） */
  showMenuByLongpress: { type: Boolean, default: false },
  /** 是否渐显（Web 用 CSS 淡入动画映射） */
  fadeIn: { type: Boolean, default: false },
  /** 是否预加载（设置 src 时即下载解码） */
  preload: { type: Boolean, default: false },
  /** 是否解析 webP 格式（默认仅网络资源） */
  webp: { type: Boolean, default: false },
  /** ★官方 <cover-image> referrer-policy：请求的 referrer 策略（Web 原生 img 同名属性） */
  referrerPolicy: { type: String, default: '' },
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
/* 官方 fade-in 的 Web 映射：加载完成后由 is-fade-in 做淡入 */
.is-fade-in {
  animation: p-image-fade-in 0.3s ease;
}
@keyframes p-image-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
