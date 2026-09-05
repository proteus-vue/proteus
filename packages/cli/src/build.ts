// packages/cli/src/build.ts
// proteus build —— 编译引擎独立可用（脱离 Vite）：扫描目录 .vue → 小程序四件套中的三件（wxml/js/wxss）
// 说明：.json（page.json/app.json）由路由生成器负责（框架内 scripts/gen-routes.ts），CLI 专注页面编译
// ★cli-plus M2：--target web|skyline|all 工程构建（复用项目 Vite 管线，spawn 计划纯函数）
// ★G-29 阶段 A：--compiler rust → 每页 Node/Rust 双编译语义等价校验（verifyDualCompilerEquivalence）——不一致构建红
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { compileVueSfc } from '@proteus-vue/compiler'
import type { TransformRuleOverrides } from '@proteus-vue/compiler'
import { resolveRustCliBin, verifyDualCompilerEquivalence } from '@proteus-vue/compiler-backend'
import { resolveProteusViteConfig, runGenRoutes } from '@proteus-vue/plugin-vite'
import { loadTsConfig } from './config-check'

/** ★G-29：Rust CLI 定位缓存（按 root 键控——buildDir 全目录共享一次 resolve，避免逐文件 require.resolve） */
const rustBinCache = new Map<string, string | null>()

function rustBin(projectRoot: string): string | null {
  if (!rustBinCache.has(projectRoot)) rustBinCache.set(projectRoot, resolveRustCliBin(projectRoot))
  return rustBinCache.get(projectRoot) ?? null
}

export interface BuildOptions {
  outDir: string
  px2rpx: boolean
  rpxRatio: number
  /** 调试构建：行号注释 + 决策 trace 落盘 */
  debug: boolean
  rules?: TransformRuleOverrides
  /** ★G-29 编译器后端插拔：'rust' → 每页 Node/Rust 双编译等价校验（G-29.1）——不一致构建红 */
  compiler?: 'node' | 'rust'
  /** Rust CLI 定位基准根（缺省 cwd——测试注入） */
  root?: string
}

export interface BuildResult {
  files: string[]
  warnings: number
  traceFiles: string[]
  /** ★G-29 rust 校验统计（compiler=rust 时） */
  dualCheck?: { ok: number; skipped: number; skippedReason?: string }
}

/** ★cli-plus M2：target → 项目构建脚本名（模板约定，create-proteus 生成的标准脚本） */
export const TARGET_BUILD_SCRIPTS: Record<'web' | 'skyline', string> = {
  web: 'build:web',
  skyline: 'build:mp', // mp-weixin = Skyline 小程序包
}

/** 从工程根解析 vite（vite 随工程 devDeps；CLI 只声明驱动）——CJS/ESM 互操作解包 */
async function importViteFrom(root: string): Promise<typeof import('vite')> {
  const req = createRequire(path.join(root, 'package.json'))
  const resolved = req.resolve('vite')
  const mod = (await import(pathToFileURL(resolved).href)) as unknown as { default?: typeof import('vite') } & typeof import('vite')
  // vite 5 CJS 产物：named export 经互操作可能缺失——default 即完整模块
  return (mod.default && typeof mod.default.build === 'function' ? mod.default : mod) as typeof import('vite')
}

/** 工程是否有 vue-tsc（类型检查步骤；缺省跳过 + 提示，不阻断） */
function hasVueTsc(root: string): boolean {
  try {
    createRequire(path.join(root, 'package.json')).resolve('vue-tsc')
    return true
  } catch {
    return false
  }
}

/**
 * ★#418 程序化工程构建（无 vite.config.ts 的主路径）：加载 proteus.config.ts →
 * gen-routes（mp，in-process）→ vue-tsc（工程有则跑）→ vite build（框架组装配置）
 * 返回 { ok, target, outDir }——纯异步（测试注入 root）
 */
