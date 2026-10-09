<script setup lang="ts">
// website/src/components/PreviewMount.vue —— ★Playground 实时预览面板（决策 #699）
//
// 把 Playground 编辑器的 SFC 源码**实时挂载成真实 Vue 应用**（`playground/live-mount.ts`），
// 并提供**设备框**（复用 DEVICES 真实宽高）。大厂 Playground 的"写即见"第一档。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mountPreview } from '../playground/live-mount'

const props = defineProps<{
  source: string
  /** 设备框宽度（px）；<=0 表示自适应父容器 */
  width?: number
  /** 设备框高度（px）；0/未给 ⇒ 自适应内容高度 */
  height?: number
}>()

const hostRef = ref<HTMLElement | null>(null)
const err = ref('')
let styleEl: HTMLStyleElement | null = null
let unmountFn: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function projectCss(css: string): void {
  if (!styleEl) {
    styleEl = document.createElement('style') // d2-exempt: 注入运行时编译产物的 scoped CSS（无框架原语）
    styleEl.setAttribute('data-proteus-playground-preview', '')
    document.head.appendChild(styleEl) // d2-exempt: 同上（scoped CSS 须文档级生效，无框架原语）
  }
  styleEl.textContent = css
}

function renderNow(): void {
  const el = hostRef.value
  if (!el) return
  err.value = ''
  try {
    unmountFn?.()
    const r = mountPreview(el, props.source)
    unmountFn = r.unmount
    projectCss(r.css)
  } catch (e) {
    unmountFn = null
    err.value = e instanceof Error ? e.message : String(e)
  }
}

/** 防抖（编辑期不每键重挂；120ms 足够"写即见"） */
function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(renderNow, 120)
}

onMounted(renderNow)
watch(() => props.source, schedule)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  unmountFn?.()
  styleEl?.remove()
  styleEl = null
})
</script>

<template>
  <div class="pv-wrap">
    <div
      class="pv-frame"
      :style="{
        width: width && width > 0 ? width + 'px' : '100%',
        height: height && height > 0 ? height + 'px' : 'auto',
      }"
    >
      <!-- 真实挂载点（Vue 应用注入此元素） -->
      <div ref="hostRef" class="pv-host" />
      <p-text v-if="err" class="pv-err">✗ {{ err }}</p-text>
    </div>
    <p-text class="pv-note">
      真实 Vue 编译 + 挂载产物（`@vue/compiler-sfc` 浏览器内直跑）· 宽度自适应面板 · 边界：仅 `vue` 导入 · 真 TS 注解不支持
    </p-text>
  </div>
</template>

<style scoped>
.pv-wrap { display: block; }
.pv-frame {
  border: 1px solid var(--line);
  border-radius: var(--radius-md, 10px);
  /* ★背景 = 官网深色面板令牌（p-* 组件默认浅色文字为深色主题设计——白底会"隐形"） */
  background: var(--panel, #141419);
  /* ★profile-boundary：overflow 只用 Skyline 接受的 hidden（预览框按设备固定大小，超出裁切） */
  overflow: hidden;
  margin: 0 auto;
  min-height: 80px;
  /* ★设备框宽（如 Web 1440）常宽于面板 ⇒ 上限 100%，避免横向溢出裁切 */
  max-width: 100%;
}
.pv-host { min-height: 40px; }
.pv-err {
  display: block;
  color: var(--danger, #b42318);
  background: #fff4f2;
  border-top: 1px solid #f3c6bf;
  padding: 10px 12px;
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  /* ★profile-boundary：white-space 保持默认（normal 为 Skyline 接受值）；长串换行用 overflow-wrap */
  overflow-wrap: anywhere;
}
.pv-note { display: block; color: var(--muted); font-size: 12px; margin-top: 8px; }
</style>
