// tests/e2e-mp-components.test.ts
// ★★内置组件「真机渲染/行为」E2E（2026-09-14 新增）——补上让本轮 6 组 bug 逃逸的**覆盖盲区**。
//
// 背景（为什么此前测不出）：
//   - 既有 MP E2E 只做「导航 + currentPage/systemInfo + 文本/截图」（稳通道冒烟），**从不查组件内部几何/样式**
//     → 「图标不显示」「图片灰块」「横向塌成一条线」全绿通过。
//   - 既有 Web E2E 只查「元素存在且可见」，**不查交互行为**（hover 时延 / scroll 事件载荷 / 受控 scroll-top）
//     → 「Web 无任何反馈」「scroll 数字不变」全绿通过。
//
// ★可达性边界（实测，glass-easel 组件 DOM 隔离）：页面级 `wx.createSelectorQuery` **只能查页面自身的
//   原生节点**（raw `<view>`/`<text>`）+ 页面 data；**查不到自定义组件（p-*）内部节点**（返回 null）。
//   故本文件的几何断言只打在**页面级 raw 元素**上；组件内部行为由 `tests/p-batch2-contract.test.ts`
//   （编译产物契约）+ Web 行为 E2E（`tests/web-sim-batch2.test.ts` + e2e-showcase-render 交互段）互补覆盖。
//
// 运行前置（同 e2e-mp-smoke）：
//   `PROTEUS_IDE_CLI=<.../MacOS/wechatide> PROTEUS_E2E_ONLY=e2e-mp-components \
//      npx tsx packages/cli/src/index.ts test e2e:mp showcase`
//   ★未置 PROTEUS_MP_E2E=1 → 跳过（CLI 会自动装配）
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { callWxide } from '@proteus-vue/test-core/driver'
import type { WxideMiniOptions } from '@proteus-vue/test-core/driver'

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

/** ★类名 scope 后缀（data-v-xxx）由源文件内容哈希生成、**每次构建可能变**——
 *  从产物 wxss 读取实际类名，避免测试里硬编码 hash（脆）。SelectorQuery 只支持 `.class`，
 *  不支持属性选择器 `[class*=...]`（实测 selectAll('[class*="chip"]') = 0）。 */
function scopedClass(wxssRel: string, base: string): string {
  const rel = wxssRel.endsWith('.wxss') ? wxssRel : wxssRel + '.wxss'
  const css = fs.readFileSync(path.join(PROJECT, rel), 'utf-8')
  const m = css.match(new RegExp(`\\.(${base}-data-v-[a-z0-9]+)`))
  if (!m) throw new Error(`未在产物 wxss 找到 ${base} 的 scope 类名（构建产物缺失？）`)
  return m[1]
}

/** 导航到页面（★不调 simulator_open_page——它会再触发编译与 navigate 竞态；失败重试一次） */
function openPage(page: string): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      callWxide('automation_navigate', { action: 'reLaunch', url: `/${page}` }, opts)
      return
    } catch (e) {
      if (attempt === 1) throw e
      settle(800)
    }
  }
}
/** 运行时求值（返回可序列化值） */
function evalIn<T = unknown>(fn: string): T {
  return callWxide('automation_evaluate', { '--fn-source': fn }, opts) as T
}
/** 读当前页 data 字段（页面级可达断言通道） */
function pageData(key: string): unknown {
  return evalIn(`function(){ const p=getCurrentPages(); return p[p.length-1].data[${JSON.stringify(key)}] }`)
}
/** 等渲染/编译稳定（分片轮询替代固定长 sleep） */
function settle(ms = 400): void {
  evalIn(`function(){ return new Promise(function(r){ setTimeout(r, ${ms}) }) }`)
}
/** 页面级 SelectorQuery（原生节点）→ JSON */
function queryRaw(fnBody: string): unknown {
  return evalIn(`function(){ return new Promise(function(resolve){ var q=wx.createSelectorQuery(); ${fnBody} }) }`)
}
/** ★有界轮询：等 chips 数 > 0（冷启动/编译后渲染需时间；固定 sleep 会假阴性） */
function waitChips(chip: string, tries = 8, stepMs = 350): Array<{ l: number; t: number; h: number; w: number }> {
  for (let i = 0; i < tries; i++) {
    const raw = queryRaw(
      `q.selectAll('.${chip}').boundingClientRect(); q.exec(function(r){ var a=r[0]||[]; resolve(JSON.stringify(a.map(function(c){ return { l: Math.round(c.left), t: Math.round(c.top), h: Math.round(c.height), w: Math.round(c.width) } }))); });`,
    )
    const arr = JSON.parse(String(raw)) as Array<{ l: number; t: number; h: number; w: number }>
    if (arr.length > 0) return arr
    settle(stepMs)
  }
  return []
}

