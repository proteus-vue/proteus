// tests/e2e-showcase-render.test.ts
// ★showcase 页面渲染门禁（E2E）——★用户实测教训（2026-09-13）后新增：
//   p-button 在 Web 端因缺 style.css 而不可见，此前 E2E 只断言路由/data/文本 → 全绿却人眼可见故障。
//   本 spec 对 showcase 每个页面跑「非空白 + 关键元素可见 + 无 console 错误」，
//   **人眼能看到的渲染故障，这里必须红**。
// 运行：npm run test:e2e:showcase（先 build:web）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { preview } from 'vite'
import type { PreviewServer } from 'vite'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { createWebDriver } from '@proteus-vue/test-core/driver'
import { assertPageRendered } from '@proteus-vue/test-core'

const SHOWCASE_ROOT = path.resolve(__dirname, '../showcase')
const PORT = 4175
const BASE = `http://localhost:${PORT}`

/** 页面 → 关键元素选择器（该页至少应有一个可见） + 预期总数/可见占比
 *  ★expectedCount / minVisibleRatio 是抓「按钮都不见了」的关键（minVisible=1 抓不住整体消失） */
const PAGES: Array<{ route: string; keySelector: string; label: string; minVisibleRatio: number; expectedCount?: number }> = [
  { route: '/pages/index', keySelector: 'img, svg, [class*=sp-], [class*=row]', label: '首页（品牌立方体+分区卡）', minVisibleRatio: 0.8 },
  // ★详情页已迁入分包（2026-09-13）：subpackages/<pkg>/pages/<name>
  // ★p-button 页：实测 18 个按钮全部可见（2026-09-13：theme 5 + 平台宏 1 + open-type 契约 2）——
  //   少于 18 个即「按钮消失」（用户 2026-09-13 报告的故障类型）
  { route: '/subpackages/components/pages/p-button', keySelector: 'button', label: 'p-button（真渲染按钮）', minVisibleRatio: 1, expectedCount: 18 },
  { route: '/subpackages/components/pages/p-input', keySelector: 'input', label: 'p-input（真渲染输入框）', minVisibleRatio: 1, expectedCount: 2 },
  // ★p-switch 页（2026-09-13 批次 1）：7 个开关全部可见（基础 1 + 禁用 2 + 类型 2 + 颜色 1 + 加载 1）
  { route: '/subpackages/components/pages/p-switch', keySelector: '.p-switch', label: 'p-switch（真渲染开关）', minVisibleRatio: 1, expectedCount: 7 },
  // ★p-checkbox 页（2026-09-13 批次 1）：10 个复选框全部可见（基础 1 + 半选组 3 + 禁用 2 + 颜色 1 + 群选 3）
  { route: '/subpackages/components/pages/p-checkbox', keySelector: '.p-checkbox', label: 'p-checkbox（真渲染复选框）', minVisibleRatio: 1, expectedCount: 10 },
  // ★p-radio 页（批次 1）：5 个单选框（基础组 2 + 禁用 2 + 颜色 1）
  { route: '/subpackages/components/pages/p-radio', keySelector: '.p-radio', label: 'p-radio（真渲染单选框）', minVisibleRatio: 1, expectedCount: 5 },
  // ★p-picker 页（批次 1 · 中性标签定案）：4 个 <p-picker> 触发区（单列 / 多列 / 标题 / 禁用）——
  //   组件根类 .p-picker（Web → proteus-picker/WebPicker weui 滚轮；MP → 原生 picker）
  { route: '/subpackages/components/pages/p-picker', keySelector: '.p-picker', label: 'p-picker（真渲染选择器）', minVisibleRatio: 1, expectedCount: 4 },
  // ★p-slider 页（批次 1）：6 个滑块（基础 / 步长 / 颜色 / 尺寸 / show-value / 禁用）
  { route: '/subpackages/components/pages/p-slider', keySelector: '.p-slider', label: 'p-slider（真渲染滑块）', minVisibleRatio: 1, expectedCount: 6 },
  // ★p-progress 页（批次 1）：12 个进度条（线性 3 状态 + 环形 2 + 粗细 2 + 色 1 + 动画 2 + 信息 2）
  { route: '/subpackages/components/pages/p-progress', keySelector: '.p-progress', label: 'p-progress（真渲染进度条）', minVisibleRatio: 1, expectedCount: 12 },
  // ★p-textarea 页（批次 1）：6 个文本域（基础 / 占位符 / 长度 / 自动增高 / 键盘 / 禁用）
  { route: '/subpackages/components/pages/p-textarea', keySelector: '.p-textarea', label: 'p-textarea（真渲染文本域）', minVisibleRatio: 1, expectedCount: 6 },
  // ★批次 2（容器与外壳，2026-09-14）——expectedCount 为构建后实测值（见各页演示块）
  { route: '/subpackages/components/pages/p-view', keySelector: '.p-view', label: 'p-view（真渲染容器）', minVisibleRatio: 1, expectedCount: 4 },
  { route: '/subpackages/components/pages/p-text', keySelector: '.p-text', label: 'p-text（真渲染文本）', minVisibleRatio: 1, expectedCount: 5 },
  { route: '/subpackages/components/pages/p-icon', keySelector: '.p-icon', label: 'p-icon（真渲染图标）', minVisibleRatio: 1, expectedCount: 17 },
  { route: '/subpackages/components/pages/p-image', keySelector: '.p-image', label: 'p-image（真渲染图片）', minVisibleRatio: 1, expectedCount: 5 },
  { route: '/subpackages/components/pages/p-scroll-view', keySelector: '.p-scroll-view', label: 'p-scroll-view（真渲染滚动容器）', minVisibleRatio: 1, expectedCount: 4 },
  { route: '/subpackages/components/pages/p-router-link', keySelector: '.p-router-link', label: 'p-router-link（真渲染导航链接）', minVisibleRatio: 1, expectedCount: 5 },
  { route: '/subpackages/components/pages/p-nav-bar', keySelector: '.p-nav-bar', label: 'p-nav-bar（真渲染导航栏）', minVisibleRatio: 1, expectedCount: 5 },
  // ★p-page-container 弹出层初始 visibility:hidden → 用触发按钮断言页面渲染
  { route: '/subpackages/components/pages/p-page-container', keySelector: 'button', label: 'p-page-container（触发按钮可见）', minVisibleRatio: 1 },
  // ★批次 3（宿主能力，2026-09-16）——断言「页面结构真实渲染」（元素/占位/说明块可见）。
  //   ★宿主能力本身（真实地图/相机/广告/内嵌网页）需真机核验，见 docs/miniprogram-acceptance-checklist.md。
  //   expectedCount 为构建后实测值（见各页演示块数量）。
  { route: '/subpackages/components/pages/p-rich-text', keySelector: '.p-rich-text', label: 'p-rich-text（富文本真实渲染）', minVisibleRatio: 1, expectedCount: 3 },
  { route: '/subpackages/components/pages/p-canvas', keySelector: 'canvas', label: 'p-canvas（画布元素真实渲染）', minVisibleRatio: 1, expectedCount: 4 },
  { route: '/subpackages/components/pages/p-draggable', keySelector: '.p-draggable', label: 'p-draggable（可拖拽元素真实渲染）', minVisibleRatio: 1, expectedCount: 5 },
  { route: '/subpackages/components/pages/p-media', keySelector: '.p-media', label: 'p-media（媒体元素真实渲染）', minVisibleRatio: 1, expectedCount: 4 },
  { route: '/subpackages/components/pages/p-ad', keySelector: '.p-ad', label: 'p-ad（广告占位真实渲染）', minVisibleRatio: 1, expectedCount: 4 },
  { route: '/subpackages/components/pages/p-map', keySelector: '.p-map', label: 'p-map（地图宿主槽位真实渲染）', minVisibleRatio: 1, expectedCount: 5 },
  { route: '/subpackages/components/pages/p-camera', keySelector: '.p-camera', label: 'p-camera（相机预览区真实渲染）', minVisibleRatio: 1, expectedCount: 4 },
  { route: '/subpackages/components/pages/p-webview', keySelector: '.p-webview', label: 'p-webview（内嵌容器真实渲染）', minVisibleRatio: 1, expectedCount: 3 },
  { route: '/subpackages/capabilities/pages/camera', keySelector: '[class*=db], [class*=out]', label: 'useCamera（能力详情样板）', minVisibleRatio: 1 },
  // ★分组目录页（官网式信息架构）：断言分组卡片可见
  { route: '/pages/components', keySelector: '[class*=cat-group]', label: '组件库分组目录', minVisibleRatio: 1, expectedCount: 6 },
  { route: '/pages/capabilities', keySelector: '[class*=cat-group]', label: '能力分组目录', minVisibleRatio: 1, expectedCount: 10 },
  { route: '/pages/system-glass', keySelector: '[class*=glass], [class*=stage]', label: '液态玻璃', minVisibleRatio: 0.8 },
  { route: '/pages/engineering-state', keySelector: 'button', label: '状态管理（Pinia）', minVisibleRatio: 1 },
  { route: '/pages/semantics', keySelector: '[class*=pipe], [class*=code]', label: '语义与编译', minVisibleRatio: 0.8 },
]

