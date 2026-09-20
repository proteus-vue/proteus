// scripts/lib/pack-package.mjs —— ★本仓唯一的「打包」实现：pnpm 打包 + 文件清单 + integrity
//
// ★为什么打包器是 pnpm，不是 npm（2026-09-20 真实事故，外部实战报告第十二节）：
//   `@proteus-vue/components` 的 `files` 里写的是纯目录通配 `"p-*"`——
//     · **npm 打包器不展开它**（实测 `npm pack` 只收 17 个文件，74 个 p-* 组件全部丢失），
//       而同一份源码 `pnpm pack` 出 94 个文件（完整）。
//     · 事故链：发布链曾是 `changeset publish`（pnpm 仓库 → 内部走 `pnpm publish`，侥幸完整），
//       改为逐包 `npm publish` 后**首次经 npm 打包器** → 全量发布把 74 个组件静默丢掉。
//   → 结论：**声明（files）与打包器要解耦**。本仓固定用 pnpm 打包（标准 glob 语义），
//     上传仍走 `npm publish <tarball>`（OIDC trusted publishing / provenance 只认 npm，
//     而 npm 发布 tarball 时**按字节原样上传**——实测 `npm publish --dry-run` 报的 integrity
//     与本地 tarball 的 sha512 完全一致，故打包器与上传器的职责可以安全分离）。
//
// ★pnpm pack 字节确定：同输入两次打包 sha512 相同（实测）→ 本函数返回的 integrity 可与
//   registry 的 `dist.integrity` 直接逐字节比对（幂等跳过 / 漂移判定都依赖这一点）。
//
// 用法（模块）：import { packPackage } from './lib/pack-package.mjs'
// 用法（命令行，供 shell 脚本调用）：node scripts/lib/pack-package.mjs <pkgDir> [destDir]
//   → 打印 JSON：{ tgz, files: N, integrity, size }
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** sha512 integrity（npm 的 `dist.integrity` 格式：`sha512-<base64>`） */
export function integrityOf(buf) {
  return 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64')
}

/**
 * 用 pnpm 打包指定包目录。
 * @param {string} pkgDir 包目录（含 package.json）
 * @param {{dest?: string}} [opts] dest：tarball 输出目录（缺省自建临时目录；调用方给定时不清理）
 * @returns {{tgz: string, files: string[], integrity: string, size: number, dest: string, ownedDest: boolean}}
 *   files 为**包内相对路径**（与 tarball 内容一致，不含 package.json 自身）
 */
export function packPackage(pkgDir, opts = {}) {
  const ownedDest = !opts.dest
  const dest = opts.dest ?? fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-pack-'))
  fs.mkdirSync(dest, { recursive: true })
  const raw = execFileSync('pnpm', ['pack', '--pack-destination', dest, '--json'], {
    cwd: pkgDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 300_000,
  })
  const e = JSON.parse(raw)
  const tgz = e.filename && path.isAbsolute(e.filename) ? e.filename : path.join(dest, e.filename ?? '')
  const buf = fs.readFileSync(tgz)
  return {
    tgz,
    files: (e.files ?? []).map((f) => (typeof f === 'string' ? f : f.path)).sort(),
    integrity: integrityOf(buf),
    size: buf.length,
    dest,
    ownedDest,
  }
}

/** 清理 packPackage 自建的临时目录（调用方传 dest 时不删——那是调用方的目录） */
export function cleanupPack(p) {
  if (!p || !p.ownedDest) return
  try {
    fs.rmSync(p.dest, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响结果 */
  }
}

// ── 命令行入口（publish-all.sh 用：拿到 tarball 路径与 integrity）──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [pkgDir, destDir] = process.argv.slice(2)
  if (!pkgDir) {
    console.error('用法：node scripts/lib/pack-package.mjs <pkgDir> [destDir]')
    process.exit(2)
  }
  try {
    const p = packPackage(pkgDir, destDir ? { dest: destDir } : {})
    console.log(JSON.stringify({ tgz: p.tgz, files: p.files.length, integrity: p.integrity, size: p.size }))
  } catch (e) {
    console.error(`[pack] 失败：${String(e.stderr ?? e.message ?? e).slice(0, 300)}`)
    process.exit(1)
  }
}
