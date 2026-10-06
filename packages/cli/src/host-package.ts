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
