// scripts/studio-panel-probes.mjs —— Studio 面板门禁的**采集段**（决策 #1235 拆出）
//
// 【为什么单独成文件】判据脚本已经 1200+ 行，超过仓库的 1000 行红线。
//   拆法按**职责**：这里只做"把页面驱动到某个状态、把读数取回来"（probe），
//   断言与文案留在 `check-studio-panel.mjs`（check）。
//   ⇒ 改探针不改判据、改判据不碰探针；两边都能独立读。
//
// 【约定】每个 probe 接收 (page, studio 目录)，返回一个**扁平对象**，
//   调用方用解构接住（变量名与原来完全一致，判据段零改动）。
import fs from 'node:fs'
import path from 'node:path'

export async function probeTitlebar(page, studio) {
  const STUDIO = studio
// ── ㉔ 沉浸式标题栏（决策 #1219）────────────────────────────────────────────
// 【为什么不只在配置里改】`titleBarStyle: Overlay` 只是让内容画到窗口顶部；
//   真正"不打架"还取决于两件外面的事：① 顶栏能拖窗口（`data-tauri-drag-region`）；
//   ② 给原生红绿灯留出宽度（trafficLightPosition 14 + 52 宽 ⇒ 左内边距 ≥76）。
//   ★红绿灯的**实际像素位置**在这里测不到（Playwright 里是普通浏览器，没有原生窗口）——
//     那条只能人眼看，README 里如实写了。
// ★能力（capabilities）：插件命令**默认被 ACL 拒**（`plugin:window|start_dragging` 等），
//   只写 `data-tauri-drag-region` 是拖不动的（2026-10-25 实测：整条标题栏拖不动、双击不缩放）。
//   这里同时看**源文件**与**构建产物**（gen/schemas/capabilities.json 是嵌进二进制的那份），
//   两者不一致 ⇒ 改了能力没重编，运行时仍是旧的。
const CAP_NEED = [
  'core:window:allow-start-dragging',
  'core:window:allow-internal-toggle-maximize',
  'core:event:allow-listen',
  'core:event:allow-unlisten',
]
const capSrcPath = path.join(STUDIO, 'capabilities', 'default.json')
const capGenPath = path.join(STUDIO, 'gen', 'schemas', 'capabilities.json')
const capSrc = fs.existsSync(capSrcPath) ? JSON.parse(fs.readFileSync(capSrcPath, 'utf8')) : null
const capGen = fs.existsSync(capGenPath) ? JSON.parse(fs.readFileSync(capGenPath, 'utf8')) : null
const capMissingSrc = capSrc ? CAP_NEED.filter((x) => !(capSrc.permissions ?? []).includes(x)) : CAP_NEED
const capMissingGen = capGen?.default
  ? CAP_NEED.filter((x) => !(capGen.default.permissions ?? []).includes(x))
  : CAP_NEED

const titleConf = JSON.parse(fs.readFileSync(path.join(STUDIO, 'tauri.conf.json'), 'utf8')).app.windows[0]
const titleBar = await page.evaluate(() => {
  const top = document.querySelector('.top')
  const chip = document.querySelector('.top .chip')
  return {
    drag: !!top && top.hasAttribute('data-tauri-drag-region'),
    padLeft: top ? parseFloat(getComputedStyle(top).paddingLeft) : -1,
    chipX: chip ? Math.round(chip.getBoundingClientRect().x) : -1,
    height: top ? Math.round(top.getBoundingClientRect().height) : -1,
    brand: !!document.querySelector('.top .brand'),
  }
})

// ── ㉔b 标题栏**真的**能拖、双击能缩放（决策 #1231）────────────────────────────
// 【为什么必须升级判据】旧判据只断言"`.top` 上有 data-tauri-drag-region 属性"——**假绿**：
//   Tauri 的规则是「bare/`true` = 只有**直接点在这个元素上**才算；`deep` = 子树里任何位置都算」，
//   而标题条里塞着芯片和 spacer，点击永远先落在**子元素**上 ⇒ bare 模式下整条栏拖不动、双击也不缩放。
//   ⇒ 这里直接把 **Tauri 自己的 `drag.js`** 注入页面（不是自己复述规则），
//     在几个真实坐标上派发 mousedown/mouseup，断言它**真的发了** `plugin:window|start_dragging`
//     与 `plugin:window|internal_toggle_maximize`。
//   ★crate 源码找不到时（比如 CI 只 clone 本仓）退回"最小镜像规则"，并在输出里说明。
function tauriDragScript() {
  const home = process.env.HOME || ''
  const reg = path.join(home, '.cargo', 'registry', 'src')
  try {
    for (const vendor of fs.readdirSync(reg)) {
      const dir = path.join(reg, vendor)
      for (const crate of fs.readdirSync(dir)) {
        if (/^tauri-2\./.test(crate)) {
          const f = path.join(dir, crate, 'src', 'window', 'scripts', 'drag.js')
          if (fs.existsSync(f)) return { src: fs.readFileSync(f, 'utf8'), from: f }
        }
      }
    }
  } catch {
    /* 没装 rust 源码：走镜像 */
  }
  const mirror = `;(function(){
    const A='data-tauri-drag-region'
    const CLICK=new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','LABEL','SUMMARY'])
    const isClick=(el)=>CLICK.has(el.tagName)||(el.hasAttribute('contenteditable')&&el.getAttribute('contenteditable')!=='false')||(el.hasAttribute('tabindex')&&el.getAttribute('tabindex')!=='-1')
    function isDrag(path){for(const el of path){if(!(el instanceof HTMLElement))continue;const a=el.getAttribute(A);if(isClick(el)&&a===null)return false;if(a===null)continue;if(a==='false')return false;if(a==='deep')return true;if(a===''||a==='true')return el===path[0]}return false}
    document.addEventListener('mousedown',(e)=>{if(e.button===0&&(e.detail===1||e.detail===2)&&isDrag(e.composedPath())){if(e.detail===2){window.__DRAG_INIT__=[e.clientX,e.clientY];return}window.__TAURI_INTERNALS__?.invoke('plugin:window|start_dragging')}})
    document.addEventListener('mouseup',(e)=>{if(e.button===0&&e.detail===2&&window.__DRAG_INIT__&&e.clientX===window.__DRAG_INIT__[0]&&e.clientY===window.__DRAG_INIT__[1]&&isDrag(e.composedPath()))window.__TAURI_INTERNALS__?.invoke('plugin:window|internal_toggle_maximize')})
  })()`
  return { src: mirror, from: '（镜像规则：crate 源码不可用）' }
}
const dragScript = tauriDragScript()
await page.addScriptTag({
  content: `window.__TAURI_INTERNALS__=window.__TAURI_INTERNALS__||{};window.__TAURI_INTERNALS__.invoke=(c)=>{window.__DRAG_CALLS__=window.__DRAG_CALLS__||[];window.__DRAG_CALLS__.push(c);return Promise.resolve()};`,
})
await page.addScriptTag({ content: dragScript.src.replace('__TEMPLATE_os_name__', "'macos'") })
const dragProbe = await page.evaluate(() => {
  const bar = document.querySelector('.top')
  const b = bar.getBoundingClientRect()
  // 三点：芯片上、spacer 上、右边芯片上 —— 都是"点在子元素上"的真实情形
  const xs = [b.x + 40, b.x + b.width * 0.5, b.right - 60]
  const y = b.y + b.height / 2
  const fire = (type, x, detail) =>
    document.elementFromPoint(x, y).dispatchEvent(
      new MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: y, button: 0, detail }),
    )
  const out = []
  for (const x of xs) {
    window.__DRAG_CALLS__ = []
    const el = document.elementFromPoint(x, y)
    fire('mousedown', x, 1)
    out.push({ hit: el.className || el.tagName, drag: [...window.__DRAG_CALLS__] })
  }
  // 双击（macOS 在 mouseup 上切最大化）
  window.__DRAG_CALLS__ = []
  const x2 = b.x + b.width * 0.5
  fire('mousedown', x2, 2)
  fire('mouseup', x2, 2)
  const dbl = [...window.__DRAG_CALLS__]
  return { out, dbl, mode: bar.getAttribute('data-tauri-drag-region') }
})

  return { titleConf, titleBar, dragProbe, dragScript, capSrc, capGen, capMissingSrc, capMissingGen }
}