describe.skipIf(!ENABLED || !HAS_SCROLL_PAGE)('★内置组件真机渲染/行为（几何级断言——拦「塌陷/灰块」类 bug）', () => {
  it('p-scroll-view：横向子项排成一行（同 top、left 递增——拦「塌成一条线」）', () => {
    // ★这是本轮「横向滚动还是没修」的直接回归锁：所有 chip 必须 top 相同且 left 严格递增。
    //   若 flex 失效（子项变块级堆叠）→ top 递增（多行）；若宽度塌陷 → 高度≈0。
    openPage('subpackages/components/pages/p-scroll-view')
    settle()
    const chip = scopedClass('subpackages/components/pages/p-scroll-view.wxss', 'chip')
    const chips = waitChips(chip)
    expect(chips.length, '横向 chip 应全部渲染（按类名前缀截取）').toBeGreaterThanOrEqual(4)
    const tops = new Set(chips.map((c) => c.t))
    expect(tops.size, '★所有 chip 必须在同一行（top 相同）——多于 1 个 top 即塌成多行').toBe(1)
    expect(chips[0].h, 'chip 高度 > 10（未塌成一条线）').toBeGreaterThan(10)
    expect(chips[0].w, 'chip 宽度 > 10').toBeGreaterThan(10)
    for (let i = 1; i < chips.length; i++) {
      expect(chips[i].l, `chip ${i} 应在 chip ${i - 1} 右侧（真实横向排列）`).toBeGreaterThan(chips[i - 1].l)
    }
    // ★★关键（上一版漏掉、导致「一行但滚不动/被截断」仍算过）：内层 wrapper 必须**随内容撑开**，
    //   否则 flex row 被容器宽度夹住（实测 284px）→ 子项被裁、scroll-view 无内容可滚。
    //   判据：wrapper 宽度 ≥ 内容跨度（首尾 chip 跨度），且明显 > 容器宽（~284）。
    const inner = scopedClass('subpackages/components/pages/p-scroll-view.wxss', 'scroll-x__inner')
    const innerW = evalIn<number>(`function(){ return new Promise(function(resolve){ var q=wx.createSelectorQuery(); q.select('.${inner}').boundingClientRect(); q.exec(function(r){ resolve((r[0]||{}).width||0); }); }); }`)
    const contentSpan = chips[chips.length - 1].l + chips[chips.length - 1].w - chips[0].l
    expect(innerW, `★wrapper 宽度应容纳全部内容（实测 ${Math.round(innerW)}，内容跨度 ${Math.round(contentSpan)}）`).toBeGreaterThanOrEqual(contentSpan - 5)
    expect(innerW, '★wrapper 宽度应明显大于容器（否则无横向可滚）').toBeGreaterThan(400)
  })

  it('p-scroll-view：scroll-top 编程滚动不被回写打断（拦「回到顶部只滚一点」）', () => {
    // ★本轮 bug：编程滚动（带 scroll-with-animation）途中 onScroll 把中间值（480/460…）回写成新 prop
    //   → scroll-view 又被拉回中间值 → 表现为「回不到顶」。断言：命令滚动期间中间事件**不改变** scrollTop。
    openPage('subpackages/components/pages/p-scroll-view')
    settle()
    const r = evalIn<string>(
      `function(){ var pg=getCurrentPages().slice(-1)[0];
        pg.setData({ scrollTop: 500 });
        pg.reset();
        var afterReset = pg.data.scrollTop;
        pg.onScroll({ detail: { scrollTop: 480 } });
        var midJump = pg.data.scrollTop;
        pg.onScroll({ detail: { scrollTop: 0 } });
        var arrived = pg.data.scrollTop;
        pg.onScroll({ detail: { scrollTop: 333 } });
        var manual = pg.data.scrollTop;
        return JSON.stringify({ afterReset: afterReset, midJump: midJump, arrived: arrived, manual: manual }); }`,
    )
    const d = JSON.parse(String(r))
    expect(d.afterReset, '点「回到顶部」→ scrollTop 应为 0').toBe(0)
    expect(d.midJump, '★中间滚动事件不得回写（否则回不到顶）').toBe(0)
    expect(d.arrived, '到达目标后仍为 0').toBe(0)
    expect(d.manual, '手动滚动应正常同步（非编程滚动）').toBe(333)
  })

  it('p-image：src 为 base64 SVG 数据 URI（拦「MP 灰色方块」）', () => {
    // ★本轮 bug：URL-encoded SVG data-URI 在 Skyline <image> 落**灰块**；只有 base64 完整渲染。
    openPage('subpackages/components/pages/p-image')
    settle()
    const src = String(pageData('img1') ?? '')
    expect(src, 'src 应为 SVG 数据 URI').toContain('data:image/svg+xml')
    expect(src, '★须为 base64（URL-encoded 在 Skyline 渲染为灰色方块）').toContain(';base64,')
    expect(src, '★不得是 URL-encoded 形态').not.toContain('%3C')
  })

  it('★横向块结构有效（组件解析 + 渲染——与 Web「Failed to resolve component」同源正向信号）', () => {
    openPage('subpackages/components/pages/p-scroll-view')
    settle()
    const chip = scopedClass('subpackages/components/pages/p-scroll-view.wxss', 'chip')
    const raw = queryRaw(
      `q.selectAll('.${chip}').boundingClientRect(); q.exec(function(r){ resolve(JSON.stringify({ n: (r[0]||[]).length })); });`,
    )
    expect(JSON.parse(String(raw)).n, '横向块应渲染出 chip（组件解析/结构有效）').toBeGreaterThan(0)
  })
})

