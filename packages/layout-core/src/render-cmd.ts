// packages/layout-core/src/render-cmd.ts
// ★★M1-4：**平台无关绘制指令流**（RenderCmd）。
//
// 定位（计划 §5.1 `render/` 模块）：树 + 几何 + 绘制属性 → **线性指令流**。
// 平台层（M2 起：Android Canvas / iOS CALayer / 鸿蒙 ArkUI）只需顺序消费本流，
// 不做任何布局计算、不做任何样式解析。
//
// ★为什么是指令流而不是「让平台去遍历树」：
//   ① **跨端一致性**：指令流是唯一语义载体，三端消费同一份 → 差异只在「怎么画一条指令」
//   ② **拍平天然落地**：拍平 = 被拍平子树**不产生指令**，其绘制并入最近祖先的指令
//      （§12.3 硬性规则：复用父级 backing store，**不得新建合成位图**）
//   ③ **可测**：指令流是纯数据 → 快照/对拍/差分回归（M1-5 出口条件）
//
// ★拍平的正确性边界（M0 已判定，本层只执行）：
//   `flattenEligible` 为真的节点不产生独立绘制指令——其几何仍参与布局（父级排布需要它），
//   但绘制并入最近**未被拍平**的祖先。若该祖先不存在（整棵树都可拍平），退化为正常发指令。
//
// ★坐标系：指令携带**绝对坐标**（布局结果已是绝对值）——平台层零换算。
import type { LayoutNode } from './types'
import type { PaintInfo } from './from-pnode'
import { paintInfoOf } from './from-pnode'

/** 绘制指令种类（M1 三种：够 M2 的 view/text/image 最小闭环） */
export type RenderCmdKind =
  | 'background' // 纯色/渐变背景（isPureBackground → 平台走 backgroundColor 通道，**不分配 backing store**）
  | 'text' // 文本绘制（平台文本栈光栅化）
  | 'image' // 图片（shareableContent → 走 contents 共享内存）
  | 'border' // 描边
  | 'pushClip' // 裁剪区开始（overflow: hidden/scroll）
  | 'popClip' // 裁剪区结束

/** 单条绘制指令（纯数据——可序列化、可快照） */
export interface RenderCmd {
  kind: RenderCmdKind
  /** 源节点 id（回溯用；拍平节点为被并入的祖先 id） */
  nodeId: number
  /** **绝对坐标**（父链偏移已累加） */
  x: number
  y: number
  width: number
  height: number
  /** 背景色（background 指令） */
  color?: string
  /** 渐变（background 指令——与 color 二选一） */
  gradient?: string
  /** 文本内容与样式（text 指令） */
  text?: string
  fontSize?: number
  fontWeight?: number | 'normal' | 'bold'
  lineHeight?: number
  color_?: string
  textAlign?: string
  /** 圆角（border/background 指令） */
  borderRadius?: [number, number, number, number]
  borderWidth?: [number, number, number, number]
  borderColor?: string
  /** 绘制提示透传（平台决定 backing store 策略——**编译期推导，运行时零判断**） */
  hint: {
    isMonochrome: boolean
    isPureBackground: boolean
    staticSubtree: boolean
    needsCompositingLayer: boolean
    shareableContent?: string
  }
  /** 该指令并入的节点（拍平结果：非空表示来自被拍平子树） */
  mergedFrom?: number[]
  /** 次序（同 z 平面内的绘制顺序 = 树形顺序；平台按序消费） */
  seq: number
}

/** 指令流生成结果 */
export interface RenderCmdList {
  cmds: RenderCmd[]
  stats: {
    /** 产出的指令数 */
    cmdCount: number
    /** 被拍平的节点数（不产出指令） */
    flattenedCount: number
    /** 因拍平被并入的绘制数（M1 内存专项的验证读数） */
    mergedCount: number
    /** 生成耗时（ms） */
    elapsedMs: number
    /** ★视口裁剪：跳过的绘制指令数（0 = 没裁到东西；见 `EmitOptions.cullToViewport`） */
    culledCount?: number
    /** ★视口裁剪：整棵子树在视口外而提前返回的次数 */
    culledSubtrees?: number
  }
}

