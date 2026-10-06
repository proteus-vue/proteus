// packages/cli/src/host-scaffold.ts
// ★★★hosts 第二刀 · Stage 2：`proteus create host <platform> <dir>` —— 生成**独立可编译的最小宿主工程**
//
// 【为什么要它（用户 2026-10-05）】此前"宿主"与"项目/验证装置"混在一份 hosts/* 工程里——
//   对 cli 创建宿主、正式打包、安全维护都不利。分层落地后（见 hosts/README-LAYERS.md），
//   runtime 成了可依赖单元（HAR），于是**最小壳 = 壳模板 + 依赖 runtime** ⇒ 可由 CLI 生成。
//
// 【生成的工程形态（鸿蒙样板）】
//   <dir>/
//     AppScope/ · oh-package.json5 · hvigorfile.ts · hvigor/ · build-profile.template.json5 · .gitignore
//     entry/            ← 最小壳（EntryAbility 交生命周期给 runtime；MainPage 渲染编译产物）
//     proteus_render/   ← runtime（HAR：C++ 源 + CMake + Rust 核；从框架仓复制，**与框架同源**）
//     proteus.host.json ← 宿主元信息（平台/包名/产物路径；供 build --package 定位）
//
// 【诚实边界】
//   · 运行时 HAR 目前**从框架 checkout 复制**（`hosts/harmony/host-app/proteus_render`）——
//     发布路径应拆成独立的 host-runtime 包（`@proteus-vue/host-runtime-harmony`），属**后续**；
//     本命令支持 PROTEUS_HOST_RUNTIME_DIR 环境变量覆盖（也便于在缺 checkout 时指向缓存副本）。
//   · 生成的工程**不含项目身份/业务装置**（superapp 等留 dev）——页面内容由 rawfile 编译产物驱动。
//   · 华为 CA 签名仍属机器本地：模板只给 `signingConfigs: []`（unsigned 可构建；装机见 README）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** CLI 包根（src/ 或 dist/ 的上一级）——模板随包发布，位于 <pkgRoot>/templates-host */
const CLI_PKG_ROOT = path.resolve(HERE, '..')

export const HOST_PLATFORMS = ['harmony'] as const
export type HostPlatform = (typeof HOST_PLATFORMS)[number]

/** 复制 runtime 时排除的目录名（构建期产物，不入生成工程） */
const RUNTIME_EXCLUDE_DIRS = new Set(['build', 'oh_modules', 'node_modules', '.hvigor', '.cxx', '.idea', '.preview'])
/** 复制 runtime 时排除的文件（DevEco 构建期自动生成的类型桥） */
const RUNTIME_EXCLUDE_FILES = new Set(['BuildProfile.ets', 'oh-package-lock.json5'])

export interface CreateHostOptions {
  platform: HostPlatform
  targetDir: string
  appName: string
  bundleName: string
  /** 模板根（缺省解析：<cliPkgRoot>/templates-host/<platform>）——测试注入 */
  templatesDir?: string
  /** runtime HAR 源目录（缺省解析：框架仓 hosts/harmony/host-app/proteus_render）——测试注入 */
  runtimeDir?: string
  /** 编译产物项目根（含 dist/app/<platform>/screen-content.json）；给了就拷进 rawfile */
  projectRoot?: string
}

export interface CreateHostResult {
  ok: boolean
  platform: HostPlatform
  targetDir: string
  files: string[]
  runtimeDir: string | null
  screenContentCopied: boolean
  notes: string[]
}

/* ================= 解析（模板根 / runtime 源） ================= */

