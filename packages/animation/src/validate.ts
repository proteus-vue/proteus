// packages/animation/src/validate.ts
// ★★Morpheus（MA1）—— **编译期校验**（Morpheus §5-bis.2：把"会不会掉帧"从运行时问题变成编译期问题）
//
// 【为什么要有它（§5-bis.1 的工程陷阱）】动画属性分两类：
//   · **合成属性**（translate/scale/rotate/opacity）⇒ 平台渲染线程可直接插值，主线程零参与；
//   · **非合成属性**（width/height/margin…）⇒ 触发 `requestLayout` 全链路 ⇒ **异步红利完全失效**。
//   对照 Flutter/RN：开发者不小心动了布局属性，只能靠运行时 profile 发现；
//   **本引擎在编译期拦住**（这就是"收敛"在动画领域的落点）。
//
// 【为什么不静默降级】降级成"每帧 tick"也能跑，但那是**另一种性能档位**——
//   用户以为拿到的是"平台线程动画"，实际拿到的是"主线程每帧写值" ⇒ 静默的性能降级。
//   ⇒ 必须**显式**（`ValidationIssue` 里点名属性 + 给修复建议）。
import { CURVE_ID } from './types'
import type { AnimDecl, AnimKindName, ValidationIssue } from './types'
import { parseColorToChannels } from './color'

/** 合成属性集（§5-bis.1 的分水岭；与内核 `AnimKind::is_composited` 同集合） */
export const COMPOSITED_KINDS: readonly AnimKindName[] = [
  'translateX',
  'translateY',
  'scale',
  'rotate',
  'opacity',
]

/**
 * ★★**paint-only（非合成）但受支持的属性**（2026-10-01：`color`）
 *
 * 【它与"非合成红线"的关系（这条区分很重要）】`non-composited` 检查拦的是
 *   **会触发平台布局链路**（requestLayout / 布局重算）的属性——那类属性让"平台渲染线程
 *   零参与"的收益**完全失效**，是本引擎的红线。而 `color`：
 *   · **不触发布局**（只改绘制属性 ⇒ 与 opacity 同一成本类）；
 *   · 但**也不进**平台零参与路径（Android RenderNode 的可插值集里没有背景色 ⇒
 *     若 iOS 单边放行就会两端分档）。
 *   ⇒ 它是**第三种**：paint-only 且必须走 tick 路径。故从红线里**排除**，
 *     但走 `CompiledBatch.composited=false` 如实反映（不静默当成合成）。
 */
export const PAINT_ONLY_KINDS: readonly AnimKindName[] = ['color', 'textColor']

/**
 * ★★**tick-only 的几何属性**（2026-10-01 · B 批 3D：`rotateX` / `rotateY`）
 *
 * 【与合成属性/PAINT_ONLY 的三方关系】
 *   · **合成属性**：平台渲染线程自主插值（translate/scale/rotate/opacity）——主线程零参与；
 *   · **paint-only**（color/textColor）：不触发布局，但 Android RenderNode 插不了色 ⇒ 走 tick；
 *   · **tick-only**（rotateX/rotateY）：**是几何变换**（不触发布局），但两端的平台插值器对
 *     3D 的语义不同（iOS CALayer 4×4 矩阵 vs Android rotationX/Y + Camera 组合）
 *     ⇒ 单边放行就是两端分档 ⇒ v1 统一走 **tick 路径**（跨端一致优先，与 color 同源决策）。
 *   ★实测余量：120Hz、800 节点、每帧工作 p95 2ms（预算 8.3ms）——3D 走 tick 完全在预算内。
 */
export const TICK_ONLY_KINDS: readonly AnimKindName[] = ['rotateX', 'rotateY']

/** 该属性是否 tick-only（受支持、走内核逐帧路径，但不进平台零参与） */
export function isTickOnly(kind: AnimKindName): boolean {
  return TICK_ONLY_KINDS.includes(kind)
}

/** 该属性是否合成（编译期可查——上层可在**写代码时**就得到答案） */
export function isComposited(kind: AnimKindName): boolean {
  return COMPOSITED_KINDS.includes(kind)
}

/** 该属性是否 paint-only（受支持、不触发布局，但不走平台零参与路径） */
export function isPaintOnly(kind: AnimKindName): boolean {
  return PAINT_ONLY_KINDS.includes(kind)
}

