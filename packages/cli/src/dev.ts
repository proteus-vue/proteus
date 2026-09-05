// packages/cli/src/dev.ts
// ★cli-plus G-33 M1：proteus dev —— dev server 骨架（01-cli.md §2，复用 Vite）
// ★#418 配置收敛：无 vite.config.ts 的工程走程序化驱动（resolveProteusViteConfig + vite createServer）
//   runDev 为纯函数（返回 spawn 参数，不实际启动）——保留供遗留 vite.config.ts 工程（index.ts 探测分发）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { loadProjectConfig } from './config-loader'
import { resolveProteusViteConfig, runGenRoutes } from '@proteus-vue/plugin-vite'

export interface DevOptions {
  target: string
}

export interface SpawnPlan {
  command: string
  args: string[]
  /** 工作目录（默认 cwd） */
  cwd?: string
}

const TARGETS = ['web', 'skyline', 'ios', 'android', 'harmony']

/** 解析 dev 参数：proteus dev [--target web|skyline]（默认 web；app 端 M3 原生同步后接入） */
export function parseDevArgs(argv: string[]): DevOptions {
  let target = 'web'
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--target') {
      target = argv[i + 1] ?? ''
      if (TARGETS.indexOf(target) < 0) throw new Error(`未知 target：${target}（允许：${TARGETS.join('/')}）`)
      i++
    } else if (!a.startsWith('-')) {
      positional.push(a)
    } else {
      throw new Error(`未知参数：${a}`)
    }
  }
  if (positional.length) throw new Error(`多余参数：${positional.join(' ')}`)
  return { target }
}

/** 工程是否有遗留 vite.config.ts（有 = 遗留工程，走 spawn 旧路径；无 = #418 新形态，程序化驱动） */
export function hasLegacyViteConfig(root: string): boolean {
  return fs.existsSync(path.join(root, 'vite.config.ts')) || fs.existsSync(path.join(root, 'vite.config.mts')) || fs.existsSync(path.join(root, 'vite.config.js'))
}

/** 遗留 spawn 计划（纯函数）：web → Vite dev server；skyline → MP watch 构建；app 端待 M3 */
export function runDev(opts: DevOptions): SpawnPlan {
  switch (opts.target) {
    case 'web':
      return { command: 'vite', args: ['--mode', 'web'] }
    case 'skyline':
      return { command: 'npx', args: ['tsx', 'scripts/dev-mp.ts'] }
    default:
      throw new Error(`target ${opts.target} 开发模式待 M3（原生工程自动同步）接入`)
  }
}

/** 从工程根解析 vite（CLI 安装与 vite 分离——vite 随工程 devDeps） */
/** 从工程根解析 vite（vite 随工程 devDeps；CLI 只声明驱动）——CJS/ESM 互操作解包 */
async function importViteFrom(root: string): Promise<typeof import('vite')> {
  const req = createRequire(path.join(root, 'package.json'))
  const resolved = req.resolve('vite')
  const mod = (await import(pathToFileURL(resolved).href)) as unknown as { default?: typeof import('vite') } & typeof import('vite')
  // vite 5 CJS 产物：named export 经互操作可能缺失——default 即完整模块
  return (mod.default && typeof mod.default.build === 'function' ? mod.default : mod) as typeof import('vite')
}

/**
 * ★#418 程序化 dev（无 vite.config.ts 的主路径）：加载 proteus.config.ts →
 * resolveProteusViteConfig（框架组装，含 vite 透传合并）→ vite createServer
 * mp 目标先跑 gen-routes（in-process，替代模板 scripts/gen-routes.ts）
 */
export async function runDevProgrammatic(opts: DevOptions, root = process.cwd()): Promise<() => Promise<void>> {
  const cfgFile = path.join(root, 'proteus.config.ts')
  if (!fs.existsSync(cfgFile)) throw new Error(`缺少 ${path.relative(root, cfgFile)}——proteus dev 需要框架配置驱动（create-proteus 模板自带）`)
  const config = (await loadProjectConfig(cfgFile)) as Record<string, unknown>
  const mode = opts.target === 'skyline' ? 'mp-weixin' : 'web'
  const resolved = await resolveProteusViteConfig({ root, command: 'serve', mode }, config as never)
  if (resolved.needsGenRoutes) runGenRoutes({ config: config as never, root })
  const vite = await importViteFrom(root)
  const server = await vite.createServer(resolved.config)
  await server.listen()
  // ★#421 dev 体验：CLI 显式打印本地/网络地址（vite CJS 下原生 printUrls 易被优化/警告输出淹没——地址是 dev 的第一诉求）
  const urls = server.resolvedUrls
  console.log('')
  console.log('[proteus] dev server 就绪：')
  if (urls?.local?.length) {
    for (const u of urls.local) console.log(`  ➜ Local:   ${u}`)
  }
  if (urls?.network?.length) {
    for (const u of urls.network) console.log(`  ➜ Network: ${u}`)
  }
  if (!urls?.local?.length) {
    const addr = server.httpServer?.address()
    if (addr && typeof addr === 'object') console.log(`  ➜ Local:   http://localhost:${addr.port}/`)
  }
  console.log('  Ctrl+C 退出')
  console.log('')
  return () => server.close()
}
