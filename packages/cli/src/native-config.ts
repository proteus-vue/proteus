// packages/cli/src/native-config.ts —— ★★★原生项目配置解析 + 应用（决策 #635）
//
// 【它解决什么（用户 2026-10-08）】「app.config 没有完整的平台项目配置……无法把项目的这些传递到构建链」。
//   此前**原生项目身份**（包名/Bundle ID/版本/SDK/方向/权限/图标）**硬编码**在宿主工程文件里
//   （AndroidManifest.xml / Info.plist / AppScope/app.json5 / entry/module.json5），项目侧只能手改宿主；
//   `proteus build --target <端> --package` 也从不注入这些值。
//   ⇒ 本模块把 `proteus.config.ts` 的 **`native` 段**解析成规范值，并**渲染进**宿主工程的原生文件。
//
// 【职责边界（G-35.1 · 决策 #635）】native = **构建期**（CLI 消费，写原生工程文件）；
//   app.config 的 `app.name/version/buildNumber` = **运行时**（业务读取/上报）。二者可互为镜像：
//   本模块在 native 段缺值时**回退读取 app.config 的 app.***（减少重复声明），但不改职责边界。
//
// 【设计原则】
//   · **纯函数解析**（resolveNativeConfig）——可单测、无副作用；
//   · **字段级补丁**（applyNativeConfig）——只改身份字段，**保留**工程其余内容（手改过的布局/权限不受影响）；
//   · **幂等**（重复 apply 结果一致）；
//   · **不静默**——每个应用/跳过的字段都进返回报告。
import fs from 'node:fs'
import path from 'node:path'
import type { AppIdentityConfig, AndroidTargetConfig, IosTargetConfig, HarmonyTargetConfig } from '@proteus-vue/types'
import type { AppPlatform } from './targets'

/** 原生工程身份的各端小节（v4：targets.<端> 平铺 + 共享 app；此处聚合供解析） */
export interface NativeSections {
  app?: AppIdentityConfig
  android?: AndroidTargetConfig
  ios?: IosTargetConfig
  harmony?: HarmonyTargetConfig
}

/** 运行时配置里本模块要回退读取的最小子集（app.config 的 app.*） */
export interface NativeAppFallback {
  name?: string
  version?: string
  buildNumber?: string | number
}

/** 解析后的共享应用身份 */
export interface ResolvedNativeApp {
  name: string
  version: string
  buildNumber: string
}

export interface ResolvedAndroidNative {
  applicationId?: string
  label: string
  versionName: string
  versionCode: number
  minSdk: number
  targetSdk: number
  orientation: 'portrait' | 'landscape' | 'unspecified'
  permissions: string[]
  icon?: string
  launchPage?: string
  theme?: string
  allowBackup?: boolean
  largeHeap?: boolean
  hardwareAccelerated?: boolean
  supportsRtl?: boolean
  usesCleartextTraffic?: boolean
  networkSecurityConfig?: string
  appCategory?: string
}

export interface ResolvedIosNative {
  bundleId?: string
  displayName: string
  version: string
  buildNumber: string
  minimumOSVersion: string
  deviceFamily: number[]
  orientations: Array<'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'>
  launchPage?: string
  userInterfaceStyle?: 'light' | 'dark' | 'automatic'
  statusBarStyle?: string
  statusBarHidden?: boolean
  urlSchemes?: string[]
  privacyUsageDescriptions?: Record<string, string>
  appCategory?: string
  requiresFullScreen?: boolean
  developmentRegion?: string
}

export interface ResolvedHarmonyNative {
  bundleName?: string
  label: string
  vendor: string
  versionName: string
  versionCode: number
  compatibleSdkVersion: string
  targetSdkVersion: string
  deviceTypes: string[]
  permissions: string[]
  icon?: string
  appCategory?: string
  orientation?: string
}

export interface ResolvedNativeConfig {
  app: ResolvedNativeApp
  android: ResolvedAndroidNative
  ios: ResolvedIosNative
  harmony: ResolvedHarmonyNative
  /**
   * ★每字段「是否**被声明**」——apply 只写**声明过**的字段，**不用内置默认去覆盖手改值**。
   *   声明来源 = native.X.field 显式 / native.app.* 共享身份 / app.config 回退。
   *   内置默认（minSdk 24 等）只在 create host 的**模板初值**里出现，不参与 re-apply 覆盖。
   */
  declared: {
    android: Record<keyof ResolvedAndroidNative, boolean>
    ios: Record<keyof ResolvedIosNative, boolean>
    harmony: Record<keyof ResolvedHarmonyNative, boolean>
  }
}

