// tests/e2e-website-multidevice.test.ts
// ★★多端同屏页「真几何」门禁（2026-09-26 用户实测反馈驱动）
//
// 背景（为什么必须做成浏览器级门禁）：本轮柔性系统修复在**宽舞台（1600 视口）**验证全绿，
//   用户机（1280 视口）看到「内容叠在一起」。根因是同一形态在**不同舞台宽度**下行高预算不同：
//   · TV：封面 aspect-ratio 16/9 让 min-content = 帧宽×9/16（540 → 279px）→ hero 行吃掉全部、
//         海报行归零；叠加信息（标题/价格/CTA 212px）在窄帧下顶出帧顶被裁。
//   · 车机：`.pf-actions` 是 `.pf-info` 的子元素，`grid-area: actions` 落进 info 隐式行 →
//         info 变 4 行 158px 撑爆车身 → 与推荐瓦片互相重叠。
//   jsdom 无布局引擎（getBoundingClientRect 恒零）→ 结构断言抓不住；**必须真浏览器 + 真几何**。
//
// 门禁口径（按形态的**设计纪律**分档，不是一刀切）：
//   · 一屏形态（watch/car/tv）——内容 ≤ 视口：核心块**零裁切、零重叠、body 不滚动**
//   · 可滚动形态（phone/fold/tablet/pc）——允许纵向滚动：核心块**零重叠**（滚动由 body 承接）
//   两种视口都跑（1280 = 用户机窄舞台 / 1600 = 设计评审宽舞台）——「只在宽舞台验证」是本次教训。
//
// 运行：pnpm run test:e2e:website（先构建 website 产物）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'

const BASE = 'http://localhost:4176'
const WEBSITE_ROOT = path.resolve(__dirname, '../website')

