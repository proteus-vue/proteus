// scripts/studio-panel-checks-termkeys.mjs —— 判据 ㊿ / ㊿b（决策 #1461）
//
// 【为什么抽成独立模块】`check-studio-panel.mjs` 是 998 行，贴 1000 行硬上限（#1460 实测
//   内联判据把它撑到 1019 ⇒ 门禁自身被 `check:file-size` 判红）⇒ 采集 + 断言都放这里，
//   主脚本只在 `probeTerminal` 那一行尾追加一句调用、在 checks 数组里加一个 spread。
//
// 【判据要防什么】★「注册表里有 ActionId」不等于「键按下去有人接」：
//   改造前 `term.new/term.split/term.find` 三个 id 有键位却**全仓无 onAction 注册**；
//   11 个真实键仍是 `TerminalPanel.vue` 里 `onPanelKey` 的手写分支，而 `installKeymap`
//   装在 window 捕获阶段、比面板更早 ⇒ ⌘W / ⌘= / ⌘- / ⌘0 / ⌘1 被全局动作吃掉并
//   `stopPropagation`，面板一次都收不到。⇒ 这里全部用 **page.keyboard 真实按键** +
//   IPC 桩计数 + DOM 读数，不注入事件、不直接调前端函数。
//
// 【诚实边界】自定义键位那段走的是「另一个窗口写 localStorage ⇒ storage 事件」这条
//   应用**真实监听**的通道（设置面板就是独立窗口），不是从设置 UI 点进去；真 pty 由
//   Rust 单测覆盖，这里只验界面 → IPC → DOM 这一段。
import fs from 'node:fs'
import path from 'node:path'

const IDS = [
  'term.new', 'term.split', 'term.find', 'term.zoomIn', 'term.zoomOut', 'term.zoomReset',
  'term.clear', 'term.close', 'term.switchTo', 'term.prevSession', 'term.nextSession',
]

