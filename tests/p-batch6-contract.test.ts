// tests/p-batch6-contract.test.ts
// ★端对齐「批次外收口」契约回归锁（2026-09-18）：
//   覆盖批次外剩余 5 组件的实际处置——p-input（+14 官方透传）/ p-form（+2 formId 宿主）/
//   p-list-view（+1 官方 padding 数组）/ 以及 p-adaptive(p-transition 两处**映射修正**而非补属性）。
//   每条锁对应一个真实能力点或本轮踩坑；破坏性验证思路写在断言注释里。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { compileVueSfc } from '@proteus-vue/compiler'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8')
const compile = (dir: string) => {
  const src = read(`packages/components/${dir}/index.vue`)
  return { src, ...compileVueSfc(src, { isComponent: true, filename: `packages/components/${dir}/index.vue` }) }
}

describe('★批次外收口 · p-input（+14 官方 <input> 透传）', () => {
  // 破坏性验证：删任一 prop 声明或模板绑定 → 对应断言变红。
  const KEYBOARD = ['alwaysEmbed', 'confirmHold', 'adjustPosition', 'holdKeyboard']
  const CARET = ['cursorColor', 'selectionStart', 'selectionEnd']
  const SAFE = [
    'safePasswordCertPath', 'safePasswordLength', 'safePasswordTimeStamp',
    'safePasswordNonce', 'safePasswordSalt', 'safePasswordCustomHash',
  ]

  it('声明：键盘/同层族 + 光标选区族 + 安全键盘族 + placeholderClass 全部登记', () => {
    const { src } = compile('p-input')
    for (const p of [...KEYBOARD, ...CARET, ...SAFE, 'placeholderClass']) {
      expect(src, `应声明 ${p}`).toMatch(new RegExp(`${p}:\\s*\\{\\s*type:`))
    }
  })

  it('模板：全部以 kebab-case 绑定到原生 input（★T2 多词属性 kebab 通道）', () => {
    const { wxml } = compile('p-input')
    const binds: Record<string, string> = {
      alwaysEmbed: 'always-embed', confirmHold: 'confirm-hold', adjustPosition: 'adjust-position',
      holdKeyboard: 'hold-keyboard', cursorColor: 'cursor-color', selectionStart: 'selection-start',
      selectionEnd: 'selection-end', placeholderClass: 'placeholder-class',
      safePasswordCertPath: 'safe-password-cert-path', safePasswordLength: 'safe-password-length',
      safePasswordTimeStamp: 'safe-password-time-stamp', safePasswordNonce: 'safe-password-nonce',
      safePasswordSalt: 'safe-password-salt', safePasswordCustomHash: 'safe-password-custom-hash',
    }
    for (const [prop, kebab] of Object.entries(binds)) {
      expect(wxml, `${prop} 应绑定为 ${kebab}="{{${prop}}}"`).toContain(`${kebab}="{{${prop}}}"`)
    }
  })

  it('MP 安全：新增 props 不引入平台 API/浏览器对象（组件库门禁同源）', () => {
    const { src } = compile('p-input')
    const body = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(body).not.toMatch(/\bwindow\.|\bdocument\.|\bnavigator\./)
  })
})

describe('★批次外收口 · p-form（+2 formId 宿主属性）', () => {
  it('声明 + 模板绑定 report-submit 族（小程序模板消息能力）', () => {
    const { src, wxml } = compile('p-form')
    expect(src).toMatch(/reportSubmit:\s*\{\s*type:\s*Boolean/)
    expect(src).toMatch(/reportSubmitTimeout:\s*\{\s*type:\s*Number/)
    expect(wxml).toContain('report-submit="{{reportSubmit}}"')
    expect(wxml).toContain('report-submit-timeout="{{reportSubmitTimeout}}"')
  })
})

describe('★批次外收口 · p-list-view（+1 官方 padding 数组）', () => {
  it('声明 padding（4 元数组）+ 通过 computed 归一为 CSS padding 简写', () => {
    const { src } = compile('p-list-view')
    expect(src).toMatch(/padding:\s*\{\s*type:\s*Array/)
    // 官方语义：长度 4 按 top/right/bottom/left
    expect(src).toContain('style.padding')
  })

  it('★S38/T18：样式拼接走 computed，模板内不得出现函数调用', () => {
    const { wxml } = compile('p-list-view')
    // scroll-view 的 style 必须绑定到变量（而非模板内拼接）
    //   ★编译产物形态是 `style="{{scrollStyle}}"`（'v-bind:'/'：' 前缀在编译期已剥离）
    expect(wxml).toContain('style="{{scrollStyle}}"')
    // 模板表达式不得含函数调用（WXML 不支持）
    const interpolations = [...wxml.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1])
    for (const exp of interpolations) {
      expect(exp, `模板表达式含函数调用（S38）：${exp}`).not.toMatch(/[A-Za-z_$][\w$]*\s*\(/)
    }
  })

  it('padding 非 4 元时安全降级（不抛错、不产出非法样式）', () => {
    const { src } = compile('p-list-view')
    // 守卫条件：仅 length === 4 才拼接
    expect(src).toMatch(/length === 4/)
  })
})

/**
 * 审计脚本的**代码**文本（剥掉注释）——
 * ★本测试检查的是映射表代码本身；而脚本注释里**故意**记录了两处被移除的错误映射原文
 *   （作为修复说明），不去注释会自证命中。与 tests/p-batch3-contract.test.ts 的 strip 同源。
 */
const auditCode = () =>
  read('scripts/audit-component-attrs.mjs')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('★批次外收口 · 映射修正（p-adaptive / p-transition 不是「补属性」）', () => {
  it('审计脚本移除 swiper 错拼映射（p-swipter 不存在；swiper 已消灭为 layout.stack 属性）', () => {
    const audit = auditCode()
    expect(audit).not.toContain('p-swipter')
    expect(audit).not.toMatch(/'swiper':\s*'p-/)
  })

  it('审计脚本移除 share-element → p-transition 错映射（语义不同：共享元素转场 ≠ Vue transition）', () => {
    const audit = auditCode()
    expect(audit).not.toContain("'share-element'")
  })

  it('match-media 视口度量属性登记为「有意不沿用」（容器断点语义升级）', () => {
    const audit = auditCode()
    // 7 项视口度量均须有理由（反黑盒：不静默忽略）
    //   ★键可能带引号（'min-width'）或为裸标识符（width/min-width 中的合法名如 width/height/orientation）
    for (const p of ['min-width', 'max-width', 'width', 'min-height', 'max-height', 'height', 'orientation']) {
      const quoted = `'${p}':`
      const bare = new RegExp(`(^|[\\s{,])${p}\\s*:`)
      expect(
        audit.includes(quoted) || bare.test(audit),
        `match-media.${p} 应有有意不沿用理由`,
      ).toBe(true)
    }
    expect(audit).toContain("'match-media'")
  })
})
