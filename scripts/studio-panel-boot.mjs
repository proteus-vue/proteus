// scripts/studio-panel-boot.mjs —— 起一个"真实浏览器环境"（决策 #1263 从门禁拆出）
//
// 【职责单一】静态服务 + chromium + 桩注入 + 首屏截图 + 收集 JS 错误。
//   判据脚本只关心"接下来点什么、断言什么"，不该被这些准备动作埋在中间。
// 【为什么必须走 http】Vite 产物是 ES module，`file://` 下会被 CORS 挡掉（见 serveDist）。
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { serveDist } from './studio-panel-serve.mjs'
import { stubTauri } from './studio-panel-stub.mjs'

/**
 * @param {{ dist: string, payload: object, outPath?: string }} a
 *   `payload` = 桩要喂给面板的读数（fixture 派生），会自动补上 ㉑ 用的大文件
 * @returns {Promise<{ page: import('playwright').Page, errors: string[], close: () => Promise<void> }>}
 */
export async function openPanel({ dist, payload, outPath }) {
  const { port, close: closeServer } = await serveDist(dist)
  const browser = await chromium.launch()
  /* ★用 context 而不是 browser.newPage()（决策 #1267）：独立设置窗口在判据里是
     **同一 context 里的第二个页面**。`browser.newPage()` 建的是单页 context，再 `newPage()`
     会直接抛 "Please use browser.newContext()"；而且 `context.addInitScript` 才能让新页面
     也拿到桩（否则设置窗口里没有 `__TAURI__`，一片空白）。 */
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()

  // ㉑ 用的大文件（4000 次循环 = 8000 行）：只在 localStorage.__BIG__=1 时返回
  const BIG_DOC = Array.from(
    { length: 4000 },
    (_, i) => `export const v${i + 1} = ${i + 1} // line ${i + 1}\nconst s${i + 1} = 'text-${i + 1}'`,
  ).join('\n')

  // 桩：只替换"值怎么送到页面"，其余与真机一致（含 set_canvas_rect 的调用）
  // ★`read_text` 也在这里桩掉：代码视图（G4 第一块砖）启动时会读文件，不桩就会抛"未实现"
  //   ⇒ 被判据 ⑧（无 JS 错误）判红。桩内容故意含 `const`，供判据 ⑪ 断言"面板真的渲染了内容"。
  await context.addInitScript(stubTauri, { ...payload, big: BIG_DOC })

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(`http://127.0.0.1:${port}/index.html`)
  await page.waitForTimeout(1200) // 轮询 500ms，等两拍
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    await page.screenshot({ path: outPath })
  }

  const close = async () => {
    await browser.close()
    closeServer()
  }
  return { page, errors, close, url: `http://127.0.0.1:${port}/index.html` }
}
