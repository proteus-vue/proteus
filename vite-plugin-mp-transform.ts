// vite-plugin-mp-transform.ts
// ============================================================
// Proteus 编译管线 · Vite 适配层（薄）
//
// 编译引擎本体在 src/compiler/（纯函数、零 Vite/配置耦合，可独立开源为 @proteus/compiler）。
// 本文件只做三件事：
//   1. 读取 proteus.config.ts 的 style 选项
//   2. 扫描 pagesDir + subPackages 下所有 .vue
//   3. 调 compileVueSfc() 并把 wxml/js/wxss emitFile 到 dist/mp-weixin
//
// 仅在 mode=mp-weixin 时注入（Web 端零转换，§0.3 原则 2）。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { transform as esbuildTransform } from 'esbuild'
import type { Plugin } from 'vite'
import config from './proteus.config'
import { compileVueSfc } from './src/compiler'

/**
 * 提取 builder 函数名：function xxxBuilder(...)
 */
export function extractBuilderFnName(code: string): string | null {
  const m = code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/)
  return m ? m[1] : null
}

/**
 * 组装 app.js：主入口源码 + 内置预设 builder 函数定义 + 注册块（纯函数，可单测）
 * 注册块在模块顶层执行（官方文档形态），builder 与 addRouteBuilder 同文件静态可分析
 */
export function assembleAppJs(
  mainCode: string,
  presets: Array<{ name: string; fnName: string; source: string }>,
): string {
  const presetCode = presets.map((p) => p.source.trim()).join('\n\n')
  const register = presets.length
    ? `\nif (typeof wx !== 'undefined' && wx.router) {\n${presets
        .map((p) => `  wx.router.addRouteBuilder('${p.name}', ${p.fnName})`)
        .join('\n')}\n}\n`
    : ''
  return `${mainCode}\n\n${presetCode}${register}`
}

/**
 * 过滤被开发者覆盖的预设：main 中已 addRouteBuilder('<name>' 的预设跳过自动注册（开发者优先）
 */
export function filterOverriddenPresets(
  mainCode: string,
  presets: Array<{ name: string; fnName: string; source: string }>,
): Array<{ name: string; fnName: string; source: string }> {
  return presets.filter((p) => !new RegExp(`addRouteBuilder\\s*\\(\\s*['"]${p.name}['"]`).test(mainCode))
}

/** 读取并转译内置预设 builders（供内联进 app.js） */
async function loadPresetBuilders(
  projectRoot: string,
): Promise<Array<{ name: string; fnName: string; source: string }>> {
  const presets: Array<{ name: string; fnName: string; source: string }> = []
  for (const [name, modPath] of Object.entries(config.customRoute.builders)) {
    const abs = path.join(projectRoot, modPath)
    if (!fs.existsSync(abs)) {
      console.warn(`[mp-transform] 预设 builder ${name} 不存在：${modPath}`)
      continue
    }
    const { code } = await esbuildTransform(fs.readFileSync(abs, 'utf-8'), { loader: 'ts', charset: 'utf8' })
    const fnName = extractBuilderFnName(code)
    if (!fnName) {
      console.warn(`[mp-transform] 预设 builder ${name} 未找到函数声明，已跳过`)
      continue
    }
    presets.push({ name, fnName, source: code })
  }
  return presets
}

export interface PluginOptions {
  px2rpx?: boolean
  rpxRatio?: number
}

function walkVueFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkVueFiles(full, acc)
    else if (entry.name.endsWith('.vue')) acc.push(full)
  }
  return acc
}