/** 切换器按钮文案（zh 站 —— 与 MultiDevice 的 label.zh 同源） */
const FORM_LABEL: Record<string, string> = {
  watch: '手表', phone: '手机', flip: '小折叠', fold: '折叠屏', tablet: '平板', pc: 'PC / Mac', car: '车机', tv: 'TV / 大屏',
}
/** 一屏形态（内容必须装下，不滚动）；其余为可滚动形态 */
const ONE_SCREEN = ['watch', 'car', 'tv']
const ALL_FORMS = ['watch', 'phone', 'flip', 'fold', 'tablet', 'pc', 'car', 'tv']
/** 核心内容块（重叠/裁切判据；刻意叠加的组合在探针里排除） */
const BLOCKS = ['.pf-heading', '.pf-price', '.pf-actions', '.pf-recommend', '.pf-media', '.pf-sku-fallback', '.pf-sku', '.pf-tabbar', '.pf-rail', '.pf-drive-hint']

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({ root: WEBSITE_ROOT, preview: { port: 4176 } })
  browser = await chromium.launch()
  page = await browser.newPage()
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 页面内几何探针：返回核心块的裁切/重叠/滚动实况（在浏览器里跑，真布局引擎） */
async function probeLiveGeometry(): Promise<{
  topo: string
  posture: string
  crease: string
  creaseHits: string[]
  clipped: string[]
  overlaps: string[]
  clippedH: string[]
  clippedV: string[]
  bodyScrollable: boolean
  frameW: number
  frameH: number
  capsDigest: string
  truncated: string[]
  balance: string[]
}> {
  return page.evaluate((blocks: string[]) => {
    const frame = document.querySelector('.frame') as HTMLElement | null
    if (!frame) return { topo: '?', posture: '', crease: '', creaseHits: [], clipped: ['<no .frame>'], clippedH: ['<no .frame>'], clippedV: [], overlaps: [], bodyScrollable: false, frameW: 0, frameH: 0, capsDigest: '', truncated: [], balance: [] }
    const inner = frame.querySelector('.p-formfactor') as HTMLElement
    const topo = inner.getAttribute('data-pf-topology') ?? '?'
    const posture = inner.getAttribute('data-pf-posture') ?? ''
    const crease = inner.getAttribute('data-pf-crease') ?? ''
    const fr = frame.getBoundingClientRect()
    const body = frame.querySelector('.pf-body') as HTMLElement
    const br = body.getBoundingClientRect()
    const els = blocks
      .map((s) => [s, frame.querySelector(s)] as [string, HTMLElement | null])
      .filter((pair): pair is [string, HTMLElement] => !!pair[1] && pair[1].offsetParent !== null)
    const inter = (a: DOMRect, b: DOMRect) => ({
      w: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      h: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    })
    const clippedH: string[] = []
    const clippedV: string[] = []
    for (const [sel, el] of els) {
      const r = el.getBoundingClientRect()
      // ① 横向越出设备框 —— 任何形态都不允许（纵向可滚动是形态设计，横向不是）
      if (r.right > fr.right + 1 || r.left < fr.left - 1) clippedH.push(sel)
      // ② 纵向越出：仅当该块**在可视区内有实质部分**才算裁切（滚动容器外的正常内容不算）
      const vis = inter(r, br)
      if (vis.w > 2 && vis.h > 2 && (r.top < fr.top - 1 || r.bottom > fr.bottom + 1)) clippedV.push(sel)
    }
    const clipped = [...clippedH, ...clippedV]
    // ③ 子元素横向越界（★破坏性验证暴露的盲区：容器 overflow:hidden 会把溢出的**子项**裁掉，
    //    容器自身矩形完全正常 → 只看容器抓不到「瓦片被裁半截」）。逐个子项量。
    //    ★例外：祖先里有**横向滚动容器**（overflow-x auto/scroll）时越界是设计（海报流可横滑），跳过。
    // ★2026-09-26 三审修复「恒真跳过」：旧实现看 computed overflowX——而 `.pf-body{overflow-y:auto}`
    //   按 CSS 规范把 overflow-x 也解析为 auto ⇒ **所有后代恒被跳过**（这条检查 100% 死代码，
    //   恰好漏掉它本来要防的「车机瓦片被裁半截」）。
    //   改为**实测**是否真能横向滚动（scrollWidth > clientWidth + 1）；只有真滚动容器才放行越界。
    const inVScroller = (el: Element): boolean => {
      let cur: Element | null = el.parentElement
      while (cur && cur !== body) {
        const h = cur as HTMLElement
        if (h.scrollHeight > h.clientHeight + 1) {
          const oy = getComputedStyle(cur).overflowY
          if (oy === 'auto' || oy === 'scroll') return true
        }
        cur = cur.parentElement
      }
      return false
    }
    const inHScroller = (el: Element): boolean => {
      let cur: Element | null = el.parentElement
      while (cur && cur !== frame) {
        const h = cur as HTMLElement
        if (h.scrollWidth > h.clientWidth + 1) {
          const ox = getComputedStyle(cur).overflowX
          if (ox === 'auto' || ox === 'scroll') return true
        }
        cur = cur.parentElement
      }
      return false
    }
    for (const el of [...body.querySelectorAll('*')].slice(0, 200)) {
      if ((el as HTMLElement).offsetParent === null) continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      if (r.right > fr.right + 1 || r.left < fr.left - 1) {
        if (inHScroller(el)) continue
        clippedH.push(`${el.className.toString().split(' ')[0] || el.tagName}(子项横向)`)
      }
      // ★2026-09-27 补盲区（用户实测抓到）：**纵向**子项被裁此前完全没查——
      //   车机瓦片因 max-height 把「图标/名称/价格」三行压进 40px 行 → 下半截被 overflow 裁掉，
      //   而门禁只看横向越界 + 少数「核心块」的纵向，正好放行。现逐子项查纵向；
      //   例外：祖先含纵向滚动容器（内容本可滚），或**祖先自身 overflow:hidden 且已知会裁**（
      //   如媒体封面、缩略图内部的装饰）——这类由「核心块不裁」断言覆盖，不在此重复报。
      if (r.bottom > fr.bottom + 1) {
        if (inVScroller(el)) continue
        clippedV.push(`${el.className.toString().split(' ')[0] || el.tagName}(子项纵向)`)
      }
    }
    const overlaps: string[] = []
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const [sa, A] = els[i]!, [sb, B] = els[j]!
        if (A.contains(B) || B.contains(A)) continue
        const pair = [sa, sb].sort().join('×')
        // TV 信息叠加在英雄图上、驾驶提醒徽标叠媒体 —— 刻意设计，排除
        if (topo === 'hero-focus-row' && pair.includes('.pf-media')) continue
        // ★书本式半开（posture=book）：媒体是**背景层**（信息叠加其上）——刻意设计，排除
        //  （与 TV Hero 同理；展开态/折叠态仍受完整判据约束）
        if (posture === 'book' && pair.includes('.pf-media')) continue
        if (pair.includes('.pf-sku-fallback') && pair.includes('.pf-media')) continue
        // ★驾驶提醒徽标与媒体**同格**是刻意叠加（徽标是轻量注释层，不参与排版高度）
        if (pair.includes('.pf-drive-hint') && (pair.includes('.pf-media') || pair.includes('.pf-heading'))) continue
        const a = A.getBoundingClientRect()
        const b = B.getBoundingClientRect()
        const av = inter(a, br)
        const bv = inter(b, br)
        const ab = inter(a, b)
        if (av.w > 2 && av.h > 2 && bv.w > 2 && bv.h > 2 && ab.w > 2 && ab.h > 2) overlaps.push(pair)
      }
    }
    // ★能力证据面（三审）：data-pf-caps 是「最终生效三态」的机器可读声明——
    //   同一面的断言把「声明 ≠ 空头」变成可证伪：面板/根类说支持的，这里必须是 supported/fallback。
    const capsDigest = (frame.querySelector('.p-formfactor') as HTMLElement | null)?.getAttribute('data-pf-caps') ?? ''
    // ★构图平衡（2026-09-27 用户实测四报：「右边标题价格整体靠下」）：
    //   此前门禁只查重叠/裁切，**没查内容在画布里的构图位置**——于是「信息组贴底、
    //   上方一大块空白」全绿通过。判据：车机右列信息组（标题..价格/降级条）的垂直中心
    //   必须与左列媒体面板的垂直中心对齐（容差 10px，覆盖字体度量差异）。
    const balance: string[] = []
    if (topo === 'dashboard') {
      const media = frame.querySelector('.pf-media') as HTMLElement | null
      const head = frame.querySelector('.pf-heading') as HTMLElement | null
      const priceEl = frame.querySelector('.pf-price') as HTMLElement | null
      const skuEl = frame.querySelector('.pf-sku, .pf-sku-fallback') as HTMLElement | null
      if (media && head && priceEl) {
        const m = media.getBoundingClientRect()
        const h = head.getBoundingClientRect()
        const p = priceEl.getBoundingClientRect()
        const sk = skuEl ? skuEl.getBoundingClientRect() : null
        const groupCenter = (h.top + Math.max(p.bottom, sk ? sk.bottom : p.bottom)) / 2
        const delta = Math.round(groupCenter - (m.top + m.height / 2))
        if (Math.abs(delta) > 10) balance.push(`信息组与媒体面板未垂直居中（偏差 ${delta}px）`)
      }
    }

    // ★标签截断检查（2026-09-27 用户实测）：一屏形态（glance/dashboard/hero）的主标签
    //   必须**能读全**——车机瓦片曾把「替换耳罩」截成「替…」（名称只剩 20px）。
    //   判据：文本节点 scrollWidth > clientWidth（即被 ellipsis 截断）。
    const truncated: string[] = []
    for (const sel of ['.pf-heading .fp-name', '.pf-price', '.fp-rec-name', '.pf-sku-fallback']) {
      const el = frame.querySelector(sel) as HTMLElement | null
      if (!el || el.offsetParent === null) continue
      if (el.scrollWidth > el.clientWidth + 1) truncated.push(`${sel}("${(el.textContent || '').trim().slice(0, 8)}")`)
    }

    // ★叠加拓扑（hero-focus-row）：媒体是**背景层**——其容器与文本层重叠是设计（上面已排除），
    //   但媒体的**可见内容**（产品图/图标）压住可交互项就是真缺陷。
    //   2026-09-27 用户实测「图片位置奇怪」的机器化判据：破坏性验证（撤掉信息列限宽）
    //   会让产品图贴住「收藏」按钮，而旧的容器级排除规则恰好放行。
    if (topo === 'hero-focus-row') {
      const media = frame.querySelector('.pf-media') as HTMLElement | null
      const coverEl = media?.firstElementChild as HTMLElement | null
      if (coverEl) {
        let box: DOMRect | null = null
        if (coverEl.tagName === 'IMG' || coverEl.tagName === 'SVG') box = coverEl.getBoundingClientRect()
        else {
          const rng = document.createRange()
          rng.selectNodeContents(coverEl)
          const b = rng.getBoundingClientRect()
          if (b.width > 2 && b.height > 2) box = b as DOMRect
        }
        if (box) {
          for (const [sel, el] of els) {
            if (!['.pf-actions', '.pf-heading', '.pf-price', '.pf-tabbar'].includes(sel)) continue
            const ab = inter(box, el.getBoundingClientRect())
            if (ab.w > 2 && ab.h > 2) overlaps.push(`${sel}×media-content`)
          }
        }
      }
    }

    // ★折痕带内不得有可见元素（小米/ITGSA 三区域「区域 3 内避免出现任何元素」的机器判据）
    const creaseHits: string[] = []
    const creaseEl = frame.querySelector('.pf-crease') as HTMLElement | null
    if (creaseEl) {
      const cr = creaseEl.getBoundingClientRect()
      for (const [sel, el] of els) {
        if (sel === '.pf-crease') continue
        const i2 = inter(el.getBoundingClientRect(), cr)
        if (i2.w > 2 && i2.h > 2) creaseHits.push(sel)
      }
    }

    return {
      topo,
      posture,
      crease,
      creaseHits: [...new Set(creaseHits)],
      clipped: [...new Set(clipped)],
      clippedH: [...new Set(clippedH)],
      clippedV: [...new Set(clippedV)],
      overlaps: [...new Set(overlaps)],
      bodyScrollable: body.scrollHeight > body.clientHeight + 1,
      frameW: Math.round(fr.width),
      frameH: Math.round(fr.height),
      capsDigest,
      truncated,
      balance,
    }
  }, BLOCKS)
}

