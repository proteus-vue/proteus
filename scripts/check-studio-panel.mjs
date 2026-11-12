#!/usr/bin/env node
// scripts/check-studio-panel.mjs —— ★Studio 右栏面板门禁（决策 #1181 起，2026-10-22 出门升级为门禁 · #1187）
//
// 【为什么需要它】macOS 的屏幕录制权限（TCC）不给本进程，`screencapture` 直接失败，
//   Tauri 的 WKWebView 内容也因此**截不到**。于是右栏面板一直只有"代码看着对"这一层证据。
//   但面板本身是**纯 HTML**——把它用 Playwright 渲染一遍就能拿到真截图。
//
// 【它验证什么 / 不验证什么（别混）】
//   ✅ 验证：布局、字号、数值格式化（负值显示 "—"）、字段映射、深色可读性、IPC 接线
//   ❌ 不验证：Tauri IPC 真实往返（这里用桩）、WKWebView 的渲染差异、原生画布叠加
//   ⇒ 桩数据**不是编的**：来自 `packages/studio/fixtures/panel-source.json`
//     （同一次真实跑机的读数，原始输出留在 `results/panel-source.json`），
//     机型优先走真实 adb 查询（与应用里同一命令），无 adb 时回落到 fixture 记录的采集机型。
//     唯一被替换的是"值怎么送到页面"这一步。
//
// 【为什么判据脚本在 scripts/ 而不是 packages/studio/】仓库惯例：所有 `check:*` 都在
//   scripts/（判据与被测物分离，见 check-glass-capability 等）。被测物在 packages/studio。
//
// 用法：node scripts/check-studio-panel.mjs [--no-build] [--data <json>] [--out <png>]
//   --no-build  复用现有 web-dist（本地迭代快；CI 不用）
// 退出码：0 全过 / 1 有判据红 / 2 前置缺失（无产物且构建失败）

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { stubTauri } from './studio-panel-stub.mjs'
import { measureBigFile } from './studio-panel-perf.mjs'
import { probeCodeExtras, probeHole, probeMenu, probePan, probeSearch, probeTitlebar } from './studio-panel-probes.mjs'
// ★★★#1344：⑲ 段采样辅助已移到 studio-panel-boot.mjs（守 1000 行上限）。
const tokenSpans = () => tokenSpansIn(page), openFile = (p) => openFileIn(page, p)
import { probeCapPreset, probeDeviceSwitch, probeGesture, probeSettings, probeTapSpace, probeTouch } from './studio-panel-probes-input.mjs'
import { iconReport as iconReportOf } from './studio-panel-icons.mjs'
import { warnIfAppStale } from './studio-panel-stale.mjs'
import { resolveDevice } from './studio-panel-device.mjs'
import { openFile as openFileIn, openPanel, tokenSpans as tokenSpansIn } from './studio-panel-boot.mjs'
import { langExtCoverage } from './studio-panel-langext.mjs'
import { checkCapability } from './studio-panel-capability.mjs'
import { checkFixture } from './studio-panel-fixture.mjs'
import { checksConfig } from './studio-panel-checks-config.mjs'
import { reportChecks } from './studio-panel-report.mjs'
import { coreChecks } from './studio-panel-checks-core.mjs'
import { checksUiGuides, checksIosStream } from './studio-panel-checks-ui.mjs'
import { probeIosGuide } from './studio-panel-probes-ios.mjs'
import { probeTerminal } from './studio-panel-probes-term.mjs'
import { probeIosStream } from './studio-panel-probes-ios-stream.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STUDIO = path.join(ROOT, 'packages', 'studio')
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const dataPath = path.resolve(ROOT, arg('--data', 'packages/studio/fixtures/panel-source.json'))
const outPath = path.resolve(ROOT, arg('--out', 'packages/studio/results/inspector-panel.png'))
const SKIP_BUILD = process.argv.includes('--no-build')

if (!fs.existsSync(dataPath)) {
  console.error(`✗ 没有读数文件：${dataPath}`)
  process.exit(2)
}
const r = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

// ── ① 构建 UI（判据必须能独立跑：不依赖"上次谁手动 build 过"）─────────────
const DIST = path.join(STUDIO, 'web-dist')
if (!SKIP_BUILD) {
  try {
    execFileSync('bash', [path.join(STUDIO, 'build-ui.sh')], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    console.error('✗ UI 构建失败（packages/studio/build-ui.sh）')
    console.error(e.stdout || '', e.stderr || '', e.message)
    process.exit(2)
  }
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`✗ 没有构建产物：${DIST}\n  先构建：bash packages/studio/build-ui.sh`)
  process.exit(2)
}

