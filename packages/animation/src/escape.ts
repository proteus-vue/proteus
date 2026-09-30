// packages/animation/src/escape.ts
// ★★Morpheus §4.2 —— **逃生口**（编译层覆盖不了的，必须走显式通道且**可统计**）
//
// 【为什么必须有（§4.2 原文）】"编译层覆盖不了的（自定义缓动、复杂编排），必须走**显式逃生口**，
//   且逃生口要**可统计**（与 UC0 的漏点统计同构）：记为 `degraded`（行为可能不一致）——**最高危险度**；
//   不得与其他类别混在报告里，必须单列。"
//
// 【为什么"显式"是关键（与 UC0 同源的设计哲学）】封闭集（5 曲线 / 5 属性 / 单段时间轴）必然有边界：
//   · 静默降级 ⇒ 用户以为拿到声明式性能，实际是另一档（**禁止**，这是红线）；
//   · 直接拦住不让做 ⇒ 逼开发者绕过框架（脱离统计视野，比登记更糟）；
//   · ⇒ 第三条路：**显式通道**——能用，但必须**登记**（写明做什么/为什么/风险），并被统计。
//   本注册表就是那条通道的账本。
//
// 【与 C4 漏点计数器（`@proteus-vue/compiler` 的 `GapCounter`）的关系】同构，但**方向相反**：
//   · 漏点计数器：**编译期自动发现**（诊断/规则 ID → 归类），开发者无需动作；
//   · 逃生口注册表：**开发者主动登记**（框架无法自动发现"你在框架外自己写 rAF"）。
//   两者都产出"degraded 单列"的报告，且**都不新增"什么算漏点"的判断**（本表只做归类与计数）。
//
// 【不阻断】本模块只收集、从不抛错（登记时的参数校验除外——那是对**登记本身**的校验，不是对动画的阻断）。

/** 逃生口类别（封闭集——与 §4.2 的举例对齐；`other` 兜底但**必须**写明细节，不许滥用） */
export type EscapeKind =
  /** 自定义缓动（封闭集 5 条曲线不够，如 cubic-bezier(0.1,0.9,0.2,1)） */
  | 'custom-easing'
  /** 外部驱动（自己 rAF / CSS transition / 第三方动画库——完全绕开内核） */
  | 'external-driver'
  /** 布局属性动画（width/height/margin……会触发重排，平台零参与路径失效） */
  | 'layout-property'
  /** 跨属性共享时间轴（**多数场景已可用 `compileTimeline`**；此类别留给「时间轴也表达不了」的编排：
   *  条件分支 / 运行期才决定下一停靠点 / 与外部时钟对齐） */
  | 'cross-property-timeline'
  /** 与平台原生动画混用（UIKit/CAAnimation / Android Animator 直接驱动同一元素） */
  | 'platform-mixing'
  /** 其它（**必须**在 detail 里写清楚——分类覆盖不全时如实记录，不静默丢） */
  | 'other'

/** 类别全集（供校验与报告遍历；**未归类的必须显式列出**，同 C4 口径） */
export const ESCAPE_KINDS: readonly EscapeKind[] = [
  'custom-easing',
  'external-driver',
  'layout-property',
  'cross-property-timeline',
  'platform-mixing',
  'other',
]

/** 一条逃生口登记（**三要素必填**：做什么 / 为什么 / 行为风险） */
export interface EscapeRecord {
  kind: EscapeKind
  /** 具体在做什么（可读；如 `cubic-bezier(0.1,0.9,0.2,1)` 或 `组件 CardList 自建 rAF 交错`） */
  detail: string
  /** 为什么封闭集不够（**必填**——没有理由的逃生口是设计泄漏，必须被看见） */
  reason: string
  /** 行为风险：会怎样与声明式路径**不一致**（**必填**——这就是 degraded 的定义，§4.2 要求"最高危险度"） */
  behaviorRisk: string
  /** 出处（组件 / 文件；便于定位与回归） */
  site?: string
}

/** 聚合结果（报告与门禁的输入） */
export interface EscapeSummary {
  /** 逃生口总数 */
  total: number
  /** 声明式使用量（编译成功的声明条数；**率的分母的另一半**） */
  declaratives: number
  /** 按类别计数（**全部类别都出现**，零值也列出——便于人眼确认没有"未归类"黑洞） */
  byKind: Record<EscapeKind, number>
  /** ★degraded 单列（§4.2 硬性要求：不得与其他类别混在一起） */
  degraded: readonly EscapeRecord[]
  /** 逃生口率 = total / (declaratives + total)；声明式为 0 且无逃生口时为 0 */
  ratio: number
}

/** 报告里 degraded 的门槛（验收标准 §11：逃生口率 < 5%） */
export const ESCAPE_RATIO_TARGET = 0.05

