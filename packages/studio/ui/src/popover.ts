// ui/src/popover.ts —— **面板弹出模型**（决策 #1482 · #1483）
//
// 【为什么需要它】用户的批评很准："正常面板是**紧挨着触发入口**弹出才对"。
//   在此之前每个浮层各算各的位置：
//     · 悬停卡：自己算 `right + 8`（`FileHoverCard.pos`）
//     · 结构面板：**固定在右上角**（`top:88px; right:24px`）—— 与触发入口毫无关系
//   结果就是用户看到的：面板飞到角上、原来的卡片还自动关了，"整套逻辑是分离的"。
//
// 【本文件只做两件事】
//   ① `placeBeside`：给定**触发元素矩形**与面板尺寸，算出面板该放哪；
//   ② `useAnchoredPopover`：把"位置 + 视口内最大高度 + 实测高度"打包成一组状态。
//   所有浮层都必须走这里 —— 位置规则只留一份实现，否则第三次做面板时又会各写一套。
//
// 【四条硬约束（㊿o / ㊿p 各验两条）】
//   ① **紧挨**：横向间距恒为 `POPOVER_GAP`，不随面板类型变化；
//   ② **不遮挡触发入口**：优先放右侧；右侧放不下就翻到左侧，**不压在上面**；
//   ③ **级联同向**：子面板的锚点是**父面板的矩形**，不是父面板里的某一行；
//   ④ **不穿出可用区域**：底边扣掉状态栏（`usableBottom`），高度不够就内部滚动。
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export const POPOVER_GAP = 8

export interface AnchorRect {
  top: number
  left: number
  right: number
}

export interface PopoverPos {
  left: number
  top: number
  /** 实际落在锚点的哪一侧 —— 判据用它证明"翻边"发生了，而不是靠肉眼看 */
  side: 'right' | 'left'
}

/**
 * 视口里**真正可用**的底边（决策 #1483）。
 *
 * 【为什么不能用 `window.innerHeight`】底部状态栏（`.status`）是 shell 的一部分、
 *   24px 高、在 grid 流里；而浮层是 `position: fixed`、相对**视口**定位 ——
 *   于是面板会一直排到窗口最底下，**压在状态栏上 / 穿出窗口底部**。
 *   用户原话："没有考虑到被下面窗口遮挡的问题"。
 * ★运行时读它的真实高度，不写死 24px：状态栏以后加内容不必再改这里。
 */
export function usableBottom(): number {
  const st = document.querySelector('.status')
  const h = st ? st.getBoundingClientRect().height : 0
  return window.innerHeight - h
}

/**
 * 把面板放在锚点旁边。
 * @param anchor 触发元素（或父面板）的视口矩形
 * @param size   面板尺寸；高度用**估算值**即可（真实高度由 `useAnchoredPopover` 实测后修正）
 */
export function placeBeside(
  anchor: AnchorRect,
  size: { w: number; h: number },
  gap = POPOVER_GAP,
): PopoverPos {
  const vw = window.innerWidth
  const bottom = usableBottom()

  let side: 'right' | 'left' = 'right'
  let left = anchor.right + gap
  if (left + size.w > vw - gap) {
    side = 'left'
    left = Math.max(gap, anchor.left - gap - size.w)
  }
  /* 垂直：默认与锚点顶对齐（视线不用跳），底部放不下就整体上移，最小留 gap */
  const top = Math.max(gap, Math.min(anchor.top, bottom - size.h - gap))
  return { left, top, side }
}

/**
 * 锚定浮层的**通用状态**：位置 + 视口内的最大高度。
 *
 * 【★为什么必须实测高度】`placeBeside` 只能拿到**估算**高度（卡片 140、清单 420），
 *   而真实内容可能高得多 ⇒ 估算偏小就从窗口底部穿出去（`max-height: 70vh` 也没把
 *   状态栏算进去）。这里用 `ResizeObserver` 量真实高度回灌，并给出
 *   `maxH = 可用底边 - top`，让面板自己带滚动条而不是溢出。
 */
export function useAnchoredPopover(anchor: Ref<AnchorRect | null>, w: number, estH: number) {
  const el = ref<HTMLElement | null>(null)
  const h = ref(estH)
  const vh = ref(window.innerHeight)

  /* ★`void vh.value` 不是废话：`usableBottom()` / `innerWidth` 是**命令式读取**的，
     不是响应式的。不加这一行，窗口缩放后 computed 不会重算 —— 面板会保持旧位置，
     于是"缩小窗口被底部裁掉"这个 bug 依然存在（门禁 ㊿p 就是这么抓到的）。 */
  const pos = computed(() => {
    void vh.value
    return placeBeside(anchor.value, { w, h: h.value })
  })
  const maxH = computed(() => {
    void vh.value
    return Math.max(160, usableBottom() - pos.value.top - POPOVER_GAP)
  })

  let ro: ResizeObserver | null = null
  const measure = () => {
    const r = el.value?.getBoundingClientRect()
    /* 只在量到真实高度时回灌：0 会被当成"没内容"，让 top 跳回 anchor.top */
    if (r && r.height > 1) h.value = r.height
  }
  const onResize = () => {
    vh.value = window.innerHeight
    measure()
  }

  onMounted(() => {
    window.addEventListener('resize', onResize)
    ro = new ResizeObserver(measure)
    if (el.value) ro.observe(el.value)
    measure()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    ro?.disconnect()
  })
  /* 换文件/换行后内容也会换 ⇒ 重新量一次 */
  watch(anchor, () => requestAnimationFrame(measure))

  return { el, pos, maxH }
}
