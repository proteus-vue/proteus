// scripts/studio-panel-perf.mjs —— 大文件着色性能的测量（决策 #1216 · #1223 拆出）
//
// 【为什么单独成文件】这段是"怎么量"，与"量到多少算过"（判据 ㉑）是两件事：
//   ① 测量口径改过两次（视口 anchor 行、首次跳动的布局成本），将来还可能改；
//   ② 判据脚本本身要过 file-size 门禁。
//
// 【口径（改之前先读）】
//   · 只统计**与滚动容器相交**的行里、颜色 ≠ 正文色的 span —— CM 会在视口上方留 anchor 行，
//     按"DOM 里第一个 .cm-line"判断会误判成"滚动不生效"（踩过）；
//   · reload 后第一次跳要付一次"全文档高度布局"的钱（153k px），那是加载成本，不是滚动成本
//     ⇒ 先做一次**不计时**的往返跳，再测。
export async function measureBigFile(page) {
// ★等"整篇解析完"的信号（UI 写在 #codeHost 的 data-parse 上），而不是 sleep 猜：
//   预热被摘掉时这个状态永远到不了 full ⇒ 下面的等待超时 + 冷跳超阈值，两条都会红。
let parseFull = true
try {
  await page.waitForFunction(
    () => document.getElementById('codeHost')?.getAttribute('data-parse') === 'full',
    { timeout: 8000 },
  )
} catch {
  parseFull = false
}
const perf = await page.evaluate(async () => {
  const sc = () => document.querySelector('.cm-scroller')
  while (!document.querySelector('.cm-content')) await new Promise((r) => requestAnimationFrame(r))
  const base = getComputedStyle(document.querySelector('.cm-content')).color
  const visibleColored = () => {
    const s = sc()
    if (!s) return 0
    const top = s.getBoundingClientRect().top
    const rows = [...document.querySelectorAll('.cm-line')].filter((n) => {
      const r = n.getBoundingClientRect()
      return r.bottom > top && r.top < top + s.clientHeight
    })
    return rows.filter((n) =>
      [...n.querySelectorAll('span')].some((x) => getComputedStyle(x).color !== base),
    ).length
  }
  const t0 = performance.now()
  while (performance.now() < t0 + 6000 && visibleColored() < 3) await new Promise((r) => requestAnimationFrame(r))
  const openMs = Math.round(performance.now() - t0)
  const s = sc()
  void openMs
  const scrollHeight = s.scrollHeight
  // ★先做一次**不计时**的往返跳：reload 后第一次跳要额外付一次"全文档高度布局"的钱（153k px），
  //   那属于加载成本，不是用户感知的滚动成本。只测第二次（稳态），才和"滚着看代码"同源。
  s.scrollTop = s.scrollHeight
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))
  s.scrollTop = 0
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))
  s.scrollTop = s.scrollHeight
  const t1 = performance.now()
  while (performance.now() < t1 + 6000 && visibleColored() < 3) await new Promise((r) => requestAnimationFrame(r))
  const cold1 = Math.round(performance.now() - t1)
  s.scrollTop = 0
  await new Promise((r) => requestAnimationFrame(r))
  await new Promise((r) => requestAnimationFrame(r))
  const t2 = performance.now()
  s.scrollTop = s.scrollHeight
  while (performance.now() < t2 + 6000 && visibleColored() < 3) await new Promise((r) => requestAnimationFrame(r))
  const cold2 = Math.round(performance.now() - t2)
  return { openMs, cold1, cold2, coldMs: cold1, scrollHeight }
})

  // parseFull 与 perf 合成一个结果：判据要的是"整篇解析完了没 + 冷跳多少毫秒"
  return { parseFull, ...perf }
}