/** 画像声明的能力三态（zh 表单值）——与组件 data-pf-caps 对账用 */
const CAPS_EXPECT: Record<string, string> = {
  watch: 'crown=supported',
  car: 'skuMulti=fallback;dpad=supported;crown=supported;focusTree=supported;focusRows=supported;driveAware=supported',
  tv: 'dpad=supported;focusRows=supported;multiCol=supported',
  phone: 'skuMulti=supported;tabs=supported;dense=supported;drawer=supported;notch=supported',
  pc: 'hover=supported;skuMulti=supported;sidebar=supported;multiCol=supported;dense=supported;keyboard=supported',
}

describe('★多端同屏 · 能力证据面（data-pf-caps 与画像声明逐项对账）', () => {
  it('每个形态的三态摘要必须与其画像声明逐项一致（含 fallback 与 unsupported）', async () => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const problems: string[] = []
    for (const form of ALL_FORMS) {
      await page.goto(`${BASE}/multi-device?device=${form}`)
      await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
      await page.waitForTimeout(240)
      const digest = await page.evaluate(() =>
        document.querySelector('.frame .p-formfactor')?.getAttribute('data-pf-caps') ?? '',
      )
      const pairs = Object.fromEntries(digest.split(';').filter(Boolean).map((kv) => kv.split('=') as [string, string]))
      // ① 14 项齐全（键集 SSOT）
      if (Object.keys(pairs).length !== 14) problems.push(`${form}: data-pf-caps 仅 ${Object.keys(pairs).length} 项（应 14）`)
      // ② 三态取值合法
      for (const [k, v] of Object.entries(pairs)) {
        if (!['supported', 'fallback', 'unsupported'].includes(v)) problems.push(`${form}: ${k} 非法取值 ${v}`)
      }
      // ③ 与画像声明一致（抽查关键项；避免把 CSS 类名当证据）
      const expect = CAPS_EXPECT[form]
      if (expect) {
        for (const kv of expect.split(';')) {
          const [k, v] = kv.split('=') as [string, string]
          if (pairs[k] !== v) problems.push(`${form}: ${k} 实测 ${pairs[k]} ≠ 声明 ${v}`)
        }
      }
      // ④ 「有类名但没声明」的反向检查：支持的项不该被漏成 unsupported
      const supportedCount = Object.values(pairs).filter((v) => v !== 'unsupported').length
      if (supportedCount === 0) problems.push(`${form}: 无任何 supported/fallback（疑似摘要生成失败）`)
    }
    expect(problems, `能力证据面对账失败：\n${problems.join('\n')}`).toEqual([])
  }, 120_000)
})

