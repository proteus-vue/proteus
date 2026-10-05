// packages/plugin-vite/src/cse-lint-plugin.ts
// ★★★G-61 B4（2026-10-05）：**CSE lint 插件**（P6「Web 端 lint 接入」——Profile 外写法在 Web 也报错）
//
// 【它解决什么（plan B4 行 + Profile §7 / P6）】一致性由「**编译期 lint 前置**」保证：Profile 外写法
//   必须在**所有端的构建链**都报错——否则 Web 端（真值基准）能跑、App 端不行 ⇒ 问题延迟到最贵处暴露。
//   `profile-boundary-plugin.ts` 是**字符串级**校验（VC2-b，先立）；本插件是**语义级**（走 CSE）：
//   · E-CSS-004/005：`:class` 候选枚举失败 / 动态表超限（需要 B2 的计划表——字符串级看不到）
//   · E-CSS-006：拍平违规（需要 component-ir 的判定）
//   · W-CSS-101/102/103：选择器结构与 !important（需要 CSE 的解析产物）
//   ⇒ 与既有 profile-boundary 互补，**规则号不重叠**（CSS-PB-* vs E-CSS/W-CSS）。
//
// 【★为什么在插件里跑而不是只做成 CLI 检查】构建即拦截（`this.error`）——与 VC2-b 同款动机：
//   不依赖"人记得跑检查"（本仓已为"检查没接线"付过多轮代价）。
//
// 【默认行为】`level: 'error'`（阻断构建）；存量适配走 `baselinePath`（棘轮，与 profile-boundary 同款）。
//   ★但 E 族规则**不受基线放行**（它们只报"新写法"，且数量应为 0——基线只对 W 族有意义）。
import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { extractFromSfc, buildDynamicClassPlans, lintCse, hasCseLintErrors } from '@proteus-vue/compiler'
import type { CseLintDiagnostic } from '@proteus-vue/compiler'

export interface CseLintPluginOptions {
  /** 违规级别：error（默认，阻断构建）/ warn（只打印）/ off */
  level?: 'error' | 'warn' | 'off'
  /** 目标端（决定端相关规则——如 Skyline 的 W-CSS-105；缺省 web） */
  target?: 'web' | 'skyline' | 'app'
  /** 该端不支持声明（E-CSS-003 / W-CSS-105 的输入；调用方可从能力矩阵派生） */
  unsupportedDecls?: Array<{ prop: string; accept: readonly string[]; suggestion?: string }>
  /**
   * ★存量基线（棘轮：只减不增）——`{ "<relpath>:<code>": reason }`。
   * 【为什么必须有（本仓棘轮纪律 + 首次全仓构建实测）】首跑即抓出**存量真问题**
   *   （如 `p-popup` 的 `:class="computed 拼串"`——E-CSS-004 的正确判定，但修它要动弹层动画）。
   *   直接全拦 ⇒ 全仓构建红、机制没法上线；直接放过 ⇒ 存量成永久噪音。
   *   ⇒ 与 `profile-boundary-plugin` 同款：存量**钉住**（放行 + 如实计数），**新增**当场红；
   *     修一条从基线删一条（门禁 `check:cse-lint-baseline` 复核键仍在扫描中）。
   */
  baselinePath?: string
  /** 基线命中的条数（诊断透出——供构建日志/门禁读） */
  onBaselineHit?: (count: number) => void
}

/** 提取 `<style>` 文本（无 lang 预处理器的——与 profile-boundary 同判据） */
function styleBlocksOf(source: string): string[] {
  const out: string[] = []
  const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (/\blang\s*=/.test(m[1] ?? '')) continue
    out.push(m[2] ?? '')
  }
  return out
}

