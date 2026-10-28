// scripts/studio-panel-probes-term.mjs —— ㊼ 内置终端（决策 #1279）
//
// 【这条判据要防什么】终端最容易"看起来有、其实没接上"：
//   ① 命令名对不上（Rust 叫 `term_open`、前端写 `open_term`）⇒ invoke 静默 rejects，界面一片空白；
//   ② ANSI 解析错（颜色/清屏/退格）⇒ 一屏乱码，但"有输出"这一层看着是对的；
//   ③ 键盘没翻译成字节（Enter 发 `\n` 不是 `\r`）⇒ shell 不执行、只有换行；
//   ④ 切到终端视图**没把原生画布收成 0×0** ⇒ GL 画面浮在终端上，用户以为"打不出字"。
//   ⇒ 这条判据分两段：**静态**（命令名三方对齐：term.rs ↔ main.rs ↔ bridge.ts）+ **动态**（真点真敲）。
//
// 【它不证明什么】不证明真 pty 能跑（那由 Rust 单测 `pty_runs_echo_and_reads_back` 覆盖），
//   也不证明真实窗口里的字体度量（人眼那一步只能人眼）。
import fs from 'node:fs'
import path from 'node:path'

/** 静态：`term.rs` 的命令 ↔ `main.rs` 的注册 ↔ `bridge.ts` 的 invoke 字符串，三方必须一致 */
function staticParity(studioDir) {
  const rust = fs.readFileSync(path.join(studioDir, 'src/term.rs'), 'utf8')
  const main = fs.readFileSync(path.join(studioDir, 'src/main.rs'), 'utf8')
  const bridge = fs.readFileSync(path.join(studioDir, 'ui/src/bridge.ts'), 'utf8')

  /* term.rs 里 `#[tauri::command]` 之后紧跟的 `pub fn xxx`。
     ★要允许 `pub async fn`（决策 #1351：开/关会话改到工作线程，避免 fork/kill 卡住主线程）——
       判据的本意是"三个文件里命令名一致"，跟同步/异步无关；
       早先只认 `pub fn` 会把 async 命令漏掉，导致**假红**。 */
  const cmds = [...rust.matchAll(/#\[tauri::command\]\s*\n\s*pub\s+(?:async\s+)?fn (term_\w+)/g)].map((m) => m[1])
  const registered = [...main.matchAll(/term::(term_\w+)/g)].map((m) => m[1])
  const invoked = [...bridge.matchAll(/invoke<[^>]*>\('(term_\w+)'/g)].map((m) => m[1])
  const uni = (a) => [...new Set(a)].sort()
  return {
    cmds: uni(cmds),
    registered: uni(registered),
    invoked: uni(invoked),
    ok:
      cmds.length >= 5 &&
      uni(cmds).join(',') === uni(registered).join(',') &&
      uni(cmds).join(',') === uni(invoked).join(','),
  }
}

/** 动态：点 rail → 开会话 → 喂 ANSI → 敲键盘 → 改尺寸 */
export async function probeTerminal(page, studioDir) {
  const parity = staticParity(studioDir)

  const writeCalls = () =>
    page.evaluate(() => window.__STUB_CALLS__.filter((c) => c.cmd === 'term_write').map((c) => String(c.args?.data ?? '')))

  // ① 点 rail 的终端按钮 ⇒ 必须开出一个会话，且尺寸是**量出来的**（不是写死 80×24 的最坏情形）
  await page.click('#railTerm')
  await page.waitForTimeout(500)
  const opened = await page.evaluate(() => {
    const call = window.__STUB_CALLS__.filter((c) => c.cmd === 'term_open').slice(-1)[0]
    const stat = document.getElementById('termStat')?.textContent?.trim() ?? ''
    const wrap = document.getElementById('termWrap')
    return {
      called: !!call,
      cols: Number(call?.args?.cols ?? 0),
      rows: Number(call?.args?.rows ?? 0),
      stat,
      visible: !!wrap && wrap.getBoundingClientRect().height > 100,
      inputFound: !!document.getElementById('termInput'),
    }
  })

  // ② 喂一段带颜色 / 清屏 / 退格 / 中文的数据：屏幕内容必须**按语义**变
  await page.evaluate(() => {
    const fire = (d) => window.dispatchEvent(new CustomEvent('studio:term-data', { detail: d }))
    fire('\x1b[2J\x1b[H')                       // 清屏 + 归位
    fire('\x1b[1;31mERROR\x1b[0m plain ')
    fire('中文正常')                             // 多字节（Rust 侧按边界切，这里验渲染）
    fire('\r\n')                                 // 换行
    fire('\x1b[32mOK\x1b[0m')                    // 第二行绿色
  })
  await page.waitForTimeout(250)
  const painted = await page.evaluate(() => {
    const txt = document.getElementById('termBody')?.textContent ?? ''
    const spans = [...document.querySelectorAll('#termGrid span')]
    const colorOf = (word) => spans.find((s) => s.textContent?.includes(word))?.style?.color ?? ''
    const cur = document.getElementById('termCursor')
    return {
      text: txt,
      errColor: colorOf('ERROR'),
      okColor: colorOf('OK'),
      plainColor: colorOf('plain'),
      cursorTop: cur ? parseFloat(cur.style.top) : -1,
      cursorLeft: cur ? parseFloat(cur.style.left) : -1,
      rowCount: document.querySelectorAll('#termGrid .trow').length,
    }
  })

  // ③ 键盘 → 终端字节：Enter 必须是 \r、Ctrl-C 是 \x03、方向键是 CSI、Backspace 是 \x7f
  await page.evaluate(() => document.getElementById('termInput')?.focus())
  const before = (await writeCalls()).length
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Tab')
  await page.keyboard.press('a')
  await page.waitForTimeout(250)
  const sent = (await writeCalls()).slice(before)

  // ④ 改窗口大小 ⇒ 必须发 term_resize 且列数变小（说明不是只会开一次）
  const resizeBefore = await page.evaluate(() => window.__STUB_CALLS__.filter((c) => c.cmd === 'term_resize').length)
  const vp = page.viewportSize() ?? { width: 1440, height: 900 }
  await page.setViewportSize({ width: Math.max(700, Math.round(vp.width * 0.6)), height: vp.height })
  await page.waitForTimeout(500)
  const resized = await page.evaluate(() => {
    const all = window.__STUB_CALLS__.filter((c) => c.cmd === 'term_resize')
    const last = all.slice(-1)[0]
    return { count: all.length, cols: Number(last?.args?.cols ?? 0), rows: Number(last?.args?.rows ?? 0) }
  })
  await page.setViewportSize(vp)
  await page.waitForTimeout(300)

  /* ⑤ ★回放**真实 zsh 启动字节**（用户点开终端时抓的 816 字节，落在 fixtures 里）。
     这是"闪一下就全黑"那条 bug 的回归判据：zsh 画完提示符会发**裸的** `ESC[J` / `ESC[K`
     （缺省参数 0 = 擦向末尾）；若按通用默认 1 处理就会反向擦掉刚写的内容。
     ⇒ 断言只有一句：这几段真实字节喂进去之后，**提示符还在屏幕上**。
     ★分三块喂：跨 chunk 的序列边界（ESC 与 '[' 被切开）也必须活。 */
  const fixturePath = path.join(studioDir, '..', '..', 'scripts', 'fixtures', 'term-zsh-startup.bin')
  const raw = fs.readFileSync(fixturePath).toString('utf8')
  const cut1 = Math.floor(raw.length / 3)
  const cut2 = Math.floor((raw.length * 2) / 3)
  await page.evaluate((chunks) => {
    const fire = (d) => window.dispatchEvent(new CustomEvent('studio:term-data', { detail: d }))
    fire('\x1b[2J\x1b[H') // 先清屏（带参数，避免又踩 J/K 缺省值）
    for (const c of chunks) fire(c)
  }, [raw.slice(0, cut1), raw.slice(cut1, cut2), raw.slice(cut2)])
  await page.waitForTimeout(400)
  const replay = await page.evaluate(() => {
    const txt = document.getElementById('termBody')?.textContent ?? ''
    /* ★行数要数 **`.trow` 元素**，不能按 textContent 里的 '\n' 数：
       每行是一个 div，textContent 拼接后**没有任何换行符** ⇒ 按 '\n' 数永远是 1，
       断言 `rows >= 4` 会恒假（这是我自己写错过一版的地方）。 */
    const rows = [...document.querySelectorAll('#termGrid .trow')]
    return {
      text: txt,
      hasPrompt: txt.includes('kags@kagsdeiMac'),
      hasBranch: txt.includes('main'),
      hasWarn: txt.includes('rvm') || txt.includes('npmrc'),
      rows: rows.filter((r) => (r.textContent ?? '').trim()).length,
    }
  })

  return {
    parity,
    opened,
    painted,
    sent,
    resizeBefore,
    resized,
    replay,
  }
}
