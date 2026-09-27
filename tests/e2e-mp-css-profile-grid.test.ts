// tests/e2e-mp-css-profile-grid.test.ts
// ★★DCP-2 的 Skyline Grid 语义门禁（2026-09-29）
//
// 背景：方案 §5.6 的 DCP-2（Profile 是否开放 Grid）。Taffy 原生支持 Grid，用户批准「开放为 L2」，
//   我附加的前置条件是「补 Skyline 实测」。**实测结果推翻了「开放」的结论**：
//   Skyline 的 `display:grid` **退化为 block**（子项不分列、纵向堆叠）。
//
// 本文件把这条实测固化为**机器门禁**（而非只写在文档里）：
//   · 若未来 Skyline 支持了 Grid，本测试会**变红** → 强制重新审视 DCP-2（这正是想要的）
//   · 反向：若探针通道故障，flex 对照组会先红 → 不会误判为「Skyline 支持了」
//
// ★为何必须带**同页对照组**：单看「grid 子项没分列」无法排除「探针本身失效」。
//   同一页面、同一 `createSelectorQuery` 通道下 flex 正确横排 → 才能确证 grid 的失败是真实的。
//
// 运行：`PROTEUS_MP_E2E=1 PROTEUS_E2E_ONLY=e2e-mp-css-profile-grid \
//        npx tsx packages/cli/src/index.ts test e2e:mp showcase`
//       （IDE 路径已写入 CLI 默认探测表，无需设 PROTEUS_IDE_CLI）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createWxideMini, createDriver } from '@proteus-vue/test-core/driver'
import type { WxideMiniOptions } from '@proteus-vue/test-core/driver'

const ENABLED = process.env.PROTEUS_MP_E2E === '1'
const PROJECT = process.env.PROTEUS_MINI_PROGRAM_PATH ?? 'showcase/dist/mp-weixin'
const IDE_CLI = process.env.PROTEUS_IDE_CLI ?? undefined
const CLIENT = process.env.PROTEUS_WXIDE_CLIENT ?? 'zed'

/** 项目感知（examples 无此分包页时跳过——避免测试自身不可移植） */
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

const PROBE_PAGE = 'subpackages/capabilities/pages/css-profile-probe'
const HAS_PROBE = projectHasRoute(PROBE_PAGE)

const opts: WxideMiniOptions = { cliPath: IDE_CLI, project: PROJECT }
if (CLIENT) opts.client = CLIENT
const mini = createWxideMini(opts)

interface ProbeRow {
  feature: string
  actual: string
  verdict: string
}

