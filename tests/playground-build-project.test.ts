// @vitest-environment happy-dom
// tests/playground-build-project.test.ts —— ★决策 #700：Playground 多文件项目构建管线（纯函数）
import { describe, it, expect } from 'vitest'
import { resolveModulePath, rewriteModuleSpecifiers, compileVueToEsm, normalizeWebEvents } from '../website/src/playground/build-project'
import { singleFileProject, encodeProject, decodeProject, demoProject } from '../website/src/playground/project'

describe('★#700 Playground 多文件：相对模块解析', () => {
  const files = { 'App.vue': {}, 'components/Counter.vue': {}, 'lib/util.js': {}, 'lib/index.js': {} }
  it('相对路径按候选顺序解析（省略/带扩展名/index）', () => {
    expect(resolveModulePath('./components/Counter.vue', 'App.vue', files)).toBe('components/Counter.vue')
    expect(resolveModulePath('./components/Counter', 'App.vue', files)).toBe('components/Counter.vue')
    expect(resolveModulePath('./lib/util', 'App.vue', files)).toBe('lib/util.js')
    expect(resolveModulePath('./lib', 'App.vue', files)).toBe('lib/index.js')
  })
  it('子目录内相对解析（../ 归一）', () => {
    expect(resolveModulePath('../App.vue', 'components/Counter.vue', files)).toBe('App.vue')
  })
  it('非相对（vue / 裸包名 / URL）⇒ null（交给 CDN/宿主 shim）', () => {
    expect(resolveModulePath('vue', 'App.vue', files)).toBeNull()
    expect(resolveModulePath('nanoid', 'App.vue', files)).toBeNull()
    expect(resolveModulePath('https://esm.sh/x', 'App.vue', files)).toBeNull()
  })
})

describe('★#700 说明符改写', () => {
  it('改写 import/export … from 的说明符（保留语句）', () => {
    const src = `import { ref } from 'vue'\nimport A from './A.vue'\nexport { x } from './x.js'\n`
    const out = rewriteModuleSpecifiers(src, (s) => (s === 'vue' ? 'blob:vue' : 'blob:' + s))
    expect(out).toContain("from \"blob:vue\"")
    expect(out).toContain("from \"blob:./A.vue\"")
    expect(out).toContain("from \"blob:./x.js\"")
  })
})

describe('★#700 .vue → ESM', () => {
  it('script setup + scoped ⇒ ESM 含 __scopeId + 默认导出 + scoped CSS', () => {
    const src = `<script setup>
import { ref } from 'vue'
const n = ref(0)
</script>
<template><p-text>{{ n }}</p-text></template>
<style scoped>.a { color: red; }</style>`
    const r = compileVueToEsm('App.vue', src, 'pgabc')
    expect(r.esm).toContain('export default')
    expect(r.esm).toContain('__scopeId')
    expect(r.css).toContain('.a')
  })
  it('缺 <template> ⇒ 报错', () => {
    expect(() => compileVueToEsm('X.vue', '<script setup>const a=1</script>', 'id')).toThrow(/template/)
  })
})

describe('★#700 Web 事件归一（@tap → @click）', () => {
  it('@tap 归一为 @click（含修饰符/参数），v-on:tap 同', () => {
    expect(normalizeWebEvents('<p-button @tap="go">x</p-button>')).toContain('@click="go"')
    expect(normalizeWebEvents('<p-button @tap.stop="go">x</p-button>')).toContain('@click.stop="go"')
    expect(normalizeWebEvents('<p-button v-on:tap="go">x</p-button>')).toContain('v-on:click="go"')
  })
  it('不误伤 @tapX / 文本里的 tap', () => {
    expect(normalizeWebEvents('<x @tapx="a">tap</x>')).toContain('@tapx="a"')
    expect(normalizeWebEvents('<p-text>请 tap 这里</p-text>')).toBe('<p-text>请 tap 这里</p-text>')
  })
  it('compileVueToEsm 对模板施加归一（@tap 组件事件 ⇒ 编译产物含 onClick）', () => {
    const src = `<template><p-button @tap="go">x</p-button></template>`
    const r = compileVueToEsm('X.vue', src, 'id')
    // @click 编译为 onClick（@tap 未归一则会变成无意义的 onTap）
    expect(r.esm).toContain('onClick')
    expect(r.esm).not.toContain('onTap')
  })
  it('★script setup 路径也归一（真实 demo 形态：@tap ⇒ onClick）', () => {
    const src = `<script setup>
import { ref } from 'vue'
const n = ref(0)
function bump() { n.value++ }
</script>
<template><p-stack><p-button @tap="bump">+1</p-button></p-stack></template>`
    const r = compileVueToEsm('Counter.vue', src, 'id2')
    expect(r.esm, 'script setup 路径应含 onClick').toContain('onClick')
    expect(r.esm, 'script setup 路径不应含 onTap').not.toContain('onTap')
  })
})

describe('★#700 项目编解码（分享）', () => {
  it('多文件项目 encode→decode 往返一致', () => {
    const p = demoProject(false)
    const back = decodeProject(encodeProject(p))
    expect(back?.entry).toBe(p.entry)
    expect(Object.keys(back!.files).sort()).toEqual(Object.keys(p.files).sort())
  })
  it('单文件回退仍成立', () => {
    const p = singleFileProject('<template><p-text>x</p-text></template>')
    expect(p.entry).toBe('App.vue')
    expect(Object.keys(p.files)).toEqual(['App.vue'])
  })
  it('非法分享串 ⇒ null', () => {
    expect(decodeProject('not-a-valid-blob')).toBeNull()
  })
})
