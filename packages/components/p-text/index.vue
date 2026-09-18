<!-- src/components/p-text/index.vue —— 文本（组件库 B2）
     矩阵 01 §2：selectable 映射 —— Web user-select: text（.is-selectable 类）；MP 原生 text 的 selectable 属性
     双端同源码：span → text（编译期映射）
     ★2026-09-14 官方属性对齐（end-alignment 批次 2）：补齐官方 <text> 的 user-select/overflow/max-lines/
       select-on-gesture/space/decode（官方 selectable 已废弃 → 语义收敛到 user-select，两者并存兼容）
     ★2026-09-14 Web 修复：根节点由 `<span>` 改 **`<text>`**（Web 插件改写 proteus-text，复用模拟层；MP 产物不变） -->
<template>
  <text
    class="p-text"
    :class="{
      'is-selectable': selectable || userSelect,
      'is-ellipsis': overflow === 'ellipsis',
      'is-clamp': maxLines > 0,
      'is-nowrap': overflow === 'clip',
    }"
    :style="textStyle"
    :selectable="selectable ? 'true' : ''"
    :user-select="userSelect ? 'true' : ''"
    :overflow="overflow"
    :max-lines="maxLines || ''"
    :select-on-gesture="selectOnGesture ? 'true' : ''"
    :space="space"
    :decode="decode ? 'true' : ''"
    :aria-label="ariaLabel"
  >
    <slot />
  </text>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'

const props = defineProps({
  pid: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  /** 文本是否可选（官方已废弃 → 兼容保留；新代码用 userSelect） */
  selectable: { type: Boolean, default: false },
  // ── ★官方 <text> 属性（2026-09-14 对齐） ──
  /** 文本是否可选（官方 user-select；Web 用 CSS user-select，MP 用原生属性） */
  userSelect: { type: Boolean, default: false },
  /** 文本溢出处理：ellipsis（省略号）/ clip（裁剪） */
  overflow: { type: String, default: '' },
  /** 限制文本最大行数（Web 用 -webkit-line-clamp 映射） */
  maxLines: { type: Number, default: 0 },
  /** 是否允许通过手势选择文本 */
  selectOnGesture: { type: Boolean, default: false },
  /** 显示连续空格：ensp / emsp / nbsp */
  space: { type: String, default: '' },
  /** 是否解码 &nbsp; 等实体 */
  decode: { type: Boolean, default: false },
})

// max-lines 的 Web 映射：行数钳制需动态数值 → 内联 style（CSS 类无法承载变量）
const textStyle = computed(() => {
  const style: CSSProperties = {}
  if (props.maxLines > 0) {
    style.display = '-webkit-box'
    style.WebkitBoxOrient = 'vertical'
    style.WebkitLineClamp = props.maxLines
    style.overflow = 'hidden'
  }
  return style
})
</script>

<style scoped>
.p-text.is-selectable {
  user-select: text;
  -webkit-user-select: text;
}
.p-text.is-ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.p-text.is-clamp {
  overflow: hidden;
}
.p-text.is-nowrap {
  overflow: hidden;
  white-space: nowrap;
}
</style>
