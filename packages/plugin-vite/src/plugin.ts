// packages/plugin-vite/src/plugin.ts
// ============================================================
// Proteus 编译管线 · Vite 适配层（薄）—— @proteus-vue/plugin-vite
//
// 编译引擎本体在 @proteus-vue/compiler（纯函数、零 Vite/配置耦合，可独立使用）。
// 本文件只做三件事：
//   1. 读取调用方传入的 ProteusConfig（拆包步骤 5：不再 import 项目 config，由 vite.config 注入）
//   2. 扫描 pagesDir + subPackages 下所有 .vue
//   3. 调 compileVueSfc() 并把 wxml/js/wxss emitFile 到 dist/mp-weixin
//
// 仅在 mode=mp-weixin 时注入（Web 端零转换，§0.3 原则 2）。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { transform as esbuildTransform, build as esbuildBuild } from 'esbuild'
import * as sass from 'sass'
import type { Plugin } from 'vite'
import { compileVueSfc } from '@proteus-vue/compiler'
import type { TransformRuleOverrides } from '@proteus-vue/compiler'
import type { ProteusConfig } from './config'
import { APP_LAUNCH_SKELETON } from './appSkeleton'
import { createCompileCache, compileCacheKey, createBundleCache, bundleCacheKey } from './cache'

/**
 * ★默认 scoped + 小程序语义标签改写（2026-08 用户决策）：
 * ① <style>（无 scoped/global）→ <style scoped>；<style global> 改回 <style>——与 MP 编译器默认 scoped 语义对齐
 * ② 小程序语义标签（view/text/button/input/image）→ proteus-*（带连字符）——★Vue 编译器只对带连字符标签
 *   resolveComponent（无连字符标签永远编译为原生元素，运行时注册 view 组件不生效——CDP 实测）
 * enforce: pre 先于 @vitejs/plugin-vue 拿到改写后的 SFC。幂等：proteus-* 不再改写。
 */
const MP_TAG_MAP: Record<string, string> = {
  view: 'proteus-view',
  text: 'proteus-text',
  button: 'proteus-button',
  input: 'proteus-input',
  image: 'proteus-image',
}

export function defaultScopedPlugin(): Plugin {
  return {
    name: 'proteus-default-scoped',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.vue')) return null
      let out = code.replace(/<style\b([^>]*)>/g, (m: string, attrs: string) => {
        if (/\bscoped\b/.test(attrs)) return m
        if (/\bglobal\b/.test(attrs)) return m.replace(/\bglobal\b\s*/, '')
        return m.replace(/^<style/, '<style scoped')
      })
      // 小程序语义标签 → proteus-*（<view / > / </view>；边界 \s|/?> 避免误伤 <viewer>）
      out = out.replace(/<(\/)?(view|text|button|input|image)(\s|\/?>)/g, (m: string, close: string | undefined, tag: string, rest: string) => {
        return `<${close ?? ''}${MP_TAG_MAP[tag]}${rest}`
      })
      return out === code ? null : { code: out, map: null }
    },
  }
}

/** node_modules 包内路径解析（拆包步骤 7）：'node_modules/@proteus-vue/router/src/presets/x.ts' → 解析包根 + 子路径
 * ★2026-08：以 projectRoot 为基准（createRequire(projectRoot)）——vite config bundle 到 os.tmpdir 后
 *   import.meta.url 基准失效，模块级 require 找不到项目 node_modules */
// 注：resolveSharedModule 仍用模块级 require（真实构建验证可解析 @proteus-vue/* 共享模块）；
//   指纹（cache.ts）与包内路径解析（本函数）改 projectRoot 基准
const require = createRequire(import.meta.url)
export function resolvePkgPath(projectRoot: string, modPath: string): string {
  // 支持 scoped 包（@proteus-vue/router）与非 scoped 包
  const m = modPath.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\/([\s\S]+)$/)
  if (m) {
    try {
      const pkgRequire = createRequire(path.join(projectRoot, 'package.json'))
      const pkgRoot = path.dirname(pkgRequire.resolve(`${m[1]}/package.json`))
      return path.join(pkgRoot, m[2])
    } catch {
      // 包未安装（如模板构建前的预检）：回退 projectRoot 相对路径
    }
  }
  return path.join(projectRoot, modPath)
}

