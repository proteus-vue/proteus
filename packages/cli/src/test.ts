// packages/cli/src/test.ts
// ★test-framework：proteus test —— 测试入口（README 快速开始）
//   proteus test            → L1-L3（vitest run，含编译快照）
//   proteus test e2e:web    → Playwright（需先 build:web）
//   proteus test e2e:mp     → miniprogram-automator（需 IDE 运行）
// runTest 纯函数返回 spawn 计划（复用 dev.ts 模式）
export interface TestOptions {
  scope: 'unit' | 'e2e:web' | 'e2e:mp'
}

const SCOPES = ['unit', 'e2e:web', 'e2e:mp']

/** 解析 test 参数：proteus test [unit|e2e:web|e2e:mp]（缺省 unit） */
export function parseTestArgs(argv: string[]): TestOptions {
  const positional = argv.filter((a) => !a.startsWith('-'))
  const unknown = argv.filter((a) => a.startsWith('-'))
  if (unknown.length) throw new Error(`未知参数：${unknown.join(' ')}`)
  if (positional.length > 1) throw new Error(`多余参数：${positional.slice(1).join(' ')}`)
  const scope = (positional[0] ?? 'unit') as TestOptions['scope']
  if (SCOPES.indexOf(scope) < 0) throw new Error(`未知 scope：${scope}（允许：${SCOPES.join('/')}）`)
  return { scope }
}

/** 测试执行计划（纯函数）：unit → vitest run；e2e:web → 构建后 Playwright；e2e:mp → 需 IDE */
export function runTest(opts: TestOptions): { command: string; args: string[]; note?: string } {
  switch (opts.scope) {
    case 'unit':
      // ★排除 e2e：E2E 依赖真实构建产物 + Chromium，由 e2e:web 显式触发（与根 test 脚本一致）
      return { command: 'npx', args: ['vitest', 'run', '--exclude', 'tests/e2e-web.test.ts'] }
    case 'e2e:web':
      return { command: 'npx', args: ['vitest', 'run', 'tests/e2e-web.test.ts'], note: '需先执行 proteus build --target web（E2E 依赖真实构建产物）' }
    case 'e2e:mp':
      return { command: '', args: [], note: 'e2e:mp 需微信开发者工具运行（miniprogram-automator），CLI 仅提示' }
  }
}
