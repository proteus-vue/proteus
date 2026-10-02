// tests/consistency-web-probe.test.ts
// ★VC4-a：Web 端探针（真值基准）—— Playwright 实测
//
// 【这份测试在防什么（卡片 VC4-a 验收）】
//   ① 产出符合 VC3-a/b 格式（schema 校验器判定）
//   ② 快照稳定：同一页面连续两次采集**完全一致**（无时序噪声）
//   ③ golden test：写盘基线（入库），再次采集必须字节级一致（漂移即红）
//   ④ 视口坐标系：几何取值与浏览器的 getBoundingClientRect 语义一致（对抽样节点手算核对）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { validateGeometrySnapshot, validateStyleSnapshot } from '@proteus-vue/consistency'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROBE_IIFE = path.join(ROOT, 'packages/consistency/dist/probes/web.iife.js')
const GOLDEN_DIR = path.join(ROOT, 'tests', '__snapshots__', 'consistency')
const GOLDEN_GEO = path.join(GOLDEN_DIR, 'web-home.geometry.json')

/** 测试页：覆盖 VC3 核心属性 + 嵌套结构 + 显式 id（探针节点语义） */
const TEST_PAGE = `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: system-ui, sans-serif; }
  #proteus-root { width: 400px; height: 600px; background-color: #14141c; display: flex; flex-direction: column; padding: 12px; flex-shrink: 0; }
  .box { width: 200px; height: 60px; background-color: #2a3f66; margin-bottom: 8px; border-radius: 18px; flex-shrink: 0; overflow: hidden; }
  .text { width: 160px; height: 40px; color: #ffffff; font-size: 16px; font-weight: 700; margin-bottom: 8px; flex-shrink: 0; overflow: hidden; }
  .nested { width: 300px; height: 100px; background-color: #1f2c44; padding: 8px; flex-shrink: 0; overflow: hidden; }
  .nested .box { width: 100px; height: 24px; margin: 4px 0 0 4px; border-radius: 4px; overflow: visible; }
  /* ★覆盖收官（2026-10-02·三批）：绝对定位节点——覆盖 top/left（条件可见字段） */
  .abs { position: relative; width: 50px; height: 30px; top: 5px; left: 7px; background-color: #3a5a8a; flex-shrink: 0; }
</style></head><body>
  <div id="proteus-root" data-proteus-id="1" data-proteus-pid="p-view">
    <div class="box" data-proteus-id="2" data-proteus-pid="p-box"></div>
    <div class="text" data-proteus-id="3" data-proteus-pid="p-text">Hello 一致性</div>
    <div class="nested" data-proteus-id="4" data-proteus-pid="p-box">
      <div class="box"></div>
    </div>
    <div class="abs" data-proteus-id="5" data-proteus-pid="p-box"></div>
  </div>
</body></html>`

