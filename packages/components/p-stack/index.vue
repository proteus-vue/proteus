<!-- src/components/p-stack/index.vue —— 弹性栈（★G-22 柔性布局 B3）
     方向 + 间距 + 智能换行：Web = flex + gap（wrap 时空间不足自动换行）
     ★G-32 L3 属性补齐（2026-09-19）：align / snap / loop——**swiper 的语义消灭形态**
       （G-31 §2.2 + rules.md「拒绝 <p-swiper>，轮播 = 一维排列 + 吸附 + 循环」）：
       · snap（none/proximity/mandatory）：Web 用 CSS scroll-snap（容器转滚动 + 子项 snap-align）；
       · loop：滚到末项后回环到首项（仅 snap 生效时有意义）；
       · ★两端行为不同（SOP ⑤ 平台分支）：MP 端 view 不滚动（Skyline CSS overflow 无效 ——
         skyline-pitfalls S14 实测，同 p-scroll 告警口径）→ 吸附无载体，降级为普通排列 +
         capabilityWarnOnce 可观察提示（降级声明见 component-ir/degradation.ts）
     双端同源码：div → view（编译期映射） -->
<template>
  <div class="p-stack" :class="stackClass" :style="stackStyle" @scroll="onScroll">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { styleToString } from '@proteus-vue/fluid'
import { isMpRuntime } from '../runtime/container-measure'
import { capabilityWarnOnce } from '../runtime/capability'

// 对象形式 defineProps（编译器静态提取；MP 安全）
const props = defineProps({
  /** 主轴方向：row（横向）/ column（纵向） */
  direction: { type: String, default: 'column' },
  /** 空间不足自动换行（仅 row） */
  wrap: { type: Boolean, default: false },
  /** 子项间距（px） */
  gap: { type: Number, default: 0 },
  /** 交叉轴对齐（flex 值；空串 = 不设置，保持 flex 默认 stretch） */
  align: { type: String, default: '' },
  /** 吸附：none / proximity / mandatory——非 none 时容器转滚动容器（轮播语义） */
  snap: { type: String, default: 'none' },
  /** 循环：滚到末项后回环到首项（仅 snap 生效时有意义） */
  loop: { type: Boolean, default: false },
})

// ★SOP 铁律：isMp 必须 computed(() => isMpRuntime())——直调会成实例属性，模板读不到
const isMp = computed(() => isMpRuntime())

// ★事件契约（SOP ⑥）：事件名与 MP 原生 `bind:<name>` 对齐（scroll）；载荷两端同为
//   {scrollLeft, scrollTop, scrollWidth, scrollHeight} 形态（Web 由 onScroll 补全，见下）
//   ★defineEmits 必须**单行**（编译器单行正则提取，见 02-ir-prop-binding.md §4.3）
const emit = defineEmits(['scroll'])

/** 合法吸附模式（plan L3：snap: none/proximity/mandatory）；非法值按 none 处理 */
const SNAP_MODES: string[] = ['none', 'proximity', 'mandatory']
const snapping = computed<boolean>(() => SNAP_MODES.indexOf(props.snap) > 0)

// ★单表达式 computed（MP 编译器安全——:class 数组项含 '+' 运算会被跳过并告警，见 compiler/template.ts:237）
const stackClass = computed<string>(() =>
  'p-stack-' + props.direction + (props.wrap ? ' p-stack-wrap' : '') + (snapping.value ? ' p-stack-snap' : ''),
)

// ★#495c/d：单表达式 + style 字符串（MP 编译器不支持块体 computed；Skyline 只认字符串 style）
const stackStyle = computed<string>(() => {
  const row = props.direction === 'row'
  const style: Record<string, string | number | undefined> = {
    display: 'flex',
    flexDirection: row ? 'row' : 'column',
    flexWrap: props.wrap ? 'wrap' : 'nowrap',
    gap: props.gap + 'px',
  }
  if (props.align) style.alignItems = props.align
  // ★snap：容器转滚动容器 + CSS scroll-snap（子项 scroll-snap-align 见 <style>）
  //   MP 端不输出——小程序 view 不滚动（S14），输出只会是静默无效属性（反黑盒纪律）
  if (snapping.value && !isMp.value) {
    style.overflowX = row ? 'auto' : 'hidden'
    style.overflowY = row ? 'hidden' : 'auto'
    style.scrollSnapType = (row ? 'x ' : 'y ') + props.snap
  }
  return styleToString(style)
})

// 回环定时器（滚动停止后判定——避免拖动过程中被强行拉回）
let loopTimer: ReturnType<typeof setTimeout> | null = null

/**
 * scroll 事件（★跨端载荷归一，对齐 MP `bindscroll` 的 `e.detail`）：
 *   MP：原生事件自带 `{scrollLeft, scrollTop, scrollWidth, scrollHeight}` → 直接转发；
 *   Web：原生 DOM scroll Event **不含滚动量**（读数在 `e.target` 上，非 `e.scrollLeft`）→ 由本函数补全，
 *     否则父级 `@scroll` 读 `e.scrollLeft` 恒为 undefined（演示回显「永远停在首屏」的根因）。
 *   loop：仅 Web + snap 生效时启用（MP 不滚动 → 无载体，已在降级表登记）。
 */
function onScroll(e: Event): void {
  const target = (e && (e.target as HTMLElement | null)) || null
  const detail = (e as unknown as { detail?: Record<string, number> }).detail
  const payload: Record<string, number> = detail
    ? detail
    : {
        scrollLeft: target ? target.scrollLeft : 0,
        scrollTop: target ? target.scrollTop : 0,
        scrollWidth: target ? target.scrollWidth : 0,
        scrollHeight: target ? target.scrollHeight : 0,
      }
  emit('scroll', payload)

  if (!props.loop || !snapping.value || isMp.value || !target) return
  const el = target
  if (loopTimer !== null) clearTimeout(loopTimer)
  loopTimer = setTimeout(() => {
    loopTimer = null
    const row = props.direction === 'row'
    const max = row ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
    if (max <= 0) return
    const pos = row ? el.scrollLeft : el.scrollTop
    if (pos >= max - 1) {
      if (row) el.scrollTo({ left: 0, behavior: 'smooth' })
      else el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, 120)
}

onMounted(() => {
  // ★反黑盒：MP 端 snap/loop 是**可观察降级**（不是静默失效）——普通排列 + 明确提示
  if (isMp.value && (snapping.value || props.loop)) {
    capabilityWarnOnce(
      'p-stack',
      'scroll-snap',
      '小程序 WXSS 无 scroll-snap——snap/loop 降级为普通排列（如需翻页请用 p-scroll-view 的 paging-enabled）',
    )
  }
})

onUnmounted(() => {
  if (loopTimer !== null) {
    clearTimeout(loopTimer)
    loopTimer = null
  }
})
</script>

<style scoped>
/* ★snap 生效时（轮播）：子项吸附对齐 + 不收缩（flex 默认 shrink:1 会把子项压扁、永不溢出，吸附即失效）
   ★MP 产物剔除本条（Skyline 拒绝通配选择器——见 compiler/style.ts §3.5；snap 在 MP 本就降级） */
.p-stack-snap > :deep(*) {
  scroll-snap-align: start;
  flex-shrink: 0;
}
</style>
