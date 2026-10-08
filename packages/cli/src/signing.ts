// packages/cli/src/signing.ts —— ★★★签名工具（独立于框架源码，随 CLI 包分发）· 决策 #688
//
// 【为什么有它（用户原话）】「项目里面执行诊断给的修复是项目不存在的方式（`bash hosts/ios/signing.sh …`），
//   应该把签名生成调试工具脚本也同步到 cli 里面……cli 输出的所有建议应该是**解耦框架源码单独可用**的才行」。
//   ——`hosts/` 是**框架源码**，真实用户（自己的工程 + `npx proteus`）**没有**它 ⇒ 那些建议对用户是死链。
//   本模块把签名能力做成 **CLI 的一部分**（随包发布），任何建议都指 `proteus host signing …`。
//
// 【与框架 `hosts/ios/lib/ios-signing.mjs` 的关系】那个是本仓**两台电脑切换**用的（含 pin 文件按主机名分档、
//   框架固定 bundle、`resolve --shell` 给构建脚本 eval）——**框架特有**。本模块只取它的**可移植核心**：
//   ★唯一重要判据 = **从描述文件反查证书**（描述文件 `DeveloperCertificates` ∩ 钥匙串有效身份）——
//   这是唯一同时躲开「同名两张证书」与「团队选错」的判据（按名字选必错其一）。
//
// 【诚实边界】iOS 证书/描述文件由 **Apple（Xcode 或开发者中心）签发**——本工具只做**发现与选择**，
//   不生成证书（Android 的 debug keystore 是本地自签，故那部分本工具**可生成**）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

/** 描述文件目录（Xcode 现行位置 + 旧版遗留位置） */
export const IOS_PROFILE_DIRS = [
  path.join(os.homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles'),
  path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles'),
]

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return { ok: r.status === 0, out: (r.stdout ?? '').toString() }
  } catch {
    return { ok: false, out: '' }
  }
}

/** openssl 的 `notBefore=Sep 28 01:17:01 2026 GMT` → Date（手写解析，避免 Date.parse 实现差异） */
export function parseOpenSslDate(s: string): Date | null {
  const m = s.match(/^([A-Z][a-z]{2})\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/)
  if (!m) return null
  return new Date(Date.UTC(Number(m[6]), MONTHS[m[1] as keyof typeof MONTHS], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])))
}

export interface IosIdentity {
  sha1: string
  name: string
  account: string
  team: string
  notBefore: Date | null
  notAfter: Date | null
}

export interface IosProfile {
  file: string
  name: string
  uuid: string
  appId: string
  team: string
  bundleId: string
  expiry: Date | null
  certSha1s: string[]
  devices: number
  error?: string
}

function certMeta(pem: string, tmpDir: string): { cn: string; account: string; team: string; notBefore: Date | null; notAfter: Date | null } {
  const f = path.join(tmpDir, `${createHash('sha1').update(pem).digest('hex')}.pem`)
  fs.writeFileSync(f, pem)
  const s = run('openssl', ['x509', '-in', f, '-noout', '-subject', '-dates']).out
  const cn = ((s.match(/CN=([\s\S]*?)(?=,\s*(?:OU|O|C|UID|emailAddress)=)/) || [])[1] || '').trim()
  const team = ((s.match(/,?\s*OU=([^,\n]+)/) || [])[1] || '').trim()
  return {
    cn,
    account: cn.replace(/^Apple Development:\s*/, '').replace(/\s*\([A-Z0-9]+\)\s*$/, ''),
    team,
    notBefore: parseOpenSslDate((s.match(/notBefore=([^\n]+)/) || [])[1] || ''),
    notAfter: parseOpenSslDate((s.match(/notAfter=([^\n]+)/) || [])[1] || ''),
  }
}

