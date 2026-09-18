// tests/platform-macros.test.ts
// ★平台编译期宏（条件显隐）回归锁（2026-09-13）：
//   命题：页面/组件内用**标准 Vue 条件渲染** + 构建期常量宏（__MP__/__WEB__/__TARGET__）实现
//   按平台显隐——编译期静态求值 → 死分支整块消除（产物纯净，无 #ifdef 式非标准语法）。
//
//   锁三件事（均可破坏性验证）：
//     ① 宏替换：__MP__/__WEB__/__TARGET__ → 该平台字面量（含词边界守卫，不误伤 MY__MP__X）
//     ② 静态裁剪：v-if/v-else 链中静态可求值的分支整块消除；v-if="__MP__" 在另一平台产物**完全不含**
//     ③ 运行时表达式不误裁：链上有变量支 → 整链保留（走原 wx:if 运行时判定）
import { describe, it, expect } from 'vitest'
import { compileVueSfc } from '@proteus-vue/compiler'
import { applyPlatformMacros, applyPlatformMacrosInSfc, platformDefines } from '../packages/compiler/src/platform-macros'

const SFC = `<template>
  <view class="wrap">
    <p-button v-if="__MP__" open-type="contact">客服</p-button>
    <view v-else>Web 端无 open-type</view>
    <view v-if="__TARGET__ === 'web'">仅 Web</view>
    <image v-if="__TARGET__ === 'mp'" src="/mp.png" />
    <view v-if="loading">运行时变量（不裁剪）</view>
  </view>
</template>
<script setup>
const isMp = __MP__
const target = __TARGET__
</script>`

describe('★平台编译期宏 applyPlatformMacros', () => {
  it('替换为对应平台字面量（mp / web / ios / android / harmony / native）', () => {
    expect(applyPlatformMacros('__MP__', 'mp')).toBe('true')
    expect(applyPlatformMacros('__MP__', 'web')).toBe('false')
    expect(applyPlatformMacros('__WEB__', 'web')).toBe('true')
    expect(applyPlatformMacros('__TARGET__', 'mp')).toBe("'mp'")
    expect(applyPlatformMacros('__TARGET__', 'web')).toBe("'web'")
    expect(applyPlatformMacros('__TARGET__', 'native')).toBe("'native'")
  })

  it('★细分 OS 宏：__IOS__/__ANDROID__/__HARMONY__ 各就各位 + __NATIVE__ 族', () => {
    expect(applyPlatformMacros('__IOS__', 'ios')).toBe('true')
    expect(applyPlatformMacros('__IOS__', 'android')).toBe('false')
    expect(applyPlatformMacros('__ANDROID__', 'android')).toBe('true')
    expect(applyPlatformMacros('__HARMONY__', 'harmony')).toBe('true')
    // 族宏：三端原生任一为 true
    expect(applyPlatformMacros('__NATIVE__', 'ios')).toBe('true')
    expect(applyPlatformMacros('__NATIVE__', 'android')).toBe('true')
    expect(applyPlatformMacros('__NATIVE__', 'harmony')).toBe('true')
    expect(applyPlatformMacros('__NATIVE__', 'web')).toBe('false')
    // __TARGET__ 精确到 OS
    expect(applyPlatformMacros('__TARGET__', 'ios')).toBe("'ios'")
    expect(applyPlatformMacros('__TARGET__', 'harmony')).toBe("'harmony'")
    // 具体平台构建下 __WEB__/__MP__ 均为 false
    expect(applyPlatformMacros('__WEB__', 'ios')).toBe('false')
    expect(applyPlatformMacros('__MP__', 'ios')).toBe('false')
  })

  it('词边界守卫：不误伤含 __MP__ 的长标识符', () => {
    expect(applyPlatformMacros('MY__MP__X', 'mp')).toBe('MY__MP__X')
    expect(applyPlatformMacros('a.__MP___b', 'mp')).toBe('a.__MP___b')
  })

  it('★code 模式跳过字符串/注释：代码示例字符串不被误改（实测事故：破坏引号结构）', () => {
    const code = `const s = '<p-button v-if="__MP__">客服</p-button>'  // __MP__ 说明\nconst x = __WEB__`
    const out = applyPlatformMacros(code, 'web', 'code')
    // 字符串内的宏**原样保留**（否则引号结构被破坏）
    expect(out).toContain(`'<p-button v-if="__MP__">客服</p-button>'`)
    expect(out).toContain('// __MP__ 说明')
    // 真正的代码标识符被替换
    expect(out).toContain('const x = true')
  })

  it('template 模式（默认）不跳过属性引号：v-if="__MP__" 必须替换', () => {
    const tpl = '<p-button v-if="__MP__" open-type="contact">客服</p-button>'
    expect(applyPlatformMacros(tpl, 'web')).toContain('v-if="false"')
    expect(applyPlatformMacros(tpl, 'mp')).toContain('v-if="true"')
  })

  it('applyPlatformMacrosInSfc：script 块 code 模式、template 块 template 模式', () => {
    const vue = `<template><view v-if="__MP__">M</view></template>\n<script setup>\nconst s = '<p v-if="__MP__">x</p>'\nconst t = __MP__\n</script>`
    const out = applyPlatformMacrosInSfc(vue, 'web')
    expect(out, 'template 内应替换').toContain('v-if="false"')
    expect(out, 'script 字符串内应保留').toContain(`'<p v-if="__MP__">x</p>'`)
    expect(out, 'script 代码应替换').toContain('const t = false')
  })

  it('platformDefines 产出与替换同源', () => {
    for (const p of ['mp', 'web', 'native'] as const) {
      const d = platformDefines(p)
      expect(d.__MP__).toBe(applyPlatformMacros('__MP__', p))
      expect(d.__WEB__).toBe(applyPlatformMacros('__WEB__', p))
      expect(d.__TARGET__).toBe(applyPlatformMacros('__TARGET__', p))
    }
  })
})

