<!-- packages/components/p-icon/index.vue —— 图标（★Keryx 渲染器 · 图标库方案 §5）
     ★★2026-10-11 重写：**图标即数据（SVG path 单一真源，非字体）**——此前用 unicode 字形表
       （`✓★♥⌕…`）跨端字体依赖、可渲染成 tofu（违宪：图标库方案 §4 判"三套实现全部违宪"）。
       现从 `@proteus-vue/icons`（Keryx 数据包）取 path，三端同源渲染：
         · Web：内联 `<svg><path d>`（真矢量，随 currentColor 着色）
         · MP/Skyline：`<svg>` 走 svg-lower 编译期 lowering（G-62），或 p-svg-canvas 兜底
         · App：内核 `svg_path.rs`（`path d` → CGPath/Path 描边填充）
     API 向后兼容：`name`（含旧字形名如 success/home，映射到同名 path）+ 官方 `type` 别名 + size/color/spin。
     ★淘汰棘轮：旧 `GLYPHS` unicode 字形表移除（`check:icons` 禁止数据侧出现字形字面量）。 -->
<template>
  <view class="p-icon" :class="{ 'p-icon-spin': spin }" :style="boxStyle">
    <svg
      class="p-icon__svg"
      :viewBox="icon.viewBox"
      :width="size"
      :height="size"
      fill="currentColor"
      aria-hidden="true"
    >
      <path :d="icon.d" />
    </svg>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
// ★Keryx 数据包（path 单一真源；`normalizedIcon` 产出内核可吃的绝对 M/L/C/Q/Z）
import { normalizedIcon, hasIcon } from '@proteus-vue/icons'

const props = defineProps({
  /** 图标语义名（Keryx 名称；未知 → 显式占位图标，非 '?'）。框架名，优先于官方 type */
  name: { type: String, default: '' },
  /** ★官方 <icon> type（success/info/warn/…）——name 的官方别名 */
  type: { type: String, default: '' },
  /** 尺寸 px */
  size: { type: Number, default: 16 },
  /** 颜色 */
  color: { type: String, default: 'currentColor' },
  /** 旋转动画 */
  spin: { type: Boolean, default: false },
})

/** 语义名（name 优先，回退 type）。 */
const iconName = computed(() => props.name || props.type || 'info')

/** ★数据侧保证：未知名的显式占位 + 警告（反黑盒——静默 '?' 变静默 path）。
 *  ★不读 `import.meta.env.DEV`：该 vite 专有形态在本仓自定义编译器（compileVueSfc，服务 MP/App 端）
 *  里不被替换——`import.meta` 残留进 `Page()/Component()` 产物即语法错误（validate 当场抛，实测三处门禁红）。
 *  MP 端亦无等价的编译期 dev 宏落在 .vue 脚步里（`__PROTEUS_DEBUG__` 只作用于共享 .ts 模块与 app.js）。
 *  故此处与同库 p-auth-gate 一致：无名即告警（无名 = 开发者写错，任何环境都值得暴露）。 */
const icon = computed(() => {
  const n = iconName.value
  if (!hasIcon(n)) {
    // eslint-disable-next-line no-console
    console.warn(`[p-icon] 未知图标名 "${n}"——已用占位图标。可用名见 @proteus-vue/icons`)
  }
  return normalizedIcon(n)
})

/** 盒尺寸/居中/颜色（作用在 view 盒上——旋转中心即盒中心，不随 path 墨迹偏移）。 */
const boxStyle = computed(() => {
  const style: CSSProperties = {
    width: props.size + 'px',
    height: props.size + 'px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: props.color,
    fontStyle: 'normal',
    transformOrigin: '50% 50%',
  }
  return style as CSSProperties
})
</script>

<style scoped>
.p-icon__svg {
  display: block;
}
.p-icon-spin {
  animation: p-icon-rotate 1s linear infinite;
}
@keyframes p-icon-rotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
