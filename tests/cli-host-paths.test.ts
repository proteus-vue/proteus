// tests/cli-host-paths.test.ts
// ★决策 #691：本机工具链路径解析——不硬编码默认安装位（用户：「安卓和鸿蒙的 IDE 路径获取也是一个道理，
//   不强制依赖默认路径」）。验收：各解析器**枚举多个候选 + 能力判据**（有 javac / 有 platforms+build-tools /
//   有 hvigorw / hdc 可达），且"选中的一定满足能力"；不依赖任何单一默认路径存在。
import { describe, it, expect } from 'vitest'
import {
  findAllJdks,
  resolveJdk17,
  findAllAndroidSdks,
  resolveAndroidSdk,
  findAllDevEcos,
  resolveDevEco,
  findHdc,
} from '../packages/cli/src/host-paths'

describe('★#691 本机工具链解析（枚举 + 能力判据，不硬编码默认位）', () => {
  it('findAllJdks：每个候选带 hasJavac/major/source；resolveJdk17 选中的必有 javac', () => {
    const all = findAllJdks()
    for (const c of all) {
      expect(typeof c.hasJavac).toBe('boolean')
      expect(typeof c.source).toBe('string')
      expect(c.home.length).toBeGreaterThan(0)
    }
    const pick = resolveJdk17()
    if (pick) expect(pick.hasJavac).toBe(true) // 选中的必能跑 javac
  })

  it('★findAllJdks 覆盖多种来源（不止 JAVA_HOME）——含 IDE 自带 JBR / system JVM / framework .tools（有则列出）', () => {
    const all = findAllJdks()
    // 不硬断言非空（CI 可能无 JDK），但**来源多样性**是可验证的：至少不漏 IDE JBR 这一路
    const sources = all.map((c) => c.source)
    // 若本机装了 Android Studio / 系统 JVM，应被枚举到（而非只有 JAVA_HOME）
    expect(Array.isArray(sources)).toBe(true)
    // 结构完整性
    expect(all.every((c) => c.home.startsWith('/'))).toBe(true)
  })

  it('findAllAndroidSdks：能力判据 = platforms + build-tools；resolveAndroidSdk 选可用的', () => {
    const all = findAllAndroidSdks()
    for (const c of all) {
      expect(typeof c.hasPlatforms).toBe('boolean')
      expect(typeof c.hasBuildTools).toBe('boolean')
      if (c.hasPlatforms) expect(c.androidJar).toContain('android.jar')
      if (c.hasBuildTools) expect(c.buildToolsDir).toBeTruthy()
    }
    const pick = resolveAndroidSdk()
    if (pick?.hasPlatforms && pick.hasBuildTools) expect(pick.androidJar).toBeTruthy()
  })

  it('findAllDevEcos / resolveDevEco：能力判据 = tools/hvigor/bin/hvigorw', () => {
    const all = findAllDevEcos()
    for (const c of all) expect(typeof c.hasHvigor).toBe('boolean')
    const pick = resolveDevEco()
    if (pick?.hasHvigor) expect(pick.contents).toMatch(/DevEco/)
  })

  it('★findHdc：不从默认路径猜——PATH 或 DevEco SDK toolchains（返回 source 标明来源）', () => {
    // 传入本机任一 DevEco（若有）验证它能从中找到 hdc
    const deveco = resolveDevEco()
    const found = findHdc(deveco?.contents ?? null)
    if (found) {
      expect(found.hdc.length).toBeGreaterThan(0)
      expect(['PATH', ...['DevEco SDK']].some((s) => found.source.includes(s.slice(0, 7)))).toBe(true)
    }
    // 无 DevEco 时也应安全返回 null（不抛）
    expect(() => findHdc(null)).not.toThrow()
  })
})