describe('VC4-a · Web 探针（真值基准）', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    // 探针 IIFE 必须已构建（测试前置由包 build 保证——缺失时给出可执行指引而非静默跳过）
    if (!fs.existsSync(PROBE_IIFE)) {
      execFileSync('npx', ['-y', 'pnpm@9.15.9', 'build'], { cwd: path.join(ROOT, 'packages/consistency'), stdio: 'pipe' })
    }
    expect(fs.existsSync(PROBE_IIFE), `探针 IIFE 未构建：${PROBE_IIFE}（先 cd packages/consistency && pnpm build）`).toBe(true)
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 800, height: 900 } })
    await page.setContent(TEST_PAGE, { waitUntil: 'load' })
    await page.addScriptTag({ path: PROBE_IIFE })
  })

  afterAll(async () => {
    await browser?.close()
  })

  /** 页内采集（同一遍历顺序；两快照同时取以减少跨调用时间差） */
  const collect = async (): Promise<{ geo: unknown; style: unknown }> =>
    (await page.evaluate(() => {
      const p = (globalThis as unknown as { __proteusWebProbe: { collectWebGeometry: (d: Document, o?: unknown) => unknown; collectWebStyle: (d: Document, o?: unknown) => unknown } }).__proteusWebProbe
      const opts = { rootSelector: '#proteus-root', fontsLocked: false }
      return { geo: p.collectWebGeometry(document, opts), style: p.collectWebStyle(document, opts) }
    })) as { geo: unknown; style: unknown }

  it('① 产出符合 VC3-a 几何格式（schema 校验器判定通过）', async () => {
    const { geo } = await collect()
    const r = validateGeometrySnapshot(geo)
    if (!r.ok) console.error(r.issues.slice(0, 8))
    expect(r.ok, `几何快照应通过 schema（问题 ${r.issues.length} 条）`).toBe(true)
    expect(r.nodeCount).toBe(6) // root + box + text + nested + nested.box + abs
  })

  it('② 产出符合 VC3-b 样式格式（归一化闭集）', async () => {
    const { style } = await collect()
    const r = validateStyleSnapshot(style)
    if (!r.ok) console.error(r.issues.slice(0, 8))
    expect(r.ok, `样式快照应通过 schema（问题 ${r.issues.length} 条）`).toBe(true)
    expect(r.nodeCount).toBe(6)
    const root = (style as { nodes: Array<{ nodeId: string; styles: Record<string, unknown> }> }).nodes.find((n) => n.nodeId === '1')!
    expect(root.styles.backgroundColor).toEqual({ r: 20, g: 20, b: 28, a: 1 }) // #14141c
    expect(root.styles.display).toBe('flex')
    const box = (style as { nodes: Array<{ nodeId: string; styles: Record<string, unknown> }> }).nodes.find((n) => n.nodeId === '2')!
    expect(box.styles.borderTopLeftRadius).toBe(18)
    // ★computed style 的语义（探针如实采集）：浏览器**总**会解析出 color（未声明 = initial = black）
    //   ——"比对解析后的值"（VC3-b）要的就是这个；"未设"与"设为 black"在计算后不可区分。
    expect(box.styles.color).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    // 而**全透明背景**是浏览器对未设背景的默认返回 ⇒ 探针需要它归省（否则每个节点都带 backgroundColor 噪声）
    expect(box.styles.backgroundColor).toEqual({ r: 42, g: 63, b: 102, a: 1 }) // #2a3f66（显式设了）
  })

  it('③ 几何与浏览器语义一致（抽样核对坐标与尺寸）', async () => {
    const { geo } = await collect()
    const root = (geo as { root: { x: number; y: number; w: number; h: number; children: Array<{ nodeId: string; x: number; w: number }> } }).root
    expect(root.x).toBe(0)
    expect(root.y).toBe(0)
    expect(root.w).toBe(400)
    expect(root.h).toBe(600)
    const box = root.children.find((c) => c.nodeId === '2')!
    // 视口坐标：padding 12 ⇒ x=12；宽度 200（box-sizing: border-box）
    expect(box.x).toBe(12)
    expect(box.w).toBe(200)
  })

  it('④ 快照稳定：连续两次采集完全一致（无时序噪声；卡片硬性验收）', async () => {
    const a = await collect()
    const b = await collect()
    expect(JSON.stringify(b.geo)).toBe(JSON.stringify(a.geo))
    expect(JSON.stringify(b.style)).toBe(JSON.stringify(a.style))
  })

  it('⑤ golden test：与入库基线字节级一致（漂移即红；基线刷新走 PROTEUS_UPDATE_GOLDEN=1）', async () => {
    const { geo, style } = await collect()
    const serialized = (await page.evaluate(
      (g) => (globalThis as unknown as { __proteusWebProbe: { serializeGeometry: (x: unknown) => string } }).__proteusWebProbe.serializeGeometry(g),
      geo,
    )) as string
    const golden = JSON.stringify({ geometry: serialized, style }, null, 2) + '\n'
    if (process.env.PROTEUS_UPDATE_GOLDEN === '1' || !fs.existsSync(GOLDEN_GEO)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true })
      fs.writeFileSync(GOLDEN_GEO, golden)
      // 基线是"生成即通过"的语义：首跑写盘（CI 上基线已入库 ⇒ 走比对分支）
      expect(fs.existsSync(GOLDEN_GEO)).toBe(true)
      return
    }
    const prev = fs.readFileSync(GOLDEN_GEO, 'utf-8')
    if (prev !== golden) {
      const prevObj = JSON.parse(prev) as { geometry: string; style: unknown }
      const prevGeo = JSON.parse(prevObj.geometry) as { root: { path: string; x: number; y: number; w: number; h: number } }
      const newGeo = JSON.parse(serialized) as { root: { path: string; x: number; y: number; w: number; h: number } }
      // 差异定位：逐节点比（给出"第 N 个节点哪一项差多少"——标准 §4.1 的"变更评审看数值 diff"）
      const diffs: string[] = []
      const flat = (n: { path: string; x: number; y: number; w: number; h: number; children?: unknown[] }, acc: Map<string, { x: number; y: number; w: number; h: number }>): void => {
        acc.set(n.path, { x: n.x, y: n.y, w: n.w, h: n.h })
        for (const c of (n.children ?? []) as Array<typeof n>) flat(c, acc)
      }
      const A = new Map(); const B = new Map()
      flat(prevGeo.root, A); flat(newGeo.root, B)
      for (const [k, a] of A) {
        const b = B.get(k)
        if (!b) { diffs.push(`节点 ${k} 在新快照缺失`); continue }
        for (const f of ['x', 'y', 'w', 'h'] as const) {
          if (a[f] !== b[f]) diffs.push(`path ${k}: ${f} ${a[f]} → ${b[f]}（Δ${Math.abs(a[f] - b[f]).toFixed(3)}px）`)
        }
      }
      expect(diffs, `golden 漂移（前 6 条）：\n${diffs.slice(0, 6).join('\n')}`).toEqual([])
    }
    expect(golden).toBe(prev)
  })
})
