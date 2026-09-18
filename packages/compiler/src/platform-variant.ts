// packages/compiler/src/platform-variant.ts —— 平台变体解析（工程架构基础层）
//
// 定位：Proteus 的「同一位置、不同平台放不同东西」机制。**不是 C 式条件编译（#ifdef）**——
//   不在一个文件里塞 N 个平台分支，而是 **N 个变体文件 + 工具链按目标解析选一个**（Go 式）。
//
// ★两级模型（2026-09-13 细化）：单一 `native` 太粗——iOS / Android / 鸿蒙是**完全不同的操作系统**，
//   且小程序端也有多厂商（微信/支付宝/抖音）。故分两层：
//     · 具体平台（ConcretePlatform）：web | mp | ios | android | harmony —— 变体后缀可精确到 OS
//     · 平台族（PlatformFamily）：web | mp | native —— 可作变体后缀，回退给族内全部具体平台
//   解析顺序：**具体平台变体 → 族变体 → 共享基准**。
//   于是既可 `settings.ios.ts`（iOS 专属），也可 `settings.native.ts`（三端原生共用一份）。
//
// 覆盖五层：业务代码(.ts/.js) / 组件页面(.vue) / 静态资源(png/svg/…) / 路由(meta) / CSS。
//
// ★命名规范（归一既有口径）：
//   具体平台 id 与框架既有体系对齐——CLI TARGETS=['web','skyline','ios','android','harmony']、
//   BackendId 的 native-ios/native-android/native-harmony、app-config 的 Platform 五端。
//   别名归一：skyline/mp-weixin → mp；app/native-ios/native-android/native-harmony → 对应具体平台/族。
//   变体**文件后缀**取无连字符形态（web/mp/skyline/ios/android/harmony/native/app），
//   故旧规划文档承诺的 `*.skyline.ts`、`*.app.ts` 仍可用。

/** 具体平台（变体后缀可精确到具体平台/OS） */
export type ConcretePlatform = 'web' | 'mp' | 'ios' | 'android' | 'harmony'

/** 平台族（可作变体后缀；作为族内全部具体平台的回退） */
export type PlatformFamily = 'web' | 'mp' | 'native'

/** 变体解析目标：具体平台 或 平台族 */
export type VariantPlatform = ConcretePlatform | PlatformFamily

/** 全部具体平台（顺序稳定） */
export const CONCRETE_PLATFORMS: readonly ConcretePlatform[] = ['web', 'mp', 'ios', 'android', 'harmony']

/** 全部可选变体后缀（供文档/校验用；无连字符） */
export const VARIANT_SUFFIXES: readonly string[] = ['web', 'mp', 'skyline', 'ios', 'android', 'harmony', 'native', 'app']

/** 兼容别名（旧名保留；VARIANT_PLATFORMS 保留供既有消费方） */
export const VARIANT_PLATFORMS: readonly VariantPlatform[] = ['web', 'mp', 'native']

/** 别名 → 规范 id（宽口径：接受构建目标/后端名等输入形态） */
const PLATFORM_ALIASES: Record<string, VariantPlatform> = {
  web: 'web',
  mp: 'mp', 'mp-weixin': 'mp', skyline: 'mp',
  ios: 'ios', 'native-ios': 'ios',
  android: 'android', 'native-android': 'android',
  harmony: 'harmony', 'native-harmony': 'harmony',
  native: 'native', app: 'native',
}

/** 具体平台 → 所属族 */
const PLATFORM_FAMILY: Record<ConcretePlatform, PlatformFamily> = {
  web: 'web',
  mp: 'mp',
  ios: 'native',
  android: 'native',
  harmony: 'native',
}

/** 族/平台的**文件后缀**别名（无连字符；顺序=优先级） */
const SUFFIX_ALIASES: Record<string, string[]> = {
  mp: ['skyline'],
  native: ['app'],
}

/** 规范平台标识（未知返回 undefined——不猜，调用方自行决定 fail 策略） */
export function normalizePlatform(raw: string): VariantPlatform | undefined {
  return PLATFORM_ALIASES[raw.trim().toLowerCase()]
}

/** 该平台所属族（具体平台 → 族；族 → 自身） */
export function platformFamily(p: VariantPlatform): PlatformFamily {
  return (PLATFORM_FAMILY as Record<string, PlatformFamily>)[p] ?? (p as PlatformFamily)
}

/** 构建目标（config.platform）→ 规范平台 id（'mp-weixin'→'mp'、'ios'→'ios' …） */
export function platformFromBuildTarget(target: string): VariantPlatform {
  return normalizePlatform(target) ?? 'web'
}

/**
 * 某**解析目标**可接受的变体文件后缀（按优先级）：精确平台 → 平台别名 → 族（含族别名）。
 * 例：'ios' → ['ios','native','app']（iOS 专属优先，其次三端原生共用）
 *     'mp'  → ['mp','skyline']；'web' → ['web']；'native' → ['native','app']
 */
export function variantSuffixes(platform: VariantPlatform): string[] {
  const out: string[] = [platform]
  for (const a of SUFFIX_ALIASES[platform] ?? []) out.push(a)
  const fam = platformFamily(platform)
  if (fam !== platform) {
    out.push(fam)
    for (const a of SUFFIX_ALIASES[fam] ?? []) out.push(a)
  }
  return [...new Set(out)]
}

/** 文件名的末扩展名前的段是否为**已知变体后缀**（宽口径 + 无连字符约束） */
function asSuffix(token: string): VariantPlatform | undefined {
  if (token.includes('-')) return undefined // 文件后缀取无连字符形态
  return normalizePlatform(token)
}