export default function mpTransform(opts: PluginOptions = {}): Plugin {
  const px2rpx = opts.px2rpx ?? config.style.px2rpx
  const rpxRatio = opts.rpxRatio ?? config.style.rpxRatio
  const isDebug = process.env.PROTEUS_DEBUG === '1'
  let projectRoot = process.cwd()
  /** 各文件编译警告汇总（buildEnd 打印摘要，反黑盒：警告可见、可统计） */
  const warningReport: Array<{ file: string; warnings: string[] }> = []

  return {
    name: 'vite-plugin-mp-transform',
    enforce: 'pre',
    configResolved(resolved) {
      projectRoot = resolved.root
    },
    async buildStart() {
      // 小程序页面不在模块图中（main.mp.ts 未引用页面），transform 钩子不会触发，
      // 故在 buildStart 扫描目录逐个编译并 emitFile 资产
      const appDir = path.join(projectRoot, path.dirname(config.pagesDir))
      const files = walkVueFiles(path.join(projectRoot, config.pagesDir))
      for (const sp of config.subPackages ?? []) {
        files.push(...walkVueFiles(path.join(projectRoot, sp.root)))
      }
      // ★ app.js 直出（绕开 rollup 打包）：读取 examples/main.mp.ts → esbuild 转译 TS → 纯文本资产
      // 微信 worklet 响应式重执行对打包代码不友好，原生直出与官方示例一致；
      // 调试开关 __PROTEUS_DEBUG__ 由本插件替换（vite define 不作用于直出资产）
      const mpEntry = path.join(appDir, 'main.mp.ts')
      if (fs.existsSync(mpEntry)) {
        const src = fs.readFileSync(mpEntry, 'utf-8')
        const { code } = await esbuildTransform(src, { loader: 'ts', charset: 'utf8' })
        // 内置预设：按 proteus.config.ts 的 customRoute.builders 读取源码并内联注册；
        // main 中同名手写注册优先（filterOverriddenPresets 跳过被覆盖的预设）
        const presets = filterOverriddenPresets(code, await loadPresetBuilders(projectRoot))
        const appJs = assembleAppJs(code, presets)
          .replace(/__PROTEUS_DEBUG__/g, isDebug ? 'true' : 'false')
          .replace(/"worklet"/g, "'worklet'")
        this.emitFile({ type: 'asset', fileName: 'app.js', source: appJs })
        console.log(`[mp-transform] app.js 已直出（${isDebug ? 'debug' : '正式'}），内置预设：${presets.map((p) => p.name).join('/') || '无'}`)
      }
      for (const file of files) {
        const source = fs.readFileSync(file, 'utf-8')
        const rel = path.relative(appDir, file).replace(/\\/g, '/').replace(/\.vue$/, '')
        const isComponent = file.includes(`${path.sep}components${path.sep}`)
        const { wxml, js, wxss, warnings } = compileVueSfc(source, {
          filename: rel,
          isComponent,
          px2rpx,
          rpxRatio,
          // dev 调试：产物注入源码行号注释 + 自动 handler 调试日志（PROTEUS_DEBUG=1 时开启）
          annotateLines: isDebug,
          debug: isDebug,
        })

        this.emitFile({ type: 'asset', fileName: `${rel}.wxml`, source: wxml })
        this.emitFile({ type: 'asset', fileName: `${rel}.js`, source: js })
        this.emitFile({ type: 'asset', fileName: `${rel}.wxss`, source: wxss })
        if (isDebug) {
          // 反黑盒：中间产物转储，转换过程完全透明
          this.emitFile({
            type: 'asset',
            fileName: `.transform-debug/${rel}.json`,
            source: JSON.stringify({ file: rel, wxml, js, wxss, warnings }, null, 2),
          })
        }
        if (warnings.length) warningReport.push({ file: rel, warnings })
        console.log(`[mp-transform] ${rel} → wxml/js/wxss 已输出`)
      }
    },
    buildEnd() {
      // 反黑盒：警告汇总摘要（不再散落丢失）
      const total = warningReport.reduce((n, w) => n + w.warnings.length, 0)
      if (total) {
        console.warn(`[mp-transform] ⚠ 编译摘要：${warningReport.length} 个文件共 ${total} 条警告`)
        for (const w of warningReport) {
          console.warn(`  ${w.file}: ${w.warnings.join('；')}`)
        }
      }
    },
    generateBundle(_options, bundle) {
      // 删除 rollup 占位入口 chunk（真实 app.js 由 buildStart 直出为资产）
      delete bundle['mp-entry.js']
    },
  }
}
