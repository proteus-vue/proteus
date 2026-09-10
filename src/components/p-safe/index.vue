<!-- src/components/p-safe/index.vue —— 安全区避让（★Fluid System S2 + G-09 语义 Web 落地）
     只声明「避让方向」：Web = env(safe-area-inset-*)（前提 viewport-fit=cover）+ 折叠屏 hinge 避让
     （display-mode: fold/span 时内容避开折叠区域 env(fold-left/fold-width)——把系统能力搬进框架，原则 #10）
     薄壳组件：displayMode 状态桥接 @proteus-vue/fluid（createDeviceEnv + resolveSafeAreaStyle 纯逻辑）
     ★MP/Skyline：env() **不受支持**（实测整条声明被丢弃 → 组件此前无效）→ 走**运行时读数**
     （getWindowInfo().statusBarHeight+safeArea / getMenuButtonBoundingClientRect 胶囊下沿）→ px 内边距
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
/** ★MP/Skyline 运行时实测内边距（px）：env(safe-area-inset-*) 在 Skyline 下**整条声明被丢弃**
 *  （实测 p-safe 无效）→ 改由逻辑层读数：getWindowInfo().statusBarHeight / safeArea +
 *  getMenuButtonBoundingClientRect()（胶囊按钮下沿，避免内容与胶囊并列）。
 *  Web 环境无 wx → 保持 null → 走 env() 路径。 */
const insets = ref<{ top: number; bottom: number; left: number; right: number } | null>(null)
let env: DeviceEnv | null = null
onMounted(() => {
  // MP 运行时读数（优先于 env()）
  try {
    const w = (globalThis as {
      wx?: {
        getWindowInfo?: () => { statusBarHeight?: number; screenWidth?: number; screenHeight?: number; safeArea?: { top?: number; bottom?: number; left?: number; right?: number } }
        getMenuButtonBoundingClientRect?: () => { bottom?: number }
      }
    }).wx
    if (w && typeof w.getWindowInfo === 'function') {
      const info = w.getWindowInfo()
      const sa = info.safeArea || {}
      const sbH = typeof info.statusBarHeight === 'number' ? info.statusBarHeight : 0
      let top = sbH
      if (typeof w.getMenuButtonBoundingClientRect === 'function') {
        const capBottom = w.getMenuButtonBoundingClientRect().bottom
        if (typeof capBottom === 'number' && capBottom > top) top = capBottom
      }
      const screenH = typeof info.screenHeight === 'number' ? info.screenHeight : 0
      const screenW = typeof info.screenWidth === 'number' ? info.screenWidth : 0
      insets.value = {
        top,
        bottom: typeof sa.bottom === 'number' && screenH ? Math.max(0, screenH - sa.bottom) : 0,
        left: typeof sa.left === 'number' ? sa.left : 0,
        right: typeof sa.right === 'number' && screenW ? Math.max(0, screenW - sa.right) : 0,
      }
    }
  } catch {
    /* 读数失败 → 走 env() 兜底 */
  }
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
    // ★MP 运行时内边距（null → env() 路径）
    insets: insets.value ?? undefined,
  })
  return style as CSSProperties
})
</script>