/** 拆解文件名中的平台变体后缀（返回规范平台 + 原始后缀 token）：
 *  `foo.web.ts` → { base:'foo.ts', platform:'web', suffix:'web' }
 *  `foo.ios.ts` → { base:'foo.ts', platform:'ios', suffix:'ios' }
 *  `foo.native.ts` → { base:'foo.ts', platform:'native', suffix:'native' }
 *  `foo.ts` → { base:'foo.ts', platform:undefined }
 *  ★后缀须位于**最后一个扩展名之前**（故 `a.web.config.ts` 的 `.web` 是业务名，不拆）。 */
export function splitVariant(filePath: string): { base: string; platform?: VariantPlatform; suffix?: string } {
  const dir = filePath.slice(0, filePath.lastIndexOf('/') + 1)
  const name = filePath.slice(dir.length)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { base: filePath, platform: undefined }
  const ext = name.slice(dot)
  const stem = name.slice(0, dot)
  const stemDot = stem.lastIndexOf('.')
  if (stemDot <= 0) return { base: filePath, platform: undefined }
  const rawSuffix = stem.slice(stemDot + 1)
  const platform = asSuffix(rawSuffix)
  if (!platform) return { base: filePath, platform: undefined }
  return { base: dir + stem.slice(0, stemDot) + ext, platform, suffix: rawSuffix }
}

/** 候选路径（按优先级）：目标平台各后缀变体 → 无后缀基准。纯字符串运算，不触盘。 */
export function variantCandidates(filePath: string, platform: VariantPlatform): string[] {
  const { base } = splitVariant(filePath)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  const out: string[] = []
  for (const sfx of variantSuffixes(platform)) out.push(`${stem}.${sfx}${ext}`)
  out.push(base)
  return out
}

/** 解析（注入 exists 以便纯函数测试）：返回首个存在的候选，无则 null。 */
export function resolvePlatformVariant(
  filePath: string,
  platform: VariantPlatform,
  exists: (p: string) => boolean,
): string | null {
  for (const cand of variantCandidates(filePath, platform)) {
    if (exists(cand)) return cand
  }
  return null
}

/** 无扩展名导入的多扩展名解析（供 `./share` → `share.ios.ts` 场景）：
 *  后缀优先级外层、扩展名内层；平台变体 → 族变体 → 基准。 */
export function resolvePlatformVariantWithExts(
  baseNoExt: string,
  exts: readonly string[],
  platform: VariantPlatform,
  exists: (p: string) => boolean,
): string | null {
  for (const sfx of variantSuffixes(platform)) {
    for (const ext of exts) {
      const cand = `${baseNoExt}.${sfx}${ext}`
      if (exists(cand)) return cand
    }
  }
  for (const ext of exts) {
    const cand = `${baseNoExt}${ext}`
    if (exists(cand)) return cand
  }
  return null
}

/**
 * 该文件是否为「对目标平台无效」的变体（构建扫描时**排除**用）。
 * 目标平台**可接受的全部后缀**（含族）之外 → 视为他端变体；无后缀（共享基准）→ false。
 * 例：目标 'ios' 时 `.native.ts` **有效**（族回退），`.android.ts` 为他端。
 */
export function isForeignVariant(filePath: string, platform: VariantPlatform): boolean {
  const { suffix } = splitVariant(filePath)
  if (suffix === undefined) return false
  return !variantSuffixes(platform).includes(suffix)
}

/**
 * 同一组文件中，为某个「逻辑名」挑选目标平台的有效文件（扫描/去重用）。
 * 顺序：目标平台后缀（按优先级）→ 无后缀基准 → null。
 */
export function pickVariant(
  candidates: readonly string[],
  platform: VariantPlatform,
): string | null {
  const wanted = variantSuffixes(platform)
  for (const sfx of wanted) {
    const hit = candidates.find((f) => splitVariant(f).suffix === sfx)
    if (hit) return hit
  }
  return candidates.find((f) => splitVariant(f).platform === undefined) ?? null
}

/**
 * ★扫描期「有效文件集」：把一批文件按**逻辑名**（去变体后缀）分组，每组选目标平台那一份，
 * 排除他端变体与「被变体覆盖的基准」。供 MP 目录扫描（每个变体不能当独立页面重复编译）。
 *
 * 例（platform='mp'，输入 page.vue / page.web.vue / page.mp.vue / other.vue）：
 *   → [page.mp.vue, other.vue]（page.vue 被 page.mp.vue 覆盖、page.web.vue 是他端）
 * 例（platform='ios'，输入 s.ts / s.native.ts / s.android.ts）：
 *   → [s.native.ts]（族回退命中；android 是他端）
 */
export function effectiveVariants(
  files: readonly string[],
  platform: VariantPlatform,
): string[] {
  const groups = new Map<string, string[]>()
  const order: string[] = []
  for (const f of files) {
    const { base } = splitVariant(f)
    if (!groups.has(base)) {
      groups.set(base, [])
      order.push(base)
    }
    groups.get(base)!.push(f)
  }
  const out: string[] = []
  for (const base of order) {
    const picked = pickVariant(groups.get(base)!, platform)
    if (picked) out.push(picked)
  }
  return out
}

/**
 * ★静态资源变体映射（第 3 层）：把 public/ 下的文件列表按平台选出有效集，
 * 并给出**去变体后缀**的产物相对路径（`assets/logo.ios.png` → `assets/logo.png`）。
 * 于是模板里始终写 `src="/assets/logo.png"`，各端各自产出各自的图。
 */
export function mapPublicAssetVariants(
  relFiles: readonly string[],
  platform: VariantPlatform,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  for (const sel of effectiveVariants(relFiles, platform)) {
    out.push({ from: sel, to: splitVariant(sel).base })
  }
  return out
}
