// tests/platform-variant.test.ts
// ★平台变体解析回归锁（2026-09-13，工程架构基础层）：
//   命题：同一位置按平台放不同文件（业务代码/组件/静态资源），**构建期解析选一个**——
//   Go 式文件级分叉，非 C 式 #ifdef。差异可见（ls 即清单）、各自类型检查、死文件不进产物。
import { describe, it, expect } from 'vitest'
import {
  normalizePlatform, platformFamily, platformFromBuildTarget, variantSuffixes, splitVariant,
  variantCandidates, resolvePlatformVariant, resolvePlatformVariantWithExts,
  isForeignVariant, pickVariant, effectiveVariants, mapPublicAssetVariants,
  VARIANT_PLATFORMS, CONCRETE_PLATFORMS,
} from '../packages/compiler/src/platform-variant'

const existsIn = (set: string[]) => (p: string) => set.includes(p)

describe('★平台变体·命名规范（统一三套既有口径）', () => {
  it('规范平台 id = web | mp | native（与 __MP__/__WEB__/__TARGET__ 及 ProteusRuntime 一致）', () => {
    expect(VARIANT_PLATFORMS).toEqual(['web', 'mp', 'native'])
  })

  it('★两级模型：具体平台 web|mp|ios|android|harmony + 族 web|mp|native', () => {
    expect(CONCRETE_PLATFORMS).toEqual(['web', 'mp', 'ios', 'android', 'harmony'])
    expect(platformFamily('ios')).toBe('native')
    expect(platformFamily('android')).toBe('native')
    expect(platformFamily('harmony')).toBe('native')
    expect(platformFamily('mp')).toBe('mp')
    expect(platformFamily('web')).toBe('web')
    expect(platformFamily('native')).toBe('native')
  })

  it('别名归一：skyline→mp、app→native、native-ios→ios（兼容旧规划/后端命名）', () => {
    expect(normalizePlatform('skyline')).toBe('mp')
    expect(normalizePlatform('app')).toBe('native')
    expect(normalizePlatform('mp-weixin')).toBe('mp')
    expect(normalizePlatform('native-ios')).toBe('ios')
    expect(normalizePlatform('native-android')).toBe('android')
    expect(normalizePlatform('native-harmony')).toBe('harmony')
    expect(normalizePlatform('unknown')).toBeUndefined()
  })

  it('★后缀族回退：ios → [ios, native, app]；mp → [mp, skyline]', () => {
    expect(variantSuffixes('ios')).toEqual(['ios', 'native', 'app'])
    expect(variantSuffixes('android')).toEqual(['android', 'native', 'app'])
    expect(variantSuffixes('harmony')).toEqual(['harmony', 'native', 'app'])
    expect(variantSuffixes('mp')).toEqual(['mp', 'skyline'])
    expect(variantSuffixes('web')).toEqual(['web'])
  })

  it('构建目标 → 变体 id', () => {
    expect(platformFromBuildTarget('mp-weixin')).toBe('mp')
    expect(platformFromBuildTarget('web')).toBe('web')
  })

  it('后缀不含连字符（文件后缀形态）', () => {
    for (const p of ['web','mp','ios','android','harmony','native'] as const) {
      expect(variantSuffixes(p).every((s) => !s.includes('-'))).toBe(true)
    }
  })
})

