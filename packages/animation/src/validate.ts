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
import type { AnimDecl, AnimKindName, ValidationIssue } from './types'

/** 合成属性集（§5-bis.1 的分水岭；与内核 `AnimKind::is_composited` 同集合） */
export const COMPOSITED_KINDS: readonly AnimKindName[] = [
  'translateX',
  'translateY',
  'scale',
  'rotate',
  'opacity',
]

/** 该属性是否合成（编译期可查——上层可在**写代码时**就得到答案） */
export function isComposited(kind: AnimKindName): boolean {
  return COMPOSITED_KINDS.includes(kind)
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
 */
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
    // ★★**同属性重复声明**（真陷阱，本轮写预设时自己踩到）：内核语义是「同 (节点,属性) = 替换」
    //   ⇒ 一个批次里出现两条 `scale`，**后者静默替换前者**——用户以为"按下再弹回"，
    //   实际只有一条在跑。⇒ 编译期拦住（这正是 §5-bis.2"把问题变编译期"的同一套做法）。
    const dup = decls.slice(0, i).find((p) => p.kind === d.kind)
    if (dup) {
      issues.push({
        index: i,
        code: 'duplicate-kind',
        message: `同一批次里 \`${d.kind}\` 出现了多次（内核对同 (节点,属性) 是**替换**语义 ⇒ 后者会静默替换前者）`,
        hint: '「先下压再弹回」这类**序列编排**当前引擎不支持——拆成两次调用（第一次完成后启动第二次），' +
          '或改用不同的属性组合（如 scale + opacity 同时进行）',
      })
    }
    if (!isComposited(d.kind)) {
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