/** 应用/跳过的字段（报告用——不静默） */
export interface NativeApplyChange {
  file: string
  field: string
  from?: string
  to: string
}
export interface NativeApplyReport {
  ok: boolean
  changes: NativeApplyChange[]
  skipped: string[]
  notes: string[]
}

const DEFAULT_VERSION = '0.1.0'
const DEFAULT_BUILD = '1'

/** 解析原生身份为规范值（各端小节缺值 → 回退 app.config 的 app.*；再缺 → 内置默认） */
export function resolveNativeConfig(native: NativeSections | undefined, fallback?: NativeAppFallback): ResolvedNativeConfig {
  const n = native ?? {}
  const name = n.app?.name ?? fallback?.name ?? 'Proteus App'
  const version = n.app?.version ?? fallback?.version ?? DEFAULT_VERSION
  const buildNumber = String(n.app?.buildNumber ?? fallback?.buildNumber ?? DEFAULT_BUILD)
  const a = n.android ?? {}
  const i = n.ios ?? {}
  const h = n.harmony ?? {}
  // ★共享身份是否「被声明」（native.app 或 app.config 回退给出）——决定 label/version 是否应用
  const declaredName = n.app?.name != null || fallback?.name != null
  const declaredVersion = n.app?.version != null || fallback?.version != null
  const declaredBuild = n.app?.buildNumber != null || fallback?.buildNumber != null
  const android: ResolvedAndroidNative = {
    applicationId: a.applicationId,
    label: a.label ?? name,
    versionName: a.versionName ?? version,
    versionCode: a.versionCode ?? (Number.isFinite(Number(buildNumber)) ? Number(buildNumber) : 1),
    minSdk: a.minSdk ?? 24,
    targetSdk: a.targetSdk ?? 34,
    orientation: a.orientation ?? 'unspecified',
    permissions: a.permissions ?? [],
    icon: a.icon,
    launchPage: a.launchPage,
    theme: a.theme,
    allowBackup: a.allowBackup,
    largeHeap: a.largeHeap,
    hardwareAccelerated: a.hardwareAccelerated,
    supportsRtl: a.supportsRtl,
    usesCleartextTraffic: a.usesCleartextTraffic,
    networkSecurityConfig: a.networkSecurityConfig,
    appCategory: a.appCategory,
  }
  const ios: ResolvedIosNative = {
    bundleId: i.bundleId,
    displayName: i.displayName ?? name,
    version: i.version ?? version,
    buildNumber: i.buildNumber ?? buildNumber,
    minimumOSVersion: i.minimumOSVersion ?? '15.0',
    deviceFamily: i.deviceFamily ?? [1],
    orientations: i.orientations ?? ['portrait'],
    launchPage: i.launchPage,
    userInterfaceStyle: i.userInterfaceStyle,
    statusBarStyle: i.statusBarStyle,
    statusBarHidden: i.statusBarHidden,
    urlSchemes: i.urlSchemes,
    privacyUsageDescriptions: i.privacyUsageDescriptions,
    appCategory: i.appCategory,
    requiresFullScreen: i.requiresFullScreen,
    developmentRegion: i.developmentRegion,
  }
  const harmony: ResolvedHarmonyNative = {
    bundleName: h.bundleName,
    label: h.label ?? name,
    vendor: h.vendor ?? 'proteus',
    versionName: h.versionName ?? version,
    versionCode: h.versionCode ?? (Number.isFinite(Number(buildNumber)) ? Number(buildNumber) : 1),
    compatibleSdkVersion: h.compatibleSdkVersion ?? '5.0.5(17)',
    targetSdkVersion: h.targetSdkVersion ?? h.compatibleSdkVersion ?? '5.0.5(17)',
    deviceTypes: h.deviceTypes ?? ['phone', 'tablet', '2in1'],
    permissions: h.permissions ?? [],
    icon: h.icon,
    appCategory: h.appCategory,
    orientation: h.orientation,
  }
  return {
    app: { name, version, buildNumber },
    android,
    ios,
    harmony,
    declared: {
      android: {
        applicationId: a.applicationId != null,
        label: a.label != null || declaredName,
        versionName: a.versionName != null || declaredVersion,
        versionCode: a.versionCode != null || declaredBuild,
        minSdk: a.minSdk != null,
        targetSdk: a.targetSdk != null,
        orientation: a.orientation != null,
        permissions: a.permissions != null,
        icon: a.icon != null,
        launchPage: a.launchPage != null,
        theme: a.theme != null,
        allowBackup: a.allowBackup != null,
        largeHeap: a.largeHeap != null,
        hardwareAccelerated: a.hardwareAccelerated != null,
        supportsRtl: a.supportsRtl != null,
        usesCleartextTraffic: a.usesCleartextTraffic != null,
        networkSecurityConfig: a.networkSecurityConfig != null,
        appCategory: a.appCategory != null,
      },
      ios: {
        bundleId: i.bundleId != null,
        displayName: i.displayName != null || declaredName,
        version: i.version != null || declaredVersion,
        buildNumber: i.buildNumber != null || declaredBuild,
        minimumOSVersion: i.minimumOSVersion != null,
        deviceFamily: i.deviceFamily != null,
        orientations: i.orientations != null,
        launchPage: i.launchPage != null,
        userInterfaceStyle: i.userInterfaceStyle != null,
        statusBarStyle: i.statusBarStyle != null,
        statusBarHidden: i.statusBarHidden != null,
        urlSchemes: i.urlSchemes != null,
        privacyUsageDescriptions: i.privacyUsageDescriptions != null,
        appCategory: i.appCategory != null,
        requiresFullScreen: i.requiresFullScreen != null,
        developmentRegion: i.developmentRegion != null,
      },
      harmony: {
        bundleName: h.bundleName != null,
        label: h.label != null || declaredName,
        vendor: h.vendor != null,
        versionName: h.versionName != null || declaredVersion,
        versionCode: h.versionCode != null || declaredBuild,
        compatibleSdkVersion: h.compatibleSdkVersion != null,
        targetSdkVersion: h.targetSdkVersion != null,
        deviceTypes: h.deviceTypes != null,
        permissions: h.permissions != null,
        icon: h.icon != null,
        appCategory: h.appCategory != null,
        orientation: h.orientation != null,
      },
    },
  }
}