export interface EmitOptions {
  /** 视口尺寸（pushClip 与平台根容器用——不影响指令坐标：坐标已是绝对） */
  viewportWidth?: number
  viewportHeight?: number
  /**
   * ★★**视口裁剪（overdraw culling）开关**（2026-09-29，卡 I5）
   *
   * 【默认关闭——为什么】既有路径（`V6`/`V11`/真机验收）都建立在"全量 emit"上；
   *   默认开启会**静默改变**这些读数的语义。⇒ 显式 opt-in，便于 A/B 对照。
   *
   * 【为什么能裁剪（架构红利）】指令携带**绝对坐标**（见文件头）⇒ 判定"是否在视口内"
   *   就是一次坐标比较，**无需维护变换栈**、无需回溯祖先。
   *
   * 【语义（必须与"拍平"一致）】视口外节点：**几何仍参与布局**（父级排布需要它），
   *   但**不 emit 绘制指令**；其子节点同样跳过（整体在视口外 ⇒ 子树必在视口外）。
   *   ★边界：`pushClip`/`popClip` 也一并跳过（否则会留下**未配对的裁剪栈**——
   *   平台侧按 push/pop 配对消费，不配对会破坏后续绘制）。
   */
  cullToViewport?: boolean
  /**
   * 视口在**内容坐标系**里的原点（滚动场景：滚到 `scrollY` 时传 `-scrollY`）。
   * 仅 `cullToViewport` 为真时生效。
   */
  viewportOffsetX?: number
  viewportOffsetY?: number
}

/**
 * 生成绘制指令流。
 * ★单次前序遍历，O(n)；每个节点最多产出 1 条合并指令（背景+边框+文本）+ 2 条裁剪指令。
 */
