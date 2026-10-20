// tests/glass-capture-ratio.test.ts
// ★★★决策 #1111：玻璃捕获/输出的**有效放大倍率**必须锁住 —— 决定织纹风险的唯一量
//
// 【为什么必须锁（本轮发现的真实口径错误）】
//   iOS 原注释写「输入降采样 =2，与 Android DIV=2 / 鸿蒙 S=2 **同口径**」。
//   实测三个数字：iOS `glassCaptureDiv=2`、`glassOutScale = scale/2`；
//   Android `final int DIV = 1`（#1013 从 2 改回 1）；鸿蒙默认**不传** `glassS`。
//   ⇒ **数字完全不同**，但**有效放大倍率都是 1:1**（捕获分辨率 == 输出分辨率）。
//
//   织纹（weave）只在 **输出 > 捕获**（要放大）时出现：
//     · Android DIV=2 当年就是 2.00x 放大 ⇒ 「网格状插值织纹」，用户肉眼否决（#1013）；
//     · iOS 默认 1.00x ⇒ 本来就没有放大面，这解释了「iOS 为何从未出现那个织纹」。
//
//   ★危险动作（本文档守的就是这两个）：
//     ① 「把 iOS 对齐成 Android 的 DIV=1」 ⇒ 抓 4 倍像素（1.5→3 px/pt），**纯浪费、零收益**；
//     ② 「把 iOS 调到 div=3」 ⇒ 1.50x 放大，**落进 Android 明确否决的方向**。
//   ⇒ 判据：**默认配置的有效放大倍率必须 == 1.00**；任何改变倍率的改动都必须显式改本测试。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8')

const IOS_GLASS = 'hosts/ios/ProteusHost/runtime/selfdraw-glass.swift'
const IOS_SCENE = 'hosts/ios/ProteusHost/runtime/selfdraw-scene.swift'

/** 从源码里取 `glassCaptureDiv` 的默认返回值（整数） */
function iosCaptureDivDefault(): number {
  const s = read(IOS_SCENE)
  const m = /static let glassCaptureDiv: CGFloat = \{[\s\S]*?else \{ return (\d+) \}/.exec(s)
  if (!m) throw new Error('找不到 glassCaptureDiv 默认值')
  return Number(m[1])
}

/** 从源码里取 `glassOutScale` 的表达式除数（`max(1, scale / N)`） */
function iosOutScaleDivisor(): number {
  const s = read(IOS_GLASS)
  const m = /let glassOutScale = max\(1, scale \/ (\d+)\)/.exec(s)
  if (!m) throw new Error('找不到 glassOutScale 表达式')
  return Number(m[1])
}

describe('★#1111 玻璃捕获/输出的有效放大倍率', () => {
  it('★iOS 默认配置的有效放大倍率 == 1.00（无放大 ⇒ 无织纹面）', () => {
    const capDiv = iosCaptureDivDefault()
    const outDiv = iosOutScaleDivisor()
    // scale 在两侧同倍约掉 ⇒ 倍率 = capDiv / outDiv
    const ratio = capDiv / outDiv
    expect(
      ratio,
      `iOS 默认倍率 ${ratio.toFixed(2)}x（captureDiv=${capDiv} / outDiv=${outDiv}）；` +
        `应为 1.00x。放大 >1 会引入织纹（Android #1013 已否决 2.00x），<1 则白抓像素`,
    ).toBeCloseTo(1, 6)
  })

  it('★注释里不得再写「与 Android DIV=2 同口径」这类错误对齐（数字层面不成立）', () => {
    const s = read(IOS_GLASS)
    // 旧的错误表述必须已清除（允许在"纠正记录"里出现，但不得作为当前结论）
    const badClaim = /与 Android DIV=2 \/ 鸿蒙 S=2 同口径/
    expect(badClaim.test(s), 'iOS 玻璃注释仍保留"与 Android DIV=2 同口径"的错误说法').toBe(false)
    // 必须写明"有效放大倍率才是判据"
    expect(s).toMatch(/有效放大倍率/)
  })

  it('★Android 的 DIV 必须是 1（#1013 的结论：全分辨率，2 会产生织纹）', () => {
    const s = read('hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/GlassBackdrop.java')
    expect(s, 'Android 玻璃 DIV 不是 1 —— #1013 明确否决了 DIV=2（网格状织纹）').toMatch(/final int DIV = 1;/)
  })

  it('★鸿蒙默认不开启 glassS 调参（默认全分辨率 ⇒ 1:1）', () => {
    const s = read('hosts/harmony/host-app/entry/src/main/ets/shell/EntryAbility.ets')
    // 只在显式传参时才写入 AppStorage ⇒ 默认空 ⇒ 不调参
    expect(s).toMatch(/proteusGlassS/)
    expect(s).toMatch(/typeof gs === 'string' \? gs :/)
  })

  it('取证开关 `PROTEUS_GLASS_CAPTURE_DIV` 仍在（可手动试，但默认必须是 1:1 配置）', () => {
    expect(read(IOS_SCENE)).toMatch(/PROTEUS_GLASS_CAPTURE_DIV/)
  })
})
