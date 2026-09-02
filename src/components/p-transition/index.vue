<!-- src/components/p-transition/index.vue —— E19 过渡（显隐）——transition CSS 语义面
     name：过渡预设（fade/slide-up/slide-down/slide-left/slide-right/zoom——CSS 类 p-transition-{name}）
     mode：in（进入）/ out（退出）/ both（缺省 both）
     duration：过渡时长 ms（缺省 300）
     visible：显隐开关——false 且 mode=out/both → 加 p-transition-hidden 类触发退出过渡
     ★跨端：Web 原生 CSS transition；Skyline 支持 transition——同一类切换（朴素但正确，G-22.2）；
       纯 CSS 无 JS 依赖；MP 编译器安全——:class 走单 computed 表达式体（同 p-safe safeClass 惯例） -->
<template>
  <div class="p-transition" :class="transitionClass" :style="transitionStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 过渡预设名（fade/slide-up/slide-down/slide-left/slide-right/zoom） */
  name: { type: String, default: 'fade' },
  /** 过渡方向：in（仅进入）/ out（仅退出）/ both（双向） */
  mode: { type: String, default: 'both' },
  /** 过渡时长（ms） */
  duration: { type: Number, default: 300 },
  /** 显隐开关（父级控制） */
  visible: { type: Boolean, default: true },
})

// ★MP 安全：单 computed 表达式体，依赖直接是 props（顶层可追踪——avoid computed-on-computed）
//   类拼接：预设名 class + 退出隐藏态 class（类切换即显隐过渡；单行表达式体——MP computed 按表达式拼接）
const transitionClass = computed(() => 'p-transition-' + props.name + (!props.visible && (props.mode === 'out' || props.mode === 'both') ? ' p-transition-hidden' : ''))

// 每个实例独立时长（对象字面量表达式体——MP 按表达式拼接；全局规则管属性/缓动）
const transitionStyle = computed(() => ({ transitionDuration: props.duration + 'ms' }))
</script>

<style global>
.p-transition {
  transition-property: opacity, transform;
  transition-timing-function: ease;
}
/* 预设（name）：隐藏态 = 透明 + 偏移/缩放——类切换即显隐过渡 */
.p-transition-fade.p-transition-hidden {
  opacity: 0;
}
.p-transition-slide-up.p-transition-hidden {
  opacity: 0;
  transform: translateY(16px);
}
.p-transition-slide-down.p-transition-hidden {
  opacity: 0;
  transform: translateY(-16px);
}
.p-transition-slide-left.p-transition-hidden {
  opacity: 0;
  transform: translateX(16px);
}
.p-transition-slide-right.p-transition-hidden {
  opacity: 0;
  transform: translateX(-16px);
}
.p-transition-zoom.p-transition-hidden {
  opacity: 0;
  transform: scale(0.92);
}
</style>