export async function probeMenu(page, studio) {
  const STUDIO = studio
// ── ㉕ 菜单：每个动作项都必须有人接、而且真的做事（决策 #1221）──────────────
// 【为什么要有】菜单项是"承诺"：用户点"保存"就要保存。最坏的情况不是没有菜单，
//   而是菜单在、点了没反应——它比没有更容易让人以为是自己不会用。
//   ⇒ 两条一起测：① 从 `src/menu.rs` 的 ACTIONS 表读出**全部** id（不另抄一份），逐个派发；
//     ② 每个 id 断言一个**可观测的效果**（视图切了/缩放变了/真写了盘/标签少了），
//        不是"没人报错"就算过。
// ★诚实边界：这里派发的是 `window` 上的 `studio:menu` 兜底事件，证明的是**动作侧**；
//   原生 NSMenu 点到 JS 那一段（Tauri event）在 Playwright 里没有，只能人眼验。
const menuDead = []
page.on('console', (m) => {
  if (m.type() === 'warning' && m.text().includes('菜单动作无人处理')) menuDead.push(m.text())
})
const menuSrc = fs.readFileSync(path.join(STUDIO, 'src', 'menu.rs'), 'utf8')
const menuActs = [...menuSrc.matchAll(/\("([a-z]+\.[A-Za-z]+)",\s*"([^"]*)",\s*"([^"]*)"\)/g)].map((m) => ({
  id: m[1],
  label: m[2],
  accel: m[3],
}))
// 登记了还要真的放进菜单里：`action(app, "id")` 至少出现一次
const notBuilt = menuActs.filter((a) => !menuSrc.includes(`action(app, "${a.id}")`))
const fireMenu = (id) =>
  page.evaluate((x) => window.dispatchEvent(new CustomEvent('studio:menu', { detail: x })), id)
const railOn = (label) =>
  page.evaluate((l) => !!document.querySelector(`.rail button[aria-label="${l}"].on`), label)
const zoomText = () => page.evaluate(() => document.getElementById('zoomLabel')?.textContent?.trim() ?? '')

await fireMenu('view.device')
await page.waitForTimeout(200)
const menuDevice = await railOn('设备画布')
await fireMenu('view.code')
await page.waitForTimeout(200)
const menuCode = await railOn('代码（只读）')
// 缩放：标签只在设备视图里可见 ⇒ 先切回去
await fireMenu('view.device')
await page.waitForTimeout(200)
await fireMenu('view.zoomIn')
await page.waitForTimeout(120)
const menuZoomIn = await zoomText()
await fireMenu('view.zoomReset')
await page.waitForTimeout(120)
const menuZoomReset = await zoomText()
await fireMenu('view.zoomOut')
await page.waitForTimeout(120)
const menuZoomOut = await zoomText()
await fireMenu('view.zoomReset')
await fireMenu('view.code')
await page.waitForTimeout(250)
// 查找 ⌘F：菜单项必须把焦点送进搜索框（否则"有菜单但按了没反应"）
await fireMenu('edit.find')
await page.waitForTimeout(200)
const menuFind = await page.evaluate(() => document.activeElement?.id ?? '')

// 保存：先造一个脏缓冲，再让菜单去存（断言真的把这段文本发出去了）
await page.locator('.cm-content').click()
await page.keyboard.type('// menu-save')
await page.waitForTimeout(150)
const writesBefore = await page.evaluate(
  () => window.__STUB_CALLS__.filter((c) => c.cmd === 'write_text').length,
)
await fireMenu('file.save')
await page.waitForTimeout(500)
const menuSaved = await page.evaluate((n) => {
  const w = window.__STUB_CALLS__.filter((c) => c.cmd === 'write_text')
  return w.length > n ? String(w[w.length - 1].args?.text ?? '') : ''
}, writesBefore)
// 关标签：菜单的「关闭标签页」= 当前标签消失、标签数 -1
const tabsBeforeMenu = await page.evaluate(
  () => document.querySelectorAll('#codeTabs button[data-tab]').length,
)
await fireMenu('file.closeTab')
await page.waitForTimeout(500)
const tabsAfterMenu = await page.evaluate(
  () => document.querySelectorAll('#codeTabs button[data-tab]').length,
)
// 收尾：把编辑器恢复成"有标签的代码视图"，快照才不会是空的
await page.evaluate(() =>
  localStorage.setItem('__stub_state__', JSON.stringify({ view: 'code', codeFile: 'packages/studio/ui/src/App.vue' })),
)
await page.reload()
await page.waitForTimeout(900)

  return { menuActs, menuDead, notBuilt, menuDevice, menuCode, menuZoomIn, menuZoomReset, menuZoomOut, menuFind, menuSaved, tabsBeforeMenu, tabsAfterMenu }
}

