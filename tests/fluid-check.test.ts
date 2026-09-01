// tests/fluid-check.test.ts
// ★G-22 柔性布局严格规则（fluid-layout-plan 01 §9 / 03）：proteus fluid:check
//   FLD001 禁 @media / FLD002 禁硬编码断点 / FLD003 p-fluid 须 min·max / FLD004 p-grid 须 min-col-width / FLD006 禁 Dimensions.get
//   ★S4：FLD007 过小字号（≤11px）/ FLD008 p-scale level 越界 · density 非法
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFluidFile, runFluidCheck } from '../packages/cli/src/fluid-check'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'proteus-fluid-check-'))

function write(rel: string, content: string): void {
  const full = path.join(TMP, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

describe('★G-22 fluid:check（FLD001-006）', () => {
  it('违规文件：@media / 硬编码断点 / p-fluid 缺区间 / p-grid 缺 min-col-width / Dimensions.get 全部命中', () => {
    write(
      'pages/bad.vue',
      [
        '<style scoped>',
        '.box { width: 100%; }',
        '@media (min-width: 768px) { .box { width: 50%; } }',
        '.lg { padding: 16px 1024px; }',
        '</style>',
        '<template>',
        '<p-grid :gap="12">',
        '  <p-card />',
        '</p-grid>',
        '<h1 p-fluid="font-size(20)">标题</h1>',
        '</template>',
        '<script setup lang="ts">',
        'const w = Dimensions.get("window").width',
        '</script>',
      ].join('\n'),
    )
    const violations = checkFluidFile(path.join(TMP, 'pages/bad.vue'))
    const rules = violations.map((v) => v.rule).sort()
    expect(rules).toContain('FLD001')
    expect(rules).toContain('FLD002')
    expect(rules).toContain('FLD003')
    expect(rules).toContain('FLD004')
    expect(rules).toContain('FLD006')
    // 行号定位
    const fld004 = violations.find((v) => v.rule === 'FLD004')
    expect(fld004?.line).toBeGreaterThan(0)
    // 合规项不误报：p-grid 声明 min-col-width / p-fluid 合法区间
    write(
      'pages/good.vue',
      [
        '<style scoped>',
        '.box { padding: 16px; }',
        '</style>',
        '<template>',
        '<p-grid :min-col-width="160" :gap="12" />',
        '<h1 p-fluid="font-size(20, 32)">标题</h1>',
        '</template>',
        '<script setup lang="ts">',
        'const w = 100',
        '</script>',
      ].join('\n'),
    )
    expect(checkFluidFile(path.join(TMP, 'pages/good.vue'))).toEqual([])
  })

  it('★S4 FLD007/008：过小字号 + p-scale level 越界/density 非法命中；合规不误报', () => {
    write(
      'pages/s4-bad.vue',
      [
        '<style scoped>',
        '.tiny { font-size: 10px; }',
        '.ok { font-size: 14px; }',
        '</style>',
        '<template>',
        '<p-scale level="5" density="huge">文本</p-scale>',
        '</template>',
      ].join('\n'),
    )
    const violations = checkFluidFile(path.join(TMP, 'pages/s4-bad.vue'))
    const rules = violations.map((v) => v.rule).sort()
    expect(rules).toContain('FLD007')
    expect(rules.filter((r) => r === 'FLD008').length).toBe(2) // level 越界 + density 非法
    // 合规：≥12px 字号 + p-scale 合法 level/density 不误报
    write(
      'pages/s4-good.vue',
      [
        '<style scoped>',
        '.title { font-size: 14px; }',
        '</style>',
        '<template>',
        '<p-scale level="3" density="comfortable">文本</p-scale>',
        '</template>',
      ].join('\n'),
    )
    expect(checkFluidFile(path.join(TMP, 'pages/s4-good.vue'))).toEqual([])
  })

  it('runFluidCheck：目录递归扫描 + 汇总（坏文件 → ok false；全合规 → ok true）', () => {
    write('pages/clean.vue', '<template><p-grid :min-col-width="160" /></template>\n<style scoped>.a { color: red; }</style>\n<script setup lang="ts">const x = 1</script>')
    const bad = runFluidCheck(path.join(TMP, 'pages'))
    expect(bad.ok).toBe(false)
    expect(bad.violations.length).toBeGreaterThanOrEqual(5)
    write('pages/clean2.vue', '<template><p-stack direction="row" /></template>\n<style scoped>.b { margin: 8px; }</style>')
    const onlyGood = runFluidCheck(path.join(TMP, 'pages/clean2.vue'))
    expect(onlyGood.ok).toBe(true)
    expect(onlyGood.fileCount).toBe(1)
  })
})