describe('★平台条件显隐·静态裁剪（编译产物）', () => {
  it('MP 构建：__MP__ 分支保留、__WEB__ 兄弟分支删除、Web-only 块消失', () => {
    const { wxml } = compileVueSfc(SFC, { filename: 'mac.vue', platform: 'mp' })
    expect(wxml, 'MP 分支应保留').toContain('open-type="contact"')
    expect(wxml, 'Web else 分支应被删除').not.toContain('Web 端无 open-type')
    expect(wxml, '仅 Web 块应消失').not.toContain('仅 Web')
    expect(wxml, '仅 MP 块应保留').toContain('/mp.png')
    // 运行时变量支必须保留（不误裁）
    expect(wxml).toContain('loading')
    // 死分支的同义文本不得残留
    expect(wxml).not.toContain('wx:else')
  })

  it('Web 构建：__MP__ 分支整块消失、__WEB__ 分支保留', () => {
    const { wxml } = compileVueSfc(SFC, { filename: 'mac.vue', platform: 'web' })
    expect(wxml, '__MP__ 分支应被删除').not.toContain('open-type="contact"')
    expect(wxml, 'else 分支应保留').toContain('Web 端无 open-type')
    expect(wxml).toContain('仅 Web')
    expect(wxml).not.toContain('/mp.png')
  })

  it('script：__MP__ / __TARGET__ 在脚本内替换为字面量', () => {
    const mp = compileVueSfc(SFC, { filename: 'mac.vue', platform: 'mp' })
    expect(mp.js).toMatch(/isMp:\s*true/)
    expect(mp.js, '__TARGET__ 应替换为 "mp"').toMatch(/target:\s*"mp"/)
    const web = compileVueSfc(SFC, { filename: 'mac.vue', platform: 'web' })
    expect(web.js).toMatch(/isMp:\s*false/)
    expect(web.js, '__TARGET__ 应替换为 "web"').toMatch(/target:\s*"web"/)
  })

  it('★死分支不产出任何残留（MP 产物无 Web 标识符；反向亦然）', () => {
    const mp = compileVueSfc(SFC, { filename: 'mac.vue', platform: 'mp' })
    expect(mp.wxml).not.toContain('__MP__')
    expect(mp.wxml).not.toContain('__WEB__')
    const web = compileVueSfc(SFC, { filename: 'mac.vue', platform: 'web' })
    expect(web.wxml).not.toContain('__MP__')
    expect(web.wxml).not.toContain('__TARGET__')
  })

  it('运行时变量链不被静态裁剪（保留运行时 wx:if 语义）', () => {
    const sfc = `<template><view><view v-if="a">A</view><view v-else-if="b">B</view><view v-else>C</view></view></template>`
    for (const p of ['mp', 'web'] as const) {
      const { wxml } = compileVueSfc(sfc, { filename: 'rt.vue', platform: p })
      expect(wxml).toContain('A')
      expect(wxml).toContain('B')
      expect(wxml).toContain('C')
      expect(wxml).toContain('wx:if="{{a}}"')
      expect(wxml).toContain('wx:elif="{{b}}"')
      expect(wxml).toContain('wx:else')
    }
  })

  it('★细分 OS 分支静态裁剪（ios 构建保留 __IOS__、删除 __ANDROID__/__MP__）', () => {
    const sfc = `<template><view><view v-if="__IOS__">iOS</view><view v-else-if="__ANDROID__">Android</view><view v-else>其它</view><view v-if="__NATIVE__">原生族</view></view></template>`
    const ios = compileVueSfc(sfc, { filename: 'os.vue', platform: 'ios' })
    expect(ios.wxml).toContain('iOS')
    expect(ios.wxml).not.toContain('Android')
    expect(ios.wxml).toContain('原生族')
    const android = compileVueSfc(sfc, { filename: 'os.vue', platform: 'android' })
    expect(android.wxml).not.toContain('>iOS<')
    expect(android.wxml).toContain('Android')
    const web = compileVueSfc(sfc, { filename: 'os.vue', platform: 'web' })
    expect(web.wxml).not.toContain('iOS')
    expect(web.wxml).not.toContain('Android')
    expect(web.wxml).toContain('其它')
    expect(web.wxml).not.toContain('原生族')
  })

  it('默认平台为 mp（不传 platform 时 __MP__ → true）', () => {
    const { wxml } = compileVueSfc('<template><view><view v-if="__MP__">M</view><view v-else>W</view></view></template>', { filename: 'd.vue' })
    expect(wxml).toContain('M')
    expect(wxml).not.toContain('>W<')
  })
})
