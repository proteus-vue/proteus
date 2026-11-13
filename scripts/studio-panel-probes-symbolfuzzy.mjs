/**
 * scripts/studio-panel-probes-symbolfuzzy.mjs —— 符号面板模糊匹配探针（决策 #1499）
 *
 * 【为什么单开一个文件】`studio-panel-probes.mjs` 在 HEAD 已 1165 行（超 1000 行硬上限
 *   的既存项），新探针一律进独立模块 —— 与 #1498 的 diagcycle 同一走向。
 *
 * 【判据走真实入口】全程 `page.keyboard.type` 敲键，读的是**用户可见的列表条目与副标题**，
 *   不给 input 赋值、不注入 q。★刻意不 `click` 输入框：指针一移进面板就会触发
 *   卡片/面板的 leave 链，面板可能在打字途中自己收起；沿用 ㊿t 的「全局 keydown 接首个
 *   可见字符并聚焦」这条路，鼠标始终停在不干扰的位置。
 *
 * 【三段分别钉住哪一档】
 *   `uas` → 词首缩写（`useAutoSave`）；`bs` → 驼峰缩写（`BridgeState`）；
 *   `ss`  → 子序列（`Stats`，连续子串搜不到）。三段副标题都必须显示「匹配 N/80」，
 *   否则「列表恰好有这几项」也可能是没过滤成功的残留态。
 */
const BRIDGE_ROW = '#codeFiles button[data-file="packages/studio/ui/src/bridge.ts"]'

async function openPanel(page) {
  await page.hover(BRIDGE_ROW)
  await page.waitForTimeout(520)
  await page.click('#fileHoverCard .fv-row.more').catch(() => {})
  await page.waitForTimeout(420)
  return page.evaluate(() => !!document.getElementById('symbolPanel'))
}

const read = (page) =>
  page.evaluate(() => {
    const p = document.getElementById('symbolPanel')
    if (!p) return null
    return {
      names: [...p.querySelectorAll('.sym-i .sym-nm')].map((e) => e.textContent?.trim() ?? ''),
      sub: p.querySelector('.sym-sub')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      empty: p.querySelector('.sym-empty')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }
  })

/** 换一个查询：删掉上一次的字符（真实 Backspace），再真实敲入新串 */
async function retype(page, text, erase) {
  for (let i = 0; i < erase; i += 1) await page.keyboard.press('Backspace')
  await page.keyboard.type(text, { delay: 40 })
  await page.waitForTimeout(260)
  return read(page)
}

export async function probeSymbolFuzzy(page) {
  const opened = await openPanel(page)
  if (!opened) return { opened: false }

  const uas = await retype(page, 'uas', 0)
  const bs = await retype(page, 'bs', 3)
  const ss = await retype(page, 'ss', 2)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const closed = await page.evaluate(() => !document.getElementById('symbolPanel'))
  await page.mouse.move(5, 5)
  await page.waitForTimeout(260)
  return { opened: true, uas, bs, ss, closed }
}