export async function probeSearch(page, studio) {
  const STUDIO = studio
// ── ㉖ 搜索：命中数对得上 + 点一条**真的跳到那一格**（决策 #1222）──────────────
// 【为什么不是"有没有结果"就完事】搜索最容易做假的地方是：列表出来了、点了也有反应，
//   但光标落在文件开头——用户还得自己找。所以这里断言 **data-caret 落在 4:9**
//   （RUST 桩里 `stubLine` 的起始格），以及搜索时目录树**让位**、清除后回来。
await page.locator('#codeSearch').click()
await page.locator('#codeSearch').fill('stub')
await page.waitForTimeout(600) // 220ms 防抖 + 一次 IPC 往返
const searchState = await page.evaluate(() => ({
  hits: document.querySelectorAll('#codeHits .hit').length,
  meta: document.getElementById('codeSearchMeta')?.textContent?.trim() ?? '',
  treeGone: !document.getElementById('codeFiles'),
}))
await page.locator('#codeHits .hit').first().click()
await page.waitForTimeout(700)
const jumped = await page.evaluate(() => ({
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
  caret: document.getElementById('codeHost')?.getAttribute('data-caret') ?? '',
  active: document.querySelector('.cm-activeLine')?.textContent ?? '',
}))
await page.click('#codeSearchClear')
await page.waitForTimeout(300)
const treeBack = await page.evaluate(() => !!document.getElementById('codeFiles'))

// 引擎如实显示：没装 rg 时必须是「内置扫描（装 ripgrep 更快）」，不能假装是 rg
await page.evaluate(() => localStorage.setItem('__NORG__', '1'))
await page.locator('#codeSearch').fill('stub')
await page.waitForTimeout(600)
const engineShown = await page.evaluate(() => ({
  meta: document.getElementById('codeSearchMeta')?.textContent?.trim() ?? '',
  hits: document.querySelectorAll('#codeHits .hit').length,
}))
await page.evaluate(() => localStorage.removeItem('__NORG__'))
await page.click('#codeSearchClear')
await page.waitForTimeout(300)

  return { searchState, jumped, treeBack, engineShown }
}