export function emitRenderCmds(roots: LayoutNode[], opts: EmitOptions = {}): RenderCmdList {
  const t0 = Date.now()
  const cmds: RenderCmd[] = []
  let flattenedCount = 0
  let mergedCount = 0
  let seq = 0
  // ★视口裁剪读数（见 EmitOptions.cullToViewport）：culledCount = 跳过的**绘制指令**数，
  //   culledSubtrees = 因整棵子树在视口外而**提前返回**的次数（诊断"裁到了什么"）
  let culledCount = 0
  let culledSubtrees = 0
  /** 被拍平节点归属的指令下标 → 该指令的并入清单 */
  const mergedInto = new Map<number, number[]>()

  /**
   * 当前所处的绘制上下文：`cmdIndex` = 最近一个未拍平且有绘制的祖先指令下标。
   * ★拍平的正确语义就是「绘制并入这个下标」，故无需新建位图（§12.3 硬性规则）。
   */
  interface Ctx {
    cmdIndex: number | undefined
  }

  const walk = (node: LayoutNode, ox: number, oy: number, parent: Ctx): void => {
    // display:none → 无盒且不绘制（CSS：元素不生成盒子，也不产生任何绘制指令）
    if (node.display === 'none') return
    const info = paintInfoOf(node)
    const r = node.rect ?? { x: 0, y: 0, width: 0, height: 0 }
    // ★rect 是**父内容盒相对坐标**；绝对坐标 = 父绝对原点 + 自身相对坐标
    const abs = { x: ox + r.x, y: oy + r.y, width: r.width, height: r.height }

    // ★★视口裁剪（卡 I5）：整棵子树都在视口外 ⇒ **不 emit 任何指令**（含 push/popClip）
    //
    // 【为什么能提前返回（正确性）】子节点坐标是父的**相对偏移**（`abs.x + padding.left`
    //   或 absolute 用 `abs.x`）⇒ 子节点的绝对包围盒**必然落在父包围盒的扩展内**吗？
    //   ⚠ **不必然**：`position: absolute` 子级可溢出父盒（甚至为负）。故提前返回的判据
    //   必须用**父盒与视口不相交**——溢出子级在父盒外，但那时父盒若在视口外，
    //   溢出部分也**可能**在视口内（如父在视口下方 100px、absolute 子 -200px 上移）。
    //   ⇒ 为**不误裁**，提前返回只在 `node.position !== 'absolute'` 的**普通流**子树上做；
    //     absolute 子级仍逐个判定（代价小、正确性优先——本仓纪律：宁可少裁不可误裁）。
    const cull = opts.cullToViewport === true
    const vx0 = (opts.viewportOffsetX ?? 0)
    const vy0 = (opts.viewportOffsetY ?? 0)
    const vw = opts.viewportWidth ?? Infinity
    const vh = opts.viewportHeight ?? Infinity
    if (cull) {
      // ★★★边界口径：用**严格不重叠**判定（`<` / `>`），**不用 `<=` / `>=`**
      //
      // 【为什么（本仓实测抓到的真 bug）】用 `<=` 时，"盒子底边正好等于视口顶边"
      //   （如 y=-50, h=50 ⇒ 底边 0，视口从 0 开始）会被判成"在视口外"而**裁掉**——
      //   几何上它是**贴着视口边界**的元素（可能是 1px 描边、分隔线、阴影），
      //   裁掉就是**可见内容消失**。浮点布局下"恰好贴边"很常见（对齐/负 margin/absolute 定位）。
      //   ⇒ 保守取严格不等式：**宁可多留一条指令，不可误裁可见内容**
      //     （与卡 I5"省"的目标不冲突：真正在视口外的元素仍被裁）。
      const outside = abs.x + abs.width < vx0 || abs.y + abs.height < vy0
        || abs.x > vx0 + vw || abs.y > vy0 + vh
      if (outside) {
        // 整个节点（含其普通流子树）在视口外。
        // ★absolute 后代必须继续走（它们相对**祖先**定位，可能移回视口内）——
        //   所以这里**不直接 return**，而是标记 `culled`：自身不绘制、也不下钻普通流子节点，
        //   但仍遍历 absolute 子级。为简洁与正确性，实现为「跳过自身绘制 + 只下钻 absolute 子级」。
        culledSubtrees++
        culledCount += 1
        for (const child of node.children) {
          if (child.position === 'absolute') walk(child, abs.x, abs.y, parent)
        }
        return
      }
    }
    const paintable = info !== undefined && hasPaint(info)

    let self: Ctx
    if (node.flattenEligible && parent.cmdIndex !== undefined) {
      // ── 拍平：不产生指令，绘制并入最近绘画祖先（几何仍参与布局——父级排布依赖它）
      flattenedCount++
      if (paintable) {
        mergedCount++
        const list = mergedInto.get(parent.cmdIndex) ?? []
        list.push(node.id)
        mergedInto.set(parent.cmdIndex, list)
      }
      self = parent
    } else if (paintable) {
      const cmd = buildCmd(node, info, abs, seq++)
      if (cmd) {
        cmds.push(cmd)
        self = { cmdIndex: cmds.length - 1 }
      } else {
        self = { cmdIndex: parent.cmdIndex }
      }
    } else {
      self = { cmdIndex: parent.cmdIndex }
    }

    // ── 裁剪：overflow 非 visible 产生 push/popClip（M3 生效；M1 如实产出以便对拍）
    const clipped = node.overflow === 'hidden' || node.overflow === 'scroll' || node.overflow === 'auto'
    if (clipped) {
      cmds.push({ ...frame(node, abs, seq++), kind: 'pushClip', hint: emptyHint() })
      self = { cmdIndex: undefined } // 裁剪内不允许并入外部指令（否则绘制会落到裁剪区外）
    }

    for (const child of node.children) {
      // 子级坐标原点 = 父**内容盒**左上（padding 之内）——与 solveLayout.apply 同规则；
      // absolute 子级以父 padding 盒为基准（CSS containing block）
      const isAbs = child.position === 'absolute'
      walk(child, isAbs ? abs.x : abs.x + node.padding.left, isAbs ? abs.y : abs.y + node.padding.top, self)
    }

    if (clipped) cmds.push({ ...frame(node, abs, seq++), kind: 'popClip', hint: emptyHint() })
  }

  for (const root of roots) walk(root, 0, 0, { cmdIndex: undefined })

  // 并入清单回填（拍平结果的**可验证读数**：M1 内存专项据此确认「真拍平」）
  for (const [idx, ids] of mergedInto) {
    const cmd = cmds[idx]
    if (cmd) cmd.mergedFrom = ids
  }

  return {
    cmds,
    stats: {
      cmdCount: cmds.length,
      flattenedCount,
      mergedCount,
      elapsedMs: Date.now() - t0,
      // ★裁剪读数（判据用：0 表示没裁掉任何东西 ⇒ 要么视口覆盖全树、要么开关没生效）
      culledCount,
      culledSubtrees,
    },
  }
}