/**
 * 校验一批声明（**纯函数**，无副作用；返回问题清单，空数组 = 通过）
 *
 * 判据（每条都能指到出处、且给出可操作修复）：
 *   ① **非合成属性** ⇒ `non-composited`（§5-bis.2 红线）
 *   ② 区间非法（`to` 非有限 / `from === to` 且无 spring）
 *   ③ 曲线模式缺时长 ⇒ `missing-duration`
 *   ④ 同时给了 `curve` 与 `spring` ⇒ `conflicting-easing`（求值模式必须唯一）
 *   ⑤ 弹簧参数非法（非正刚度 / 负阻尼 / 非正质量）
 *   ⑥ 空批次
 *   ⑦ ★自定义贝塞尔非法（非 4 个数 / 非有限 / x∉[0,1]）＋ 与 `curve`/`spring`/`keyframes` 互斥
 */
/**
 * ★★**自定义贝塞尔的编译期校验**（标量/颜色两条路径共用——见 `curveBezier` 类型注释）
 *
 * 三条规则（与内核解析层**同一套**——两边都校验，任一侧漏了另一侧兜住）：
 *   ① 必须是 4 个有限数（`[x1,y1,x2,y2]`）
 *   ② `x1/x2 ∈ [0,1]`（时间轴单调；`y` 任意——回弹来源）
 *   ③ 与 `curve` / `spring` / `keyframes` **互斥**（求值模式必须唯一；段级曲线暂不支持自定义——诚实边界）
 */
function checkCurveBezier(
  d: { curveBezier?: readonly number[]; curve?: unknown; spring?: unknown; keyframes?: unknown },
  i: number,
  issues: ValidationIssue[],
): void {
  const cb = d.curveBezier
  if (cb === undefined) return
  if (!Array.isArray(cb) || cb.length !== 4) {
    issues.push({
      index: i,
      code: 'invalid-range',
      message: `\`curveBezier\` 需要 4 个控制点 [x1,y1,x2,y2]，收到 ${JSON.stringify(cb)}`,
      hint: '例：curveBezier: [0.34, 1.56, 0.64, 1]（回弹）或 [0.2, 0, 0, 1]',
    })
    return
  }
  const bad = cb.some((v) => typeof v !== 'number' || !Number.isFinite(v))
  if (bad) {
    issues.push({ index: i, code: 'invalid-range', message: `\`curveBezier\` 含非有限数：${JSON.stringify(cb)}`, hint: '给具体数值' })
    return
  }
  if (cb[0]! < 0 || cb[0]! > 1 || cb[2]! < 0 || cb[2]! > 1) {
    issues.push({
      index: i,
      code: 'invalid-range',
      message: `\`curveBezier\` 的 x1/x2 必须在 [0,1]（时间轴单调——否则给定进度求值不唯一）：x1=${cb[0]}, x2=${cb[2]}`,
      hint: 'y1/y2 可以任意（> 1 或 < 0 是回弹/预期效果）；只有 x 受限（CSS cubic-bezier 同规）',
    })
  }
  if (d.curve !== undefined) {
    issues.push({
      index: i,
      code: 'conflicting-easing',
      message: '`curveBezier` 与 `curve` 并存 —— 两处都描述缓动，必须唯一',
      hint: '删掉 `curve`（封闭集快捷名），只留 `curveBezier`',
    })
  }
  if (d.spring !== undefined) {
    issues.push({
      index: i,
      code: 'conflicting-easing',
      message: '`curveBezier` 与 `spring` 并存 —— 求值模式必须唯一',
      hint: '二选一：要物理手感用 `spring`，要确定曲线用 `curveBezier`',
    })
  }
  if (d.keyframes !== undefined) {
    issues.push({
      index: i,
      code: 'conflicting-easing',
      message: '`curveBezier` 与 `keyframes` 并存 —— 段级曲线目前只用封闭集（诚实边界）',
      hint: '删掉 `curveBezier`（多段序列里每段用 `curve` 封闭集），或改用单段 + `curveBezier`',
    })
  }
}

