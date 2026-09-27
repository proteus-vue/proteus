// tests/paint-order-probe.mjs
// ★★绘制序探针：用**真实 Chromium** 回答「定位元素 vs 在流元素」的层叠关系。
//
// 【为什么需要独立的探针脚本（而不是只跑对拍）】
//   命中正确性的核心是绘制序，而绘制序里最容易写错的一条是
//   「定位元素（relative/absolute）绘制在**在流**元素之上」。
//   我最初的实现是**纯树序**（子级按树序，不分相位）——那在「static 嵌套 + 内部 absolute」
//   场景下会画错、点错。这个探针脚本就是当时用来**判定真值**的工具：
//   它不经任何翻译层，直接问浏览器 `elementsFromPoint`。
//
// 【探针的判定结论】（结果冻结在 tests/golden/paint-order-probes.json）
//   D/E 两例证明：**相位按层叠上下文而非按父级** ——
//   深处 static 子树里的 absolute，仍绘制在更外层**后置**的 static 兄弟之上。
//
// 用法：node tests/paint-order-probe.mjs   （需 playwright；重新生成 golden）
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const CASES = [
  {
    id: 'A',
    desc: '在流在前，absolute 在后（同一父）',
    html: `<div id=w style="position:relative;width:200px;height:100px;background:#eee">
      <div id=infl style="position:static;width:100px;height:60px;margin-top:10px;background:#f00"></div>
      <div id=abs style="position:absolute;top:20px;left:20px;width:100px;height:60px;background:#00f"></div>
    </div>`,
  },
  {
    id: 'B',
    desc: 'absolute 在前，在流在后（★同父内树序颠倒——仍应 absolute 在上）',
    html: `<div id=w style="position:relative;width:200px;height:100px;background:#eee">
      <div id=abs style="position:absolute;top:20px;left:20px;width:100px;height:60px;background:#00f"></div>
      <div id=infl style="position:static;width:100px;height:60px;margin-top:10px;background:#f00"></div>
    </div>`,
  },
  {
    id: 'C',
    desc: '两个 relative 重叠（同相位 → 树序靠后在上）',
    html: `<div id=w style="position:relative;width:200px;height:100px;background:#eee">
      <div id=a style="position:relative;width:100px;height:60px;margin-top:10px;background:#f00"></div>
      <div id=b style="position:relative;top:-40px;left:20px;width:100px;height:60px;background:#00f"></div>
    </div>`,
  },
  {
    id: 'D',
    desc: '★A(static) 内的 absolute vs root 下后置的 static 兄弟 B',
    html: `<div id=root style="position:relative;width:200px;height:120px;background:#eee">
      <div id=A style="width:200px;height:60px">
        <div id=A1 style="position:absolute;top:20px;left:20px;width:100px;height:60px;background:#00f"></div>
      </div>
      <div id=B style="width:200px;height:60px;margin-top:-40px;background:#f00"></div>
    </div>`,
  },
  {
    id: 'E',
    desc: '★两层 static 嵌套内的 absolute vs 更外层后置 static（相位按层叠上下文，非按父级）',
    html: `<div id=root style="position:relative;width:200px;height:120px;background:#eee">
      <div id=A style="width:200px;height:60px">
        <div id=A0 style="width:200px;height:10px">
          <div id=A1 style="position:absolute;top:20px;left:20px;width:100px;height:60px;background:#00f"></div>
        </div>
      </div>
      <div id=B style="width:200px;height:60px;margin-top:-40px;background:#f00"></div>
    </div>`,
  },
  {
    id: 'F',
    desc: '纯 static 兄弟（基线：树序靠后在上）',
    html: `<div id=root style="width:200px;height:120px;background:#eee">
      <div id=X style="width:200px;height:40px;background:#0f0"></div>
      <div id=Y style="width:200px;height:40px;margin-top:-20px;background:#f00"></div>
    </div>`,
  },
]

const POINT = { x: 30, y: 40 }

const browser = await chromium.launch()
const page = await browser.newPage()
const out = []
for (const c of CASES) {
  await page.setContent(`<!doctype html><body style="margin:0">${c.html}</body>`)
  // ★elementsFromPoint 的原生顺序 = 自最上层到最下层（与 Rust hit_path 同序）
  const ids = await page.evaluate((p) => document.elementsFromPoint(p.x, p.y).map((e) => e.id).filter(Boolean), POINT)
  out.push({ id: c.id, desc: c.desc, point: POINT, topDownIds: ids })
  console.log(`${c.id}: ${c.desc}\n   点(${POINT.x},${POINT.y}) 自上层到下层 = [${ids.join(', ')}]`)
}
await browser.close()

const dest = path.resolve(import.meta.dirname, 'golden/paint-order-probes.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(
  dest,
  `${JSON.stringify(
    {
      generatedBy: 'tests/paint-order-probe.mjs（真实 Chromium）',
      note: '★绘制序真值：定位元素（relative/absolute）绘制在**在流**元素之上；相位按**层叠上下文**而非按父级（见 D/E）。Rust 侧 hit.rs 的两相位模型据此校准。',
      browser: browser.version?.() ?? 'chromium',
      probes: out,
    },
    null,
    2,
  )}\n`,
)
console.log(`\n✓ 已写入 ${dest}`)