/** 是否有可绘制内容（无内容 → 不产出指令，避免平台空转） */
function hasPaint(info: PaintInfo): boolean {
  if (info.kind === 'text' && info.literal) return true
  if (info.kind === 'image') return true
  if (info.paint.backgroundColor ?? info.paint.backgroundImage) return true
  if (info.paint.borderWidth && Object.values(info.paint.borderWidth).some((v) => v)) return true
  return false
}

function emptyHint(): RenderCmd['hint'] {
  return { isMonochrome: false, isPureBackground: false, staticSubtree: false, needsCompositingLayer: false }
}

function frame(node: LayoutNode, abs: { x: number; y: number; width: number; height: number }, seq: number) {
  return { nodeId: node.id, x: abs.x, y: abs.y, width: abs.width, height: abs.height, seq }
}

/** 构建单条绘制指令（背景 + 边框 + 文本/图片合并为一条——平台按字段分派） */
function buildCmd(
  node: LayoutNode,
  info: PaintInfo,
  abs: { x: number; y: number; width: number; height: number },
  seq: number,
): RenderCmd | undefined {
  const p = info.paint
  const hint = info.hint
  const kind: RenderCmdKind = info.kind === 'text' ? 'text' : info.kind === 'image' ? 'image' : 'background'
  const br = p.borderRadius
  const bw = p.borderWidth
  const num = (v: unknown): number => {
    if (typeof v === 'number') return v
    if (v && typeof v === 'object' && (v as { kind?: string }).kind === 'absolute') return (v as { dp: number }).dp
    return 0
  }
  return {
    kind,
    nodeId: node.id,
    x: abs.x,
    y: abs.y,
    width: abs.width,
    height: abs.height,
    color: p.backgroundColor,
    gradient: p.backgroundImage,
    text: info.literal,
    fontSize: num(info.text?.fontSize),
    fontWeight: info.text?.fontWeight,
    lineHeight: typeof info.text?.lineHeight === 'number' ? info.text.lineHeight : num(info.text?.lineHeight),
    color_: info.text?.color,
    textAlign: info.text?.textAlign,
    borderRadius: br ? [num(br.top), num(br.right), num(br.bottom), num(br.left)] : undefined,
    borderWidth: bw ? [num(bw.top), num(bw.right), num(bw.bottom), num(bw.left)] : undefined,
    borderColor: p.borderColor,
    hint: {
      isMonochrome: hint.isMonochrome,
      isPureBackground: hint.isPureBackground,
      staticSubtree: hint.staticSubtree,
      needsCompositingLayer: hint.needsCompositingLayer,
      shareableContent: hint.shareableContent,
    },
    seq,
  }
}

/** 指令流 → 文本快照（差分回归 / `proteus explain --cmds` / AI Agent 读取） */
export function formatRenderCmds(list: RenderCmdList): string {
  const lines: string[] = []
  lines.push(`绘制指令流：${list.stats.cmdCount} 条（拍平 ${list.stats.flattenedCount} 节点 · 并入绘制 ${list.stats.mergedCount}）`)
  for (const c of list.cmds) {
    const box = `${c.width}×${c.height}@(${c.x},${c.y})`
    const tags: string[] = []
    if (c.hint.isPureBackground) tags.push('纯背景')
    if (c.hint.isMonochrome) tags.push('单色')
    if (c.hint.staticSubtree) tags.push('静态')
    if (c.hint.needsCompositingLayer) tags.push('合成层')
    if (c.mergedFrom?.length) tags.push(`并入${c.mergedFrom.length}`)
    const detail =
      c.kind === 'text'
        ? `"${(c.text ?? '').slice(0, 24)}" ${c.fontSize ?? '?'}dp/${c.color_ ?? '?'}`
        : c.kind === 'image'
          ? `${c.hint.shareableContent ?? '无资源 id'}`
          : `${c.color ?? c.gradient ?? ''}`
    lines.push(`  #${c.seq} ${c.kind.padEnd(10)} node#${c.nodeId} ${box.padEnd(22)} ${detail}${tags.length ? ' [' + tags.join(' ') + ']' : ''}`)
  }
  return lines.join('\n')
}
