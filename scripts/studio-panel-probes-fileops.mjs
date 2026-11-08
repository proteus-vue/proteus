// scripts/studio-panel-probes-fileops.mjs —— 文件树写操作的**真实鼠标入口**判据（决策 #1460）
//
// 【为什么单列一个文件】`check-studio-panel.mjs` / `studio-panel-probes.mjs` 都贴着 1000 行上限；
//   而且这段判据自己是一组完整的「右键 → 输入 → 确认 → 写盘桩 → 刷树」链路，拆开更好复核。
//
// 【判据边界（★别读成"真的删了文件"）】桩只记录 invoke，不碰磁盘；这里证明的是
//   **用户真实入口能一路走到正确的 IPC 命令、参数正确、刷树生效、二次确认与保护真的拦住**。
//   Rust 侧的路径沙箱 / 空目录限制由 `cargo test` 与 `fs_guard` 单测覆盖，不在这里假装验证。
//
// 【副作用】新建会在桩的 `__STUB_MADE__` 里留一个虚拟路径 ⇒ 探针末尾**移除并刷新树**，
//   保证后续判据看到的文件数不变（否则 fileCount 相关判据会被自己污染）。

const wait = (page, ms = 140) => page.waitForTimeout(ms)

const menuItems = (page) =>
  page.evaluate(() =>
    [...(document.getElementById('ctxMenu')?.querySelectorAll('[data-menu-item]') ?? [])].map((b) =>
      b.getAttribute('data-menu-item'),
    ),
  )

const pick = async (page, id) => {
  await page.click(`#ctxMenu [data-menu-item="${id}"]`)
  await wait(page)
}

const toasts = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((n) => (n.textContent || '').trim()))

export async function probeFileOps(page) {
  const callsBefore = await page.evaluate(() => (window.__STUB_CALLS__ || []).length)
  await page.evaluate(() => window.localStorage.removeItem('__STUB_MADE__'))

  /* ① 真实右键一个文件节点 ⇒ 菜单必须含四个新动作（原有 copyPath/refresh 不许被挤掉） */
  const fileSel = '#codeFiles button[data-file="packages/studio/src/main.rs"]'
  await page.click(fileSel, { button: 'right' })
  await wait(page)
  const ids = await menuItems(page)

  /* ② 点「新建文件…」 ⇒ 输入框出现 ⇒ 输入名字 ⇒ Enter ⇒ 必须发出 create_file 且路径正确 */
  await pick(page, 'createFile')
  const boxShown = await page.evaluate(() => !!document.querySelector('.fnbox input'))
  await page.fill('.fnbox input', 'probe-fileops.ts')
  await page.press('.fnbox input', 'Enter')
  await wait(page, 260)
  const newPath = 'packages/studio/src/probe-fileops.ts'
  const callsAfterCreate = await page.evaluate(() => window.__STUB_CALLS__ || [])
  const createCall = callsAfterCreate
    .slice(callsBefore)
    .filter((c) => c.cmd === 'create_file')
    .map((c) => String(c.args?.path ?? ''))
  const treeHasNew = await page.evaluate(
    (p) => !!document.querySelector(`#codeFiles button[data-file="${p}"]`),
    newPath,
  )
  const createdToast = (await toasts(page)).some((t) => t.includes('已创建'))

  /* ③ 删除必须**二次确认**：点「取消」后不得发出 delete_path */
  await page.click(`#codeFiles button[data-file="${newPath}"]`, { button: 'right' })
  await wait(page)
  await pick(page, 'delete')
  const dialogShown = await page.evaluate(() => !!document.getElementById('confirmDialog'))
  const beforeCancel = (await page.evaluate(() => (window.__STUB_CALLS__ || []).length))
  await page.click('#confirmDialog [data-act="cancel"]')
  await wait(page, 200)
  const deleteCalls = await page.evaluate(
    (n) => (window.__STUB_CALLS__ || []).slice(n).filter((c) => c.cmd === 'delete_path').length,
    beforeCancel,
  )

  /* ④ 重命名/删除**已打开标签**的文件必须整体拒绝（不能 emit IPC） */
  const opened = await page.evaluate(
    () => document.querySelector('#codeTabs button[data-tab]')?.getAttribute('data-tab') ?? '',
  )
  const beforeGuard = await page.evaluate(() => (window.__STUB_CALLS__ || []).length)
  let guardToast = false
  if (opened) {
    await page.click(`#codeFiles button[data-file="${opened}"]`, { button: 'right' })
    await wait(page)
    await pick(page, 'rename')
    guardToast = (await toasts(page)).some((t) => t.includes('请先关闭相关标签'))
  }
  const guardCalls = await page.evaluate(
    (n) => (window.__STUB_CALLS__ || []).slice(n).filter((c) => c.cmd === 'rename_path').length,
    beforeGuard,
  )

  /* ⑤ 恢复：清掉桩里的虚拟文件 + 刷树，避免污染后面的 fileCount 判据 */
  await page.evaluate(() => window.localStorage.removeItem('__STUB_MADE__'))
  await page.click(fileSel, { button: 'right' })
  await wait(page)
  await pick(page, 'refresh')
  await wait(page, 220)

  return {
    ids,
    boxShown,
    createPath: createCall[createCall.length - 1] ?? '',
    createCallCount: createCall.length,
    newPath,
    treeHasNew,
    createdToast,
    dialogShown,
    deleteCalls,
    opened,
    guardToast,
    guardCalls,
  }
}