/* ★★`--no-build` 必须校验**产物不比源码旧**（决策 #1345）。
   今天被这个坑了两次：改了 UI 源码却跑 `--no-build`，门禁读的是几百行之前的旧 bundle，
   于是「明明写错了却绿」（假绿）和「明明写对了却红」（假红）都出现过——
   一次是布局改动后报"文件树存在但不可见"，一次是模板注释写错却没报错。
   ⇒ 产物旧于任何 UI 源码时**直接失败**，让调用方自己决定"构建"还是"别用 --no-build"。 */
if (SKIP_BUILD) {
  const newest = (dir) => {
    let t = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) walk(f)
        else t = Math.max(t, fs.statSync(f).mtimeMs)
      }
    }
    walk(dir)
    return t
  }
  const srcT = newest(path.join(STUDIO, 'ui/src'))
  const distT = newest(DIST)
  if (srcT > distT) {
    const mins = Math.round((srcT - distT) / 60000)
    console.error(
      `✗ 产物比源码旧（旧 ${mins} 分钟）：--no-build 会读到过期 bundle，判据红绿都不可信\n` +
        `  ⇒ 去掉 --no-build（会自动构建），或先跑：bash packages/studio/build-ui.sh`,
    )
    process.exit(2)
  }
}

// 机型：真实 adb 优先，回落 fixture（采集时机型）—— 采集段在 studio-panel-device.mjs
const { device: deviceValue, from: deviceFrom } = resolveDevice(r.device)

const [w, h] = String(r.size ?? '1280x720').split('x').map(Number)
const stats = {
  frames: r.frames_presented ?? 0,
  late: r.late_frames ?? 0,
  cpu_pct: r.cpu?.single_core_pct ?? -1,
  fps: r.measured_fps ?? -1,
  iv_p50: r.interval_ms?.p50 ?? -1,
  iv_p95: r.interval_ms?.p95 ?? -1,
  lat_p50: r.latency_ms?.p50 ?? -1,
  lat_p95: r.latency_ms?.p95 ?? -1,
  qw_p50: r.queue_ms?.p50 ?? -1,
  dec_p50: r.decode_ms?.p50 ?? -1,
  cmp_p50: r.compose_ms?.p50 ?? -1,
  pres_p50: r.present_ms?.p50 ?? -1,
  aus: r.aus ?? 0,
  mbps: r.mbps ?? -1,
  empty: r.empty_ticks ?? 0,
  ticks: r.ticks ?? 0,
  width: w,
  height: h,
  hwdec: r.hwdec === 'videotoolbox',
  device: deviceValue,
}

// 起浏览器环境（静态服务 + chromium + 桩注入 + 首屏截图 + 收集 JS 错误）在 studio-panel-boot.mjs
const { page, errors, close: closeAll, url: panelUrl } = await openPanel({ dist: DIST, payload: stats, outPath })

