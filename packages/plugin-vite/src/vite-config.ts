// packages/plugin-vite/src/vite-config.ts
// ★#418 配置收敛：vite 配置由框架组装（resolveProteusViteConfig）——开发者不写 vite.config.ts，
//   只写 proteus.config.ts（+ vite 透传字段做扩展）。完全兼容 vite：产物是标准 InlineConfig，
//   可被 vite createServer / build 直接消费；proteus.config 的 vite 字段（plugins/server/resolve…
//   全 vite 语义）合并在后（开发者覆盖优先）。
//   本逻辑 = create-proteus 模板原 vite.config.ts 的框架化（模板删除该文件，CLI 程序化驱动）
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { InlineConfig, Plugin, UserConfig } from 'vite'
import type { ProteusConfig } from '@proteus-vue/types'
import {
  platformDefines, applyPlatformMacrosInSfc,
  resolvePlatformVariant, resolvePlatformVariantWithExts,
  splitVariant, mapPublicAssetVariants,
} from '@proteus-vue/compiler'
import type { VariantPlatform } from '@proteus-vue/compiler'
import mpTransform, { MP_ONLY_TAGS } from './plugin'

export interface ProteusViteContext {
  /** 工程根（proteus.config.ts 所在目录） */
  root: string
  /** serve（dev server）| build */
  command: 'serve' | 'build'
  /** vite mode：web / mp-weixin */
  mode: string
}

export interface ProteusViteResult {
  /** 标准 vite InlineConfig（可直接喂 createServer / build） */
  config: InlineConfig
  /** mp 目标：是否需要先跑 gen-routes（CLI 在 vite 启动前执行） */
  needsGenRoutes: boolean
  /** mp 目标：是否有 mp-entry（虚拟模块由框架插件直出 app.js 骨架） */
  platform: 'web' | 'mp-weixin'
}

/** ★平台编译期宏 Web 通道（2026-09-13）：在 vue 插件编译 .vue 前做**源码级**宏替换。
 *  为什么不用 vite define：实测 define 对 .vue 模板表达式/script 内标识符无效（残留 __MP__）；
 *  前置替换后 `v-if="false"` 由 Vue 编译为死分支 + rollup tree-shake 消除。
 *  仅处理 .vue（.ts/.js 模块由 define 通道处理）。与 MP 端 applyPlatformMacros 同源取值。 */
function platformMacroPlugin(platform: VariantPlatform): Plugin {
  return {
    name: 'proteus-platform-macros',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.vue')) return null
      const out = applyPlatformMacrosInSfc(code, platform)
      return out === code ? null : { code: out, map: null }
    },
  }
}

/** ★平台变体解析 Web 通道（2026-09-13，工程架构基础层）：`foo.web.ts`/`foo.mp.ts` 文件级分叉。
 *  在 Vite 默认解析**之前**介入：相对/别名导入若存在目标平台变体 → 解析到变体；否则回退基准。
 *  同一插件同时覆盖**业务代码(.ts/.js)**与**静态资源(.png/.svg…)**——Vite 后续按扩展名自动处理。
 *  死文件（他端变体）不参与解析 → 天然不进产物。与 MP 端同源规则（platform-variant.ts）。 */
function platformVariantPlugin(root: string, platform: VariantPlatform): Plugin {
  const CODE_EXTS = ['.ts', '.js', '.mjs', '.cjs', '.vue', '.json', '.css']
  return {
    name: 'proteus-platform-variant',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer || !id) return null
      // ★剥离 query（vue 插件为 `<style src>` / `?vue&type=style` 等生成的子请求带 query）：
      //   否则 `./x.css?vue&type=style` 会被当作带扩展名的路径、变体解析落空 → ENOENT。
      const qIdx = id.indexOf('?')
      const query = qIdx >= 0 ? id.slice(qIdx) : ''
      const bare = qIdx >= 0 ? id.slice(0, qIdx) : id
      if (!bare) return null
      // 仅处理相对导入与 `@/` 别名（裸模块交由 Vite/依赖预构建）
      let base: string
      if (bare.startsWith('.')) base = path.resolve(path.dirname(importer), bare)
      else if (bare.startsWith('@/')) base = path.resolve(root, 'src', bare.slice(2))
      else return null
      const hasExt = path.extname(base) !== ''
      if (hasExt) {
        const r = resolvePlatformVariant(base, platform, fs.existsSync)
        // 变体命中且与基准不同 → 交给 Vite 加载变体（保留 query）；否则不介入（Vite 正常解析基准）
        return r && r !== base ? r + query : null
      }
      const r = resolvePlatformVariantWithExts(base, CODE_EXTS, platform, fs.existsSync)
      return r ? r + query : null
    },
  }
}

