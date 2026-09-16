// tests/e2e-mp-probe.test.ts
// ★★框架元素探针 E2E（2026-09-14）——验证「不依赖自动化工具元素查询」的降级通道真的通。
//
// 命题（用户提出、本轮落地）：自动化工具查不到自定义组件内部节点（glass-easel 隔离；
//   Skyline 无 selectAllComponents）→ 组件**自己**在 ready() 用 `.in(this)` 自测量根节点 →
//   写全局探针注册表 → 测试经 `driver.probes()`（底层 evaluate）读取。
//   本文件断言：**工具查不到的内部节点几何，探针能读到**（这正是本轮横向 bug 漏检两轮的原因）。
//
// 运行：`PROTEUS_IDE_CLI=<.../MacOS/wechatide> PROTEUS_E2E_ONLY=e2e-mp-probe \
//        npx tsx packages/cli/src/index.ts test e2e:mp showcase`
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { callWxide } from '@proteus-vue/test-core/driver'
import type { WxideMiniOptions, ProbeRecord } from '@proteus-vue/test-core/driver'
import { createWxideMini, createDriver } from '@proteus-vue/test-core/driver'

const ENABLED = process.env.PROTEUS_MP_E2E === '1'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH ?? 'showcase/dist/mp-weixin'
const IDE_CLI = process.env.PROTEUS_IDE_CLI ?? undefined
const CLIENT = process.env.PROTEUS_WXIDE_CLIENT ?? 'zed'

const opts: WxideMiniOptions = { cliPath: IDE_CLI, project: PROJECT }

/** ★目标页面是否存在于当前被测项目（examples 无 showcase 分包页 → 本 spec 应跳过，
 *  否则默认 e2e:mp 全家桶跑到 examples 时会全红。项目感知，避免「测试自身不可移植」）。 */