/* ================= 字段级补丁（XML / plist / json5） ================= */

/** 替换 `key="..."` 属性的值（返回 [新文本, 是否命中]，未命中即原样） */
function setAttr(src: string, key: string, value: string): [string, boolean] {
  const re = new RegExp(`(${key}\\s*=\\s*)"[^"]*"`)
  if (re.test(src)) return [src.replace(re, `$1"${value}"`), true]
  return [src, false]
}

/** 在首个 `<tag ...>` 元素上设置属性：存在则改值，不存在则在 `>` 前补 `key="value"`（返回 [新文本, 是否命中]） */
function setOrAddAttrInTag(src: string, tag: string, key: string, value: string): [string, boolean] {
  const elRe = new RegExp(`<${tag}\\b[^>]*?/?>`)
  const m = elRe.exec(src)
  if (!m) return [src, false]
  const el = m[0]
  const attrRe = new RegExp(`(${key}\\s*=\\s*)"[^"]*"`)
  let newEl: string
  if (attrRe.test(el)) {
    newEl = el.replace(attrRe, `$1"${value}"`)
  } else {
    // 在 `>`（或 `/>`）之前插入属性
    newEl = el.replace(/\s*(\/?>)$/, ` ${key}="${value}"$1`)
  }
  return [src.slice(0, m.index) + newEl + src.slice(m.index + el.length), true]
}

/** 替换 plist 的 `<key>K</key><string>V</string>`；存在则改值，不存在则不动（返回是否命中） */
function setPlistString(src: string, key: string, value: string): [string, boolean] {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`)
  if (re.test(src)) return [src.replace(re, `$1${value}$2`), true]
  return [src, false]
}

/** plist 字符串：存在则改，不存在则在末尾 `</dict>` 前插入（返回是否命中——总是命中，因为总有 </dict>） */
function setPlistStringOrAdd(src: string, key: string, value: string): [string, boolean] {
  const [s, hit] = setPlistString(src, key, value)
  if (hit) return [s, true]
  const idx = src.lastIndexOf('</dict>')
  if (idx < 0) return [src, false]
  const ins = `  <key>${key}</key><string>${value}</string>\n`
  return [src.slice(0, idx) + ins + src.slice(idx), true]
}

/** plist 布尔：存在则改，不存在则插入（返回是否命中） */
function setPlistBoolOrAdd(src: string, key: string, value: boolean): [string, boolean] {
  const re = new RegExp(`(<key>${key}</key>\\s*)<true/>|<false/>`)
  const tag = value ? '<true/>' : '<false/>'
  if (re.test(src)) return [src.replace(new RegExp(`(<key>${key}</key>\\s*)(<true/>|<false/>)`), `$1${tag}`), true]
  const idx = src.lastIndexOf('</dict>')
  if (idx < 0) return [src, false]
  return [src.slice(0, idx) + `  <key>${key}</key>${tag}\n` + src.slice(idx), true]
}

/** plist URL scheme（CFBundleURLTypes：array of dict）——存在则替换，不存在则插入（嵌套 array，需括号配平） */
function setPlistUrlSchemes(src: string, schemes: string[]): [string, boolean] {
  const body = schemes.map((s) => `<dict><key>CFBundleURLSchemes</key><array><string>${s}</string></array></dict>`).join('')
  const arr = `  <key>CFBundleURLTypes</key><array>${body}</array>\n`
  const keyRe = /<key>CFBundleURLTypes<\/key>\s*<array>/
  const km = keyRe.exec(src)
  if (km) {
    // 从 <array> 起配平（内部还有 <array>…</array>）找到与外层配对的 </array>
    let i = km.index + km[0].length
    let depth = 1
    while (i < src.length) {
      const open = src.indexOf('<array>', i)
      const close = src.indexOf('</array>', i)
      if (close < 0) break
      if (open >= 0 && open < close) { depth++; i = open + '<array>'.length; continue }
      depth--; i = close + '</array>'.length
      if (depth === 0) return [src.slice(0, km.index) + `<key>CFBundleURLTypes</key><array>${body}</array>` + src.slice(i), true]
    }
    return [src, false]
  }
  const idx = src.lastIndexOf('</dict>')
  if (idx < 0) return [src, false]
  return [src.slice(0, idx) + arr + src.slice(idx), true]
}

/** 替换 json5 里 `"key": "value"`（字符串值）——`src` 为单个对象体 */
function setJson5String(src: string, key: string, value: string): [string, boolean] {
  const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`)
  if (re.test(src)) return [src.replace(re, `$1"${value}"`), true]
  return [src, false]
}