/** 钥匙串**有效**签名身份（`find-identity -v` 口径 = 证书有效且配对私钥在），含账号/团队/有效期 */
export function collectIosIdentities(): IosIdentity[] {
  const valid = new Map<string, string>()
  const r = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  for (const m of r.out.matchAll(/^\s*\d+\) ([0-9A-Fa-f]{40}) "([^"]+)"/gm)) valid.set(m[1].toUpperCase(), m[2])
  if (!valid.size) return []
  const dump = run('security', ['find-certificate', '-a', '-c', 'Apple Development', '-Z', '-p'])
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-sign-'))
  const out: IosIdentity[] = []
  try {
    const re = /SHA-1 hash: ([0-9A-Fa-f]{40})\s*\n(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g
    for (const m of dump.out.matchAll(re)) {
      const sha1 = m[1].toUpperCase()
      const name = valid.get(sha1)
      if (!name) continue
      out.push({ sha1, name, ...certMeta(m[2], tmpDir) })
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
  return out
}

/** 本机描述文件清单（含过期项；解析失败带 error，不静默跳过） */
export function collectIosProfiles(): IosProfile[] {
  const out: IosProfile[] = []
  for (const dir of IOS_PROFILE_DIRS) {
    let names: string[] = []
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.mobileprovision')).sort()
    } catch {
      continue
    }
    for (const n of names) {
      const file = path.join(dir, n)
      const r = run('security', ['cms', '-D', '-i', file])
      if (!r.ok) {
        out.push({ file, name: n, uuid: '', appId: '', team: '', bundleId: '', expiry: null, certSha1s: [], devices: 0, error: 'security cms -D 解析失败（文件损坏？）' })
        continue
      }
      const xml = r.out
      const str = (key: string): string => (xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)) || [])[1] || ''
      const appId = str('application-identifier')
      const team = (xml.match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([^<]+)<\/string>/) || [])[1] || appId.split('.')[0] || ''
      const expiryRaw = (xml.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/) || [])[1] || ''
      const certsBlock = (xml.match(/<key>DeveloperCertificates<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || ''
      const certSha1s = [...certsBlock.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/g)].map((m) =>
        createHash('sha1').update(Buffer.from(m[1].replace(/\s+/g, ''), 'base64')).digest('hex').toUpperCase(),
      )
      const devicesBlock = (xml.match(/<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || ''
      out.push({
        file,
        name: str('Name'),
        uuid: str('UUID'),
        appId,
        team,
        bundleId: team && appId.startsWith(team + '.') ? appId.slice(team.length + 1) : appId,
        expiry: expiryRaw ? new Date(expiryRaw) : null,
        certSha1s,
        devices: (devicesBlock.match(/<string>/g) || []).length,
      })
    }
  }
  return out
}

export interface IosSigningResolution {
  /** 是否找到可用的签名组合 */
  ok: boolean
  bundleId: string
  profile?: IosProfile
  identity?: IosIdentity
  /** 已知问题（不静默） */
  warnings: string[]
  /** 可行动下一步（解耦框架——全是 CLI/系统级命令或 GUI 指引） */
  nextSteps: string[]
}

/**
 * ★解析某 bundleId 的签名（可移植核心）。找**覆盖该 bundleId 且未过期**的描述文件，
 *   再从描述文件授权的证书里选一张**在本机钥匙串**的（★从描述文件反查证书——唯一正确判据）。
 */
export function resolveIosSigning(bundleId: string, now = Date.now()): IosSigningResolution {
  const profiles = collectIosProfiles().filter((p) => !p.error)
  const identities = collectIosIdentities()
  const warnings: string[] = []
  const nextSteps: string[] = []

  const validProfiles = profiles.filter((p) => p.expiry && p.expiry.getTime() > now)
  const match = validProfiles.filter((p) => p.bundleId === bundleId)
  if (!match.length) {
    const expired = profiles.filter((p) => p.expiry && p.expiry.getTime() <= now && p.bundleId === bundleId)
    if (expired.length) warnings.push(`找到 ${expired.length} 个覆盖 ${bundleId} 的描述文件但**均已过期**`)
    // ★决策 #690：描述文件由 **Apple** 签发——CLI 生成的 iOS 宿主是 **swiftc 直编（无 .xcodeproj）**，
    //   所以"在 Xcode 打开你的工程"对 CLI 宿主**不适用**。给出**真能照做**的两条路径（都不依赖打包：
    //   `proteus create host ios` 就能生成宿主，无需先打包）。
    nextSteps.push(
      `给该 bundleId（${bundleId}）建一个 Apple 开发描述文件（二选一）：`,
      `  ① 用 Xcode（需登录 Apple ID）：File → New → Project → iOS App，Bundle Identifier 填 ${bundleId}，` +
        `勾 “Automatically manage signing” 选好 Team —— Xcode 会自动为该 App ID 建描述文件（此工程仅为生成描述文件，可弃）`,
      `  ② 或复用已有描述文件：proteus host signing ios --list 看本机哪个 bundleId 有描述文件，` +
        `把项目的 proteus.config native.ios.bundleId 改成它`,
      `生成后验证：proteus host signing ios --bundle=${bundleId}`,
    )
    return { ok: false, bundleId, warnings, nextSteps }
  }
  const profile = match[0]
  const embedded = profile.certSha1s.filter((s) => identities.some((i) => i.sha1 === s))
  if (!embedded.length) {
    warnings.push('描述文件授权的证书**不在本机钥匙串**（在另一台机器签发？）')
    nextSteps.push(
      '本机导入该证书的私钥（.p12：双击 → 钥匙串），或用本机 Apple ID 在 Xcode 重新生成描述文件（见上条路径①）',
    )
    return { ok: false, bundleId, profile, warnings, nextSteps }
  }
  // 从交集里取**最新签发**的一张（续签场景 = 最新的那张）
  const identity = embedded
    .map((s) => identities.find((i) => i.sha1 === s)!)
    .sort((a, b) => (b.notBefore?.getTime() || 0) - (a.notBefore?.getTime() || 0))[0]
  return { ok: true, bundleId, profile, identity, warnings, nextSteps }
}