function projectHasRoute(route: string): boolean {
  try {
    const app = JSON.parse(fs.readFileSync(path.join(PROJECT, 'app.json'), 'utf-8')) as {
      pages?: string[]
      subPackages?: Array<{ root: string; pages: string[] }>
      subpackages?: Array<{ root: string; pages: string[] }>
    }
    const want = route.replace(/^\//, '')
    if ((app.pages ?? []).includes(want)) return true
    for (const sp of [...(app.subPackages ?? []), ...(app.subpackages ?? [])]) {
      if (sp.pages.some((p) => `${sp.root}/${p}` === want)) return true
    }
    return false
  } catch {
    return false
  }
}
const SCROLL_PAGE = 'subpackages/components/pages/p-scroll-view'
const HAS_SCROLL_PAGE = projectHasRoute(SCROLL_PAGE)

if (CLIENT) opts.client = CLIENT
const mini = createWxideMini(opts)

describe.skipIf(!ENABLED || !HAS_SCROLL_PAGE)('★框架元素探针（组件内部几何——绕开工具元素查询限制）', () => {
  it('开启探针 → 导航 → driver.probes() 读到组件**内部**根节点几何', async () => {
    const driver = createDriver({ platform: 'mp', mini })
    await driver.enableProbes()
    await driver.reLaunch('/subpackages/components/pages/p-scroll-view')
    await driver.waitFor(1200)

    const probes = await driver.probes()
    expect(probes.length, '应读到多条组件探针记录').toBeGreaterThan(0)

    // ★核心断言：p-scroll-view 的**根节点几何**（工具经 createSelectorQuery 查不到——已实测 null）
    const sv = probes.filter((p: ProbeRecord) => p.tag === 'p-scroll-view')
    expect(sv.length, '应有 p-scroll-view 探针记录').toBeGreaterThan(0)
    const horiz = sv.find((p) => p.rect && p.rect.height < 100 && p.rect.width > 200)
    expect(horiz, '★应能读到横向 scroll-view 的几何（工具查不到的内部节点）').toBeTruthy()
    expect(horiz!.rect!.width, '横向容器宽度 > 200').toBeGreaterThan(200)
    expect(horiz!.rect!.height, '★横向容器高度应 > 20（塌成细线时此处会失败）').toBeGreaterThan(20)

    // 反证：同一节点用**工具元素查询**（页面级 SelectorQuery）应查不到 → 证明探针是必要的降级通道
    const viaTool = await mini.evaluate(
      new Function(`return () => new Promise(function (resolve) { var q = wx.createSelectorQuery(); q.select('.p-scroll-view').boundingClientRect(); q.exec(function (r) { resolve(JSON.stringify(r[0])) }); })`)(),
    )
    expect(String(viaTool), '工具查组件内部节点应返回 null（正是探针存在的理由）').toBe('null')

    await driver.close()
  })

  it('（破坏性验证）注册表清空后 probes() 为空 → 证明读的是真实注册表而非硬编码', async () => {
    const driver = createDriver({ platform: 'mp', mini })
    await driver.enableProbes()
    await driver.reLaunch('/subpackages/components/pages/p-scroll-view')
    await driver.waitFor(1000)
    const before = (await driver.probes()).length
    expect(before, '清空前应有记录').toBeGreaterThan(0)
    // 清空注册表 → 再读应为空
    await mini.evaluate(new Function(`return () => { globalThis.__PROTEUS_PROBES__ = {}; return true }`)())
    const after = (await driver.probes()).length
    expect(after, '★清空后应为 0（证明读的是真实注册表）').toBe(0)
    await driver.close()
  })
})

// ── ★契约断言原语实战（test-core/probe-assert）：把「几何/可滚」变成可复用门禁 ──
describe.skipIf(!ENABLED || !HAS_SCROLL_PAGE)('★探针断言原语（assertProbeScrollable / Geometry / Visible）', () => {
  it('横向 scroll-view：assertProbeScrollable(x) 通过（内容 738 > 容器 286）——工具无法表达此断言', async () => {
    const { assertProbeScrollable } = await import('@proteus-vue/test-core')
    const driver = createDriver({ platform: 'mp', mini })
    await driver.enableProbes()
    await driver.reLaunch('/subpackages/components/pages/p-scroll-view')
    await driver.waitFor(1200)

    // 横向容器（高度 < 100 那个）——按 tag 找 pid
    const all = await driver.probes()
    const sv = all.filter((p: ProbeRecord) => p.tag === 'p-scroll-view')
    const horiz = sv.find((p) => p.rect && p.rect.height < 100)
    expect(horiz, '应存在横向 scroll-view 探针').toBeTruthy()

    // ★核心：断言它**真的可横向滚动**（本轮 bug 的直接判据）
    const rec = await assertProbeScrollable(driver, horiz!.pid, 'x')
    expect(rec.scroll!.scrollWidth, '内容宽度').toBeGreaterThan(rec.rect!.width)
    // 纵向那个也应可滚
    const vert = sv.find((p) => p.rect && p.rect.height > 100)
    if (vert) {
      const rv = await assertProbeScrollable(driver, vert.pid, 'y')
      expect(rv.scroll!.scrollHeight).toBeGreaterThan(rv.rect!.height)
    }
    await driver.close()
  })

  it('几何断言：横向容器高度达标（塌陷即失败——本轮 bug 的守门）', async () => {
    const { assertProbeGeometry } = await import('@proteus-vue/test-core')
    const driver = createDriver({ platform: 'mp', mini })
    await driver.enableProbes()
    await driver.reLaunch('/subpackages/components/pages/p-scroll-view')
    await driver.waitFor(1200)
    const sv = (await driver.probes()).filter((p: ProbeRecord) => p.tag === 'p-scroll-view')
    const horiz = sv.find((p) => p.rect && p.rect.width > 200 && p.rect.height < 100)
    expect(horiz, '应存在横向容器').toBeTruthy()
    const rec = await assertProbeGeometry(driver, horiz!.pid, { minWidth: 200, minHeight: 20 })
    expect(rec.rect!.height, '★横向容器高度 > 20（塌成细线会失败）').toBeGreaterThan(20)
    await driver.close()
  })

  it('（破坏性）断言有判别力：对纵向容器用 x 轴断言 → 应抛「不可滚」', async () => {
    const { assertProbeScrollable } = await import('@proteus-vue/test-core')
    const driver = createDriver({ platform: 'mp', mini })
    await driver.enableProbes()
    await driver.reLaunch('/subpackages/components/pages/p-scroll-view')
    await driver.waitFor(1200)
    const sv = (await driver.probes()).filter((p: ProbeRecord) => p.tag === 'p-scroll-view')
    const vert = sv.find((p) => p.rect && p.rect.height > 100)
    expect(vert, '应存在纵向容器').toBeTruthy()
    // 纵向容器在 x 轴不可滚（内容未横向溢出）→ 断言必须**如实失败**
    await expect(assertProbeScrollable(driver, vert!.pid, 'x')).rejects.toThrow(/不可滚/)
    await driver.close()
  })
})