/** 触发页面探针并读回 rows（★MP 编译后 ref 值落在 page.data 上，不在实例属性——见探针页注释坑①） */
async function runProbePage(): Promise<{ out: string; rows: ProbeRow[]; route: string }> {
  const driver = createDriver({ platform: 'mp', mini })

  // ★就绪闸门（本仓实测）：CLI 的 open_project_window + simulator_refresh 之后，
  //   模拟器仍需要一小段时间完成编译加载。直接 automation_navigate 会偶发
  //   「退出码 1」（既有 e2e-mp-probe.test.ts 的 enableProbes() 也起同样作用——
  //   它是一次 evaluate 调用，天然充当「JS 上下文可用」的探针）。
  //   故这里先 evaluate 一次（失败即重试，有上限），确认运行时已响应再导航。
  let ready = false
  for (let attempt = 0; attempt < 6 && !ready; attempt++) {
    try {
      await mini.evaluate(new Function(`return () => { try { return String(typeof getCurrentPages) } catch (e) { return 'no' } }`)())
      ready = true
    } catch {
      // 未就绪 → 短退避重试（有上限，非无界轮询）
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  expect(ready, '模拟器运行时应在有限次重试内就绪').toBe(true)

  await driver.reLaunch(`/${PROBE_PAGE}`)
  await driver.waitFor(1500)

  const call = await mini.evaluate(
    new Function(
      `return () => { var pages = getCurrentPages(); var page = pages[pages.length - 1]; if (page && typeof page.runProbe === 'function') { page.runProbe(); return 'called' } return 'no-method' }`,
    )(),
  )
  expect(String(call), '探针页应暴露 runProbe 方法').toBe('called')
  await driver.waitFor(2000)

  const raw = await mini.evaluate(
    new Function(
      `return () => { var pages = getCurrentPages(); var page = pages[pages.length - 1]; var d = (page && page.data) || {}; return JSON.stringify({ route: page && page.route, out: d.out, rows: d.rows || [] }) }`,
    )(),
  )
  return JSON.parse(String(raw)) as { out: string; rows: ProbeRow[]; route: string }
}

describe.skipIf(!ENABLED || !HAS_PROBE)('★★DCP-2 Skyline Grid 语义门禁', () => {
  let result: { out: string; rows: ProbeRow[]; route: string }

  it('探针跑通：几何判据全过（说明测量通道有效）', async () => {
    result = await runProbePage()
    expect(result.route, '应停在探针页').toContain('css-profile-probe')
    // 几何判据（31 项）——这些是「属性被接受」层面的读数
    expect(result.out, '几何探针应全过（若此处失败，说明 Skyline/探针环境变了，需先查环境）').toMatch(/几何 \d+\/\d+ 项通过/)
    const geo = result.out.match(/几何 (\d+)\/(\d+) 项通过/)
    expect(geo, 'out 应含几何统计').toBeTruthy()
    expect(Number(geo![1]), '几何判据应全过').toBe(Number(geo![2]))
    expect(result.rows.length, '应有探针行').toBeGreaterThan(20)
  })

  it('★★核心断言：Skyline 的 display:grid 退化为 block（子项未分列）', () => {
    const grid = result.rows.find((r) => r.feature.startsWith('★grid 语义判定'))
    expect(grid, '应含 grid 语义判定行（探针须带子项级判据，不能只看容器几何）').toBeTruthy()
    // ★断言「不支持」——若 Skyline 未来支持 Grid，此处变红，强制重新审视 DCP-2
    expect(
      grid!.verdict,
      `★Skyline 的 Grid 语义判定：实测应为「未按 grid 布局」。实际读数：${grid!.actual}\n` +
        `  若此处变红：说明 Skyline 可能已支持 Grid → 请重新评估 DCP-2 并更新 Profile §L2 与本文档`,
    ).toContain('未按 grid 布局')

    // 具体读数：两个子项的 x 相同（未分列）
    const m = grid!.actual.match(/g1\.x=(\d+)\s+g2\.x=(\d+)/)
    expect(m, `actual 应含子项坐标，实际：${grid!.actual}`).toBeTruthy()
    expect(Number(m![1]), '★grid 子项 1 与子项 2 的 x 应相同（未分列 = 退化为 block）').toBe(Number(m![2]))
  })

  it('★对照组：同页 flex 正确横排（证明「grid 失败」不是探针故障）', () => {
    const flexCtrl = result.rows.find((r) => r.feature === 'flex 对照组（基线）')
    expect(flexCtrl, '应含 flex 对照组行').toBeTruthy()
    expect(flexCtrl!.verdict, 'flex 对照组应确认横排正常（否则是探针坏了，不是 grid 不支持）').toContain('✅')
    const m = flexCtrl!.actual.match(/x=(\d+),(\d+),(\d+)/)
    expect(m, `flex 对照 actual 应含三个 x，实际：${flexCtrl!.actual}`).toBeTruthy()
    const [x1, x2, x3] = [Number(m![1]), Number(m![2]), Number(m![3])]
    expect(x2 - x1, 'flex 子项应依次横排（间距 > 0）').toBeGreaterThan(0)
    expect(x3 - x2, 'flex 子项应依次横排（间距 > 0）').toBeGreaterThan(0)
  })

})

// ─────────────────────────────────────────────────────────────────────────
// ★无关设备的部分：判定逻辑本身 + 与探针页的同源守卫（CI 可跑，无需模拟器）
// ─────────────────────────────────────────────────────────────────────────

/** 与探针页 `cssProfileGridJudge` 同源的判定逻辑（见下方「同源守卫」断言） */
export function judgeGridFromRects(
  g1x: number,
  g2x: number,
  g1y: number,
  g2y: number,
  g3y: number,
): string {
  const twoColumns = g2x - g1x > 40 && Math.abs(g1y - g2y) < 2
  const wrapped = g3y - g1y > 10
  return twoColumns && wrapped ? '✅ 真 grid' : twoColumns ? '⚠️ 部分' : '❌ 未按 grid 布局'
}

describe('★★DCP-2 判定逻辑自证（无需设备）', () => {
  it('（破坏性验证）判定对「真 grid」给支持、对「block 退化」给不支持——证明断言非恒真', () => {
    // ★注意：必须完整复刻页面的三个观测量（含**两个子项的 y**），
    //   我第一版写成 `Math.abs(g1y - g1y)`（恒为 0 的恒真式）→ 判定退化成只看 x。
    // 真 grid：子项 2 在第 2 列（x+75）且与子项 1 同行（y 相同），子项 3 换行
    expect(judgeGridFromRects(52, 127, 884, 884, 916), '★真 grid 读数应判为支持（证明判定不是恒判失败）').toContain('✅')
    // 与 Skyline 实测同形：子项 1/2 的 x 相同（未分列）→ 判为不支持
    expect(judgeGridFromRects(52, 52, 884, 884, 916), '★block 退化读数应判为不支持（与实际一致）').toContain('❌')
    // 只分列不换行 → 部分生效（证明 wrapped 这一维真的参与判定）
    expect(judgeGridFromRects(52, 127, 884, 884, 886), '★仅分列未换行应判为部分').toContain('⚠️')
  })

  it('★★同源守卫：探针页内的判定表达式与本测试一致（防止两处逻辑漂移）', () => {
    // 本仓既有先例：gates-sync.test.ts 解析 .mjs 断言「唯一事实来源」，
    //   避免「同一规则两处实现各自漂移」。此处对探针页做同样的事。
    const page = fs.readFileSync(
      path.resolve(__dirname, '../showcase/subpackages/capabilities/pages/css-profile-probe.vue'),
      'utf-8',
    )
    // 页面判定逻辑的两个核心表达式
    expect(page, '探针页应含「分两列」判据（x 差 > 40 且同行）').toMatch(/gx2 - gx1 > 40/)
    expect(page, '探针页应含「换行」判据（y 差 > 10）').toMatch(/gy3 - gy1 > 10/)
    expect(page, '探针页应含「未按 grid 布局」判定文案').toContain('未按 grid 布局')
    // 且必须带 flex 对照组（否则「grid 失败」无法与「探针故障」区分）
    expect(page, '探针页必须保留 flex 对照组（结论可信的前提）').toContain('c-flexctrl')
    expect(page, '探针页应有对照组的判定文案').toContain('flex 对照组（基线）')
  })
})