/** 静态：11 个动作必须同时存在于 BASE / ACTIONS / onAction，且旧手写分发已删除。 */
function staticParity(studioDir) {
  const kb = fs.readFileSync(path.join(studioDir, 'ui/src/keybindings.ts'), 'utf8')
  const panel = fs.readFileSync(path.join(studioDir, 'ui/src/panels/TerminalPanel.vue'), 'utf8')
  const esc = (id) => id.replace('.', '\\.')
  return {
    base: IDS.every((id) => new RegExp(`'${esc(id)}':\\s*\\[`).test(kb)),
    actions: IDS.every((id) => new RegExp(`\\{ id: '${esc(id)}',`).test(kb)),
    wired: IDS.every((id) => panel.includes(`onAction('${id}'`)),
    /* ★只认**函数定义**，不认裸字符串：改造后的注释里仍会提到 `onPanelKey` 这个历史名字，
       用 `includes` 会把自己的说明文字判成残留代码（实测 ㊿b 假红，就是这么来的）。 */
    noHandwritten: !/function\s+onPanelKey\s*\(/.test(panel) && !panel.includes('@keydown.capture'),
    scoped: kb.includes('scope: ActionScope') && kb.includes("'.termwrap'") && kb.includes('scopeOf(a.id) !== scope'),
  }
}

/** @returns {Promise<Array<[string, boolean]>>} 两条判据（文案 + 布尔） */
export async function checksTermKeys(page, studioDir) {
  const s = staticParity(studioDir)
  /* `Mod` 在 mac 是 ⌘、其它平台是 Ctrl：跟 `keybindings.ts::isMac()` 同一判据，别写死。 */
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  const MOD = mac ? 'Meta' : 'Control'
  const OV_KEY = 'proteus.keymapOverrides'

  const calls = (cmd) =>
    page.evaluate((c) => window.__STUB_CALLS__.filter((x) => x.cmd === c).length, cmd)
  const font = () =>
    page.evaluate(() => document.getElementById('termWrap')?.style.getPropertyValue('--fs-term').trim() ?? '')
  const activeIdx = () =>
    page.evaluate(() => [...document.querySelectorAll('.tlist .litem')].findIndex((x) => x.classList.contains('on')))
  const paneCount = () => page.evaluate(() => document.querySelectorAll('#termWrap .tpane').length)
  const press = async (key, shift = false) => {
    await page.keyboard.down(MOD)
    if (shift) await page.keyboard.down('Shift')
    await page.keyboard.press(key)
    if (shift) await page.keyboard.up('Shift')
    await page.keyboard.up(MOD)
  }

  /* 焦点决定 scope，必须先钉死。★不用 `page.click('#termInput')`：左边缘被绝对定位的
     `.grip-rail` 分隔条覆盖，真实鼠标命中测试会被拦截（实测 30s 超时）⇒ 与 ㊼ 探针
     `probeTerminal` 一致用浏览器原生 `focus()`，并把「焦点确实在 .termwrap 内」写成断言。 */
  await page.evaluate(() => document.getElementById('termInput')?.focus())
  const focusInTerm = await page.evaluate(() => !!document.activeElement?.closest?.('.termwrap'))
  const open0 = await calls('term_open')
  const write0 = await calls('term_write')

  // ① 字号三键（旧版被全局 `view.zoomIn/Out/Reset` 在 window 捕获阶段抢走）
  const font0 = Number.parseInt(await font(), 10)
  await press('Equal')
  const fontUp = await font()
  await press('Digit0')
  const fontReset = await font()
  await press('Minus')
  await press('Digit0')
  const fontBack = await font()

  // ② 清屏 = 真发 Ctrl-L 字节（不是把屏幕 DOM 清空）
  await press('KeyK')
  const clearBytes = await page.evaluate((n) =>
    window.__STUB_CALLS__.filter((x) => x.cmd === 'term_write').slice(n).map((x) => String(x.args?.data ?? '')), write0)

  // ③ 查找：⌘F 要把焦点送进查找框；Esc 关掉后焦点回终端输入框（控件内部键，仍走原生）
  await press('KeyF')
  const findShown = await page.evaluate(() => ({
    shown: !!document.querySelector('.termfind'),
    focused: !!document.activeElement?.closest?.('.termfind'),
  }))
  await page.keyboard.press('Escape')
  const findClosed = await page.evaluate(() => ({
    hidden: !document.querySelector('.termfind'),
    /* 拆栏后输入框 id 会变成 `termSide1Input`（TermPane 的 `pre + 'Input'`），
       别写死 id —— 判据要的是「焦点确实回到终端里的某个输入框」。 */
    back: document.activeElement?.tagName === 'TEXTAREA' && !!document.activeElement?.closest?.('.termwrap'),
  }))

  // ④ 新建会话 / 切会话 / 拆栏
  await press('KeyT', true)
  const opened = (await calls('term_open')) - open0
  const listCount = await page.evaluate(() => document.querySelectorAll('.tlist .litem').length)
  const idxBefore = await activeIdx()
  await press('BracketRight', true)
  const idxNext = await activeIdx()
  await press('BracketLeft', true)
  const idxPrev = await activeIdx()
  await press('Digit1')
  const idxFirst = await activeIdx()
  const panesBefore = await paneCount()
  await press('Backslash')
  const panesAfter = await paneCount()

  // ⑤ 可自定义：模拟**设置窗口**写 localStorage ⇒ 主窗口的 storage 监听应立刻生效
  await page.evaluate((k) => {
    const v = JSON.stringify({ 'term.new': ['Mod+Shift+Y'] })
    localStorage.setItem(k, v)
    window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: v }))
  }, OV_KEY)
  const customBefore = await calls('term_open')
  await press('KeyY', true)
  const customDelta = (await calls('term_open')) - customBefore
  await page.evaluate((k) => {
    localStorage.removeItem(k)
    window.dispatchEvent(new StorageEvent('storage', { key: k, newValue: null }))
  }, OV_KEY)

  // ⑥ ★作用域优先权：终端内 ⌘W 必须关**终端会话**，不能让全局 `file.closeTab` 抢走
  const closeBefore = await calls('term_close')
  await press('KeyW')
  const closeDelta = (await calls('term_close')) - closeBefore

  // ⑦ 反向：焦点移出 `.termwrap`（真实把焦点给左窄栏的代码按钮）后，⌘⇧T 不应偷开终端会话
  await page.evaluate(() => document.querySelector('.rail button[aria-label="代码（只读）"]')?.focus())
  const focusOutside = await page.evaluate(() => !document.activeElement?.closest?.('.termwrap'))
  const outsideBefore = await calls('term_open')
  await press('KeyT', true)
  const outsideDelta = (await calls('term_open')) - outsideBefore

  const keysOk =
    focusInTerm && focusOutside &&
    Number.parseInt(fontUp, 10) === font0 + 1 &&
    fontReset === '12px' &&
    fontBack === '12px' &&
    clearBytes.some((d) => d.includes('\x0c')) &&
    findShown.shown && findShown.focused &&
    findClosed.hidden && findClosed.back &&
    opened >= 1 && listCount >= 2 &&
    idxBefore >= 0 && idxNext !== idxBefore && idxPrev === idxBefore && idxFirst === 0 &&
    panesAfter > panesBefore &&
    customDelta === 1 &&
    closeDelta >= 1 &&
    outsideDelta === 0

  return [
    [
      `㊿ 终端快捷键作用域（决策 #1461 · 真实键盘）：焦点内/外=${focusInTerm}/${focusOutside} · 字号 ${font0}→${fontUp}→${fontReset} · Ctrl-L=${clearBytes.some((d) => d.includes('\x0c'))} · ⌘F 聚焦/退出=${findShown.focused}/${findClosed.back} · 新建=${opened} · 切会话 ${idxBefore}→${idxNext}→${idxPrev} · 拆栏 ${panesBefore}→${panesAfter} · ⌘W 关会话=${closeDelta} · 终端外不触发=${outsideDelta === 0}`,
      keysOk,
    ],
    [
      `㊿b 终端 11 键已收编注册表（决策 #1461）：BASE=${s.base} · ACTIONS=${s.actions} · onAction=${s.wired} · 无手写分发=${s.noHandwritten} · scope 生效=${s.scoped} · 自定义键生效=${customDelta === 1}`,
      s.base && s.actions && s.wired && s.noHandwritten && s.scoped && customDelta === 1,
    ],
  ]
}
