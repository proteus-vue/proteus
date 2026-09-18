// tests/p-batch3-contract.test.ts
// ★端对齐批次 3（宿主能力）契约回归锁（2026-09-16 SOP v2）：
//   覆盖 p-media(video) / p-map / p-camera / p-canvas / p-webview / p-ad / p-rich-text / p-draggable(movable-view)。
//   每条锁对应一个真实能力点或踩坑；破坏性验证思路写在断言注释里。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

/** 去掉注释（注释里会提到被禁的写法，不算违规）：HTML 注释 + 块注释 + 行注释 */
const strip = (s: string) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const compile = (dir: string) => {
  const src = read(`packages/components/${dir}/index.vue`)
  return { src, ...compileVueSfc(src, { isComponent: true, filename: `packages/components/${dir}/index.vue` }) }
}

describe('★批次3 · 官方属性透传到原生标签（能力面）', () => {
  // 破坏性验证：删掉任一 prop 或模板绑定 → 对应断言应变红。

  it('p-media（video）：官方声明显隐族与播放控制透传原生 video', () => {
    const { src, wxml } = compile('p-media')
    for (const p of ['duration', 'controls', 'autoplay', 'loop', 'muted', 'initialTime', 'objectFit', 'poster', 'title']) {
      expect(src, `应有 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
    expect(wxml).toContain('initial-time="{{initialTime}}"')
    expect(wxml).toContain('object-fit="{{objectFit}}"')
    expect(wxml).toContain('show-center-play-btn="{{showCenterPlayBtn}}"')
    expect(wxml).toContain('vslide-gesture-in-fullscreen="{{vslideGestureInFullscreen}}"')
  })

  it('p-media：kind 决定元素（image/video/audio 显式分支，MP 不支持动态标签）', () => {
    const { wxml } = compile('p-media')
    expect(wxml).toContain('<image')
    expect(wxml).toContain('<video')
    expect(wxml).toContain('<audio')
    // ★破坏性：kind 若无分支（单动态标签）→ 上面三个断言必有一个失败
  })

  it('p-media：DRM / 画中画族透传（官方长尾能力不遗漏）', () => {
    const { wxml } = compile('p-media')
    for (const a of ['is-drm="{{isDrm}}"', 'provision-url="{{provisionUrl}}"', 'certificate-url="{{certificateUrl}}"', 'license-url="{{licenseUrl}}"', 'picture-in-picture-mode="{{pictureInPictureMode}}"', 'preferred-peak-bit-rate="{{preferredPeakBitRate}}"']) {
      expect(wxml, `应透传 ${a}`).toContain(a)
    }
  })

  it('p-map：缩放/图层/交互族全量透传原生 map', () => {
    const { wxml } = compile('p-map')
    for (const a of ['min-scale="{{minScale}}"', 'max-scale="{{maxScale}}"', 'include-points="{{includePoints}}"', 'polygons="{{polygons}}"', 'layer-style="{{layerStyle}}"', 'enable-auto-max-overlooking="{{enableAutoMaxOverlooking}}"', 'enable-building="{{enableBuilding}}"', 'setting="{{setting}}"']) {
      expect(wxml, `应透传 ${a}`).toContain(a)
    }
  })

  it('p-map：图层子对象字段不上升为组件属性（标尺精度——map 官方仅 29 项非 47）', () => {
    const { src } = compile('p-map')
    // marker 子对象字段（id/title/callout/anchor…）不应出现在 defineProps（它们属于 markers 数组元素）
    for (const bogus of ['callout', 'anchor', 'collision', 'ariaLabel']) {
      expect(src, `不应把 marker 子字段 ${bogus} 声明为组件 prop`).not.toMatch(new RegExp(`^\\s{2}${bogus}:\\s*\\{`, 'm'))
    }
    // ★破坏性：若把 marker 字段当属性加入 → 断言变红
  })

  it('p-camera：mode/resolution/frame-size 透传 + 事件契约', () => {
    const { src, wxml } = compile('p-camera')
    expect(wxml).toContain('mode="{{mode}}"')
    expect(wxml).toContain('resolution="{{resolution}}"')
    expect(wxml).toContain('frame-size="{{frameSize}}"')
    // ★事件名与官方 bind:<name> 对齐（stop / scancode / initdone）
    for (const e of ['stop', 'scancode', 'initdone']) {
      expect(src, `应监听 ${e}`).toMatch(new RegExp(`@${e}=`))
    }
  })

  it('p-canvas：canvas-id / disable-scroll 透传；engine 语义等价官方 type', () => {
    const { src, wxml } = compile('p-canvas')
    expect(wxml).toContain('canvas-id="{{resolvedId}}"')
    expect(wxml).toContain('disable-scroll="{{disableScroll}}"')
    // engine=webgl → 原生 type=webgl；skia 非原生类型 → 回落 2d（诚实映射）
    expect(src).toContain("props.engine === 'webgl' ? 'webgl' : '2d'")
  })

  it('p-ad：ad-theme 透传（官方四属性齐全）', () => {
    const { wxml } = compile('p-ad')
    expect(wxml).toContain('ad-theme="{{adTheme}}"')
    expect(wxml).toContain('ad-intervals="{{adIntervals}}"')
    expect(wxml).toContain('ad-type="{{adType}}"')
    expect(wxml).toContain('unit-id="{{unitId}}"')
  })

  it('p-webview：load 事件与 message/error 同契约', () => {
    const { src, wxml } = compile('p-webview')
    // Vue 的 @load 编译为小程序 bind:load（事件名与官方一致）
    expect(wxml).toContain('bind:load=')
    expect(src).toMatch(/defineEmits\(\['message', 'load', 'error'\]\)/)
  })

  it('p-rich-text：官方四属性透传原生 rich-text，source 为 nodes 别名', () => {
    const { src, wxml } = compile('p-rich-text')
    expect(wxml).toContain('nodes="{{nodes}}"')
    expect(wxml).toContain('user-select="{{userSelect}}"')
    expect(wxml).toContain('space="{{space}}"')
    expect(src).toContain('source')
  })

  it('p-draggable：movable-view 官方 13 属性 + movable-area scale-area 透传', () => {
    const { src, wxml } = compile('p-draggable')
    for (const a of ['direction="{{direction}}"', 'inertia="{{inertia}}"', 'out-of-bounds="{{outOfBounds}}"', 'damping="{{damping}}"', 'friction="{{friction}}"', 'scale="{{scaleEnabled}}"', 'scale-min="{{scaleMin}}"', 'scale-max="{{scaleMax}}"', 'scale-value="{{scaleValue}}"', 'animation="{{animation}}"']) {
      expect(wxml, `应透传 ${a}`).toContain(a)
    }
    // ★scale-area 在 movable-area 上（不是在 movable-view）
    expect(wxml).toContain('scale-area="{{scaleArea}}"')
    // ★破坏性：把 scale-area 绑到 movable-view → 上面的 area 断言仍过但语义错误，故另断言标签位置
    expect(wxml).toMatch(/<movable-area[^>]*scale-area/)
  })
})

describe('★批次3 · 双端降级与诚实边界', () => {
  it('★宿主组件用 computed(() => isMpRuntime())——直调会成为实例属性，模板读不到（真机踩坑）', () => {
    for (const dir of ['p-media', 'p-map', 'p-camera', 'p-canvas', 'p-ad', 'p-rich-text', 'p-draggable']) {
      const { src } = compile(dir)
      expect(src, `${dir} 应以 computed 包裹 isMpRuntime()`).toContain('computed(() => isMpRuntime())')
      expect(src, `${dir} 不应直调 isMpRuntime() 赋给非 computed 变量`).not.toMatch(/const isMp = isMpRuntime\(\)/)
    }
  })

  it('★Web 端无对等能力处不伪造：p-ad 明确标注占位、p-map 标注宿主需接 SDK', () => {
    expect(compile('p-ad').src, 'p-ad Web 端应为占位并标注').toMatch(/占位|placeholder/i)
    expect(compile('p-map').src, 'p-map Web 端应说明宿主接入 SDK').toMatch(/宿主/)
  })

  it('★p-draggable MP 端不再静默静态（本轮由 Web-only 升级为双端）', () => {
    const { src, wxml } = compile('p-draggable')
    // 此前 MP 端 capabilityWarnOnce('元素静态') —— 本轮对齐后应改为原生 movable 承接
    // （注释中提及历史写法不算违规 → 先剥注释）
    expect(strip(src), '不应再有「元素静态」静默降级告警').not.toContain('元素静态')
    expect(wxml).toContain('<movable-area')
    expect(wxml).toContain('<movable-view')
  })
})
