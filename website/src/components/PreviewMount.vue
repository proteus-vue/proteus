<script setup lang="ts">
// website/src/components/PreviewMount.vue —— ★Playground 实时预览面板（决策 #699/#700）
//
// 把 Playground 的**多文件项目**（`playground/project.ts`）实时挂载成真实 Vue 应用
// （`playground/build-project.ts`：多文件 ESM 模块链接 + 外部 ESM 依赖）。大厂 Playground 的"写即见"。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mountProject } from '../playground/build-project'
import type { PlaygroundProject } from '../playground/project'

const props = defineProps<{ project: PlaygroundProject }>()

const hostRef = ref<HTMLElement | null>(null)
const err = ref('')
const building = ref(false)
let styleEl: HTMLStyleElement | null = null
let unmountFn: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** 递增令牌：并发构建时只应用最后一次（防旧结果覆盖新结果） */
let token = 0

function projectCss(css: string): void {
  if (!styleEl) {
    styleEl = document.createElement('style') // d2-exempt: 注入运行时编译产物的 scoped CSS（无框架原语）
    styleEl.setAttribute('data-proteus-playground-preview', '')
    document.head.appendChild(styleEl) // d2-exempt: 同上（scoped CSS 须文档级生效，无框架原语）
  }
  styleEl.textContent = css
}

async function renderNow(): Promise<void> {
  const el = hostRef.value
  if (!el) return
  const my = ++token
  err.value = ''
  building.value = true
  try {
    const r = await mountProject(el, props.project)
    if (my !== token) { r.unmount(); return } // 期间又有新构建 ⇒ 丢弃本次
    unmountFn?.()
    unmountFn = r.unmount
    projectCss(r.css)
  } catch (e) {
    if (my !== token) return
    unmountFn = null
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (my === token) building.value = false
  }
}

/** 防抖（编辑期不每键重挂；200ms 足够"写即见"） */
function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void renderNow(), 200)
}

onMounted(() => void renderNow())
// 深监 project（多文件内容/增删都会触发）
watch(() => props.project, schedule, { deep: true })
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  unmountFn?.()
  styleEl?.remove()
  styleEl = null
})
</script>

<template>
  <div class="pv-wrap">
    <div class="pv-frame">
      <div ref="hostRef" class="pv-host" />
      <p-text v-if="building && !err" class="pv-status">编译中…</p-text>
      <p-text v-if="err" class="pv-err">✗ {{ err }}</p-text>
    </div>
    <p-text class="pv-note">
      真实 Vue 编译 + 挂载（`@vue/compiler-sfc` 浏览器内直跑）· 多文件 ESM 模块链接 · 依赖走 esm.sh ·
      边界：仅 `.vue`/`.js` · `vue` 用宿主单例 · 无循环 import
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
  overflow: hidden;
  margin: 0 auto;
  min-height: 80px;
  max-width: 100%;
}
.pv-host { min-height: 40px; }
.pv-status { display: block; color: var(--muted); font-size: 12px; padding: 8px 12px; }
.pv-err {
  display: block;
  color: var(--danger, #b42318);
  background: #fff4f2;
  border-top: 1px solid #f3c6bf;
  padding: 10px 12px;
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  overflow-wrap: anywhere;
}
.pv-note { display: block; color: var(--muted); font-size: 12px; margin-top: 8px; }
</style>
