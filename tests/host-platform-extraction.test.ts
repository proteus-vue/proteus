// tests/host-platform-extraction.test.ts —— ★★HA0.5（B5-1）Android 平台适配抽取的**结构契约**门禁（无设备）
//
// 【它锁什么（为什么需要）】把 Android 的字形/度量从 `hosts/`（宿主集成）抽到 `platform/`（平台适配），
//   是"换壳不改"的前提（Host ABI §0.4.8）。抽取后若有人**把实现又内联回宿主**（或把平台层掏空回退），
//   分层就静默塌了——编译照过、`check:platform-layering` 只查**依赖方向**（import），查不到"实现是否移回"。
//   ⇒ 本测试从**源码结构**层面钉住：平台层**必须有**那些实现；宿主**必须只做委托**。
//
// 【为什么不是设备/编译测试】度量/字形的**值正确性**由真机（vapor/superapp 渲染 + 截图）守；本测试守的是
//   **结构不漂移**（谁拥有实现）——两者互补。
//
// 【注释豁免】文档里会**引用**被抽走的实现形态（如类型映射表写 `Typeface.create(...)`），那些是解释、
//   不是代码 ⇒ 断言前先剥注释（否则注释会假阳性）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
/** 剥 Java 块注释与行注释（结构断言只看**代码**形态） */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PLATFORM = 'platform/android/proteus-platform/src/dev/proteus/platform/ProteusTextPlatform.java'
const HOST_VIEW = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/ProteusHostView.java'
const VAPOR_HOST = 'hosts/android/app/src/main/java/dev/proteus/layoutcore/runtime/VaporRenderHost.java'
// ★HA0.5（鸿蒙腿）
const H_PLATFORM = 'platform/harmony/proteus-platform/src/main/cpp/proteus_text_platform.h'
const H_HELPERS = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host_helpers.h'
const H_HOST = 'hosts/harmony/host-app/proteus_render/src/main/cpp/proteus_host.cpp'

describe('★HA0.5 · B5-1 · Android 平台适配抽取（结构契约）', () => {
  it('平台层存在且拥有字形 + 度量的实现（android.graphics/android.text）', () => {
    expect(fs.existsSync(path.join(ROOT, PLATFORM)), `缺 ${PLATFORM}`).toBe(true)
    const src = read(PLATFORM)
    // 字形（第 1 步）
    for (const m of ['typefaceOf', 'registerFont', 'clearFonts', 'CUSTOM_FONT_PREFIX']) {
      expect(src, `ProteusTextPlatform 缺 ${m}`).toContain(m)
    }
    // 度量（第 2 步）
    for (const m of ['measureSingle', 'measureWrapped', 'applyWordBreak', 'isUnbreakableToken', 'lineHeightPx']) {
      expect(src, `ProteusTextPlatform 缺 ${m}`).toContain(m)
    }
    // 真平台 API（不是空壳/纯逻辑）
    expect(src).toMatch(/android\.graphics\.Typeface/)
    expect(src).toMatch(/android\.text\.TextPaint|android\.text\.StaticLayout/)
  })

  it('宿主（ProteusHostView）字形层只做**委托** —— 代码里不再自持 Typeface 构造/注册表实现', () => {
    const src = code(read(HOST_VIEW))
    expect(src, 'ProteusHostView 应委托 ProteusTextPlatform.typefaceOf').toContain('ProteusTextPlatform.typefaceOf')
    // 抽取前宿主直接构造 Typeface；抽取后**代码**里应消失（文档表格里的提及已被剥注释豁免）
    expect(src, '宿主代码不应再直接 Typeface.create（应经平台层）').not.toMatch(/Typeface\.create\(/)
    expect(src, '宿主代码不应再自持字体注册表字段').not.toMatch(/\bcustomFonts\b/)
  })

  it('鸿蒙：平台层（proteus_text_platform.h）拥有文本度量/字体，helpers 只 include 不重实现', () => {
    expect(fs.existsSync(path.join(ROOT, H_PLATFORM)), '缺 ' + H_PLATFORM).toBe(true)
    const plat = read(H_PLATFORM)
    for (const m of ['measureTextTypoPx', 'measureTextWrappedTypoPx', 'applyTextFont', 'lineHeightDesignPx']) {
      expect(plat, 'proteus_text_platform.h 缺 ' + m).toContain(m)
    }
    expect(plat, '平台层应含鸿蒙特征 API').toMatch(/OH_Drawing_/)
    // helpers（宿主侧）**不得再定义**这 4 个函数（只 include 平台头）
    const helpers = code(read(H_HELPERS))
    expect(helpers, 'helpers 应 include 平台头').toContain('proteus_text_platform.h')
    for (const m of ['static inline void measureTextTypoPx', 'static inline void measureTextWrappedTypoPx',
                     'static inline void applyTextFont', 'static inline double lineHeightDesignPx']) {
      expect(helpers, 'helpers 不应再定义 ' + m).not.toContain(m)
    }
    // host 宿主集成仍照常调用平台层的度量（include helpers → 传递平台头）
    expect(read(H_HOST)).toContain('measureTextTypoPx')
  })

  it('度量（VaporRenderHost）走平台层 —— 单行/折行度量都委托', () => {
    const src = read(VAPOR_HOST)
    expect(src).toContain('ProteusTextPlatform.measureSingle')
    expect(src).toContain('ProteusTextPlatform.measureWrapped')
    expect(src).toContain('ProteusTextPlatform.applyWordBreak')
    expect(src).toContain('ProteusTextPlatform.isUnbreakableToken')
    // ★诚实边界：绘制执行（mkCmd/StaticLayout）**仍在宿主**（绘制载体是平台 View）——本测试**不**要求它离开，
    //   只要求"度量"这条（buildMeasures/applyWrapRemeasure 的度量逻辑）委托到平台层。
  })
})
