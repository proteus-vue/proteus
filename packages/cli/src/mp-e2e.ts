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
    '[proteus] automator launch：spawn IDE（auto --trust-project）+ 轮询连接 + checkVersion（官方 SDK 路径）',
    '[proteus] spec：reLaunch 首页 → data 断言 → disconnect（铁律：用例独立运行）',
  ]
  return { ideCli, projectDir, port, needBuild, steps }
}

/** 轮询 automator 端口就绪（IDE 启动后 WS 服务可连；超时返回 false）——★双栈探测（IPv4+IPv6，同 probePort 踩坑） */
export function waitForAutomatorPort(port: number, timeoutMs = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const hosts = ['127.0.0.1', '::1']
    const tryConnect = (): void => {
      let idx = 0
      const attempt = (): void => {
        if (idx >= hosts.length) {
          if (Date.now() > deadline) resolve(false)
          else setTimeout(tryConnect, 1000)
          return
        }
        const host = hosts[idx++]
        const socket = net.connect({ port, host })
        socket.once('connect', () => {
          socket.destroy()
          resolve(true)
        })
        socket.once('error', () => {
          socket.destroy()
          attempt()
        })
      }
      attempt()
    }
    tryConnect()
  })
}

// ============ ★B5 框架化：环境体检 + 产物副本（2026-08-31 真机实测坑内化） ============

/** 占位/游客 appid（automator 需真实 appid，实测 wx0000000000 / touristappid 均被 IDE 拒绝） */
export const PLACEHOLDER_APPIDS = ['wx0000000000', 'touristappid', '']

/** appid 是否真实（wx + 16 位十六进制；占位/游客/长度不符 → false） */
export function isValidAppid(appid: string | undefined): boolean {
  if (!appid) return false
  if (PLACEHOLDER_APPIDS.includes(appid)) return false
  return /^wx[0-9a-fA-F]{16}$/.test(appid)
}

export interface MpE2ECheck {
  name: string
  level: 'ok' | 'warn' | 'error'
  message: string
}

export interface MpE2EDiagnosis {
  checks: MpE2ECheck[]
  /** 硬错误（error 级）存在 → false */
  ok: boolean
}

export interface DiagnoseMpE2EOptions {
  root?: string
  port?: number
  ideCli?: string | null
  env?: NodeJS.ProcessEnv
  exists?: (p: string) => boolean
  isPortBusy?: (port: number) => boolean
}

/**
 * ★环境体检（一次性出报告，不再一步步踩坑）：IDE CLI / 产物 / project.config.json + appid 有效性 / 端口占用
 * 实测坑内化：占位 appid → error（automator 必挂）；端口被占 → warn（残留 IDE 实例，daemon 自动拉起）；
 * project.config.json 缺失 → error（产物不可导入 IDE，build:mp 已自动生成）
 */
export function diagnoseMpE2EEnv(opts: DiagnoseMpE2EOptions = {}): MpE2EDiagnosis {
  const exists = opts.exists ?? fs.existsSync
  const checks: MpE2ECheck[] = []
  const root = opts.root ?? '.'

  // ① IDE CLI
  const ideCli = opts.ideCli === undefined ? resolveMpIdeCli({ env: opts.env }) : opts.ideCli
  if (ideCli) {
    checks.push({ name: 'ide-cli', level: 'ok', message: `微信开发者工具 CLI：${ideCli}` })
  } else {
    checks.push({
      name: 'ide-cli',
      level: 'error',
      message: '未找到微信开发者工具 CLI（PROTEUS_IDE_CLI 环境变量 / --ide 参数 / 平台默认路径均未命中）',
    })
  }

  // ② 产物
  const projectDir = path.resolve(root, 'dist/mp-weixin')
  if (exists(projectDir)) {
    checks.push({ name: 'build-output', level: 'ok', message: `小程序产物：${projectDir}` })
  } else {
    checks.push({ name: 'build-output', level: 'error', message: `小程序产物缺失：${projectDir}（先 npm run build:mp）` })
  }

  // ③ project.config.json + appid 有效性（★实测：占位/游客 appid → automation 半启动必挂）
  const projectConfigFile = path.join(projectDir, 'project.config.json')
  if (exists(projectConfigFile)) {
    let appid: string | undefined
    try {
      appid = (JSON.parse(fs.readFileSync(projectConfigFile, 'utf-8')) as { appid?: string }).appid
    } catch {
      appid = undefined
    }
    if (isValidAppid(appid)) {
      checks.push({ name: 'appid', level: 'ok', message: `appid：${appid}` })
    } else {
      checks.push({
        name: 'appid',
        level: 'error',
        message: `appid 无效或占位（${appid ?? '缺失'}）：automator 需真实小程序 appid（wx + 16 位十六进制）——在 proteus.config.ts 配置后重新 build:mp`,
      })
    }
  } else if (exists(projectDir)) {
    checks.push({ name: 'appid', level: 'error', message: `project.config.json 缺失（${projectConfigFile}）：产物不可导入 IDE，重新 build:mp 自动生成` })
  }

  // ④ 端口占用（★实测：kill IDE 后 daemon 自动拉起占 9420 → automator getPort 冲突）
  const port = opts.port ?? 9420
  const isPortBusy = opts.isPortBusy ?? (() => false)
  if (isPortBusy(port)) {
    checks.push({
      name: 'automator-port',
      level: 'warn',
      message: `端口 ${port} 被占用：可能是残留的微信开发者工具实例（daemon 自动拉起）——用 --port 换端口，或关闭全部 IDE 进程后重试`,
    })
  }

  return { checks, ok: checks.every((c) => c.level !== 'error') }
}

/** 格式化体检报告（CLI 输出） */
export function formatMpE2EDiagnosis(d: MpE2EDiagnosis): string {
  const lines = ['[proteus] MP E2E 环境体检（B5 前置诊断）：']
  for (const c of d.checks) {
    const icon = c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠' : '✗'
    lines.push(`  ${icon} ${c.name}：${c.message}`)
  }
  lines.push(d.ok ? '[proteus] ✅ 环境就绪，可运行 automator' : '[proteus] ✗ 存在硬错误，请按上方指引修复（warn 不阻断）')
  return lines.join('\n')
}

/**
 * ★产物独立副本（避开 IDE 按路径缓存旧 project.config.json + 不污染 dist——IDE 会写 private.config 等）：
 * 复制 dist/mp-weixin → <root>/.proteus/e2e-mp（每次重建，干净状态）；automator projectPath 指向副本
 */
export function prepareMpE2EProject(root: string, exists?: (p: string) => boolean): { projectDir: string } | null {
  const src = path.resolve(root, 'dist/mp-weixin')
  if (!(exists ?? fs.existsSync)(src)) return null
  const dest = path.resolve(root, '.proteus/e2e-mp')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true })
  return { projectDir: dest }
}
