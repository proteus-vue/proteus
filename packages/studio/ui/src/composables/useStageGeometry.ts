// packages/studio/ui/src/composables/useStageGeometry.ts
// ★★★#1362–#1361 后续（#1344 收口）：**画布几何**（等比适配 / 缩放 / 平移 / 拖动限位）
//   —— 从 `App.vue` 抽出（其 `<script setup>` 涨到 800 行，整文件 1109 行越过
//   `check:file-size` 的 1000 行硬上限；这一块是**纯计算**，抽出零视觉风险）。
//
// 【为什么必须做等比适配（2026-10-23 · 生产验收标准）】
//   原生视图之前是「main 区减去 20px 内边距」的一整块，而 blit 把纹理**铺满整个视口**
//   ⇒ 画面被拉伸成视口的宽高比。这不是观感问题，是**画面失真**：
//     · Android 1280x720 (1.78) 塞进约 1.25 的方形区 ⇒ 纵向拉伸约 40%；
//     · iPhone 888x1920 (0.4625) 塞进同一区域 ⇒ 横向拉伸约 2.7 倍。
//   为什么一直没被发现：`poc_dump` 读的是 **FBO（g_canvas 纹理）**而不是屏幕，
//   dump 出来的像素永远正确，只有人眼看窗口才看得出变形。
//
// 【怎么修】让原生视图**只占设备那一块**：HTML 侧按设备宽高比算出矩形，原生视图跟着走
//   ⇒ 视口宽高比 == 画面宽高比 ⇒ 像素 1:1（无拉伸、无黑边）。
//   原生侧同时加了等比兜底（embed_view.m 的 uFit），万一两边漂移也只留黑边、绝不变形。
//
// 【为什么平移在前端做（而不是原生 mouseDown）】
//   B1 曾在原生侧接 mouseDown，但 GL 视图是 `addSubview ... NSWindowBelow` 挂的
//   （在所有兄弟视图最下面），而 webview 铺满 contentView ⇒ 真实点击全被 webview 吃掉，
//   那个回调**一次都不会触发**。`#canvas` 是真实 DOM 元素、有真实几何，
//   pointer 事件直接在这里处理最简单也最可靠。
//
// 【为什么不持久化 pan】平移是"看哪里"的一次性手势，不是工作区偏好；
//   重启后仍旧居中才符合预期（缩放会持久化，因为它代表"看多大"）。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { clampZoom } from '../useWorkspaceState'   // 与工具栏/快捷键共用同一份缩放语义

/** 首帧尺寸（`stats` 里来的设备宽高；0 = 还没收到）。 */
export interface FrameSize {
  width: number
  height: number
}

export interface StageGeometry {
  /** 舞台（可用区域）尺寸，px */
  stageBox: Ref<{ w: number; h: number }>
  /** 设备宽高比；0 = 还没收到首帧（占满舞台，与旧行为一致） */
  devAspect: ComputedRef<number>
  /** 平移量（px） */
  pan: Ref<{ x: number; y: number }>
  /** 屏幕实际尺寸（px）：contain 适配 × 缩放。`0` = 还没量到舞台 */
  screenSize: ComputedRef<{ w: number; h: number }>
  /** 平移上限（屏幕比舞台大才允许移动） */
  panLimit: () => { x: number; y: number }
  /** 把平移量夹进合法范围 */
  clampPan: (p: { x: number; y: number }) => { x: number; y: number }
  /** 屏幕的 style（size + transform） */
  screenStyle: ComputedRef<Record<string, string>>
  /** 缩放百分比标签 */
  zoomLabel: ComputedRef<string>
  /** 设缩放（并夹住平移 + 让原生矩形跟随） */
  setZoom: (z: number, after?: () => void) => void
}

/**
 * @param stats 设备首帧尺寸（响应式；未收到时为 null）
 * @param zoom  缩放倍率（由工作区状态持有，本 composable 只读写它）
 */
export function useStageGeometry(
  stats: Ref<FrameSize | null>,
  zoom: Ref<number>,
): StageGeometry {
  const stageBox = ref({ w: 0, h: 0 })

  const devAspect = computed(() => {
    const s = stats.value
    return s && s.width > 0 && s.height > 0 ? s.width / s.height : 0
  })

  const pan = ref({ x: 0, y: 0 })

  const screenSize = computed(() => {
    const { w, h } = stageBox.value
    if (!w || !h) return { w: 0, h: 0 }
    const ar = devAspect.value
    if (!ar) return { w, h }
    const fitW = Math.min(w, h * ar) * zoom.value
    return { w: fitW, h: fitW / ar }
  })

  /** 平移上限：屏幕比舞台大才允许移动，且最多把边缘拖到舞台边缘（图像查看器的常规手感） */
  function panLimit(): { x: number; y: number } {
    const st = stageBox.value
    const s = screenSize.value
    return { x: Math.max(0, (s.w - st.w) / 2), y: Math.max(0, (s.h - st.h) / 2) }
  }

  function clampPan(p: { x: number; y: number }): { x: number; y: number } {
    const l = panLimit()
    return { x: Math.max(-l.x, Math.min(l.x, p.x)), y: Math.max(-l.y, Math.min(l.y, p.y)) }
  }

  const screenStyle = computed(() => {
    const { w, h } = screenSize.value
    // contain：两轴同一缩放 ⇒ 等比。**只 round 算式不 round 结果**（保留两位小数），
    // 否则 w/h 各自取整会把比例拧出最多 1px 的误差，等比判据就变得可疑。
    const size = w
      ? { width: `${w.toFixed(2)}px`, height: `${h.toFixed(2)}px` }
      : { width: '100%', height: '100%' }
    // 平移用 transform：不改布局 ⇒ `.screen` 仍是 flex 居中的那个元素，
    // 而 getBoundingClientRect **含 transform** ⇒ 原生矩形自动跟随。
    return { ...size, transform: `translate(${pan.value.x}px, ${pan.value.y}px)` }
  })

  const zoomLabel = computed(() =>
    Math.abs(zoom.value - 1) < 0.001 ? '适应' : `${Math.round(zoom.value * 100)}%`,
  )

  function setZoom(z: number, after?: () => void): void {
    zoom.value = clampZoom(z)
    pan.value = clampPan(pan.value)
    after?.()
  }

  return { stageBox, devAspect, pan, screenSize, panLimit, clampPan, screenStyle, zoomLabel, setZoom }
}