/** 从 CLI 包位置向上找框架仓根（含 pnpm-workspace.yaml 或 hosts/） */
function findRepoRoot(): string | null {
  let dir = CLI_PKG_ROOT
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(dir, 'hosts'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

export function resolveTemplatesDir(platform: HostPlatform, override?: string): string {
  const candidates = [
    override,
    process.env.PROTEUS_HOST_TEMPLATES,
    path.join(CLI_PKG_ROOT, 'templates-host', platform),
    path.join(CLI_PKG_ROOT, '..', 'create-proteus', 'templates-host', platform),
  ].filter((c): c is string => !!c)
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error(
    `找不到宿主模板（${platform}）。已试：\n  ${candidates.join('\n  ')}\n` +
      `可用 PROTEUS_HOST_TEMPLATES=<dir> 指定。`,
  )
}

export function resolveRuntimeDir(platform: HostPlatform, override?: string): string | null {
  const repoRoot = findRepoRoot()
  const candidates = [
    override,
    process.env.PROTEUS_HOST_RUNTIME_DIR,
    repoRoot ? path.join(repoRoot, 'hosts', platform, 'host-app', 'proteus_render') : undefined,
    path.join(CLI_PKG_ROOT, 'templates-host', platform, 'proteus_render'),
  ].filter((c): c is string => !!c)
  for (const c of candidates) if (fs.existsSync(path.join(c, 'src', 'main', 'cpp', 'CMakeLists.txt'))) return c
  return null
}

/* ================= 复制工具 ================= */

function walk(dir: string, visit: (full: string, rel: string) => void, base = ''): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const full = path.join(dir, e.name)
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) walk(full, visit, rel)
    else visit(full, rel)
  }
}

/** 复制目录，排除构建期产物（相对路径任一段命中排除集即跳过） */
function copyDirFiltered(src: string, dest: string, files: string[]): void {
  walk(src, (full, rel) => {
    const segs = rel.split('/')
    if (segs.some((s) => RUNTIME_EXCLUDE_DIRS.has(s))) return
    const base = segs[segs.length - 1]
    if (RUNTIME_EXCLUDE_FILES.has(base)) return
    const to = path.join(dest, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(full, to)
    files.push(path.relative(dest, to))
  })
}

/* ================= 生成 ================= */

/** 纯函数式核心：渲染模板（{{var}} 替换）+ 复制 runtime + 拷编译产物 → 目标目录 */
export function createHost(opts: CreateHostOptions): CreateHostResult {
  const { platform, targetDir } = opts
  const templatesDir = resolveTemplatesDir(platform, opts.templatesDir)
  const runtimeDir = opts.runtimeDir !== undefined ? opts.runtimeDir : resolveRuntimeDir(platform)
  const notes: string[] = []
  const files: string[] = []

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`目标目录已存在且非空：${targetDir}（请选一个空/不存在的目录）`)
  }

  const vars: Record<string, string> = { appName: opts.appName, bundleName: opts.bundleName }
  // ① 模板文件（含 {{var}} 替换）
  walk(templatesDir, (full, rel) => {
    const to = path.join(targetDir, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    const content = fs.readFileSync(full, 'utf-8').replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? `{{${k}}}`)
    fs.writeFileSync(to, content)
    files.push(rel)
  })
  // ② runtime（HAR）——与框架同源复制
  if (runtimeDir) {
    copyDirFiltered(runtimeDir, path.join(targetDir, 'proteus_render'), files)
    notes.push(`runtime（HAR）已复制 ← ${runtimeDir}`)
    if (!fs.existsSync(path.join(targetDir, 'proteus_render', 'src', 'main', 'cpp', 'thirdparty', 'libproteus_layout_core.a'))) {
      notes.push('⚠ 未随附 Rust 核（libproteus_layout_core.a，32MB 构建产物）；构建前请在框架仓跑 hosts/harmony/build-rust-core.sh 再复制该文件到 proteus_render/src/main/cpp/thirdparty/')
    }
  } else {
    notes.push('⚠ 未找到 runtime（HAR）源目录——生成工程缺 proteus_render/；用 PROTEUS_HOST_RUNTIME_DIR 指定后重生成')
  }
  // ③ 编译产物（屏内容）→ rawfile（若项目根已有）
  let screenContentCopied = false
  if (opts.projectRoot) {
    const sc = path.join(opts.projectRoot, 'dist', 'app', platform, 'screen-content.json')
    if (fs.existsSync(sc)) {
      const rf = path.join(targetDir, 'entry', 'src', 'main', 'resources', 'rawfile')
      fs.mkdirSync(rf, { recursive: true })
      fs.copyFileSync(sc, path.join(rf, 'app-screen-content.json'))
      const gk = path.join(rf, '.gitkeep')
      if (fs.existsSync(gk)) fs.rmSync(gk)
      screenContentCopied = true
      notes.push(`编译产物已拷入 rawfile ← ${path.relative(opts.projectRoot, sc)}`)
    } else {
      notes.push(`⚠ 未见编译产物 ${path.relative(opts.projectRoot, sc)}——先跑 \`proteus build --target ${platform}\`，或用 build --package 自动拷入`)
    }
  }
  return { ok: true, platform, targetDir, files, runtimeDir, screenContentCopied, notes }
}

