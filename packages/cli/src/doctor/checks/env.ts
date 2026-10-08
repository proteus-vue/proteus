// packages/cli/src/doctor/checks/env.ts —— §4.1 env 组（运行时环境，跨端通用）
import type { DoctorCheck } from '../types'
import { ok, fail } from './util'

export const ENV_CHECKS: DoctorCheck[] = [
  {
    id: 'env/node-version',
    group: 'env',
    title: 'Node 版本',
    level: 'error',
    run(ctx) {
      const v = ctx.tool.nodeVersion
      const major = Number(v.split('.')[0])
      const minor = Number(v.split('.')[1] ?? 0)
      // 判据：≥ 22.12（require(ESM) 门槛，决策 #204 / AGENTS.md）
      const okv = major > 22 || (major === 22 && minor >= 12)
      return okv
        ? ok('env/node-version', 'Node 版本', `${v}（≥ 22.12）`)
        : fail({ checkId: 'env/node-version', level: 'error', code: 'PT-EE-001', title: 'Node 版本不满足', expected: '≥ 22.12（require(ESM) 支持）', actual: v, fix: { command: 'fnm install 22  # 或 nvm install 22', description: 'Node ≥ 22.12' }, evidence: [{ command: 'node --version', stdout: v, exitCode: 0 }] })
    },
  },
  {
    id: 'env/pnpm-version',
    group: 'env',
    title: '包管理器版本',
    level: 'error',
    run(ctx) {
      const pkg = ctx.projectPackage()
      const declared = typeof pkg?.packageManager === 'string' ? (pkg.packageManager as string).replace(/^pnpm@/, '') : null
      const actual = ctx.tool.pnpmVersion
      if (!declared) return ok('env/pnpm-version', '包管理器版本', actual ? `pnpm ${actual}（未声明 packageManager）` : '未声明 packageManager')
      // ★未注入版本（直接 node 跑，非经 pnpm）⇒ 主动探测一次再判（避免"实测=期望却报错"的假红）
      const probed = actual ?? ctx.runCmd('pnpm', ['--version'], { timeoutMs: 4000 }).stdout?.trim() ?? null
      if (!probed) {
        return fail({ checkId: 'env/pnpm-version', level: 'error', code: 'PT-EE-002', title: '无法读取 pnpm 版本', expected: declared, actual: 'pnpm 不可用', fix: { command: `corepack enable && corepack prepare pnpm@${declared} --activate` }, evidence: [ctx.runCmd('pnpm', ['--version'], { timeoutMs: 4000 })] })
      }
      return probed === declared
        ? ok('env/pnpm-version', '包管理器版本', `pnpm ${probed}（packageManager 一致）`)
        : fail({ checkId: 'env/pnpm-version', level: 'error', code: 'PT-EE-002', title: '包管理器版本不匹配', expected: `pnpm ${declared}`, actual: `pnpm ${probed}`, fix: { command: `corepack enable && corepack prepare pnpm@${declared} --activate` }, evidence: [{ command: 'pnpm --version', stdout: probed, exitCode: 0 }] })
    },
  },
  {
    id: 'env/rust-toolchain',
    group: 'env',
    title: 'Rust 工具链',
    level: 'warn',
    run(ctx) {
      const ev = ctx.runCmd('cargo', ['--version'], { timeoutMs: 4000 })
      if (ev.exitCode === 0) return ok('env/rust-toolchain', 'Rust 工具链', ev.stdout ?? '')
      return fail({ checkId: 'env/rust-toolchain', level: 'warn', code: 'PT-EE-003', title: '缺少 Rust 工具链（rustup）', expected: 'cargo 可执行（rustup，target 在 ~/.cargo）', actual: ev.note ?? ev.stderr ?? '不可用', fix: { command: 'rustup toolchain install stable', description: 'Rust 内核构建需要（iOS/Android）' }, evidence: [ev] })
    },
  },
  {
    id: 'env/git-identity',
    group: 'env',
    title: 'git 身份',
    level: 'warn',
    run(ctx) {
      const name = ctx.runCmd('git', ['config', '--get', 'user.name'])
      const email = ctx.runCmd('git', ['config', '--get', 'user.email'])
      const hasName = name.exitCode === 0 && !!name.stdout
      const hasEmail = email.exitCode === 0 && !!email.stdout
      return hasName && hasEmail
        ? ok('env/git-identity', 'git 身份', `${name.stdout} <${email.stdout}>`)
        : fail({ checkId: 'env/git-identity', level: 'warn', code: 'PT-EE-004', title: 'git 身份未配置', expected: 'user.name 与 user.email 均已配置', actual: `${hasName ? '' : 'user.name 缺 '}${hasEmail ? '' : 'user.email 缺'}`.trim(), fix: { command: 'git config --global user.email you@example.com', description: '提交/发布流程需要' }, evidence: [name, email] })
    },
  },
  {
    id: 'env/disk-space',
    group: 'env',
    title: '磁盘空间',
    level: 'warn',
    run(ctx) {
      // macOS/Linux：statvfs 无原生 Node API ⇒ 用 df（POSIX 通用）
      const ev = ctx.runCmd('df', ['-k', ctx.root], { timeoutMs: 3000 })
      if (ev.exitCode !== 0 || !ev.stdout) return ok('env/disk-space', '磁盘空间', '（无法探测，跳过）')
      const line = ev.stdout.split('\n').filter((l) => /\d/.test(l)).pop() ?? ''
      const cols = line.trim().split(/\s+/)
      const availKb = Number(cols[3])
      if (!Number.isFinite(availKb)) return ok('env/disk-space', '磁盘空间', '（读数解析失败，跳过）')
      const gb = (availKb / 1024 / 1024).toFixed(0)
      return availKb / 1024 / 1024 >= 5
        ? ok('env/disk-space', '磁盘空间', `${gb} GB 可用`)
        : fail({ checkId: 'env/disk-space', level: 'warn', code: 'PT-EE-005', title: '磁盘空间不足', expected: '≥ 5 GB（iOS 模拟器 runtime 约 8 GB）', actual: `${gb} GB`, fix: { description: '清理磁盘' }, evidence: [ev] })
    },
  },
]