// ── 判据（不是"看着像"就算过）────────────────────────────────────
const seen = await page.evaluate(() => {
  const txt = (id) => document.getElementById(id)?.textContent?.trim() ?? ''
  return {
    dev: txt('kdev'),
    stream: txt('kstream'),
    dec: txt('kdec'),
    fps: txt('kfps'),
    lat: txt('klat'),
    lat95: txt('klat95'),
    qw: txt('kqw'),
    empty: txt('kempty'),
    cpu: txt('kcpu'),
    link: txt('linkChip'),
    calls: (window.__STUB_CALLS__ || []).map((c) => c.cmd),
    rawMd: document.body.innerText.includes('**'),
  }
})
// ── ⑪ 代码视图（G4 第一块砖）：点左栏第二个按钮（◈ 代码）────────────────
// 验两件事：
//   · **文件通路真的通了**：`read_text` 被调用、面板渲染出桩内容
//   · **原生画布被收成 0×0** —— 这条最容易漏：GL 视图是独立 NSView，只隐藏 HTML 里的
//     #canvas 是盖不住它的（切到代码视图后会看到画面浮在代码上）。★判据必须盯"传了 w=0"，
//     而不是盯"HTML 里没有 #canvas 了"。
await page.click('.rail button:nth-child(2)')
await page.waitForTimeout(400)
const codeView = await page.evaluate(() => {
  // ★CodeMirror 把正文渲染在 .cm-content 里（不再是 <pre class="src">）
  const src = document.querySelector('.cm-content')?.textContent ?? ''
  const err = document.getElementById('codeErr')?.textContent ?? ''
  const all = window.__STUB_CALLS__ || []
  const rects = all.filter((c) => c.cmd === 'set_canvas_rect')
  const last = rects[rects.length - 1]
  return {
    src,
    err,
    // ★目录树：文件与目录分别计数（`data-file` / `data-dir`），否则"按钮数"混着两种行的语义
    fileCount: document.querySelectorAll('#codeFiles button[data-file]').length,
    dirCount: document.querySelectorAll('#codeFiles button[data-dir]').length,
    curPath: document.getElementById('codePath')?.textContent?.trim() ?? '',
    called: all.some((c) => c.cmd === 'read_text'),
    listed: all.some((c) => c.cmd === 'list_files'),
    zeroed: !!last && last.args?.w === 0 && last.args?.h === 0,
  }
})
// ⑪c：点第二个**文件**，路径与内容都要跟着换（验证 open 通路，不是只有默认那个能看）
//   ★按路径选而不是 nth-child：树里目录也是 button，序号会随折叠/排序变化（踩过两次）。
//
// ── ⑲ 语法着色（2026-10-25）──────────────────────────────────────────────
// 【为什么量 DOM 颜色，而不是断言"代码里有 syntaxHighlighting(...)"】
//   后者只能证明一段**可能没人调用**的配置存在——本仓已有两次同源假绿：
//   #1207（判据从 `window.__EMIT__` 注入，而真实入口一次都不触发）、
//   #1205（dump 读 FBO，永远正确，但上屏是拉伸的）。
//   这里取的是浏览器**算出来的 color**：扩展没挂上 ⇒ 全部同色 ⇒ 必然翻红。
const tokensVue = await tokenSpans()
/** 打开某个文件并等渲染完成（统一 250ms，与原有节奏一致） */
await openFile('packages/studio/src/main.rs')
const tokensRust = await tokenSpans()
const switchedPath = await page.evaluate(
  () => document.getElementById('codePath')?.textContent?.trim() ?? '',
)
// ⑲c/⑲d/⑲e：另外三类（TS / CSS / ObjC）各取一次样——同一台机器、同一套配色，
//   ★必须**逐个文件真打开**：语言包按扩展名注入，只测一个文件证明不了别的类型也接上了。
await openFile('packages/studio/ui/src/bridge.ts')
const tokensTs = await tokenSpans()
await openFile('packages/studio/ui/src/styles.css')
const tokensCss = await tokenSpans()
await openFile('packages/studio/native/embed_view.m')
const tokensObjc = await tokenSpans()
await openFile('packages/studio/src/main.rs') // 回 main.rs：⑱ 的编辑/保存仍在这个文件上

// ⑰ 目录可折叠：收起一个**与当前文件无关**的目录 ⇒ 里面的文件从可见行里消失，且折叠进会话状态
await page.locator('#codeFiles button[data-dir="packages/studio/native"]').click()
await page.waitForTimeout(200)
const collapsed = await page.evaluate(() => ({
  fileCount: document.querySelectorAll('#codeFiles button[data-file]').length,
  stillHasDir: !!document.querySelector('#codeFiles button[data-dir="packages/studio/native"]'),
}))

// ── ⑱ 编辑 + ⌘S 写回（IDE 主体的核心闭环：能改、能存、存的东西对不对）──────────
//  ★真实键盘输入 + 真实快捷键：走的是用户真会走的路径（不是调 API 造一个假 transaction）
await page.locator('.cm-content').click()
await page.keyboard.type('// edited by gate')
await page.waitForTimeout(150)
const dirtyShown = await page.evaluate(() => !!document.getElementById('codeDirty'))
await page.keyboard.press('Meta+s')
await page.waitForTimeout(400)
const saved = await page.evaluate(() => ({
  wrote: window.__LAST_WRITE__ ?? null,
  dirtyGone: !document.getElementById('codeDirty'),
  notice: document.getElementById('codeNotice')?.textContent?.trim() ?? '',
}))

