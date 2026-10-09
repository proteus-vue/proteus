<script setup lang="ts">
// website/src/components/PreviewMount.vue —— ★Playground 实时预览面板（决策 #699/#700）
//
// 把 Playground 的**多文件项目**实时挂载成真实 Vue 应用（`playground/build-project.ts`）。
// ★并发安全（#700 续）：**先构建、后原子替换**——构建期保留旧结果（不黑屏）+ 顶部"编译中"提示；
//   陈旧构建（编辑期更早的一次）**不触碰 DOM**（此前它会在最新结果之后清空容器 ⇒ 黑屏）。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildProject, mountComponent } from '../playground/build-project'
import type { PlaygroundProject } from '../playground/project'

const props = defineProps<{ project: PlaygroundProject }>()

const hostRef = ref<HTMLElement | null>(null)
const err = ref('')
const building = ref(false)
const hasResult = ref(false)
let styleEl: HTMLStyleElement | null = null
let unmountFn: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
/** 递增令牌：并发构建时只应用最后一次（陈旧构建不触碰 DOM） */
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
  const host = hostRef.value
  if (!host) return
  const my = ++token
  err.value = ''
  building.value = true
  try {
    // ① **纯构建**（不碰 DOM）——构建期旧结果仍在屏上，不黑屏
    const { component, css } = await buildProject(props.project)
    if (my !== token) return // 陈旧构建 ⇒ 丢弃（**不触碰 DOM**）
    // ② 原子替换：在新容器里挂好，再整体换入（避免"先清空再挂载"的空窗/被陈旧构建清掉）
    const next = document.createElement('div') // d2-exempt: 原子替换的中间容器（无框架原语）
    const unmount = mountComponent(next, component)
    unmountFn?.()
    host.replaceChildren(next)
    unmountFn = unmount
    projectCss(css)
    hasResult.value = true
  } catch (e) {
    if (my !== token) return
    // 构建失败：**保留旧结果**（不为一次瞬时错误清屏），只显示错误条
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
      <!-- 编译中提示（固定角标，不遮内容；构建期旧结果仍在） -->
      <span v-if="building" class="pv-spinner" aria-live="polite"><i />编译中…</span>
      <p-text v-if="!hasResult && !err" class="pv-status">正在编译首个预览…</p-text>
      <div ref="hostRef" class="pv-host" />
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
  position: relative;
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
/* 编译中角标（右上，半透明胶囊 + 旋转点） */
.pv-spinner {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(20,20,25,.82);
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  pointer-events: none;
}
.pv-spinner i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--brand2, #6b7cff);
  border-top-color: transparent;
  animation: pv-spin .7s linear infinite;
}
@keyframes pv-spin { to { transform: rotate(360deg); } }
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
