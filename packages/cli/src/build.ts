// packages/cli/src/build.ts
// proteus build —— 编译引擎独立可用（脱离 Vite）：扫描目录 .vue → 小程序四件套中的三件（wxml/js/wxss）
// 说明：.json（page.json/app.json）由路由生成器负责（框架内 scripts/gen-routes.ts），CLI 专注页面编译
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'
import type { TransformRuleOverrides } from '@proteus-vue/compiler'

export interface BuildOptions {
  outDir: string
  px2rpx: boolean
  rpxRatio: number
  /** 调试构建：行号注释 + 决策 trace 落盘 */
  debug: boolean
  rules?: TransformRuleOverrides
}

export interface BuildResult {
  files: string[]
  warnings: number
  traceFiles: string[]
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

/** 编译目录下所有 .vue → outDir（保持相对目录结构），返回统计 */
export function buildDir(inputDir: string, opts: BuildOptions): BuildResult {
  const files = walkVueFiles(inputDir)
  if (!files.length) throw new Error(`目录下没有 .vue 文件：${inputDir}`)
  let warnings = 0
  const traceFiles: string[] = []
  for (const file of files) {
    const rel = path.relative(inputDir, file).replace(/\\/g, '/').replace(/\.vue$/, '')
    const source = fs.readFileSync(file, 'utf-8')
    const isComponent = file.includes(`${path.sep}components${path.sep}`)
    const result = compileVueSfc(source, {
      filename: rel,
      isComponent,
      px2rpx: opts.px2rpx,
      rpxRatio: opts.rpxRatio,
      annotateLines: opts.debug,
      debug: opts.debug,
      rules: opts.rules,
    })
    for (const ext of ['wxml', 'js', 'wxss'] as const) {
      const outFile = path.join(opts.outDir, `${rel}.${ext}`)
      fs.mkdirSync(path.dirname(outFile), { recursive: true })
      fs.writeFileSync(outFile, result[ext])
    }
    if (opts.debug) {
      // 反黑盒：决策 trace 落盘（与框架 debug 构建一致，底线循环 ②）
      const traceFile = path.join(opts.outDir, `.transform-debug/${rel}.json`)
      fs.mkdirSync(path.dirname(traceFile), { recursive: true })
      fs.writeFileSync(
        traceFile,
        JSON.stringify({ file: rel, wxml: result.wxml, js: result.js, wxss: result.wxss, warnings: result.warnings, trace: result.trace }, null, 2),
      )
      traceFiles.push(traceFile)
    }
    warnings += result.warnings.length
  }
  return { files, warnings, traceFiles }
}