// ── ⑱b 保存失败必须**说出来**（静默失败比不保存更糟：用户以为已落盘）──────────
await page.evaluate(() => {
  window.__FAIL_WRITE__ = true
})
await page.keyboard.type('X')
await page.keyboard.press('Meta+s')
await page.waitForTimeout(400)
const failedSave = await page.evaluate(() => ({
  // 提示已经搬到 toast（决策 #1236）：状态栏不再承担瞬时反馈
  notice: [...document.querySelectorAll('#toasts .toast')].map((n) => (n.textContent || '').trim()).join(' | '),
  stillDirty: !!document.getElementById('codeDirty'),
}))
// 错误 toast **常驻**（保存冲突要等人处理）⇒ 测完手动关掉，免得挡住后面的交互
{
  const x = await page.$('#toasts .toast.err .x')
  if (x) await x.click()
}

// ── ⑱c 切走再切回来，未保存的编辑**不能丢**（IDE 的脏缓冲语义）────────────────
//  ★这条替代了原本的 `confirm('放弃修改？')` 方案：Tauri 的 WKWebView 若没实现
//    runJavaScriptConfirmPanel，confirm 会静默返回 false ⇒ 表现成"点另一个文件没反应"。
//  ★按**路径**选而不是 nth：⑰ 折叠了 native，文件序号已经变了（踩过一次）。
await page.locator('#codeFiles button[data-file="packages/studio/ui/src/App.vue"]').click()
await page.waitForTimeout(300)
await page
  .locator('#codeFiles button[data-file="packages/studio/src/main.rs"]')
  .click()
await page.waitForTimeout(300)
const roundTrip = await page.evaluate(() => ({
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
  text: document.querySelector('.cm-content')?.textContent ?? '',
  dirty: !!document.getElementById('codeDirty'),
}))

// ── ⑫ G5 会话状态：切换后要落盘；reload 后要能**恢复上次的视图与文件** ──────────
const savedState = await page.evaluate(() => localStorage.getItem('__saved_state__') ?? '')

// ── ㉒ 多标签 + 每文件独立缓冲（决策 #1217）──────────────────────────────────
// 【为什么这么测】多标签最容易做成"看起来有标签、其实每次切都重新读盘"：
//   那种实现下，切回来**未保存内容还在**（因为从 buffers 恢复了文本），但 **undo 历史没了**。
//   所以关键断言是：切走再切回，⌘Z 必须还能撤销之前的输入（history 只存在于 EditorState 里）。
const tabState = await page.evaluate(() => ({
  count: document.querySelectorAll('#codeTabs button[data-tab]').length,
  labels: [...document.querySelectorAll('#codeTabs .tname')].map((n) => n.textContent ?? ''),
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
}))
// 切到 App.vue：脏标记必须跟着"文件"走（main.rs 有未保存 → 只有它的标签带圆点）
await page.locator('#codeTabs button[data-tab="packages/studio/ui/src/App.vue"]').click()
await page.waitForTimeout(250)
const dirtyByTab = await page.evaluate(() => {
  const dot = (p) => !!document.querySelector(`#codeTabs button[data-tab="${p}"] .tdot`)
  return {
    main: dot('packages/studio/src/main.rs'),
    app: dot('packages/studio/ui/src/App.vue'),
    path: document.getElementById('codePath')?.textContent?.trim() ?? '',
  }
})
// 切回 main.rs，⌘Z ×2：撤销掉 ⑱/⑱b 的两段输入（重新读盘的实现会"撤不动"）
await page.locator('#codeTabs button[data-tab="packages/studio/src/main.rs"]').click()
await page.waitForTimeout(250)
await page.locator('.cm-content').click()
// ★必须先断言"撤销前确实有东西可撤"：否则一个把编辑丢掉的重读实现也能让 ⌘Z 后"不含标记"（假绿）
const beforeUndo = await page.evaluate(
  () => document.querySelector('.cm-content')?.textContent ?? '',
)
await page.keyboard.press('Meta+z')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(200)
const undoKept = await page.evaluate(
  () => document.querySelector('.cm-content')?.textContent ?? '',
)
// ── ⑱d 菜单的「撤销」必须真的撤销（决策 #1242）─────────────────────────────────
// 【为什么单独立一条】原生菜单用 `PredefinedMenuItem::undo` 时，AppKit 把 ⌘Z 交给
//   **WKWebView 的 undoManager**，而撤销栈在 CodeMirror 里 ⇒ 按 ⌘Z 完全没反应，
//   而且菜单把键吃掉了、CM 的 keymap 也收不到。改成自绘动作（edit.undo → 前端 undo(view)）后要验：
//   派发菜单动作，文档必须真的回退。
await page.keyboard.type('// menu-undo-probe')
await page.waitForTimeout(120)
const beforeMenuUndo = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
await page.evaluate(() => window.dispatchEvent(new CustomEvent('studio:menu', { detail: 'edit.undo' })))
await page.waitForTimeout(220)
const afterMenuUndo = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
// ── ㉓ 标签栏必须待在编辑器区内（不能跨界压到左栏文件树上，决策 #1218）──────
// 【为什么单独立一条】这是纯布局约束，功能测试全绿也可能错：标签栏原先挂在 `.codepane`
//   下（整页宽度）⇒ 横跨整页、正好压在左栏树的上面。用户截图一眼看出，而 35 条判据全绿。
const tabLayout = await page.evaluate(() => {
  const rect = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), r: Math.round(b.right), y: Math.round(b.y), w: Math.round(b.width) }
  }
  return { tabs: rect('#codeTabs'), files: rect('#codeFiles'), pane: rect('.pane') }
})

