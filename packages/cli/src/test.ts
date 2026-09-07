// packages/cli/src/test.ts
// ★test-framework：proteus test —— 测试入口（README 快速开始）
//   proteus test            → L1-L3（vitest run，含编译快照）
//   proteus test e2e:web    → Playwright（需先 build:web）
//   proteus test e2e:mp     → automator（★B5：IDE 路径可配置——PROTEUS_IDE_CLI 环境变量 / --ide 参数 / 平台默认探测）
// runTest 纯函数返回 spawn 计划（复用 dev.ts 模式）
export interface TestOptions {
  scope: 'unit' | 'e2e:web' | 'e2e:mp'
  /** e2e:mp：项目根目录（产物 dist/mp-weixin 相对该目录；缺省当前目录） */
  root?: string
  /** e2e:mp：IDE CLI 路径（--ide <path>；缺省走 PROTEUS_IDE_CLI → 平台默认路径探测） */
  ide?: string
  /** e2e:mp：automator 端口（--port <n>；缺省 9420） */
  port?: number
  /** e2e:mp：debugger 适配模块（--debugger <module>，MpDebuggerLike 形状——console/network/clearCache/refresh 注入） */
  debugger?: string
}

const SCOPES = ['unit', 'e2e:web', 'e2e:mp']

/** 解析 test 参数：proteus test [unit|e2e:web|e2e:mp [root]] [--ide <path>] [--port <n>] [--debugger <module>]（缺省 unit） */
export function parseTestArgs(argv: string[]): TestOptions {
  let ide: string | undefined
  let port: number | undefined
  let debuggerModule: string | undefined
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ide') {
      const v = argv[++i]
      if (!v) throw new Error('--ide 缺少值（如 --ide /path/to/cli）')
      ide = v
    } else if (a === '--port') {
      const v = argv[++i]
      if (!v || !/^\d+$/.test(v)) throw new Error(`--port 非法：${v}（需数字）`)
      port = Number(v)
    } else if (a === '--debugger') {
      const v = argv[++i]
      if (!v) throw new Error('--debugger 缺少值（如 --debugger ./e2e/mp-debugger.ts）')
      debuggerModule = v
    } else if (a.startsWith('--')) {
      throw new Error(`未知参数：${a}`)
    } else {
      positional.push(a)
    }
  }
  if (positional.length > 2) throw new Error(`多余参数：${positional.slice(2).join(' ')}`)
  const scope = (positional[0] ?? 'unit') as TestOptions['scope']
  if (SCOPES.indexOf(scope) < 0) throw new Error(`未知 scope：${scope}（允许：${SCOPES.join('/')}）`)
  // ★B5：e2e:mp 允许第二个位置参数 = 项目根目录（产物 dist/mp-weixin 相对该目录）；其余 scope 多余参数报错
  if (positional.length === 2 && scope !== 'e2e:mp') throw new Error(`多余参数：${positional[1]}（仅 e2e:mp 支持项目根目录）`)
  // ★debugger 仅 e2e:mp 支持（console/network/clearCache/refresh 是 MP 注入句柄）
  if (debuggerModule && scope !== 'e2e:mp') throw new Error('--debugger 仅 e2e:mp 支持（小程序 debugger 句柄注入）')
  const root = scope === 'e2e:mp' ? positional[1] : undefined
  return { scope, root, ide, port, debugger: debuggerModule }
}

/** 测试执行计划（纯函数）：unit → vitest run；e2e:web → 构建后 Playwright；e2e:mp → 需 IDE */
export function runTest(opts: TestOptions): { command: string; args: string[]; note?: string } {
  switch (opts.scope) {
    case 'unit':
      // ★排除 e2e：E2E 依赖真实构建产物 + Chromium，由 e2e:web 显式触发（与根 test 脚本一致；引号让 vitest 自己 picomatch glob）
      return { command: 'npx', args: ['vitest', 'run', '--exclude', 'tests/e2e-*.test.ts'] }
    case 'e2e:web':
      // ★B4：路由/渲染 + 关键路径两个文件；--no-file-parallelism 串行（Chromium 并发会 5s 超时）
      return {
        command: 'npx',
        args: ['vitest', 'run', '--no-file-parallelism', 'tests/e2e-web.test.ts', 'tests/e2e-web-keypaths.test.ts'],
        note: '需先执行 proteus build --target web（E2E 依赖真实构建产物）',
      }
    case 'e2e:mp':
      // ★B5：完整链路在 index.ts 执行（探测 IDE → 启动 → 端口就绪 → automator spec）；此处仅提示
      return {
        command: '',
        args: [],
        note: 'e2e:mp 需微信开发者工具（GUI）：PROTEUS_IDE_CLI 环境变量 / --ide 参数 / 平台默认路径探测；先 npm run build:mp 产出 dist/mp-weixin',
      }
  }
}