/** CSS 预处理器（v0.3 尾）：<style lang="scss/sass/less"> → css（经 preprocessStyle 钩子注入编译器） */
function preprocessStyle(lang: string, content: string): string {
  if (lang === 'scss' || lang === 'sass') {
    try {
      return sass.compileString(content).css
    } catch (err) {
      console.warn(`[mp-transform] scss 编译失败（原样输出）：${(err as Error).message}`)
      return content
    }
  }
  if (lang === 'less') {
    console.warn('[mp-transform] less 预处理器暂未内置（MVP 仅 scss），已原样输出')
    return content
  }
  return content
}

/**
 * ★module-plan B0 + platform-plan B5 尾：共享模块解析（纯函数可测）
 * - 相对路径（本地 .ts/.js）→ 产物相对 appDir 路径
 * - @proteus-vue/*（框架包 dist）→ 产物 _proteus/<name>（白名单放行；微信 require 缓存同路径同实例）
 * - 其余裸模块（vue/pinia 等第三方）→ null（不参与）
 */
export function resolveSharedModule(
  appDir: string,
  absFrom: string,
  source: string,
  frameworkDir?: string,
): { file: string; relNoExt: string } | null {
  if (source.startsWith('@proteus-vue/')) {
    try {
      const pkgRoot = path.dirname(require.resolve(`${source}/package.json`))
      const entry = path.join(pkgRoot, 'dist', 'index.js')
      if (!fs.existsSync(entry)) return null
      return { file: entry, relNoExt: `_proteus/${source.replace('@proteus-vue/', '')}` }
    } catch {
      return null
    }
  }
  if (!source.startsWith('.')) return null // 其余裸模块（vue/pinia 等第三方）不参与
  const base = path.resolve(path.dirname(absFrom), source)
  for (const cand of [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
    if (cand.endsWith('.vue')) continue
    // ★B3 修复：必须是文件（existsSync 会把同名目录误匹配 → EISDIR）
    let isFile = false
    try {
      isFile = fs.statSync(cand).isFile()
    } catch {
      isFile = false
    }
    if (isFile) {
      let relNoExt = path.relative(appDir, cand).replace(/\\/g, '/').replace(/\.(ts|js)$/, '')
      // ★框架资产越界（仓库根 src/components 在 appDir 之外，如框架组件引 runtime/event）：
      //   重定位到 proteus/ 前缀（与框架组件产物一致，emitFile 不允许 ../ 越界路径）
      if (relNoExt.startsWith('../') && frameworkDir && !path.relative(frameworkDir, cand).startsWith('..')) {
        relNoExt = `proteus/${path.relative(frameworkDir, cand).replace(/\\/g, '/').replace(/\.(ts|js)$/, '')}`
      }
      return { file: cand, relNoExt }
    }
  }
  return null
}

/**
 * 提取 builder 函数名：function xxxBuilder(...)
 */
export function extractBuilderFnName(code: string): string | null {
  const m = code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/)
  return m ? m[1] : null
}

/**
 * 组装 app.js：入口源码 + 内置预设 builder 函数定义 + 注册（纯函数，可单测）
 * 两种模式：
 *  ① 全量自定义（向后兼容）：入口含 App() → 原样保留入口，追加预设定义 + 注册块
 *  ② 极简模式（★默认推荐）：入口不含 App() → 自动拼装 app 骨架（App/调试/错误捕获/预设注册），
 *     开发者只需写自定义 builder（覆盖预设 / 新增预设），零样板
 * 注册块在模块顶层执行（官方文档形态），builder 与 addRouteBuilder 同文件静态可分析
 */
