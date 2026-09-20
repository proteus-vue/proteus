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

/**
 * ★委派防重入标记（2026-09-20 修外部实战报告第十一节第四条）。
 *
 * 遗留分支的实现是「spawn 工程自己的 `npm run build:web`」，而 create-proteus 模板里
 * `build:web` 的定义正是 `proteus build --target web`——**同一个命令**。于是只要工程里存在
 * `vite.config.ts`（比如用户按旧文档加的桥接文件），就会：
 *   `proteus build` → `npm run build:web` → `proteus build` → … 无限递归（实测：刷屏且无明确错误）。
 *
 * 修法：委派时在子进程环境里打标记；子进程再进来时若**同时**满足「有 legacy vite.config.ts」
 * 且「带着标记」（= 我就是被自己委派起来的），就**不再委派**，而是给出可执行的错误说明。
 * 不用「有标记就走程序化」是因为那会绕过用户 vite.config.ts 的配置，产出与预期不符的构建——
 * 报错让人明确选择（删掉 vite.config.ts，或把 npm script 指到真正的构建命令）更安全。
 */
export const DELEGATED_ENV = 'PROTEUS_DELEGATED'

/** 当前进程是否由 proteus 的委派分支拉起（见 DELEGATED_ENV） */
export function isDelegatedRun(): boolean {
  return process.env[DELEGATED_ENV] === '1'
}

/**
 * 委派前的重入检查：检测到「被委派 + 仍有 legacy vite.config.ts」的组合即判定为自递归。
 * @returns 递归时的错误提示（调用方抛错），否则 null
 */
export function detectDelegationLoop(root: string, script: string): string | null {
  if (!isDelegatedRun() || !hasLegacyViteConfig(root)) return null
  return (
    `检测到**自递归**：工程存在 vite.config.ts，${script} 被委派执行时又跑回了 proteus 自己。\n` +
    `  成因：package.json 里该脚本的命令就是 \`proteus build/dev\`（create-proteus 模板的默认写法），\n` +
    `        而遗留分支的判据恰好是「工程里有没有 vite.config.ts」→ 委派 → 又命中遗留分支 → 无限递归。\n` +
    `  修法（二选一）：\n` +
    `    ① 删掉 vite.config.ts——新版 CLI 会自组 vite 配置（推荐，模板已不含该文件）；\n` +
    `    ② 或把 package.json 里该脚本改成真正的构建命令（如 \`vite build\`），不再回调 proteus。`
  )
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
  if (resolved.needsGenRoutes) {
    // ★组件库已拆包（2026-09-14）：gen-routes 自行解析 @proteus-vue/components 包根（同 build.ts）
    runGenRoutes({ config: config as never, root })
  } else {
    // ★web 目标也须更新应用侧路由表（2026-09-19，同 build.ts）——否则 dev 期新增页面 404
    runGenRoutes({ config: config as never, root, webOnly: true })
  }
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
