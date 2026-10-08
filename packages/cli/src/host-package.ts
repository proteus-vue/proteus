// packages/cli/src/host-package.ts
// ★★★hosts 第二刀 · Stage 2：`proteus build --target harmony --package` —— 编译项目内容后**调平台工具链打包**
//
// 【设计边界（不自研工具链）】本模块只做三件事：
//   ① 把项目编译产物（`dist/app/harmony/screen-content.json`）拷进宿主工程的 rawfile；
//   ② 定位 DevEco 的 hvigorw（平台标准构建器）；
//   ③ 调 `hvigorw assembleHap` 产出 `.hap`。
//   ——"壳一层调 hvigorw"，与 hosts/harmony/build-host-app.sh 同一形态（该脚本用于本仓参考宿主）。
//
// 【签名（诚实边界）】华为 CA 调试证书属**机器本地**：模板只给 `signingConfigs: []`
//   （unsigned 可构建、不能装机）。装机需在 DevEco Studio 勾选 "Automatically generate signature"
//   一次，写入宿主工程的 build-profile.json5（本地，不入库）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync as __exec } from 'node:child_process'

/** 运行外部工具：**捕获 stdout+stderr**（execFileSync 默认把子进程 stderr 漏到终端 ⇒ javac/keytool/apksigner 噪声刷屏）。
 *  成功只返回 stdout；失败抛错（**stderr 在 err.stderr**，各调用点的 catch 已读）。 */