export async function runTargetedBuildProgrammatic(
  target: 'web' | 'skyline' | 'all',
  root = process.cwd(),
): Promise<{ ok: boolean; results: Array<{ target: string; ok: boolean }> }> {
  const cfgFile = path.join(root, 'proteus.config.ts')
  if (!fs.existsSync(cfgFile)) throw new Error(`缺少 ${path.relative(root, cfgFile)}——proteus build 需要框架配置驱动（create-proteus 模板自带）`)
  const config = (await loadTsConfig(cfgFile)) as Record<string, unknown>
  const targets = target === 'all' ? (['web', 'skyline'] as const) : ([target] as const)
  const results: Array<{ target: string; ok: boolean }> = []
  for (const t of targets) {
    const mode = t === 'skyline' ? 'mp-weixin' : 'web'
    console.log(`[proteus] build --target ${t}（${mode}）`)
    const resolved = await resolveProteusViteConfig({ root, command: 'build', mode }, config as never)
    if (resolved.needsGenRoutes) {
      runGenRoutes({ config: config as never, root })
    }
    // 类型检查（工程有 vue-tsc 才跑；与模板 build:web/build:mp 的 vue-tsc --noEmit 对齐）
    if (hasVueTsc(root)) {
      const { spawnSync } = await import('node:child_process')
      const r = spawnSync('npx', ['vue-tsc', '--noEmit'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
      if (r.status !== 0) {
        console.error(`[proteus] vue-tsc 类型检查失败（exit ${r.status}）`)
        results.push({ target: t, ok: false })
        continue
      }
    } else {
      console.warn('[proteus] 工程未安装 vue-tsc——跳过类型检查（建议安装以对齐模板门禁）')
    }
    const vite = await importViteFrom(root)
    try {
      await vite.build(resolved.config)
      results.push({ target: t, ok: true })
    } catch (e) {
      console.error(`[proteus] vite build 失败：${(e as Error).message}`)
      results.push({ target: t, ok: false })
    }
  }
  return { ok: results.every((r) => r.ok), results }
}

/** 工程构建计划（纯函数）：校验 package.json 脚本存在性 → spawn 参数列表（M2，复用 Vite 管线） */
export function planTargetedBuild(root: string, target: 'web' | 'skyline' | 'all'): { command: string; args: string[]; script: string }[] {
  const pkgPath = path.join(root, 'package.json')
  let scripts: Record<string, string> = {}
  if (fs.existsSync(pkgPath)) {
    try {
      scripts = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts ?? {}) as Record<string, string>
    } catch {
      scripts = {}
    }
  }
  const targets = target === 'all' ? (['web', 'skyline'] as const) : [target]
  const plans: { command: string; args: string[]; script: string }[] = []
  for (const t of targets) {
    const script = TARGET_BUILD_SCRIPTS[t]
    if (!scripts[script]) {
      throw new Error(`工程缺构建脚本 ${script}（package.json scripts 未定义；create-proteus 模板默认生成）`)
    }
    plans.push({ command: 'npm', args: ['run', script], script })
  }
  return plans
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
  const root = opts.root ?? process.cwd()
  // ★G-29：compiler=rust → 每页先跑 Node/Rust 双编译语义等价校验（fail fast——不一致不产出）
  const useRust = opts.compiler === 'rust'
  const rustBinPath = useRust ? rustBin(root) : null
  const dualCheck: { ok: number; skipped: number; skippedReason?: string } | undefined = useRust ? { ok: 0, skipped: 0 } : undefined
  for (const file of files) {
    if (useRust) {
      const source = fs.readFileSync(file, 'utf-8')
      const v = verifyDualCompilerEquivalence(source, { rustBin: rustBinPath, filename: file })
      if (v.status === 'ok') {
        dualCheck!.ok++
      } else if (v.status === 'skipped') {
        dualCheck!.skipped++
        dualCheck!.skippedReason = v.reason
      } else {
        throw new Error(`[proteus] G-29.1 双编译语义不等价：${path.relative(root, file)}\n  ${v.details.join('\n  ')}（${v.reason}）——产物未生成；如需 Node 引擎请用 --compiler node`)
      }
    }
  }
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
  return { files, warnings, traceFiles, dualCheck }
}
