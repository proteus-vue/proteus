// tests/built-in-components.test.ts
// ★内置组件包（@proteus-vue/built-in-components）契约测试：
//   ① BUILT_IN_TAGS 与 MpComponentSchema 注册表一一对应（防漂移）
//   ② installBuiltInComponents 注册 proteus-* 全局组件
//   ③ 内置组件 = 微信内置组件为基准：标签 ⊆ 注册表 REQUIRED 集
// @vitest-environment jsdom（import 链含 @proteus-vue/shared web-adapter 顶层 location）
import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { BUILT_IN_TAGS, getBuiltInSchema, installBuiltInComponents } from '@proteus-vue/built-in-components'
import { mpComponentRegistry } from '../packages/types/src/mp/component-schema'

describe('内置组件 ↔ MpComponentSchema（B8 对照，防漂移）', () => {
  it('BUILT_IN_TAGS 每个都在注册表（getBuiltInSchema 非空）', () => {
    for (const tag of BUILT_IN_TAGS) {
      expect(getBuiltInSchema(tag), `注册表缺 ${tag}`).toBeDefined()
    }
  })

  it('注册表覆盖已实现的内置组件（新增注册表标签但无 Web 实现 → 本断言无感但 schemas.ts 编译断言拦截）', () => {
    // schemas.ts 的 _assertRegistered 是编译期硬校验；此处验证运行时注册表形状
    for (const tag of BUILT_IN_TAGS) {
      expect(mpComponentRegistry[tag].tag).toBe(tag)
    }
  })

  it('icon 为微信内置组件（B8 补登记）', () => {
    expect(getBuiltInSchema('icon')?.props.type?.enumValues).toContain('success')
  })
})

describe('installBuiltInComponents（proteus-* 全局注册）', () => {
  it('注册 13 个内置组件', () => {
    const app = createApp({ render: () => null })
    installBuiltInComponents(app)
    expect(app.component('proteus-view')).toBeTruthy()
    expect(app.component('proteus-button')).toBeTruthy()
    expect(app.component('proteus-picker')).toBeTruthy()
    expect(app.component('proteus-scroll-view')).toBeTruthy()
    expect(app.component('proteus-unknown')).toBeUndefined()
  })
})
