/**
 * Website B4 —— D-2 dogfooding AST 审计测试
 * 05-dogfooding-conformance.md D-2 机器化：第三方 UI / @media / 平台 API 直调 = error；语义原语统计
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { auditWebsiteDir } from '../website/audit-d2.mjs'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-d2-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function writeVue(rel: string, content: string): void {
  const full = path.join(tmp, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

/** 写 proteus.config.ts（TS 由 audit 内置 esbuild 加载器求值）——含 package.json 让 createRequire 基址确定 */
function writeConfig(rulesTs?: string): void {
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'd2-fixture', private: true }))
  const audit = rulesTs ? `audit: { rules: { ${rulesTs} } },` : ''
  fs.writeFileSync(
    path.join(tmp, 'proteus.config.ts'),
    `export default {
  platform: 'web',
  skyline: false,
  appid: '',
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: { registerPresets: false, builders: {} },
  setDataBridge: { batchWindow: 16, perComponent: false },
  style: { px2rpx: false, rpxRatio: 2 },
  ${audit}
}
`,
  )
}

const MEDIA_VIOLATION = `<template><div class="x">y</div></template>
<style>
@media (max-width: 820px) { .x { color: red; } }
</style>`
const WEB_PLATFORM_VIOLATION = `<script setup lang="ts">
function f() {
  const y = window.scrollY
}
</script>
<template><div>w</div></template>`

describe('D-2 审计：正向（合规页面）', () => {
  it('语义原语 + 柔性布局 → PASS + 使用统计', () => {
    writeVue(
      'pages/Home.vue',
      `<script setup lang="ts">
import { ref } from 'vue'
const n = ref(1)
</script>
<template>
  <div v-p-fluid="'padding(24, 48)'" class="hero">
    <span v-p-hover class="card">{{ n }}</span>
  </div>
</template>
<style>
.hero { max-width: 1180px; }
</style>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.usage.fluidDirectives).toBe(1)
    expect(report.usage.semanticDirectives).toBeGreaterThanOrEqual(2) // p-fluid + p-hover
  })
})

describe('D-2 审计：负向（违规必抓）', () => {
  it('第三方 UI 库 import → error（D2-UI）', () => {
    writeVue(
      'pages/Bad.vue',
      `<script setup lang="ts">
import { ElButton } from 'element-plus'
</script>
<template><el-button>x</el-button></template>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-UI]'))).toBe(true)
  })

  it('手写 @media → error（W-6/C8 柔性框架优先）', () => {
    writeVue(
      'pages/Media.vue',
      `<template><div class="x">y</div></template>
<style>
@media (max-width: 820px) { .x { color: red; } }
</style>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(true)
  })

  it('平台 API 直调 → error（D2-PLATFORM）', () => {
    writeVue(
      'pages/Wx.vue',
      `<script setup lang="ts">
function load() {
  wx.request({ url: '/api' })
}
</script>
<template><div @click="load">x</div></template>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-PLATFORM]'))).toBe(true)
  })
})