/**
 * ★★**逃生口注册表**（账本）
 *
 * 用法（业务侧）：
 * ```ts
 * import { escapes, compileAnimations } from '@proteus-vue/animation'
 *
 * // 声明式路径：把注册表传进去（成功编译的声明计入"声明式使用"）
 * const batch = compileAnimations(decls, { nodeId }, { escapes })
 *
 * // 逃生口：显式登记（缺 reason/behaviorRisk 会当场抛错——逼你想清楚风险）
 * escapes.register({
 *   kind: 'custom-easing',
 *   detail: 'cubic-bezier(0.1, 0.9, 0.2, 1)',
 *   reason: '品牌动效要求的曲线不在封闭集 5 条里',
 *   behaviorRisk: '不进内核曲线表 ⇒ 无法走平台零参与路径，且跨端观感可能与 Web 不一致',
 *   site: 'pages/landing/Hero.vue',
 * })
 *
 * console.log(escapes.format())   // degraded 单列报告
 * ```
 */
export class EscapeRegistry {
  private records: EscapeRecord[] = []
  private declarativeCount = 0

  /** 登记一条逃生口（**三要素缺失当场抛错**——"没有理由的逃生口"是设计泄漏，不许静默通过） */
  register(r: EscapeRecord): void {
    if (!r || typeof r !== 'object') throw new Error('逃生口登记需要对象（{kind, detail, reason, behaviorRisk}）')
    if (!ESCAPE_KINDS.includes(r.kind)) {
      throw new Error(`未知逃生口类别 \`${r.kind}\`（合法值：${ESCAPE_KINDS.join(' / ')}）`)
    }
    for (const f of ['detail', 'reason', 'behaviorRisk'] as const) {
      const v = r[f]
      if (typeof v !== 'string' || v.trim().length === 0) {
        throw new Error(
          `逃生口登记缺少 \`${f}\`（${r.kind}）——` +
            (f === 'behaviorRisk'
              ? '§4.2 要求写明"行为可能不一致"的具体形态（degraded 的定义）'
              : f === 'reason'
                ? '没有理由的逃生口是设计泄漏，必须写清"为什么封闭集不够"'
                : '必须写清"具体在做什么"'),
        )
      }
    }
    this.records.push({ ...r })
  }

  /** 记录声明式使用量（由 `compileAnimations` 在**注入本注册表**时调用） */
  noteDeclarative(n: number): void {
    if (Number.isFinite(n) && n > 0) this.declarativeCount += n
  }

  /** 全部登记（只读视图） */
  list(): readonly EscapeRecord[] {
    return this.records
  }

  /** ★聚合（degraded 单列；**全部类别都出现**，零值也列出——不给人留"未归类"的想象空间） */
  summary(): EscapeSummary {
    const byKind = Object.fromEntries(ESCAPE_KINDS.map((k) => [k, 0])) as Record<EscapeKind, number>
    for (const r of this.records) byKind[r.kind] += 1
    const total = this.records.length
    const denom = this.declarativeCount + total
    return {
      total,
      declaratives: this.declarativeCount,
      byKind,
      // §4.2：degraded 是**最高危险度**，单列（不与其它类别混）——这里就是那条单列表
      degraded: this.records.slice(),
      ratio: denom > 0 ? total / denom : 0,
    }
  }

  /** ★可读报告（degraded **单独一节**，不与类别汇总混排） */
  format(): string {
    const s = this.summary()
    const lines: string[] = []
    lines.push('═══ Morpheus 逃生口报告 ═══')
    lines.push(
      `声明式 ${s.declaratives} 条 · 逃生口 ${s.total} 条 · 率 ${
        s.total === 0 ? '0%' : `${(s.ratio * 100).toFixed(1)}%`
      }（目标 < ${(ESCAPE_RATIO_TARGET * 100).toFixed(0)}%）`,
    )
    lines.push('')
    if (s.total === 0) {
      lines.push('无逃生口登记（全部走声明式路径）。')
    } else {
      lines.push('★ degraded（行为可能与声明式路径不一致——§4.2 最高危险度，单列）:')
      for (const r of s.degraded) {
        lines.push(`  · [${r.kind}] ${r.detail}`)
        lines.push(`      理由：${r.reason}`)
        lines.push(`      风险：${r.behaviorRisk}`)
        if (r.site) lines.push(`      出处：${r.site}`)
      }
      lines.push('')
    }
    // ★类别汇总**恒输出**（含零值）——"全部为零"本身就是有效信号：
    //   它证明"没有未归类黑洞"，比"没输出这一节"强得多（本仓纪律：判据要落在结果上）。
    lines.push('按类别汇总（含零值——"未归类"不存在，只有 other 兜底）:')
    for (const k of ESCAPE_KINDS) lines.push(`  · ${k}: ${s.byKind[k]}`)
    if (s.ratio > ESCAPE_RATIO_TARGET) {
      lines.push('')
      lines.push(`⚠ 逃生口率 ${(s.ratio * 100).toFixed(1)}% 超过目标 ${(ESCAPE_RATIO_TARGET * 100).toFixed(0)}%——` +
        '优先看能否把高频类别补成预设（预设优先于逃生口）')
    }
    return lines.join('\n')
  }

  /** 清空（**测试隔离用**——跨用例共享状态必须可归零，本仓纪律） */
  reset(): void {
    this.records = []
    this.declarativeCount = 0
  }
}

/** 全局默认注册表（业务可直接用；测试请用 `new EscapeRegistry()` 或 `reset()`） */
export const escapes = new EscapeRegistry()