// 关掉 main.rs 标签 ⇒ 回到相邻标签（App.vue），标签数 -1
await page.locator('#codeTabs button[data-tab="packages/studio/src/main.rs"] .tclose').click()
await page.waitForTimeout(300)
// ★此时 main.rs 是"改动被 ⌘Z 撤回到与原文件不同"的状态（脏）⇒ 关闭会弹确认框，
//   这条判据只关心"关掉后回到相邻标签"，所以明确选"不保存"（决策 #1243 引入的拦截）
if (await page.evaluate(() => !!document.getElementById('confirmDialog'))) {
  await page.click('#confirmDialog [data-act="discard"]')
}
await page.waitForTimeout(400)
const closed = await page.evaluate(() => ({
  count: document.querySelectorAll('#codeTabs button[data-tab]').length,
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
}))

const { titleConf, titleBar, dragProbe, dragScript, capSrc, capGen, capMissingSrc, capMissingGen } =
  await probeTitlebar(page, STUDIO)

// ── ⑬ 真实指针点击 → 落点标记（★修正 B1：原来的判据测的是一条死路）──────────────
// 【原来的判据错在哪】B1 认为"画布是叠在 HTML 之上的原生 NSView，HTML 收不到点击"，
//   于是从 `window.__EMIT__` 注入 `canvas-click` 事件 —— 判据绿了，但真实点击根本没这条通路：
//   GL 视图是 `addSubview ... positioned:NSWindowBelow` 挂的（**在所有兄弟视图最下面**），
//   而 WKWebView 铺满 contentView ⇒ 真实点击全被 webview 吃掉，`mouseDown:` 一次都不触发。
// 【现在测什么】直接在 `#canvas` 上做**真实指针点击**（Playwright 的 mouse 事件走浏览器命中测试），
//   断言标记落在画面正中、状态栏给出**设备像素**坐标。这才是用户真点下去会发生的事。
await page.click('.rail button:nth-child(1)')
await page.waitForTimeout(400)
const canvasBox = await page.evaluate(() => {
  const r = document.getElementById('canvas')?.getBoundingClientRect()
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
})
await page.mouse.click(canvasBox.x + canvasBox.w / 2, canvasBox.y + canvasBox.h / 2)
await page.waitForTimeout(250)
const pickSeen = await page.evaluate(() => {
  const el = document.getElementById('pickMark')
  const st = document.getElementById('spick')?.textContent?.trim() ?? ''
  return { has: !!el, left: el?.style.left ?? '', top: el?.style.top ?? '', status: st }
})
// 留一张"点击落点"的快照（人眼可核：圆圈+十字在画面正中）
await page.screenshot({ path: outPath.replace(/\.png$/, '-pick.png') })

// ── ⑭ 等比适配（2026-10-23）──────────────────────────────────────────────
// 【为什么单独立一条】原生视图此前是「main 区减内边距」的一整块，而 blit 把纹理**铺满视口**
//   ⇒ 画面被拉伸成视口的宽高比。这是**画面失真**不是观感问题，而且 `poc_dump` 读的是 FBO
//   不是屏幕，dump 永远正确 ⇒ 只有人眼能发现。判据必须盯"HTML 算出来的屏幕矩形比例 == 设备比例"。
const ar = stats.width / stats.height
const measure = () =>
  page.evaluate(() => {
    const r = document.querySelector('.screen')?.getBoundingClientRect()
    const all = window.__STUB_CALLS__ || []
    const rects = all.filter((c) => c.cmd === 'set_canvas_rect')
    const last = rects[rects.length - 1]
    return {
      x: r?.x ?? 0,
      w: r?.width ?? 0,
      h: r?.height ?? 0,
      ipcW: Number(last?.args?.w ?? 0),
      ipcH: Number(last?.args?.h ?? 0),
    }
  })