describe('D-2 审计：Web 平台 API 裸调（★#445 全端覆盖）', () => {
  it.each([
    ['window', `const y = window.scrollY`],
    ['document', `document.getElementById('x')`],
    ['navigator', `navigator.clipboard.writeText('hi')`],
    ['location', `const u = location.origin`],
    ['history', `history.replaceState(null, '', url)`],
    ['fetch', `const r = fetch('/api')`],
    ['localStorage', `localStorage.getItem('k')`],
  ])('%s 裸调用 → D2-PLATFORM-WEB error', (_name, line) => {
    writeVue(
      'pages/Web.vue',
      `<script setup lang="ts">
function f() {
  ${line}
}
</script>
<template><div>w</div></template>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-PLATFORM-WEB]'))).toBe(true)
  })

  it('文档头注释提及「页面零裸 window.*」不误报（剥注释只看真实代码）', () => {
    writeVue(
      'pages/Comment.vue',
      `<script setup lang="ts">
// 框架原则：页面不裸写 window.* / document.* / navigator.*（封装只在框架包内）
const y = 1
</script>
<template><div>{{ y }}</div></template>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
  })

  it('逐行 // d2-exempt → 豁免 + 原因随报告登记（防静默扩散）', () => {
    writeVue(
      'pages/Scroll.vue',
      `<script setup lang="ts">
function onScroll() {
  const y = window.scrollY  // d2-exempt: 滚动进度观测——scroll-observer 原语缺口
}
</script>
<template><div>w</div></template>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(true)
    expect(report.exemptions.some((e) => e.includes('scroll-observer 原语缺口'))).toBe(true)
  })

  it('整文件 /* d2-exempt-file */ → 平台 API 家族豁免 + 登记（原生视觉资产页）', () => {
    writeVue(
      'assets/Sprite.vue',
      `<script setup lang="ts">
/* d2-exempt-file: 独立 WebGL 视觉资产页——canvas 原生实现不走框架页面语义 */
const c = document.querySelector('canvas')
</script>
<template><div>w</div></template>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(true)
    expect(report.exemptions.some((e) => e.includes('整文件豁免'))).toBe(true)
  })

  it('整文件豁免不影响第三方 UI/@media 门禁（仍须守规则）', () => {
    writeVue(
      'assets/Bad.vue',
      `<script setup lang="ts">
/* d2-exempt-file: 原生资产页 */
import { ElButton } from 'element-plus'
</script>
<template><el-button /></template>
<style>
@media (max-width: 820px) { .x { color: red; } }
</style>`
    )
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-UI]'))).toBe(true)
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(true)
    expect(report.errors.some((e) => e.includes('D2-PLATFORM'))).toBe(false)
  })
})

describe('D-2 审计：配置化规则（★#447 proteus.config audit.rules——开发者自选级别）', () => {
  it('规则设 off → 不检查不阻断（报告 rules 明示关闭）', () => {
    writeConfig(`'no-media-query': 'off'`)
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(true)
    expect(report.rules['no-media-query']).toBe('off')
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('只关一条规则 → 其余规则仍按默认 error 拦截', () => {
    writeConfig(`'no-media-query': 'off'`)
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    writeVue('pages/Web.vue', WEB_PLATFORM_VIOLATION)
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(false) // 已关
    expect(report.errors.some((e) => e.includes('[D2-PLATFORM-WEB]'))).toBe(true) // 仍拦
  })

  it('规则设 warn → 报告不阻断（warnings 分流）', () => {
    writeConfig(`'no-media-query': 'warn'`)
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings.some((e) => e.includes('[W-6/C8]'))).toBe(true)
  })

  it('配置存在但未声明 audit → 四规则默认 error（fail-closed）', () => {
    writeConfig()
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.rules['no-media-query']).toBe('error')
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(true)
  })

  it('配置加载失败（如相对 import 目标缺失）→ fail-closed 默认全 error + 报告登记', () => {
    fs.writeFileSync(
      path.join(tmp, 'proteus.config.ts'),
      `import './nope'
export default { audit: { rules: { 'no-media-query': 'off' } } }
`,
    )
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = auditWebsiteDir(tmp)
    expect(report.ok).toBe(false)
    expect(report.rules['no-media-query']).toBe('error')
    expect(report.notes.some((n) => n.includes('加载失败'))).toBe(true)
  })
})

describe('D-2 审计：报告形态', () => {
  it('多文件聚合：错误逐条 + 统计聚合', () => {
    writeVue('pages/Good.vue', `<template><div v-p-fluid="'font-size(14, 18)'">x</div></template>`)
    writeVue('pages/Bad.vue', `<script setup>import { NButton } from 'naive-ui'</script><template><n-button /></template>`)
    const report = auditWebsiteDir(tmp)
    expect(report.usage.files).toBe(2)
    expect(report.errors.length).toBe(1)
    expect(report.usage.fluidDirectives).toBe(1)
  })
})
