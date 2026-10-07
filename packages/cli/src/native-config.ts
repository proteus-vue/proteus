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
import type { NativeProjectConfig } from '@proteus-vue/types'
import type { AppPlatform } from './targets'

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
}

export interface ResolvedIosNative {
  bundleId?: string
  displayName: string
  version: string
  buildNumber: string
  minimumOSVersion: string
  deviceFamily: number[]
  orientations: Array<'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'>
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

/** 解析 native 段为规范值（native 缺值 → 回退 app.config 的 app.*；再缺 → 内置默认） */
export function resolveNativeConfig(native: NativeProjectConfig | undefined, fallback?: NativeAppFallback): ResolvedNativeConfig {
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
  }
  const ios: ResolvedIosNative = {
    bundleId: i.bundleId,
    displayName: i.displayName ?? name,
    version: i.version ?? version,
    buildNumber: i.buildNumber ?? buildNumber,
    minimumOSVersion: i.minimumOSVersion ?? '15.0',
    deviceFamily: i.deviceFamily ?? [1],
    orientations: i.orientations ?? ['portrait'],
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
      },
      ios: {
        bundleId: i.bundleId != null,
        displayName: i.displayName != null || declaredName,
        version: i.version != null || declaredVersion,
        buildNumber: i.buildNumber != null || declaredBuild,
        minimumOSVersion: i.minimumOSVersion != null,
        deviceFamily: i.deviceFamily != null,
        orientations: i.orientations != null,
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

/** 替换 json5 里 `"key": "value"`（字符串值）——`src` 为单个对象体 */
function setJson5String(src: string, key: string, value: string): [string, boolean] {
  const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`)
  if (re.test(src)) return [src.replace(re, `$1"${value}"`), true]
  return [src, false]
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

/** 从工程根解析 native 段（读 proteus.config.ts 的 native + app.config.ts 的 app.* 作回退） */
export async function resolveNativeConfigFromProject(projectRoot: string): Promise<ResolvedNativeConfig> {
  let native: NativeProjectConfig | undefined
  let fallback: NativeAppFallback | undefined
  try {
    const cfgPath = path.join(projectRoot, 'proteus.config.ts')
    if (fs.existsSync(cfgPath)) {
      const { loadProjectConfig } = await import('./config-loader')
      const cfg = (await loadProjectConfig(cfgPath)) as { native?: NativeProjectConfig } | undefined
      native = cfg?.native
    }
  } catch { /* 无配置/加载失败 ⇒ native 全用默认 */ }
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
