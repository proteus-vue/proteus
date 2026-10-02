// packages/compiler/src/scroll-safety.ts
// ★★SC2（2026-10-02）：**可停靠滚动容器的编译期校验**（《可停靠滚动容器与滚动编排能力方案》§6.2/§6.3）
//
// 【它拦什么（五条硬约束，方案 §6.2）】
//   SC001 档位最多 3 且必须递增 —— 超出**编译期报错**，不静默截断（鸿蒙 `bindSheet` 硬限制）
//   SC002 `nested`（协商策略）必填 —— 🔴 **iOS 默认扩展、Android 默认不扩展**，依赖默认值 = 跨端静默差异
//   SC003 `initial` 必须是 detents 中一项 —— 否则"初始档位"落到未声明的位置（各端行为未定义）
//   SC004 `overscroll.mode: 'system'` 必须显式声明 —— 原生手感不可配（方案 §3.1）⇒
//         走它 = 放弃跨端一致 ⇒ **警告 + 登记允许差异清单（VC5-d）**，不得静默（方案 §3.4）
//   SC005 禁止逃生口 —— 任意滚动事件回调 / 任意回弹物理函数 / 命令式停靠操作（方案 §6.3）
//
// 【判据形态】纯静态分析（模板源码字符串 + 轻量标签扫描，与 `layer-safety.ts` 同款——零额外依赖）。
//   产出**机器可判别的稳定 code**（门禁与测试按 code 断言，不依赖文案）——铁律 #9 同源。
//
// 【诚实边界】本模块只做**声明面**校验；各端**执行**（停靠判定 / 回弹自算 / 协商 / 二楼状态机）
//   属方案 SC3–SC7，尚未实现（见 `docs/Proteus_可停靠滚动容器与滚动编排能力方案.md` §13 实施记录）。
import {
  DETENT_LIMIT, NESTED_POLICIES, DOCK_ANCHORS, detentRatio,
} from '@proteus-vue/contracts/scroll'
import type { DetentSpec } from '@proteus-vue/contracts/scroll'

/** 滚动容器违规（code 稳定，供门禁/测试断言） */
export interface ScrollViolation {
  code: 'SC001' | 'SC002' | 'SC003' | 'SC004' | 'SC005'
  /** 方案条目（可追溯到文档） */
  rule: string
  message: string
  hint: string
  /** 源码行号（1-based，尽力给出） */
  line?: number
}

/** 违规码 → 方案条目（对外表述与测试断言共用） */
export const SCROLL_RULE_OF: Record<ScrollViolation['code'], string> = {
  SC001: '方案 §6.2 约束 1「档位最多 3、必须递增」',
  SC002: '方案 §6.2 约束 2「协商策略必填（iOS/Android 默认相反）」',
  SC003: '方案 §6.1「initial 必须是 detents 中一项」',
  SC004: '方案 §3.4「overscroll: system 需显式声明并登记允许差异清单」',
  SC005: '方案 §6.3「不许出现的逃生口」',
}

/** 触发滚动容器校验的元素名（封闭——与本方案 §2.2 的目标写法一致；别名不开放） */
const DOCK_TAGS = ['dock-container', 'sheet'] as const

interface DockNode {
  tag: string
  index: number
  attrs: string
  line: number
  selfClose: boolean
}

/** 极简标签扫描（与 layer-safety 同款；注释内的标签跳过） */
function scanDockNodes(templateSource: string): DockNode[] {
  const out: DockNode[] = []
  const noComment = templateSource.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m: RegExpExecArray | null
  let line = 1
  let idx = 0
  let cursor = 0
  while ((m = TAG_RE.exec(noComment)) !== null) {
    line += noComment.slice(cursor, m.index).split('\n').length - 1
    cursor = m.index
    if (m[1] === '/') continue
    const tag = m[2]!
    if ((DOCK_TAGS as readonly string[]).includes(tag)) {
      out.push({ tag, index: idx++, attrs: m[3] ?? '', line, selfClose: m[4] === '/' })
    }
    line += (m[0].match(/\n/g) ?? []).length
  }
  return out
}

