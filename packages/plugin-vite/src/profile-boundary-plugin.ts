// packages/plugin-vite/src/profile-boundary-plugin.ts
// ★VC2-b：编译期静态校验插件——「使用了某端不支持的样式」在**构建期报错**（不是警告）。
//
// 【为什么 Web 端也要跑（卡片原文）】Web 端由浏览器自然支持全部 CSS，若不拦，开发者写出的
//   Profile 外样式在 Web 端照常渲染、App 端才不一致——**问题延迟暴露，编译期封闭名存实亡**。
//   ⇒ 本插件在 **Web 与 MP 两条构建链都注册**（见 vite-config.ts）。
//
// 【判定数据】官方《Skyline WXSS 样式支持与差异》属性表的纯枚举 formats（生成物
//   `@proteus-vue/css-compat` 的 SKYLINE_BOUNDARY_RULES——由 scripts/gen-end-support-matrix.mjs
//   派生，官方文档更新 ⇒ 重新生成 ⇒ 本插件自动跟上）。
//
// 【插件形态（为什么挂在 transform 上）】每个 `.vue` 经 transform 流时提取 `<style>` 块做校验；
//   0 违规 ⇒ 返回 null（零侵入）；有违规 ⇒ **this.error**（vite 原生错误通道，构建红且带定位）。
//
// 【escape hatch】样式块内 `/* proteus-allow-profile: <理由> */`（理由非空）⇒ 该块豁免，
//   条数写进构建日志（可被扫描统计——卡片要求）。
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { Plugin } from 'vite'
import { checkProfileBoundary, formatProfileBoundaryViolation } from '@proteus-vue/css-compat'

export interface ProfileBoundaryPluginOptions {
  /** 违规级别：error（默认，阻断构建）/ warn（只打印）/ off */
  level?: 'error' | 'warn' | 'off'
  /**
   * ★存量基线（棘轮：只减不增）——`{ "<file>:<prop>:<value>": 理由 }` 形态的 JSON。
   * 【为什么必须有（本仓棘轮纪律 + 实测账）】首次全仓扫描抓出 62 条**存量**违规
   *   （28 文件——多为组件库的 Web 实现分支：inline-flex/grid/-webkit-box 等）。
   *   若直接全拦 ⇒ 全仓构建立刻红、机制等于没法上线；若直接放过 ⇒ 存量成了永久噪音。
   *   ⇒ 基线把存量**钉住**（构建放行 + 计数报告），**新增**违规当场红——修一条从基线删一条，
   *   基线只减不增（与 `check:mp-attrs` 的棘轮同款纪律）。
   */
  baselinePath?: string
  /** 命中基线条数（诊断透出——供构建日志/判据读） */
  onBaselineHit?: (count: number) => void
}

/** 提取 `<style>` 块（无 lang 预处理器的；scss/less 在产物层另有门禁） */
function styleBlocksOf(source: string): Array<{ css: string; line: number }> {
  const out: Array<{ css: string; line: number }> = []
  const re = /<style\b([^>]*)>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const attrs = m[1] ?? ''
    if (/\blang\s*=/.test(attrs)) continue // 预处理器：编译后才是产物 CSS
    const line = source.slice(0, m.index).split('\n').length + 1
    out.push({ css: m[2] ?? '', line })
  }
  return out
}

export function profileBoundaryPlugin(opts: ProfileBoundaryPluginOptions = {}): Plugin {
  const level = opts.level ?? 'error'
  let baseline: Record<string, string> | null = null
  let baselineLoaded = false
  let baselineHits = 0
  // ★路径口径（基线键必须与生成脚本一致）：用 vite 的 `config.root` 相对化
  //   （不用 process.cwd()——构建被 pnpm --filter 调起时 cwd 不一定是项目根，实测确认过）
  let viteRoot = ''
  return {
    name: 'proteus-profile-boundary',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root
    },
    transform(code, id) {
      if (level === 'off' || !id.endsWith('.vue')) return null
      const rel = (viteRoot ? relative(viteRoot, id) : id).replace(/\\/g, '/')
      // 基线懒加载（一次）
      if (opts.baselinePath && !baselineLoaded) {
        baselineLoaded = true
        try {
          baseline = JSON.parse(readFileSync(opts.baselinePath, 'utf-8')) as Record<string, string>
        } catch {
          baseline = null // 缺基线文件 = 空基线（诚实：不静默认为"全放行"）
        }
      }
      const blocks = styleBlocksOf(code)
      if (blocks.length === 0) return null
      const lines: string[] = []
      let escapes = 0
      let checked = 0
      for (const b of blocks) {
        const r = checkProfileBoundary(b.css)
        escapes += r.escapes
        checked += r.checked
        for (const v of r.violations) {
          const key = `${rel}:${v.prop}:${v.value}`
          // ★基线命中：放行 + 计数（棘轮——存量不阻断，但每次构建如实报告条数）
          if (baseline && Object.prototype.hasOwnProperty.call(baseline, key)) {
            baselineHits++
            continue
          }
          lines.push(`  ${rel}:${b.line + v.line - 1} ${formatProfileBoundaryViolation(v)}`)
        }
      }
      if (escapes > 0) {
        console.log(`[profile-boundary] ${rel}：${escapes} 条豁免（proteus-allow-profile）`)
      }
      if (baselineHits > 0 && opts.onBaselineHit) opts.onBaselineHit(baselineHits)
      if (lines.length === 0) return null
      const msg = `[profile-boundary/${level}] 使用了某端不支持的样式（判过 ${checked} 条静态声明；基线放行 ${baselineHits} 条）：\n` + lines.join('\n')
      if (level === 'warn') {
        console.warn(msg)
        return null
      }
      // ★vite 原生错误通道：构建红 + 带文件定位（卡片要求"报错不是警告"）
      this.error(msg)
    },
  }
}
