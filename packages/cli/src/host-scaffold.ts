// packages/cli/src/host-scaffold.ts
// ★★★hosts 第二/三刀：`proteus create host <platform> <dir>` —— 生成**独立可编译的最小宿主工程**
//
// 【为什么要它（用户 2026-10-05）】此前"宿主"与"项目/验证装置"混在一份 hosts/* 工程里——
//   对 cli 创建宿主、正式打包、安全维护都不利。分层落地后（见 hosts/README-LAYERS.md），
//   runtime 成了可依赖单元，于是**最小壳 = 壳模板 + 依赖 runtime** ⇒ 可由 CLI 生成。
//
// 【支持的端】harmony（第二刀样板）· ios（第三刀样板）。两者"可依赖单元"的**载体不同**：
//   · harmony：runtime 抽为 **HAR 模块**（`proteus_render/`，携带 C++ 源 + CMake + Rust 核）。
//   · ios：runtime 是 **源集单元**（`runtime/` + `platform/` 的 .swift，与内核 .a 一起被消费方 swiftc 编译；
//     本仓 iOS 无 Xcode 工程/SPM，且引擎 API 未 public 化 ⇒ 独立模块会逼千行 public 化）。
//   ⇒ 用一张**平台描述表**统一：每个端声明「runtime 源→目标目录」若干个 + 产物落点 + 排除项。
//
// 【诚实边界】
//   · runtime 源**从框架 checkout 复制**（`PROTEUS_HOST_RUNTIME_DIR` 可覆盖）——发布形态应拆成独立包，属后续。
//   · 生成的工程**不含项目身份/业务装置**（superapp 等留 dev）——页面内容由编译产物驱动。
//   · 签名（鸿蒙华为 CA / iOS provisioning）仍属机器本地：模板只给占位。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNativeConfigFromProject, applyNativeConfigFromProject } from './native-config'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** CLI 包根（src/ 或 dist/ 的上一级）——模板随包发布，位于 <pkgRoot>/templates-host */
const CLI_PKG_ROOT = path.resolve(HERE, '..')

export const HOST_PLATFORMS = ['harmony', 'ios', 'android'] as const
export type HostPlatform = (typeof HOST_PLATFORMS)[number]

/** 每个端：runtime 源→目标目录（可多个）+ 编译产物落点 + 复制排除项 */
interface PlatformSpec {
  /** runtime 单元：目录型（src=目录，marker=校验存在）或产物型（artifact=单文件）——frame 占位 {repo} */
  runtimeUnits: Array<{ src: string; dest: string; marker: string; artifact?: string }>
  /** 编译产物 screen-content.json 在生成工程内的落点（相对 targetDir） */
  resourceDest: string
  /** 复制时排除的目录段 / 文件名（构建期产物） */
  excludeDirs: string[]
  excludeFiles: string[]
}

const PLATFORM_SPECS: Record<HostPlatform, PlatformSpec> = {
  harmony: {
    runtimeUnits: [{ src: '{repo}/hosts/harmony/host-app/proteus_render', dest: 'proteus_render', marker: 'src/main/cpp/CMakeLists.txt' }],
    resourceDest: 'entry/src/main/resources/rawfile/app-screen-content.json',
    excludeDirs: ['build', 'oh_modules', 'node_modules', '.hvigor', '.cxx', '.idea', '.preview'],
    excludeFiles: ['BuildProfile.ets', 'oh-package-lock.json5'],
  },
  ios: {
    runtimeUnits: [
      { src: '{repo}/hosts/ios/ProteusHost/runtime', dest: 'runtime', marker: 'selfdraw-scene.swift' },
      { src: '{repo}/platform/ios/ProteusPlatform', dest: 'platform', marker: 'ProteusTextAdapter.swift' },
    ],
    resourceDest: 'app-screen-content.json',
    excludeDirs: ['build', 'dev', '.build'],
    excludeFiles: [],
  },
  android: {
    // ★Android 的 runtime 是**构建产物 AAR**（hosts/android/build/proteus-runtime.aar，由
    //   hosts/android/build-runtime-aar.sh 产出），不是源目录 ⇒ artifact 形态；落 <dir>/libs/。
    runtimeUnits: [{ src: '{repo}/hosts/android/build', dest: 'libs', marker: 'proteus-runtime.aar', artifact: 'proteus-runtime.aar' }],
    resourceDest: 'app/src/main/assets/app-screen-content.json',
    excludeDirs: [],
    excludeFiles: [],
  },
}

export interface CreateHostOptions {
  platform: HostPlatform
  targetDir: string
  appName: string
  bundleName: string
  /** 模板根（缺省解析：<cliPkgRoot>/templates-host/<platform>）——测试注入 */
  templatesDir?: string
  /** runtime 源根（缺省解析：框架仓；测试注入时为**单个**目录，用于 harmony）——见 runtimeDirs */
  runtimeDir?: string
  /** runtime 源根映射（多目录端；测试注入）——覆盖 spec.runtimeUnits 的 src */
  runtimeDirs?: string[]
  /** 编译产物项目根（含 dist/app/<platform>/screen-content.json）；给了就拷进产物落点 */
  projectRoot?: string
}