/** public/ 下是否存在平台变体文件（`*.web.*` / `*.mp.*` / `*.skyline.*`）。 */
function hasPublicVariants(publicDir: string): boolean {
  if (!fs.existsSync(publicDir)) return false
  const walk = (dir: string): boolean => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (walk(full)) return true
      } else if (splitVariant(e.name).platform !== undefined) {
        return true
      }
    }
    return false
  }
  return walk(publicDir)
}

/** ★平台变体·静态资源 Web 通道（第 3 层）：按 web 解析 public/，产物路径去变体后缀。
 *  （Vite 默认逐字拷贝会把他端变体也带进产物，故含变体时以本插件替代。） */
function platformPublicAssetsPlugin(root: string, platform: VariantPlatform): Plugin {
  return {
    name: 'proteus-platform-public-assets',
    apply: 'build',
    generateBundle() {
      const publicDir = path.join(root, 'public')
      if (!fs.existsSync(publicDir)) return
      const rels: string[] = []
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else rels.push(path.relative(publicDir, full).replace(/\\/g, '/'))
        }
      }
      walk(publicDir)
      for (const { from, to } of mapPublicAssetVariants(rels, platform)) {
        this.emitFile({ type: 'asset', fileName: to, source: fs.readFileSync(path.join(publicDir, from)) })
      }
    },
  }
}

/** 兼容 <route> 自定义块（web 端构建不报错：vite 原生不认 .vue 的未知自定义块） */
function routeBlocksPlugin(): Plugin {
  return {
    name: 'proteus-route-blocks',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('?vue&type=route')) return { code: `export default ${code}`, map: null }
      return null
    },
  }
}

/** mp 入口虚拟模块：真实 app.js 由 mpTransform buildStart 直出为纯文本资产，rollup 输入只需占位 */
function virtualMpEntryPlugin(): Plugin {
  const VIRTUAL_ID = '\0proteus:mp-entry'
  return {
    name: 'proteus-mp-entry',
    resolveId(id) {
      return id === 'proteus:mp-entry' ? VIRTUAL_ID : null
    },
    load(id) {
      return id === VIRTUAL_ID ? 'export {}' : null
    },
  }
}

/** 从工程根动态解析模块（vite/@vitejs/plugin-vue 在工程 node_modules——CLI 全局安装而 vite 随工程） */
async function importFromRoot<T>(root: string, spec: string): Promise<T> {
  const req = createRequire(path.join(root, 'package.json'))
  const resolved = req.resolve(spec)
  return import(pathToFileURL(resolved).href) as Promise<T>
}

