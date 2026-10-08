// packages/cli/src/doctor/context.ts —— DoctorContext 构造（探测原语：存在性/读文件/跑命令/端口）
//
// 【设计】探测原语**全部注入**（对齐 health.ts 的 opts.exists 范式）——测试可换成假实现，零副作用、可离线。
//   ★唯一碰外部世界的原语是 `runCmd`（有硬超时，绝不挂死整个 doctor——方案 §9⑥）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawnSync } from 'node:child_process'
import type { DoctorContext, DoctorEvidence } from './types'

/** 默认单检查超时（方案 §3.5） */
export const DEFAULT_TIMEOUT_MS = 5000

export interface BuildContextOptions {
  root: string
  targets: string[]
  /** CLI 版本（报告页脚用） */
  cliVersion: string
  /** 注入覆盖（测试） */
  overrides?: Partial<DoctorContext>
}

/** 构造体检上下文（探测原语默认实现 + 可注入覆盖） */
export function buildDoctorContext(opts: BuildContextOptions): DoctorContext {
  const root = path.resolve(opts.root)
  const runCmd = (cmd: string, args: string[], o?: { timeoutMs?: number; env?: Record<string, string> }): DoctorEvidence => {
    const timeout = o?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    try {
      const r = spawnSync(cmd, args, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        env: o?.env ? { ...process.env, ...o.env } : process.env,
      })
      // ★超时/信号：spawnSync 会返回 error（ETIMEDOUT）或 signal → 归为 exitCode=null + note
      if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
        return { command: `${cmd} ${args.join(' ')}`, exitCode: null as unknown as number, note: `timeout(>${timeout}ms)` }
      }
      if (r.error) {
        return { command: `${cmd} ${args.join(' ')}`, note: `spawn error: ${(r.error as Error).message}` }
      }
      return {
        command: `${cmd} ${args.join(' ')}`,
        exitCode: r.status ?? -1,
        stdout: (r.stdout ?? '').toString().trim().slice(0, 4000),
        stderr: (r.stderr ?? '').toString().trim().slice(0, 2000),
      }
    } catch (e) {
      return { command: `${cmd} ${args.join(' ')}`, note: `throw: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  const portFree = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      try {
        srv.listen(port, '127.0.0.1')
      } catch {
        resolve(false)
      }
    })

  const base: DoctorContext = {
    root,
    targets: opts.targets,
    tool: {
      nodeVersion: process.versions.node,
      pnpmVersion: (process.env.npm_config_user_agent ?? '').match(/pnpm\/([\d.]+)/)?.[1] ?? null,
      platform: process.platform,
      arch: process.arch,
    },
    exists: (p: string) => fs.existsSync(p.startsWith('/') ? p : path.join(root, p)),
    readFile: (p: string) => {
      try {
        return fs.readFileSync(p.startsWith('/') ? p : path.join(root, p), 'utf-8')
      } catch {
        return null
      }
    },
    runCmd,
    portFree,
    projectPackage: () => {
      const raw = base.readFile('package.json')
      if (!raw) return null
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return null
      }
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
  return { ...base, ...(opts.overrides ?? {}) }
}
