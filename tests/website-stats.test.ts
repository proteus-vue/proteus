/**
 * 官网数字一致性（2026-09-20 事故后新增）
 *
 * 背景：`website/src/stats.ts` 自称「数字单一来源，禁止散落硬编码」，却**无任何校验** →
 * 实测 8 项里 7 项长期过时（包数 40/41 并存、单测 2966→3441、原语 176→183、组件 66→76…）。
 * 本测试锁三件事：
 *   ① 门禁 `check:stats` 对当前仓库为绿（数字与源码实际值一致）；
 *   ② 页面**不再自行硬编码数字**——Hero 与英文层必须从 STATS 派生（防止「中文改了英文不改」）；
 *   ③ stats.ts 的每一项都带 id（门禁据此重算）——新增数字项不登记 id 会被发现。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const website = path.join(root, 'website')
const statsTs = fs.readFileSync(path.join(website, 'src/stats.ts'), 'utf8')
const homeVue = fs.readFileSync(path.join(website, 'src/pages/Home.vue'), 'utf8')

/** 仅取 STATS 数组本体（interface 声明里也有 `id:`，整体匹配会多算一条） */
const statsArray = statsTs.slice(statsTs.indexOf('export const STATS'), statsTs.indexOf('export interface CompareRow'))

describe('官网数字一致性', () => {
  it('check:stats 门禁通过（声明值 == 源码实际值）', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/check-stats.ts'], {
      cwd: website,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    expect(out).toContain('官网数字与源码实际值一致')
  }, 300_000)

  it('每条 stat 都登记 id（门禁据此重算——新增项漏 id 会被这里发现）', () => {
    const values = statsArray.match(/value:\s*'[^']*'/g) ?? []
    const ids = statsArray.match(/id:\s*'[^']*'/g) ?? []
    expect(values.length).toBeGreaterThanOrEqual(8)
    expect(ids.length).toBe(values.length)
  })

  it('每条 stat 都带英文 label（英文页从同一数组派生，不再另立一份数字）', () => {
    const labelsEn = statsArray.match(/labelEn:/g) ?? []
    const ids = statsArray.match(/id:\s*'[^']*'/g) ?? []
    expect(labelsEn.length).toBe(ids.length)
  })

  // ★事故形态的结构性否定：Hero 与 STATS_EN 曾各自硬编码一份数字（同一页面出现 40 与 41）
  it('Hero 数字从 STATS 派生（不得硬编码包数/单测数/原语数）', () => {
    const heroBlock = homeVue.slice(homeVue.indexOf('heroStatsZh'), homeVue.indexOf('// 编号三支柱'))
    expect(heroBlock).toContain("heroStatIds")
    expect(heroBlock).not.toMatch(/value:\s*'\d+'/)
  })

  it('英文数字层从 STATS 派生（原实现抄了一份硬编码数字）', () => {
    const i = homeVue.indexOf('const STATS_EN')
    const block = homeVue.slice(i, i + 400)
    expect(block).toContain('STATS.map')
    expect(block).not.toMatch(/value:\s*'\d+'/)
  })

  it('页面文案里的派生数字不得与 stats 冲突（包数/原语/组件/implemented/rules 的旧值）', () => {
    // 这些是「已过时的旧值」——若重新出现在 Home.vue，说明文案又写死了旧数
    const stale = [
      { re: /176 语义原语|176 semantic primitives/, why: '原语应为 183' },
      { re: /72 个语义组件|72 semantic components/, why: '组件应为 76' },
      { re: /54 implemented|54 个 implemented/, why: 'implemented 应为 64' },
      { re: /106 (?:条|个)?\s*(?:编译)?规则|106 compile rules/, why: '规则应为 111' },
    ]
    for (const s of stale) expect(homeVue, `过时数字残留：${s.why}`).not.toMatch(s.re)
  })
})