function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number; encoding?: BufferEncoding } = {}): string {
  return __exec(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
}
import { fileURLToPath } from 'node:url'
// ★Apollo 诊断（决策 #684）：把宿主工具链的失败归因成 Proteus 码 + 可行动建议 + **保留原文**
import { makeDiag, parseSwiftcOutput, captureRaw, type ProteusDiagnostic } from './diag'
import { resolveIosSigning, IOS_PROFILE_DIRS } from './signing'
import { resolveAndroidSdk, resolveJdk17, findApps } from './host-paths'
import { syncRuntimeUnits, syncShellTemplates } from './host-scaffold'

/** ★本模块所在目录（`packages/cli/src` 或 `dist`）——JDK 等**框架仓资源**上溯解析的起点。 */
const HERE_PKG = path.dirname(fileURLToPath(import.meta.url))

/** DevEco Contents 目录候选（与 hosts/harmony/build-host-app.sh 的 find_deveco 同策略） */
function resolveDevEco(): string | null {
  const candidates = [
    process.env.PROTEUS_DEVECO,
    '/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents',
    path.join(os.homedir(), 'Applications', 'DevEco-Studio.app', 'Contents'),
    '/Applications/DevEco-Studio.app/Contents',
  ].filter((c): c is string => !!c)
  for (const c of candidates) if (fs.existsSync(path.join(c, 'tools', 'hvigor', 'bin', 'hvigorw'))) return c
  return null
}

export interface PackageHostOptions {
  /** 宿主工程目录（含 entry/、proteus_render/、proteus.host.json） */
  hostDir: string
  /** 编译产物项目根（含 dist/app/<platform>/screen-content.json）；缺省 = 不拷产物 */
  projectRoot?: string
  platform?: string
}

export interface PackageHostResult {
  ok: boolean
  hostDir: string
  hap: string | null
  /** 已把编译产物拷进宿主 rawfile */
  screenContentCopied: boolean
  log: string[]
  /** ★Apollo 诊断（决策 #684）：失败时的结构化根因 */
  diagnostics?: ProteusDiagnostic[]
}

/** 把项目编译产物拷进宿主入口模块的 rawfile（若项目根与产物存在） */
function copyScreenContent(hostDir: string, projectRoot: string | undefined, platform: string, log: string[]): boolean {
  if (!projectRoot) return false
  const sc = path.join(projectRoot, 'dist', 'app', platform, 'screen-content.json')
  if (!fs.existsSync(sc)) {
    log.push(`⚠ 未见编译产物 ${path.relative(projectRoot, sc)}——沿用宿主 rawfile 既有产物`)
    return false
  }
  const rf = path.join(hostDir, 'entry', 'src', 'main', 'resources', 'rawfile')
  fs.mkdirSync(rf, { recursive: true })
  fs.copyFileSync(sc, path.join(rf, 'app-screen-content.json'))
  const gk = path.join(rf, '.gitkeep')
  if (fs.existsSync(gk)) fs.rmSync(gk)
  log.push(`✓ 编译产物已拷入 rawfile（${path.relative(projectRoot, sc)}）`)
  return true
}

/** 构建最小宿主工程为 .hap：拷产物 → 确保 build-profile → hvigorw assembleHap */
export function packageHarmonyHost(opts: PackageHostOptions): PackageHostResult {
  const hostDir = path.resolve(opts.hostDir)
  const platform = opts.platform ?? 'harmony'
  const log: string[] = []
  if (!fs.existsSync(path.join(hostDir, 'entry'))) {
    return { ok: false, hostDir, hap: null, screenContentCopied: false, log: [`✗ 不是宿主工程（缺 entry/）：${hostDir}`] }
  }
  // ⓪ ★runtime 源集自愈（决策 #692）：框架 runtime 改动同步进已存在宿主（否则改了 runtime 没生效）
  const sync = syncRuntimeUnits(hostDir, 'harmony')
  if (sync.synced) log.push(`ℹ runtime 源集已自愈同步（${sync.dirs.join(', ')}）`)
  // ① 产物拷入 rawfile
  const screenContentCopied = copyScreenContent(hostDir, opts.projectRoot, platform, log)
  // ② build-profile.json5（本地，含签名）——缺则从模板生成（unsigned）
  const bp = path.join(hostDir, 'build-profile.json5')
  if (!fs.existsSync(bp)) {
    const tpl = path.join(hostDir, 'build-profile.template.json5')
    if (fs.existsSync(tpl)) {
      fs.copyFileSync(tpl, bp)
      log.push('ℹ 已从 build-profile.template.json5 生成 build-profile.json5（未配置签名 ⇒ unsigned hap）')
    } else {
      return { ok: false, hostDir, hap: null, screenContentCopied, log: [...log, `✗ 缺 build-profile.json5 且无模板`] }
    }
  }
  // ③ DevEco hvigorw
  const deveco = resolveDevEco()
  if (!deveco) {
    return {
      ok: false,
      hostDir,
      hap: null,
      screenContentCopied,
      log: [...log, '✗ 找不到 DevEco Studio（用 PROTEUS_DEVECO 指定其 Contents 目录；无 DevEco 无法打包 hap）'],
    }
  }
  const hvigorw = path.join(deveco, 'tools', 'hvigor', 'bin', 'hvigorw')
  const env = {
    ...process.env,
    NODE_HOME: path.join(deveco, 'tools', 'node'),
    PATH: `${path.join(deveco, 'tools', 'node', 'bin')}:${process.env.PATH ?? ''}`,
    DEVECO_SDK_HOME: path.join(deveco, 'sdk'),
    JAVA_HOME: path.join(deveco, 'jbr', 'Contents', 'Home'),
  }
  // ②b ohpm install（file: 依赖 → oh_modules；缺它则 hvigor 的跨模块 native 聚合（PACKAGE_FIND_FILE）不生效）
  const ohpm = path.join(deveco, 'tools', 'ohpm', 'bin', 'ohpm')
  if (fs.existsSync(ohpm)) {
    try {
      run(ohpm, ['install', '--all'], { cwd: hostDir, env, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
      log.push('✓ ohpm install（依赖已解析到 oh_modules）')
    } catch (e) {
      log.push('⚠ ohpm install 失败（继续尝试构建）：' + String(e instanceof Error ? e.message : e).slice(0, 200))
    }
  } else {
    log.push('⚠ 未找到 ohpm —— 若构建报“target 未找到”，请在 DevEco 里先同步依赖')
  }
  log.push(`→ hvigorw assembleHap（${path.relative(path.dirname(deveco), hvigorw)}）`)
  try {
    const out = run(hvigorw, ['assembleHap', '--mode', 'module', '-p', 'product=default', '--no-daemon'], {
      cwd: hostDir,
      env,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    })
    log.push(...out.split('\n').filter((l) => l.trim()).slice(-6))
  } catch (e) {
    const msg = e instanceof Error ? (e as { stdout?: string }).stdout ?? e.message : String(e)
    return { ok: false, hostDir, hap: null, screenContentCopied, log: [...log, `✗ hvigor 构建失败：`, String(msg).slice(-1500)] }
  }
  // ④ 找产出 hap
  const outDir = path.join(hostDir, 'entry', 'build', 'default', 'outputs', 'default')
  let hap: string | null = null
  if (fs.existsSync(outDir)) {
    let cand = fs.readdirSync(outDir).filter((f) => f.endsWith('.hap'))
    // 优先已签名产物（能直接装机）；否则退回 unsigned
    const signedHap = cand.filter((f) => /-signed\.hap$/.test(f))
    if (signedHap.length) cand = signedHap
    cand.sort()
    if (cand.length) hap = path.join(outDir, cand[cand.length - 1])
  }
  if (!hap) return { ok: false, hostDir, hap: null, screenContentCopied, log: [...log, `✗ 未见 hap 产出（${path.relative(hostDir, outDir)}）`] }
  const signed = !/signingConfigs":\s*\[\s*\]/.test(fs.readFileSync(bp, 'utf-8'))
  log.push(`✓ 产出：${path.relative(hostDir, hap)}${signed ? '' : '（unsigned——装机需先在 DevEco 配置签名）'}`)
  return { ok: true, hostDir, hap, screenContentCopied, log }
}

/* ================= iOS（第三刀样板） ================= */
// `proteus build --target ios --package` —— 编译项目内容后**调平台工具链打包 .app**
//   · runtime 是**源集单元**（runtime/ + platform/ 的 .swift），与内核两 .a 一起由 swiftc 编译；
//   · 内核由 cargo 交叉编译（aarch64-apple-ios）：packages/layout-core-rust + packages/host-abi；
//   · 签名：从本机 provisioning profile 取 entitlements（与 hosts/ios/run-selfdraw.sh 同源流程）。
//   ★只"壳一层调 swiftc/codesign"，不自研工具链；装机用 devicectl（用户在设备上 run 或另调）。

export interface PackageIosOptions {
  hostDir: string
  /** 项目根（含 dist/app/ios/screen-content.json + bundle-superapp.js）；缺省 = 不拷产物 */
  projectRoot?: string
  /** ★dev 变体（决策 #683）：覆写 `ProteusBuildConfig.swift` 的 DEV/DEV_URL（bundle 走 HTTP + 热刷）。 */
  dev?: boolean
  /** dev server 基址（如 `http://192.168.x.x:51789`）；dev=true 时写入 DEV_URL。 */
  devUrl?: string
  /** 打包产物输出路径（缺省 `<hostDir>/build/ProteusHost.app`；CLI 传 dist/app/ios/ProteusHost.app）。 */
  outApp?: string
}

export interface PackageIosResult {
  ok: boolean
  hostDir: string
  app: string | null
  screenContentCopied: boolean
  log: string[]
  /** ★Apollo 诊断（决策 #684）：失败时的结构化根因（CLI 据此完整输出，**不再吞详情**） */
  diagnostics?: ProteusDiagnostic[]
}

/** 找框架仓根（含 packages/layout-core-rust）——内核 crate 在其下。
 *  ★起点要多：① PROTEUS_KERNEL_DIR 显式 ② cwd（工程内跑）③ CLI 包位置（开发态=本仓）
 *    ④ hostDir。**不能只从 hostDir**（生成的宿主常在 /tmp，向上找不到框架仓）。 */
function findRepoRootForKernel(hostDir: string): string | null {
  const explicit = process.env.PROTEUS_KERNEL_DIR
  if (explicit && fs.existsSync(path.join(explicit, 'packages', 'layout-core-rust', 'Cargo.toml'))) return explicit
  const starts = [process.cwd(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), hostDir]
  for (const start of starts) {
    let dir = start
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(path.join(dir, 'packages', 'layout-core-rust', 'Cargo.toml'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return null
}

/** 一个 Xcode 候选（供 doctor 透明展示 + 解析选择） */
export interface XcodeCandidate {
  /** `*.app/Contents/Developer`（DEVELOPER_DIR 形态） */
  dir: string
  /** `*.app` 路径（人读） */
  app: string
  /** 提供 iOS SDK（Platforms/iPhoneOS.platform 非空） */
  hasIosSdk: boolean
  /** 有 devicectl（Xcode ≥ 15 ⇒ 真机能力） */
  hasDevicectl: boolean
}

/**
 * ★枚举本机所有 Xcode（决策 #690 · 用户：「我装了多个 Xcode，不能强依赖默认安装路径」）。
 *   来源（合并去重）：① env（PROTEUS_DEVELOPER_DIR/DEVELOPER_DIR）② `xcode-select -p`
 *   ③ 常见安装位 ④ **Spotlight mdfind** ⑤ **有界 glob**（Applications、Volumes 一/二层下的 Xcode*.app）——
 *   Spotlight 关掉时兜底。★每个候选都实测能力（有 SDK / 有 devicectl），不靠"记忆中的路径"。
 */
let xcodesCache: XcodeCandidate[] | null = null
export function findAllXcodes(): XcodeCandidate[] {
  if (xcodesCache) return xcodesCache
  xcodesCache = computeAllXcodes()
  return xcodesCache
}
function computeAllXcodes(): XcodeCandidate[] {
  const roots = new Set<string>()
  const push = (p?: string | null): void => { if (p && p.trim()) roots.add(path.resolve(p.trim())) }
  push(process.env.PROTEUS_DEVELOPER_DIR)
  push(process.env.DEVELOPER_DIR)
  try { push(run('xcode-select', ['-p'], { encoding: 'utf-8' }).trim()) } catch { /* 无 xcode-select */ }
  // 常见位 + mdfind（Spotlight）
  push('/Applications/Xcode.app/Contents/Developer')
  push(path.join(os.homedir(), 'Applications', 'Xcode.app', 'Contents', 'Developer'))
  try {
    for (const p of run('mdfind', ["kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'"], { encoding: 'utf-8' }).split('\n')) {
      if (p.trim()) push(path.join(p.trim(), 'Contents', 'Developer'))
    }
  } catch { /* mdfind 不可用 */ }
  // ★★★有界 find 兜底（Spotlight 可能没索引 /Volumes 外部盘；且 `/Volumes/<a>/<b>/<c>/X.app` 深于 glob 层数）
  //   —— 与 host-paths.findApps 同源策略（任意层数、maxdepth 4）。
  try {
    for (const app of findApps('Xcode*.app')) push(path.join(app, 'Contents', 'Developer'))
  } catch { /* find 不可用 */ }
  const hasNonEmptySdk = (d: string): boolean => {
    const p = path.join(d, 'Platforms', 'iPhoneOS.platform')
    try {
      return fs.existsSync(p) && fs.readdirSync(p).length > 0
    } catch {
      return false
    }
  }
  return [...roots]
    .filter((d) => fs.existsSync(d))
    .map((d) => ({
      dir: d,
      app: d.replace(/\/Contents\/Developer\/?$/, ''),
      hasIosSdk: hasNonEmptySdk(d),
      hasDevicectl: fs.existsSync(path.join(d, 'usr', 'bin', 'devicectl')),
    }))
}

/**
 * ★解析可用 Xcode 的 DEVELOPER_DIR —— 判据 = **该目录能提供 iOS SDK**（纯文件系统）。
 *
 * 【为什么需要在 CLI 里做（本仓实测真缺陷）】`proteus dev/build --target ios` 此前只在**调用方 shell**
 *   设了 DEVELOPER_DIR 时才能成功——否则 swiftc 报 `SDK "iphoneos" cannot be located`（`xcode-select -p`
 *   指向 CommandLineTools，而完整 Xcode 在**非默认位**）。
 * 【多 Xcode（决策 #690）】不硬编码默认路径——`findAllXcodes()` 全盘枚举（mdfind + glob + env + xcode-select），
 *   按**能力完备度**两级偏好：① iOS SDK + devicectl（真机能力）② 至少 iOS SDK。
 *   ★`PROTEUS_DEVELOPER_DIR` 显式指定恒最高优先（用户表态 > 自动挑选）。
 */
export function resolveDeveloperDir(): string | null {
  const all = findAllXcodes()
  const explicit = process.env.PROTEUS_DEVELOPER_DIR
  if (explicit) {
    const hit = all.find((c) => c.dir === path.resolve(explicit))
    if (hit?.hasIosSdk) return hit.dir
  }
  // ① 真机能力完备（iOS SDK + devicectl）
  const full = all.find((c) => c.hasIosSdk && c.hasDevicectl)
  if (full) return full.dir
  // ② 至少给 iOS SDK（模拟器/类型检查够用）
  return all.find((c) => c.hasIosSdk)?.dir ?? null
}

function listSwift(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.swift')).sort().map((f) => path.join(dir, f))
}

/** 打包 iOS 最小宿主为 .app：产物拷入 → cargo 建核 → swiftc 编译 → 组装 .app → 签名 */
export function packageIosHost(opts: PackageIosOptions): PackageIosResult {
  const hostDir = path.resolve(opts.hostDir)
  const log: string[] = []
  if (!fs.existsSync(path.join(hostDir, 'runtime'))) return { ok: false, hostDir, app: null, screenContentCopied: false, log: [`✗ 不是 iOS 宿主工程（缺 runtime/）：${hostDir}`], diagnostics: [makeDiag('PT-BE-005', { raw: `缺 runtime/：${hostDir}` })] }
  // ⓪ ★runtime 源集自愈（决策 #692）：框架 runtime（含 #685 滚动惯性）改动同步进已存在宿主
  const sync = syncRuntimeUnits(hostDir, 'ios')
  if (sync.synced) log.push(`ℹ runtime 源集已自愈同步（${sync.dirs.join(', ')}）`)
  // ⓪' ★壳模板补缺（决策 #692）：模板新增文件（如 ProteusDevOverlay.swift）补进老宿主（只补缺、不覆盖）
  const added = syncShellTemplates(hostDir, 'ios')
  if (added.length) log.push(`ℹ 壳模板已补缺（${added.join(', ')}）`)
  const rtDir = path.join(hostDir, 'runtime')
  const platDir = path.join(hostDir, 'platform')
  const shellDir = path.join(hostDir, 'shell')
  const infoPlist = path.join(hostDir, 'Info.plist')
  if (!fs.existsSync(infoPlist)) return { ok: false, hostDir, app: null, screenContentCopied: false, log: [`✗ 缺 Info.plist：${hostDir}`], diagnostics: [makeDiag('PT-BE-005', { raw: `缺 Info.plist：${hostDir}` })] }
  const swifts = [...listSwift(rtDir), ...listSwift(platDir), ...listSwift(shellDir)]
  if (!swifts.length) return { ok: false, hostDir, app: null, screenContentCopied: false, log: ['✗ 源集为空（runtime/ + platform/ + shell/ 无 .swift）'], diagnostics: [makeDiag('PT-BE-005', { raw: '源集为空（runtime/ + platform/ + shell/ 无 .swift）' })] }
  const plistSrc = fs.readFileSync(infoPlist, 'utf-8')
  const bundleId = (plistSrc.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/) ?? [])[1] ?? ''
  if (!bundleId) return { ok: false, hostDir, app: null, screenContentCopied: false, log: ['✗ Info.plist 缺 CFBundleIdentifier'], diagnostics: [makeDiag('PT-BE-005', { raw: 'Info.plist 缺 CFBundleIdentifier' })] }

  // ② 编译产物 → hostDir（app-screen-content.json + bundle-superapp.js + app-config.json）
  let screenContentCopied = false
  if (opts.projectRoot) {
    const appDist = path.join(opts.projectRoot, 'dist', 'app', 'ios')
    const sc = path.join(appDist, 'screen-content.json')
    if (fs.existsSync(sc)) {
      fs.copyFileSync(sc, path.join(hostDir, 'app-screen-content.json'))
      screenContentCopied = true
      log.push('✓ 编译产物 app-screen-content.json 已就位')
    } else {
      log.push(`⚠ 未见 ${path.relative(opts.projectRoot, sc)}——沿用宿主既有产物`)
    }
    // ★运行期 bundle（App 壳的内容源）——缺则运行期壳无法启动（明确告警，不静默）
    const bundle = path.join(appDist, 'bundle-superapp.js')
    if (fs.existsSync(bundle)) {
      fs.copyFileSync(bundle, path.join(hostDir, 'bundle-superapp.js'))
      log.push(`✓ 运行期 bundle bundle-superapp.js 已就位（${(fs.statSync(bundle).size / 1024).toFixed(0)} KB）`)
    } else {
      log.push(`⚠ 未见 ${path.relative(opts.projectRoot, bundle)}——运行期壳需要它（先跑 proteus build 的 bundle 步骤）`)
    }
    const cfg = path.join(appDist, 'app-config.json')
    if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(hostDir, 'app-config.json'))
  }

  // ②' dev 变体：**就地**覆写 ProteusBuildConfig.swift（DEV/DEV_URL），构建后还原 release 默认
  const buildCfgPath = listSwift(shellDir).find((f) => f.endsWith('ProteusBuildConfig.swift')) ?? path.join(shellDir, 'ProteusBuildConfig.swift')
  let buildCfgBackup: string | null = null
  if (opts.dev === true) {
    if (!fs.existsSync(buildCfgPath)) {
      log.push('⚠ 未找到 ProteusBuildConfig.swift——dev 变体将无法把 bundle 指向 dev server')
    } else {
      buildCfgBackup = fs.readFileSync(buildCfgPath, 'utf-8')
      const url = (opts.devUrl ?? '').replace(/"/g, '')
      const out = buildCfgBackup
        .replace(/static let DEV = (?:true|false)/, 'static let DEV = true')
        .replace(/static let DEV_URL = "[^"]*"/, `static let DEV_URL = "${url}"`)
      fs.writeFileSync(buildCfgPath, out)
      log.push(`✓ dev 变体：ProteusBuildConfig DEV=true · DEV_URL=${url || '(未给)'}`)
    }
  }
  const restoreBuildCfg = () => {
    if (buildCfgBackup !== null) fs.writeFileSync(buildCfgPath, buildCfgBackup)
  }

  // ③ 内核：cargo build 两个 crate（aarch64-apple-ios）
  const repoRoot = findRepoRootForKernel(hostDir)
  if (!repoRoot) { restoreBuildCfg(); return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, '✗ 找不到框架仓（含 packages/layout-core-rust）'], diagnostics: [makeDiag('PT-BE-005', { cause: '本机找不到框架仓（含 packages/layout-core-rust）——iOS 打包需要内核 crate', raw: '找不到框架仓（含 packages/layout-core-rust）' })] } }
  // ★解析可用 Xcode（决策 #684）——用户无需预先 source xcode-env.sh；否则 swiftc 会报
  //   `SDK "iphoneos" cannot be located`（xcode-select 指向 CommandLineTools、完整 Xcode 在非默认位）。
  const devDir = resolveDeveloperDir()
  const env = {
    ...process.env,
    PATH: `${path.join(os.homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}`,
    ...(devDir ? { DEVELOPER_DIR: devDir } : {}),
  }
  const cargoTargetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, 'spike', 'target')
  for (const c of ['packages/layout-core-rust', 'packages/host-abi']) {
    log.push(`→ cargo build --release --target aarch64-apple-ios（${c}）`)
    try {
      run('cargo', ['build', '--release', '--target', 'aarch64-apple-ios', '--manifest-path', path.join(repoRoot, c, 'Cargo.toml')], { env, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(-1200)
      restoreBuildCfg()
      return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, '✗ cargo 编译失败：', msg], diagnostics: [makeDiag('PT-BD-002', { cause: `Rust 内核编译失败：${c}`, raw: msg })] }
    }
  }
  const libCore = path.join(cargoTargetDir, 'aarch64-apple-ios', 'release', 'libproteus_layout_core.a')
  const libAbi = path.join(cargoTargetDir, 'aarch64-apple-ios', 'release', 'libproteus_host_abi.a')
  for (const l of [libCore, libAbi]) if (!fs.existsSync(l)) { restoreBuildCfg(); return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, `✗ 未生成内核静态库：${l}`], diagnostics: [makeDiag('PT-BD-002', { cause: `cargo 未产出内核静态库：${l}`, raw: `未生成内核静态库：${l}` })] } }
  log.push('✓ 内核两静态库就位（libproteus_layout_core.a + libproteus_host_abi.a）')

  // ④ swiftc 编译（runtime 源集 + 内核 .a）
  const appDir = path.resolve(opts.outApp ?? path.join(hostDir, 'build', 'ProteusHost.app'))
  fs.rmSync(appDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  const exe = path.join(appDir, 'ProteusHost')
  log.push('→ swiftc 编译（runtime 源集 + 壳 + 内核）')
  try {
    run('xcrun', ['--sdk', 'iphoneos', 'swiftc', '-O', '-target', 'arm64-apple-ios15.0',
      '-framework', 'UIKit', '-framework', 'CoreText', '-framework', 'JavaScriptCore', '-framework', 'AVFoundation',
      '-parse-as-library', '-o', exe, ...swifts, libAbi, libCore], { env, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message)
    const errs = msg.split('\n').filter((l) => l.includes('error:')).slice(0, 8).join('\n')
    restoreBuildCfg()
    // ★Apollo L0：解析 swiftc 输出为逐条诊断（file:line:col + 消息）；解析不出则整段原文兜底。
    //   ★特判：`SDK "iphoneos" cannot be located` / `unable to load standard library` = **找不到可用 Xcode**
    //   （比对"未知错误"更有用——给出 PT-BE-001 + 可行动建议）。
    const xcodeMissing = /SDK "iphoneos" cannot be located|unable to load standard library for target/i.test(msg)
    const diags: ProteusDiagnostic[] = xcodeMissing
      ? [makeDiag('PT-BE-001', { cause: '当前工具链路径下找不到 iOS SDK（xcode-select 可能指向 CommandLineTools，或完整 Xcode 在非默认位置）', raw: msg.slice(-1500) })]
      : (() => {
          const parsed = parseSwiftcOutput(msg)
          return parsed.length ? parsed : [captureRaw('B', errs || msg.slice(-1500))]
        })()
    return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, '✗ swiftc 编译失败：', errs || msg.slice(-1000)], diagnostics: diags }
  }
  log.push('✓ swiftc 编译通过')
  restoreBuildCfg() // ★dev 变体：编译完成即还原 BuildConfig 为 release 默认（工程源码始终 release 形态）

  // ⑤ 组装 .app（Info.plist + 运行期 bundle + 屏内容 + app-config）
  let plistOut = plistSrc.replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleExecutable</key><string>ProteusHost</string>')
  // ★dev 变体：注入 ATS 例外（允许 HTTP 连局域网 dev server）——**仅 dev**，release 不含（保持默认 ATS 严格）
  if (opts.dev === true && !plistOut.includes('NSAppTransportSecurity')) {
    plistOut = plistOut.replace('</dict></plist>', '  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>\n</dict></plist>')
  }
  fs.writeFileSync(path.join(appDir, 'Info.plist'), plistOut)
  for (const res of ['app-screen-content.json', 'bundle-superapp.js', 'app-config.json']) {
    const src = path.join(hostDir, res)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(appDir, res))
  }
  if (!fs.existsSync(path.join(appDir, 'bundle-superapp.js'))) log.push('⚠ .app 内缺 bundle-superapp.js——运行期壳无法启动（先跑 proteus build 产出 bundle）')
  log.push('✓ .app 已组装')

  // ⑥ 签名（本机 provisioning profile；与 run-selfdraw.sh 同源）
  const sign = signApp(appDir, bundleId, log)
  if (!sign.ok) return { ok: false, hostDir, app: null, screenContentCopied, log, diagnostics: sign.diagnostics }
  log.push(`✓ 产出：${path.relative(hostDir, appDir)}（已签名，可 devicectl 装机）`)
  return { ok: true, hostDir, app: appDir, screenContentCopied, log }
}

