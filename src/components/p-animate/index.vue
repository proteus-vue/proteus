<!-- src/components/p-animate/index.vue —— E20 动画声明——animation CSS 语义面
     keyframes：预设动画名（fade/bounce/pulse/shake/zoom-in/spin——@keyframes p-animate-{keyframes}）
     duration：动画时长 ms（缺省 600）
     loop：是否循环（缺省 true——声明式装饰动画；false → 播一次）
     delay：延迟 ms（缺省 0）
     ★跨端：Web 原生 CSS animation；Skyline 支持 animation（同 transition）——纯 CSS 声明语义；
       MP 编译器安全——:class 走单 computed 表达式体（同 p-scale 'p-scale-' + density 惯例） -->
<template>
  <div class="p-animate" :class="animationClass" :style="animationStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 动画预设名（fade/bounce/pulse/shake/zoom-in/spin） */
  keyframes: { type: String, default: 'fade' },
  /** 动画时长（ms） */
  duration: { type: Number, default: 600 },
  /** 循环播放（缺省 true——装饰动画；false 播一次） */
  loop: { type: Boolean, default: true },
  /** 延迟（ms） */
  delay: { type: Number, default: 0 },
})

// ★MP 安全：单 computed 表达式体（p-scale 惯例）；预设名 → 全局 @keyframes 类
const animationClass = computed(() => 'p-animate-' + props.keyframes)

// 时长/次数/延迟内联（对象字面量表达式体——MP 按表达式拼接；全局规则管 keyframes 名与缓动）
const animationStyle = computed(() => ({
  animationDuration: props.duration + 'ms',
  animationIterationCount: props.loop ? 'infinite' : '1',
  animationDelay: props.delay + 'ms',
}))
</script>

<style global>
.p-animate {
  animation-timing-function: ease;
}
@keyframes p-animate-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes p-animate-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-14px);
  }
}
@keyframes p-animate-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
@keyframes p-animate-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}
@keyframes p-animate-zoom-in {
  from {
    transform: scale(0.8);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes p-animate-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.p-animate-fade {
  animation-name: p-animate-fade;
}
.p-animate-bounce {
  animation-name: p-animate-bounce;
}
.p-animate-pulse {
  animation-name: p-animate-pulse;
}
.p-animate-shake {
  animation-name: p-animate-shake;
}
.p-animate-zoom-in {
  animation-name: p-animate-zoom-in;
}
.p-animate-spin {
  animation-name: p-animate-spin;
}
</style>