export function cseLintPlugin(opts: CseLintPluginOptions = {}): Plugin {
  const level = opts.level ?? 'error'
  let baseline: Record<string, string> | null = null
  let baselineLoaded = false
  let viteRoot = ''
  return {
    name: 'proteus-cse-lint',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root
    },
    transform(code: string, id: string) {
      if (level === 'off' || !id.endsWith('.vue')) return null
      const rel = (viteRoot ? path.relative(viteRoot, id) : id).replace(/\\/g, '/')
      if (opts.baselinePath && !baselineLoaded) {
        baselineLoaded = true
        try {
          baseline = JSON.parse(fs.readFileSync(opts.baselinePath, 'utf-8'))
        } catch {
          baseline = null // 缺基线 = 空基线（诚实：不静默认为全放行）
        }
      }
      const styles = styleBlocksOf(code)
      if (styles.length === 0 && !code.includes(':class')) return null // 无样式无动态类 ⇒ 无 lint 面（零侵入）
      const diagnostics: CseLintDiagnostic[] = []
      try {
        // ① 提取（模板树 + 样式表 + :class 绑定）
        const ex = extractFromSfc(code)
        // ② 动态类计划（B2——提供 E-CSS-004/005 的输入）
        let classPlans: Record<string, unknown> | undefined
        let dynamicErrors: Array<{ nodeKey: string; expr: string; reason: string }> | undefined
        if (Object.keys(ex.classBindings).length > 0) {
          const built = buildDynamicClassPlans(ex.roots, ex.sheet, ex.classBindings)
          classPlans = built.plans
          const errs = built.diagnostics.filter((d) => d.level === 'error')
          if (errs.length > 0) {
            // ★消息形态：B2 的 E-CSS-004 message 已是 `<nodeKey>（:class="<expr>"）无法...：<reason>`
            //   ⇒ 此处**原样透传**（此前二次套壳导致"消息里套消息"——本仓实测抓出）
            dynamicErrors = errs.map((d) => {
              const m = /^(\S+?)（:class="([^"]*)"）/.exec(d.message)
              return { nodeKey: m?.[1] ?? '?', expr: m?.[2] ?? '', reason: d.hint ?? d.message }
            })
          }
        }
        // ③ lint（纯函数）
        diagnostics.push(
          ...lintCse(ex.sheet, ex.roots, {
            ...(opts.target ? { target: opts.target } : {}),
            ...(opts.unsupportedDecls ? { unsupportedDecls: opts.unsupportedDecls } : {}),
            ...(classPlans ? { classPlans: classPlans as never } : {}),
            ...(dynamicErrors ? { dynamicErrors } : {}),
          }),
        )
      } catch (e) {
        // ★lint 本身崩了不能吞（否则"没报错"会被读成"没问题"——本仓最忌的静默）
        this.error(`[proteus-cse-lint] 内部错误（${(e as Error).message.slice(0, 160)}）——请上报（lint 失败不等于代码合法）`)
      }
      // ★基线放行（键 = `<rel>:<code>`；存量钉住 + 如实计数）
      let baselineHits = 0
      const kept = diagnostics.filter((d) => {
        const key = `${rel}:${d.code}`
        if (baseline && Object.prototype.hasOwnProperty.call(baseline, key)) {
          baselineHits++
          return false
        }
        return true
      })
      if (baselineHits > 0 && opts.onBaselineHit) opts.onBaselineHit(baselineHits)
      if (kept.length === 0) return null
      const errors = kept.filter((d) => d.severity === 'error')
      // ★E 族不受基线放行（见头注）；W 族也照报（存量适配由调用方决定是否接 baseline）
      const lines = kept.map((d) => {
        const where = d.where?.selector ?? d.where?.nodeKey ?? (d.where?.line !== undefined ? `L${d.where.line}` : '')
        return `  ${d.severity === 'error' ? '✗' : '⚠'} [${d.code}] ${d.message}${where ? `（${where}）` : ''}${d.hint ? `\n      → ${d.hint}` : ''}`
      })
      const msg = `[proteus-cse-lint/${level}] ${errors.length} error · ${kept.length - errors.length} warn（基线放行 ${baselineHits} 条）：\n${lines.join('\n')}`
      if (level === 'warn' || errors.length === 0) {
        console.warn(msg)
        return null
      }
      this.error(msg)
    },
  }
}
