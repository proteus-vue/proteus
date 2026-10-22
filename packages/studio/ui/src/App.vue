<script setup lang="ts">
// Studio 壳（决策 #1183）：纯 Vue 3 + Vite，**不接 Proteus**（自举死锁的红线）。
// 布局仍是「顶部条 / 左栏 / 画布 / 右栏 / 状态栏」，画布位置由 HTML 驱动原生视图。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { setCanvasRect } from './bridge'
import { ms, num, pct, useStats } from './useStats'
import DevicePanel from './panels/DevicePanel.vue'
import PipelinePanel from './panels/PipelinePanel.vue'
import RuntimePanel from './panels/RuntimePanel.vue'
import InspectorPanel from './panels/InspectorPanel.vue'

const { stats, error, hasBridge } = useStats(500)
const rect = ref('—')
const canvasEl = ref<HTMLElement | null>(null)

/** 画布矩形：HTML 定布局，原生跟随（#1173 的接线，这里只是搬到 Vue 里） */
async function syncRect() {
  const el = canvasEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  rect.value = `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`
  try {
    await setCanvasRect({ x: r.x, y: r.y, w: r.width, h: r.height })
  } catch {
    /* 没桥时静默：面板本身还要能看（Playwright / 浏览器直开） */
  }
}

let rectTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void syncRect()
  rectTimer = setInterval(syncRect, 1000)
  addEventListener('resize', syncRect)
})
onBeforeUnmount(() => {
  if (rectTimer) clearInterval(rectTimer)
  removeEventListener('resize', syncRect)
})

const running = computed(() => (stats.value?.frames ?? 0) > 0)
const linkText = computed(() => (!hasBridge ? '未连接 IPC' : running.value ? '画布运行中' : '等待首帧'))
const hint = computed(() => {
  if (error.value) return 'stats 调用失败：' + error.value
  if (!hasBridge) return '无 Tauri 桥（浏览器直开时属正常）'
  return running.value ? '原生画布运行中 · 60Hz 调度 · VT 解码' : '等待原生画布…'
})
</script>

<template>
  <div class="app">
    <div class="top">
      <div class="brand">Proteus <span>Studio</span></div>
      <div class="chip"><span class="dot" :class="{ off: !running }" /><span id="linkChip">{{ linkText }}</span></div>
      <div class="chip">镜像 60fps 上限</div>
      <div style="flex:1" />
      <div class="chip">阶段 1 骨架 · 画布由 HTML 布局驱动</div>
    </div>

    <div class="rail">
      <button class="on" title="设备">▣</button>
      <button title="样式">◈</button>
      <button title="断言">✓</button>
      <button title="录制">●</button>
    </div>

    <div class="main">
      <div id="canvas" ref="canvasEl" />
      <div class="frame" />
      <div class="cross" />
      <div class="tag">device.native · 原生 GL 画布（下方）· HTML 叠加（本层）</div>
    </div>

    <div class="side">
      <DevicePanel :s="stats" />
      <PipelinePanel :s="stats" />
      <RuntimePanel :s="stats" />
      <InspectorPanel />
    </div>

    <div class="status">
      <span><span class="k">canvas</span> <span id="srect">{{ rect }}</span></span>
      <span><span class="k">frames</span> <span id="sframes">{{ stats?.frames ?? 0 }}</span></span>
      <span><span class="k">fps</span> <span id="sfps">{{ stats ? num(stats.fps, 1) : '—' }}</span></span>
      <span><span class="k">lat</span> <span id="slat">{{ stats ? ms(stats.lat_p50) : '—' }}</span></span>
      <span><span class="k">late</span> <span id="slate">{{ stats?.late ?? 0 }}</span></span>
      <span><span class="k">cpu</span> <span id="scpu">{{ stats ? pct(stats.cpu_pct) : '—' }}</span></span>
      <span style="flex:1" />
      <span id="shint">{{ hint }}</span>
    </div>
  </div>
</template>
