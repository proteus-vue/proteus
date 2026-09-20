/**
 * 版本组策略：linked 语义（2026-09-20 从 fixed 切换）
 *
 * 背景与权衡（两次都是被真实代价推动的）：
 *   · fixed（2026-09-19 引入）：组内任一包发版 → **全组同号**。解决了「14 种版本号 + 65 处 exact pin 靠人同步」，
 *     但代价是 **每次发布都要 bump + 重发全部 41 个包**（实测：只改 compiler 写 changeset，
 *     `changeset version` 仍把 41 包全部提版；连内容未变的 docs/mcp 都积累到 7~10 个版本）。
 *   · linked（2026-09-20 切换）：**只 bump 实际变更的包**（实测：只改 compiler → 4 个包；
 *     改 shared → 16 个包），组内已发布的包仍同号；依赖方由 changeset 自动级联。
 *
 * 本测试锁住切换后的不变式（防被误改回 fixed / 或配置被删）：
 *   ① `.changeset/config.json` 必须是 linked 分组，且 fixed 为空；
 *   ② 所有 @proteus-vue/* 必须在**同一条 major.minor.patch 线**上（linked 下预发布序号可不同）；
 *   ③ examples / 模板的内部 pin 必须指向**各包自己的当前版本**（不是某个统一版本）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(root, '.changeset/config.json'), 'utf8'))

function workspaceVersions(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, 'packages', e.name, 'package.json'), 'utf8'))
      if (j.name?.startsWith('@proteus-vue/')) out[j.name] = j.version
    } catch {
      /* 非包目录 */
    }
  }
  return out
}

describe('版本组策略（linked）', () => {
  it('changesets 配置：linked 分组生效、fixed 为空（防误改回「全量发版」）', () => {
    expect(config.linked, 'linked 必须是 @proteus-vue/* 全组').toEqual([['@proteus-vue/*']])
    expect(config.fixed, 'fixed 必须为空——否则每次发布都要 bump+重发全部 41 包').toEqual([])
  })

  it('所有包在同一条 major.minor.patch 线（linked 下预发布序号可不同）', () => {
    const versions = Object.values(workspaceVersions())
    const bases = [...new Set(versions.map((v) => /^(\d+\.\d+\.\d+)/.exec(v)?.[1] ?? v))]
    expect(bases, `版本线分裂：${bases.join(' / ')}`).toHaveLength(1)
  })

  it('examples 与模板的内部 pin 指向各包自己的版本（workspace:* 协议合法）', () => {
    const versions = workspaceVersions()
    for (const rel of ['examples/package.json', 'packages/create-proteus/templates/package.json']) {
      const j = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
      for (const field of ['dependencies', 'devDependencies']) {
        for (const [name, range] of Object.entries(j[field] ?? {})) {
          if (!name.startsWith('@proteus-vue/')) continue
          const actual = versions[name]
          expect(actual, `${rel} 引用了不存在的包 ${name}`).toBeTruthy()
          // `workspace:*` 是 pnpm 协议（指向工作区，天然永远是当前版本）→ 合法
          if (String(range).startsWith('workspace:')) continue
          // 精确 pin 必须等于**该包自己**的版本（linked 下各包版本可不同——这正是切换的关键）
          expect(range, `${rel} 的 ${name} pin 应指向该包当前版本 ${actual}`).toBe(actual)
        }
      }
    }
  })
})