describe('★平台变体·文件拆解 splitVariant', () => {
  it('识别末扩展名前的平台段（含具体平台 ios/android/harmony）', () => {
    expect(splitVariant('/a/foo.web.ts')).toMatchObject({ base: '/a/foo.ts', platform: 'web' })
    expect(splitVariant('/a/foo.mp.ts')).toMatchObject({ base: '/a/foo.ts', platform: 'mp' })
    expect(splitVariant('/a/logo.skyline.png')).toMatchObject({ base: '/a/logo.png', platform: 'mp' })
    expect(splitVariant('/a/logo.web.png')).toMatchObject({ base: '/a/logo.png', platform: 'web' })
    expect(splitVariant('/a/p-button.mp.vue')).toMatchObject({ base: '/a/p-button.vue', platform: 'mp' })
    // ★细分 OS
    expect(splitVariant('/a/s.ios.ts')).toMatchObject({ base: '/a/s.ts', platform: 'ios' })
    expect(splitVariant('/a/s.android.ts')).toMatchObject({ base: '/a/s.ts', platform: 'android' })
    expect(splitVariant('/a/s.harmony.ts')).toMatchObject({ base: '/a/s.ts', platform: 'harmony' })
    expect(splitVariant('/a/s.native.ts')).toMatchObject({ base: '/a/s.ts', platform: 'native' })
  })

  it('无变体后缀 → platform undefined（共享默认）', () => {
    expect(splitVariant('/a/foo.ts').platform).toBeUndefined()
    expect(splitVariant('/a/foo.config.ts').platform).toBeUndefined()
    expect(splitVariant('/a/foo.bar.png').platform).toBeUndefined()
    expect(splitVariant('/a/noext').platform).toBeUndefined()
  })

  it('★不误伤同名业务段（a.web.config.ts 的 .web 不在末扩展名前 → 视为普通文件）', () => {
    // 'a.web.config.ts'：末扩展名 .ts，其前段 'config' 非平台 id → base 不变
    const r = splitVariant('/a/a.web.config.ts')
    expect(r.platform).toBeUndefined()
    expect(r.base).toBe('/a/a.web.config.ts')
  })
})

describe('★平台变体·解析 resolvePlatformVariant', () => {
  it('变体存在 → 选变体（平台优先）', () => {
    const files = ['/a/logo.png', '/a/logo.web.png', '/a/logo.mp.png']
    expect(resolvePlatformVariant('/a/logo.png', 'web', existsIn(files))).toBe('/a/logo.web.png')
    expect(resolvePlatformVariant('/a/logo.png', 'mp', existsIn(files))).toBe('/a/logo.mp.png')
  })

  it('变体不存在 → 回落无后缀基准', () => {
    const files = ['/a/logo.png']
    expect(resolvePlatformVariant('/a/logo.png', 'web', existsIn(files))).toBe('/a/logo.png')
    expect(resolvePlatformVariant('/a/logo.png', 'mp', existsIn(files))).toBe('/a/logo.png')
  })

  it('仅另一平台有变体、无基准 → null（不误用他端文件）', () => {
    const files = ['/a/logo.web.png']
    expect(resolvePlatformVariant('/a/logo.png', 'mp', existsIn(files))).toBeNull()
    expect(resolvePlatformVariant('/a/logo.png', 'web', existsIn(files))).toBe('/a/logo.web.png')
  })

  it('★skyline 别名可命中（旧规划承诺的 *.skyline.ts 仍可用）', () => {
    const files = ['/a/share.skyline.ts']
    expect(resolvePlatformVariant('/a/share.ts', 'mp', existsIn(files))).toBe('/a/share.skyline.ts')
  })

  it('候选顺序：目标变体 → 基准', () => {
    expect(variantCandidates('/a/foo.ts', 'web')).toEqual(['/a/foo.web.ts', '/a/foo.ts'])
    expect(variantCandidates('/a/foo.ts', 'mp')).toEqual(['/a/foo.mp.ts', '/a/foo.skyline.ts', '/a/foo.ts'])
  })
})

describe('★平台变体·无扩展名导入（业务代码 ./share）', () => {
  const exts = ['.ts', '.js']

  it('平台变体优先于基准', () => {
    const files = ['/a/share.ts', '/a/share.web.ts', '/a/share.mp.ts']
    expect(resolvePlatformVariantWithExts('/a/share', exts, 'web', existsIn(files))).toBe('/a/share.web.ts')
    expect(resolvePlatformVariantWithExts('/a/share', exts, 'mp', existsIn(files))).toBe('/a/share.mp.ts')
  })

  it('无变体 → 基准', () => {
    expect(resolvePlatformVariantWithExts('/a/share', exts, 'web', existsIn(['/a/share.ts']))).toBe('/a/share.ts')
  })

  it('仅他端变体 → null', () => {
    expect(resolvePlatformVariantWithExts('/a/share', exts, 'mp', existsIn(['/a/share.web.ts']))).toBeNull()
  })

  it('扩展名优先级不串（.ts 先于 .js）', () => {
    const files = ['/a/x.js', '/a/x.ts']
    expect(resolvePlatformVariantWithExts('/a/x', exts, 'web', existsIn(files))).toBe('/a/x.ts')
  })
})

