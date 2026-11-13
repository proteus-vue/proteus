/**
 * scripts/studio-panel-probes-diagcycle.mjs —— 徽标循环跳探针（决策 #1498）
 *
 * 【为什么单开一个文件】`studio-panel-probes.mjs` 在 HEAD 已是 1165 行（超 1000 行
 *   上限的既存项），本单不能再往里加 40 行。与 checks-hover / probes-fileops 的
 *   既有走向一致：新增判据探针一律进独立模块。
 *
 * 【判据走真实入口】连点用 Playwright 真实鼠标；读的是徽标显示给用户的 `title`
 *   （「第 N/M 条」），不读内部变量、不注入伪造状态。
 *   ★诊断桩只写一份（`DIAG_PAYLOAD`）：徽标显示 / 跳转 / 循环 / 刷新归零共用。
 */
export const DIAG_PAYLOAD = [
  { path: 'packages/studio/ui/src/App.vue', line: 10, col: 1, code: 'TS2339', message: 'e1', severity: 'error' },
  { path: 'packages/studio/ui/src/App.vue', line: 12, col: 3, code: 'TS2322', message: 'e2', severity: 'error' },
  { path: 'packages/studio/ui/src/bridge.ts', line: 20, col: 1, code: 'no-unused-vars', message: 'w1', severity: 'warning', source: 'eslint' },
]

const APP_BADGE = '#codeFiles .frow[data-row="packages/studio/ui/src/App.vue"] .dg.err'

/**
 * ★先重推一次诊断让 `diagSeq` +1 ⇒ 游标归零：前面的 ㊿w/㊿x 已经点过徽标，
 *   不归零的话起点不是第 1 条，序列会漂移。
 * ★序列刻意停在「第 2/2」时再刷新：若没实现归零，刷新后仍显示 2/2 ⇒ 判据红。
 */
export async function probeDiagCycle(page) {
  const pushDiag = () =>
    page.evaluate((payload) => {
      dispatchEvent(new CustomEvent('studio:diag-update', { detail: payload }))
    }, DIAG_PAYLOAD)
  const badgeTitle = () =>
    page.evaluate((sel) => document.querySelector(sel)?.getAttribute('title') ?? '', APP_BADGE)
  const clickBadge = async () => {
    /* 卡片是 Teleport 到 body 的 fixed 浮层：每次点击前把指针移开并等它收起，
       否则第二次 click 会被卡片 intercept（#1494 已踩过 30s 超时）。 */
    await page.mouse.move(4, 4)
    await page.waitForTimeout(320)
    await page.click(APP_BADGE).catch(() => {})
    await page.waitForTimeout(260)
    return badgeTitle()
  }

  await pushDiag()
  await page.waitForTimeout(260)
  const initial = await badgeTitle()
  const after1 = await clickBadge()
  const after2 = await clickBadge()
  const after3 = await clickBadge()
  await pushDiag()
  await page.waitForTimeout(260)
  const refreshed = await badgeTitle()
  return { initial, after1, after2, after3, refreshed }
}
