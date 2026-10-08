// packages/cli/src/dist-freshness.ts
// ★★★CLI 启动期「陈旧 dist」守卫（2026-10-08 · 决策 #663，承 #662 的实测事故）
//
// 【它防什么】`dist/` 是构建产物（gitignored）⇒ 本机常驻一份**旧产物**。改了 `packages/*/src`
//   却忘了 `build-packages` 时，`npx proteus …`（走 `packages/cli/dist/index.js`）**跑的是旧代码**：
//   实测——在 css-conformance 里 `npx proteus dev --target android` **仍启动 web**（dist 停在 2.5 小时前，
//   新的「App 端 dev」分支根本没进产物），而用 `tsx src/index.ts` 手测却正常（假绿）。
//   ★与「提交 ≠ 交付」同族：本地门禁全绿、`git status` 不报错，**没有任何机制提醒"产物是旧的"**。
//
// 【判据】与 `scripts/build-packages.mjs` 的幂等跳过条件**同源**：某包「有 build 脚本」时，
//   必须 `dist 存在 且 newest(src/**) <= newest(dist/**)`；否则算陈旧。
//   ★该脚本是**仓库脚本**（不在本包内、发布形态不可见）⇒ helper 在此复制一份；改判据需与
//     `scripts/build-packages.mjs` 同步（两处均有此交叉注释）。
//
// 【诚实边界】① 只看 mtime（"src 是否比 dist 新"），不看内容——内容级判据是 golden/typecheck 的活；
//   ② 只在**开发 checkout**（`<repoRoot>/packages/*/src` 存在）有意义；发布形态（npm 安装）下
//     packages 目录不存在 ⇒ 恒返回空、零开销；③ 只**告警**不阻断（硬阻断会误伤合法工作流）；
//   ④ 仅在**从 dist 运行**时检查——`tsx src/index.ts` 下 src 比 dist 新是**预期**，不是陈旧。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StalePackage {
  pkg: string
  reason: string
}

/** 目录下最新 mtime（缺目录 = 0）——与 scripts/build-packages.mjs 同口径 */
export function newestMtime(dir: string): number {
  let latest = 0
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(fp)
        continue
      }
      try {
        latest = Math.max(latest, fs.statSync(fp).mtimeMs)
      } catch {
        /* 与遍历的竞态（文件被删）：忽略该文件 */
      }
    }
  }
  walk(dir)
  return latest
}

/**
 * 找出 dist 陈旧的 workspace 包（改了 src 未重建）。
 * 判据：某包「有 build 脚本」且 `dist/` **已存在**、但 `newest(src/**) > newest(dist/**)`。
 * ★为何**不**把"dist 缺失"算陈旧：本守卫防的是"**跑旧代码**"（dist 存在但是旧的）——
 *   dist 缺失时 import 会直接报错（loud），不是静默跑旧代码；且 `compiler-backend-rust`
 *   的 build 是 `cargo build`（产物在 `target/`，从不产 `dist/`）⇒ 若把缺失算陈旧，它会**永久误报**。
 */
export function findStalePackages(repoRoot: string): StalePackage[] {
  const pkgsDir = path.join(repoRoot, 'packages')
  if (!fs.existsSync(pkgsDir)) return [] // 发布形态：无 packages/ ⇒ 无判据
  let dirs: string[]
  try {
    dirs = fs.readdirSync(pkgsDir)
  } catch {
    return []
  }
  const stale: StalePackage[] = []
  for (const d of dirs) {
    const srcDir = path.join(pkgsDir, d, 'src')
    if (!fs.existsSync(srcDir)) continue
    const pkgJson = path.join(pkgsDir, d, 'package.json')
    let manifest: { scripts?: { build?: string } }
    try {
      manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
    } catch {
      continue
    }
    if (!manifest.scripts?.build) continue // 纯源码包（无 build 脚本）不参与
    const distDir = path.join(pkgsDir, d, 'dist')
    if (!fs.existsSync(distDir)) continue // 不产 dist 的包（如 cargo 型）不算陈旧
    if (newestMtime(srcDir) > newestMtime(distDir)) {
      stale.push({ pkg: d, reason: 'src 比 dist 新（改了源码未重建）' })
    }
  }
  return stale
}

/** 生成一行式告警（无陈旧 = null） */
export function formatStaleWarning(stale: StalePackage[]): string | null {
  if (!stale.length) return null
  const names = stale.map((s) => s.pkg).join(', ')
  return (
    `⚠ dist 陈旧：${names} —— 你改的源码没进产物。` +
    `\`npx proteus\` 走 packages/cli/dist/ ⇒ 现在跑的是【旧代码】（改用 tsx src 手测却正常 = 假绿）。` +
    `\n  修复：node scripts/build-packages.mjs`
  )
}

/** 本模块目录名（src/index.ts 或 dist/index.js）——用于判定"是否从 dist 运行" */
export function currentModuleDir(metaUrl: string = import.meta.url): string {
  return path.dirname(fileURLToPath(metaUrl))
}

/** 是否从 `dist/` 运行：只有此时 dist 陈旧才意味着"跑旧代码"（tsx 从 src 跑 ⇒ false） */
export function isRunningFromDist(metaUrl: string = import.meta.url): boolean {
  return path.basename(currentModuleDir(metaUrl)) === 'dist'
}

/** 本文件（src/index.ts 或 dist/index.js）都是 `<root>/packages/cli/{src,dist}/` 三层深 ⇒ ../../../ = 仓库根 */
export function repoRootFromHere(metaUrl: string = import.meta.url): string {
  return path.resolve(currentModuleDir(metaUrl), '../../..')
}

/**
 * 启动期守卫：陈旧则把告警打到 stderr（**不阻断**）。
 * @param cmd 当前子命令（help/version/未给 = 不检查——与产物语义无关）
 */
export function warnIfDistStale(cmd: string | undefined, metaUrl: string = import.meta.url): void {
  if (!cmd || cmd === 'help' || cmd === 'version' || cmd === '--help' || cmd === '-h' || cmd === '--version' || cmd === '-v') return
  if (!isRunningFromDist(metaUrl)) return // tsx 从 src 运行：src 比 dist 新属预期
  try {
    const w = formatStaleWarning(findStalePackages(repoRootFromHere(metaUrl)))
    if (w) console.error(w)
  } catch {
    /* 守卫永不阻断主流程 */
  }
}
