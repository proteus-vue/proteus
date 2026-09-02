// packages/desktop/src/master-detail.ts
// ★G-24 B3（proteus-semantic-primitives-plan 01 §7 Navigation + 06 B3）：p-master-detail 纯逻辑
//   三栏（master + detail + inspector）→ UISplitViewController primary/supplementary/secondary 三列模式
//   （鸿蒙 SideBarContainer / Android SlidingPaneLayout 同理——同语义各端实现）
//   · computeSplitLayout：视口宽 → 列布局（窄：master/detail 独占切换（iOS collapse）；中：双列；宽：三列含 inspector）
//   纯函数零依赖；Web demo / 原生宿主共同消费
export type SplitColumn = 'master' | 'detail' | 'inspector'

export interface SplitLayoutOptions {
  /** 容器/视口宽度 */
  width: number
  /** detail 是否打开（窄屏时 detail 独占——iOS collapse 语义） */
  detailOpen: boolean
  /** inspector（第三栏）是否启用 */
  inspector: boolean
  /** 双列断点（master+detail 并排）；缺省 720 */
  doubleWidth?: number
  /** 三列断点（加 inspector）；缺省 1120 */
  tripleWidth?: number
}

export interface SplitLayout {
  /** 当前可见列（按序） */
  columns: SplitColumn[]
  /** 窄屏 detail 独占时是否覆盖 master（独占切换——非覆盖叠加） */
  overlay: boolean
  masterVisible: boolean
  detailVisible: boolean
  inspectorVisible: boolean
}

/** ★computeSplitLayout：宽 → 列布局（映射 UISplitViewController collapse/双列/三列） */
export function computeSplitLayout(opts: SplitLayoutOptions): SplitLayout {
  const doubleWidth = opts.doubleWidth ?? 720
  const tripleWidth = opts.tripleWidth ?? 1120
  const w = opts.width
  // 窄：单列——detailOpen → detail 独占（master 隐藏，back 回 master）；否则 master
  if (w < doubleWidth) {
    const detail = opts.detailOpen
    return {
      columns: detail ? ['detail'] : ['master'],
      overlay: false,
      masterVisible: !detail,
      detailVisible: detail,
      inspectorVisible: false,
    }
  }
  // 中：双列 master+detail（inspector 隐藏）
  if (w < tripleWidth) {
    return { columns: ['master', 'detail'], overlay: false, masterVisible: true, detailVisible: true, inspectorVisible: false }
  }
  // 宽：三列（inspector 启用时）或双列
  if (opts.inspector) {
    return { columns: ['master', 'detail', 'inspector'], overlay: false, masterVisible: true, detailVisible: true, inspectorVisible: true }
  }
  return { columns: ['master', 'detail'], overlay: false, masterVisible: true, detailVisible: true, inspectorVisible: false }
}

/** ★窄屏导航动作归一（iOS collapse 语义：select 进 detail / back 回 master） */
export type SplitNavAction = { type: 'select' } | { type: 'back' } | { type: 'toggleInspector' }

export interface SplitNavOptions {
  layout: SplitLayout
  inspectorOn: boolean
}

export interface SplitNavResult {
  /** 动作后应呈现的 detail 打开态 */
  detailOpen: boolean
  /** 动作后应呈现的 inspector 打开态 */
  inspectorOn: boolean
}

/** ★applySplitNav：窄屏 list/detail 切换与 inspector 开关的纯状态机（demo/宿主接线） */
export function applySplitNav(action: SplitNavAction, opts: SplitNavOptions): SplitNavResult {
  const singleColumn = opts.layout.columns.length <= 1
  if (action.type === 'select') {
    // 窄屏单列：select → detail 独占（iOS push）；宽屏列布局 → 保持并排可见
    return { detailOpen: singleColumn ? true : opts.layout.detailVisible, inspectorOn: opts.inspectorOn }
  }
  if (action.type === 'back') {
    // 窄屏 detail 独占 → back 回 master；宽屏 → 保持
    return { detailOpen: singleColumn ? false : opts.layout.detailVisible, inspectorOn: opts.inspectorOn }
  }
  // toggleInspector：窄屏忽略（无三列空间）；双列/三列宽可开
  if (singleColumn) return { detailOpen: opts.layout.detailVisible, inspectorOn: opts.inspectorOn }
  return { detailOpen: opts.layout.detailVisible, inspectorOn: !opts.inspectorOn }
}
