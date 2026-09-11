<!-- src/components/p-progress/index.vue —— 进度条（★能力颗粒度对齐 C2：ui.progress · 对齐小程序 <progress>）
     双端同源码：div → view；纯样式计算（MP 安全——无 wx/document/window 直调）
     percent 0-100；status=active/success/exception；支持线性/环形、竖向、自定义色与粗细 -->
<template>
  <!-- ★MP 安全：modifier 类用对象静态键（字符串拼接在 MP 被跳过——对象字面量两端可编译） -->
  <div
    class="p-progress"
    :class="{
      'p-progress--line': type === 'line',
      'p-progress--circle': type === 'circle',
      'p-progress--active': status === 'active',
      'p-progress--success': status === 'success',
      'p-progress--exception': status === 'exception',
    }"
    :style="wrapStyle"
  >
    <div class="p-progress__outer" :style="outerStyle">
      <div class="p-progress__bar" :style="barStyle" />
    </div>
    <span v-if="showInfo" class="p-progress__info" :style="infoStyle">{{ infoText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  /** 当前进度 0-100（超界自动夹取） */
  percent: { type: Number, default: 0 },
  /** 是否显示右侧百分比文案 */
  showInfo: { type: Boolean, default: true },
  /** 状态：active 进行中 / success 成功 / exception 异常 */
  status: { type: String, default: 'active' },
  /** 线宽 px（环形=环粗，线性=条高） */
  strokeWidth: { type: Number, default: 6 },
  /** 类型：line 线性 / circle 环形 */
  type: { type: String, default: 'line' },
  /** 是否圆角 */
  rounded: { type: Boolean, default: true },
  /** 进度色（覆盖状态默认色） */
  color: { type: String, default: '' },
  /** 轨道底色 */
  trackColor: { type: String, default: '' },
})

const clamped = computed(() => {
  if (!Number.isFinite(props.percent)) return 0
  return Math.min(100, Math.max(0, props.percent))
})

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--p-progress-active, #1677ff)',
  success: 'var(--p-progress-success, #00b42a)',
  exception: 'var(--p-progress-exception, #f53f3f)',
}

const barColor = computed(() => props.color || STATUS_COLOR[props.status] || STATUS_COLOR.active)
const track = computed(() => props.trackColor || 'var(--p-progress-track, rgba(0, 0, 0, 0.06))')
const infoText = computed(() => Math.round(clamped.value) + '%')

const wrapStyle = computed<CSSProperties>(() => {
  if (props.type === 'circle') {
    return { display: 'inline-flex', alignItems: 'center', gap: '8px' }
  }
  return { display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }
})

const outerStyle = computed<CSSProperties>(() => {
  const radius = props.rounded ? props.strokeWidth / 2 + 'px' : '0'
  if (props.type === 'circle') {
    // 环形：用 conic-gradient 绘制（纯 CSS——两端可用；无 SVG 依赖）
    return {
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      background:
        'conic-gradient(' + barColor.value + ' ' + clamped.value * 3.6 + 'deg, ' + track.value + ' 0deg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }
  }
  return {
    flex: '1 1 auto',
    height: props.strokeWidth + 'px',
    background: track.value,
    borderRadius: radius,
    overflow: 'hidden',
  }
})

const barStyle = computed<CSSProperties>(() => {
  if (props.type === 'circle') {
    // 内圆遮罩（环形厚度 = strokeWidth）
    return {
      width: 'calc(100% - ' + props.strokeWidth * 2 + 'px)',
      height: 'calc(100% - ' + props.strokeWidth * 2 + 'px)',
      borderRadius: '50%',
      background: 'var(--p-progress-inner, #fff)',
    }
  }
  return {
    width: clamped.value + '%',
    height: '100%',
    background: barColor.value,
    borderRadius: props.rounded ? props.strokeWidth / 2 + 'px' : '0',
    transition: 'width 0.3s ease',
  }
})

const infoStyle = computed<CSSProperties>(() => ({
  flex: '0 0 auto',
  fontSize: '12px',
  color: 'var(--p-text-color-3, #86909c)',
  fontVariantNumeric: 'tabular-nums',
}))
</script>

<style scoped>
.p-progress__bar {
  will-change: width;
}
</style>