/* ================= 参数解析 + CLI 运行器 ================= */

export interface CreateHostArgs {
  platform: HostPlatform
  targetDir: string
  appName?: string
  bundleName?: string
  projectRoot?: string
}

export function parseCreateHostArgs(rest: string[]): CreateHostArgs {
  const [platform, dir, ...opts] = rest
  if (!platform || !HOST_PLATFORMS.includes(platform as HostPlatform)) {
    throw new Error(`proteus create host 需要 <平台>（支持：${HOST_PLATFORMS.join(' / ')}）`)
  }
  if (!dir) throw new Error('proteus create host 需要 <目标目录>（如 proteus create host harmony host/harmony）')
  const args: CreateHostArgs = { platform: platform as HostPlatform, targetDir: dir }
  for (let i = 0; i < opts.length; i++) {
    const a = opts[i]
    if (a === '--name') args.appName = opts[++i]
    else if (a === '--bundle') args.bundleName = opts[++i]
    else if (a === '--project') args.projectRoot = path.resolve(opts[++i] ?? '.')
    else throw new Error(`未知选项：${a}（可用 --name、--bundle、--project）`)
  }
  return args
}

/** 由应用名派生一个合法的鸿蒙包名（reverse-DNS；用户可用 --bundle 覆盖） */
export function deriveBundleName(appName: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.')
  return `com.example.${slug || 'app'}`
}

/** CLI 运行器：解析 → 生成 → 打印报告；返回退出码（0 成功） */
export function runCreateHost(args: CreateHostArgs): number {
  const name = path.basename(path.resolve(args.targetDir)) || 'proteus-host'
  const appName = args.appName ?? name
  const bundleName = args.bundleName ?? deriveBundleName(appName)
  let r: CreateHostResult
  try {
    r = createHost({
      platform: args.platform,
      targetDir: args.targetDir,
      appName,
      bundleName,
      projectRoot: args.projectRoot,
    })
  } catch (e) {
    console.error(`[proteus create host] ${(e as Error).message}`)
    return 1
  }
  console.log(`[proteus create host] 已生成最小宿主工程：${path.resolve(args.targetDir)}`)
  console.log(`  平台     : ${r.platform}`)
  console.log(`  应用名   : ${appName}`)
  console.log(`  包名     : ${bundleName}`)
  console.log(`  文件     : ${r.files.length} 个（模板 + runtime）`)
  for (const n of r.notes) console.log(`  · ${n}`)
  console.log('')
  console.log('下一步：')
  console.log(`  proteus build --target ${r.platform} --package --host-dir ${args.targetDir}   # 编译项目内容 + 调 hvigor 打包 .hap`)
  console.log(`  或手动：cd ${args.targetDir} && <DevEco>/tools/hvigor/bin/hvigorw assembleHap --mode module -p product=default`)
  console.log('  装机签名（本机首次）：DevEco Studio → Project Structure → Signing Configs → Automatically generate signature')
  return 0
}