const box1 = await measure()
const ratioErr = (b) => (b.h > 0 ? Math.abs(b.w / b.h - ar) / ar : 1)

// ⑭b：窗口变窄后仍等比 —— 抓"只在初始尺寸下算对了"（把比例写死在 CSS 里的典型症状）
await page.setViewportSize({ width: 1100, height: 900 })
await page.waitForTimeout(500)
const box2 = await measure()
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(400)

// ⑮：缩放只改大小、不改形状（比例若跟着变，说明缩放实现是分别乘 w/h 的）
await page.click('.zoom button[aria-label="放大"]')
await page.waitForTimeout(400)
const box3 = await measure()
const zoomState = await page.evaluate(() => localStorage.getItem('__saved_state__') ?? '')
const zoomLabel = await page.evaluate(() => document.getElementById('zoomLabel')?.textContent?.trim() ?? '')
await page.screenshot({ path: outPath.replace(/\.png$/, '-zoom.png') })

// ── ⑯ 拖拽平移：采集段在 probePan()（决策 #1255 拆出；逻辑一字未改）
const { panBefore, panSeen, panReset } = await probePan(page, { outPath })
// ── ㊲ 画布洞：采集段在 probeHole()（决策 #1257：GL 垫在 webview 下面，HTML 不许盖它）
const hole = await probeHole(page)
// ── ㊴ 采集档位：采集段在 probeCapPreset()（决策 #1263）
const cap = await probeCapPreset(page)
// ── ㊵ 设备管理：采集段在 probeDeviceSwitch()（决策 #1265）
const dev = await probeDeviceSwitch(page)
// ── ㊶ 开发环境设置：采集段在 probeSettings()（决策 #1266）
const set = await probeSettings(page, panelUrl)

// ── ㉟ 触摸回传：采集段在 studio-panel-probes.mjs 的 probeTouch()（决策 #1254）
const touch = await probeTouch(page)
// ── ㊳ 触摸坐标空间：采集段在 probeTapSpace()（决策 #1260：设备物理像素 ≠ 码流像素）
const tapSpace = await probeTapSpace(page)
// ── ㊱ ⌥ 手势（滑动 / 长按）：采集段在 probeGesture()（决策 #1255）
const g = await probeGesture(page)

// 模拟"上次关在代码视图、在看 main.rs" ⇒ reload 应直接进代码视图
await page.evaluate(() =>
  localStorage.setItem(
    '__stub_state__',
    JSON.stringify({ view: 'code', codeFile: 'packages/studio/src/main.rs' }),
  ),
)
await page.reload()
await page.waitForTimeout(900)
const restored = await page.evaluate(() => ({
  path: document.getElementById('codePath')?.textContent?.trim() ?? '',
  files: document.querySelectorAll('#codeFiles button[data-file]').length,
}))
// ── ㉗ 图标（决策 #1224 · #1247 采集段拆到 studio-panel-icons.mjs）
//   判据仍是两条：① icns 必须比源 SVG 新；② 各档像素尺寸要对；两套通道都要过。
const { report: iconReport, ok: iconOk } = iconReportOf(STUDIO)

// ── ㉕ 菜单：每个动作项都必须有人接、而且真的做事（决策 #1221）
const { menuActs, menuDead, notBuilt, menuDevice, menuCode, menuZoomIn, menuZoomReset, menuZoomOut, menuFind, menuSaved, tabsBeforeMenu, tabsAfterMenu } = await probeMenu(page, STUDIO)

const { searchState, jumped, treeBack, engineShown } = await probeSearch(page, STUDIO)

const { gitBar, gitList, gitOpened, headDiff, linked, afterTree, diffState, diffClosed, dirtySynced, winDlg, closeNowAfterCancel, closeNowAfterSave, dirtyBeforeClose, tabCountBefore, dlgShown, afterCancel, afterDiscard, langChip, langMenu, langPlain, langRust, langAuto, iconSamples, dirOpen, dirClosed, markOpen, markClosed, tabMenu, pickedCloseOthers, afterCloseOthers, nodeMenu, pickedCopyPath, copiedPath, editorMenu, escClosed, edgeMenu, anchorX, anchorY, toastAtCopy, toastStack, toastGone } =
  await probeCodeExtras(page, STUDIO)

