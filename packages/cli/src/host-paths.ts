// packages/cli/src/host-paths.ts —— ★★★本机工具链路径解析（不硬编码默认安装位）· 决策 #691
//
// 【为什么有它（用户原话）】「不仅仅是 xcode，还有安卓和鸿蒙的开发 IDE 路径获取也是一个道理，
//   就是**不强制依赖默认路径**」——此前：Android SDK 只看 `ANDROID_HOME` 或 `~/Library/Android/sdk`；
//   JDK 只看 `JAVA_HOME`/框架 `.tools/jdk17`；DevEco 硬编码了**框架机专属路径**
//   `/Volumes/data1/work/office-applications/DevEco-Studio.app/Contents`。⇒ 用户装在别处就"找不到"。
//   本模块把三端工具链都做成**全盘枚举 + 能力判据**（与 `host-package.findAllXcodes` 同源范式）：
//     ① 显式 env（用户表态最高优先）② PATH ③ 常见安装位 ④ **Spotlight mdfind** ⑤ **有界 glob**
//     （`/Applications`、`/Volumes/*/`、`/Volumes/*/*/`、`~/Applications` …）—— Spotlight 关掉时兜底。
//
// 【能力判据（不是"路径存在"）】每个候选都**实测它真能干活**：
//   · Android SDK：有 `platforms/` + `build-tools/`
//   · JDK：有 `bin/javac`
//   · DevEco：有 `tools/hvigor/bin/hvigorw`
//   · hdc：可执行且来自 DevEco 的 SDK toolchains
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function run(cmd: string, args: string[]): string {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    // ★合并 stdout + stderr（`java -version` 只写 stderr；只看 stdout 会得空串——实测踩到）
    return `${r.stdout ?? ''}${r.stderr ?? ''}`
  } catch {
    return ''
  }
}

/** 有界 glob（`ls -d <pat> 2>/dev/null`；只匹配固定层数，不递归全盘） */
function globDirs(patterns: string[]): string[] {
  const out: string[] = []
  for (const pat of patterns) {
    const s = run('sh', ['-c', `ls -d ${pat} 2>/dev/null`])
    for (const p of s.split('\n')) if (p.trim()) out.push(p.trim())
  }
  return out
}

/**
 * ★有界 `find`（跨任意深度层数找 `.app`——`ls` glob 的层数写死，实测漏了 `/Volumes/<a>/<b>/<c>/X.app`）。
 *   限制 `-maxdepth`（不递归全盘）+ `-type d`；用于 Xcode / DevEco / Android Studio 这类 `.app` 扫描。
 *   ★**按 appName 记忆化**（一次 doctor 进程内 FS 不变——不 cache 会重复扫 /Volumes，实测 9s→目标 ~1s）。
 */
const findAppsCache = new Map<string, string[]>()
export function findApps(appName: string): string[] {
  const hit = findAppsCache.get(appName)
  if (hit) return hit
  const roots = ['/Applications', '/Volumes', path.join(os.homedir(), 'Applications')]
  const out: string[] = []
  for (const root of roots) {
    if (!isDir(root)) continue
    const s = run('find', [root, '-maxdepth', '4', '-type', 'd', '-name', appName])
    for (const p of s.split('\n')) if (p.trim()) out.push(p.trim())
  }
  findAppsCache.set(appName, out)
  return out
}

/** Spotlight 查某 bundle id 的 .app（关掉时返回空，由 glob 兜底） */
function mdfindApps(bundleId: string): string[] {
  return run('mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`]).split('\n').map((s) => s.trim()).filter(Boolean)
}

/** 该目录是真目录（非符号链断） */
function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/* ============================================================
 * Android SDK
 * ============================================================ */

export interface AndroidSdkCandidate {
  sdk: string
  hasPlatforms: boolean
  hasBuildTools: boolean
  /** 最新 build-tools 目录（有则用它调 aapt2/d8/apksigner） */
  buildToolsDir: string | null
  /** 平台 android.jar（取版本号最大的） */
  androidJar: string | null
}

/** 枚举本机所有 Android SDK（能力判据 = 有 platforms/ + build-tools/） */
let androidSdksCache: AndroidSdkCandidate[] | null = null
export function findAllAndroidSdks(): AndroidSdkCandidate[] {
  if (androidSdksCache) return androidSdksCache
  androidSdksCache = computeAllAndroidSdks()
  return androidSdksCache
}
function computeAllAndroidSdks(): AndroidSdkCandidate[] {
  const roots = new Set<string>()
  const push = (p?: string | null): void => { if (p && p.trim()) roots.add(path.resolve(p.trim())) }
  push(process.env.ANDROID_HOME)
  push(process.env.ANDROID_SDK_ROOT)
  push(path.join(os.homedir(), 'Library/Android/sdk'))     // macOS 默认（Android Studio）
  push(path.join(os.homedir(), 'Android/Sdk'))             // Linux 默认
  push('/usr/local/share/android-sdk')                     // Homebrew（Intel）
  push('/opt/homebrew/share/android-sdk')                  // Homebrew（Apple Silicon）
  // Homebrew 前缀（brew --prefix 可能非默认位）
  const brewPrefix = run('brew', ['--prefix']).trim()
  if (brewPrefix) push(path.join(brewPrefix, 'share/android-sdk'))
  // Spotlight + glob 兜底（Android Studio 的 SDK 一般在 ~/Library，但用户也可能放别处）
  //   ★SDK 目录特征是含 `platforms` 子目录——直接对候选位判定，不再全盘扫（SDK 很大，扫盘不值当）
  return [...roots].filter(isDir).map((sdk) => {
    const platformsDir = path.join(sdk, 'platforms')
    const buildToolsRoot = path.join(sdk, 'build-tools')
    const btVersions = isDir(buildToolsRoot) ? fs.readdirSync(buildToolsRoot).filter((d) => !d.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []
    const plVersions = isDir(platformsDir) ? fs.readdirSync(platformsDir).filter((d) => d.startsWith('android-')).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8))) : []
    return {
      sdk,
      hasPlatforms: plVersions.length > 0,
      hasBuildTools: btVersions.length > 0,
      buildToolsDir: btVersions.length ? path.join(buildToolsRoot, btVersions[btVersions.length - 1]) : null,
      androidJar: plVersions.length ? path.join(platformsDir, plVersions[plVersions.length - 1], 'android.jar') : null,
    }
  })
}