/** 取属性原文（静态串；`:attr` 动态绑定返回 undefined——动态值由运行时兜底，见 SC005 的说明） */
function attrOf(attrs: string, name: string): { value: string; dynamic: boolean } | undefined {
  const dyn = new RegExp(`(?::|v-bind:)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
  if (dyn) return { value: (dyn[1] ?? dyn[2] ?? '').trim(), dynamic: true }
  const stat = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs)
  if (stat) return { value: (stat[1] ?? stat[2] ?? '').trim(), dynamic: false }
  return undefined
}

/** 解析 detents 字面量：支持 `['40%', '100%']` / `[0.4, 1]` / `[0.4, 'full']` / `:detents="[0.4, 1]"` */
export function parseDetentsLiteral(raw: string): DetentSpec[] | null {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim()
  if (!inner) return [] // 空数组：合法语法但下游 SC001/SC003 会拦
  const parts = inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  const out: DetentSpec[] = []
  for (const p of parts) {
    if (!p) return null
    if (/^\d+(\.\d+)?%$/.test(p)) {
      out.push(Number(p.slice(0, -1)) / 100)
    } else if (/^\d+(\.\d+)?(px)?$/.test(p)) {
      out.push(Number(p))
    } else if (p === 'full' || p === 'half' || p === 'header') {
      out.push(p)
    } else {
      return null // 解析不了（含表达式/变量）——调用方按"动态"处理
    }
  }
  return out
}

/**
 * 校验模板里的可停靠滚动容器声明（方案 §6.2 五条硬约束）。
 *
 * @param templateSource `<template>` 内部（或完整模板）源码
 * @returns 违规列表（空 = 合规）。SC004 为**警告级**（plan §3.4：警告 + 登记），其余为 error 级。
 */
export function validateScrollUsage(templateSource: string): ScrollViolation[] {
  const out: ScrollViolation[] = []
  for (const node of scanDockNodes(templateSource)) {
    // ── detents（SC001：最多 3 + 递增）──
    const detRaw = attrOf(node.attrs, 'detents')
    let detents: DetentSpec[] | null = null
    if (detRaw) {
      detents = parseDetentsLiteral(detRaw.value)
      if (detents === null) {
        // 动态表达式：**不静默放过**——但也不误判为违规（运行时校验兜底），给 info 级提示
        out.push({
          code: 'SC005',
          rule: SCROLL_RULE_OF.SC005,
          message: `<${node.tag}> 的 detents 是动态表达式（\`${detRaw.value}\`）——声明面只接受字面量数组`,
          hint: '把档位写成字面量（如 `:detents="[0.4, 1]"` 或 `detents="[' + "'40%', '100%'" + ']"`）——动态档位无法编译期校验，且各端映射需在构建期确定',
          line: node.line,
        })
      } else {
        if (detents.length === 0) {
          out.push({
            code: 'SC001',
            rule: SCROLL_RULE_OF.SC001,
            message: `<${node.tag}> 的 detents 为空——至少声明 1 档`,
            hint: '声明 1–3 个档位，如 `detents="[0.4, 1]"`（40% / 全屏）',
            line: node.line,
          })
        } else if (detents.length > DETENT_LIMIT) {
          out.push({
            code: 'SC001',
            rule: SCROLL_RULE_OF.SC001,
            message: `<${node.tag}> 声明了 ${detents.length} 个档位（上限 ${DETENT_LIMIT}——鸿蒙 bindSheet 最多 3 档且必须递增）`,
            hint: `减少到 ≤${DETENT_LIMIT} 档；超出**不静默截断**（方案 §5.1 坑①）`,
            line: node.line,
          })
        } else {
          // 递增校验（按参考分数单调）
          for (let i = 1; i < detents.length; i++) {
            const prev = detentRatio(detents[i - 1]!)
            const cur = detentRatio(detents[i]!)
            if (!(cur > prev)) {
              out.push({
                code: 'SC001',
                rule: SCROLL_RULE_OF.SC001,
                message: `<${node.tag}> 的档位必须递增：第 ${i} 档（${JSON.stringify(detents[i])}）不大于第 ${i - 1} 档（${JSON.stringify(detents[i - 1])}）`,
                hint: '按从小到大排列（分数/关键字的参考序：header < half < full）',
                line: node.line,
              })
              break
            }
          }
        }
      }
    } else {
      out.push({
        code: 'SC001',
        rule: SCROLL_RULE_OF.SC001,
        message: `<${node.tag}> 缺少 detents（停靠点必填）`,
        hint: '如 `detents="[0.4, 1]"`；Sheet 至少两档（半屏 + 全屏）才有"可停靠"的意义',
        line: node.line,
      })
    }

    // ── nested（SC002：必填——iOS/Android 默认相反）──
    const nested = attrOf(node.attrs, 'nested')
    if (!nested) {
      out.push({
        code: 'SC002',
        rule: SCROLL_RULE_OF.SC002,
        message: `<${node.tag}> 缺 \`nested\`（协商策略必填）——iOS 默认"扩展"、Android 默认"不扩展"（方案 §5.2）`,
        hint: `显式声明：nested="header-first" | "content-first" | "none"（禁止依赖各端默认值）`,
        line: node.line,
      })
    } else if (!nested.dynamic && !(NESTED_POLICIES as readonly string[]).includes(nested.value)) {
      out.push({
        code: 'SC002',
        rule: SCROLL_RULE_OF.SC002,
        message: `<${node.tag}> 的 nested="${nested.value}" 不在封闭集（${NESTED_POLICIES.join(' | ')}）`,
        hint: '改用封闭集取值——开放任意协商策略会毁掉 conformance（方案 §6.3）',
        line: node.line,
      })
    }

    // ── initial（SC003：必须是 detents 中一项）──
    const initial = attrOf(node.attrs, 'initial')
    if (!initial) {
      out.push({
        code: 'SC003',
        rule: SCROLL_RULE_OF.SC003,
        message: `<${node.tag}> 缺 \`initial\`（初始档位必填——否则各端各自决定"从哪开"）`,
        hint: '写成 detents 中一项，如 `initial="0.4"` 或 `initial="full"`',
        line: node.line,
      })
    } else if (detents && detents.length > 0) {
      const ini = parseDetentsLiteral(`[${initial.value.replace(/^['"]|['"]$/g, '')}]`)
      if (ini === null) {
        out.push({
          code: 'SC003',
          rule: SCROLL_RULE_OF.SC003,
          message: `<${node.tag}> 的 initial（\`${initial.value}\`）不是字面量档位`,
          hint: '必须是 detents 里那一项的**字面量**写法',
          line: node.line,
        })
      } else if (ini.length === 1 && !detents.some((d) => JSON.stringify(d) === JSON.stringify(ini[0]))) {
        out.push({
          code: 'SC003',
          rule: SCROLL_RULE_OF.SC003,
          message: `<${node.tag}> 的 initial=${JSON.stringify(ini[0])} 不在 detents（${JSON.stringify(detents)}）中`,
          hint: 'initial 必须是声明过的档位之一（否则"初始高度"落在各端未定义的位置）',
          line: node.line,
        })
      }
    }

    // ── overscroll（SC004：system 需显式声明——警告级 + 登记提示）──
    const os = attrOf(node.attrs, 'overscroll')
    if (os && /mode\s*:\s*['"]system['"]/.test(os.value)) {
      out.push({
        code: 'SC004',
        rule: SCROLL_RULE_OF.SC004,
        message: `<${node.tag}> 声明了 \`overscroll.mode: 'system'\`（原生回弹——**各端手感必然不一致**，且不可配）`,
        hint: '确认这是有意的（如纯 iOS 应用）；并把它登记到 `docs/allow-differences.json`（VC5-d）——不得静默',
        line: node.line,
      })
    }

    // ── 逃生口（SC005：任意回调 / 任意物理函数 / 命令式停靠）──
    //   ★判据形态（本仓第三次踩同族坑）：**按"属性名出现"匹配，不假设后面跟什么**——
    //   首版写 `/@scroll(?:-|$)/`（假设后接 `-` 或串尾），而真实形态是 `@scroll="onS"`
    //   （后接 `=`）⇒ 漏网（测试当场抓出，同批还有 `:detent-index`：`\b:` 在 `:` 前无词边界）。
    const esc = [
      { pat: /@scroll[\s="']/, what: '任意滚动事件回调（@scroll）' },
      { pat: /\bon-scroll[\s="']/, what: '任意滚动事件回调（on-scroll）' },
      { pat: /:physics[\s="']|\bphysics\s*=/, what: '自定义回弹物理函数' },
      { pat: /:detent-index[\s="']|\bdock\s*\(|\bsetDetent\b/, what: '命令式停靠操作' },
    ]
    for (const { pat, what } of esc) {
      if (pat.test(node.attrs)) {
        out.push({
          code: 'SC005',
          rule: SCROLL_RULE_OF.SC005,
          message: `<${node.tag}> 使用了被禁止的逃生口：${what}`,
          hint: '改用声明式封闭集（detents / overscroll / nested / twoLevel / bind）——方案 §6.3',
          line: node.line,
        })
      }
    }
  }
  return out
}