describe('★平台变体·扫描过滤（构建期不重复编译他端变体）', () => {
  it('isForeignVariant：他端变体 true、目标端/无后缀 false', () => {
    expect(isForeignVariant('/a/page.web.vue', 'mp')).toBe(true)
    expect(isForeignVariant('/a/page.web.vue', 'web')).toBe(false)
    expect(isForeignVariant('/a/page.mp.vue', 'mp')).toBe(false)
    expect(isForeignVariant('/a/page.vue', 'mp')).toBe(false)
  })

  it('pickVariant：目标变体 → 基准 → null', () => {
    expect(pickVariant(['/a/p.vue', '/a/p.web.vue', '/a/p.mp.vue'], 'mp')).toBe('/a/p.mp.vue')
    expect(pickVariant(['/a/p.vue', '/a/p.web.vue'], 'mp')).toBe('/a/p.vue')
    expect(pickVariant(['/a/p.web.vue'], 'mp')).toBeNull()
    expect(pickVariant(['/a/p.mp.vue'], 'mp')).toBe('/a/p.mp.vue')
  })

  it('★effectiveVariants：每个逻辑名只留目标平台那一份（他端变体不重复编译）', () => {
    const files = [
      '/p/index.vue', '/p/index.web.vue', '/p/index.mp.vue',
      '/p/about.vue',
      '/p/only-web.web.vue',
    ]
    expect(effectiveVariants(files, 'mp')).toEqual(['/p/index.mp.vue', '/p/about.vue'])
    expect(effectiveVariants(files, 'web')).toEqual(['/p/index.web.vue', '/p/about.vue', '/p/only-web.web.vue'])
  })

  it('effectiveVariants：无变体时原样（无行为变化）', () => {
    const files = ['/p/a.vue', '/p/b.vue']
    expect(effectiveVariants(files, 'mp')).toEqual(files)
    expect(effectiveVariants(files, 'web')).toEqual(files)
  })
})

describe('★平台变体·静态资源（第 3 层）', () => {
  it('mapPublicAssetVariants：选目标平台资源 + 产物路径去变体后缀', () => {
    const files = ['assets/logo.png', 'assets/logo.web.png', 'assets/logo.mp.png', 'assets/icon.svg']
    expect(mapPublicAssetVariants(files, 'mp')).toEqual([
      { from: 'assets/logo.mp.png', to: 'assets/logo.png' },
      { from: 'assets/icon.svg', to: 'assets/icon.svg' },
    ])
    expect(mapPublicAssetVariants(files, 'web')).toEqual([
      { from: 'assets/logo.web.png', to: 'assets/logo.png' },
      { from: 'assets/icon.svg', to: 'assets/icon.svg' },
    ])
  })

  it('★他端独有资源不进产物（Web 专有图不出现在 mp 构建）', () => {
    const files = ['logo.web.png', 'logo.mp.png', 'hero.web.jpg']
    const mp = mapPublicAssetVariants(files, 'mp')
    expect(mp.map((x) => x.from)).toEqual(['logo.mp.png'])
    expect(mp.some((x) => x.from.includes('hero'))).toBe(false)
  })
})

describe('★第 5 层：CSS 样式变体', () => {
  it('resolvePlatformVariant 对 .css 同样成立（theme.css → theme.mp.css / theme.web.css）', () => {
    const files = ['/a/theme.css', '/a/theme.mp.css', '/a/theme.web.css']
    expect(resolvePlatformVariant('/a/theme.css', 'mp', existsIn(files))).toBe('/a/theme.mp.css')
    expect(resolvePlatformVariant('/a/theme.css', 'web', existsIn(files))).toBe('/a/theme.web.css')
    // 无变体 → 基准（共享默认）
    expect(resolvePlatformVariant('/a/base.css', 'mp', existsIn(files))).toBeNull()
  })

  it('scss/less 变体后缀同样识别（theme.mp.scss）', () => {
    expect(splitVariant('/a/theme.mp.scss')).toMatchObject({ base: '/a/theme.scss', platform: 'mp' })
    expect(splitVariant('/a/theme.web.scss')).toMatchObject({ base: '/a/theme.scss', platform: 'web' })
  })
})

