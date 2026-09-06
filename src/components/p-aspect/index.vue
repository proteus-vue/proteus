<!-- src/components/p-aspect/index.vue —— 纵横比容器（★Fluid System S2：内容驱动宽高比盒）
     只声明「宽/高比」：Web = CSS aspect-ratio（Chrome 88+ 原生）；不支持 → padding-top hack 降级
     （height:0 + paddingTop:1/ratio% + 内层绝对定位铺满——★#500 内层包装替代 > * 全局规则：
       MP 产物通配/子选择器被剔除（style/skyline-selector），slot 子元素必须由组件内层节点承载定位）
     MP：逻辑层无 CSS.supports → Skyline 构建期宏判不支持（padding hack）；WebView 假设支持（渲染端自决） -->
<template>
  <div class="p-aspect" :class="aspectClass" :style="aspectStyle">
    <div class="p-aspect-inner" :style="innerStyle">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { detectFluidCapabilities } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 宽/高比（如 16/9 = 1.777；默认 1.777） */
  ratio: { type: Number, default: 16 / 9 },
  /** 最大宽度（px；0 = 不限） */
  maxWidth: { type: Number, default: 0 },
})

// ★能力检测（组件初始化一次）：MP 无 CSS.supports → Skyline 构建期宏判不支持（padding hack）；WebView/SSR 假设支持
const aspectOk = detectFluidCapabilities().aspectRatio

const aspectClass = computed(() => (aspectOk ? '' : 'p-aspect-fallback'))

// ★断言放方法体内（MP 编译器剥离方法体 as；返回对象 → :style 绑定由编译器自动序列化字符串 #500）
const aspectStyle = computed(() => {
  const ratio = props.ratio > 0 ? props.ratio : 16 / 9
  const style: Record<string, string> = {
    position: 'relative',
    width: '100%',
  }
  if (props.maxWidth > 0) style.maxWidth = props.maxWidth + 'px'
  if (aspectOk) {
    // 原生：aspect-ratio 保持盒比例（内层撑满即可）
    style.aspectRatio = ratio + ' / 1'
    return style
  }
  // ★降级：padding-top hack——height 0 + paddingTop = 1/ratio%（内层绝对定位铺满）
  //   ★#500 显式 box-sizing: content-box（padding hack 依赖高度=0+padding 撑起盒高；若渲染端默认 border-box 则总高恒 0 → 宽高全丢）
  style.boxSizing = 'content-box'
  style.height = '0px'
  style.paddingTop = 100 / ratio + '%'
  return style
})

// ★#500 内层节点：承载 slot 子元素——原生模式撑满；降级模式绝对定位铺满（替代 > * 全局规则，MP 无选择器可达 slot 内容）
const innerStyle = computed(() => {
  if (aspectOk) {
    return { width: '100%', height: '100%' } as Record<string, string>
  }
  return {
    position: 'absolute',
    top: '0px',
    left: '0px',
    width: '100%',
    height: '100%',
  } as Record<string, string>
})
</script>