/* ============================================================
 * Android 签名（debug keystore —— 本地自签，本工具**可生成**）
 * ============================================================ */

export interface AndroidSigningStatus {
  appSigning: boolean
  identityFor: 'debug'
  /** debug.keystore 路径（CLI 打包时生成于此） */
  keystore: string
  keystoreExists: boolean
  /** 工具链就绪（keytool + apksigner） */
  keytoolOk: boolean
  apksignerOk: boolean
  messages: string[]
  nextSteps: string[]
}

/** Android 打包用**自动生成的 debug keystore**（`androiddebugkey`）——无外部依赖，签名失败通常是 JDK/SDK 缺件。 */
export function androidSigningStatus(opts: { jdkDir?: string | null; buildToolsDir?: string | null; keystore: string }): AndroidSigningStatus {
  const messages: string[] = []
  const nextSteps: string[] = []
  const keytool = opts.jdkDir ? path.join(opts.jdkDir, 'bin', 'keytool') : 'keytool'
  const apksigner = opts.buildToolsDir ? path.join(opts.buildToolsDir, 'apksigner') : 'apksigner'
  // ★判据用**文件存在**（零 JVM 启动）——此前 spawn `keytool -help`（JVM 启动 ~500ms）把 doctor 拖慢。
  //   给定了 jdkDir / buildToolsDir 时看文件；否则看 PATH（sh -c 'command -v'）。
  const onPath = (name: string): boolean => {
    try {
      return spawnSync('sh', ['-c', `command -v ${name} 2>/dev/null`], { encoding: 'utf8' }).status === 0
    } catch { return false }
  }
  const keytoolOk = opts.jdkDir ? fs.existsSync(keytool) : onPath('keytool')
  const apksignerOk = fs.existsSync(apksigner) || onPath('apksigner')
  const keystoreExists = fs.existsSync(opts.keystore)
  if (!keytoolOk) {
    messages.push('keytool 不可用（Android debug 签名需 JDK 17）')
    nextSteps.push('安装 JDK 17（macOS: brew install openjdk@17；或设 JAVA_HOME 指向 JDK 17）')
  }
  if (!apksignerOk) {
    messages.push('apksigner 不可用（属 Android SDK build-tools）')
    nextSteps.push('安装 Android SDK build-tools（ANDROID_HOME/build-tools/<版本>/apksigner）')
  }
  if (keytoolOk && !keystoreExists) {
    nextSteps.push(`生成 debug keystore：proteus host signing android --generate（写到 ${opts.keystore}；打包时也会自动生成）`)
  }
  return { appSigning: false, identityFor: 'debug', keystore: opts.keystore, keystoreExists, keytoolOk, apksignerOk, messages, nextSteps }
}

/** 生成 Android debug keystore（若不存在；幂等）。返回是否可用。 */
export function ensureAndroidDebugKeystore(opts: { jdkDir?: string | null; keystore: string }): { ok: boolean; created: boolean; error?: string } {
  const keytool = opts.jdkDir ? path.join(opts.jdkDir, 'bin', 'keytool') : 'keytool'
  if (fs.existsSync(opts.keystore)) return { ok: true, created: false }
  try {
    fs.mkdirSync(path.dirname(opts.keystore), { recursive: true })
  } catch { /* 目录已存在 */ }
  const r = spawnSync(
    keytool,
    ['-genkeypair', '-keystore', opts.keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=Android,C=US', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000'],
    { encoding: 'utf8' },
  )
  if (r.status === 0 && fs.existsSync(opts.keystore)) return { ok: true, created: true }
  return { ok: false, created: false, error: (r.stderr ?? '').toString().trim().slice(-300) || `keytool 退出码 ${r.status}` }
}
