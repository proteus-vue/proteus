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
/** ★决策 #1469：`.rs` 已由 rustfmt 接管（不再是"拒绝路径"），改用 ObjC 文件做拒绝用例。
 *  `embed_view.m` 在 `LIST_EXT` 里（文件树可见、点得到），但没有任何格式化器。 */
const REJECT_FILE = 'packages/studio/native/embed_view.m'
/** CM 对「末尾换行」是否多渲染一个空行元素不稳定 ⇒ 比较时统一去掉尾部换行 */
const norm = (s) => String(s ?? '').replace(/\n+$/, '')

/** 从 Rust 源码读回参数（单一真源，避免判据手抄一份风格配置）。 */
function rustConfig(studioDir) {
  const src = fs.readFileSync(path.join(studioDir, 'src/format.rs'), 'utf8')
  const arrayOf = (decl) => {
    const m = src.match(new RegExp(`${decl}[^=]*=\\s*\\[([\\s\\S]*?)\\]`))
    return [...(m?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1])
  }
  const jsRel = src.match(/pub const PRETTIER_JS:\s*&str\s*=\s*"([^"]+)"/)?.[1] ?? ''
  return {
    args: arrayOf('pub const FORMAT_ARGS'),
    noParser: arrayOf('const NO_PARSER_EXT'),
    js: path.join(studioDir, '..', '..', jsRel),
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
  /* ★决策 #1488：`generate_handler!` 已搬到 `app_setup.rs`（装配单独成模块）。
     判据必须跟着**真实位置**走 —— 与上面 #1468 那段是同一类教训：
     字符串搬走了但性质还在，查旧文件就是**假红**（看着像漏注册，其实是查错地方）。 */
  const setup = read('src/app_setup.rs')
  const rs = read('src/format.rs')
  /* ★决策 #1468/#1469：命令装配已下沉到 `proc_template`，所以"管道/绝对路径"这两条的
     证明位置换了文件 —— 判据必须跟着真实位置走，否则要么假绿（查一个不存在的字符串），
     要么假红（像本次这样：字符串搬走了但性质还在）。 */
  const tpl = read('src/proc_template.rs')
  const ios = read('src/ios_stream.rs')
  return {
    action: kb.includes("| 'editor.formatDocument'") && kb.includes(`{ id: 'editor.formatDocument',`),
    chords: kb.includes("'editor.formatDocument': ['Shift+Alt+F']") && kb.includes("'editor.formatDocument': ['Mod+Alt+L']"),
    menu: menu.includes("id: 'format'") && menu.includes('formatDocument('),
    /* ★菜单与快捷键必须共用同一个执行函数，不能各写一遍 */
    oneImpl: (fmt.match(/export async function formatDocument/g) ?? []).length === 1,
    dispatch: fmt.includes('view.dispatch(') && fmt.includes('mapPos('),
    handler: main.includes('mod format;') && setup.includes('format::format_text,'),
    /* ★决策 #1468：`Stdio::piped()` 已下沉到 proc_template::assemble。
       "不写盘"这条**两边都要查**：format.rs 不许写盘，模板层也不许写盘。 */
    noDiskWrite:
      tpl.includes('Stdio::piped()') &&
      rs.includes('--stdin-filepath') &&
      !rs.includes('std::fs::write') &&
      !tpl.includes('std::fs::write'),
    /* ★Option 改写字母时按物理键码回落（真机 ⇧⌥F 能命中，而 CDP 按键本来就会假绿） */
    altSafe: kb.includes("e.altKey && /^Key[A-Z]$/.test(e.code"),
    /* ★决策 #1469：`.rs` 已移出拒绝表（改由 rustfmt 处理），改用 `.m` 验证"拒绝表被读到了" */
    sharedArgs: cfg.args.includes('--single-quote') && cfg.args.includes('--no-semi') && cfg.args.includes('100') && cfg.noParser.includes('m'),
    /* ★决策 #1463：GUI 不继承终端 PATH ⇒ 不许再执行 `.bin/prettier` 那个 sh wrapper。
       静态只证明「代码形态」，真跑证明见 ㊿f 与本模块 Rust 单测，两者缺一都会假绿。
       ★决策 #1468/#1469：`Command::new(node)` 改由 `proc_template::assemble` 装配，
       所以这里改查**证据链**：node 仍由三层解析得到（`node_for_prettier()`），
       并被原样交给 assemble（`assemble(&node,`）——绝对路径这条性质没有丢。 */
    guiNode:
      rs.includes('pub const PRETTIER_JS') &&
      !rs.includes('pub const PRETTIER_BIN') &&
      rs.includes('ios_stream::child_path()') &&
      rs.includes('ios_stream::which(') &&
      rs.includes('let node = node_for_prettier()?;') &&
      rs.includes('assemble(&node,') &&
      tpl.includes('Command::new(program)') &&
      rs.includes('env_clear()'),
    sharedPath: ios.includes('pub(crate) fn child_path') && ios.includes('pub(crate) fn which'),
    /* ★决策 #1464：#1463 真机仍失败 —— 登录 shell PATH 与 12 个硬编码目录里都没有
       本机唯一的 node（~/.workbuddy/binaries/node/versions/<ver>/bin/node）。
       静态只证明「三层解析都在」，真跑由 Rust 单测 gui_minimal_env_end_to_end
       在 env_clear() 的整个进程里覆盖（那条才是不能被绕过的判据）。 */
    nodeScan:
      ios.includes('fn versioned_node_bin_dirs') &&
      ios.includes('fn child_path_from') &&
      ios.includes('.workbuddy/binaries/node/versions') &&
      rs.includes('fn packaged_node_path') &&
      rs.includes('PROTEUS_NODE') &&
      rs.includes('fn gui_minimal_env_end_to_end') &&
      fs.readFileSync(path.join(studioDir, 'package-app.sh'), 'utf8').includes('node-path.txt'),
  }
}