export interface CreateHostResult {
  ok: boolean
  platform: HostPlatform
  targetDir: string
  files: string[]
  runtimeDirs: string[]
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

/** 解析某端的 runtime 源目录（存在且带 marker 才算） */
export function resolveRuntimeDirs(platform: HostPlatform, override?: string[]): string[] {
  const spec = PLATFORM_SPECS[platform]
  const repoRoot = findRepoRoot()
  const out: string[] = []
  for (let i = 0; i < spec.runtimeUnits.length; i++) {
    const unit = spec.runtimeUnits[i]
    const expanded = unit.src.replace('{repo}', repoRoot ?? '')
    const candidates = [
      override?.[i],
      process.env.PROTEUS_HOST_RUNTIME_DIR && spec.runtimeUnits.length === 1 ? process.env.PROTEUS_HOST_RUNTIME_DIR : undefined,
      expanded,
      path.join(CLI_PKG_ROOT, 'templates-host', platform, unit.dest),
    ].filter((c): c is string => !!c)
    const hit = candidates.find((c) => fs.existsSync(unit.artifact ? path.join(c, unit.artifact) : path.join(c, unit.marker)))
    if (hit) out.push(hit)
  }
  return out
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

/** 复制目录，排除构建期产物（相对路径任一段命中排除集 / 文件名命中即跳过） */
function copyDirFiltered(src: string, dest: string, excludeDirs: Set<string>, excludeFiles: Set<string>, files: string[]): void {
  walk(src, (full, rel) => {
    const segs = rel.split('/')
    if (segs.some((s) => excludeDirs.has(s))) return
    if (excludeFiles.has(segs[segs.length - 1])) return
    const to = path.join(dest, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(full, to)
    files.push(path.relative(path.dirname(dest), to))
  })
}

/* ================= 生成 ================= */

export function createHost(opts: CreateHostOptions): CreateHostResult {
  const { platform, targetDir } = opts
  const spec = PLATFORM_SPECS[platform]
  const templatesDir = resolveTemplatesDir(platform, opts.templatesDir)
  const runtimeDirs = opts.runtimeDirs ?? (opts.runtimeDir ? [opts.runtimeDir] : resolveRuntimeDirs(platform))
  const notes: string[] = []
  const files: string[] = []

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`目标目录已存在且非空：${targetDir}（请选一个空/不存在的目录）`)
  }

  const vars: Record<string, string> = { appName: opts.appName, bundleName: opts.bundleName, bundleId: opts.bundleName }
  // ① 模板文件（含 {{var}} 替换）
  walk(templatesDir, (full, rel) => {
    const to = path.join(targetDir, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    const content = fs.readFileSync(full, 'utf-8').replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? `{{${k}}}`)
    fs.writeFileSync(to, content)
    files.push(rel)
  })
  // ② runtime 单元（源集）——与框架同源复制
  if (runtimeDirs.length === spec.runtimeUnits.length) {
    for (let i = 0; i < spec.runtimeUnits.length; i++) {
      const unit = spec.runtimeUnits[i]
      const dest = path.join(targetDir, unit.dest)
      if (unit.artifact) {
        // 产物型：复制单个文件（如 android 的 proteus-runtime.aar → <dir>/libs/）
        fs.mkdirSync(dest, { recursive: true })
        const to = path.join(dest, unit.artifact)
        fs.copyFileSync(path.join(runtimeDirs[i], unit.artifact), to)
        files.push(path.relative(targetDir, to))
      } else {
        copyDirFiltered(runtimeDirs[i], dest, new Set(spec.excludeDirs), new Set(spec.excludeFiles), files)
      }
    }
    notes.push(`runtime（${runtimeDirs.length} 个单元）已复制 ← ${runtimeDirs.map((d) => path.relative(process.cwd(), d)).join(', ')}`)
    if (platform === 'harmony' && !fs.existsSync(path.join(targetDir, 'proteus_render/src/main/cpp/thirdparty/libproteus_layout_core.a'))) {
      notes.push('⚠ 未随附 Rust 核（libproteus_layout_core.a，构建产物）；构建前请在框架仓跑 hosts/harmony/build-rust-core.sh 再复制该文件到 proteus_render/src/main/cpp/thirdparty/')
    }
    if (platform === 'ios') {
      notes.push('ℹ iOS runtime 为**源集单元**：与内核 .a 一起由 `build --package` 用 swiftc 编译（内核由 cargo 交叉编译：packages/layout-core-rust + packages/host-abi）')
    }
    if (platform === 'android') {
      notes.push('ℹ android runtime 为 **AAR**（libs/proteus-runtime.aar，保持同包 dev.proteus.layoutcore）；缺它时在框架仓跑 hosts/android/build-runtime-aar.sh 生成后重生成')
    }
  } else {
    notes.push(`⚠ 未找齐 runtime 源集（需 ${spec.runtimeUnits.length} 个，实得 ${runtimeDirs.length}）——生成工程可能不完整；用 PROTEUS_HOST_RUNTIME_DIR 指定后重生成`)
  }
  // ③ 编译产物（屏内容）→ 落点（若项目根已有）
  let screenContentCopied = false
  if (opts.projectRoot) {
    const sc = path.join(opts.projectRoot, 'dist', 'app', platform, 'screen-content.json')
    if (fs.existsSync(sc)) {
      const dest = path.join(targetDir, spec.resourceDest)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(sc, dest)
      const gk = path.join(path.dirname(dest), '.gitkeep')
      if (fs.existsSync(gk)) fs.rmSync(gk)
      screenContentCopied = true
      notes.push(`编译产物已拷入 ${spec.resourceDest} ← ${path.relative(opts.projectRoot, sc)}`)
    } else {
      notes.push(`⚠ 未见编译产物 ${path.relative(opts.projectRoot, sc)}——先跑 \`proteus build --target ${platform}\`，或用 build --package 自动拷入`)
    }
  }
  return { ok: true, platform, targetDir, files, runtimeDirs, screenContentCopied, notes }
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

/** 由应用名派生一个合法的 reverse-DNS 包名/Bundle ID（用户可用 --bundle 覆盖） */
export function deriveBundleName(appName: string, tld = 'com'): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.')
  return `${tld}.example.${slug || 'app'}`
}

/** CLI 运行器：解析 → 生成 → 打印报告；返回退出码（0 成功） */
export async function runCreateHost(args: CreateHostArgs): Promise<number> {
  const name = path.basename(path.resolve(args.targetDir)) || 'proteus-host'
  // ★★★决策 #635：若给了 --project，先解析项目的 `proteus.config` 的 `native` 段——
  //   应用名/包名优先取配置（CLI 显式 --name/--bundle 仍覆盖）；生成后再 applyNativeConfig 补齐
  //   版本/SDK/方向/权限等模板未携带的字段。
  const native = args.projectRoot ? await resolveNativeConfigFromProject(args.projectRoot) : undefined
  const appName = args.appName ?? native?.app.name ?? name
  // ★android 默认包名 = runtime AAR 的包（dev.proteus.layoutcore）⇒ 壳与 runtime **同包**
  //   （零可见性改动；见决策 #566）。用户显式 --bundle 或 native.android.applicationId 可改。
  const platformDefaultBundle =
    args.platform === 'android'
      ? native?.android.applicationId ?? 'dev.proteus.layoutcore'
      : args.platform === 'ios'
        ? native?.ios.bundleId ?? deriveBundleName(appName)
        : native?.harmony.bundleName ?? deriveBundleName(appName)
  const bundleName = args.bundleName ?? platformDefaultBundle
  let r: CreateHostResult
  try {
    r = createHost({ platform: args.platform, targetDir: args.targetDir, appName, bundleName, projectRoot: args.projectRoot })
  } catch (e) {
    console.error(`[proteus create host] ${(e as Error).message}`)
    return 1
  }
  // ★决策 #635：把 native 段其余字段（version/sdk/orientation/permissions/…）渲染进原生工程文件
  if (args.projectRoot && native) {
    const rep = await applyNativeConfigFromProject(args.targetDir, args.platform, args.projectRoot)
    for (const c of rep.changes) console.log(`  · native: ${c.file} ${c.field} → ${c.to}`)
    for (const s of rep.skipped) console.log(`  · native(跳过): ${s}`)
  }
  console.log(`[proteus create host] 已生成最小宿主工程：${path.resolve(args.targetDir)}`)
  console.log(`  平台     : ${r.platform}`)
  console.log(`  应用名   : ${appName}${native && !args.appName ? '（来自 proteus.config native）' : ''}`)
  console.log(`  包名     : ${bundleName}${native && !args.bundleName ? '（来自 proteus.config native）' : ''}`)
  console.log(`  文件     : ${r.files.length} 个（模板 + runtime）`)
  for (const n of r.notes) console.log(`  · ${n}`)
  console.log('')
  console.log('下一步：')
  console.log(`  proteus build --target ${r.platform} --package --host-dir ${args.targetDir}   # 编译项目内容 + 打平台安装包`)
  if (r.platform === 'harmony') {
    console.log(`  或手动：cd ${args.targetDir} && <DevEco>/tools/hvigor/bin/hvigorw assembleHap --mode module -p product=default`)
    console.log('  装机签名（本机首次）：DevEco Studio → Project Structure → Signing Configs → Automatically generate signature')
  } else {
    console.log('  装机签名：需本机有可用 provisioning profile（run-selfdraw.sh 的签名流程同源）')
  }
  return 0
}
