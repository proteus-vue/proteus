// packages/renderer-app/src/adapters/selfdraw.ts
// ★★自绘管线适配器：Vue 渲染树 → **排版核心的布局请求**（供 Rust 核心算几何，宿主自绘）。
//
// 【它补的是哪一环】（本仓 2026-09-29 核实的架构缺口）
//   此前有两条**互不相连**的链路：
//     · `hosts/ios/bridge/entry.ts`：Vue → render-backend → NativeBackend → **UIView 树**
//       （注释明写「布局交给 UIKit 缺省——本步不实现 flex/grid 求解」）
//     · Rust 排版核心：**手写 JSON** → 几何 → Canvas / CALayer
//   两条都能跑，但「Vue 渲染 → 自绘管线」**一次都没接上过**。
//   本文件就是那个接头：Vue 的 diff 结果（NativeElementNode 树）→ 引擎就绪的布局请求。
//
// 【★为什么请求里是「数值」而不是 CSS 字符串】
//   CSS Profile §8.3 要求「运行时零解析」：样式字符串 → 数值的折叠是**编译期**的职责。
//   本适配器是**验证用脚手架**（尚未接入编译器），故在此做一次折叠——
//   但**只认已折叠形态**：`width: 100`（数值）/ `width: '50%'`（比例）/ 已解析的 px 字符串。
//   不实现 em/rem/vw/calc 等需要上下文才能解析的单位（那是编译期的事，见 W-CSS 规则）。
//   ⇒ 诚实边界：本文件不是编译期折叠的替代品，而是它的**消费端形状示范**。
import type { NativeAdapter, NativeNode, NativeTextNode, NativeElementNode, NativeCommentNode } from '../native'

/* ────────────────────────── 布局请求（与 Rust `LayoutRequest` DTO 逐字段对应） ────────────────────────── */

export interface SelfDrawEdges {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

/** 一个节点的布局规格（引擎就绪：全是数值 / 比例 / 枚举字符串） */
export interface SelfDrawNodeSpec {
  id: number
  parentId: number | null
  width?: number
  height?: number
  /** 百分比（基准 = 父内容盒；由求解器解析，适配层拿不到父尺寸） */
  widthRatio?: number
  heightRatio?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  margin?: SelfDrawEdges
  padding?: SelfDrawEdges
  flexDirection?: string
  justifyContent?: string
  alignItems?: string
  alignSelf?: string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number
  gap?: number
  display?: string
  position?: string
  top?: number
  left?: number
  overflow?: string
  /** 文本字面量（有它即文本叶子；度量由宿主注入） */
  text?: string
  /** 绘制用：背景色（FFRRGGBB 或 #RRGGBB） */
  backgroundColor?: string
  /** 绘制用：文字颜色 */
  color?: string
  /** 绘制用：字号 */
  fontSize?: number
  /** 绘制用：圆角 */
  borderRadius?: number
}

export interface SelfDrawRequest {
  viewport: { width: number; height: number }
  nodes: SelfDrawNodeSpec[]
  /** 文本度量（节点 id → 尺寸）——由平台注入（iOS CoreText / Android StaticLayout） */
  textMeasures?: Record<string, { width: number; height: number }>
}

/* ────────────────────────── 适配器 ────────────────────────── */

export interface SelfDrawAdapter extends NativeAdapter {
  /** 渲染容器（mount 目标） */
  root: NativeElementNode
  /** 把当前树转成布局请求（每次 mount/update 后由宿主边界调用） */
  toRequest(viewport: { width: number; height: number }): SelfDrawRequest
  /** 本次会话内累计的 patchProp 次数（★JS 逻辑层的边界成本读数） */
  patchCount(): number
  /** 累计创建的元素/文本节点数（诊断：确认 diff 复用而非重建） */
  createdCount(): { elements: number; texts: number }
  /** 重置统计（每次测量前调用） */
  resetStats(): void
}

/** 绘制相关的键（**不进布局核心**——核心只管几何；绘制由宿主的指令流消费） */
const PAINT_KEYS = new Set(['backgroundColor', 'color', 'fontSize', 'borderRadius', 'borderColor', 'borderWidth', 'opacity'])

/** 布局相关的键（进核心；其余键既非布局也非绘制 → 忽略并计数，便于发现「静默丢失」） */
const LAYOUT_KEYS = new Set([
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'margin', 'padding', 'flexDirection', 'justifyContent', 'alignItems', 'alignSelf',
  'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'display', 'position', 'top', 'left', 'overflow',
])

/**
 * 数值折叠：把 Vue 模板里可能出现的几种形态折叠为**数值或比例**。
 *
 * 接受的形态（其余返回 undefined 并**在 stats 里计数**，不静默吞掉）：
 *   · `100` / `100.5`        → 数值
 *   · `'100px'` / `'100'`    → 数值
 *   · `'50%'`                → `{ ratio: 0.5 }`
 * ★不接受的形态（需上下文，属编译期职责）：em / rem / vw / vh / calc / auto / 关键字
 */
export function foldLength(v: unknown): { dp: number } | { ratio: number } | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? { dp: v } : undefined
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  const pct = /^(-?[\d.]+)%$/.exec(s)
  if (pct) {
    const n = Number(pct[1])
    return Number.isFinite(n) ? { ratio: n / 100 } : undefined
  }
  const px = /^(-?[\d.]+)(px)?$/.exec(s)
  if (px) {
    const n = Number(px[1])
    return Number.isFinite(n) ? { dp: n } : undefined
  }
  return undefined
}

