// tests/vue-compat-coverage.test.ts
// ★2026-09-09 全集覆盖门禁（真机复测发现的命名错配收口）：
//   背景——矩阵 template 组按模板形态登记（<teleport>），开发者按 Vue 官方写 PascalCase 导入（Teleport）
//   → 落 UNKNOWN 报「可能为内部导出」= 同一能力矛盾结论。修法：别名表 + 内部导出集合 + 用户可见 API 补登。
//   本测试锁三件事：① 别名解析与已登记项状态一致；② Vue 运行时导出全集零未覆盖（新增导出即红——
//   强制分类为「矩阵登记 / 别名 / 内部集合」之一，杜绝静默落 UNKNOWN）；③ 内部集合与矩阵不重复。
import { describe, it, expect } from 'vitest'
import * as vue from 'vue'
import {
  VUE_COMPAT_MATRIX,
  VUE_COMPAT_ALIASES,
  VUE_INTERNAL_EXPORTS,
  VUE_COMPAT_UNKNOWN,
  VUE_COMPAT_INTERNAL,
  vueCompatStatus,
  vueCompatLevel,
} from '../packages/compiler/src/vue-compat'

describe('Vue 全能力基准线：全集覆盖门禁', () => {
  it('别名表目标必须已登记（防止别名指向不存在的项）', () => {
    const names = new Set(VUE_COMPAT_MATRIX.map((e) => e.name))
    for (const [alias, target] of Object.entries(VUE_COMPAT_ALIASES)) {
      expect(names.has(target), `别名 ${alias} → ${target} 未在矩阵登记`).toBe(true)
    }
  })

  it('PascalCase 组件导入与模板形态状态一致（命名错配回归锁）', () => {
    // Teleport 是 aligned（<teleport> → root-portal）——此前误报 unsupported error
    expect(vueCompatStatus('Teleport').status).toBe('aligned')
    expect(vueCompatStatus('Teleport').name).toBe('<teleport>')
    expect(vueCompatLevel(vueCompatStatus('Teleport'))).toBe('none')
    // KeepAlive/Suspense/TransitionGroup 与各自模板形态同状态
    for (const [alias, target] of Object.entries(VUE_COMPAT_ALIASES)) {
      expect(vueCompatStatus(alias).status, `${alias} 应与 ${target} 同状态`).toBe(vueCompatStatus(target).status)
    }
  })

  it('Vue 运行时导出全集零未覆盖（矩阵 ∪ 别名 ∪ 内部集合 = 全部导出）', () => {
    const registered = new Set(VUE_COMPAT_MATRIX.map((e) => e.name))
    const aliasKeys = new Set(Object.keys(VUE_COMPAT_ALIASES))
    // ★2026-09-12：只收「合法标识符」键——命名导出必然是标识符，含 `.` 的键不可能是命名导出。
    //   修 CJS interop 噪音：vitest 下 `import * as vue` 的命名空间会带 `module.exports`（Node CJS 互操作产物，
    //   真实 ESM/浏览器构建无此键）；原 `/^[a-zA-Z_$]/` 只查首字符 → 误纳入。收严为完整标识符即自然排除。
    const exported = Object.keys(vue).filter((k) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k))
    // 防测试自身退化：过滤收紧后仍须收到足量真实导出（Vue 3.5 命名导出 160+）
    expect(exported.length, '导出枚举过少——过滤逻辑可能误吞真实导出').toBeGreaterThan(150)
    const uncovered = exported.filter((k) => !registered.has(k) && !aliasKeys.has(k) && !VUE_INTERNAL_EXPORTS.has(k))
    expect(
      uncovered,
      `以下 Vue 导出未分类（须加入矩阵 / 别名 / VUE_INTERNAL_EXPORTS 之一）：${uncovered.join(', ')}`,
    ).toEqual([])
  })

  it('内部导出集合与矩阵/别名不重叠（分类互斥）', () => {
    const names = new Set(VUE_COMPAT_MATRIX.map((e) => e.name))
    for (const k of VUE_INTERNAL_EXPORTS) {
      expect(names.has(k), `${k} 同时在矩阵与内部集合（应二选一）`).toBe(false)
      expect(VUE_COMPAT_ALIASES[k], `${k} 同时在别名表与内部集合`).toBeUndefined()
    }
  })

  it('内部导出返回准确说明（非模糊兜底），且仍 fail-closed（error）', () => {
    const e = vueCompatStatus('createBlock')
    expect(e.name).toBe('createBlock') // 保留原名便于定位
    expect(e.status).toBe('unsupported')
    expect(e.note).toBe(VUE_COMPAT_INTERNAL.note)
    expect(e.note).not.toContain('可能为 Vue 内部导出') // 不再是模糊兜底
    expect(vueCompatLevel(e)).toBe('error')
  })

  it('用户可见 API 已显式登记（带替代建议，非落 UNKNOWN）', () => {
    for (const n of ['defineAsyncComponent', 'useCssModule', 'useCssVars', 'defineCustomElement', 'createSSRApp']) {
      const e = vueCompatStatus(n)
      expect(e.name, `${n} 应显式登记`).toBe(n)
      expect(e.name).not.toBe(VUE_COMPAT_UNKNOWN.name)
      expect(e.note, `${n} 应带替代建议`).toBeTruthy()
    }
  })

  it('真正未知标识符仍落 UNKNOWN 兜底（反黑盒不放松）', () => {
    const e = vueCompatStatus('someVueThingThatDoesNotExist')
    expect(e.name).toBe(VUE_COMPAT_UNKNOWN.name)
    expect(vueCompatLevel(e)).toBe('error')
  })
})
