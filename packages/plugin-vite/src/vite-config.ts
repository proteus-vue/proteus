// packages/plugin-vite/src/vite-config.ts
// ★#418 配置收敛：vite 配置由框架组装（resolveProteusViteConfig）——开发者不写 vite.config.ts，
//   只写 proteus.config.ts（+ vite 透传字段做扩展）。完全兼容 vite：产物是标准 InlineConfig，
//   可被 vite createServer / build 直接消费；proteus.config 的 vite 字段（plugins/server/resolve…
//   全 vite 语义）合并在后（开发者覆盖优先）。
//   本逻辑 = create-proteus 模板原 vite.config.ts 的框架化（模板删除该文件，CLI 程序化驱动）
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import type { InlineConfig, Plugin, UserConfig } from 'vite'
import type { ProteusConfig } from '@proteus-vue/types'
import mpTransform from './plugin'

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
    plugins = [vueMod.default(), routeBlocksPlugin()]
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
    },
    plugins,
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