/** json5 字符串：存在则改，不存在则在对象体开头插入（`src` 为对象体；返回是否命中） */
function setJson5StringOrAdd(src: string, key: string, value: string): [string, boolean] {
  const [s, hit] = setJson5String(src, key, value)
  if (hit) return [s, true]
  const idx = src.indexOf('{')
  if (idx < 0) return [src, false]
  const ws = /\n\s*/.exec(src.slice(idx))?.[0] ?? '\n  '
  return [src.slice(0, idx + 1) + `${ws}"${key}": "${value}",` + src.slice(idx + 1), true]
}

/** 替换 json5 里 `"key": 123`（数值） */
function setJson5Number(src: string, key: string, value: number): [string, boolean] {
  const re = new RegExp(`("${key}"\\s*:\\s*)-?\\d+`)
  if (re.test(src)) return [src.replace(re, `$1${value}`), true]
  return [src, false]
}

/** 替换 json5 里 `"key": [...]`（数组，元素为字符串） */
function setJson5StringArray(src: string, key: string, values: string[]): [string, boolean] {
  const arr = `[${values.map((v) => `"${v}"`).join(', ')}]`
  const re = new RegExp(`("${key}"\\s*:\\s*)\\[[^\\]]*\\]`)
  if (re.test(src)) return [src.replace(re, `$1${arr}`), true]
  return [src, false]
}

