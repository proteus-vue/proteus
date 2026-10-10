// packages/slot-runtime/src/anim-trigger.ts —— ★★★**数据变化 → 播放动画**的共享触发逻辑
//
// 【这一层解决什么（"跳变驱动动画"的最后一环）】
//   组件侧把两种"该播一次动画"的时机都折进了编译产物（纯 JSON，端上不执行 script）：
//     · **`<Transition>`**：节点上有 `transition` 声明（enter/leave 通道）；时机 = 该节点**可见性翻转**
//       （`v-show`）——运行期 `VaporRuntime.takeVisibilityChanges()` 给出变化集；
//     · **`v-animate` 指令**：节点上有 `directives`（预设 → 通道已在**编译期**解析）；时机 = 指令的
//       **值表达式变化**（或首评 truthy，对齐 Vue 自定义指令的 mounted/updated）。
//   ⇒ 本模块把"**变化集/值 → 一组待播动画**"这段纯逻辑收敛成**一处实现**，供两条消费者共用：
//     · App 壳运行期（`packages/render-backend/src/screen-runtime.ts`）——**生产路径**；
//     · 验收装置桥（`hosts/android/bridge/entry-vapor.ts`）——判据驱动路径。
//   ★"同一语义一处实现"是本仓纪律（此前只有装置桥有这段，App 壳**从未播过** ⇒ 数据跳变不驱动动画）。
//
// 【诚实边界】通道规格（kind/from/to/durMs/curve）全部来自编译产物；本模块**不跳帧、不碰内核**——
//   它只产出"该播哪些"，实际播放（内核 `anim_start` + 宿主帧循环）由消费方经 `animStart` 出口完成。
import type { LayoutNode } from './layout-template'
import { evalExpr, type ExprProgram, type ExprContext } from './expr'
import { directiveShouldPlay } from './directives'

/** 一条待播动画（与宿主 `animStart` 的 `anims[]` 逐字段同形——好直接交宿主） */
export interface PendingAnim {
  nodeId: number
  /** 内核 `AnimKind`（0 TranslateX / 1 TranslateY / 2 Scale / 3 Rotate / 4 Opacity / …） */
  kind: number
  from: number
  to: number
  durMs: number
  curve: number
}

/**
 * ★★**可见性变化 → 过渡动画通道**（`<Transition>`）。
 *
 * @param nodes   模板节点（`LayoutTemplate.nodes`）——据 `nodeId` 查 `transition` 声明
 * @param changes 运行期可见性变化集（`VaporRuntime.takeVisibilityChanges()`）
 * @returns 待播动画（无声明 / 空变化 ⇒ 空数组）
 */
export function collectTransitionAnims(
  nodes: readonly LayoutNode[],
  changes: ReadonlyArray<{ nodeId: number; visible: boolean }>,
): PendingAnim[] {
  if (changes.length === 0) return []
  const anims: PendingAnim[] = []
  for (const ch of changes) {
    const tr = nodes.find((n) => n.id === ch.nodeId)?.transition
    if (!tr) continue // 无过渡声明 ⇒ 只有可见性切换（正常路径，不记 note）
    const channels = ch.visible ? tr.enter : tr.leave
    for (const c of channels) {
      anims.push({ nodeId: ch.nodeId, kind: c.kind, from: c.from, to: c.to, durMs: tr.durMs, curve: tr.curve })
    }
  }
  return anims
}

/** 指令触发状态（`nodeId:name` → 上一次的值 + 是否已见过）——**由调用方持有**（跨数据变更保持） */
export interface DirectiveTriggerState {
  prev: unknown
  seen: boolean
}

/**
 * ★★**指令值变化 → 动画通道**（`v-animate`）。
 *
 * 时机由 `directiveShouldPlay`（对齐 Vue 自定义指令 mounted/updated）判定：首评 truthy ⇒ 播（mounted）；
 *   之后值变化且当前值 truthy ⇒ 播（updated）。falsy 一律不播。
 *
 * @param nodes 模板节点（据 `directives` 声明）
 * @param read  数据源读取（指令的值表达式求值上下文）
 * @param state **由调用方持有**的触发状态表（键 `${nodeId}:${name}`）——本函数就地更新它
 * @returns 本轮该播的动画（空 ⇒ 无）
 */
export function collectDirectiveAnims(
  nodes: readonly LayoutNode[],
  read: (name: string) => unknown,
  state: Map<string, DirectiveTriggerState>,
): PendingAnim[] {
  const anims: PendingAnim[] = []
  const ctx: ExprContext = { read }
  for (const n of nodes) {
    const dirs = n.directives
    if (!dirs || dirs.length === 0) continue
    for (const d of dirs) {
      // 值求值：有 `value` 表达式 ⇒ 求值；无（恒真）⇒ true（首评即播，mounted 语义）
      const cur = d.value ? evalExpr(d.value as ExprProgram, ctx) : true
      const key = `${n.id}:${d.name}`
      const st = state.get(key)
      const should = directiveShouldPlay(st?.prev, cur, st?.seen ?? false)
      state.set(key, { prev: cur, seen: true })
      if (!should) continue
      const channels = d.channels ?? []
      for (const c of channels) {
        anims.push({ nodeId: n.id, kind: c.kind, from: c.from, to: c.to, durMs: d.durMs ?? 220, curve: d.curve ?? 1 })
      }
    }
  }
  return anims
}