/** @returns {Promise<Array<[string, boolean]>>} 两条判据（文案 + 布尔） */
export async function checksFormat(page, studioDir) {
  const cfg = rustConfig(studioDir)
  const s = staticParity(studioDir, cfg)

  /* ★决策 #1463：模拟 GUI 的 launchd 环境（PATH 里没有 node）真跑同一条命令。
     用户截图是 `.bin/prettier: line 16: exec: node: not found`；这里用
     **绝对路径 node + 同一个 JS 入口**，正是 Rust 侧修复后的形态。
     （Node 侧本来就有 node，所以光看这条会假绿 ⇒ 必须叠加 s.guiNode 静态断言。） */
  const guiOut = (() => {
    try {
      return execFileSync(process.execPath, [cfg.js, ...cfg.args, '--stdin-filepath', TS_FILE], {
        input: 'const a = {x:1,y:2};\n',
        cwd: cfg.root,
        encoding: 'utf8',
        env: { ...process.env, PATH: '/usr/bin:/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      return ''
    }
  })()

  /** 真跑 CLI：前端 IPC 的回包与 expected 都出自这一个函数，不手写格式化结果。 */
  const runPrettier = (p, text) => {
    const ext = String(p).split('.').pop().toLowerCase()
    /* ★决策 #1469：`.rs` 已不在此表（走 rustfmt）。**桩这里不模拟 rustfmt** ——
       UI 判据只覆盖"真实键盘 → IPC → buffer → ⌘Z"这一段，`.rs` 的格式化验由
       `cargo test format::tests::formats_rust_with_real_rustfmt` 真跑 rustfmt 覆盖。
       两边分工，不是漏测。 */
    if (cfg.noParser.includes(ext)) throw new Error(`暂不支持 .${ext} 格式化（Studio 未接该语言的格式化器）`)
    if (!p || p.startsWith('/') || p.includes('..')) throw new Error(`非法路径：${p}`)
    return execFileSync(process.execPath, [cfg.js, ...cfg.args, '--stdin-filepath', p], {
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

  // ⑤ 错误路径：`.m`（ObjC）没有任何格式化器 ⇒ 必须给「格式化失败」提示且 buffer 一个字不变
  await page.click(`#codeFiles button[data-file="${REJECT_FILE}"]`)
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

  /* ★⑥ 真实设置窗口（决策 #1462 补判据）：用户反馈「快捷键里没定义、右键里也没有」。
     静态检查 ACTIONS 常量会「绿但不可用」——设置页是**独立窗口**（`?view=settings`），
     且默认停在「开发环境」分类，自定义快捷键列表在「编辑器」分类下（`v-if`）。
     所以这里在同一 context 里真开第二个页面、真点分类、真读 DOM 与键帽，
     证明用户走真实入口时**看得到**这一行，而不是只证明源码里有字符串。 */
  const settingsUrl = new URL(page.url())
  settingsUrl.searchParams.set('view', 'settings')
  const settingsPage = await page.context().newPage()
  const noRow = { row: false, label: '', keys: '', bound: false }
  const kb = await (async () => {
    try {
      await settingsPage.goto(settingsUrl.toString())
      await settingsPage.waitForTimeout(500)
      await settingsPage.click('[data-cat="editor"]')
      return await settingsPage.evaluate(() => {
        const row = document.querySelector('#setKeymapList [data-action="editor.formatDocument"]')
        const keys = [...(row?.querySelectorAll('.kbkey kbd') ?? [])].map((k) => k.textContent?.trim() ?? '')
        return {
          row: !!row,
          label: row?.querySelector('.kblabel')?.textContent?.trim() ?? '',
          keys: keys.join(' '),
          bound: keys.length > 0 && !keys.some((k) => k.includes('未绑定')),
        }
      })
    } catch {
      return noRow
    } finally {
      await settingsPage.close()
    }
  })()

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
      `㊿c 格式化文档（决策 #1462 · 真实键盘 + 真 prettier 回包）：⇧⌥F → ${first?.path ?? '未调用'} · buffer ${norm(doc1).slice(0, 24)}→${norm(doc2).slice(0, 24)} · ⌘Z 回退=${norm(doc3) === norm(doc1)} · 右键菜单=${hasFormatItem}/${norm(doc4) === norm(expected)} · .m 拒绝=${errToast}/buffer不变=${norm(rsAfter) === norm(rsBefore)}`,
      keyOk && errToast && norm(rsAfter) === norm(rsBefore) && errCalls === 1,
    ],
    [
      `㊿d 格式化全链静态接线（决策 #1462）：ActionId/键位=${s.action && s.chords} · 菜单=${s.menu} · 单一执行函数=${s.oneImpl} · dispatch+mapPos=${s.dispatch} · 命令注册=${s.handler} · 只改buffer不写盘=${s.noDiskWrite} · Alt物理键兜底=${s.altSafe} · Rust参数同源=${s.sharedArgs}`,
      Object.values(s).every(Boolean),
    ],
    [
      `㊿e 设置窗口可见性（决策 #1462 · 真实第二个页面）：编辑器分类下「格式化文档」=${kb.row}/${kb.label} · 键帽=${kb.keys || '(无)'} · 已绑定=${kb.bound}`,
      kb.row && kb.label === '格式化文档' && kb.bound,
    ],
    [
      `㊿f GUI 无 PATH 可用（决策 #1463/#1464 · 模拟 launchd）：PATH=/usr/bin:/bin 下产出=${guiOut.trim() || '(失败)'} · 绝对路径 node+JS 入口=${s.guiNode && s.sharedPath} · 版本管理器扫描/包内 node-path/PROTEUS_NODE 三层=${s.nodeScan}（真跑判据：cargo test format::tests::gui_minimal_env_end_to_end）`,
      guiOut.includes('const a = { x: 1, y: 2 }') && s.guiNode && s.sharedPath && s.nodeScan,
    ],
  ]
}
