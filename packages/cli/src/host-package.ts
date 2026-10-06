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
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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
      execFileSync(ohpm, ['install', '--all'], { cwd: hostDir, env, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
      log.push('✓ ohpm install（依赖已解析到 oh_modules）')
    } catch (e) {
      log.push('⚠ ohpm install 失败（继续尝试构建）：' + String(e instanceof Error ? e.message : e).slice(0, 200))
    }
  } else {
    log.push('⚠ 未找到 ohpm —— 若构建报“target 未找到”，请在 DevEco 里先同步依赖')
  }
  log.push(`→ hvigorw assembleHap（${path.relative(path.dirname(deveco), hvigorw)}）`)
  try {
    const out = execFileSync(hvigorw, ['assembleHap', '--mode', 'module', '-p', 'product=default', '--no-daemon'], {
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
  /** 项目根（含 dist/app/ios/screen-content.json）；缺省 = 不拷产物 */
  projectRoot?: string
}

export interface PackageIosResult {
  ok: boolean
  hostDir: string
  app: string | null
  screenContentCopied: boolean
  log: string[]
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

function listSwift(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.swift')).sort().map((f) => path.join(dir, f))
}

/** 打包 iOS 最小宿主为 .app：产物拷入 → cargo 建核 → swiftc 编译 → 组装 .app → 签名 */
export function packageIosHost(opts: PackageIosOptions): PackageIosResult {
  const hostDir = path.resolve(opts.hostDir)
  const log: string[] = []
  const rtDir = path.join(hostDir, 'runtime')
  const platDir = path.join(hostDir, 'platform')
  const shellDir = path.join(hostDir, 'shell')
  const infoPlist = path.join(hostDir, 'Info.plist')
  if (!fs.existsSync(rtDir)) return { ok: false, hostDir, app: null, screenContentCopied: false, log: [`✗ 不是 iOS 宿主工程（缺 runtime/）：${hostDir}`] }
  if (!fs.existsSync(infoPlist)) return { ok: false, hostDir, app: null, screenContentCopied: false, log: [`✗ 缺 Info.plist：${hostDir}`] }
  const swifts = [...listSwift(rtDir), ...listSwift(platDir), ...listSwift(shellDir)]
  if (!swifts.length) return { ok: false, hostDir, app: null, screenContentCopied: false, log: ['✗ 源集为空（runtime/ + platform/ + shell/ 无 .swift）'] }
  const plistSrc = fs.readFileSync(infoPlist, 'utf-8')
  const bundleId = (plistSrc.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/) ?? [])[1] ?? ''
  if (!bundleId) return { ok: false, hostDir, app: null, screenContentCopied: false, log: ['✗ Info.plist 缺 CFBundleIdentifier'] }

  // ② 编译产物 → hostDir/app-screen-content.json
  let screenContentCopied = false
  if (opts.projectRoot) {
    const sc = path.join(opts.projectRoot, 'dist', 'app', 'ios', 'screen-content.json')
    if (fs.existsSync(sc)) {
      fs.copyFileSync(sc, path.join(hostDir, 'app-screen-content.json'))
      screenContentCopied = true
      log.push('✓ 编译产物 app-screen-content.json 已就位')
    } else {
      log.push(`⚠ 未见 ${path.relative(opts.projectRoot, sc)}——沿用宿主既有产物`)
    }
  }

  // ③ 内核：cargo build 两个 crate（aarch64-apple-ios）
  const repoRoot = findRepoRootForKernel(hostDir)
  if (!repoRoot) return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, '✗ 找不到框架仓（含 packages/layout-core-rust）'] }
  const env = { ...process.env, PATH: `${path.join(os.homedir(), '.cargo', 'bin')}:${process.env.PATH ?? ''}` }
  const cargoTargetDir = process.env.CARGO_TARGET_DIR ?? path.join(repoRoot, 'spike', 'target')
  for (const c of ['packages/layout-core-rust', 'packages/host-abi']) {
    log.push(`→ cargo build --release --target aarch64-apple-ios（${c}）`)
    try {
      execFileSync('cargo', ['build', '--release', '--target', 'aarch64-apple-ios', '--manifest-path', path.join(repoRoot, c, 'Cargo.toml')], { env, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(-1200)
      return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, '✗ cargo 编译失败：', msg] }
    }
  }
  const libCore = path.join(cargoTargetDir, 'aarch64-apple-ios', 'release', 'libproteus_layout_core.a')
  const libAbi = path.join(cargoTargetDir, 'aarch64-apple-ios', 'release', 'libproteus_host_abi.a')
  for (const l of [libCore, libAbi]) if (!fs.existsSync(l)) return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, `✗ 未生成内核静态库：${l}`] }
  log.push('✓ 内核两静态库就位（libproteus_layout_core.a + libproteus_host_abi.a）')

  // ④ swiftc 编译（runtime 源集 + 内核 .a）
  const appDir = path.join(hostDir, 'build', 'ProteusHost.app')
  fs.rmSync(appDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  const exe = path.join(appDir, 'ProteusHost')
  log.push('→ swiftc 编译（runtime 源集 + 壳 + 内核）')
  try {
    execFileSync('xcrun', ['--sdk', 'iphoneos', 'swiftc', '-O', '-target', 'arm64-apple-ios15.0',
      '-framework', 'UIKit', '-framework', 'CoreText', '-framework', 'JavaScriptCore', '-framework', 'AVFoundation',
      '-parse-as-library', '-o', exe, ...swifts, libAbi, libCore], { env, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message)
    const errs = msg.split('\n').filter((l) => l.includes('error:')).slice(0, 8).join('\n')
    return { ok: false, hostDir, app: null, screenContentCopied, log: [...log, '✗ swiftc 编译失败：', errs || msg.slice(-1000)] }
  }
  log.push('✓ swiftc 编译通过')

  // ⑤ 组装 .app
  const plistOut = plistSrc.replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleExecutable</key><string>ProteusHost</string>')
  fs.writeFileSync(path.join(appDir, 'Info.plist'), plistOut)
  const scOut = path.join(hostDir, 'app-screen-content.json')
  if (fs.existsSync(scOut)) fs.copyFileSync(scOut, path.join(appDir, 'app-screen-content.json'))
  log.push('✓ .app 已组装')

  // ⑥ 签名（本机 provisioning profile；与 run-selfdraw.sh 同源）
  if (!signApp(appDir, bundleId, log)) return { ok: false, hostDir, app: null, screenContentCopied, log }
  log.push(`✓ 产出：${path.relative(hostDir, appDir)}（已签名，可 devicectl 装机）`)
  return { ok: true, hostDir, app: appDir, screenContentCopied, log }
}

/** 用本机 provisioning profile 签名 .app（entitlements 从 profile 原样提取——同 run-selfdraw.sh） */
function signApp(appDir: string, bundleId: string, log: string[]): boolean {
  const profileDir = path.join(os.homedir(), 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles')
  let profile = ''
  try {
    for (const f of fs.readdirSync(profileDir)) {
      if (!f.endsWith('.mobileprovision')) continue
      const pf = path.join(profileDir, f)
      try {
        const plist = execFileSync('security', ['cms', '-D', '-i', pf], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
        const m = plist.match(/<key>application-identifier<\/key>\s*<string>([^<]+)<\/string>/)
        if (m && m[1].endsWith(`.${bundleId}`)) { profile = pf; break }
      } catch { /* 跳过无效 profile */ }
    }
  } catch { /* 无 profile 目录 */ }
  if (!profile) { log.push(`✗ 无匹配描述文件（bundleId=${bundleId}）`); return false }
  let identity = ''
  try {
    const ids = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf-8' })
    const m = ids.split('\n').filter((l) => !l.includes('CSSMERR') && /Apple Development|iPhone Developer/.test(l)).join('\n').match(/[0-9A-F]{40}/)
    if (m) identity = m[0]
  } catch { /* fallthrough */ }
  if (!identity) { log.push('✗ 无签名身份（security find-identity）'); return false }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-ios-'))
  try {
    const plist = execFileSync('security', ['cms', '-D', '-i', profile], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 })
    fs.writeFileSync(path.join(tmp, 'profile.plist'), plist)
    const ent = execFileSync('/usr/libexec/PlistBuddy', ['-x', '-c', 'Print :Entitlements', path.join(tmp, 'profile.plist')], { encoding: 'utf-8' })
    fs.writeFileSync(path.join(tmp, 'entitlements.plist'), ent)
    fs.copyFileSync(profile, path.join(appDir, 'embedded.mobileprovision'))
    execFileSync('codesign', ['--force', '--sign', identity, '--entitlements', path.join(tmp, 'entitlements.plist'), '--timestamp=none', appDir], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 })
    log.push(`✓ 已签名（identity=${identity.slice(0, 8)}… profile=${path.basename(profile)}）`)
    return true
  } catch (e) {
    log.push('✗ codesign 失败：' + String((e as { stderr?: string }).stderr ?? (e as Error).message).slice(-600))
    return false
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
