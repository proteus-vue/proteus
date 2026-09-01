<!-- src/components/p-safe/index.vue —— 安全区避让（★Fluid System S2 + G-09 语义 Web 落地）
     只声明「避让方向」：Web = env(safe-area-inset-*)（前提 viewport-fit=cover）+ 折叠屏 hinge 避让
     （display-mode: fold/span 时内容避开折叠区域 env(fold-left/fold-width)——把系统能力搬进框架，原则 #10）
     薄壳组件：displayMode 状态桥接 @proteus-vue/fluid（createDeviceEnv + resolveSafeAreaStyle 纯逻辑）
     MP：Skyline 部分支持 env()；逻辑层无 matchMedia → displayMode 恒 standard → hinge 不生效（渲染端自决）
     与 App 端 SafeArea（G-09 safeAreaLayoutGuide/WindowInsets）同语义：开发者只写 <p-safe area="top"> -->
<template>
  <div class="p-safe" :class="safeClass" :style="safeStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CSSProperties } from 'vue'
import { createDeviceEnv, resolveSafeAreaStyle } from '@proteus-vue/fluid'
import type { DeviceEnv, FluidDisplayMode } from '@proteus-vue/fluid'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 避让方向：top / bottom / left / right / horizontal / all（默认 top） */
  area: { type: String, default: 'top' },
  /** 折叠屏 hinge 避让：display-mode fold/span 时左右避开折叠区域（默认关闭） */
  fold: { type: Boolean, default: false },
  /** 兜底 px：桌面/无刘海屏 env()=0 时强制至少该值（max() 包裹；0 = 不兜底） */
  fallback: { type: Number, default: 0 },
})

const displayMode = ref<FluidDisplayMode>('standard')
let env: DeviceEnv | null = null
onMounted(() => {
  env = createDeviceEnv()
  displayMode.value = env.get().displayMode
  env.subscribe((s) => {
    displayMode.value = s.displayMode
  })
})
onUnmounted(() => {
  if (env) env.destroy()
  env = null
})

/** hinge 生效形态：fold（单屏折叠）/ span（双屏展开）——expand 无 hinge */
const isFoldActive = computed(() => props.fold && (displayMode.value === 'fold' || displayMode.value === 'span'))

const safeClass = computed(() => (isFoldActive.value ? 'p-safe-fold' : ''))

// ★断言放方法体内（MP 编译器剥离方法体 as；纯函数解析 → CSSProperties 字面量类型）
const safeStyle = computed(() => {
  const style = resolveSafeAreaStyle({
    area: props.area,
    fallback: props.fallback,
    fold: props.fold,
    displayMode: displayMode.value,
  })
  return style as CSSProperties
})
</script>
