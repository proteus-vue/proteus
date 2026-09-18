// tests/types-mp.test.ts
// ★types-plus-plan B8：mp/ 子目录（MpComponentSchema 注册表 + MpSdkVersion 对齐）运行时单测
// 相对路径导入（不走 alias）：同时覆盖「消费方相对引用」场景；纯模块无官方依赖，根 vue-tsc 安全
import { describe, expect, it } from 'vitest'
import {
  getComponentSchema,
  mpComponentRegistry,
  registerComponentSchema,
  type MpComponentSchema,
} from '../packages/types/src/mp/component-schema'
import {
  DEFAULT_TYPINGS_VERSION,
  MP_SDK_VERSION_MAP,
  resolveTypingsVersion,
  validateMpSdkVersion,
} from '../packages/types/src/mp/sdk-version'

const REQUIRED = [
  'view',
  'text',
  'image',
  'button',
  'input',
  'textarea',
  'scroll-view',
  'picker',
  'switch',
  'slider',
  'progress',
  'navigator',
  'video',
  'rich-text',
  'checkbox',
  'radio',
  'form',
  'swiper',
  'canvas',
  'slot',
]

describe('MpComponentRegistry（B8 §9）', () => {
  it('内置注册表覆盖 Compiler TAG_MAP 发射标签 + 常用原生标签', () => {
    for (const tag of REQUIRED) {
      expect(mpComponentRegistry[tag], `缺少 ${tag} schema`).toBeDefined()
    }
  })

  it('每条 schema 携带 tag + props 表', () => {
    for (const schema of Object.values(mpComponentRegistry)) {
      expect(schema.tag).toBeTruthy()
      expect(Object.keys(schema.props).length).toBeGreaterThan(0)
    }
  })

  it('scroll-view 属性映射对齐 WXML 名（scroll-y / bindscrolltolower）', () => {
    const sv = mpComponentRegistry['scroll-view']
    expect(sv.props.scrollY).toMatchObject({ name: 'scroll-y', type: 'boolean' })
    expect(sv.props.onScrollToLower).toMatchObject({ name: 'bindscrolltolower', type: 'event' })
    expect(sv.proteusAlias).toBe('p-scroll-list')
  })

  it('button 变体属性（type/size/disabled/loading/plain 对齐 weui 变体体系）', () => {
    const btn = mpComponentRegistry['button']
    expect(btn.props.type?.enumValues).toContain('primary')
    expect(btn.props.size?.enumValues).toEqual(['default', 'mini'])
    expect(btn.props.disabled?.type).toBe('boolean')
    expect(btn.props.loading?.type).toBe('boolean')
    expect(btn.props.onTap?.name).toBe('bindtap')
  })

  it('getComponentSchema：已知返回 / 未知返回 undefined', () => {
    expect(getComponentSchema('swiper')?.tag).toBe('swiper')
    expect(getComponentSchema('not-a-tag')).toBeUndefined()
  })

  it('registerComponentSchema：业务/组件库扩展（§10 用户扩展入口）', () => {
    const custom: MpComponentSchema = {
      tag: 'custom-widget',
      props: { title: { name: 'title', type: 'string' } },
    }
    registerComponentSchema(custom)
    expect(getComponentSchema('custom-widget')?.props.title?.type).toBe('string')
  })
})

describe('MpSdkVersion（B8 §10）', () => {
  it('validateMpSdkVersion：合法 semver 通过 / 非法报错', () => {
    expect(validateMpSdkVersion({ libVersion: '3.0.0', typingsVersion: '5.2.3' })).toEqual([])
    expect(validateMpSdkVersion({ libVersion: 'abc', typingsVersion: '5.2.3' })[0]).toMatch(/libVersion/)
    expect(validateMpSdkVersion({ libVersion: '3.0.0', typingsVersion: '' })[0]).toMatch(/typingsVersion/)
  })

  it('resolveTypingsVersion：命中维护表 → 表值；未收录 → 默认 + mapped=false（透明化）', () => {
    const known = resolveTypingsVersion('3.0.0')
    expect(known).toMatchObject({ typingsVersion: MP_SDK_VERSION_MAP['3.0.0'], mapped: true })
    const unknown = resolveTypingsVersion('9.9.9')
    expect(unknown).toMatchObject({ typingsVersion: DEFAULT_TYPINGS_VERSION, mapped: false })
  })
})
