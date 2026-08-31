// packages/cli/src/mp-e2e.ts
// ★test-framework B5：小程序 E2E 链路（05-e2e-mp-automator.md）——IDE 路径可配置 + 启动 + 端口就绪 + 执行
// 探测顺序：环境变量 PROTEUS_IDE_CLI → 平台默认路径（macOS/Windows）→ 找不到 → 清晰报错（含配置指引）
// 纯函数可单测（resolveMpIdeCli 注入 paths / planMpE2E 返回执行计划）；真机运行需 IDE（GUI 环境）
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** 各平台微信开发者工具 CLI 常见路径（macOS / Windows；按版本/安装位置回退） */
export const MP_IDE_DEFAULT_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    '/Applications/微信web开发者工具.app/Contents/MacOS/cli',
    '/Applications/wechat-devtools.app/Contents/MacOS/cli',
  ],
  win32: [
    'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
    'C:\\Program Files (x86)\\Tencent\\微信开发者工具\\cli.bat',
    path.join(process.env.LOCALAPPDATA ?? 'C:\\Users\\default', '微信开发者工具', 'cli.bat'),
  ],
}

export interface MpIdeOptions {
  /** 显式指定 CLI 路径（proteus test e2e:mp --ide <path>） */
  override?: string
  /** 环境变量（注入测试；缺省 process.env） */
  env?: NodeJS.ProcessEnv
  /** 平台默认路径表（注入测试；缺省 MP_IDE_DEFAULT_PATHS[platform]） */
  defaultPaths?: string[]
  /** 平台键（缺省 process.platform） */
  platform?: string
  /** 路径存在性检查（注入测试；缺省 fs.existsSync） */
  exists?: (p: string) => boolean
}

/** 解析 IDE CLI 路径：PROTEUS_IDE_CLI 环境变量 → 平台默认路径；全部缺失 → null */
export function resolveMpIdeCli(opts: MpIdeOptions = {}): string | null {
  const env = opts.env ?? process.env
  const exists = opts.exists ?? fs.existsSync
  const override = opts.override ?? env.PROTEUS_IDE_CLI
  if (override && exists(override)) return override
  const platform = opts.platform ?? process.platform
  const candidates = opts.defaultPaths ?? MP_IDE_DEFAULT_PATHS[platform] ?? []
  for (const p of candidates) {
    if (exists(p)) return p
  }
  return null
}

export interface MpE2EPlan {
  /** IDE CLI 路径（resolveMpIdeCli 结果） */
  ideCli: string
  /** 小程序产物目录（dist/mp-weixin） */
  projectDir: string
  /** automator 调试端口 */
  port: number
  /** 是否需先构建（产物缺失） */
  needBuild: boolean
  /** 执行步骤说明 */
  steps: string[]
}

/** 规划 MP E2E 执行（纯函数）：无 IDE → throw（含安装/配置指引）；产物缺失 → needBuild 提示 */
export function planMpE2E(opts: { root?: string; port?: number; ideCli?: string | null; projectDir?: string; exists?: (p: string) => boolean }): MpE2EPlan {
  const exists = opts.exists ?? fs.existsSync
  const port = opts.port ?? 9420
  const ideCli = opts.ideCli === undefined ? resolveMpIdeCli() : opts.ideCli
  if (!ideCli) {
    throw new Error(
      '未找到微信开发者工具 CLI（B5 automator 需 GUI 环境）。配置方式：\n' +
        '  ① 环境变量：PROTEUS_IDE_CLI="/path/to/wechatwebdevtools.app/Contents/MacOS/cli" proteus test e2e:mp\n' +
        '  ② 参数：proteus test e2e:mp --ide <cli 路径>\n' +
        '  ③ 安装微信开发者工具（默认路径自动探测：/Applications/wechatwebdevtools.app/...）',
    )
  }
  const projectDir = opts.projectDir ?? path.resolve(opts.root ?? '.', 'dist/mp-weixin')
  const needBuild = !exists(projectDir)
  const steps = [
    `[proteus] MP E2E：IDE CLI ${ideCli}（port ${port}）`,
    `[proteus] 项目产物：${projectDir}${needBuild ? '（⚠ 缺失，需先 npm run build:mp）' : ''}`,
    `[proteus] 启动 IDE：${ideCli} auto --project ${projectDir} --auto-port ${port}`,
    '[proteus] 等待 automator 端口就绪 → vitest 跑 tests/e2e-mp-smoke.test.ts（PROTEUS_MP_E2E=1）',
  ]
  return { ideCli, projectDir, port, needBuild, steps }
}

/** 轮询 automator 端口就绪（IDE 启动后 WS 服务可连；超时返回 false） */
export function waitForAutomatorPort(port: number, timeoutMs = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tryConnect = (): void => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) resolve(false)
        else setTimeout(tryConnect, 1000)
      })
    }
    tryConnect()
  })
}