/**
 * ★查找覆盖某 bundleId 的本机 provisioning profile（**唯一实现**——signApp 与 doctor 共用）。
 *   ★决策 #688：委托给 `signing.ts`（**随 CLI 包分发**的可移植签名核心，不再依赖框架 `hosts/ios/lib`）——
 *   判据 = 描述文件 ∩ 钥匙串（未过期且授权证书在本机），容器内无匹配 ⇒ null。
 * @returns 命中的 profile 路径，或 null
 */
export function findIosSigningProfile(bundleId: string): string | null {
  const r = resolveIosSigning(bundleId)
  return r.ok && r.profile ? r.profile.file : null
}

/** 用本机 provisioning profile 签名 .app（entitlements 从 profile 原样提取——同 run-selfdraw.sh） */
function signApp(appDir: string, bundleId: string, log: string[]): { ok: boolean; diagnostics?: ProteusDiagnostic[] } {
  const profileDir = IOS_PROFILE_DIRS[0]
  // ★★★签名身份 = **描述文件授权 ∩ 钥匙串**（决策 #694）：此前这里从 `security find-identity` 取
  //   **首个** Apple Development 证书 —— 续签后**同名的两张证书**（旧/新）取第一张 ⇒ 可能签成
  //   **设备未信任的那张**（真机表现为 `FBSOpenApplicationErrorDomain` 装机后被拦）。
  //   与 `run-selfdraw.sh`/`signing.ts` 同源（那边早用交集判据）——**单一实现**，不再各取各的。
  const resolved = resolveIosSigning(bundleId)
  const profile = resolved.ok && resolved.profile ? resolved.profile.file : ''
  if (!profile || !resolved.identity) {
    log.push(`✗ 无匹配描述文件（bundleId=${bundleId}）`)
    // ★L3（确定原因）：本机描述文件列表里没有覆盖该 bundleId 的 profile ⇒ 可行动
    return {
      ok: false,
      diagnostics: [
        makeDiag('PT-BE-003', {
          cause: `本机描述文件（~/Library/Developer/Xcode/UserData/Provisioning Profiles/）中没有覆盖 bundleId「${bundleId}」的 profile`,
          suggestions: [
            `给 ${bundleId} 建 Apple 开发描述文件：Xcode → New Project → iOS App（Bundle ID 填 ${bundleId}）→ 勾 Automatically manage signing 选 Team（此工程仅为建描述文件，可弃）`,
            `查本机已有描述文件与证书：proteus host signing ios --list`,
            `或把项目的 iOS bundleId（proteus.config 的 native.ios.bundleId，当前 ${bundleId}）改成某个已有描述文件覆盖的 id`,
          ],
          raw: `无匹配描述文件（bundleId=${bundleId}）\nprofiles dir: ${profileDir}`,
        }),
      ],
    }
  }
  // 交集里取**最新签发**的一张（与 signing.ts 同一判据；续签 = 最新那张）
  const identity = resolved.identity.sha1
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-ios-'))
  try {
    const plist = run('security', ['cms', '-D', '-i', profile], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
    fs.writeFileSync(path.join(tmp, 'profile.plist'), plist)
    const ent = run('/usr/libexec/PlistBuddy', ['-x', '-c', 'Print :Entitlements', path.join(tmp, 'profile.plist')], { encoding: 'utf-8' })
    fs.writeFileSync(path.join(tmp, 'entitlements.plist'), ent)
    fs.copyFileSync(profile, path.join(appDir, 'embedded.mobileprovision'))
    run('codesign', ['--force', '--sign', identity, '--entitlements', path.join(tmp, 'entitlements.plist'), '--timestamp=none', appDir], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
    log.push(`✓ 已签名（identity=${identity.slice(0, 8)}… profile=${path.basename(profile)}）`)
    return { ok: true }
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(-600)
    log.push('✗ codesign 失败：' + msg)
    return { ok: false, diagnostics: [makeDiag('PT-BE-003', { cause: 'codesign 执行失败（身份/描述文件不匹配或 entitlement 越权）', raw: msg })] }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/* ================= Android（第四刀样板） ================= */
// `proteus build --target android --package` —— 编译项目内容后**调平台工具链打包 .apk**
//   · runtime = **AAR**（libs/proteus-runtime.aar，保持同包 dev.proteus.layoutcore）；
//   · 链路（无 Gradle，与 hosts/android/build-and-run.sh 同款）：javac 壳（-cp android.jar:classes.jar）
//     → d8（--lib android.jar，含 AAR classes）→ aapt2 link（manifest+assets）→ zip(dex + jni .so)
//     → zipalign -f 16384 → apksigner（自生成 debug.keystore）→ .apk。
//   ★只"壳一层调平台工具链"，不自研工具链；签名用**调试 keystore**（自动生成，机器本地）。

export interface PackageAndroidOptions {
  hostDir: string
  /** 项目根（含 dist/app/android/screen-content.json 与 bundle-superapp.js）；缺省 = 不拷产物 */
  projectRoot?: string
  /** ★★★dev 变体（2026-10-08）：选 `AndroidManifest.dev.xml`（含 INTERNET）+ 覆写 ProteusBuildConfig 的 DEV/DEV_URL。 */
  dev?: boolean
  /** dev server 基址（如 `http://192.168.x.x:51789`）；dev=true 时写入 BuildConfig.DEV_URL。 */
  devUrl?: string
  /** 打包产物输出路径（缺省 `<hostDir>/build/proteus-host.apk`；CLI 传 dist/app/android/proteus-host.apk）。 */
  outApk?: string
}

export interface PackageAndroidResult {
  ok: boolean
  hostDir: string
  apk: string | null
  screenContentCopied: boolean
  log: string[]
  /** ★Apollo 诊断（决策 #684）：失败时的结构化根因 */
  diagnostics?: ProteusDiagnostic[]
}

/** Android SDK 解析（决策 #691：不硬编码默认位——走 host-paths 的全盘枚举 + 能力判据） */
function androidSdk(): { sdk: string; platform: string; buildTools: string } | null {
  const hit = resolveAndroidSdk()
  if (!hit || !hit.hasPlatforms || !hit.hasBuildTools || !hit.androidJar || !hit.buildToolsDir) return null
  return { sdk: hit.sdk, platform: hit.androidJar, buildTools: hit.buildToolsDir }
}

/** JDK 解析（决策 #691：不只看 JAVA_HOME/.tools——枚举系统 JVM·Homebrew·sdkman·IDE 自带 JBR） */
function findJdk(): string | null {
  // ★框架 .tools/jdk17 仍作为**最高兜底**（仓内工程习惯）；优先系统/IDE 的就绪 JDK。
  //   `resolveJdk17` 已含 `.tools/jdk17`（framework .tools 来源）⇒ 直接用它。
  const hit = resolveJdk17()
  if (hit?.hasJavac) return hit.home
  // 兜底：框架根上溯的 .tools（HERE_PKG 是 dist/src 所在；工程 cwd 未必是框架根）
  let dir = HERE_PKG
  for (let i = 0; i < 8; i++) {
    for (const c of [path.join(dir, '.tools', 'jdk17'), path.join(dir, '.tools', 'jdk-17.0.20.1+1', 'Contents', 'Home')]) {
      if (fs.existsSync(path.join(c, 'bin', 'javac'))) return c
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/**
 * 打包 Android 最小宿主为 .apk：产物拷入 → javac → d8 → aapt2 → zip → zipalign → apksigner。
 * ★★★dev/release 变体（2026-10-08 · 用户「dev 与 build 怎么区分」）：
 *   · release（默认）：manifest=`AndroidManifest.xml`（无 INTERNET），BuildConfig.DEV=false（bundle 内嵌 assets）。
 *   · dev（`dev:true`）：manifest=`AndroidManifest.dev.xml`（含 INTERNET+cleartext），
 *     **构建前覆写** `src/.../ProteusBuildConfig.java` 的 DEV=true / DEV_URL=<devUrl>（bundle 走 HTTP + 热刷）。
 *     覆写是**就地**的（写在宿主工程内，构建后**还原为 release 默认**——保证工程源码始终是 release 形态）。
 */
export function packageAndroidHost(opts: PackageAndroidOptions): PackageAndroidResult {
  const hostDir = path.resolve(opts.hostDir)
  const log: string[] = []
  const isDev = opts.dev === true
  // ★dev 变体选 dev manifest（缺则回落 release 并告警——不静默产"没有网络权限的 dev 包"）
  let manifest = path.join(hostDir, 'AndroidManifest.xml')
  if (isDev) {
    const devManifest = path.join(hostDir, 'AndroidManifest.dev.xml')
    if (fs.existsSync(devManifest)) manifest = devManifest
    else log.push('⚠ dev 变体缺 AndroidManifest.dev.xml——回落 release manifest（dev 通道可能无网络权限）')
  }
  if (!fs.existsSync(manifest)) return { ok: false, hostDir, apk: null, screenContentCopied: false, log: [`✗ 不是 Android 宿主工程（缺 AndroidManifest.xml）：${hostDir}`] }
  const assetsDir = path.join(hostDir, 'app/src/main/assets')
  const srcDir = path.join(hostDir, 'src')
  if (!fs.existsSync(srcDir)) return { ok: false, hostDir, apk: null, screenContentCopied: false, log: ['✗ 缺 src/'] }

  // ① runtime AAR（libs/proteus-runtime.aar）——缺则尝试框架仓构建
  const aarPath = path.join(hostDir, 'libs', 'proteus-runtime.aar')
  if (!fs.existsSync(aarPath)) return { ok: false, hostDir, apk: null, screenContentCopied: false, log: [`✗ 缺 runtime AAR：${path.relative(hostDir, aarPath)}`], diagnostics: [makeDiag('PT-BE-005', { cause: `宿主缺 runtime AAR：${path.relative(hostDir, aarPath)}`, suggestions: ['删除宿主目录后重生成：proteus create host android <dir>（会从 CLI 随包 runtime 拷入）', '若已在项目内：删掉 dist/app/android/host 后重跑 proteus build --target android --package'], raw: `缺 runtime AAR：${aarPath}` })] }
  // ★★★runtime AAR 定向自愈（2026-10-09 · 决策 #685 用户实测「安卓滑了还是一样」的根因）：
  //   `createHost` 是**一次性 scaffold**——已存在的宿主**不会**再拷 AAR ⇒ 改了 runtime 源码（如本次
  //   加竖向 fling）后，旧宿主仍打包**陈旧 AAR** ⇒ "改了没生效、症状照旧"。与 D3 主题自愈同源。
  //   ⇒ 打包前，若 CLI 随包 prebuilt AAR 与宿主里的**不一致**，就用 prebuilt 覆盖（runtime 属框架拥有，
  //     非项目自有产物）。这样任何**已生成**宿主下次 `build --package`/`dev` 自动拿到最新 runtime。
  try {
    const prebuilt = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates-host', 'prebuilt', 'android', 'proteus-runtime.aar')
    if (fs.existsSync(prebuilt)) {
      const same = fs.statSync(prebuilt).size === fs.statSync(aarPath).size &&
        fs.readFileSync(prebuilt).equals(fs.readFileSync(aarPath))
      if (!same) {
        fs.copyFileSync(prebuilt, aarPath)
        log.push('ℹ runtime AAR 已自愈更新（宿主陈旧 → 覆盖为 CLI 随包版本）')
      }
    }
  } catch (e) {
    log.push(`⚠ runtime AAR 自愈检查失败（继续打包旧 AAR）：${e instanceof Error ? e.message : String(e)}`)
  }

  // ② 编译产物 → assets（screen-content.json + bundle-superapp.js + app-config.json）
  let screenContentCopied = false
  if (opts.projectRoot) {
    const appDist = path.join(opts.projectRoot, 'dist', 'app', 'android')
    fs.mkdirSync(assetsDir, { recursive: true })
    const sc = path.join(appDist, 'screen-content.json')
    if (fs.existsSync(sc)) {
      fs.copyFileSync(sc, path.join(assetsDir, 'app-screen-content.json'))
      screenContentCopied = true
      log.push('✓ 编译产物 app-screen-content.json 已就位')
    } else {
      log.push(`⚠ 未见 ${path.relative(opts.projectRoot, sc)}——沿用宿主既有产物`)
    }
    // ★运行期 bundle（App 壳的内容源）——缺则运行期壳无法启动（明确告警，不静默）
    const bundle = path.join(appDist, 'bundle-superapp.js')
    if (fs.existsSync(bundle)) {
      fs.copyFileSync(bundle, path.join(assetsDir, 'bundle-superapp.js'))
      log.push(`✓ 运行期 bundle bundle-superapp.js 已就位（${(fs.statSync(bundle).size / 1024).toFixed(0)} KB）`)
    } else {
      log.push(`⚠ 未见 ${path.relative(opts.projectRoot, bundle)}——运行期壳需要它（先跑 proteus build 的 bundle 步骤）`)
    }
    const cfg = path.join(appDist, 'app-config.json')
    if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(assetsDir, 'app-config.json'))
  }

  // ②' dev 变体：**就地**覆写 ProteusBuildConfig（DEV/DEV_URL），并在 finally 还原 release 默认
  const buildCfgPath = listFiles(srcDir, '.java').find((f) => f.endsWith('ProteusBuildConfig.java'))
  let buildCfgBackup: string | null = null
  if (isDev) {
    if (!buildCfgPath) {
      log.push('⚠ 未找到 ProteusBuildConfig.java——dev 变体将无法把 bundle 指向 dev server')
    } else {
      buildCfgBackup = fs.readFileSync(buildCfgPath, 'utf-8')
      const url = (opts.devUrl ?? '').replace(/"/g, '')
      const out = buildCfgBackup
        .replace(/public static final boolean DEV = (?:true|false);/, 'public static final boolean DEV = true;')
        .replace(/public static final String DEV_URL = "[^"]*";/, `public static final String DEV_URL = "${url}";`)
      fs.writeFileSync(buildCfgPath, out)
      log.push(`✓ dev 变体：BuildConfig DEV=true · DEV_URL=${url || '(未给)'}`)
    }
  }

  // ③ 工具链
  const sdkInfo = androidSdk()
  if (!sdkInfo) {
    if (buildCfgBackup && buildCfgPath) fs.writeFileSync(buildCfgPath, buildCfgBackup)
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ 找不到 Android SDK（设 ANDROID_HOME）'], diagnostics: [makeDiag('PT-BE-002', { cause: '找不到 Android SDK（缺 platforms/ 或 build-tools/）', raw: '找不到 Android SDK（设 ANDROID_HOME）' })] }
  }
  const jdk = findJdk()
  if (!jdk) {
    if (buildCfgBackup && buildCfgPath) fs.writeFileSync(buildCfgPath, buildCfgBackup)
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ 找不到 javac（设 JAVA_HOME 或 .tools/jdk17）'], diagnostics: [makeDiag('PT-BE-002', { cause: '找不到 javac（Android 打包需 JDK 17）', raw: '找不到 javac（设 JAVA_HOME 或 .tools/jdk17）' })] }
  }
  const { platform, buildTools } = sdkInfo
  // ★d8/apksigner 是 Java 启动脚本：需 JAVA_HOME（javac 用全路径不受影响，但子工具读 JAVA_HOME）
  const env = { ...process.env, JAVA_HOME: jdk }
  const restore = () => {
    if (buildCfgBackup !== null && buildCfgPath) fs.writeFileSync(buildCfgPath, buildCfgBackup)
  }

  // ④ AAR → classes.jar（unzip）
  const build = path.join(hostDir, 'build')
  fs.rmSync(build, { recursive: true, force: true })
  const extract = path.join(build, 'aar')
  fs.mkdirSync(extract, { recursive: true })
  try {
    run('unzip', ['-o', '-q', aarPath, '-d', extract], { encoding: 'utf-8' })
  } catch (e) {
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ 解压 AAR 失败：' + String((e as Error).message).slice(-400)] }
  }
  const classesJar = path.join(extract, 'classes.jar')
  if (!fs.existsSync(classesJar)) { restore(); return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ AAR 内缺 classes.jar'] } }
  const jniSo = path.join(extract, 'jni/arm64-v8a/libproteus_jni.so')
  if (!fs.existsSync(jniSo)) { restore(); return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ AAR 内缺 jni/arm64-v8a/libproteus_jni.so'] } }

  // ⑤ javac 壳（-cp android.jar:classes.jar）
  const classesDir = path.join(build, 'classes')
  fs.mkdirSync(classesDir, { recursive: true })
  const javaSrcs = listFiles(srcDir, '.java')
  if (!javaSrcs.length) { restore(); return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ src/ 无 .java'] } }
  log.push(`→ javac（壳 ${javaSrcs.length} 个源；-cp android.jar:classes.jar）`)
  try {
    run(path.join(jdk, 'bin', 'javac'), ['-nowarn', '-encoding', 'UTF-8', '--release', '17', '-cp', `${platform}:${classesJar}`, '-d', classesDir, ...javaSrcs], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message)
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ javac 失败：', msg.slice(-1200)] }
  }
  log.push('✓ javac 通过')

  // ⑥ d8（真源 = 壳 classes + AAR classes.jar）
  const dexDir = path.join(build, 'dex')
  fs.mkdirSync(dexDir, { recursive: true })
  const classFiles = listFiles(classesDir, '.class')
  log.push('→ d8（壳 classes + AAR classes.jar）')
  try {
    run(path.join(buildTools, 'd8'), ['--release', '--min-api', '24', '--lib', platform, '--output', dexDir, ...classFiles, classesJar], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, env })
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message)
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ d8 失败：', msg.slice(-1200)] }
  }
  if (!fs.existsSync(path.join(dexDir, 'classes.dex'))) { restore(); return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ d8 未产出 classes.dex'] } }
  log.push('✓ d8 通过（classes.dex）')

  // ⑦ aapt2 link → 基础 APK（manifest + assets）
  const apk = path.join(build, 'proteus-host.apk')
  const genDir = path.join(build, 'gen')
  fs.mkdirSync(genDir, { recursive: true })
  log.push('→ aapt2 link')
  // ★★★versionCode/Name 从 manifest 取（决策 #668）——此前**硬编码 `1`/`0.1.0`**，
  //   覆盖 manifest 里由 `proteus.config` native 段注入的真值 ⇒ 每个包 versionCode 恒为 1
  //   ⇒ 装到已有更高 versionCode 的机器上报 `INSTALL_FAILED_VERSION_DOWNGRADE`（用户实测）。
  //   manifest 已由 `applyNativeConfigFromProject` 写入 project 的 versionCode/Name ⇒ 以它为准。
  let manifestXml = fs.readFileSync(manifest, 'utf-8')
  // ★★★activity 主题规范化（决策 #670）：旧模板用 `Theme.NoTitleBar.Fullscreen`（theme 级 windowFullscreen +
  //   黑 windowBackground）与运行期 edge-to-edge 冲突 ⇒ **状态栏/导航区渲染为默认黑**；新模板用
  //   `Theme.Material.NoActionBar`（透明）。而宿主是**一次性 scaffold**（已生成的不会自动拿到模板修复）⇒
  //   在此做**定向、幂等**迁移：只改这一个已知旧值（不动包名/版本/权限等其它内容），老宿主下次 dev/build 即自愈。
  if (manifestXml.includes('@android:style/Theme.NoTitleBar.Fullscreen')) {
    manifestXml = manifestXml.replace(/@android:style\/Theme\.NoTitleBar\.Fullscreen/g, '@android:style/Theme.Material.NoActionBar')
    try {
      fs.writeFileSync(manifest, manifestXml)
      log.push('✓ activity 主题已规范化（NoTitleBar.Fullscreen → Material.NoActionBar · 修状态栏黑边）')
    } catch { /* 只读文件系统 ⇒ 无从落盘；aapt2 仍读磁盘 manifest（原始旧主题）——极少见，忽略 */ }
  }
  const vCode = (manifestXml.match(/android:versionCode\s*=\s*"(\d+)"/) ?? [])[1] ?? '1'
  const vName = (manifestXml.match(/android:versionName\s*=\s*"([^"]+)"/) ?? [])[1] ?? '0.1.0'
  try {
    run(path.join(buildTools, 'aapt2'), ['link', '-o', apk, '-I', platform, '--manifest', manifest,
      '--min-sdk-version', '24', '--target-sdk-version', '34', '--version-code', vCode, '--version-name', vName,
      '-A', assetsDir, '--java', genDir], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, env })
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message)
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ aapt2 link 失败：', msg.slice(-1200)] }
  }

  // ⑧ zip：classes.dex（root）+ jni libs（stored）
  const libDir = path.join(build, 'lib', 'arm64-v8a')
  fs.mkdirSync(libDir, { recursive: true })
  for (const so of fs.readdirSync(path.join(extract, 'jni/arm64-v8a'))) {
    fs.copyFileSync(path.join(extract, 'jni/arm64-v8a', so), path.join(libDir, so))
  }
  try {
    run('zip', ['-q', '-j', apk, path.join(dexDir, 'classes.dex')], { cwd: build, encoding: 'utf-8' })
    for (const so of fs.readdirSync(libDir)) {
      run('zip', ['-q', '-0', apk, `lib/arm64-v8a/${so}`], { cwd: build, encoding: 'utf-8' })
    }
  } catch (e) {
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ 组装 APK 失败：' + String((e as Error).message).slice(-400)] }
  }
  log.push('✓ 组装 APK（classes.dex + jni .so）')

  // ⑨ zipalign -f 16384
  const aligned = path.join(build, 'proteus-host-aligned.apk')
  try {
    run(path.join(buildTools, 'zipalign'), ['-f', '16384', apk, aligned], { encoding: 'utf-8' })
    fs.renameSync(aligned, apk)
  } catch (e) {
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ zipalign 失败：' + String((e as Error).message).slice(-400)] }
  }

  // ⑩ apksigner（自生成 debug.keystore）
  const ks = path.join(build, 'debug.keystore')
  try {
    run(path.join(jdk, 'bin', 'keytool'), ['-genkeypair', '-keystore', ks, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=Android,C=US', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000'], { encoding: 'utf-8', env })
    run(path.join(buildTools, 'apksigner'), ['sign', '--ks', ks, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', apk], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, env })
    run(path.join(buildTools, 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf-8', env })
  } catch (e) {
    restore()
    return { ok: false, hostDir, apk: null, screenContentCopied, log: [...log, '✗ 签名失败：' + String((e as Error).message).slice(-600)] }
  }
  log.push(`✓ 产出：${path.relative(hostDir, apk)}（已签名 v1+v2，可 adb install）`)
  restore()   // ★dev 变体：还原 ProteusBuildConfig 为 release 默认（工程源码始终 release 形态）
  // ★★★产物输出（2026-10-08）：CLI 传 outApk ⇒ 拷贝到 `dist/app/android/proteus-host.apk`
  //   （用户「dist 里要直接有打包好的安装包」）。未传则留在宿主工程 build/ 下。
  let finalApk = apk
  if (opts.outApk) {
    const dest = path.resolve(opts.outApk)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(apk, dest)
    finalApk = dest
    log.push(`✓ 安装包输出：${dest}（${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB）`)
  }
  return { ok: true, hostDir, apk: finalApk, screenContentCopied, log }
}

/** 递归列出目录下某扩展名的文件 */
function listFiles(dir: string, ext: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(ext)) out.push(p)
    }
  }
  walk(dir)
  return out.sort()
}
