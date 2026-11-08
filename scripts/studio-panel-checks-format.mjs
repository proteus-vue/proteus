// scripts/studio-panel-checks-format.mjs —— 判据 ㊿c / ㊿d（决策 #1462）
//
// 【判据纪律：注入的东西必须由真实运行时产生】
//   `format_text` 的回包**不是手写 fixture**：这里用 `page.exposeFunction` 注册一个 Node 侧
//   函数，桩转发到它，它真跑 `node_modules/.bin/prettier --stdin-filepath ...`。
//   ★参数不另写一份 —— 从 Rust 源码 `format.rs` 的 `FORMAT_ARGS` / `NO_PARSER_EXT`
//   常量静态读出 ⇒ 真实运行时与判据用的是**同一条命令、同一套风格**。
//   Rust 侧 `cargo test format::` 另有真跑 CLI 的单测；UI 判据只补「真实键盘 → IPC →
//   CodeMirror buffer → ⌘Z 回退」这一段，两边合起来才覆盖全链。
//
// 【为什么放在 termKeys 之后、`__BIG__` reload 与 closeAll() 之前】
//   它会真实改编辑器 buffer 和标签脏状态，早跑会污染前面的诊断/标签数判据；
//   晚跑则树里只剩 big.ts、页面已关闭。#1460 已为同一位置付过一次
//   "Target page has been closed" 的代价。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const TS_FILE = 'packages/studio/ui/src/bridge.ts'
const RS_FILE = 'packages/studio/src/main.rs'
/** CM 对「末尾换行」是否多渲染一个空行元素不稳定 ⇒ 比较时统一去掉尾部换行 */
const norm = (s) => String(s ?? '').replace(/\n+$/, '')

/** 从 Rust 源码读回参数（单一真源，避免判据手抄一份风格配置）。 */
function rustConfig(studioDir) {
  const src = fs.readFileSync(path.join(studioDir, 'src/format.rs'), 'utf8')
  const arrayOf = (decl) => {
    const m = src.match(new RegExp(`${decl}[^=]*=\\s*\\[([\\s\\S]*?)\\]`))
    return [...(m?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1])
  }
  const binRel = src.match(/pub const PRETTIER_BIN:\s*&str\s*=\s*"([^"]+)"/)?.[1] ?? ''
  return {
    args: arrayOf('pub const FORMAT_ARGS'),
    noParser: arrayOf('const NO_PARSER_EXT'),
    bin: path.join(studioDir, '..', '..', binRel),
    root: path.join(studioDir, '..', '..'),
  }
}

/** 静态接线：注册表 / 菜单 / IPC / 不写盘 / 参数同源，缺一条都可能是「假可用」。 */
function staticParity(studioDir, cfg) {
  const read = (rel) => fs.readFileSync(path.join(studioDir, rel), 'utf8')
  const kb = read('ui/src/keybindings.ts')
  const menu = read('ui/src/editorMenu.ts')
  const fmt = read('ui/src/editorFormat.ts')
  const main = read('src/main.rs')
  const rs = read('src/format.rs')
  return {
    action: kb.includes("| 'editor.formatDocument'") && kb.includes(`{ id: 'editor.formatDocument',`),
    chords: kb.includes("'editor.formatDocument': ['Shift+Alt+F']") && kb.includes("'editor.formatDocument': ['Mod+Alt+L']"),
    menu: menu.includes("id: 'format'") && menu.includes('formatDocument('),
    /* ★菜单与快捷键必须共用同一个执行函数，不能各写一遍 */
    oneImpl: (fmt.match(/export async function formatDocument/g) ?? []).length === 1,
    dispatch: fmt.includes('view.dispatch(') && fmt.includes('mapPos('),
    handler: main.includes('mod format;') && main.includes('format::format_text,'),
    noDiskWrite: rs.includes('Stdio::piped()') && rs.includes('--stdin-filepath') && !rs.includes('std::fs::write'),
    /* ★Option 改写字母时按物理键码回落（真机 ⇧⌥F 能命中，而 CDP 按键本来就会假绿） */
    altSafe: kb.includes("e.altKey && /^Key[A-Z]$/.test(e.code"),
    sharedArgs: cfg.args.includes('--single-quote') && cfg.args.includes('--no-semi') && cfg.args.includes('100') && cfg.noParser.includes('rs'),
  }
}