export function assembleAppJs(
  mainCode: string,
  presets: Array<{ name: string; fnName: string; source: string }>,
): string {
  const presetCode = presets.map((p) => p.source.trim()).join('\n\n')
  const custom = mainCode.trim()
  // 全量模式：顶层 if 块内的注册行（2 空格缩进）
  const registerLines = presets.map((p) => `  wx.router.addRouteBuilder('${p.name}', ${p.fnName})`)

  if (custom.includes('App(')) {
    // ① 全量自定义：入口已写 App()，尊重原样，仅追加预设定义 + 注册块
    const register = presets.length
      ? `\nif (typeof wx !== 'undefined' && wx.router) {\n${registerLines.join('\n')}\n}\n`
      : ''
    return `${custom}\n\n${presetCode}${register}`
  }

  // ② 极简模式：自动补全 app 骨架（App 包装 / 调试日志 / 错误捕获 / 预设注册）
  // 骨架内 if 块是 4 空格缩进，注册行对齐 6 空格
  const skeletonReg = presets.map((p) => `      wx.router.addRouteBuilder('${p.name}', ${p.fnName})`)
  const skeleton = APP_LAUNCH_SKELETON.replace('__PRESET_REGISTRATION__', skeletonReg.join('\n') || '      // 无内置预设')
  return `${custom ? `${custom}\n\n` : ''}${presetCode ? `${presetCode}\n\n` : ''}${skeleton}`
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

/** 读取并转译内置预设 builders（供内联进 app.js）；config 由调用方注入（拆包步骤 5） */
async function loadPresetBuilders(
  projectRoot: string,
  cfg: ProteusConfig,
): Promise<Array<{ name: string; fnName: string; source: string }>> {
  const presets: Array<{ name: string; fnName: string; source: string }> = []
  for (const [name, modPath] of Object.entries(cfg.customRoute.builders)) {
    const abs = resolvePkgPath(projectRoot, modPath)
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
  /** ★拆包步骤 5：完整 ProteusConfig（由 vite.config 从项目 proteus.config.ts 注入） */
  config: ProteusConfig
  /** 样式换算（缺省取 config.style.px2rpx） */
  px2rpx?: boolean
  rpxRatio?: number
  /** ★底线循环 ①③：规则覆盖（缺省取 config.rules） */
  rules?: TransformRuleOverrides
  /**
   * ★框架内置组件目录（@proteus-vue/components 组件库拆包前的定位方式，决策 #115）：
   * 组件库未拆包，仓库在工程根之外（如 monorepo 根 src/components）时，工程显式传入绝对路径；
   * 缺省相对工程根 src/components（create-proteus 模板工程用）
   * ★v2.0 退役：@proteus-vue/components 拆为独立 npm 包后本选项删除（改 resolvePkgPath 包内路径，见 docs/packages.md）
   */
  frameworkComponentsDir?: string
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

export default function mpTransform(opts: PluginOptions): Plugin {
  const cfg = opts.config
  const px2rpx = opts.px2rpx ?? cfg.style.px2rpx
  const rpxRatio = opts.rpxRatio ?? cfg.style.rpxRatio
  const rules = opts.rules ?? cfg.rules
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
      const appDir = path.join(projectRoot, path.dirname(cfg.pagesDir))
      // ★build-plan M8：编译缓存（磁盘 node_modules/.cache/proteus/compile；PROTEUS_NO_CACHE=1 关闭）
      const compileCache = createCompileCache(path.join(projectRoot, 'node_modules', '.cache', 'proteus', 'compile'))
      const bundleCache = createBundleCache(path.join(projectRoot, 'node_modules', '.cache', 'proteus', 'bundle'))
      // 待编译文件：{ 绝对路径, 产物相对路径 }（框架组件 rel 规范化为 proteus/<name>/index）
      const files: Array<{ file: string; rel: string }> = []
      const pushRel = (dir: string) => {
        for (const f of walkVueFiles(dir)) {
          files.push({ file: f, rel: path.relative(appDir, f).replace(/\\/g, '/').replace(/\.vue$/, '') })
        }
      }
      pushRel(path.join(projectRoot, cfg.pagesDir))
      for (const sp of cfg.subPackages ?? []) {
        pushRel(path.join(projectRoot, sp.root))
      }
      // 组件系统（v0.3）：应用根 components/ 目录（约定 <appRoot>/components/<name>/index.vue）
      // isComponent 判定依赖路径含 /components/
      const appComponents = path.join(appDir, 'components')
      if (fs.existsSync(appComponents)) pushRel(appComponents)
      // 框架内置组件（v0.4，★定位修正：非示例组件）：src/components/<name>/index.vue
      // 产物路径规范化为 proteus/<name>/index（与应用组件 /components/... 隔离，gen-routes 同步解析）
      const frameworkComponents = opts.frameworkComponentsDir ?? path.join(projectRoot, 'src', 'components')
      if (fs.existsSync(frameworkComponents)) {
        for (const f of walkVueFiles(frameworkComponents)) {
          const relIn = path.relative(frameworkComponents, f).replace(/\\/g, '/').replace(/\.vue$/, '')
          files.push({ file: f, rel: `proteus/${relIn}` })
        }
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
        const presets = filterOverriddenPresets(code, await loadPresetBuilders(projectRoot, cfg))
        const appJs = assembleAppJs(code, presets)
          .replace(/__PROTEUS_DEBUG__/g, isDebug ? 'true' : 'false')
          .replace(/"worklet"/g, "'worklet'")
        this.emitFile({ type: 'asset', fileName: 'app.js', source: appJs })
        console.log(`[mp-transform] app.js 已直出（${isDebug ? 'debug' : '正式'}），内置预设：${presets.map((p) => p.name).join('/') || '无'}`)
      }
      // ★module-plan B0 + platform-plan B5 尾：跨模块引用——扫描页面/组件 import 的共享模块（相对路径 .ts/.js + @proteus-vue/* 框架包）→ esbuild bundle 为 CJS 独立产物；
      //   页面/组件产物 import → require（相对产物路径）；vue/第三方 npm/.vue 不参与（编译器静态 / 体积过大跳过 / usingComponents）
      const moduleImportsByFile = new Map<string, Array<{ source: string; requirePath: string }>>()
      const sharedModules = new Set<string>()
      const sharedRelNoExt = new Map<string, string>() // 共享模块文件 → 产物相对路径（@proteus-vue/* → _proteus/<name>）
      /** 解析共享模块：相对路径（本地 .ts/.js）或 @proteus-vue/*（框架包 dist，产物 _proteus/<name>）→ 返回 { file, relNoExt } */
      const resolveShared = (absFrom: string, source: string): { file: string; relNoExt: string } | null =>
        resolveSharedModule(appDir, absFrom, source, frameworkComponents)
      const scanImports = (absFile: string): Array<{ source: string; typeOnly: boolean }> => {
        const src = fs.readFileSync(absFile, 'utf-8')
        // .vue 取 <script> 块；.ts/.js 共享模块直接用全文
        const script = src.includes('<script') ? (src.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '') : src
        const out: Array<{ source: string; typeOnly: boolean }> = []
        for (const m of script.matchAll(/import\s+(?:type\s+)?.*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/gm)) {
          const s = m[1] || m[2]
          if (s) out.push({ source: s, typeOnly: m[0].includes('import type') })
        }
        return out
      }
      for (const { file } of files) {
        const list: Array<{ source: string; requirePath: string }> = []
        for (const imp of scanImports(file)) {
          if (imp.typeOnly) continue
          const resolved = resolveShared(file, imp.source)
          if (!resolved) continue
          sharedModules.add(resolved.file)
          sharedRelNoExt.set(resolved.file, resolved.relNoExt)
          list.push({ source: imp.source, requirePath: '' }) // requirePath 待 BFS 后回填
        }
        if (list.length) moduleImportsByFile.set(file, list)
      }
      // BFS：共享模块内部 import（相对路径 + @proteus-vue/*）继续收集
      const pending = [...sharedModules]
      while (pending.length) {
        const cur = pending.pop()!
        for (const imp of scanImports(cur)) {
          if (imp.typeOnly) continue
          const resolved = resolveShared(cur, imp.source)
          if (!resolved || sharedModules.has(resolved.file)) continue
          sharedModules.add(resolved.file)
          sharedRelNoExt.set(resolved.file, resolved.relNoExt)
          pending.push(resolved.file)
        }
      }
      // ★B0 边界（★放行 @proteus-vue/* 框架包 + pinia 白名单）：含未白名单第三方裸依赖的共享模块树跳过编译
      // （pinia 是框架默认状态库——P3 放行，bundle 体积由 bundle-report 监控；其余第三方保持跳过）
      const THIRD_PARTY_ALLOW = new Set(['pinia', 'vue-demi', '@vue/reactivity', '@vue/shared', '@vue/runtime-core'])
      const hasThirdParty = new Set<string>()
      for (const sharedFile of sharedModules) {
        for (const imp of scanImports(sharedFile)) {
          if (imp.typeOnly) continue
          if (!imp.source.startsWith('.') && !imp.source.startsWith('@proteus-vue/') && !THIRD_PARTY_ALLOW.has(imp.source)) hasThirdParty.add(sharedFile)
        }
      }
      // 传递：被有第三方依赖模块 import 的共享模块也跳过（bundle 会把它们一起打进）
      const skipShared = new Set<string>()
      const markSkip = (f: string) => {
        if (skipShared.has(f)) return
        skipShared.add(f)
        for (const other of sharedModules) {
          if (other === f) continue
          const deps = scanImports(other).map((i) => resolveShared(other, i.source)?.file).filter(Boolean)
          if (deps.includes(f)) markSkip(other)
        }
      }
      for (const f of hasThirdParty) markSkip(f)
      if (skipShared.size) {
        console.warn(`[mp-transform] ⚠ ${skipShared.size} 个共享模块含第三方依赖（pinia/vue 等）已跳过编译（B0 MVP：仅支持纯逻辑 + @proteus-vue/* 框架包共享模块）——请用 store 桥 / 内联，Pinia 接入为后续批次`)
        // 页面侧回退：被跳过模块的 import 移出 moduleImports（compiler 走剥离 + 警告）
        for (const [file, list] of moduleImportsByFile) {
          moduleImportsByFile.set(file, list.filter((item) => !skipShared.has(resolveShared(file, item.source)?.file ?? '')))
        }
      }
      // 共享模块 → esbuild bundle（全内联 + @proteus-vue/* external 映射，minify）→ CJS 单文件输出
      // ★M8：bundle 缓存（输入快照 mtime+size 校验；PROTEUS_NO_CACHE=1 关闭）
      const bundleCacheEnabled = !process.env.PROTEUS_NO_CACHE && !isDebug
      for (const sharedFile of sharedModules) {
        if (skipShared.has(sharedFile)) continue
        const relNoExt = sharedRelNoExt.get(sharedFile) ?? ''
        let code = ''
        let bundleHit = false
        if (bundleCacheEnabled) {
          const bKey = bundleCacheKey(sharedFile, projectRoot)
          const cachedBundle = bundleCache.get(bKey)
          if (cachedBundle) {
            code = cachedBundle.output
            bundleHit = true
            console.log(`[mp-transform] bundle 缓存命中：${relNoExt}`)
          }
        }
        if (!code) {
          const build = await esbuildBuild({
            entryPoints: [sharedFile],
            bundle: true,
            format: 'cjs',
            write: false,
            target: 'es2018',
            charset: 'utf8',
            logLevel: 'silent',
            minify: true,
            metafile: true,
            // ★@proteus-vue/* external：运行时 require 产物 _proteus/<name>.js（微信 require 缓存同路径同实例）
            external: ['@proteus-vue/*'],
            plugins: [
              {
                name: 'proteus-pkg-require-path',
                setup(b) {
                  b.onResolve({ filter: /^@proteus-vue\// }, (args) => {
                    const pkgRel = `_proteus/${args.path.replace('@proteus-vue/', '')}.js`
                    const dir = path.posix.dirname(relNoExt)
                    let rel = path.posix.relative(dir, pkgRel)
                    if (!rel.startsWith('.')) rel = `./${rel}`
                    return { path: rel, external: true }
                  })
                },
              },
            ],
          })
          code = build.outputFiles[0]?.text ?? ''
          if (!code) {
            console.warn(`[mp-transform] 共享模块编译失败：${relNoExt}`)
            continue
          }
          if (bundleCacheEnabled && build.metafile) {
            // 记录输入集快照（mtime+size）——首次必然未命中（metafile 需要一次真实构建）
            const inputFiles = Object.keys(build.metafile.inputs)
            const inputs = inputFiles
              .map((f) => {
                try {
                  const st = fs.statSync(f)
                  return { file: f, mtimeMs: st.mtimeMs, size: st.size }
                } catch {
                  return null
                }
              })
              .filter((x): x is { file: string; mtimeMs: number; size: number } => x !== null)
            bundleCache.set(bundleCacheKey(sharedFile, projectRoot), { output: code, inputs })
          }
        }
        this.emitFile({ type: 'asset', fileName: `${relNoExt}.js`, source: code })
        console.log(`[mp-transform] 共享模块 → ${relNoExt}.js（${(code.length / 1024).toFixed(1)}KB，bundle 内联）`)
      }
      // 回填 requirePath：页面产物（rel.js）→ 共享模块产物相对路径
      for (const [file, list] of moduleImportsByFile) {
        const entry = files.find((f) => f.file === file)
        if (!entry) continue
        const pageDir = path.posix.dirname(entry.rel)
        for (const item of list) {
          const shared = resolveShared(file, item.source)
          if (!shared) continue
          const sharedRel = `${shared.relNoExt}.js`
          let rel = path.posix.relative(pageDir, sharedRel)
          if (!rel.startsWith('.')) rel = `./${rel}`
          item.requirePath = rel
        }
      }
      for (const { file, rel } of files) {
        const source = fs.readFileSync(file, 'utf-8')
        const isComponent = file.includes(`${path.sep}components${path.sep}`)
        // ★build-plan M8：编译缓存（PROTEUS_NO_CACHE=1 关闭；debug 构建跳过——sourcemap/行号注入与缓存互斥）
        const cacheEnabled = !process.env.PROTEUS_NO_CACHE && !isDebug
        let wxml: string
        let js: string
        let wxss: string
        let warnings: string[] = []
        let trace: unknown
        let sourcemap: string | undefined
        let cached = false
        if (cacheEnabled) {
          const key = compileCacheKey(
            source,
            {
              rel,
              isComponent,
              px2rpx,
              rpxRatio,
              rules: rules as Record<string, unknown> | undefined,
              moduleImports: moduleImportsByFile.get(file),
              annotateLines: isDebug,
              debug: isDebug,
            },
            projectRoot,
          )
          const entry = compileCache.get(key)
          if (entry) {
            wxml = entry.wxml
            js = entry.js
            wxss = entry.wxss
            warnings = entry.warnings
            cached = true
          } else {
            const result = compileVueSfc(source, {
              filename: rel,
              isComponent,
              px2rpx,
              rpxRatio,
              rules,
              moduleImports: moduleImportsByFile.get(file),
              annotateLines: isDebug,
              debug: isDebug,
              preprocessStyle,
            })
            wxml = result.wxml
            js = result.js
            wxss = result.wxss
            warnings = result.warnings
            trace = result.trace
            sourcemap = result.sourcemap
            compileCache.set(key, { wxml, js, wxss, warnings })
          }
        } else {
          const result = compileVueSfc(source, {
            filename: rel,
            isComponent,
            px2rpx,
            rpxRatio,
            rules,
            moduleImports: moduleImportsByFile.get(file),
            annotateLines: isDebug,
            debug: isDebug,
            preprocessStyle,
          })
          wxml = result.wxml
          js = result.js
          wxss = result.wxss
          warnings = result.warnings
          trace = result.trace
          sourcemap = result.sourcemap
        }

        if (cached) {
          console.log(`[mp-transform] 编译缓存命中：${rel}`)
        }

        // sourcemap（v0.3）：方法级 JS 源码映射，调试构建落盘 + js 尾部 sourceMappingURL（微信开发者工具可定位源码）
        const jsWithMap = sourcemap && isDebug ? `${js}//# sourceMappingURL=${rel}.js.map\n` : js
        this.emitFile({ type: 'asset', fileName: `${rel}.wxml`, source: wxml })
        this.emitFile({ type: 'asset', fileName: `${rel}.js`, source: jsWithMap })
        this.emitFile({ type: 'asset', fileName: `${rel}.wxss`, source: wxss })
        if (sourcemap && isDebug) {
          this.emitFile({ type: 'asset', fileName: `${rel}.js.map`, source: sourcemap })
        }
        if (isDebug) {
          // 反黑盒：中间产物转储，转换过程完全透明（★底线循环 ②：产物 + 决策链 一处定位）
          this.emitFile({
            type: 'asset',
            fileName: `.transform-debug/${rel}.json`,
            source: JSON.stringify({ file: rel, wxml, js, wxss, warnings, trace }, null, 2),
          })
        }
        if (warnings.length) warningReport.push({ file: rel, warnings })
        console.log(`[mp-transform] ${rel} → wxml/js/wxss 已输出`)
      }
      // ★build-plan M8：缓存统计（PROTEUS_NO_CACHE=1 或 debug 时无统计）
      if (!process.env.PROTEUS_NO_CACHE && !isDebug) {
        const st = compileCache.stats()
        const bs = bundleCache.stats()
        console.log(`[mp-transform] 编译缓存：${st.hits} 命中 / ${st.misses} 未命中（${files.length} 个文件）；bundle 缓存：${bs.hits} 命中 / ${bs.misses} 未命中（${sharedModules.size} 个共享模块）`)
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