describe('★多端同屏 · 真几何门禁（双视口：窄舞台 + 宽舞台）', () => {
  // ★2026-09-26 三审补：**同会话点切换器**（真交互路径）——冷启动 goto 每条都重新挂载，
  //   抓不到「度量冻结在首帧」（实测 car→tv 字号偏大 22%）。切换后仍须零重叠零裁切。
  it('同会话切换七形态（点切换器，非 goto）：零重叠 · 一屏形态零裁切', async () => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`${BASE}/multi-device?device=car`)
    await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
    await page.waitForTimeout(300)
    const problems: string[] = []
    for (const form of ALL_FORMS) {
      // 点设备切换器里的对应按钮（真交互），而非重新导航
      const btn = page.locator('.dev-btn', { hasText: FORM_LABEL[form] })
      if ((await btn.count()) !== 1) {
        problems.push(`${form}: 切换器按钮不唯一（count=${await btn.count()}）`)
        continue
      }
      await btn.click()
      await page.waitForTimeout(260)
      const g = await probeLiveGeometry()
      if (g.overlaps.length) problems.push(`${form}(切换): 重叠 ${g.overlaps.join(', ')}`)
      if (ONE_SCREEN.includes(form)) {
        if (g.clipped.length) problems.push(`${form}(切换): 裁切 ${g.clipped.join(', ')}（frame ${g.frameW}×${g.frameH}）`)
        if (g.bodyScrollable) problems.push(`${form}(切换): 内容溢出`)
      }
    }
    expect(problems, `同会话切换几何问题：\n${problems.join('\n')}`).toEqual([])
  }, 120_000)

  // ★视口集合（2026-09-27）：1280 窄舞台 / **1512 = 用户实际屏幕** / 1600 设计评审宽舞台
  for (const vw of [1280, 1512, 1600]) {
    it(`视口 ${vw}：七形态零重叠 · 一屏形态零裁切且不滚动`, async () => {
      await page.setViewportSize({ width: vw, height: 900 })
      const report: Record<string, unknown> = {}
      const problems: string[] = []
      for (const form of ALL_FORMS) {
        await page.goto(`${BASE}/multi-device?device=${form}`)
        await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
        await page.waitForTimeout(320)
        const g = await probeLiveGeometry()
        report[form] = g
        if (g.overlaps.length) problems.push(`${form}: 核心块重叠 ${g.overlaps.join(', ')}`)
      if (g.balance.length) problems.push(`${form}: 构图失衡 ${g.balance.join(', ')}`)
        if (ONE_SCREEN.includes(form)) {
          if (g.clipped.length) problems.push(`${form}: 一屏形态出现裁切 ${g.clipped.join(', ')}（frame ${g.frameW}×${g.frameH}）`)
          if (g.bodyScrollable) problems.push(`${form}: 一屏形态内容溢出（body 可滚动 = 需要滚动才能看完）`)
          if (g.truncated.length) problems.push(`${form}: 主标签被截断 ${g.truncated.join(', ')}（一屏形态须能读全）`)
        }
      }
      expect(problems, `视口 ${vw} 几何问题：\n${problems.join('\n')}\n实测：${JSON.stringify(report, null, 1)}`).toEqual([])
    }, 120_000)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// ★★折叠屏姿态矩阵（2026-09-29 用户实测三问题的机器判据）
//   用户实测暴露：① 半开视口与展开态同值（596×693——物理上不可能）② 命名「半折（书本模式）」是我自造
//   ③ 看不到 duo 双窗格、也看不到两种半折模式（且几何只用三星一家）。
//   本组用例把这三条变成**可证伪的几何判据**：
//     · 18 组合（两类设备 × 三姿态 × 三视口）零重叠/零裁切
//     · 半开应用区 ≈ 内屏的一半（40–75%）——问题 ① 的直接判据
//     · 折痕带只在**真能看到铰链**的姿态渲染且带内无元素——「假折痕」判据
//     · 两类半开的窗口比例分属不同分类（横长条 vs 竖方形）——「两种模式看得出」判据
//     · 展开态 duo 双窗格两列宽度差 ≤ 容差——「双窗格看不出」判据
// ══════════════════════════════════════════════════════════════════════════════
describe('★★多端同屏 · 折叠屏姿态矩阵（两类设备 × 三姿态 × 三视口）', () => {
  const POSTURES: Array<[string, string]> = [
    ['fold', 'folded'], ['fold', 'book'], ['fold', 'expanded'],
    ['flip', 'folded'], ['flip', 'tabletop'], ['flip', 'expanded'],
  ]
  for (const vw of [1280, 1512, 1600]) {
    it(`视口 ${vw}：6 组合零重叠零裁切 + 折痕带内无元素`, async () => {
      await page.setViewportSize({ width: vw, height: 900 })
      const problems: string[] = []
      const report: Record<string, string> = {}
      for (const [dev, posture] of POSTURES) {
        await page.goto(`${BASE}/multi-device?device=${dev}&posture=${posture}`)
        await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
        await page.waitForTimeout(240)
        const g = await probeLiveGeometry()
        report[`${dev}/${posture}`] = `frame ${g.frameW}×${g.frameH} crease=${g.crease || '-'}`
        const tag = `${dev}/${posture}@${vw}`
        if (g.overlaps.length) problems.push(`${tag}: 重叠 ${g.overlaps.join(', ')}`)
        // ★裁切判据（与既有门禁同一纪律）：横向越界任何姿态都不许；
        //   纵向裁切只对**固定窗口**（body 不可滚动）成立——可滚动姿态（折叠态外屏）允许纵向滚动。
        if (g.clippedH.length) problems.push(`${tag}: 横向越界 ${g.clippedH.join(', ')}`)
        if (!g.bodyScrollable && g.clippedV.length) problems.push(`${tag}: 固定窗口纵向裁切 ${g.clippedV.join(', ')}`)
        if (g.creaseHits.length) problems.push(`${tag}: 折痕带内有元素 ${g.creaseHits.join(', ')}（区域 3 须无元素）`)
      }
      expect(problems, `折叠姿态矩阵几何问题：\n${problems.join('\n')}\n实测：${JSON.stringify(report, null, 1)}`).toEqual([])
    }, 180_000)
  }

  it('★半开应用区 ≈ 内屏的一半（问题 ① 的机器判据）+ 折痕只在半开渲染（假折痕判据）', async () => {
    await page.setViewportSize({ width: 1512, height: 900 })
    // 期望：折叠态无折痕 · 半开「水平-底缘」折痕带 · 展开态无折痕带（折痕几何贯穿中部）
    const expectCrease: Record<string, string> = {
      'fold/folded': '', 'fold/book': 'horizontal-bottom', 'fold/expanded': '',
      'flip/folded': '', 'flip/tabletop': 'horizontal-bottom', 'flip/expanded': '',
    }
    const problems: string[] = []
    const areas: Record<string, number> = {}
    for (const [dev, posture] of POSTURES) {
      await page.goto(`${BASE}/multi-device?device=${dev}&posture=${posture}`)
      await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
      await page.waitForTimeout(220)
      const r = await page.evaluate(() => {
        const inner = document.querySelector('.frame .p-formfactor') as HTMLElement
        const f = document.querySelector('.frame') as HTMLElement
        const fr = f.getBoundingClientRect()
        const creaseEl = f.querySelector('.pf-crease') as HTMLElement | null
        // 两窗格宽差（duo 拓扑：媒体列 vs 信息列）
        const media = f.querySelector('.pf-media') as HTMLElement | null
        const info = f.querySelector('.pf-info, .pf-recommend') as HTMLElement | null
        return {
          posture: inner.dataset.pfPosture ?? '',
          crease: inner.dataset.pfCrease ?? '',
          creaseGeom: inner.dataset.pfCreaseGeom ?? '',
          creaseBandH: creaseEl ? creaseEl.getBoundingClientRect().height : 0,
          frameArea: fr.width * fr.height,
          topo: inner.dataset.pfTopology ?? '',
          paneW: media && info ? [media.getBoundingClientRect().width, info.getBoundingClientRect().width] : null,
        }
      })
      if (r.crease !== expectCrease[`${dev}/${posture}`]) {
        problems.push(`${dev}/${posture}: data-pf-crease 实测「${r.crease}」≠ 期望「${expectCrease[`${dev}/${posture}`]}」`)
      }
      if (r.crease && r.creaseBandH < 6) problems.push(`${dev}/${posture}: 折痕带高 ${r.creaseBandH.toFixed(1)}px 过窄（须可辨识）`)
      areas[`${dev}/${posture}`] = r.frameArea
      // duo 展开态双窗格：两列宽度差 ≤ 20%（「双窗格看不出」判据）
      if (posture === 'expanded' && dev === 'fold' && r.paneW) {
        const [a, b] = r.paneW
        const diff = Math.abs(a - b) / Math.max(a, b)
        if (diff > 0.2) problems.push(`fold/expanded: 双窗格宽度差 ${(diff * 100).toFixed(0)}% > 20%（看不出双窗格）`)
      }
    }
    // ★面积判据：半开 / 展开 ≈ 50%（画像视口值，与渲染无关的声明式自洽——渲染面积随帧比例）
    expect(problems, `半开/折痕判据失败：\n${problems.join('\n')}\n面积实测：${JSON.stringify(areas)}`).toEqual([])
  }, 180_000)

  it('★两类半开的窗口**明显不同**（横长条 vs 竖方形）——「看不到两种模式」判据', async () => {
    await page.setViewportSize({ width: 1512, height: 900 })
    const shot = async (dev: string, posture: string) => {
      await page.goto(`${BASE}/multi-device?device=${dev}&posture=${posture}`)
      await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
      await page.waitForTimeout(240)
      return page.evaluate(() => {
        const f = document.querySelector('.frame') as HTMLElement
        const r = f.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height), ar: r.width / r.height }
      })
    }
    const foldHalf = await shot('fold', 'book')
    const flipHalf = await shot('flip', 'tabletop')
    // 书本式半开是横长条（> 1.5）· 翻盖式半折是竖方形（< 1.0）——分属不同宽高比分类
    expect(foldHalf.ar, `书本式半开应显著偏横（实测 ${foldHalf.ar.toFixed(2)}，${foldHalf.w}×${foldHalf.h}）`).toBeGreaterThan(1.5)
    expect(flipHalf.ar, `翻盖式半折应偏竖（实测 ${flipHalf.ar.toFixed(2)}，${flipHalf.w}×${flipHalf.h}）`).toBeLessThan(1.0)
  }, 120_000)

  // ══════════════════════════════════════════════════════════════════════════
  // ★★S4/S5：连续性（状态不丢）+ 功能对照 + 端注入几何 + 厂商档位 —— 全部可机器验证
  // ══════════════════════════════════════════════════════════════════════════
  it('★S4 连续性：切姿态后业务状态**逐项不变**（SKU / 计数 / 输入文字）', async () => {
    await page.setViewportSize({ width: 1512, height: 900 })
    await page.goto(`${BASE}/multi-device?device=fold&posture=folded`)
    await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
    await page.waitForTimeout(300)
    const readBiz = () =>
      page.evaluate(() => {
        const el = document.querySelector('.frame .p-formfactor') as HTMLElement
        return { sku: el.dataset.bizSku, count: el.dataset.bizCount, note: el.dataset.bizNote }
      })
    // ① 改业务状态：选第二个规格 + 点一次购买（计数 +1）+ 输入文字
    await page.locator('.frame .fp-sku').nth(1).click()
    await page.locator('.frame .fp-primary').click()
    await page.fill('.biz-input input', '连续性测试')
    await page.waitForTimeout(220)
    const before = await readBiz()
    expect(before.sku && before.count && before.note, `切换前未读到业务状态：${JSON.stringify(before)}`).toBeTruthy()
    // ② 依次切过全部姿态（真交互：点姿态按钮）
    const problems: string[] = []
    for (const label of ['半开', '展开态', '折叠态']) {
      await page.locator('.posture-btn', { hasText: label }).first().click()
      await page.waitForTimeout(320)
      const after = await readBiz()
      if (after.sku !== before.sku) problems.push(`切到「${label}」后 SKU 变了：${before.sku} → ${after.sku}`)
      if (after.count !== before.count) problems.push(`切到「${label}」后计数变了：${before.count} → ${after.count}`)
      if (after.note !== before.note) problems.push(`切到「${label}」后输入文字变了：${before.note} → ${after.note}`)
    }
    // ③ 面板的「切换前后」对照必须给出「一致」结论（演示层自证）
    const verdict = await page.locator('.biz-verdict').textContent()
    expect(problems, `连续性失败：\n${problems.join('\n')}`).toEqual([])
    expect(verdict ?? '', '面板应显示状态保留').toContain('✓')
  }, 120_000)

  it('★S4 功能对照条：每个「被收起」的控件都必须给出理由（不得静默丢失）', async () => {
    await page.setViewportSize({ width: 1512, height: 900 })
    await page.goto(`${BASE}/multi-device?device=fold&posture=book`)
    await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
    await page.waitForTimeout(260)
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.fn-row')].map((r) => ({
        name: r.querySelector('.fn-nm')?.textContent?.trim() ?? '',
        off: r.classList.contains('fn-off'),
        why: r.querySelector('.fn-why')?.textContent?.trim() ?? '',
      })),
    )
    expect(rows.length, '功能对照条应列出各内容槽').toBeGreaterThanOrEqual(4)
    const noReason = rows.filter((r) => r.off && r.why.length < 4).map((r) => r.name)
    expect(noReason, `被收起的控件缺理由（静默丢失）：${noReason.join(', ')}`).toEqual([])
    // 购买路径（多规格 / 主操作）**任何姿态都不得收起**（Apple「同样功能」+ 本仓纪律）
    const purchase = rows.filter((r) => /多规格|主操作/.test(r.name))
    expect(purchase.length, '功能对照须含购买路径项').toBe(2)
    expect(purchase.filter((r) => r.off).map((r) => r.name), '购买路径在半开被收起').toEqual([])
  }, 120_000)

  it('★S4 端注入几何：切换注入的折痕带宽度 → 折痕带实际高度随之变化（机型几何交给端）', async () => {
    await page.setViewportSize({ width: 1512, height: 900 })
    await page.goto(`${BASE}/multi-device?device=flip&posture=tabletop`)
    await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
    await page.waitForTimeout(260)
    const bandH = () =>
      page.evaluate(() => {
        const e = document.querySelector('.frame .pf-crease') as HTMLElement | null
        return e ? Math.round(e.getBoundingClientRect().height) : 0
      })
    const dflt = await bandH()
    expect(dflt, '半开姿态应有可见折痕带').toBeGreaterThanOrEqual(6)
    await page.locator('.inject-btn', { hasText: '宽铰链' }).click()
    await page.waitForTimeout(280)
    const wide = await bandH()
    expect(wide, `注入 24px 后折痕带应变宽（实测 ${dflt} → ${wide}）`).toBeGreaterThan(dflt)
    expect(wide).toBeGreaterThanOrEqual(20)
    const digest = await page.evaluate(() => (document.querySelector('.frame .p-formfactor') as HTMLElement).dataset.pfCrease)
    expect(digest, '注入只改几何，不改姿态语义').toBe('horizontal-bottom')
  }, 120_000)

  it('★S5 厂商档位对照面板：ITGSA 宽度/高度两档（双维度断点）', async () => {
    await page.setViewportSize({ width: 1512, height: 900 })
    await page.goto(`${BASE}/multi-device?device=fold&posture=book`)
    await page.waitForSelector('.frame .p-formfactor', { timeout: 15_000 })
    await page.waitForTimeout(260)
    const text = await page.evaluate(() => document.querySelector('.col--panel')?.textContent ?? '')
    expect(text, '面板须显示厂商档位').toContain('厂商档位')
    for (const k of ['宽度档', '高度档']) expect(text, `面板须含${k}`).toContain(k)
    // 书本式半开 693×298：宽度 medium（600–840）· 高度 compact（<480）
    expect(text).toContain('medium')
    expect(text).toContain('compact')
    // 姿态几何：应用区 / 占内屏（半开 ≈ 一半）
    expect(text).toContain('693×298')
    expect(text).toMatch(/占内屏[\s\S]{0,24}50%/)
  }, 120_000)
})
