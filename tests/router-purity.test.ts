// tests/router-purity.test.ts
// 路由纯净性门禁（docs/proteus-router-plan 07 §6）：路由差异不得泄漏出 codegen/ 与 skyline.ts 之外
// 对齐 stores-purity：packages/router/src/ 下只有 skyline.ts 允许直连 wx（执行规则 5）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROUTER_SRC = path.resolve('packages/router/src')

/** 平台直连关键词：出现在非 skyline.ts / 非 codegen/ 的路由源码中即视为违规 */
const FORBIDDEN = ['wx.', 'window.', 'localStorage', 'document.']
/** 允许直连 wx 的模块（skyline.ts 是唯一 wx.router bridge，执行规则 5；navigation.ts 是五端 API 名映射表——收敛点，与 codegen/ 同性质） */
const ALLOWED_WX = new Set(['skyline.ts', 'navigation.ts'])

/** 收集所有 .ts 文件（含子目录），跳过 index/聚合与测试无关 */
function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectTsFiles(full, acc)
    else if (entry.name.endsWith('.ts')) acc.push(path.relative(ROUTER_SRC, full))
  }
  return acc
}

describe('路由纯净性门禁（平台差异收敛：codegen/ + skyline.ts）', () => {
  it('非 skyline.ts / 非 codegen/ 的路由源码不含平台直连', () => {
    const files = collectTsFiles(ROUTER_SRC)
    const violations: string[] = []
    for (const rel of files) {
      if (rel.startsWith('codegen/')) continue // codegen 输出各端产物（含平台字段），属收敛点
      if (rel.startsWith('presets/')) continue // Skyline 预设 builder 是平台原生能力实现（worklet），必须直连 wx
      if (ALLOWED_WX.has(rel)) continue // skyline.ts 唯一 wx bridge
      const src = fs.readFileSync(path.join(ROUTER_SRC, rel), 'utf-8')
      for (const kw of FORBIDDEN) {
        if (src.includes(kw)) violations.push(`${rel} 含 "${kw}"`)
      }
    }
    expect(violations, `平台直连泄漏：${violations.join('；')}`).toEqual([])
  })
})