/** @returns {Promise<Array<[string, boolean]>>} 两条判据（文案 + 布尔） */
export async function checksFormat(page, studioDir) {
  const cfg = rustConfig(studioDir)
  const s = staticParity(studioDir, cfg)

  /** 真跑 CLI：前端 IPC 的回包与 expected 都出自这一个函数，不手写格式化结果。 */
  const runPrettier = (p, text) => {
    const ext = String(p).split('.').pop().toLowerCase()
    if (cfg.noParser.includes(ext)) throw new Error(`暂不支持 .${ext} 格式化（prettier 没有对应 parser）`)
    if (!p || p.startsWith('/') || p.includes('..')) throw new Error(`非法路径：${p}`)
    return execFileSync(cfg.bin, [...cfg.args, '--stdin-filepath', p], {
      input: text,
      cwd: cfg.root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }
  await page.exposeFunction('__formatWithPrettier', (p, text) => runPrettier(p, text))

  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  const MOD = mac ? 'Meta' : 'Control'
  /** ★桩文件只有 5~8 行、无虚拟滚动裁切 ⇒ `.cm-line` 拼接才等于全文（先钉基准） */
  const doc = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.cm-content .cm-line')].map((n) => n.textContent ?? '').join('\n'),
    )
  const calls = () =>
    page.evaluate(() => window.__STUB_CALLS__.filter((x) => x.cmd === 'format_text').map((x) => x.args))
  const toasts = () =>
    page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent ?? ''))
  const pressFormat = async () => {
    await page.keyboard.down('Shift')
    await page.keyboard.down('Alt')
    await page.keyboard.press('KeyF')
    await page.keyboard.up('Alt')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(320)
  }
  const press = async (key) => {
    await page.keyboard.down(MOD)
    await page.keyboard.press(key)
    await page.keyboard.up(MOD)
    await page.waitForTimeout(180)
  }

  /* ★先钉死键位基准：前面的探针可能写过 scheme / overrides，不清会按错键。
     走的是应用真实监听的 storage 通道（与 #1461 的自定义键判据一致）。 */
  await page.evaluate(() => {
    localStorage.setItem('proteus.keymapScheme', 'vscode')
    window.dispatchEvent(new StorageEvent('storage', { key: 'proteus.keymapScheme', newValue: 'vscode' }))
    localStorage.removeItem('proteus.keymapOverrides')
    window.dispatchEvent(new StorageEvent('storage', { key: 'proteus.keymapOverrides', newValue: null }))
  })

  // ① 真实鼠标切回代码视图 → 打开一个 .ts 文件 → 把 buffer 改成一段不规范代码
  await page.click('.rail button[aria-label="代码（只读）"]')
  await page.waitForTimeout(220)
  await page.click(`#codeFiles button[data-file="${TS_FILE}"]`)
  await page.waitForTimeout(220)
  const doc0 = await doc()
  await page.locator('.cm-content').click()
  const focusInEditor = await page.evaluate(() => !!document.activeElement?.closest?.('.cm-content'))
  await press('KeyA')
  await page.keyboard.insertText('const a={x:1,y:2};')
  await page.waitForTimeout(180)
  const doc1 = await doc()
  const expected = runPrettier(TS_FILE, doc1)

  // ② 真实键盘 ⇧⌥F（VS Code 预设）→ IPC → 真 prettier 回包 → buffer
  const before = await calls()
  await pressFormat()
  const doc2 = await doc()
  const after = await calls()
  const first = after[before.length] ?? null

  // ③ ⌘Z 一步回退（格式化只改 buffer，不能把用户之前的编辑一起吃掉）
  await press('KeyZ')
  const doc3 = await doc()

  // ④ 右键菜单入口：与快捷键共用同一个执行函数
  await page.click('#codeHost', { button: 'right', position: { x: 60, y: 60 } })
  await page.waitForTimeout(220)
  const hasFormatItem = await page.evaluate(() =>
    [...document.querySelectorAll('#ctxMenu [data-menu-item]')].some((n) => n.getAttribute('data-menu-item') === 'format'),
  )
  if (hasFormatItem) await page.click('#ctxMenu [data-menu-item="format"]')
  await page.waitForTimeout(320)
  const doc4 = await doc()

  // ⑤ 错误路径：.rs 没有 parser ⇒ 必须给「格式化失败」提示且 buffer 一个字不变
  await page.click(`#codeFiles button[data-file="${RS_FILE}"]`)
  await page.waitForTimeout(220)
  const rsBefore = await doc()
  await page.locator('.cm-content').click()
  const errBefore = await calls()
  await pressFormat()
  const rsAfter = await doc()
  const errToast = (await toasts()).some((t) => t.includes('格式化失败'))
  const errCalls = (await calls()).length - errBefore.length

  /* ★清理：scheme / overrides 不留给后面的 `__BIG__` 性能判据 */
  await page.evaluate(() => {
    localStorage.removeItem('proteus.keymapScheme')
    localStorage.removeItem('proteus.keymapOverrides')
    window.dispatchEvent(new StorageEvent('storage', { key: 'proteus.keymapScheme', newValue: null }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'proteus.keymapOverrides', newValue: null }))
  })

  const keyOk =
    focusInEditor &&
    doc0.length > 0 &&
    norm(doc1) !== norm(doc0) &&
    norm(expected) !== norm(doc1) &&
    norm(doc2) === norm(expected) &&
    first?.path === TS_FILE &&
    norm(first?.text) === norm(doc1) &&
    norm(doc3) === norm(doc1) &&
    hasFormatItem &&
    norm(doc4) === norm(expected)

  return [
    [
      `㊿c 格式化文档（决策 #1462 · 真实键盘 + 真 prettier 回包）：⇧⌥F → ${first?.path ?? '未调用'} · buffer ${norm(doc1).slice(0, 24)}→${norm(doc2).slice(0, 24)} · ⌘Z 回退=${norm(doc3) === norm(doc1)} · 右键菜单=${hasFormatItem}/${norm(doc4) === norm(expected)} · .rs 拒绝=${errToast}/buffer不变=${norm(rsAfter) === norm(rsBefore)}`,
      keyOk && errToast && norm(rsAfter) === norm(rsBefore) && errCalls === 1,
    ],
    [
      `㊿d 格式化全链静态接线（决策 #1462）：ActionId/键位=${s.action && s.chords} · 菜单=${s.menu} · 单一执行函数=${s.oneImpl} · dispatch+mapPos=${s.dispatch} · 命令注册=${s.handler} · 只改buffer不写盘=${s.noDiskWrite} · Alt物理键兜底=${s.altSafe} · Rust参数同源=${s.sharedArgs}`,
      Object.values(s).every(Boolean),
    ],
  ]
}
