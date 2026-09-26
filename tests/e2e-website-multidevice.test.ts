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

/** 一屏形态（内容必须装下，不滚动）；其余为可滚动形态 */
const ONE_SCREEN = ['watch', 'car', 'tv']
const ALL_FORMS = ['watch', 'phone', 'fold', 'tablet', 'pc', 'car', 'tv']
/** 核心内容块（重叠/裁切判据；刻意叠加的组合在探针里排除） */
const BLOCKS = ['.pf-heading', '.pf-price', '.pf-actions', '.pf-recommend', '.pf-media', '.pf-sku-fallback', '.pf-tabbar']

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
  clipped: string[]
  overlaps: string[]
  bodyScrollable: boolean
  frameW: number
  frameH: number
}> {
  return page.evaluate((blocks: string[]) => {
    const frame = document.querySelector('.frame') as HTMLElement | null
    if (!frame) return { topo: '?', clipped: ['<no .frame>'], overlaps: [], bodyScrollable: false, frameW: 0, frameH: 0 }
    const inner = frame.querySelector('.p-formfactor') as HTMLElement
    const topo = inner.getAttribute('data-pf-topology') ?? '?'
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
    const clipped: string[] = []
    for (const [sel, el] of els) {
      const r = el.getBoundingClientRect()
      // ① 横向越出设备框 —— 任何形态都不允许（纵向可滚动是形态设计，横向不是）
      if (r.right > fr.right + 1 || r.left < fr.left - 1) clipped.push(sel)
      // ② 纵向越出：仅当该块**在可视区内有实质部分**才算裁切（滚动容器外的正常内容不算）
      const vis = inter(r, br)
      if (vis.w > 2 && vis.h > 2 && (r.top < fr.top - 1 || r.bottom > fr.bottom + 1)) clipped.push(sel)
    }
    // ③ 子元素横向越界（★破坏性验证暴露的盲区：容器 overflow:hidden 会把溢出的**子项**裁掉，
    //    容器自身矩形完全正常 → 只看容器抓不到「瓦片被裁半截」）。逐个子项量。
    //    ★例外：祖先里有**横向滚动容器**（overflow-x auto/scroll）时越界是设计（海报流可横滑），跳过。
    const inHScroller = (el: Element): boolean => {
      let cur: Element | null = el.parentElement
      while (cur && cur !== frame) {
        const ox = getComputedStyle(cur).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
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
        clipped.push(`${el.className.toString().split(' ')[0] || el.tagName}(子项)`)
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
        if (pair.includes('.pf-sku-fallback') && pair.includes('.pf-media')) continue
        const a = A.getBoundingClientRect()
        const b = B.getBoundingClientRect()
        const av = inter(a, br)
        const bv = inter(b, br)
        const ab = inter(a, b)
        if (av.w > 2 && av.h > 2 && bv.w > 2 && bv.h > 2 && ab.w > 2 && ab.h > 2) overlaps.push(pair)
      }
    }
    return {
      topo,
      clipped: [...new Set(clipped)],
      overlaps: [...new Set(overlaps)],
      bodyScrollable: body.scrollHeight > body.clientHeight + 1,
      frameW: Math.round(fr.width),
      frameH: Math.round(fr.height),
    }
  }, BLOCKS)
}

describe('★多端同屏 · 真几何门禁（双视口：窄舞台 + 宽舞台）', () => {
  for (const vw of [1280, 1600]) {
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
        if (ONE_SCREEN.includes(form)) {
          if (g.clipped.length) problems.push(`${form}: 一屏形态出现裁切 ${g.clipped.join(', ')}（frame ${g.frameW}×${g.frameH}）`)
          if (g.bodyScrollable) problems.push(`${form}: 一屏形态内容溢出（body 可滚动 = 需要滚动才能看完）`)
        }
      }
      expect(problems, `视口 ${vw} 几何问题：\n${problems.join('\n')}\n实测：${JSON.stringify(report, null, 1)}`).toEqual([])
    }, 120_000)
  }
})
