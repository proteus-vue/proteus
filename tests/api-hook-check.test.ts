// tests/api-hook-check.test.ts
// ★G-31 B7（no-callback-api lint）+ G-32.4：proteus api-check —— CMP007 门禁
//   验证点：回调式 API（wx.xxx({ success })）命中 / 同步存储命中 / 裸全局调用命中 /
//   平台桥文件豁免 / 合规代码零误报
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runApiHookCheck, formatApiHookCheck } from '../packages/cli/src/api-hook-check'

function tmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

describe('G-31 B7 CMP007 no-callback lint（api-check）', () => {
  it('回调式 wx API（success 回调）→ no-callback 违规', () => {
    const dir = tmpProject({
      'pages/a.vue': [
        '<template><view /></template>',
        '<script setup lang="ts">',
        "import { createApi } from '@proteus-vue/api'",
        "wx.request({ url: '/api/x', success: (res) => console.log(res) })",
        '</script>',
      ].join('\n'),
    })
    const result = runApiHookCheck(dir)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'no-callback')).toBe(true)
    expect(result.violations[0].file).toContain('pages/a.vue')
    expect(formatApiHookCheck(result)).toContain('no-callback')
  })

  it('同步存储裸调（wx.setStorageSync）→ sync-storage 违规', () => {
    const dir = tmpProject({
      'pages/b.vue': ['<script setup lang="ts">', "wx.setStorageSync('k', 1)", '</script>'].join('\n'),
    })
    const result = runApiHookCheck(dir)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'sync-storage')).toBe(true)
  })

  it('裸全局能力调用（wx.getLocation）→ global-direct 违规', () => {
    const dir = tmpProject({
      'pages/c.vue': ['<script setup lang="ts">', 'wx.getLocation({ type: "gcj02" })', '</script>'].join('\n'),
    })
    const result = runApiHookCheck(dir)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.rule === 'global-direct')).toBe(true)
  })

  it('★平台桥文件豁免（adapters/platforms/main.mp）——wx.* 合法', () => {
    const dir = tmpProject({
      'src/adapters/wx-bridge.ts': "wx.request({ url: '/x', success: (r) => { } })",
      'src/platforms/skyline.ts': "wx.getLocation({ success: () => {} })",
      'pages/index.vue': [
        '<script setup lang="ts">',
        "import { useFetch } from '@proteus-vue/api'",
        'const { data } = await useFetch("/x")',
        '</script>',
      ].join('\n'),
    })
    const result = runApiHookCheck(dir)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('合规代码（useXxx Hook / PlatformAPI）零误报', () => {
    const dir = tmpProject({
      'pages/index.vue': [
        '<script setup lang="ts">',
        "import { createCapabilityHooks } from '@proteus-vue/api'",
        'const cap = createCapabilityHooks()',
        'const loc = await cap.useLocation()',
        'const store = useStorage()',
        '// 注释里的 wx.request 不误报',
        '</script>',
      ].join('\n'),
    })
    const result = runApiHookCheck(dir)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('★文件级豁免 pragma（@proteus-api-check-ignore——兼容层演示页）', () => {
    const dir = tmpProject({
      'pages/compat-demo.vue': [
        '<!-- @proteus-api-check-ignore：刻意演示旧 wx API -->',
        '<script setup lang="ts">',
        "wx.setStorageSync('k', 1)", // 豁免命中不报
        "wx.getLocation({ success: () => {} })",
        '</script>',
      ].join('\n'),
      'pages/business.vue': [
        '<script setup lang="ts">',
        "wx.getLocation({ success: () => {} })", // 无豁免 → 报
        '</script>',
      ].join('\n'),
    })
    const result = runApiHookCheck(dir)
    expect(result.ok).toBe(false)
    // 豁免文件零违规；业务文件 1 处
    expect(result.violations.filter((v) => v.file.includes('compat-demo'))).toEqual([])
    expect(result.violations.filter((v) => v.file.includes('business')).length).toBe(1)
  })
})