/** 组装框架 vite 配置（纯异步：vue 插件从工程 node_modules 动态解析） */
export async function resolveProteusViteConfig(
  ctx: ProteusViteContext,
  config: ProteusConfig,
): Promise<ProteusViteResult> {
  const { root, command, mode } = ctx
  const platform = mode === 'mp-weixin' || mode === 'web' ? (mode as 'web' | 'mp-weixin') : (config.platform as 'web' | 'mp-weixin')
  const isMp = platform === 'mp-weixin'
  const isDebug = process.env.PROTEUS_DEBUG === '1'

  let plugins: Plugin[]
  if (isMp) {
    const fcd = (config as { frameworkComponentsDir?: string }).frameworkComponentsDir
    plugins = [virtualMpEntryPlugin(), mpTransform({ config, frameworkComponentsDir: fcd ? path.resolve(root, fcd) : undefined })]
  } else {
    const vueMod = await importFromRoot<{ default: (opts?: Record<string, unknown>) => Plugin }>(root, '@vitejs/plugin-vue')
    // ★平台宏 Web 通道（enforce:'pre'）：在 @vitejs/plugin-vue 编译 .vue **之前**做源码级宏替换——
    //   实测 vite `define` 对 .vue 模板/script 内标识符无效（会残留）；前置替换后 `v-if="false"` 由
    //   Vue 编译 + rollup tree-shake 天然消除死分支。与 MP 端 compileVueSfc 的 applyPlatformMacros 同源。
    // ★isCustomElement：组件模板里可能同时存在**平台专用原生标签**（如 MP 的 picker-view）——它们位于
    //   平台死分支（`v-if="!isWeb"`）不会渲染，但 **Vue 会把 resolveComponent 提升到 render 顶部**，
    //   仍会尝试解析 → Web 控制台报「Failed to resolve component: picker-view」。声明为自定义元素即消除。
    const vue = vueMod.default({
      template: { compilerOptions: { isCustomElement: (tag: string) => MP_ONLY_TAGS.has(tag) } },
    })
    plugins = [platformVariantPlugin(root, 'web'), vue, platformMacroPlugin('web'), platformPublicAssetsPlugin(root, 'web'), routeBlocksPlugin()]
  }

  // —— 框架内置配置（原模板 vite.config.ts 逻辑）——
  const frameworkConfig: InlineConfig = {
    configFile: false, // ★#418：vite 配置由本函数组装——不读 vite.config.ts（CLI 是唯一驱动）
    root,
    define: {
      // devtools 打通：dev serve 默认开启可观测；build 默认关闭零开销；PROTEUS_DEBUG=1 强制生产调试
      __PROTEUS_DEBUG__: command === 'serve' || isDebug,
      // Skyline 开关注入：mp 构建时 __PROTEUS_SKYLINE__ = config.skyline
      __PROTEUS_SKYLINE__: isMp && config.skyline,
      // ★平台编译期宏（条件显隐）——Web 端 .vue 走标准 @vitejs/plugin-vue：**vite define 对 .vue 不生效**
      //   （实测：模板表达式/script 内 __MP__ 残留），故 Web 端由 platformMacroPlugin（enforce:'pre'
      //   源码替换）处理，见 plugins。这里仍保留 define 供**非 .vue 的 .ts/.js 模块**使用（同源取值）。
      ...platformDefines(isMp ? 'mp' : 'web'),
    },
    plugins,
    // ★平台变体·静态资源 Web 通道（第 3 层）：public/ 含平台变体（logo.web.png）时，
    //   关掉 Vite 默认逐字拷贝（会把他端变体也拷进产物），改由 platformPublicAssetsPlugin 按 web 解析；
    //   无变体时保持默认（零侵入，避免改变既有工程行为）。
    publicDir: hasPublicVariants(path.join(root, 'public')) ? false : undefined,
    resolve: {
      alias: [{ find: '@', replacement: path.join(root, 'src') }],
    },
    build: {
      target: 'es2018',
      cssCodeSplit: false,
      minify: isMp ? false : undefined,
      outDir: path.join(root, 'dist', platform),
      emptyOutDir: !isMp,
      rollupOptions: isMp
        ? { input: 'proteus:mp-entry', output: { entryFileNames: 'mp-entry.js' } }
        : undefined,
    },
  }

  // —— 开发者扩展合并（proteus.config.vite：对象或 (ctx) => 对象；plugins 追加、build 深合并）——
  const userVite = config.vite
  let user: UserConfig | undefined | void
  if (typeof userVite === 'function') {
    // ★async 支持（examples module manualChunks 需 async 扫描）
    user = await userVite({ command, mode })
  } else if (userVite && typeof userVite === 'object') {
    user = userVite
  }
  if (user) {
    const { plugins: userPlugins, resolve: userResolve, define: userDefine, build: userBuild, ...rest } = user
    Object.assign(frameworkConfig, rest)
    // build 深合并（3 层）：保留框架默认 outDir/emptyOutDir/minify/cssCodeSplit/target；
    //   rollupOptions 深合并（用户 input/maxParallelFileOps/output.manualChunks 逐键生效，mp 的 entryFileNames 保留）
    if (userBuild) {
      const fwBuild = (frameworkConfig.build ?? {}) as Record<string, unknown>
      const merged = { ...fwBuild }
      const ub = userBuild as Record<string, unknown>
      for (const k of Object.keys(ub)) {
        const uv = ub[k]
        if (k === 'rollupOptions' && uv && typeof uv === 'object') {
          const fwRo = (fwBuild.rollupOptions ?? {}) as Record<string, unknown>
          const uRo = uv as Record<string, unknown>
          const ro = { ...fwRo }
          for (const rk of Object.keys(uRo)) {
            const rv = uRo[rk]
            if (rk === 'output' && rv && typeof rv === 'object' && fwRo.output && typeof fwRo.output === 'object') {
              ro.output = { ...(fwRo.output as object), ...(rv as object) }
            } else {
              ro[rk] = rv
            }
          }
          merged.rollupOptions = ro
        } else {
          merged[k] = uv
        }
      }
      frameworkConfig.build = merged as InlineConfig['build']
    }
    // resolve/define/plugins 追加语义（框架默认别名 @ 与 define 注入不可被覆盖）
    if (userResolve) {
      const baseAlias = (frameworkConfig.resolve as { alias?: unknown })?.alias
      frameworkConfig.resolve = {
        ...(userResolve as object),
        alias: [...(Array.isArray(baseAlias) ? baseAlias : []), ...(Array.isArray(userResolve.alias) ? userResolve.alias : [])],
      }
    }
    if (userDefine) {
      frameworkConfig.define = { ...(frameworkConfig.define as object), ...(userDefine as object) }
    }
    if (userPlugins?.length) frameworkConfig.plugins = [...(frameworkConfig.plugins ?? []), ...userPlugins]
  }

  return { config: frameworkConfig, needsGenRoutes: isMp, platform }
}