// ── ★用探针断言原语加固（2026-09-14）：组件**内部**容器几何/可滚——工具查不到、探针读得到 ──
describe.skipIf(!ENABLED || !HAS_SCROLL_PAGE)('★组件内部几何（探针通道——拦「容器塌成一条线」）', () => {
  it('p-scroll-view 横向容器：高度达标 + 真的可横向滚动', async () => {
    const { assertProbeGeometry, assertProbeScrollable } = await import('@proteus-vue/test-core')
    const { createWxideMini, createDriver } = await import('@proteus-vue/test-core/driver')
    const mini = createWxideMini(opts)
    const driver = createDriver({ platform: 'mp', mini })
    await driver.enableProbes()
    await driver.reLaunch('/subpackages/components/pages/p-scroll-view')
    await driver.waitFor(1200)
    const sv = (await driver.probes()).filter((p) => p.tag === 'p-scroll-view')
    const horiz = sv.find((p) => p.rect && p.rect.width > 200 && p.rect.height < 100)
    expect(horiz, '应有横向 scroll-view 探针').toBeTruthy()
    // ★两条守门：① 高度不为「一条线」② 内容真的溢出（可滚）
    await assertProbeGeometry(driver, horiz!.pid, { minWidth: 200, minHeight: 20 })
    await assertProbeScrollable(driver, horiz!.pid, 'x')
    await driver.close()
  })
})
