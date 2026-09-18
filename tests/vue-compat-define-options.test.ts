// tests/vue-compat-define-options.test.ts
// ★2026-09-08 defineOptions 对齐：compileScript 权威语义（name/inheritAttrs）——剥离 no-op（不裸注入 onLoad→not defined），
//   name/inheritAttrs MP 无组件级对等 → partial（诚实说明，非 error fail-closed）。
import { describe, it, expect } from 'vitest'
import { extractSfcMacros } from '../packages/compiler/src/sfc-macros'
import { compileVueSfc } from '../packages/compiler/src/index'

describe('defineOptions 对齐（compileScript 权威源）', () => {
  it('extractSfcMacros 提取 name/inheritAttrs', () => {
    const m = extractSfcMacros('<script setup lang="ts">\ndefineOptions({ name: \'MyComp\', inheritAttrs: false })\n</script>', 'x.vue')
    expect(m.ok).toBe(true)
    expect(m.defineOptions.name).toBe('MyComp')
    expect(m.defineOptions.inheritAttrs).toBe(false)
  })

  it('defineOptions 被剥离 no-op（不裸注入 onLoad）+ 警告说明', () => {
    const r = compileVueSfc('<script setup lang="ts">\ndefineOptions({ name: \'MyComp\', inheritAttrs: false })\nconst a = ref(1)\n</script>\n<template><view>{{ a }}</view></template>', { filename: 'pages/x.vue' }) as any
    expect(r.js).not.toMatch(/defineOptions\s*\(/)
    expect(r.js).toMatch(/data:\s*\{\s*a:\s*1/)
    expect(r.warnings.some((w: string) => /defineOptions/.test(w))).toBe(true)
  })

  it('无 defineOptions 的组件不告警', () => {
    const r = compileVueSfc('<script setup lang="ts">\nconst a = ref(1)\n</script>\n<template><view>{{ a }}</view></template>', { filename: 'pages/y.vue' }) as any
    expect(r.warnings.some((w: string) => /defineOptions/.test(w))).toBe(false)
  })
})
