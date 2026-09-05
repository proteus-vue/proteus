/**
 * ★#448：D-2 门禁引擎已在 CLI（`proteus audit d2`——website/audit-d2.mjs 收编）——本文件即 CLI d2 审计测试
 * 05-dogfooding-conformance.md D-2 机器化：第三方 UI / @media / 平台 API 直调 / Web 平台裸调 = error（可配 off/warn/error）
 * 配置：proteus.config.ts `audit.rules`（缺省全 error fail-closed）；豁免：逐行 d2-exempt / 整文件 d2-exempt-file
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runD2Audit, formatD2Audit, scanD2VueFile, resolveD2Target, D2_DEFAULT_RULES } from '../packages/cli/src/d2-audit'

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

/** 写 proteus.config.ts（audit 内置 config-loader esbuild 求值）——package.json 让 createRequire 基址确定 */
function writeConfig(rulesTs?: string, extra = ''): void {
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'd2-fixture', private: true }))
  const audit = rulesTs ? `audit: { rules: { ${rulesTs} } },` : ''
  fs.writeFileSync(
    path.join(tmp, 'proteus.config.ts'),
    `export default {\n  platform: 'web',\n  skyline: false,\n  appid: '',\n  pagesDir: 'src/pages',\n  routesOutput: 'src/router/auto-routes.ts',\n  customRoute: { registerPresets: false, builders: {} },\n  setDataBridge: { batchWindow: 16, perComponent: false },\n  style: { px2rpx: false, rpxRatio: 2 },\n  ${audit}\n  ${extra}\n}\n`,
  )
}

const MEDIA_VIOLATION = `<template><div class="x">y</div></template>\n<style>\n@media (max-width: 820px) { .x { color: red; } }\n</style>`
const WEB_PLATFORM_VIOLATION = `<script setup lang="ts">\nfunction f() {\n  const y = window.scrollY\n}\n</script>\n<template><div>w</div></template>`

describe('D-2 门禁：正向（合规页面）', () => {
  it('合规页面 + 柔性原语 → PASS + 扫描计数', async () => {
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
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.scanned).toBe(1)
  })
})

describe('D-2 门禁：负向（违规必抓）', () => {
  it.each([
    ['第三方 UI 库', 'element-plus', '[D2-UI]'],
    ['第三方 UI 库（naive）', 'naive-ui', '[D2-UI]'],
  ])('%s import → D2-UI error', async (_n, pkg, token) => {
    writeVue('pages/Bad.vue', `<script setup lang="ts">\nimport { ElButton } from '${pkg}'\n</script>\n<template><el-button>x</el-button></template>`)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes(token))).toBe(true)
  })

  it('手写 @media → W-6/C8 error', async () => {
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(true)
  })

  it('小程序平台 API 直调 → D2-PLATFORM error', async () => {
    writeVue(
      'pages/Wx.vue',
      `<script setup lang="ts">\nfunction load() {\n  wx.request({ url: '/api' })\n}\n</script>\n<template><div @click="load">x</div></template>`
    )
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-PLATFORM]'))).toBe(true)
  })

  it.each([
    ['window', `const y = window.scrollY`],
    ['document', `document.getElementById('x')`],
    ['navigator', `navigator.clipboard.writeText('hi')`],
    ['location', `const u = location.origin`],
    ['history', `history.replaceState(null, '', url)`],
    ['fetch', `const r = fetch('/api')`],
    ['localStorage', `localStorage.getItem('k')`],
  ])('Web 裸平台 API %s → D2-PLATFORM-WEB error', async (_name, line) => {
    writeVue(
      'pages/Web.vue',
      `<script setup lang="ts">\nfunction f() {\n  ${line}\n}\n</script>\n<template><div>w</div></template>`
    )
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-PLATFORM-WEB]'))).toBe(true)
  })

  it('文档头注释提及「页面零裸 window.*」不误报（剥注释只看真实代码）', async () => {
    writeVue(
      'pages/Comment.vue',
      `<script setup lang="ts">\n// 框架原则：页面不裸写 window.* / document.* / navigator.*（封装只在框架包内）\nconst y = 1\n</script>\n<template><div>{{ y }}</div></template>`
    )
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
  })
})

describe('D-2 门禁：豁免登记（透明不静默）', () => {
  it('逐行 // d2-exempt → 豁免 + 原因随报告登记', async () => {
    writeVue(
      'pages/Scroll.vue',
      `<script setup lang="ts">\nfunction onScroll() {\n  const y = window.scrollY  // d2-exempt: 滚动进度观测——scroll-observer 原语缺口\n}\n</script>\n<template><div>w</div></template>`
    )
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(true)
    expect(report.exemptions.some((e) => e.includes('scroll-observer 原语缺口'))).toBe(true)
  })

  it('整文件 /* d2-exempt-file */ → 平台 API 家族豁免 + 登记（原生视觉资产页）', async () => {
    writeVue(
      'assets/Sprite.vue',
      `<script setup lang="ts">\n/* d2-exempt-file: 独立 WebGL 视觉资产页——canvas 原生实现不走框架页面语义 */\nconst c = document.querySelector('canvas')\n</script>\n<template><div>w</div></template>`
    )
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(true)
    expect(report.exemptions.some((e) => e.includes('整文件豁免'))).toBe(true)
  })

  it('整文件豁免不影响第三方 UI/@media 门禁（仍须守规则）', async () => {
    writeVue(
      'assets/Bad.vue',
      `<script setup lang="ts">\n/* d2-exempt-file: 原生资产页 */\nimport { ElButton } from 'element-plus'\n</script>\n<template><el-button /></template>\n<style>\n@media (max-width: 820px) { .x { color: red; } }\n</style>`
    )
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[D2-UI]'))).toBe(true)
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(true)
    expect(report.errors.some((e) => e.includes('D2-PLATFORM'))).toBe(false)
  })
})