// 留一张代码视图快照（人眼可核）
await page.screenshot({ path: outPath.replace(/\.png$/, '-code.png') })
const fileOpsChecks = await (await import('./studio-panel-checks-fileops.mjs')).checksFileOps(page); const hoverChecks = await (await import('./studio-panel-checks-hover.mjs')).checksHover(page) // ㊿g ★须在 ㊻/㊽/㊼ 改视图前

/* ── ㊻ iOS 接法引导卡（采集段在 studio-panel-probes-ios.mjs，决策 #1277）──
   ★位置很关键：它会临时把 frames 归零（造"没画面"），跑完自己恢复。
     必须排在 pan/touch/hole 这些**依赖"有画面"**的采集之后，且必须在 `closeAll()` 之前
     （那个函数会关掉浏览器，之后任何 page.evaluate 都是 "Target page has been closed"）。 */
const ios = await probeIosGuide(page)

/* ── ㊽ 一键投屏（采集段在 studio-panel-probes-ios-stream.mjs，决策 #1288）──
   ★放在 ㊻ 之后：探针会点"投屏"按钮 ⇒ 把当前设备切成 iOS，
     后面 touch/tap 那些依赖 Android 的采集**已经跑完**了（它们在更前面）。 */
const iosStream = await probeIosStream(page)

/* ── ㊼ 内置终端（采集段在 studio-panel-probes-term.mjs，决策 #1279）──
   ★放这里：它会点 rail 切到终端视图（之后 perf 段自己 reload 回 code 视图，互不影响）。 */
const termProbe = await probeTerminal(page, STUDIO); const termKeysChecks = await (await import('./studio-panel-checks-termkeys.mjs')).checksTermKeys(page, STUDIO); const formatChecks = await (await import('./studio-panel-checks-format.mjs')).checksFormat(page, STUDIO)

// ── ㉑ 大文件着色性能（决策 #1216）────────────────────────────────────────────
// 【为什么要有这条】用户实测："两百多行的文件，滚动到哪才开始着色"。
//   根因不是语言包慢，而是 **CM 只解析视口附近**：跳到没解析的区域时，它在那一帧同步补解析
//   ⇒ 文字先出来、颜色晚到。实测（8000 行 .ts，同一台机、同一份 web-dist）：
//     不预热 213ms（静置 800ms 后仍是 213ms —— CM 并不会自己把整篇解析完）
//     预热后 15ms（forceParsing 空闲切片）
//   ⇒ 这条判据就是钉住"冷跳必须快"，防止以后有人把 warmParse 删掉。
await page.evaluate(() => {
  localStorage.setItem('__BIG__', '1')
  localStorage.setItem('__stub_state__', JSON.stringify({ view: 'code', codeFile: 'packages/studio/big.ts' }))
})
await page.reload()
const perf = await measureBigFile(page)
const parseFull = perf.parseFull

await closeAll()
// ⑩ fixture 与原始采集输出必须数值一致（采集段在 studio-panel-fixture.mjs）
const { ok: fixtureInSync, why: fixtureWhy } = checkFixture({ fixture: r, root: ROOT, studio: STUDIO })

/** 解析状态栏里的 "x,y"（设备像素） */
const parseXY = (s) => {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(s).trim())
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}
const pickXY = parseXY(pickSeen.status)
const panXY = parseXY(panSeen.status)
const panResetXY = parseXY(panReset.status)

/* ── ⑲ 着色取色（页面只交 (文本, 颜色)，比较放在 Node 侧，红的时候能打出实际色值）── */
const colOf = (s, pred) => s.items.find((i) => pred(i.t))?.c ?? ''
const distinctOf = (s) => new Set(s.items.map((i) => i.c))
const vueTag = colOf(tokensVue, (t) => t.includes('template'))
const vueKw = colOf(tokensVue, (t) => t === 'const')
const vueStr = colOf(tokensVue, (t) => t.includes('card') || t.includes("'ok'"))
const vueColors = [vueTag, vueKw, vueStr]
const rustKw = colOf(tokensRust, (t) => t === 'let')
const rustStr = colOf(tokensRust, (t) => t.includes('{}'))
const rustNum = colOf(tokensRust, (t) => t === '1')
const rustColors = [rustKw, rustStr, rustNum]
const tsKw = colOf(tokensTs, (t) => t === 'const')
const tsStr = colOf(tokensTs, (t) => t.includes("'ok'"))
const tsNum = colOf(tokensTs, (t) => t === '1')
const tsColors = [tsKw, tsStr, tsNum]
const cssProp = colOf(tokensCss, (t) => t === 'color')
const cssNum = colOf(tokensCss, (t) => t.startsWith('32'))
const cssComment = colOf(tokensCss, (t) => t.includes('/* note'))
const cssColors = [cssProp, cssNum, cssComment]
const objcKw = colOf(tokensObjc, (t) => t === 'static')
const objcNum = colOf(tokensObjc, (t) => t === '1')
const objcComment = colOf(tokensObjc, (t) => t.includes('// note'))
const objcColors = [objcKw, objcNum, objcComment]