/** 找出 json5 中 `"key": { ... }` 的内层对象串（括号计数；找不到返回 null） */
function json5ObjectBody(src: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*\\{`).exec(src)
  if (!m) return null
  let i = m.index + m[0].length
  let depth = 1
  const start = i
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i)
    }
  }
  return null
}

/** 用新体替换 `"key": { body }`（返回 [新文本, 是否命中]） */
function setJson5ObjectBody(src: string, key: string, newBody: string): [string, boolean] {
  const m = new RegExp(`("${key}"\\s*:\\s*)\\{`).exec(src)
  if (!m) return [src, false]
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return [src.slice(0, m.index + m[0].length) + newBody + src.slice(i), true]
    }
  }
  return [src, false]
}

/** 把 `key: <target>` 的行内值从 from 换成 to（用于 string.json 的 name/value 对） */
function setStringResValue(src: string, name: string, value: string): [string, boolean] {
  const re = new RegExp(`(\\{\\s*"name"\\s*:\\s*"${name}"\\s*,\\s*"value"\\s*:\\s*)"[^"]*"(\\s*\\})`)
  if (re.test(src)) return [src.replace(re, `$1"${value}"$2`), true]
  return [src, false]
}

/* ================= 各端应用 ================= */

function applyAndroid(hostDir: string, r: ResolvedAndroidNative, d: Record<keyof ResolvedAndroidNative, boolean>, out: NativeApplyReport): void {
  // 兼容两种布局：CLI 模板（hostDir/AndroidManifest.xml）与参考宿主（hostDir/app/src/main/AndroidManifest.xml）
  const cands = [path.join(hostDir, 'AndroidManifest.xml'), path.join(hostDir, 'app/src/main/AndroidManifest.xml')]
  const file = cands.find((f) => fs.existsSync(f))
  if (!file) {
    out.skipped.push('AndroidManifest.xml（未找到）')
    return
  }
  let src = fs.readFileSync(file, 'utf-8')
  const rel = path.relative(hostDir, file)
  const push = (field: string, to: string, before: string, hit: boolean) => {
    if (hit) out.changes.push({ file: rel, field, from: before === to ? undefined : before, to })
    else out.skipped.push(`${rel}:${field}（未找到可替换处）`)
  }
  if (d.applicationId && r.applicationId) {
    const [s, hit] = setAttr(src, 'package', r.applicationId)
    push('package', r.applicationId, (src.match(/package\s*=\s*"([^"]*)"/) ?? [])[1] ?? '', hit)
    src = s
  }
  if (d.label) {
    const [s, hit] = setAttr(src, 'android:label', r.label)
    push('android:label', r.label, (src.match(/android:label\s*=\s*"([^"]*)"/) ?? [])[1] ?? '', hit)
    src = s
  }
  // versionCode/versionName：manifest 属性（缺失则跳过——参考宿主用 aapt2 传参，无需属性）
  if (d.versionCode) { const [s, hit] = setAttr(src, 'android:versionCode', String(r.versionCode)); if (hit) { push('android:versionCode', String(r.versionCode), '', true); src = s } }
  if (d.versionName) { const [s, hit] = setAttr(src, 'android:versionName', r.versionName); if (hit) { push('android:versionName', r.versionName, '', true); src = s } }
  // uses-sdk（minSdk/targetSdk）：只在已存在 <uses-sdk> 时改；不存在则跳过（参考宿主用 aapt2 传参）
  if (d.minSdk || d.targetSdk) {
    const [s1, h1] = d.minSdk ? setAttr(src, 'android:minSdkVersion', String(r.minSdk)) : [src, false] as [string, boolean]
    const [s2, h2] = d.targetSdk ? setAttr(s1, 'android:targetSdkVersion', String(r.targetSdk)) : [s1, false] as [string, boolean]
    if (h1) push('android:minSdkVersion', String(r.minSdk), '', true)
    if (h2) push('android:targetSdkVersion', String(r.targetSdk), '', true)
    src = s2
  }
  if (d.orientation && r.orientation !== 'unspecified') {
    const [s, hit] = setOrAddAttrInTag(src, 'activity', 'android:screenOrientation', r.orientation)
    push('android:screenOrientation', r.orientation, '', hit)
    src = s
  }
  if (d.icon && r.icon) {
    const [s, hit] = setOrAddAttrInTag(src, 'application', 'android:icon', r.icon)
    push('android:icon', r.icon, '', hit)
    src = s
  }
  // ★扩充字段：起始页（manifest meta-data ProteusHomePage）/ 主题 / 应用标志（set-or-add 到 <application>）
  if (d.launchPage && r.launchPage) {
    const re = /(<meta-data\s+android:name="ProteusHomePage"\s+android:value=")[^"]*(")/
    if (re.test(src)) { src = src.replace(re, `$1${r.launchPage}$2`); out.changes.push({ file: rel, field: 'ProteusHomePage', to: r.launchPage }) }
    else out.skipped.push(`${rel}:ProteusHomePage（无 meta-data 锚点）`)
  }
  const appAttrs: Array<[string, string]> = []
  if (d.theme && r.theme) appAttrs.push(['android:theme', r.theme])
  if (d.allowBackup) appAttrs.push(['android:allowBackup', String(r.allowBackup)])
  if (d.largeHeap) appAttrs.push(['android:largeHeap', String(r.largeHeap)])
  if (d.hardwareAccelerated) appAttrs.push(['android:hardwareAccelerated', String(r.hardwareAccelerated)])
  if (d.supportsRtl) appAttrs.push(['android:supportsRtl', String(r.supportsRtl)])
  if (d.usesCleartextTraffic) appAttrs.push(['android:usesCleartextTraffic', String(r.usesCleartextTraffic)])
  if (d.networkSecurityConfig && r.networkSecurityConfig) appAttrs.push(['android:networkSecurityConfig', r.networkSecurityConfig])
  if (d.appCategory && r.appCategory) appAttrs.push(['android:appCategory', r.appCategory])
  for (const [attr, val] of appAttrs) {
    const [s, hit] = setOrAddAttrInTag(src, 'application', attr, val)
    push(attr, val, '', hit)
    src = s
  }
  // permissions（幂等：已含则不加）
  if (d.permissions) for (const p of r.permissions) {
    if (src.includes(`android:name="${p}"`)) continue
    const anchor = /<manifest\b[^>]*>/
    if (anchor.test(src)) {
      src = src.replace(anchor, (m) => `${m}\n    <uses-permission android:name="${p}" />`)
      out.changes.push({ file: rel, field: 'uses-permission', to: p })
    } else out.skipped.push(`${rel}:uses-permission ${p}（无 <manifest> 锚点）`)
  }
  fs.writeFileSync(file, src)
}

function applyIos(hostDir: string, r: ResolvedIosNative, d: Record<keyof ResolvedIosNative, boolean>, out: NativeApplyReport): void {
  const file = path.join(hostDir, 'Info.plist')
  if (!fs.existsSync(file)) {
    out.skipped.push('Info.plist（未找到）')
    return
  }
  let src = fs.readFileSync(file, 'utf-8')
  const rel = 'Info.plist'
  const fields: Array<[string, string]> = []
  if (d.displayName) fields.push(['CFBundleDisplayName', r.displayName], ['CFBundleName', r.displayName])
  if (d.version) fields.push(['CFBundleShortVersionString', r.version])
  if (d.buildNumber) fields.push(['CFBundleVersion', r.buildNumber])
  if (d.minimumOSVersion) fields.push(['MinimumOSVersion', r.minimumOSVersion])
  if (r.bundleId) fields.push(['CFBundleIdentifier', r.bundleId])
  for (const [k, v] of fields) {
    const [s, hit] = setPlistString(src, k, v)
    if (hit) { out.changes.push({ file: rel, field: k, to: v }); src = s }
    else out.skipped.push(`${rel}:${k}（未找到键）`)
  }
  // UIDeviceFamily（integer 数组）
  if (d.deviceFamily) {
    const arr = `<array>${r.deviceFamily.map((n) => `<integer>${n}</integer>`).join('')}</array>`
    const re = /(<key>UIDeviceFamily<\/key>\s*)<array>[\s\S]*?<\/array>/
    if (re.test(src)) { src = src.replace(re, `$1${arr}`); out.changes.push({ file: rel, field: 'UIDeviceFamily', to: String(r.deviceFamily.join(',')) }) }
  }
  // UISupportedInterfaceOrientations（字符串数组）
  if (d.orientations) {
    const map: Record<string, string> = {
      portrait: 'UIInterfaceOrientationPortrait',
      'portrait-upside-down': 'UIInterfaceOrientationPortraitUpsideDown',
      'landscape-left': 'UIInterfaceOrientationLandscapeLeft',
      'landscape-right': 'UIInterfaceOrientationLandscapeRight',
    }
    const arr = `<array>${r.orientations.map((o) => `<string>${map[o]}</string>`).join('')}</array>`
    const re = /(<key>UISupportedInterfaceOrientations<\/key>\s*)<array>[\s\S]*?<\/array>/
    if (re.test(src)) { src = src.replace(re, `$1${arr}`); out.changes.push({ file: rel, field: 'UISupportedInterfaceOrientations', to: r.orientations.join(',') }) }
  }
  // ★扩充字段：起始页（ProteusHomePage）/ UI 风格 / 状态栏 / 类别 / 全屏 / 语言（set-or-add 字符串）
  const strFields: Array<[string, string | undefined, boolean]> = [
    ['ProteusHomePage', r.launchPage, !!d.launchPage],
    ['UIUserInterfaceStyle', r.userInterfaceStyle, !!d.userInterfaceStyle],
    ['UIStatusBarStyle', r.statusBarStyle, !!d.statusBarStyle],
    ['LSApplicationCategoryType', r.appCategory, !!d.appCategory],
    ['CFBundleDevelopmentRegion', r.developmentRegion, !!d.developmentRegion],
  ]
  for (const [k, v, on] of strFields) {
    if (!on || v == null) continue
    const [s, hit] = setPlistStringOrAdd(src, k, v)
    if (hit) { out.changes.push({ file: rel, field: k, to: v }); src = s }
  }
  if (d.statusBarHidden) { const [s, hit] = setPlistBoolOrAdd(src, 'UIStatusBarHidden', !!r.statusBarHidden); if (hit) { out.changes.push({ file: rel, field: 'UIStatusBarHidden', to: String(!!r.statusBarHidden) }); src = s } }
  if (d.requiresFullScreen) { const [s, hit] = setPlistBoolOrAdd(src, 'UIRequiresFullScreen', !!r.requiresFullScreen); if (hit) { out.changes.push({ file: rel, field: 'UIRequiresFullScreen', to: String(!!r.requiresFullScreen) }); src = s } }
  // CFBundleURLTypes（URL scheme 深链注册）
  if (d.urlSchemes && r.urlSchemes && r.urlSchemes.length) {
    const [s, hit] = setPlistUrlSchemes(src, r.urlSchemes)
    if (hit) { out.changes.push({ file: rel, field: 'CFBundleURLTypes', to: r.urlSchemes.join(',') }); src = s }
  }
  // 隐私用途说明（NSXxxUsageDescription——set-or-add 字符串）
  if (d.privacyUsageDescriptions && r.privacyUsageDescriptions) {
    for (const [k, v] of Object.entries(r.privacyUsageDescriptions)) {
      const [s, hit] = setPlistStringOrAdd(src, k, v)
      if (hit) { out.changes.push({ file: rel, field: k, to: v }); src = s }
      else out.skipped.push(`${rel}:${k}（无 </dict> 锚点）`)
    }
  }
  fs.writeFileSync(file, src)
}

function applyHarmony(hostDir: string, r: ResolvedHarmonyNative, d: Record<keyof ResolvedHarmonyNative, boolean>, out: NativeApplyReport): void {
  // AppScope/app.json5（bundleName/vendor/versionCode/versionName/label）
  const appJson = [path.join(hostDir, 'AppScope/app.json5'), path.join(hostDir, 'app.json5')].find((f) => fs.existsSync(f))
  if (appJson) {
    let src = fs.readFileSync(appJson, 'utf-8')
    const rel = path.relative(hostDir, appJson)
    if (d.bundleName && r.bundleName) { const [s, hit] = setJson5String(src, 'bundleName', r.bundleName); if (hit) { out.changes.push({ file: rel, field: 'bundleName', to: r.bundleName }); src = s } else out.skipped.push(`${rel}:bundleName（未找到）`) }
    if (d.vendor) { const [s, hit] = setJson5String(src, 'vendor', r.vendor); if (hit) { out.changes.push({ file: rel, field: 'vendor', to: r.vendor }); src = s } }
    if (d.versionCode) { const [s, hit] = setJson5Number(src, 'versionCode', r.versionCode); if (hit) { out.changes.push({ file: rel, field: 'versionCode', to: String(r.versionCode) }); src = s } }
    if (d.versionName) { const [s, hit] = setJson5String(src, 'versionName', r.versionName); if (hit) { out.changes.push({ file: rel, field: 'versionName', to: r.versionName }); src = s } }
    if (d.icon && r.icon) { const [s, hit] = setJson5StringOrAdd(src, 'icon', r.icon); if (hit) { out.changes.push({ file: rel, field: 'icon', to: r.icon }); src = s } }
    if (d.appCategory && r.appCategory) { const [s, hit] = setJson5StringOrAdd(src, 'appCategory', r.appCategory); if (hit) { out.changes.push({ file: rel, field: 'appCategory', to: r.appCategory }); src = s } }
    fs.writeFileSync(appJson, src)
  } else out.skipped.push('AppScope/app.json5（未找到）')

  // entry/module.json5（deviceTypes + requestPermissions）
  const modJson = [path.join(hostDir, 'entry/src/main/module.json5'), path.join(hostDir, 'module.json5')].find((f) => fs.existsSync(f))
  if (modJson) {
    let src = fs.readFileSync(modJson, 'utf-8')
    const rel = path.relative(hostDir, modJson)
    const body = json5ObjectBody(src, 'module')
    if (body) {
      let nb = body
      if (d.deviceTypes) {
        const [s1, h1] = setJson5StringArray(nb, 'deviceTypes', r.deviceTypes)
        if (h1) { nb = s1; out.changes.push({ file: rel, field: 'deviceTypes', to: r.deviceTypes.join(',') }) } else out.skipped.push(`${rel}:deviceTypes（未找到）`)
      }
      if (d.permissions && r.permissions.length) {
        const arr = `[${r.permissions.map((p) => `{ "name": "${p}" }`).join(', ')}]`
        if (/["']requestPermissions["']\s*:\s*\[/.test(nb)) {
          nb = nb.replace(/(["']requestPermissions["']\s*:\s*)\[[^\]]*\]/, `$1${arr}`)
        } else {
          // 在 module 体末尾插入（module 内顶级键）
          nb = nb.replace(/\s*$/, `,\n    "requestPermissions": ${arr}\n  `)
        }
        out.changes.push({ file: rel, field: 'requestPermissions', to: r.permissions.join(',') })
      }
      // ★入口 Ability 方向（abilities[0].orientation）——存在则改，不存在则在该 ability 对象体首插
      if (d.orientation && r.orientation) {
        const abRe = /(["']abilities["']\s*:\s*\[\s*\{)/
        const m = abRe.exec(nb)
        if (m) {
          const head = m[0]
          const tail = nb.slice(m.index + head.length)
          const re = /(["']orientation["']\s*:\s*)"[^"]*"/
          nb = re.test(tail)
            ? nb.slice(0, m.index + head.length) + tail.replace(re, `$1"${r.orientation}"`) + ''
            : nb.slice(0, m.index + head.length) + `\n        "orientation": "${r.orientation}",` + tail
          out.changes.push({ file: rel, field: 'abilities[0].orientation', to: r.orientation })
        } else out.skipped.push(`${rel}:orientation（无 abilities 锚点）`)
      }
      if (nb !== body) { const [s2] = setJson5ObjectBody(src, 'module', nb); src = s2 }
    } else out.skipped.push(`${rel}:module 体（未找到）`)
    fs.writeFileSync(modJson, src)
  } else out.skipped.push('entry/src/main/module.json5（未找到）')

  // 应用名（AppScope/resources/*/element/string.json 的 app_name）
  if (d.label) {
    let stringTouched = false
    for (const f of [
      path.join(hostDir, 'AppScope/resources/base/element/string.json'),
      path.join(hostDir, 'AppScope/resources/en_US/element/string.json'),
      path.join(hostDir, 'AppScope/resources/zh_CN/element/string.json'),
    ]) {
      if (!fs.existsSync(f)) continue
      const src0 = fs.readFileSync(f, 'utf-8')
      const [s, hit] = setStringResValue(src0, 'app_name', r.label)
      if (hit) { fs.writeFileSync(f, s); stringTouched = true; out.changes.push({ file: path.relative(hostDir, f), field: 'app_name', to: r.label }) }
    }
    if (!stringTouched) out.skipped.push('app_name 字符串资源（未找到）')
  }
}

/**
 * 把解析后的原生配置**应用**到宿主工程的原生文件（字段级补丁；幂等；过程写入报告）。
 * ★只写**声明过**的字段（resolved.declared）——未声明的字段保持工程现值，**不用内置默认覆盖手改值**。
 * @param hostDir 宿主工程目录
 * @param platform 目标端
 * @param resolved resolveNativeConfig(...) 的产物
 */
export function applyNativeConfig(hostDir: string, platform: AppPlatform, resolved: ResolvedNativeConfig): NativeApplyReport {
  const out: NativeApplyReport = { ok: true, changes: [], skipped: [], notes: [] }
  try {
    if (platform === 'android') applyAndroid(hostDir, resolved.android, resolved.declared.android, out)
    else if (platform === 'ios') applyIos(hostDir, resolved.ios, resolved.declared.ios, out)
    else applyHarmony(hostDir, resolved.harmony, resolved.declared.harmony, out)
    out.notes.push(`已应用 ${out.changes.length} 个字段${out.skipped.length ? `，跳过 ${out.skipped.length} 个（见下）` : ''}`)
  } catch (e) {
    out.ok = false
    out.notes.push('应用失败：' + String(e instanceof Error ? e.message : e).slice(0, 300))
  }
  return out
}

/** 从工程根解析原生身份（读 proteus.config.ts 的 targets.<端>+app，回退 app.config.ts 的 app.*） */
export async function resolveNativeConfigFromProject(projectRoot: string): Promise<ResolvedNativeConfig> {
  let native: NativeSections | undefined
  let fallback: NativeAppFallback | undefined
  try {
    const cfgPath = path.join(projectRoot, 'proteus.config.ts')
    if (fs.existsSync(cfgPath)) {
      const { loadProteusConfig } = await import('./config-loader')
      const { config } = await loadProteusConfig(cfgPath)
      native = {
        app: config.app,
        android: config.targets.android,
        ios: config.targets.ios,
        harmony: config.targets.harmony,
      }
    }
  } catch { /* 无配置/加载失败 ⇒ 原生身份全用默认 */ }
  try {
    const appCfgPath = path.join(projectRoot, 'app.config.ts')
    if (fs.existsSync(appCfgPath)) {
      const { loadProjectConfig } = await import('./config-loader')
      const appCfg = (await loadProjectConfig(appCfgPath)) as { app?: NativeAppFallback } | undefined
      fallback = appCfg?.app
    }
  } catch { /* 无 app.config ⇒ 无回退 */ }
  return resolveNativeConfig(native, fallback)
}

/** 便捷：解析工程 native 配置并应用到宿主工程（打包前置步骤） */
export async function applyNativeConfigFromProject(
  hostDir: string,
  platform: AppPlatform,
  projectRoot: string | undefined,
): Promise<NativeApplyReport> {
  if (!projectRoot) return { ok: true, changes: [], skipped: [], notes: ['无 projectRoot——跳过原生配置注入'] }
  const resolved = await resolveNativeConfigFromProject(projectRoot)
  return applyNativeConfig(hostDir, platform, resolved)
}