/** 边值折叠（margin/padding：数值或 {top,right,bottom,left}） */
function foldEdges(v: unknown): SelfDrawEdges | undefined {
  if (typeof v === 'number' || typeof v === 'string') {
    const one = foldLength(v)
    if (!one || !('dp' in one)) return undefined
    return { top: one.dp, right: one.dp, bottom: one.dp, left: one.dp }
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const out: SelfDrawEdges = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const f = foldLength(o[side])
      if (f && 'dp' in f) out[side] = f.dp
    }
    return out
  }
  return undefined
}

/**
 * 创建自绘适配器。
 *
 * 【与 mock 适配器的关系】节点树语义相同（都用 `NativeElementNode`），
 *   但本适配器额外：① 记录绘制属性（供自绘指令流）② 能把树转成布局请求 ③ 统计边界成本。
 */
export function createSelfDrawAdapter(): SelfDrawAdapter {
  const root: NativeElementNode = { __kind: 'element', tag: 'root', props: {}, children: [], parent: null }
  let elements = 0
  let texts = 0
  let patches = 0
  /** ★未知键计数：既不属布局也不属绘制 —— 必须可观测（否则「写了没生效」无从定位） */
  const unknownKeys = new Map<string, number>()

  const parentNodeOf = (node: NativeNode): NativeElementNode | null =>
    node.__kind === 'element' ? node.parent : null

  /** 拍平遍历：跳过注释节点（Vue 用注释占位，原生无对应物） */
  function walk(
    node: NativeNode,
    parentId: number | null,
    viewport: { width: number; height: number },
    out: SelfDrawNodeSpec[],
    nextId: { v: number },
  ): void {
    if (node.__kind === 'comment') return          // 注释无盒（与 CSS display:none 不同：它压根不产出节点）
    const id = nextId.v++
    const spec: SelfDrawNodeSpec = { id, parentId }
    const props: Record<string, unknown> =
      node.__kind === 'element' ? node.props : {}

    if (node.__kind === 'text') {
      // ★文本叶子：字面量进 `text`，尺寸由宿主注入度量（核心不自研文本，Profile §L4）
      spec.text = node.text
      // 文本节点也可能带 style（Vue 的 `h('p-text', { style: {...} }, '文本')`）
      const tStyle = (props.style && typeof props.style === 'object' && !Array.isArray(props.style))
        ? props.style as Record<string, unknown>
        : {}
      const ls = foldLength(tStyle.lineHeight ?? props.lineHeight)
      if (ls && 'dp' in ls) spec.height = ls.dp
      out.push(spec)
      return
    }

    // ── ★★先展开嵌套的 `style` 对象（本仓既有约定）──
    //
    // 【为什么必须这一步】（本仓真机实测踩到，代价是一次「看起来完全没样式」的运行）
    //   Vue 的 `h('p-view', { style: { height: 56, ... } })` 会把**整个 style 对象**作为一个
    //   prop key 传下来（key === 'style'），而不是摊平成 height/backgroundColor 等键。
    //   初版没展开 → 所有样式都落进「未知键」桶（实测 `unknown_keys: {style: 2646}`），
    //   现象是：**文字画出来了、卡片/圆角/强调色全没有**（截图可辨但报告全绿）。
    //   ⇒ 既有 iOS 宿主（`hosts/ios/ProteusHost/main.swift:90`）同样显式展开 style——
    //     本适配器与它保持一致，避免两套约定。
    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style' && v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(flat, v as Record<string, unknown>)
      } else {
        flat[k] = v
      }
    }

    // ── 布局属性 → 引擎就绪形态 ──
    for (const [key, value] of Object.entries(flat)) {
      if (LAYOUT_KEYS.has(key)) {
        if (key === 'margin' || key === 'padding') {
          const e = foldEdges(value)
          if (e) spec[key] = e
          continue
        }
        if (key === 'width' || key === 'height' || key === 'minWidth' || key === 'maxWidth' || key === 'minHeight' || key === 'maxHeight' || key === 'flexBasis' || key === 'top' || key === 'left' || key === 'gap') {
          const f = foldLength(value)
          if (!f) continue
          if ('ratio' in f) {
            // 比例只对宽高有意义（flex-basis/gap/inset 的比例基准不同，本脚手架不支持）
            if (key === 'width' || key === 'height') {
              spec[key === 'width' ? 'widthRatio' : 'heightRatio'] = f.ratio
            }
          } else {
            spec[key] = f.dp
          }
          continue
        }
        if (key === 'flexGrow' || key === 'flexShrink') {
          if (typeof value === 'number') spec[key] = value
          continue
        }
        if (typeof value === 'string' || typeof value === 'number') {
          // 枚举类（flexDirection / justifyContent / alignItems / display / position / overflow）
          spec[key as 'flexDirection'] = value as never
          continue
        }
      }
      if (PAINT_KEYS.has(key)) {
        // 绘制属性只做透传（自绘指令流消费；**不进核心**——核心只管几何）
        if (key === 'backgroundColor' || key === 'color') {
          if (typeof value === 'string') spec[key] = value
        } else if (typeof value === 'number') {
          spec[key as 'fontSize'] = value
        } else if (typeof value === 'string') {
          const f = foldLength(value)
          if (f && 'dp' in f) spec[key as 'fontSize'] = f.dp
        }
        continue
      }
      // ★未知键：不计入布局也不计入绘制 → 记下来（验收时可断言为 0，避免「写了没生效」）
      unknownKeys.set(key, (unknownKeys.get(key) ?? 0) + 1)
    }

    out.push(spec)
    for (const child of node.children) walk(child, id, viewport, out, nextId)
  }

  return {
    root,
    createElement(tag: string): NativeElementNode {
      elements++
      return { __kind: 'element', tag, props: {}, children: [], parent: null }
    },
    createText(text: string): NativeTextNode {
      texts++
      return { __kind: 'text', text }
    },
    createComment(): NativeCommentNode {
      return { __kind: 'comment' }
    },
    setText(node: NativeTextNode, text: string): void {
      node.text = text
      patches++
    },
    setElementText(el: NativeElementNode, text: string): void {
      el.children = []
      const t = this.createText(text)
      el.children.push(t)
      patches++
    },
    insert(child: NativeNode, parent: NativeElementNode, anchor: NativeNode | null): void {
      if (child.__kind === 'element') child.parent = parent
      if (anchor === null) {
        parent.children.push(child)
      } else {
        const idx = parent.children.indexOf(anchor)
        parent.children.splice(idx < 0 ? parent.children.length : idx, 0, child)
      }
      patches++
    },
    remove(node: NativeNode): void {
      const parent = parentNodeOf(node)
      if (parent) {
        const idx = parent.children.indexOf(node)
        if (idx >= 0) parent.children.splice(idx, 1)
      }
      patches++
    },
    parentNode: parentNodeOf,
    patchProp(el: NativeElementNode, key: string, prev: unknown, next: unknown): void {
      // ★事件（onXxx）：自绘管线里事件由**核心命中测试 + 平台手势**承担，
      //   不在本适配器里落树（那需要原始指针几何，见 hit.rs）。这里只计数以便观测。
      if (key.startsWith('on')) {
        patches++
        return
      }
      if (next === null || next === undefined) delete el.props[key]
      else el.props[key] = next
      patches++
    },
    toRequest(viewport: { width: number; height: number }): SelfDrawRequest {
      const nodes: SelfDrawNodeSpec[] = []
      const nextId = { v: 1 }
      walk(root, null, viewport, nodes, nextId)
      return { viewport, nodes }
    },
    patchCount: () => patches,
    createdCount: () => ({ elements, texts }),
    resetStats: () => {
      patches = 0
      elements = 0
      texts = 0
      unknownKeys.clear()
    },
    /** 未知键清单（诊断；也可由验收断言为空） */
    unknownKeys: () => Object.fromEntries(unknownKeys),
  } as SelfDrawAdapter & { unknownKeys: () => Record<string, number> }
}