/* ── ⑳ 覆盖表：树里出现的每个扩展名都必须有归属（采集段在 studio-panel-langext.mjs）── */
const { missing: missingExt, seen: seenExtCount } = langExtCoverage(STUDIO)

const capability = checkCapability(STUDIO)
const checks = [...fileOpsChecks, ...hoverChecks, ...termKeysChecks, ...formatChecks,
  /* 内联断言整块搬进 `studio-panel-checks-core.mjs`（决策 #1490）：本文件只留探测，
     断言保持原文靠解构传值；丢条由 `reportChecks` 的编号基线兜底。 */
  ...coreChecks({
    iconOk,
    checksConfig,
    checksUiGuides,
    checksIosStream,
    afterCancel,
    afterDiscard,
    afterTree,
    capSrc,
    closeNowAfterCancel,
    closeNowAfterSave,
    diffClosed,
    dirtySynced,
    dlgShown,
    gitBar,
    gitList,
    gitOpened,
    headDiff,
    iconReport,
    linked,
    seenExtCount,
    tabCountBefore,
    winDlg,
    afterCloseOthers,
    anchorX,
    anchorY,
    capGen,
    capMissingGen,
    capMissingSrc,
    copiedPath,
    diffState,
    dirClosed,
    dirOpen,
    dragProbe,
    dragScript,
    edgeMenu,
    editorMenu,
    engineShown,
    errors,
    escClosed,
    fixtureInSync,
    fixtureWhy,
    iconSamples,
    jumped,
    langAuto,
    langChip,
    langMenu,
    langPlain,
    langRust,
    markClosed,
    markOpen,
    menuActs,
    menuCode,
    menuDead,
    menuDevice,
    menuFind,
    menuSaved,
    menuZoomIn,
    menuZoomOut,
    menuZoomReset,
    missingExt,
    nodeMenu,
    notBuilt,
    panBefore,
    panReset,
    panSeen,
    pickedCloseOthers,
    pickedCopyPath,
    searchState,
    tabMenu,
    tabsAfterMenu,
    tabsBeforeMenu,
    titleBar,
    titleConf,
    toastAtCopy,
    toastGone,
    toastStack,
    treeBack,
    afterMenuUndo, beforeMenuUndo, beforeUndo, box1,
    box2, box3, cap, capability,
    closed, codeView, collapsed, cssColors,
    dev, dirtyByTab, dirtyShown, distinctOf,
    failedSave, g, hole, ios,
    iosStream, objcColors, panResetXY, panXY,
    parseFull, perf, pickSeen, pickXY,
    r, ratioErr, restored, roundTrip,
    rustColors, saved, savedState, seen,
    set, stats, switchedPath, tabLayout,
    tabState, tapSpace, termProbe, tokensCss,
    tokensObjc, tokensRust, tokensTs, tokensVue,
    touch, tsColors, undoKept, vueColors,
    zoomLabel, zoomState,
  }),
]
/* 打印 + 判据编号自检（决策 #1489）：见 `studio-panel-report.mjs` */
const bad = reportChecks(checks)
if (errors.length) console.log('  JS 错误：\n' + errors.map((e) => '   ' + e).join('\n'))
console.log(`\n面板快照：${path.relative(ROOT, outPath)}`)
console.log(`数据来源：${path.relative(ROOT, dataPath)}（真实跑机读数）· 机型来源：${deviceFrom}`)

// ── ★陈旧 .app 提醒（不是判据，不改变退出码；2026-10-25 用户实测踩到 · #1247 拆出）
warnIfAppStale(STUDIO)
process.exit(bad ? 1 : 0)