describe('D-2 门禁：配置化规则（proteus.config audit.rules——off/warn/error）', () => {
  it('规则设 off → 不检查不阻断（report.rules 明示关闭）', async () => {
    writeConfig(`'no-media-query': 'off'`)
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(true)
    expect(report.rules['no-media-query']).toBe('off')
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('只关一条规则 → 其余规则仍按默认 error 拦截', async () => {
    writeConfig(`'no-media-query': 'off'`)
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    writeVue('pages/Web.vue', WEB_PLATFORM_VIOLATION)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(false) // 已关
    expect(report.errors.some((e) => e.includes('[D2-PLATFORM-WEB]'))).toBe(true) // 仍拦
  })

  it('规则设 warn → 报告不阻断（warnings 分流）', async () => {
    writeConfig(`'no-media-query': 'warn'`)
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings.some((e) => e.includes('[W-6/C8]'))).toBe(true)
  })

  it('配置存在但未声明 audit → 四规则默认 error（fail-closed）', async () => {
    writeConfig()
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.rules['no-media-query']).toBe('error')
    expect(report.errors.some((e) => e.includes('[W-6/C8]'))).toBe(true)
  })

  it('配置加载失败（相对 import 缺失）→ fail-closed 全 error + 报告登记', async () => {
    fs.writeFileSync(
      path.join(tmp, 'proteus.config.ts'),
      `import './nope'\nexport default { audit: { rules: { 'no-media-query': 'off' } } }\n`,
    )
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = await runD2Audit(tmp)
    expect(report.ok).toBe(false)
    expect(report.rules['no-media-query']).toBe('error')
    expect(report.notes.some((n) => n.includes('加载失败'))).toBe(true)
  })

  it('report.rules 缺省与 D2_DEFAULT_RULES 一致（无配置目录）', async () => {
    writeVue('pages/Ok.vue', `<template><div v-p-fluid="'font-size(14, 18)'">x</div></template>`)
    const report = await runD2Audit(tmp)
    expect(report.configFile).toBeNull()
    expect(report.rules).toEqual(D2_DEFAULT_RULES)
  })
})

describe('D-2 门禁：报告形态与单文件', () => {
  it('多文件聚合：扫描计数 + 错误逐条', async () => {
    writeVue('pages/Good.vue', `<template><div v-p-fluid="'font-size(14, 18)'">x</div></template>`)
    writeVue('pages/Bad.vue', `<script setup>import { NButton } from 'naive-ui'</script><template><n-button /></template>`)
    const report = await runD2Audit(tmp)
    expect(report.scanned).toBe(2)
    expect(report.errors.length).toBe(1)
  })

  it('单文件扫描直出 violations（scanD2VueFile 纯函数）', () => {
    const full = path.join(tmp, 'x.vue')
    fs.writeFileSync(full, `<script setup>const y = window.scrollY</script>\n<template><div>w</div></template>`)
    const v = scanD2VueFile(full, D2_DEFAULT_RULES)
    expect(v.errors.some((e) => e.includes('[D2-PLATFORM-WEB]'))).toBe(true)
  })

  it('格式化：规则明示行 + PASS/FAIL 结论', async () => {
    writeVue('pages/Media.vue', MEDIA_VIOLATION)
    const report = await runD2Audit(tmp)
    const text = formatD2Audit(report)
    expect(text).toContain('no-media-query=error')
    expect(text).toContain('❌ FAIL')
    const ok = await runD2Audit(fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-d2-ok-')))
    expect(formatD2Audit(ok)).toContain('✅ PASS')
  })
})

describe('D-2 门禁：CLI 目标解析（resolveD2Target）', () => {
  it('显式 dir → 原样 + 向上发现配置', async () => {
    writeConfig(`'no-media-query': 'warn'`)
    const target = await resolveD2Target(path.join(tmp, 'pages'))
    expect(target.scanDir).toBe(path.join(tmp, 'pages'))
    expect(target.configFile).toBe(path.join(tmp, 'proteus.config.ts'))
  })

  it('省略 dir → 读配置 audit.dir ?? src（相对配置所在目录）', async () => {
    writeConfig()
    fs.mkdirSync(path.join(tmp, 'src'))
    const target = await resolveD2Target(undefined, { cwd: tmp })
    expect(target.scanDir).toBe(path.join(tmp, 'src'))
    expect(target.configFile).toBe(path.join(tmp, 'proteus.config.ts'))
  })

  it('省略 dir 且无配置 → 报错指引', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-d2-empty-'))
    await expect(resolveD2Target(undefined, { cwd: empty })).rejects.toThrow(/未找到 proteus.config.ts/)
  })
})