let server: PreviewServer
let browser: Browser
let page: Page

beforeAll(async () => {
  server = await preview({
    root: SHOWCASE_ROOT,
    mode: 'web',
    build: { outDir: path.join(SHOWCASE_ROOT, 'dist/web') },
    preview: { port: PORT },
  })
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 390, height: 844 } })
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('★showcase 页面渲染门禁（非空白 + 关键元素可见 + 无 console 错误）', () => {
  for (const { route, keySelector, label, minVisibleRatio, expectedCount } of PAGES) {
    it(`${route}（${label}）`, async () => {
      const errs: string[] = []
      const onErr = (m: { type: () => string; text: () => string }) => { if (m.type() === 'error') errs.push(m.text()) }
      page.on('console', onErr as never)
      const onPageErr = (e: Error) => errs.push('PAGEERROR: ' + e.message)
      page.on('pageerror', onPageErr)
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.waitForTimeout(800)
        const driver = createWebDriver(page)
        // ★核心断言：人眼能看到的渲染故障必须红（含「元素整体消失」「大部分不可见」「白底白字」）
        const m = await assertPageRendered(driver, { keySelector, minVisible: 1, minVisibleRatio, expectedCount, minContrast: 1.5, assertNoErrors: false })
        expect(m.textLen, `${route} 疑似空白`).toBeGreaterThan(0)
        // 渲染错误单列（可能来自被测页自身的第三方资源，与"元素不可见"分开判）
        expect(errs.filter((e) => /Uncaught|undefined is not|is not a function/.test(e)), `${route} 渲染期 JS 错误`).toEqual([])
      } finally {
        page.off('console', onErr as never)
        page.off('pageerror', onPageErr)
      }
    })
  }

  // ★p-button 交互门禁（2026-09-13 用户实测教训）：按钮「存在且可见」还不够——
  //   还要能**按下有反馈**（此前 Web 端 hover-class 已加但背景不变；原生 disabled/loading 视觉/行为）。
  it('★/subpackages/components/pages/p-button 交互（点击反馈 + 禁用 + 加载态）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-button', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    // ① 按下反馈：mousedown 期间必须出现反馈——2026-09-13 二改后按下态是**叠加层**
    //    （background-image，保留基色相），故断言 background-image 出现（而非 backgroundColor 变化，
    //     后者在旧实现里是「替换背景」→ 彩色按钮会闪灰，正是要避免的观感）。
    const basic = page.locator('button:has-text("点击我")')
    // ★必须先滚入视口：页面变长后该按钮可能在视口外，mouse.down 用绝对坐标会落空（假阴性）
    await basic.scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    const imgIdle = await basic.evaluate((el) => getComputedStyle(el).backgroundImage)
    const box = await basic.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(120)
    const imgPressed = await basic.evaluate((el) => getComputedStyle(el).backgroundImage)
    await page.mouse.up()
    expect(imgPressed, '按下时应出现叠加层反馈（background-image 变化）').not.toBe(imgIdle)
    expect(imgPressed, '按下反馈应是渐变叠加层').toContain('gradient')
    // ② 禁用按钮不可点击：disabled 属性真实存在
    expect(await page.locator('button:has-text("禁用按钮")').isDisabled()).toBe(true)
    // ③ 加载态：点击「提交」→ loading 生效期间按钮禁用，1.2s 后恢复
    await page.click('button:has-text("提交")')
    await page.waitForTimeout(200)
    expect(await page.locator('button:has-text("提交")').isDisabled(), 'loading 期间应自动禁用').toBe(true)
    await page.waitForTimeout(1400)
    expect(await page.locator('button:has-text("提交")').isDisabled(), 'loading 结束应恢复').toBe(false)
  })

  // ★主题皮肤门禁（2026-09-13 编译器通道 POC）：
  //   命题「theme 属性 → 编译期落单类变体 → 组件自身 scoped wxss 定义」必须在**人眼可见**层面成立——
  //   只断言 class 名存在不够（可能变色规则根本没生效）。故断言**实际计算背景色**四色互异且各就各位。
  it('★/subpackages/components/pages/p-button 主题皮肤（四色实渲染 + 动态切换）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-button', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const bg = (text: string) =>
      page.locator(`button:has-text("${text}")`).first().evaluate((el) => getComputedStyle(el).backgroundColor)
    // 四套皮肤计算色 = 注册表色值（brand #7c5cff / success #22b573 / danger #ef4d4d / ghost 透明）
    const [brand, success, danger] = await Promise.all([bg('品牌'), bg('成功'), bg('危险')])
    expect(brand, 'brand 应为品牌紫').toBe('rgb(124, 92, 255)')
    expect(success, 'success 应为成功绿').toBe('rgb(34, 181, 115)')
    expect(danger, 'danger 应为危险红').toBe('rgb(239, 77, 77)')
    // 四色必须互异（否则说明变体未生效、全部退回缺省色）
    expect(new Set([brand, success, danger]).size, '四色应互异（变体未生效会全同）').toBe(3)
    // 动态切换：点击「切换主题」→ 背景实时改变（验证 :theme 运行时可变）
    const dyn = page.locator('button:has-text("切换主题")')
    const before = await dyn.evaluate((el) => getComputedStyle(el).backgroundColor)
    await dyn.click()
    await page.waitForTimeout(200)
    const after = await dyn.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(after, '动态 theme 切换应改变背景色').not.toBe(before)
  })

  // ★p-switch 状态区分门禁（2026-09-13 用户实测教训）：禁用/加载必须**可分辨**——
  //   故障：此前 loading 与 disabled 视觉完全相同（都只是淡化）且无加载指示，用户无法区分。
  it('★/subpackages/components/pages/p-switch 状态区分（禁用 vs 加载 vs 类型）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-switch', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const info = await page.evaluate(() => {
      const list = [...document.querySelectorAll('.p-switch')]
            return {
        count: list.length,
        // 加载态：包装层应有旋转指示器
        spinnerCount: list.filter((e) => e.querySelector('.p-switch__spinner')).length,
        // ★spinner 必须位于滑块**正中**（用户实测：此前偏移/飘在轨道中央）
        spinnerCenterDx: (() => {
          const sp = document.querySelector('.p-switch__spinner')
          const th = sp?.closest('.p-switch__thumb')
          if (!sp || !th) return null
          const sr = sp.getBoundingClientRect(); const tr = th.getBoundingClientRect()
          return +((sr.left + sr.width / 2) - (tr.left + tr.width / 2)).toFixed(1)
        })(),
        // 禁用态包装透明度（无 loading）
        disabledOpacity: list.filter((e) => e.classList.contains('p-switch--disabled'))
          .map((e) => getComputedStyle(e).opacity),
        loadingOpacity: list.filter((e) => e.classList.contains('p-switch--loading'))
          .map((e) => getComputedStyle(e).opacity),
        // shape=square：应为方角**开关**（52×32，与 round 同尺寸，仅圆角不同）——
        // 不再沿用官方 type=checkbox 的复选框形态（平台包袱，G-31 铁律）
        squareSize: list.filter((e) => e.classList.contains('p-switch--square')).map((e) => [(e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight]),
        roundRadius: list.filter((e) => e.classList.contains('p-switch--round')).map((e) => getComputedStyle(e).borderRadius),
      }
    })
    expect(info.count, '开关总数').toBe(7)
    expect(info.spinnerCount, '加载态应有旋转指示器（区别于禁用）').toBe(1)
    expect(new Set(info.disabledOpacity), '禁用态应淡化').not.toContain('1')
    expect(info.loadingOpacity[0], '加载态淡化应区别于禁用态').not.toBe(info.disabledOpacity[0])
    expect(Math.abs(info.spinnerCenterDx ?? 99), '加载指示器应位于滑块正中').toBeLessThanOrEqual(1)
    expect(info.squareSize[0], 'shape=square 应为方角开关（同尺寸 52×32）').toEqual([52, 32])
    expect(info.roundRadius[0], 'shape=round 应为圆角').toContain('16px')
  })

  // ★平台条件显隐门禁（2026-09-13）：Web 构建下——MP-only 块**完全不渲染**、Web-only 块渲染。
  //   命题：`v-if="__MP__"` 经构建期宏 + Vue 编译 → 死分支消除；若此处出现「客服会话」即为回归。
  it('★/subpackages/components/pages/p-button 平台宏（Web 构建：MP-only 块不出现）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-button', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const txt = await page.locator('body').innerText()
    expect(txt, 'MP-only 块（客服会话/open-type）不应出现在 Web').not.toContain('客服会话（仅小程序）')
    expect(txt, 'Web-only 块应出现').toContain('Web 端占位')
    expect(txt, 'Web 目标提示应出现').toContain('当前构建目标：Web')
    expect(txt, 'MP 目标提示不应出现').not.toContain('当前构建目标：小程序')
    // 注：页面**代码示例块**会显示 `__MP__` 源码文本（教学用途，宏替换在 script 模式跳过字符串）——
    //   故此处不断言「页面无 __MP__」；宏替换正确性由单元测试与「MP-only 块不渲染」保证。
  })

  // ★Web 交互行为门禁（2026-09-14 新增，用户真机/浏览器复测驱动）：
  //   背景——此前 Web E2E 只断言「元素存在且可见」，**不测交互行为**，于是
  //   「view 无按压反馈」「scroll 事件数字不变」「长按无菜单」「scroll-top 复位无效」全绿逃逸。
  //   本节对**行为**下断言（hover 时延 / scroll 载荷 / 长按菜单 / 受控滚动）。
  it('★/subpackages/components/pages/p-view 按压反馈（hover-start-time / hover-stay-time 时效）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-view', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    // hover-start-time=0 的演示块：按下立即出现按压类
    const box = page.locator('.box--hover').first()
    await box.scrollIntoViewIfNeeded()
    const bb = await box.boundingBox()
    await page.mouse.move(bb!.x + bb!.width / 2, bb!.y + bb!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(80)
    expect(await box.getAttribute('class'), '按下后应出现自定义按压类 demo-hover').toContain('demo-hover')
    await page.mouse.up()
    await page.waitForTimeout(400)
  })

  it('★/subpackages/components/pages/p-scroll-view 交互（scroll 载荷 + 受控 scroll-top 复位）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-scroll-view', { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    // ① scroll 事件载荷为**裸对象**（{ scrollTop }）：手动滚动后回显应含真实数字
    const sc = page.locator('.proteus-web-scroll-view').nth(2)
    await sc.evaluate((el) => { el.scrollTop = 150; el.dispatchEvent(new Event('scroll', { bubbles: true })) })
    await page.waitForTimeout(300)
    const outs = await page.locator('.out').allTextContents()
    expect(outs.join('|'), '★scroll 回显应含真实 scrollTop（载荷单层——数字必须变）').toMatch(/top=1[0-9]{2}/)
    // ② 受控 scroll-top：手动滚动（变量被回写）后点「回到顶部」应真的归 0
    await page.locator('button', { hasText: '回到顶部' }).click()
    await page.waitForTimeout(500)
    expect(await sc.evaluate((el) => el.scrollTop), '★点「回到顶部」后滚动位置应归 0').toBe(0)
    // ③ 点「滚到 200」应到 200
    await page.locator('button', { hasText: '滚到 200' }).click()
    await page.waitForTimeout(500)
    expect(await sc.evaluate((el) => el.scrollTop), '★点「滚到 200」后应为 200').toBe(200)
  })

  it('★/subpackages/components/pages/p-image 长按菜单（show-menu-by-longpress 的 Web 模拟）', async () => {
    await page.goto(BASE + '/subpackages/components/pages/p-image', { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    // 图片真实渲染（naturalWidth > 0——拦「src 无效/灰块」）
    const natW = await page.locator('.proteus-web-image').first().evaluate((el) => (el as HTMLImageElement).naturalWidth)
    expect(natW, '★图片应真实解码（naturalWidth > 0）').toBeGreaterThan(0)
    // 右键（长按等价）弹出菜单
    await page.locator('.proteus-web-image').last().click({ button: 'right', force: true })
    await page.waitForTimeout(300)
    expect(await page.locator('.proteus-web-image-menu').count(), '★长按/右键应弹出自绘菜单').toBeGreaterThan(0)
  })


  // ── ★G-07 液态玻璃：真交互锁（2026-09-19 补；此前仅有渲染断言）──
  //   命题「调整强度 → 玻璃观感真的改变」必须在**计算样式**层面成立——只断言元素存在不够
  //   （可能滑块没接线 / 强度未生效）。pg-glass 是框架旗舰能力（单入口铁律 GLS001-006），
  //   故锁：拖动强度 → `--pg-noise-opacity`（由 intensity 派生）实际变化。
  it('★/pages/system-glass 强度滑块：拖动 → 玻璃参数真的改变（噪声/模糊派生值）', async () => {
    await page.goto(BASE + '/pages/system-glass', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const glass = page.locator('.pg-glass').first()
    await glass.scrollIntoViewIfNeeded()
    const readVars = () =>
      glass.evaluate((el) => {
        const cs = getComputedStyle(el)
        return {
          noise: cs.getPropertyValue('--pg-noise-opacity').trim(),
          // ★用 getPropertyValue（标准方法，可读带前缀属性）——`cs.webkitBackdropFilter` 不在
          //   TS 的 CSSStyleDeclaration 声明里（CI vue-tsc 报 TS2551）；getPropertyValue 无此问题
          backdrop: cs.getPropertyValue('backdrop-filter') || cs.getPropertyValue('-webkit-backdrop-filter') || '',
        }
      })
    const before = await readVars()
    // 拖到最右（强度拉满）——用真实滑块交互而非直接改数据
    const slider = page.locator('.p-slider').first()
    await slider.scrollIntoViewIfNeeded()
    const box = await slider.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
    }
    await page.waitForTimeout(400)
    const after = await readVars()
    // 核心断言：强度变化必须**可观测**（噪声不透明度是 intensity 的直接派生；两者至少一项变化）
    const changed = before.noise !== after.noise || before.backdrop !== after.backdrop
    expect(changed, `★调整强度应改变玻璃参数（before=${JSON.stringify(before)} after=${JSON.stringify(after)}）`).toBe(true)
  })

  // ── ★转场动效：真交互锁（2026-09-19 补）──
  //   命题「点转场入口真的发生导航」——该页价值就是触发真实跳转（halfScreen/slideUp/scaleDown），
  //   若路由未接线则页面沦为静态展示。锁：点击后 URL 真的变化。
  it('★/pages/transitions 转场入口：点击真的触发导航（URL 变化）', async () => {
    await page.goto(BASE + '/pages/transitions', { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    const urlBefore = page.url()
    // 页面上任一可点条目（按钮/链接/catalog 行）——滚动后点击第一个
    const clickable = page.locator('button, a, [class*=chevron]').first()
    await clickable.scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
    if (await clickable.count()) {
      await clickable.click().catch(() => undefined)
      await page.waitForTimeout(900)
      expect(page.url(), '★点转场入口应真的导航（URL 变化）——否则页面只是静态展示').not.toBe(urlBefore)
    }
  })
})

// ── ★能力详情页自动覆盖门禁（2026-09-19）：新页不必手写进 PAGES 也会被验 ──
//   背景：PAGES 是手写清单 → 新增能力详情页**不会被自动覆盖**（静默漏检）；而能力详情页正在
//   批量补齐（2026-09-19 起 1 → 9，脚本 gen-capability-demo-pages.mjs 产出）。
//   本组用**目录扫描**自动发现所有能力详情页，逐页断言「渲染非空白 + 演示区有可点元素 +
//   点击后输出区发生变化」——第③条是本组的核心：证明演示**真交互**而非静态摆设。
describe('★能力详情页（自动发现：渲染 + 真交互）', () => {
  const CAP_DIR = path.resolve(__dirname, '../showcase/subpackages/capabilities/pages')
  const slugs = fs.existsSync(CAP_DIR)
    ? fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.vue')).map((f) => f.replace(/\.vue$/, '')).sort()
    : []

  it('★至少存在 1 个能力详情页（防目录被清空后本组静默空跑）', () => {
    expect(slugs.length, '能力详情页目录不应为空').toBeGreaterThan(0)
  })

  for (const slug of slugs) {
    it(`/subpackages/capabilities/pages/${slug}（渲染 + 交互）`, async () => {
      const route = `/subpackages/capabilities/pages/${slug}`
      const errs: string[] = []
      const onPageErr = (e: Error) => errs.push('PAGEERROR: ' + e.message)
      page.on('pageerror', onPageErr)
      try {
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.waitForTimeout(900)
        // ① 渲染非空白
        const textLen = (await page.evaluate(() => document.body.innerText)).length
        expect(textLen, `${route} 疑似空白`).toBeGreaterThan(20)
        // ② 演示区存在可点元素（能力页范式：demo-block 内至少一个按钮）
        const btns = page.locator('.db button, .db [role="button"], .db p-button')
        const btnCount = await btns.count()
        expect(btnCount, `${route} 演示区应有可点元素（按钮）`).toBeGreaterThan(0)
        // ③ ★核心：点击后输出区**真的变化**（证明真交互，而非静态摆设）
        const out = page.locator('.out').first()
        const before = (await out.textContent()) ?? ''
        await btns.first().scrollIntoViewIfNeeded()
        await btns.first().click({ timeout: 5000 }).catch(() => undefined)
        await page.waitForTimeout(1500)
        const after = (await out.textContent()) ?? ''
        expect(after, `${route} 点击后输出区应变化（真交互——原值 "${before.slice(0, 30)}"）`).not.toBe(before)
        expect(errs, `${route} 交互期 JS 错误`).toEqual([])
      } finally {
        page.off('pageerror', onPageErr)
      }
    })
  }
})