export function validateAnimations(decls: readonly AnimDecl[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (decls.length === 0) {
    issues.push({
      index: -1,
      code: 'empty',
      message: '动画声明为空',
      hint: '至少给一条声明；若本意是"停掉动画"，请调 stopAnimations 而不是编译空批次',
    })
    return issues
  }

  decls.forEach((d, i) => {
    // ★★**颜色声明走独立分支**（2026-10-01：`color` 底色 / `textColor` 文字色）：
    //   值为颜色字符串、形态规则与标量不同（`from` 必填 / 段终点是颜色 / `spring` 逐通道），
    //   故不与标量路径混判（混判的典型错法是拿 `Number.isFinite` 去查字符串 ⇒ 恒假 ⇒ 误报）。
    if (d.kind === 'color' || d.kind === 'textColor') {
      // 起点必填（内核无"缺省 = 当前值"语义——见 constraint/from-is-mandatory）
      if (d.from === undefined) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: '`color` 动画的 `from` 是**必填**（内核没有"缺省 = 节点当前底色"语义）',
          hint: "显式给起点，如 from: '#2f6fed'（通常取该节点的 backgroundColor）",
        })
      }
      for (const [key, val] of [
        ['from', d.from],
        ['to', d.to],
      ] as const) {
        if (val === undefined) continue
        try {
          parseColorToChannels(val as string)
        } catch (e) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `\`color\` 的 \`${key}\` 非法：${(e as Error).message}`,
            hint: "用十六进制：'#RGB' / '#RRGGBB' / '#RRGGBBAA'（CSS4 序，最后两位是 alpha）",
          })
        }
      }
      // ★★颜色序列（2026-10-01 起支持）：逐段校验（形态 / 时长 / 末段与声明 to 一致）
      //   语义与标量序列同构（"多段收敛在一条动画/每通道"，段边界精确、末段端点钉死）
      if (d.keyframes) {
        const kf = d.keyframes
        if (kf.length === 0) {
          issues.push({
            index: i,
            code: 'empty',
            message: '`keyframes` 为空数组（序列至少要一段；单段请直接用 `curve`）',
            hint: '去掉 `keyframes` 用单段声明，或补上至少一段 `{ to, durationMs }`',
          })
        }
        const sum = kf.reduce((acc, seg) => acc + (Number.isFinite(seg.durationMs) ? seg.durationMs : 0), 0)
        kf.forEach((seg, j) => {
          try {
            parseColorToChannels(seg.to)
          } catch (e) {
            issues.push({
              index: i,
              code: 'invalid-range',
              message: `颜色序列第 ${j} 段 \`to\` 非法：${(e as Error).message}`,
              hint: "每段终点都要是颜色：'#RGB' / '#RRGGBB' / '#RRGGBBAA'",
            })
          }
          if (!Number.isFinite(seg.durationMs) || seg.durationMs < 0) {
            issues.push({
              index: i,
              code: 'invalid-range',
              message: `颜色序列第 ${j} 段 \`durationMs\` 非法：${seg.durationMs}`,
              hint: '给非负毫秒数（0 = 该段瞬变，合法但通常不是本意）',
            })
          }
          if (seg.curve !== undefined && !(seg.curve in CURVE_ID)) {
            issues.push({
              index: i,
              code: 'invalid-range',
              message: `颜色序列第 ${j} 段曲线未知：${seg.curve}`,
              hint: '用 Curve 封闭集里的名字',
            })
          }
        })
        if (sum <= 0) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: '颜色序列总时长为 0 —— 动画会**瞬间跳到末段终点**',
            hint: '至少给一段正时长；零时长序列在真机上看起来就是"没做动画"',
          })
        }
        if (d.spring !== undefined) {
          issues.push({
            index: i,
            code: 'conflicting-easing',
            message: '`keyframes` 与 `spring` 并存 —— 求值模式必须唯一',
            hint: '序列里要弹性手感，把某一段用曲线近似（如 springApprox），或整条改用 spring',
          })
        }
        if (d.curve !== undefined) {
          issues.push({
            index: i,
            code: 'conflicting-easing',
            message: '`keyframes` 与 `curve` 并存 —— 段内曲线由每段自己的 `curve` 决定',
            hint: '删掉外层的 `curve`（它只对单段模式有意义）',
          })
        }
        // ★末段终点必须与声明的 `to` 一致（与标量序列同一条纪律：两处都描述"终点"）
        const last = kf[kf.length - 1]
        if (last && last.to.toLowerCase() !== d.to.toLowerCase()) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `末段 \`to\`(${last.to}) 与声明 \`to\`(${d.to}) 不一致 —— 两处都描述"终点"`,
            hint: '让二者相等（编译器以声明 `to` 为准做端点钉死，不一致会让终值与你写的不符）',
          })
        }
      }
      if (d.curve !== undefined && d.spring !== undefined) {
        issues.push({
          index: i,
          code: 'conflicting-easing',
          message: '同时声明了 `curve` 与 `spring` —— 求值模式必须唯一',
          hint: '二选一：要物理手感用 `spring`，要确定曲线用 `curve`',
        })
      }
      // 弹簧参数校验（与标量路径同规则）
      if (d.spring) {
        const s = d.spring
        const bad =
          !Number.isFinite(s.stiffness) || s.stiffness <= 0 ||
          !Number.isFinite(s.damping) || s.damping < 0 ||
          (s.mass !== undefined && (!Number.isFinite(s.mass) || s.mass <= 0))
        if (bad) {
          issues.push({
            index: i,
            code: 'invalid-spring',
            message: `弹簧参数非法：${JSON.stringify(s)}（要求 stiffness>0 · damping≥0 · mass>0）`,
            hint: '用预设（presets.easing.snappy / smooth）避免手调；内核有 10s 安全上限兜底但那是兜底不是设计',
          })
        }
      }
      // 时长/延迟/滚动窗口（与标量路径同规则）
      if (d.durationMs !== undefined && (!Number.isFinite(d.durationMs) || d.durationMs < 0)) {
        issues.push({ index: i, code: 'invalid-range', message: `\`durationMs\` 非法：${d.durationMs}`, hint: '给非负毫秒数' })
      }
      if (d.delayMs !== undefined && (!Number.isFinite(d.delayMs) || d.delayMs < 0)) {
        issues.push({ index: i, code: 'invalid-range', message: `\`delayMs\` 非法：${d.delayMs}`, hint: '给非负毫秒数' })
      }
      if (d.scroll) {
        const { from, to } = d.scroll
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `滚动窗口含非有限值：${JSON.stringify(d.scroll)}`,
            hint: '窗口两端都要是具体的滚动位置（px）',
          })
        } else if (to <= from) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `滚动窗口退化（to=${to} <= from=${from}）——进度将恒为 1，动画一开始就停在终点`,
            hint: '检查 from/to 是否写反；窗口跨度应为正数（如 from: 0, to: 120）',
          })
        }
      }
      // ★自定义贝塞尔（颜色路径同支持——四条通道共用同一曲线）
      checkCurveBezier(d, i, issues)
      // ★A2 循环（颜色路径同规则：repeat 合法性 + 与 scroll 互斥）
      {
        const dd = d as { repeat?: number | 'infinite'; direction?: string; scroll?: unknown }
        if (dd.repeat !== undefined) {
          const badNum = typeof dd.repeat === 'number' && (!Number.isFinite(dd.repeat) || dd.repeat < 1)
          if (dd.repeat !== 'infinite' && (typeof dd.repeat !== 'number' || badNum)) {
            issues.push({
              index: i,
              code: 'invalid-range',
              message: `\`repeat\` 非法：${JSON.stringify(dd.repeat)}（应 ≥ 1 的数字，或 'infinite'）`,
              hint: "例：repeat: 3 · repeat: 'infinite'（呼吸灯的底色循环）",
            })
          }
          if ((dd.repeat === 'infinite' || (typeof dd.repeat === 'number' && dd.repeat > 1)) && dd.scroll) {
            issues.push({
              index: i,
              code: 'conflicting-easing',
              message: '`repeat` 与 `scroll` 并存 —— 滚动驱动的进度来自位置，没有"轮"的概念',
              hint: '去掉 `repeat`',
            })
          }
        }
        if (dd.direction !== undefined && dd.direction !== 'normal' && dd.direction !== 'alternate') {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `\`direction\` 非法：${JSON.stringify(dd.direction)}`,
            hint: "yoyo 往复用 direction: 'alternate'",
          })
        }
      }
      return // ★颜色分支到此为止（不落进标量路径的数值校验）
    }

    // ★★裁剪形变（C1）：参数数组的三重校验（数量 / 有限性 / from-to 对齐）+ 贝塞尔互斥
    if (d.kind === 'clip') {
      const cd = d as { from: readonly number[]; to: readonly number[]; keyframes?: Array<{ to: readonly number[]; durationMs: number; curve?: string }> }
      const n = cd.to?.length ?? 0
      if (!Array.isArray(cd.to) || n === 0) {
        issues.push({
          index: i,
          code: 'empty',
          message: '`clip` 声明的 `to` 为空——至少给一个参数',
          hint: 'inset 4 个（top/right/bottom/left）· circle 3 个（cx/cy/r）· polygon 偶数个（≤16，最多 8 点）',
        })
      } else if (n > 16) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: `\`clip\` 参数过多：${n} 个（最多 16 = 8 个顶点）——内核只有 16 个参数槽`,
          hint: 'polygon 最多 8 个顶点（16 个数）；更复杂的形状请拆成多个节点或走逃生口登记',
        })
      }
      if (!Array.isArray(cd.from) || cd.from.length < n) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: `\`clip\` 的 \`from\` 参数不足：需要 ${n} 个（与 \`to\` 对齐），收到 ${cd.from?.length ?? 0} 个`,
          hint: '内核没有"缺省 = 当前值"语义（与颜色同一条纪律）——起点必须显式给出',
        })
      }
      const badNum = (arr: readonly number[] | undefined): boolean =>
        Array.isArray(arr) && arr.some((v) => typeof v !== 'number' || !Number.isFinite(v))
      if (badNum(cd.from) || badNum(cd.to)) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: '`clip` 参数含非有限数（NaN / Infinity）',
          hint: '参数是盒分数（0..1 常见，可负 = 外扩）——给具体数值',
        })
      }
      // 序列：每段 to 与声明 to 对齐（段数按参数个数）
      if (cd.keyframes) {
        for (const [j, seg] of cd.keyframes.entries()) {
          if (!Array.isArray(seg.to) || seg.to.length < n) {
            issues.push({
              index: i,
              code: 'invalid-range',
              message: `\`clip\` 序列第 ${j} 段参数不足：需要 ${n} 个，收到 ${seg.to?.length ?? 0} 个`,
              hint: '每段 `to` 都是完整的参数数组（与声明 `to` 对齐）',
            })
          }
        }
      }
      checkCurveBezier(d as { curveBezier?: readonly number[]; curve?: unknown; spring?: unknown; keyframes?: unknown }, i, issues)
      // ★`curve` 与 `spring` 互斥（标量路径有同一条——clip 不经过它，必须自备）
      if (d.curve !== undefined && d.spring !== undefined) {
        issues.push({
          index: i,
          code: 'conflicting-easing',
          message: '`clip` 的 `curve` 与 `spring` 并存 —— 求值模式必须唯一',
          hint: '二选一：要物理手感用 `spring`，要确定曲线用 `curve`',
        })
      }
      if (cd.keyframes && d.spring !== undefined) {
        issues.push({
          index: i,
          code: 'conflicting-easing',
          message: '`clip` 的 `keyframes` 与 `spring` 并存 —— 求值模式必须唯一',
          hint: '二选一（与标量/颜色同规则）',
        })
      }
      return // ★裁剪分支到此为止
    }

    // ★自定义贝塞尔（标量路径）
    checkCurveBezier(d, i, issues)

    // ★A2 循环合法性与互斥（滚动驱动没有"轮"的概念）
    {
      const dd = d as { repeat?: number | 'infinite'; direction?: string; scroll?: unknown }
      if (dd.repeat !== undefined) {
        const badNum = typeof dd.repeat === 'number' && (!Number.isFinite(dd.repeat) || dd.repeat < 1)
        if (dd.repeat !== 'infinite' && (typeof dd.repeat !== 'number' || badNum)) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `\`repeat\` 非法：${JSON.stringify(dd.repeat)}（应 ≥ 1 的数字，或 'infinite'）`,
            hint: "例：repeat: 3（播三遍）· repeat: 'infinite'（无限）",
          })
        }
        if ((dd.repeat === 'infinite' || (typeof dd.repeat === 'number' && dd.repeat > 1)) && dd.scroll) {
          issues.push({
            index: i,
            code: 'conflicting-easing',
            message: '`repeat` 与 `scroll` 并存 —— 滚动驱动的进度来自位置，没有"轮"的概念',
            hint: '去掉 `repeat`（滚动联动天然随位置往复）',
          })
        }
      }
      if (dd.direction !== undefined && dd.direction !== 'normal' && dd.direction !== 'alternate') {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: `\`direction\` 非法：${JSON.stringify(dd.direction)}（应 'normal' / 'alternate'）`,
          hint: "yoyo 往复用 direction: 'alternate'",
        })
      }
    }

    // ★★**同属性重复声明**（真陷阱，本轮写预设时自己踩到）：内核语义是「同 (节点,属性) = 替换」
    //   ⇒ 一个批次里出现两条 `scale`，**后者静默替换前者**——用户以为"按下再弹回"，
    //   实际只有一条在跑。⇒ 编译期拦住（这正是 §5-bis.2"把问题变编译期"的同一套做法）。
    //   ★MA6 起：**正解是 `keyframes`**（一条动画多段），故提示直接指向它。
    const dup = decls.slice(0, i).find((p) => p.kind === d.kind)
    if (dup) {
      issues.push({
        index: i,
        code: 'duplicate-kind',
        message: `同一批次里 \`${d.kind}\` 出现了多次（内核对同 (节点,属性) 是**替换**语义 ⇒ 后者会静默替换前者）`,
        hint: '多段序列请用 `keyframes`（一条动画内分段，内核 AnimMode::Keyframes）；' +
          '或拆成两次调用；或改用不同属性组合（如 scale + opacity 同时进行）',
      })
    }
    // ★MA6：序列编排的合法性（空序列 / 段时长非法 / 段曲线未知 / 与 spring 冲突）
    if (d.keyframes) {
      const kf = d.keyframes
      if (kf.length === 0) {
        issues.push({
          index: i,
          code: 'empty',
          message: '`keyframes` 为空数组（序列至少要一段；单段请直接用 `curve`）',
          hint: '去掉 `keyframes` 用单段声明，或补上至少一段 `{ to, durationMs }`',
        })
      }
      const sum = kf.reduce((acc, s) => acc + (Number.isFinite(s.durationMs) ? s.durationMs : 0), 0)
      kf.forEach((s, j) => {
        if (!Number.isFinite(s.to)) {
          issues.push({ index: i, code: 'invalid-range', message: `序列第 ${j} 段 \`to\` 非有限数`, hint: '给具体数值' })
        }
        if (!Number.isFinite(s.durationMs) || s.durationMs < 0) {
          issues.push({
            index: i,
            code: 'invalid-range',
            message: `序列第 ${j} 段 \`durationMs\` 非法：${s.durationMs}`,
            hint: '给非负毫秒数（0 = 该段瞬变，合法但通常不是本意）',
          })
        }
        if (s.curve !== undefined && !(s.curve in CURVE_ID)) {
          issues.push({ index: i, code: 'invalid-range', message: `序列第 ${j} 段曲线未知：${s.curve}`, hint: '用 Curve 封闭集里的名字' })
        }
      })
      if (sum <= 0) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: '序列总时长为 0 —— 动画会**瞬间跳到末段终点**',
          hint: '至少给一段正时长；零时长序列在真机上看起来就是"没做动画"',
        })
      }
      if (d.spring !== undefined) {
        issues.push({
          index: i,
          code: 'conflicting-easing',
          message: '`keyframes` 与 `spring` 并存 —— 求值模式必须唯一',
          hint: '序列里要弹性手感，把某一段用曲线近似（如 springApprox），或整条改用 spring',
        })
      }
      if (d.curve !== undefined) {
        issues.push({
          index: i,
          code: 'conflicting-easing',
          message: '`keyframes` 与 `curve` 并存 —— 段内曲线由每段自己的 `curve` 决定',
          hint: '删掉外层的 `curve`（它只对单段模式有意义）',
        })
      }
      // 末段 `to` 必须与声明的 `to` 一致（否则"声明说去哪、实际去哪"两处不一致 ⇒ 静默错形）
      const last = kf[kf.length - 1]
      if (last && Number.isFinite(last.to) && Number.isFinite(d.to) && last.to !== d.to) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: `末段 \`to\`(${last.to}) 与声明 \`to\`(${d.to}) 不一致 —— 两处都描述"终点"`,
          hint: '让二者相等（编译器以声明 `to` 为准做端点钉死，不一致会让终值与你写的不符）',
        })
      }
    }
    if (!isComposited(d.kind) && !isTickOnly(d.kind)) {
      issues.push({
        index: i,
        code: 'non-composited',
        message: `\`${d.kind}\` 不是合成属性 —— 会触发平台布局链路（requestLayout / 布局重算），` +
          '平台渲染线程的异步红利**完全失效**',
        hint: '改用合成属性：位移用 translateX/Y、缩放用 scale、旋转用 rotate、' +
          '透明度用 opacity；如果要动的是"布局让位"，请走 FLIP（presets.list.shift）',
      })
    }
    if (!Number.isFinite(d.to)) {
      issues.push({ index: i, code: 'invalid-range', message: '`to` 不是有限数', hint: '给一个具体的数值目标' })
    }
    if (d.from !== undefined && !Number.isFinite(d.from)) {
      issues.push({ index: i, code: 'invalid-range', message: '`from` 不是有限数', hint: '省略 `from` 让内核取节点当前值' })
    }
    const isSpring = d.spring !== undefined
    if (isSpring && d.curve !== undefined) {
      issues.push({
        index: i,
        code: 'conflicting-easing',
        message: '同时声明了 `curve` 与 `spring` —— 求值模式必须唯一',
        hint: '二选一：要物理手感用 `spring`，要确定曲线用 `curve`',
      })
    }
    // ★**缺省时长是合法的**（归一为 300ms，见 compile.ts 的 `resolveEasing`）——与本仓
    //   "预设优先于参数"一致：开发者写 `{ kind: 'translateX', to: 100 }` 就该能跑。
    //   （首版这里把"缺时长"当错误，与测试断言的"默认值应落定"自相矛盾——测试当场抓出。）
    //   仍拦的是**非法的**时长（负数/非有限），见下一条。
    if (d.durationMs !== undefined && (!Number.isFinite(d.durationMs) || d.durationMs < 0)) {
      issues.push({ index: i, code: 'invalid-range', message: `\`durationMs\` 非法：${d.durationMs}`, hint: '给非负毫秒数' })
    }
    if (d.delayMs !== undefined && (!Number.isFinite(d.delayMs) || d.delayMs < 0)) {
      issues.push({ index: i, code: 'invalid-range', message: `\`delayMs\` 非法：${d.delayMs}`, hint: '给非负毫秒数' })
    }
    if (isSpring) {
      const s = d.spring!
      const bad =
        !Number.isFinite(s.stiffness) || s.stiffness <= 0 ||
        !Number.isFinite(s.damping) || s.damping < 0 ||
        (s.mass !== undefined && (!Number.isFinite(s.mass) || s.mass <= 0))
      if (bad) {
        issues.push({
          index: i,
          code: 'invalid-spring',
          message: `弹簧参数非法：${JSON.stringify(s)}（要求 stiffness>0 · damping≥0 · mass>0）`,
          hint: '用预设（presets.easing.snappy / smooth）避免手调；内核有 10s 安全上限兜底但那是兜底不是设计',
        })
      }
    }
    // ★MA5：滚动窗口的合法性——退化窗口（to <= from）会让进度恒 1（内核按"已滑过"处理）
    //   而不是报错；但写成声明里多半是**笔误**（把 from/to 写反）⇒ 编译期拦住。
    if (d.scroll) {
      const { from, to } = d.scroll
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: `滚动窗口含非有限值：${JSON.stringify(d.scroll)}`,
          hint: '窗口两端都要是具体的滚动位置（px）',
        })
      } else if (to <= from) {
        issues.push({
          index: i,
          code: 'invalid-range',
          message: `滚动窗口退化（to=${to} <= from=${from}）——进度将恒为 1，动画一开始就停在终点`,
          hint: '检查 from/to 是否写反；窗口跨度应为正数（如 from: 0, to: 120）',
        })
      }
    }
    // ★MA5：滚动 + 弹簧并存 ⇒ 语义不明确（弹簧是**按时间**的物理积分，其进度参数在滚动驱动下
    //   没有意义——内核以滚动位置换算出进度后走 `curve_eval`，物理积分不参与）
    if (d.scroll && d.spring) {
      issues.push({
        index: i,
        code: 'conflicting-easing',
        message: '滚动驱动与弹簧物理并存 —— 弹簧的进度参数在滚动驱动下无意义（内核按位置换算进度后走曲线求值）',
        hint: '滚动联动请用 `curve`（如 easeOut / linear）；弹簧留给时间驱动的动画',
      })
    }
  })

  return issues
}

/** 把问题清单格式化成一条可读消息（供编译期报错/日志） */
export function formatIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return ''
  return issues
    .map((i) => `  [${i.code}]${i.index >= 0 ? ` #${i.index}` : ''} ${i.message}\n      → ${i.hint}`)
    .join('\n')
}