describe('★两级模型·族回退（ios/android/harmony 共用 native 变体）', () => {
  const exists = existsIn

  it('具体平台变体优先：ios 专属 > native 族 > 基准', () => {
    // 仅族变体 → 命中 native
    expect(resolvePlatformVariant('/a/s.ts', 'ios', exists(['/a/s.native.ts', '/a/s.ts']))).toBe('/a/s.native.ts')
    expect(resolvePlatformVariant('/a/s.ts', 'android', exists(['/a/s.native.ts', '/a/s.ts']))).toBe('/a/s.native.ts')
    expect(resolvePlatformVariant('/a/s.ts', 'harmony', exists(['/a/s.native.ts', '/a/s.ts']))).toBe('/a/s.native.ts')
    // ios 专属存在 → 优先 ios（即便 native 也在）
    expect(resolvePlatformVariant('/a/s.ts', 'ios', exists(['/a/s.ios.ts', '/a/s.native.ts', '/a/s.ts']))).toBe('/a/s.ios.ts')
    // android 解析同组 → 跳过 ios 专属，落 native 族
    expect(resolvePlatformVariant('/a/s.ts', 'android', exists(['/a/s.ios.ts', '/a/s.native.ts', '/a/s.ts']))).toBe('/a/s.native.ts')
  })

  it('候选顺序体现两级：ios → [ios, native, app, base]', () => {
    expect(variantCandidates('/a/s.ts', 'ios')).toEqual(['/a/s.ios.ts', '/a/s.native.ts', '/a/s.app.ts', '/a/s.ts'])
  })

  it('isForeignVariant：ios 目标下 native 变体有效、android 变体无效', () => {
    expect(isForeignVariant('/a/s.native.ts', 'ios')).toBe(false)
    expect(isForeignVariant('/a/s.app.ts', 'ios')).toBe(false)
    expect(isForeignVariant('/a/s.android.ts', 'ios')).toBe(true)
    expect(isForeignVariant('/a/s.ios.ts', 'android')).toBe(true)
  })

  it('effectiveVariants：三端原生混排时按目标各取所需', () => {
    const files = ['/a/s.ts', '/a/s.native.ts', '/a/s.ios.ts', '/a/s.android.ts']
    expect(effectiveVariants(files, 'ios')).toEqual(['/a/s.ios.ts'])
    expect(effectiveVariants(files, 'android')).toEqual(['/a/s.android.ts'])
    expect(effectiveVariants(files, 'harmony')).toEqual(['/a/s.native.ts'])
    expect(effectiveVariants(files, 'web')).toEqual(['/a/s.ts'])
  })

  it('无扩展名导入的族回退（./s → s.ios.ts / s.native.ts）', () => {
    const exts = ['.ts']
    expect(resolvePlatformVariantWithExts('/a/s', exts, 'ios', exists(['/a/s.ios.ts', '/a/s.native.ts']))).toBe('/a/s.ios.ts')
    expect(resolvePlatformVariantWithExts('/a/s', exts, 'android', exists(['/a/s.ios.ts', '/a/s.native.ts']))).toBe('/a/s.native.ts')
    expect(resolvePlatformVariantWithExts('/a/s', exts, 'web', exists(['/a/s.ios.ts', '/a/s.native.ts']))).toBeNull()
  })

  it('静态资源同样支持细分 OS（logo.ios.png / logo.native.png）', () => {
    expect(mapPublicAssetVariants(['logo.png', 'logo.ios.png', 'logo.native.png', 'logo.android.png'], 'ios'))
      .toEqual([{ from: 'logo.ios.png', to: 'logo.png' }])
    expect(mapPublicAssetVariants(['logo.png', 'logo.native.png', 'logo.android.png'], 'harmony'))
      .toEqual([{ from: 'logo.native.png', to: 'logo.png' }])
  })
})
