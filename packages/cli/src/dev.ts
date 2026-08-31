// packages/cli/src/dev.ts
// ★cli-plus G-33 M1：proteus dev —— dev server 骨架（01-cli.md §2，复用 Vite）
// runDev 为纯函数（返回 spawn 参数，不实际启动）——便于单测；index.ts 层 spawn + stdio 继承
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

/** 生成 spawn 计划（纯函数）：web → Vite dev server；skyline → MP watch 构建；app 端待 M3 */
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