/** 解析可用 Android SDK（优先"同时有 platforms + build-tools"的） */
export function resolveAndroidSdk(): AndroidSdkCandidate | null {
  const all = findAllAndroidSdks()
  return all.find((c) => c.hasPlatforms && c.hasBuildTools) ?? all.find((c) => c.hasPlatforms) ?? all[0] ?? null
}

/* ============================================================
 * JDK（Android 打包需 JDK 17；d8/apksigner 是 Java 启动脚本）
 * ============================================================ */

export interface JdkCandidate {
  home: string
  /** bin/javac 存在 */
  hasJavac: boolean
  /** 主版本（17 = 目标；null = 未知） */
  major: number | null
  /** 来源标注（人读，如 "Android Studio jbr" / "DevEco jbr" / "framework .tools"） */
  source: string
}

function jdkMajor(home: string): number | null {
  // ★优先读 release 文件（JAVA_VERSION=\"17.0.10\"）——纯文件读、零 JVM 启动。
  //   实测：对每个候选 spawn java -version（~150ms × 11 个 JDK）会把 doctor 拖到 ~3s。
  try {
    const rel = fs.readFileSync(path.join(home, 'release'), 'utf-8')
    const m = rel.match(/JAVA_VERSION="(?:1\.)?(\d+)/)
    if (m) return Number(m[1])
  } catch { /* 无 release 文件 ⇒ 下方 spawn 兜底 */ }
  const out = run(path.join(home, 'bin/java'), ['-version'])
  const m = out.match(/version "(?:1\.)?(\d+)/)
  return m ? Number(m[1]) : null
}

/** 枚举本机所有 JDK（能力判据 = 有 bin/javac） */
const jdksCache = new Map<string, JdkCandidate[]>()
export function findAllJdks(devecoContents?: string | null): JdkCandidate[] {
  const key = devecoContents ?? ''
  const cached = jdksCache.get(key)
  if (cached) return cached
  const result = computeAllJdks(devecoContents)
  jdksCache.set(key, result)
  return result
}
function computeAllJdks(devecoContents?: string | null): JdkCandidate[] {
  const cands: Array<{ home: string; source: string }> = []
  const add = (home: string | undefined | null, source: string): void => { if (home && home.trim()) cands.push({ home: path.resolve(home.trim()), source }) }
  add(process.env.JAVA_HOME, 'JAVA_HOME')
  // 系统 JDK（macOS：/Library/Java/JavaVirtualMachines/<vendor>/Contents/Home）
  for (const d of globDirs(['/Library/Java/JavaVirtualMachines/*/Contents/Home'])) add(d, 'system JVM')
  // Homebrew
  const brewPrefix = run('brew', ['--prefix']).trim()
  for (const d of globDirs([`${brewPrefix || '/opt/homebrew'}/opt/openjdk*/libexec/openjdk.jdk/Contents/Home`])) add(d, 'Homebrew')
  // sdkman / jenv
  for (const d of globDirs([path.join(os.homedir(), '.sdkman/candidates/java/*/')])) add(d, 'sdkman')
  // IDE 自带 JBR（Android Studio / DevEco）——用户常"IDE 能构建但 CLI 找不到 javac"
  for (const app of findApps('Android Studio*.app')) add(path.join(app, 'Contents/jbr/Contents/Home'), 'Android Studio jbr')
  if (devecoContents) add(path.join(devecoContents, 'jbr/Contents/Home'), 'DevEco jbr')
  // 框架仓 .tools（仓内工程用；★框架专属，仅作最后兜底）
  add(path.join(process.cwd(), '.tools/jdk17'), 'framework .tools')
  add(path.join(process.cwd(), '.tools/jdk-17.0.20.1+1/Contents/Home'), 'framework .tools')
  // 去重
  const seen = new Set<string>()
  const out: JdkCandidate[] = []
  for (const c of cands) {
    if (seen.has(c.home)) continue
    seen.add(c.home)
    const hasJavac = fs.existsSync(path.join(c.home, 'bin/javac'))
    out.push({ home: c.home, hasJavac, major: hasJavac ? jdkMajor(c.home) : null, source: c.source })
  }
  return out
}

/** 解析可用 JDK 17（优先 major==17；退而求其次 ANY 有 javac 的——Android 只要 javac 在即可跑） */
export function resolveJdk17(devecoContents?: string | null): JdkCandidate | null {
  const all = findAllJdks(devecoContents).filter((c) => c.hasJavac)
  return all.find((c) => c.major === 17) ?? all.find((c) => c.major != null) ?? all[0] ?? null
}

/* ============================================================
 * DevEco Studio（HarmonyOS 构建）
 * ============================================================ */

export interface DevEcoCandidate {
  /** `DevEco-Studio.app/Contents`（hvigorw/node/sdk/jbr 都在其下） */
  contents: string
  app: string
  /** tools/hvigor/bin/hvigorw 存在 */
  hasHvigor: boolean
}

/** 枚举本机所有 DevEco Studio（能力判据 = 有 tools/hvigor/bin/hvigorw） */
let devEcosCache: DevEcoCandidate[] | null = null
export function findAllDevEcos(): DevEcoCandidate[] {
  if (devEcosCache) return devEcosCache
  devEcosCache = computeAllDevEcos()
  return devEcosCache
}
function computeAllDevEcos(): DevEcoCandidate[] {
  const roots = new Set<string>()
  const push = (p?: string | null): void => { if (p && p.trim()) roots.add(path.resolve(p.trim())) }
  push(process.env.PROTEUS_DEVECO)
  // ★有界 find（任意层数）+ mdfind（.app 外层 → 拼 Contents）
  for (const app of findApps('DevEco-Studio*.app')) push(path.join(app, 'Contents'))
  for (const app of mdfindApps('com.huawei.deveco.studio')) push(path.join(app, 'Contents'))
  return [...roots].filter(isDir).map((contents) => ({
    contents,
    app: contents.replace(/\/Contents\/?$/, ''),
    hasHvigor: fs.existsSync(path.join(contents, 'tools/hvigor/bin/hvigorw')),
  }))
}

export function resolveDevEco(): DevEcoCandidate | null {
  const all = findAllDevEcos()
  return all.find((c) => c.hasHvigor) ?? all[0] ?? null
}

/* ============================================================
 * hdc（HarmonyOS 设备工具）——★修正旧建议的错误路径
 * ============================================================ */

/**
 * 找 hdc：① PATH ② DevEco 自带（**真实路径** = `<DEVECO>/sdk/<ver>/openharmony/toolchains/hdc`，
 * 或 `<DEVECO>/sdk/default/openharmony/toolchains/hdc`）③ `$DEVECO_SDK_HOME`。
 * ★旧 doctor 建议写的 `$DEVECO_SDK_HOME/../hdc` 是**错的**（实测 hdc 在 sdk 的 toolchains 下）。
 */
const hdcCache = new Map<string, { hdc: string; source: string } | null>()
export function findHdc(devecoContents?: string | null): { hdc: string; source: string } | null {
  const key = devecoContents ?? ''
  if (hdcCache.has(key)) return hdcCache.get(key)!
  const r = computeFindHdc(devecoContents)
  hdcCache.set(key, r)
  return r
}
function computeFindHdc(devecoContents?: string | null): { hdc: string; source: string } | null {
  // ① PATH
  const onPath = run('sh', ['-c', 'command -v hdc 2>/dev/null']).trim()
  if (onPath) return { hdc: onPath, source: 'PATH' }
  // ② DevEco 自带（SDK toolchains 下，版本目录可能是 default 或数字）
  const roots: string[] = []
  if (devecoContents) roots.push(path.join(devecoContents, 'sdk'))
  const sdkHome = process.env.DEVECO_SDK_HOME
  if (sdkHome) roots.push(path.join(sdkHome, 'default'), sdkHome, path.resolve(sdkHome, '..'))
  for (const root of roots) {
    for (const p of globDirs([path.join(root, '*/openharmony/toolchains/hdc'), path.join(root, 'openharmony/toolchains/hdc'), path.join(root, 'hdc')])) {
      if (fs.existsSync(p)) return { hdc: p, source: `DevEco SDK（${path.relative(root, p)}）` }
    }
  }
  return null
}