export async function probeCodeExtras(page, studio) {
  const STUDIO = studio
// ── ㉘/㉙/㉚ 代码视图的"边界功能"（决策 #1232/#1233/#1234）──────────────────
// ★菜单项点击要**容错**：菜单没弹出来时不能让整条门禁崩掉（那样后面的判据全丢，
//   "红了"也看不出是哪一条——第一版就是这么挂的）。超时就记 false，继续往下跑。
const pickMenu = async (id) => {
  try {
    await page.click(`#ctxMenu [data-menu-item="${id}"]`, { timeout: 1500 })
    return true
  } catch {
    return false
  }
}
// ㉘ 目录两态图标 · ㉙ 文件类型图标 · ㉚ 三处右键菜单（标签/文件树/编辑器）
// 先把第二个文件打开，右键菜单的"关闭其他"才有意义
await page.click('#codeFiles button[data-file="packages/studio/src/main.rs"]')
await page.waitForTimeout(350)
// ★不依赖"上一步留下了哪些标签"：先把 App.vue 也打开，保证它的标签一定在
await page.click('#codeFiles button[data-file="packages/studio/ui/src/App.vue"]')
await page.waitForTimeout(350)
const iconSamples = await page.evaluate((paths) => {
  const out = {}
  for (const p of paths) {
    const b = document.querySelector(`#codeFiles button[data-file="${p}"]`)
    const svg = b?.querySelector('svg')
    out[p] = b
      ? { icon: b.getAttribute('data-icon'), color: b.querySelector('[data-tint]')?.getAttribute('data-tint') ?? '' }
      : null
  }
  return out
}, [
  'packages/studio/ui/src/App.vue',
  'packages/studio/ui/src/bridge.ts',
  'packages/studio/ui/src/styles.css',
  'packages/studio/src/main.rs',
  'packages/studio/native/embed_view.m',
])
const dirSel = '#codeFiles button[data-dir="packages/studio/ui"]'
const dirOpen = await page.getAttribute(dirSel, 'data-icon')
// ★同时看**画出来的那个 svg**（data-open）：只断言 data-icon 的话，
//   即使图标组件被换回"两态同一个形状"也照样绿——那又是结构性假绿。
const markOpen = await page.getAttribute(`${dirSel} svg[data-open]`, 'data-open')
await page.click(dirSel)
await page.waitForTimeout(250)
const dirClosed = await page.getAttribute(dirSel, 'data-icon')
const markClosed = await page.getAttribute(`${dirSel} svg[data-open]`, 'data-open')
await page.click(dirSel) // 还原
await page.waitForTimeout(250)

// ㉚a 标签右键 → 关闭其他
await page.click('#codeTabs button[data-tab="packages/studio/ui/src/App.vue"]', { button: 'right' })
await page.waitForTimeout(220)
const tabMenu = await page.evaluate(() => {
  const m = document.getElementById('ctxMenu')
  return { open: !!m, items: [...(m?.querySelectorAll('[data-menu-item]') ?? [])].map((b) => b.getAttribute('data-menu-item')) }
})
const pickedCloseOthers = await pickMenu('closeOthers')
await page.waitForTimeout(300)
// 关闭其他也可能命中未保存标签 ⇒ 有新确认框就选"不保存"（这条判据验的是"只剩 1 个标签"）
if (await page.evaluate(() => !!document.getElementById('confirmDialog'))) {
  await page.click('#confirmDialog [data-act="discard"]')
}
await page.waitForTimeout(400)
const afterCloseOthers = await page.evaluate(() => ({
  tabs: document.querySelectorAll('#codeTabs button[data-tab]').length,
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
}))

// ㉚b 文件树右键 → 复制相对路径（走 Rust 剪贴板命令）
await page.click('#codeFiles button[data-file="packages/studio/src/main.rs"]', { button: 'right' })
await page.waitForTimeout(220)
const nodeMenu = await page.evaluate(() => {
  const m = document.getElementById('ctxMenu')
  return { items: [...(m?.querySelectorAll('[data-menu-item]') ?? [])].map((b) => b.getAttribute('data-menu-item')) }
})
const pickedCopyPath = await pickMenu('copyPath')
await page.waitForTimeout(250)
const copiedPath = await page.evaluate(() => {
  const c = (window.__STUB_CALLS__ || []).filter((x) => x.cmd === 'copy_text')
  return c.length ? String(c[c.length - 1].args?.text ?? '') : ''
})

// ── ㉛ 瞬时反馈（决策 #1236）：复制成功要**看得见**，且 3 秒内自己消失 ──────────────
const toastAtCopy = await page.evaluate(() =>
  [...document.querySelectorAll('#toasts .toast')].map((n) => ({
    kind: n.getAttribute('data-kind'),
    text: (n.textContent || '').trim(),
  })),
)
// 紧接着再触发一次（刷新文件树）：两次操作**必须叠着**，而不是后一条顶掉前一条
await page.click('#codeFiles button[data-file="packages/studio/src/main.rs"]', { button: 'right' })
await page.waitForTimeout(200)
await pickMenu('refresh')
await page.waitForTimeout(400)
const toastStack = await page.evaluate(() => document.querySelectorAll('#toasts .toast').length)
await page.waitForTimeout(3000)
const toastGone = await page.evaluate(() => document.querySelectorAll('#toasts .toast').length === 0)

// ㉚c 编辑器右键 → 保存/撤销/重做/全选；Esc 关闭
await page.click('#codeHost', { button: 'right', position: { x: 60, y: 60 } })
await page.waitForTimeout(220)
const editorMenu = await page.evaluate(() => {
  const m = document.getElementById('ctxMenu')
  return { items: [...(m?.querySelectorAll('[data-menu-item]') ?? [])].map((b) => b.getAttribute('data-menu-item')) }
})
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const escClosed = await page.evaluate(() => !document.getElementById('ctxMenu'))

// ── ㉜ 贴边定位 + 中性高亮（决策 #1239）────────────────────────────────────────
// 在编辑器**右下角**右键：菜单必须向上/向左翻转并**贴着鼠标**（翻转后 right≈x、bottom≈y），
// 而且 hover 底色必须是中性灰（8% 白），不能是品牌蓝。
const hostBox = await page.locator('#codeHost').boundingBox()
const anchorX = Math.round(hostBox.x + hostBox.width - 24)
const anchorY = Math.round(hostBox.y + hostBox.height - 18)
await page.mouse.click(anchorX, anchorY, { button: 'right' })
await page.waitForTimeout(260)
// 先用真实鼠标 hover 一个菜单项（让 Vue 的 active 状态真的更新），再读底色
try {
  await page.hover('#ctxMenu [data-menu-item="undo"]', { timeout: 1500 })
} catch {
  /* 菜单没出来时留给断言报错 */
}
const edgeMenu = await page.evaluate(() => {
  const el = document.getElementById('ctxMenu')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const item = document.querySelector('#ctxMenu [data-menu-item="undo"]')
  const dis = el.querySelector('[data-menu-item][disabled]')
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    vw: innerWidth,
    vh: innerHeight,
    bg: item ? getComputedStyle(item).backgroundColor : '',
    cursor: item ? getComputedStyle(item).cursor : '',
    disabledCursor: dis ? getComputedStyle(dis).cursor : '（无禁用项）',
  }
})
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

  // ── ㉝ 语言模式（决策 #1241）：状态栏显示当前类型 + 手选后真的换解析器 ───────────
  // ★数"被着色"的 span（颜色 ≠ 正文色），不是数 CM 的内部类名：
  //   CM 的 `ͼ*` 类在纯文本下也有 36 个（行号/装饰），拿它判着色是假绿。
  const tokenCount = `(() => {
    const host = document.getElementById('codeHost')
    if (!host) return -1
    const fg = getComputedStyle(host.querySelector('.cm-content') || host).color
    return [...host.querySelectorAll('.cm-line span')].filter((s) => getComputedStyle(s).color !== fg).length
  })()`
  const langChip = await page.evaluate(() => {
    const b = document.getElementById('langMode')
    return b ? { text: (b.textContent || '').trim(), lang: b.getAttribute('data-lang') } : null
  })
  await page.click('#langMode')
  await page.waitForTimeout(250)
  const langMenu = await page.evaluate(() => ({
    count: document.querySelectorAll('#ctxMenu [data-menu-item]').length,
    hasPy: !!document.querySelector('#ctxMenu [data-menu-item="py"]'),
    hasRust: !!document.querySelector('#ctxMenu [data-menu-item="rust"]'),
  }))
  // 选"纯文本" ⇒ 必须一个着色 span 都不剩；再选 Rust ⇒ 又有
  await page.click('#ctxMenu [data-menu-item="plain"]')
  await page.waitForTimeout(320)
  const langPlain = await page.evaluate(
    (q) => ({
      chip: document.getElementById('langMode')?.getAttribute('data-lang') ?? '',
      host: document.getElementById('codeHost')?.getAttribute('data-lang') ?? '',
      tokens: eval(q),
    }),
    tokenCount,
  )
  await page.click('#langMode')
  await page.waitForTimeout(220)
  await page.click('#ctxMenu [data-menu-item="rust"]')
  await page.waitForTimeout(320)
  const langRust = await page.evaluate(
    (q) => ({
      chip: document.getElementById('langMode')?.getAttribute('data-lang') ?? '',
      tokens: eval(q),
    }),
    tokenCount,
  )
  // 回到自动
  await page.click('#langMode')
  await page.waitForTimeout(220)
  await page.click('#ctxMenu [data-menu-item="__auto"]')
  await page.waitForTimeout(320)
  const langAuto = await page.evaluate(
    (q) => ({
      chip: document.getElementById('langMode')?.getAttribute('data-lang') ?? '',
      tokens: eval(q),
    }),
    tokenCount,
  )

  // ── ⑱e 关闭未保存标签必须拦截（决策 #1243）──────────────────────────────────
  await page.locator('.cm-content').click()
  await page.keyboard.type('// close-probe')
  await page.waitForTimeout(150)
  const dirtyBeforeClose = await page.evaluate(() => !!document.querySelector('#codeTabs .tab.dirty, #codeTabs .tclose'))
  const tabCountBefore = await page.evaluate(() => document.querySelectorAll('#codeTabs button[data-tab]').length)
  await page.click('#codeTabs button[data-tab="packages/studio/ui/src/App.vue"] .tclose')
  await page.waitForTimeout(300)
  const dlgShown = await page.evaluate(() => {
    const d = document.getElementById('confirmDialog')
    return d ? { title: (d.querySelector('.title')?.textContent ?? '').trim(), acts: [...d.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act')) } : null
  })
  // 取消 ⇒ 标签还在、改动还在（对话框没弹出时跳过点击，留给断言报错，别让整条门禁崩在超时）
  if (dlgShown) await page.click('#confirmDialog [data-act="cancel"]')
  await page.waitForTimeout(250)
  const afterCancel = await page.evaluate(() => ({
    dlg: !!document.getElementById('confirmDialog'),
    tabs: document.querySelectorAll('#codeTabs button[data-tab]').length,
    text: document.querySelector('.cm-content')?.textContent ?? '',
  }))
  // 再来一次，选"不保存" ⇒ 标签消失、改动丢弃
  // （标签已经因为"没拦截"被关掉时，这一步会点不到——容错跳过，让断言去红）
  try {
    await page.click('#codeTabs button[data-tab="packages/studio/ui/src/App.vue"] .tclose', { timeout: 1500 })
  } catch {
    /* 留给断言 */
  }
  await page.waitForTimeout(250)
  if (await page.evaluate(() => !!document.getElementById('confirmDialog'))) {
    await page.click('#confirmDialog [data-act="discard"]')
  }
  await page.waitForTimeout(350)
  const afterDiscard = await page.evaluate(() => ({
    dlg: !!document.getElementById('confirmDialog'),
    tabs: document.querySelectorAll('#codeTabs button[data-tab]').length,
  }))
  // 复原：重新打开 App.vue，别把后续截图留在空编辑器上
  await page.click('#codeFiles button[data-file="packages/studio/ui/src/App.vue"]')
  await page.waitForTimeout(350)

  // ── ⑱f 关窗口/退出也要拦（决策 #1244）：脏计数同步给 Rust + 被拦下后弹同一套三选一 ──
  await page.locator('.cm-content').click()
  await page.keyboard.type('// close-window-probe')
  await page.waitForTimeout(260)
  const dirtySynced = await page.evaluate(() => {
    const c = (window.__STUB_CALLS__ || []).filter((x) => x.cmd === 'set_dirty_count')
    return c.length ? Number(c[c.length - 1].args?.n ?? -1) : -1
  })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('studio:close-blocked', { detail: 1 })))
  await page.waitForTimeout(320)
  const winDlg = await page.evaluate(() => {
    const d = document.getElementById('confirmDialog')
    return d ? [...d.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act')) : null
  })
  await page.click('#confirmDialog [data-act="cancel"]')
  await page.waitForTimeout(260)
  const closeNowAfterCancel = await page.evaluate(
    () => (window.__STUB_CALLS__ || []).filter((x) => x.cmd === 'close_now').length,
  )
  // 再来一次，这次"保存并关闭"⇒ 必须真的放行（close_now 被调用一次）
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('studio:close-blocked', { detail: 1 })))
  await page.waitForTimeout(320)
  await page.click('#confirmDialog [data-act="save"]')
  await page.waitForTimeout(420)
  const closeNowAfterSave = await page.evaluate(
    () => (window.__STUB_CALLS__ || []).filter((x) => x.cmd === 'close_now').length,
  )

  // ── ⑱g Diff 视图（决策 #1245）：改一行 ⇒ 有增有删，开关能来回切 ──────────────
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.type('// diff-probe-line')
  await page.waitForTimeout(220)
  await page.click('#diffToggle')
  await page.waitForTimeout(320)
  const diffState = await page.evaluate(() => {
    const v = document.getElementById('diffView')
    if (!v) return null
    const adds = [...v.querySelectorAll('.row.add .txt')].map((n) => n.textContent ?? '')
    return {
      added: Number(v.getAttribute('data-added') ?? 0),
      removed: Number(v.getAttribute('data-removed') ?? 0),
      adds: adds.slice(0, 3),
      hostHidden: getComputedStyle(document.getElementById('codeHost')).display === 'none',
    }
  })
  await page.click('#diffToggle')
  await page.waitForTimeout(260)
  const diffClosed = await page.evaluate(() => ({
    view: !!document.getElementById('diffView'),
    hostVisible: getComputedStyle(document.getElementById('codeHost')).display !== 'none',
  }))
  // 复原：撤销掉那段替换，别把脏缓冲留给后面的步骤
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(220)

  // ── ⑱h Git 只读（决策 #1246）：分支/改动数、改动清单可点、Diff 可切到 HEAD ──────
  const gitBar = await page.evaluate(() => {
    const bar = document.getElementById('gitBar')
    if (!bar) return null
    return {
      branch: (document.getElementById('gitBranch')?.textContent ?? '').trim(),
      count: (document.getElementById('gitCount')?.textContent ?? '').trim(),
    }
  })
  await page.click('#gitCount')
  await page.waitForTimeout(250)
  const gitList = await page.evaluate(() => ({
    items: [...document.querySelectorAll('#gitList .gitem')].map((b) => b.getAttribute('data-git')),
    sts: [...document.querySelectorAll('#gitList .gst')].map((b) => b.getAttribute('data-st')),
  }))
  await page.click('#gitList .gitem[data-git="packages/studio/src/main.rs"]')
  await page.waitForTimeout(400)
  const gitOpened = await page.evaluate(() => (document.getElementById('codePath')?.textContent ?? '').trim())
  // 回到 App.vue，验证 Diff 能**手动**切到 HEAD（判据 ⑱h 的老职责，别被 #1247 的自动联动顶掉）
  await page.click('#codeFiles button[data-file="packages/studio/ui/src/App.vue"]')
  await page.waitForTimeout(350)
  // ★#1247 起：点清单项本身就会进 Diff(head)，这里再点 #diffToggle 会把它**关掉** ⇒ 按需打开
  const diffWasOpen = await page.evaluate(() => !!document.getElementById('diffView'))
  if (!diffWasOpen) {
    await page.click('#diffToggle')
    await page.waitForTimeout(250)
  }
  await page.click('#diffView [data-src="disk"]')
  await page.waitForTimeout(200)
  await page.click('#diffView [data-src="head"]')
  await page.waitForTimeout(350)
  const headDiff = await page.evaluate(() => {
    const v = document.getElementById('diffView')
    if (!v) return null
    return {
      dels: [...v.querySelectorAll('.row.del .txt')].map((n) => n.textContent ?? '').slice(0, 3),
      headOn: document.querySelector('#diffView [data-src="head"]')?.classList.contains('on') ?? false,
    }
  })
  await page.click('#diffView [data-src="disk"]')
  await page.waitForTimeout(200)
  await page.click('#diffToggle')
  await page.waitForTimeout(200)

  // ── ㉞ 改动清单 ↔ Diff 联动（决策 #1247）：点清单项 = 打开 + 直接看它相对 HEAD 的改动 ──
  //   ★这条判据真正钉的是「**当前这个文件**的 HEAD」：桩按 path 返回不同标记，所以
  //     只要 `headText` 还是上一个文件的（串文件），删除行里就会冒出 App.vue 的标记 ⇒ 当场红。
  //     （原桩不分 path，这条缺陷根本测不出来 —— 桩替被测物把 bug 藏了。）
  await page.click('#gitList .gitem[data-git="packages/studio/src/main.rs"]')
  await page.waitForTimeout(520)
  const linked = await page.evaluate(() => {
    const v = document.getElementById('diffView')
    const dels = v ? [...v.querySelectorAll('.row.del .txt')].map((n) => n.textContent ?? '') : []
    return {
      path: (document.getElementById('codePath')?.textContent ?? '').trim(),
      open: !!v,
      headOn: document.querySelector('#diffView [data-src="head"]')?.classList.contains('on') ?? false,
      marker: dels.find((x) => x.includes('HEAD-VERSION-MARKER')) ?? '',
      highlighted: document.querySelector('#gitList .gitem.cur')?.getAttribute('data-git') ?? '',
    }
  })
  // 反向联动：从**文件树**打开另一个文件，清单高亮要跟着走，**Diff 的 HEAD 内容也必须跟着换**
  //   ★这一半是"串文件"缺陷的唯一出口：来源仍是 head、Diff 还开着，用户只是点了另一个文件。
  //     若此时 `headText` 没重取，屏幕上就是「A 的 HEAD vs B 的缓冲」——行号连续、增减数合理，
  //     内容全错。第一版判据只断言了高亮，变异（把重取换成 refreshDiff）照样绿 ⇒ 才补上内容断言。
  await page.click('#codeFiles button[data-file="packages/studio/ui/src/App.vue"]')
  await page.waitForTimeout(420)
  const afterTree = await page.evaluate(() => {
    const v = document.getElementById('diffView')
    const dels = v ? [...v.querySelectorAll('.row.del .txt')].map((n) => n.textContent ?? '') : []
    return {
      highlighted: document.querySelector('#gitList .gitem.cur')?.getAttribute('data-git') ?? '',
      marker: dels.find((x) => x.includes('HEAD-VERSION-MARKER')) ?? '',
      headOn: document.querySelector('#diffView [data-src="head"]')?.classList.contains('on') ?? false,
    }
  })
  // 收起 Diff，别把界面状态留给后面（本组是最后一步，留干净便于截图取证）
  await page.click('#diffToggle')
  await page.waitForTimeout(200)

  return { gitBar, gitList, gitOpened, headDiff, linked, afterTree, diffState, diffClosed, dirtySynced, winDlg, closeNowAfterCancel, closeNowAfterSave, dirtyBeforeClose, tabCountBefore, dlgShown, afterCancel, afterDiscard, langChip, langMenu, langPlain, langRust, langAuto, iconSamples, dirOpen, dirClosed, markOpen, markClosed, tabMenu, pickedCloseOthers, afterCloseOthers, nodeMenu, pickedCopyPath, copiedPath, editorMenu, escClosed, edgeMenu, anchorX, anchorY, toastAtCopy, toastStack, toastGone }
}
