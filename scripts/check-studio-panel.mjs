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
import { probeCapPreset, probeDeviceSwitch, probeGesture, probeSettings, probeTapSpace, probeTouch } from './studio-panel-probes-input.mjs'
import { iconReport as iconReportOf } from './studio-panel-icons.mjs'
import { warnIfAppStale } from './studio-panel-stale.mjs'
import { resolveDevice } from './studio-panel-device.mjs'
import { openPanel } from './studio-panel-boot.mjs'
import { langExtCoverage } from './studio-panel-langext.mjs'
import { checkFixture } from './studio-panel-fixture.mjs'

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
const tokenSpans = () =>
  page.evaluate(() => {
    const spans = [...document.querySelectorAll('.cm-line span')]
    return {
      base: getComputedStyle(document.querySelector('.cm-content')).color,
      items: spans.map((el) => ({
        t: (el.textContent || '').trim(),
        c: getComputedStyle(el).color,
      })),
    }
  })
const tokensVue = await tokenSpans()
/** 打开某个文件并等渲染完成（统一 250ms，与原有节奏一致） */
const openFile = async (p) => {
  await page.locator(`#codeFiles button[data-file="${p}"]`).click()
  await page.waitForTimeout(250)
}
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

const checks = [
  ['① 面板调到了 stats（IPC 接线通）', seen.calls.includes('stats')],
  ['② 画布矩形也被同步（HTML 驱动原生）', seen.calls.some((c) => c === 'set_canvas_rect')],
  ['③ 机型/画面/解码三行都有值（不是 "—"）', seen.dev !== '—' && seen.stream !== '—' && seen.dec !== '—'],
  ['④ 解码方式与读数一致（hwdec=videotoolbox ⇒ 显示硬解）', stats.hwdec ? seen.dec.includes('硬解') : seen.dec.includes('软件')],
  ['⑤ 延迟显示真实值（不是 "—"）', seen.lat.endsWith('ms') && seen.lat !== '—'],
  ['⑥ 管线四段都渲染了', [seen.lat, seen.qw, seen.cpu].every((v) => v && v !== '—')],
  ['⑦ 状态灯切到"画布运行中"（frames>0）', seen.link.includes('运行中')],
  ['⑧ 页面无 JS 错误', errors.length === 0],
  // 曾把 Markdown 粗体写进 HTML，页面上直接露出 "**"；这条挡住复发
  ['⑨ 正文无裸 "**"（Markdown 泄漏）', !seen.rawMd],
  // ⑪ 代码视图（G4）：读到文件 + 渲染出内容 + 原生画布收成 0×0
  [
    '⑪ 代码视图：read_text 被调用且渲染出内容',
    codeView.called && codeView.src.includes('stubLine') && !codeView.err,
  ],
  [
    `⑪b 切到代码视图时原生画布被收成 0×0（否则 GL 画面会浮在代码上）${codeView.zeroed ? '' : '（未收到 w=0/h=0）'}`,
    codeView.zeroed,
  ],
  [
    `⑪c 目录树渲染 ${codeView.dirCount} 个目录 + ${codeView.fileCount} 个文件，默认打开 App.vue`,
    codeView.listed &&
      codeView.fileCount === 5 &&
      codeView.dirCount === 6 &&
      codeView.curPath.endsWith('ui/src/App.vue'),
  ],
  [
    `⑪d 点第二个文件能切换（open 通路，不只是默认那个能看）${switchedPath.endsWith('main.rs') ? '' : `（当前 ${switchedPath}）`}`,
    switchedPath.endsWith('main.rs'),
  ],
  // ⑲ 语法着色：三类 token 必须**各自不同色**且都 ≠ 正文色（整篇一个色 = 着色没生效）
  [
    `⑲ .vue 着色：${tokensVue.items.length} 个 token · ${distinctOf(tokensVue).size} 种颜色 · 标签/关键字/字符串 ${vueColors.filter(Boolean).length}/3`,
    tokensVue.items.length >= 15 &&
      distinctOf(tokensVue).size >= 4 &&
      vueColors.every((c) => !!c && c !== tokensVue.base) &&
      new Set(vueColors).size === 3,
  ],
  [
    `⑲b .rs 着色：${tokensRust.items.length} 个 token · ${distinctOf(tokensRust).size} 种颜色 · 关键字/字符串/数字 ${rustColors.filter(Boolean).length}/3`,
    tokensRust.items.length >= 12 &&
      distinctOf(tokensRust).size >= 3 &&
      rustColors.every((c) => !!c && c !== tokensRust.base) &&
      new Set(rustColors).size === 3,
  ],
  // ⑲c/.ts ⑲d/.css ⑲e/.m：语言包是按扩展名注入的，必须逐个文件真打开才证明"接上了"
  [
    `⑲c .ts 着色：${tokensTs.items.length} 个 token · ${distinctOf(tokensTs).size} 种颜色 · 关键字/字符串/数字 ${tsColors.filter(Boolean).length}/3`,
    tokensTs.items.length >= 10 &&
      distinctOf(tokensTs).size >= 3 &&
      tsColors.every((c) => !!c && c !== tokensTs.base) &&
      new Set(tsColors).size === 3,
  ],
  [
    `⑲d .css 着色：${tokensCss.items.length} 个 token · ${distinctOf(tokensCss).size} 种颜色 · 属性/数字/注释 ${cssColors.filter(Boolean).length}/3`,
    tokensCss.items.length >= 5 &&
      cssColors.every((c) => !!c && c !== tokensCss.base) &&
      new Set(cssColors).size === 3,
  ],
  [
    `⑲e .m 着色（C 级降级，ObjC 无官方语法）：${tokensObjc.items.length} 个 token · ${distinctOf(tokensObjc).size} 种颜色 · 关键字/数字/注释 ${objcColors.filter(Boolean).length}/3`,
    tokensObjc.items.length >= 5 &&
      objcColors.every((c) => !!c && c !== tokensObjc.base) &&
      new Set(objcColors).size === 3,
  ],
  // ⑳ 覆盖表：树里每种扩展名都要有归属，否则新类型会静默掉队
  [
    `⑳ 覆盖表：树里 ${seenExtCount} 种扩展名 · ${missingExt.length ? '缺失：' + missingExt.join(' ') : '全部有归属'}`,
    missingExt.length === 0,
  ],
  // ⑰ 目录可折叠：收起后里面的文件从可见行里消失（目录行本身还在，才能再展开）
  [
    `⑰ 目录可折叠：收起 native 后可见文件 ${codeView.fileCount}→${collapsed.fileCount}，目录行仍在，且折叠进会话状态`,
    collapsed.fileCount === codeView.fileCount - 1 &&
      collapsed.stillHasDir &&
      savedState.includes('"codeCollapsed":["packages/studio/native"]'),
  ],
  // ⑱ 编辑 + ⌘S：真的把**改后的全文**写回去了，且 mtime 是打开时那个（冲突检测的输入）
  [
    `⑱ 编辑 + ⌘S 写回：${saved.wrote ? `${String(saved.wrote.text ?? '').length} 字节` : '未写'} · mtime 回传 ${saved.wrote?.expect} · 脏标记清除=${saved.dirtyGone}`,
    dirtyShown &&
      !!saved.wrote &&
      String(saved.wrote.text).includes('// edited by gate') &&
      String(saved.wrote.text).includes('stubLine') &&
      saved.wrote.expect === 1700000000000000 &&
      saved.dirtyGone,
  ],
  // ⑱b 保存被拒（mtime 冲突）⇒ 错误必须显示、且**不能**清掉脏标记
  [
    `⑱b 保存被拒时如实报错且仍标记未保存：${failedSave.notice.slice(0, 24) || '（无提示）'}…`,
    failedSave.notice.includes('拒绝覆盖') && failedSave.stillDirty,
  ],
  // ㉞ 改动清单 ↔ Diff 联动（决策 #1247）：点清单 → 打开 + 直接看**这个文件**相对 HEAD 的改动
  //   ★断言里同时要「含当前文件的标记」且「不含上一个文件的标记」——只断言"有标记"的话，
  //     串文件（拿 A 的 HEAD 比 B 的缓冲）照样能过。
  [
    `㉞ 清单↔Diff：点 main.rs → ${linked.path.split('/').pop() || '—'} · Diff 打开=${linked.open} 来源HEAD=${linked.headOn} · 删除行标记=「${linked.marker.replace('// ', '')}」· 高亮=${linked.highlighted.split('/').pop() || '—'} · 从树开 App.vue 后 高亮=${afterTree.highlighted.split('/').pop() || '—'} 标记=「${afterTree.marker.replace('// ', '')}」`,
    linked.path.endsWith('main.rs') &&
      linked.open &&
      linked.headOn &&
      // ① 删除行必须带**当前文件自己**的 HEAD 标记（不是别处的）
      linked.marker.includes('packages/studio/src/main.rs') &&
      !linked.marker.includes('ui/src/App.vue') &&
      linked.highlighted === 'packages/studio/src/main.rs' &&
      // ② 换成从树上打开另一个文件：高亮跟随 + HEAD 内容**重取**（不重取 ⇒ A 的 HEAD 配 B 的缓冲）
      afterTree.highlighted === 'packages/studio/ui/src/App.vue' &&
      afterTree.headOn &&
      afterTree.marker.includes('packages/studio/ui/src/App.vue') &&
      !afterTree.marker.includes('src/main.rs'),
  ],
  // ㊳ 触摸坐标空间：桩报"设备 1200×2608 / 码流 1280×720" ⇒ 必须按**物理**尺寸换算
  [
    `㊳ 触控坐标：点画布中心 → ${JSON.stringify(tapSpace.atCenter)}（物理应为 600,1304；码流会是 442,960）· 点 3/4 高度 → ${JSON.stringify(tapSpace.at3q)}（物理应为 600,1956）`,
    Math.abs(Number(tapSpace.atCenter?.x) - 600) <= 4 &&
      Math.abs(Number(tapSpace.atCenter?.y) - 1304) <= 4 &&
      Math.abs(Number(tapSpace.at3q?.x) - 600) <= 4 &&
      Math.abs(Number(tapSpace.at3q?.y) - 1956) <= 4,
  ],
  // ㊱ 手势：**直接拖拽 = 滑动**、按住不动 = 长按；⌥+拖拽 = 平移（决策 #1261 反转过默认）
  [
    `㊱ 手势：拖拽 → ${JSON.stringify(g.swipeOfDrag)}（画布被平移=${g.panMovedByPlainDrag}，应 false）· 按住 700ms → ${JSON.stringify(g.swipeOfHold)} · ⌥拖后累计 ${g.swipeCountAfterAltDrag} 条（应 2）、画布被平移=${g.panMovedByAltDrag}（应 true）· 拖出画布 → ${JSON.stringify(g.swipeOut)}（坐标非负=${g.outInBounds}，报错提示=「${g.errToast.slice(0, 30)}」应空）`,
    g.swipeCountAfterDrag === 1 &&
      Number(g.swipeOfDrag?.x1) === Number(g.swipeOfDrag?.x2) &&
      Number(g.swipeOfDrag?.y2) < Number(g.swipeOfDrag?.y1) - 50 &&
      Number(g.swipeOfDrag?.ms) > 0 &&
      g.panMovedByPlainDrag === false &&
      g.swipeCountAfterHold === 2 &&
      // 长按 = 同点 + 600ms（★别写成 x1===y1：那是在比两个轴，640≠360 永远假）
      Number(g.swipeOfHold?.x1) === Number(g.swipeOfHold?.x2) &&
      Number(g.swipeOfHold?.y1) === Number(g.swipeOfHold?.y2) &&
      Number(g.swipeOfHold?.ms) === 600 &&
      g.swipeCountAfterAltDrag === 2 &&
      g.panMovedByAltDrag === true &&
      // ④ 拖出画布：坐标被夹住（不能是负数，否则 u32 直接拒绝）
      g.outInBounds &&
      !g.errToast.includes('invalid args'),
  ],
  // ⑱h Git 只读：分支/改动数 + 改动清单可点开 + Diff 可切 HEAD
  [
    `⑱h Git：分支=${gitBar?.branch ?? '—'} · ${gitBar?.count ?? '—'} · 清单 ${gitList.items.length} 项(${gitList.sts.join('')}) · 点开→${gitOpened.split('/').pop() || '—'} · HEAD diff 命中标记=${(headDiff?.dels ?? []).some((x) => x.includes('HEAD-VERSION-MARKER'))}`,
    !!gitBar &&
      gitBar.branch === 'main' &&
      gitBar.count.includes('2') &&
      gitList.items.length === 2 &&
      gitList.sts.every((x) => x === 'M') &&
      gitOpened.endsWith('main.rs') &&
      !!headDiff &&
      headDiff.headOn &&
      headDiff.dels.some((x) => x.includes('HEAD-VERSION-MARKER')) &&
      // ★桩现在按 path 返回（#1247），所以这里能要求"标记属于**这个**文件"
      headDiff.dels.some((x) => x.includes('packages/studio/ui/src/App.vue')),
  ],
  // ⑱g Diff 视图：改一行 → 有增有删；开关来回切时编辑器与 Diff 互斥
  [
    `⑱g Diff：+${diffState?.added ?? '—'} −${diffState?.removed ?? '—'} · 新增行含探针=${(diffState?.adds ?? []).some((x) => x.includes('// diff-probe-line'))} · 打开时编辑区隐藏=${diffState?.hostHidden} · 关掉后 Diff 消失=${!diffClosed.view} 编辑区回来=${diffClosed.hostVisible}`,
    !!diffState &&
      diffState.added >= 1 &&
      diffState.removed >= 1 &&
      diffState.adds.some((x) => x.includes('// diff-probe-line')) &&
      diffState.hostHidden === true &&
      diffClosed.view === false &&
      diffClosed.hostVisible === true,
  ],
  // ⑱f 关窗口/退出拦截：脏计数要同步给 Rust；被拦下后三选一，选完才放行
  [
    `⑱f 关窗口：脏计数=${dirtySynced} · 对话框=${winDlg ? winDlg.join('/') : '未弹出'} · 取消后 close_now=${closeNowAfterCancel} 次 · 保存并关闭后=${closeNowAfterSave} 次`,
    dirtySynced >= 1 &&
      !!winDlg &&
      winDlg.includes('save') &&
      winDlg.includes('discard') &&
      winDlg.includes('cancel') &&
      closeNowAfterCancel === 0 &&
      closeNowAfterSave === 1,
  ],
  // ⑱e 关闭未保存标签：必须拦（三选一），取消要真的不关
  [
    `⑱e 关闭拦截：对话框=${dlgShown ? `「${dlgShown.title}」${dlgShown.acts.join('/')}` : '未弹出'} · 取消后 标签=${afterCancel.tabs} 改动仍在=${afterCancel.text.includes('// close-probe')} · 不保存后 标签=${afterDiscard.tabs}`,
    !!dlgShown &&
      dlgShown.acts.includes('save') &&
      dlgShown.acts.includes('discard') &&
      dlgShown.acts.includes('cancel') &&
      !afterCancel.dlg &&
      afterCancel.tabs === tabCountBefore &&
      afterCancel.text.includes('// close-probe') &&
      !afterDiscard.dlg &&
      afterDiscard.tabs === tabCountBefore - 1,
  ],
  // ⑱d 菜单「撤销」真的撤销（不是把键交给 WKWebView 的 undoManager）
  [
    `⑱d 菜单撤销：输入前含标记=${beforeMenuUndo.includes('// menu-undo-probe')} · 撤销后残留=${afterMenuUndo.includes('// menu-undo-probe')}`,
    beforeMenuUndo.includes('// menu-undo-probe') && !afterMenuUndo.includes('// menu-undo-probe'),
  ],
  // ⑱c 脏缓冲：切到别的文件再切回来，改过的内容还在（否则"切一下丢编辑"是最气人的）
  [
    `⑱c 切走再切回不丢编辑：${roundTrip.path.split('/').pop() || '空'} · 仍有未保存标记=${roundTrip.dirty}`,
    roundTrip.path.endsWith('main.rs') &&
      roundTrip.text.includes('// edited by gate') &&
      roundTrip.dirty,
  ],
  // ㉒ 多标签：标签数/标签名 + 脏标记按文件独立
  [
    `㉒ 多标签：${tabState.count} 个标签（${tabState.labels.join(' / ')}）· 脏标记按文件独立（main=${dirtyByTab.main} app=${dirtyByTab.app}）`,
    tabState.count >= 2 &&
      tabState.labels.includes('App.vue') &&
      tabState.labels.includes('main.rs') &&
      dirtyByTab.main === true &&
      dirtyByTab.app === false &&
      dirtyByTab.path.endsWith('App.vue'),
  ],
  // ㉒b：⌘Z 跨标签仍生效（undo 历史真的在 state 里）+ 关标签回到相邻
  [
    `㉒b 切回后 ⌘Z 仍可撤销（撤销前有编辑=${beforeUndo.includes('// edited by gate')}，撤销后无=${!undoKept.includes('// edited by gate')}）· 关标签后剩 ${closed.count} 个并回到「${closed.path.split('/').pop() || '空'}」`,
    beforeUndo.includes('// edited by gate') &&
      !undoKept.includes('// edited by gate') &&
      closed.count === tabState.count - 1 &&
      closed.path.endsWith('App.vue'),
  ],
  // ㉔c 能力（ACL）：标题栏拖拽/双击缩放与菜单事件，必须同时写进源文件**和**构建产物
  [
    `㉔c 能力：源文件缺 ${capMissingSrc.join(',') || '无'} · 构建产物缺 ${capMissingGen.join(',') || '无'}${capGen ? '' : '（capabilities.json 不存在：没编过？）'}`,
    !!capSrc && !!capGen?.default && capMissingSrc.length === 0 && capMissingGen.length === 0,
  ],
  // ㉔b 标题栏真的能拖 / 双击能缩放（注入 Tauri 的 drag.js，看它有没有发 window 命令）
  [
    `㉔b 标题栏拖拽：drag-region=${JSON.stringify(dragProbe.mode)} · 三点命中 ${dragProbe.out.map((o) => `${o.hit || o.drag.length}→${o.drag.length ? '拖' : '不拖'}`).join(' / ')} · 双击→${dragProbe.dbl.length ? '缩放' : '无反应'}${dragScript.from.includes('镜像') ? '（镜像规则）' : ''}`,
    dragProbe.mode === 'deep' &&
      dragProbe.out.every((o) => o.drag.includes('plugin:window|start_dragging')) &&
      dragProbe.dbl.includes('plugin:window|internal_toggle_maximize'),
  ],
  // ㉔ 沉浸式标题栏：配置 Overlay + 顶栏可拖 + 给红绿灯留位
  [
    `㉔ 沉浸式标题栏：${titleConf.titleBarStyle}/hiddenTitle=${titleConf.hiddenTitle} · 红绿灯 x=${titleConf.trafficLightPosition?.x},y=${titleConf.trafficLightPosition?.y} · 顶栏可拖=${titleBar.drag} · 左内边距 ${titleBar.padLeft}px（首个 chip x=${titleBar.chipX}，品牌已移除=${!titleBar.brand}）`,
    titleConf.titleBarStyle === 'Overlay' &&
      titleConf.hiddenTitle === true &&
      (titleConf.trafficLightPosition?.x ?? 0) >= 10 &&
      // ★y 的语义不是"灯的 top"：wry 把标题栏容器加高到 `灯高 + y`，灯固定在容器底部
      //   ⇒ 灯中心 ≈ y - 1.5。40px 顶栏要居中 ⇒ y≈22（实测 y=13 时中心 11，差 9px）。
      (titleConf.trafficLightPosition?.y ?? 0) >= 20 &&
      (titleConf.trafficLightPosition?.y ?? 0) <= 24 &&
      titleBar.drag &&
      titleBar.padLeft >= 76 &&
      titleBar.chipX >= 80 &&
      !titleBar.brand &&
      titleBar.height === 40,
  ],
  // ㉕ 菜单：登记 → 建进菜单 → 前端有人接 → 每个动作真的做事
  [
    `㉕ 菜单动作 ${menuActs.length} 项全部有人接（死项 ${menuDead.length} · 未建进菜单 ${notBuilt.map((a) => a.id).join(',') || '无'}）· 视图 ${menuDevice}/${menuCode} · 缩放 ${menuZoomIn}/${menuZoomReset}/${menuZoomOut} · 查找焦点=${menuFind || '无'} · 菜单保存=${menuSaved.includes('// menu-save')} · 关标签 ${tabsBeforeMenu}→${tabsAfterMenu}`,
    menuActs.length >= 8 &&
      new Set(menuActs.map((a) => a.id)).size === menuActs.length &&
      new Set(menuActs.map((a) => a.accel)).size === menuActs.length &&
      notBuilt.length === 0 &&
      menuDead.length === 0 &&
      menuDevice === true &&
      menuCode === true &&
      menuZoomIn === '125%' &&
      menuZoomReset === '适应' &&
      menuZoomOut === '75%' &&
      menuFind === 'codeSearch' &&
      menuSaved.includes('// menu-save') &&
      tabsBeforeMenu >= 1 &&
      tabsAfterMenu === tabsBeforeMenu - 1,
  ],
  // ㉝ 语言模式：状态栏显示当前类型 + 手选后真的换了解析器（纯文本 0 个着色 span）
  [
    `㉝ 语言模式：状态栏「${langChip?.text ?? '—'}」(${langChip?.lang ?? '—'}) · 选单 ${langMenu.count} 项（含 Python/Rust=${langMenu.hasPy && langMenu.hasRust}）· 纯文本→${langPlain.chip} 着色 span=${langPlain.tokens} · Rust→${langRust.chip} 着色 span=${langRust.tokens} · 回自动→${langAuto.chip} 着色 span=${langAuto.tokens}`,
    langChip?.lang === 'vue' &&
      langChip.text.includes('Vue') &&
      langMenu.count >= 20 &&
      langMenu.hasPy &&
      langMenu.hasRust &&
      langPlain.chip === 'plain' &&
      langPlain.host === 'plain' &&
      langPlain.tokens === 0 &&
      langRust.chip === 'rust' &&
      langRust.tokens > 0 &&
      langAuto.chip === 'vue' &&
      langAuto.tokens > 0,
  ],
  // ㉜ 贴边定位，翻转后必须贴着鼠标；hover 底色必须是中性灰
  [
    `㉜ 菜单定位：锚点(${anchorX},${anchorY}) · 尺寸 ${edgeMenu ? Math.round(edgeMenu.right - edgeMenu.left) + '×' + Math.round(edgeMenu.bottom - edgeMenu.top) : '—'} · 实际 left/top=${edgeMenu ? Math.round(edgeMenu.left) + '/' + Math.round(edgeMenu.top) : '—'} · hover 底色=${edgeMenu?.bg ?? '—'} · 光标=${edgeMenu?.cursor ?? '—'}（禁用项=${edgeMenu?.disabledCursor ?? '—'}）`,
    (() => {
      if (!edgeMenu) return false
      const w = edgeMenu.right - edgeMenu.left
      const h = edgeMenu.bottom - edgeMenu.top
      const fitsRight = anchorX + w <= edgeMenu.vw - 8
      const fitsDown = anchorY + h <= edgeMenu.vh - 8
      // 装得下 ⇒ 左上角贴锚点；装不下 ⇒ 翻转，右下角贴锚点。两种都必须"贴着鼠标"。
      const xOk = fitsRight ? Math.abs(edgeMenu.left - anchorX) <= 1 : Math.abs(edgeMenu.right - anchorX) <= 1
      const yOk = fitsDown ? Math.abs(edgeMenu.top - anchorY) <= 1 : Math.abs(edgeMenu.bottom - anchorY) <= 1
      const inside =
        edgeMenu.left >= 0 &&
        edgeMenu.top >= 0 &&
        edgeMenu.right <= edgeMenu.vw &&
        edgeMenu.bottom <= edgeMenu.vh
      const m = (edgeMenu.bg.match(/\d+/g) ?? []).map(Number).slice(0, 3)
      const neutral = m.length === 3 && Math.max(...m) - Math.min(...m) <= 14
      // 可点项必须是手指光标；禁用项不能被写成 pointer（那会骗人去点）
      const cursorOk = edgeMenu.cursor === 'pointer' && (edgeMenu.disabledCursor === 'default' || edgeMenu.disabledCursor.startsWith('（'))
      return xOk && yOk && inside && neutral && cursorOk
    })(),
  ],
  // ㉛ 瞬时反馈：复制成功出 toast、连点叠着、3 秒内自己消失
  [
    `㉛ 提示：复制后出现 ${toastAtCopy.length} 条（${toastAtCopy[0]?.text ?? '—'}）· 连续操作叠到 ${toastStack} 条 · 3s 后自动消退=${toastGone}`,
    toastAtCopy.length >= 1 &&
      toastAtCopy.some((t) => t.kind === 'ok' && t.text.includes('已复制路径')) &&
      toastStack >= 2 &&
      toastGone,
  ],
  // ㉘ 目录图标两态（展开 folderOpen / 折叠 folder）
  [
    `㉘ 目录图标：展开=${dirOpen}(svg data-open=${markOpen}) · 折叠=${dirClosed}(svg data-open=${markClosed})`,
    dirOpen === 'folderOpen' && dirClosed === 'folder' && markOpen === '1' && markClosed === '0',
  ],
  // ㉙ 文件类型图标：不同语言不同记号 + 不同类型色
  [
    `㉙ 文件类型图标：${Object.entries(iconSamples)
      .map(([p, v]) => `${p.split('/').pop()}=${v ? v.icon : '缺'}`)
      .join(' · ')}`,
    Object.values(iconSamples).every((v) => v && v.icon && v.icon !== 'file') &&
      new Set(Object.values(iconSamples).map((v) => v.icon)).size === Object.keys(iconSamples).length &&
      new Set(Object.values(iconSamples).map((v) => v.color)).size >= 4,
  ],
  // ㉚ 三处右键菜单：标签（关闭其他）/ 文件树（复制路径）/ 编辑器（保存撤销）+ Esc 关闭
  [
    `㉚ 右键菜单：标签${tabMenu.open ? `(${tabMenu.items.length} 项)` : '未弹出'} → 关闭其他后 ${afterCloseOthers.tabs} 个标签 · 文件树含 copyPath=${nodeMenu.items.includes('copyPath')} 复制到「${copiedPath.split('/').pop()}」 · 编辑器含 save/undo/redo/selectAll=${['save', 'undo', 'redo', 'selectAll'].every((x) => editorMenu.items.includes(x))} · Esc 关闭=${escClosed}`,
    tabMenu.open &&
      tabMenu.items.includes('closeOthers') &&
      pickedCloseOthers &&
      afterCloseOthers.tabs === 1 &&
      afterCloseOthers.path.endsWith('App.vue') &&
      nodeMenu.items.includes('copyPath') &&
      pickedCopyPath &&
      copiedPath === 'packages/studio/src/main.rs' &&
      ['save', 'undo', 'redo', 'selectAll'].every((x) => editorMenu.items.includes(x)) &&
      escClosed,
  ],
  // ㉗ 图标（双通道）：icns 与源 SVG 同步 + icns 内各档尺寸正确
  [
    `㉗ 图标：${iconReport
      .map(
        (r) =>
          `${r.name} ${r.exists ? `${r.ageMin <= 0 ? '同步' : `旧 ${r.ageMin} 分钟`}·${r.slices} 档${r.missing.length ? `缺${r.missing.join(',')}` : ''}${r.pngOk ? '' : '·png 非 1024'}` : '缺失'}`,
      )
      .join(' | ')}`,
    iconOk,
  ],
  // ㉖ 搜索：命中数一致 + 点一条真的跳到那一格（不是"打开文件就算过"）
  [
    `㉖ 搜索「stub」：${searchState.hits} 条命中（目录树让位=${searchState.treeGone}）· 点第一条 → ${jumped.path.split('/').pop()} 落在 ${jumped.caret}（期望 4:9）· 清除后树回来=${treeBack} · 没 rg 时引擎标注=「${engineShown.meta.split('·').pop()?.trim() ?? ''}」`,
    searchState.hits === 2 &&
      searchState.treeGone &&
      jumped.path.endsWith('main.rs') &&
      jumped.caret === '4:9' &&
      jumped.active.includes('let stubLine') &&
      treeBack &&
      engineShown.hits === 2 &&
      engineShown.meta.includes('内置扫描'),
  ],
  // ㉓ 标签栏在编辑器区内（起点 ≥ 文件树右边界；宽度 == 右栏宽度）
  [
    `㉓ 标签栏不跨界：标签 x=${tabLayout.tabs?.x} ≥ 树右边界 ${tabLayout.files?.r}（右栏 ${tabLayout.pane?.x}..${tabLayout.pane?.r}，标签宽 ${tabLayout.tabs?.w}）`,
    !!tabLayout.tabs &&
      !!tabLayout.files &&
      !!tabLayout.pane &&
      tabLayout.tabs.x >= tabLayout.files.r - 1 &&
      Math.abs(tabLayout.tabs.w - tabLayout.pane.w) <= 1,
  ],
  // ⑫ G5：切换要落盘（否则"记住上次"只是口头承诺）
  [
    `⑫ 切换视图/文件后写入会话状态${savedState.includes('"view":"code"') ? '' : `（实际 "${savedState}"）`}`,
    savedState.includes('"view":"code"') && savedState.includes('main.rs'),
  ],
  // ⑬ 真实指针点击 → 标记 + 设备像素坐标
  //   ★容差 ±3 设备像素：Playwright 把 clientX/Y 取整到整数像素，而屏幕矩形常在半像素上，
  //     所以"点正中"折算回设备像素不一定是精确的一半。断言"接近中心"才是对的判据。
  [
    `⑬ 真实点击落点：标记 ${pickSeen.left},${pickSeen.top} · 设备像素 ${pickSeen.status}（期望 ≈ ${stats.width / 2},${stats.height / 2}）`,
    pickSeen.has &&
      Math.abs(parseFloat(pickSeen.left) - 50) < 0.6 &&
      Math.abs(parseFloat(pickSeen.top) - 50) < 0.6 &&
      !!pickXY &&
      Math.abs(pickXY.x - stats.width / 2) <= 3 &&
      Math.abs(pickXY.y - stats.height / 2) <= 3,
  ],
  // ⑫b reload 后恢复上次视图与文件（这条才是"重启即恢复"的真正判据）
  [
    `⑫b reload 后恢复上次的视图与文件${restored.path.endsWith('main.rs') ? '' : `（当前 ${restored.path || '空'}）`}`,
    restored.files === codeView.fileCount && restored.path.endsWith('main.rs'),
  ],
  // ⑭ 等比适配：屏幕矩形比例必须等于设备比例，且**原生视图收到的矩形与之一致**
  //    （只比值不够：HTML 对了但没把新矩形发给原生，画面上仍是拉伸的旧尺寸）
  [
    `⑭ 画面等比适配：屏幕 ${box1.w.toFixed(1)}×${box1.h.toFixed(1)} vs 设备 ${stats.width}×${stats.height}（比例误差 ${(ratioErr(box1) * 100).toFixed(2)}%）`,
    ratioErr(box1) < 0.005 && Math.abs(box1.ipcW - box1.w) < 1.5 && Math.abs(box1.ipcH - box1.h) < 1.5,
  ],
  [
    `⑭b 窗口变窄后仍等比（${box2.w.toFixed(1)}×${box2.h.toFixed(1)}，误差 ${(ratioErr(box2) * 100).toFixed(2)}%）且确实变小了`,
    ratioErr(box2) < 0.005 && box2.w < box1.w * 0.85,
  ],
  [
    `⑮ 缩放只改大小不改形状：${box3.w.toFixed(0)}×${box3.h.toFixed(0)}（误差 ${(ratioErr(box3) * 100).toFixed(2)}%）· 标签 ${zoomLabel}`,
    ratioErr(box3) < 0.005 &&
      box3.w > box1.w * 1.15 &&
      zoomLabel === '125%' &&
      zoomState.includes('"zoom":1.25'),
  ],
  // ㊷ 低门槛：点候选即用 / 浏览… 走系统面板 / 取消不改（决策 #1268）
  [
    `㊷ 路径点选：候选 Xcode ${set.init.xCands.length} 条（首条「${set.init.xCands[0]?.ver ?? '—'}」）· adb ${set.init.aCands} 条（自动填 ${set.init.adb ? '是' : '否'}）· 点首条 ⇒ 值=「${set.picked.value.split('/').pop()}」版本=「${set.picked.msg?.text ?? '—'}」额外探测 ${set.picked.extraProbes} 次（应 0）· 浏览 ⇒ ${JSON.stringify(set.pickArgs[0])} 值=「${String(set.browsed).split('/').pop()}」· 取消后 ${String(set.afterCancel).split('/').pop()}（应不变）`,
    set.init.xCands.length === 2 &&
      String(set.init.xCands[0]?.ver ?? '').includes('Xcode') &&
      set.init.aCands === 1 &&
      set.init.adb === '/opt/homebrew/bin/adb' &&
      set.picked.value === '/Volumes/data1/work/office-applications/Xcode.app' &&
      set.picked.msg?.ok === true &&
      String(set.picked.msg?.text ?? '').includes('Xcode') &&
      set.picked.extraProbes === 0 &&
      set.pickArgs[0]?.kind === 'xcode' &&
      set.browsed === '/Applications/Xcode-browse.app' &&
      set.afterCancel === set.beforeCancel,
  ],
  // ㊶ 设置窗口（独立窗口 + 左侧分类）：入口、导航、检测、保存
  [
    `㊶ 设置窗口：主窗口点设置 ⇒ open_settings×${set.openCalls} · 分类 ${set.nav0.map((n) => n.label).join('/')}（当前 ${set.nav0.find((n) => n.on)?.label ?? '—'}）· 设备只读 ${set.devRows} 行 · 关于含设置路径=${set.aboutText.includes('settings.json')} · 检测 → ${set.probeOk.arg?.kind}/「${String(set.probeOk.arg?.path).split('/').pop()}」⇒「${set.probeOk.msg?.text}」· 路径不存在时 ok=${set.probeBad?.ok}（应 false）· 保存 xcode=「${String(set.saved?.xcode).split('/').pop()}」端口=${set.saved?.ios_port} · 子页 JS 错误 ${set.winErrors}`,
    set.openCalls === 1 &&
      set.nav0.length === 3 &&
      set.nav0.map((n) => n.label).join('/') === '开发环境/设备/关于' &&
      set.nav0.find((n) => n.on)?.id === 'env' &&
      set.devRows === 3 &&
      set.aboutText.includes('settings.json') &&
      set.probeOk.arg?.kind === 'xcode' &&
      set.probeOk.arg?.path === '/Volumes/data1/work/office-applications/Xcode.app' &&
      set.probeOk.msg?.ok === true &&
      set.probeOk.msg?.text.includes('Xcode') &&
      set.probeBad?.ok === false &&
      set.probeBad?.text.includes('不存在') &&
      set.saved?.xcode === '/Volumes/data1/work/office-applications/Xcode.app' &&
      Number(set.saved?.ios_port) === 9001 &&
      set.winErrors === 0,
  ],
  // ㊵ 设备管理：列表 + 切换（含"未授权不许点"和"失败不改状态"）
  [
    `㊵ 设备管理：列表 ${dev.count} 台（当前 ${dev.current0}）→ 点第二台 ${dev.pickedArg} 后当前 ${dev.currentAfter} · 点未授权发 IPC ${dev.deadCalls} 次（应 0）· 失败时当前 ${dev.beforeFail}→${dev.afterFail}（应不变）`,
    dev.count === 3 &&
      dev.current0 === 'd1aaaaaaaa' &&
      dev.pickedArg === 'd2bbbbbbbb' &&
      dev.currentAfter === 'd2bbbbbbbb' &&
      dev.deadCalls === 0 &&
      dev.afterFail === dev.beforeFail &&
      dev.failToast.includes('unauthorized'),
  ],
  // ㊴ 画质档位：分辨率不变、只改码率；两档循环；失败时标签不许变
  [
    `㊴ 画质档位：初始「${cap.before}」→ ${cap.steps.map((x) => `${x.arg}/「${x.label}」`).join(' → ')} · 失败时标签 ${cap.labelBeforeFail}→${cap.failLabel}（应不变）提示「${cap.failToast.slice(0, 20)}」`,
    cap.before === '画质·标准' &&
      cap.steps.length === 2 &&
      cap.steps[0].arg === 'low' &&
      cap.steps[0].label === '画质·省流' &&
      cap.steps[0].toast.includes('4 Mbps') &&
      cap.steps[1].arg === 'standard' &&
      cap.steps[1].label === '画质·标准' &&
      // 两档**分辨率不变**（用户要的就是这个）
      cap.steps[0].toast.includes('884×1920') &&
      cap.failLabel === cap.labelBeforeFail &&
      cap.failToast.includes('不支持'),
  ],
  // ㊲ 画布洞：祖先链必须全透明（GL 在 webview 下面）+ 舞台底色必须由阴影补上
  [
    `㊲ 画布洞：不透明祖先 ${hole.holeBad.length} 层${hole.holeBad.length ? '（' + hole.holeBad.join(' / ') + '）' : ''} · 舞台底色阴影 spread=${hole.fillSpread}px`,
    hole.holeOk && hole.fillSpread >= 1000,
  ],
  // ⑯ 拖拽平移：真实鼠标手势（down → 多步 move → up），平移量、原生矩形都要跟着走
  //   ★只往左拖：125% 下屏幕高 726 < 舞台 796 ⇒ 纵向被正确夹紧到 0，
  //     拿纵向做断言会红，但那是正确行为（屏幕比舞台小就不该能拖动）。
  [
    `⑯ ⌥拖拽平移：状态 ${panSeen.status} · 屏幕 x ${panBefore.x.toFixed(0)}→${panSeen.x.toFixed(0)}（原生收到 ${panSeen.ipcX.toFixed(0)}）`,
    !!panXY &&
      Math.abs(panXY.x + 100) <= 3 &&
      panXY.y === 0 &&
      Math.abs(panSeen.x - (panBefore.x - 100)) <= 3 &&
      Math.abs(panSeen.ipcX - panSeen.x) < 1.5,
  ],
  [
    `⑯b ⌥拖拽后「适应」平移归零：${panReset.status} · 屏幕 x 回到 ${panReset.x.toFixed(0)}（适应位置 ${box1.x.toFixed(0)}）`,
    !!panResetXY &&
      panResetXY.x === 0 &&
      panResetXY.y === 0 &&
      Math.abs(panReset.x - box1.x) < 1.5,
  ],
  // ㉟ 触摸回传（决策 #1254）：设备像素坐标 + 拖拽不注入 + 开关生效 + 源不支持时如实降级
  [
    `㉟ 触控回传（增量）：拖拽 +${touch.tapsAddedByPan}（应 0）· 点中心 +${touch.tapsAddedByClick} → ${JSON.stringify(touch.tapAtCenter)}（设备 ${stats.width}×${stats.height}）· 开关默认=${touch.chipOn.label || '—'} · 关掉后 +${touch.tapsAddedWhileOff}（应 0）· 源不支持 ⇒ 开关${touch.chipUnsupported.on ? '仍开' : '自动关'} 提示=「${touch.tapToast.slice(0, 46)}」· 熄屏 ⇒ 开关${touch.chipSleeping.on ? '仍开（对）' : '被误关'}`,
    touch.tapsAddedByPan === 0 &&
      touch.tapsAddedByClick === 1 &&
      Math.abs(Number(touch.tapAtCenter?.x ?? -1) - stats.width / 2) <= 3 &&
      Math.abs(Number(touch.tapAtCenter?.y ?? -1) - stats.height / 2) <= 3 &&
      touch.chipOn.on &&
      touch.tapsAddedWhileOff === 0 &&
      !touch.chipOff.on &&
      !touch.chipUnsupported.on &&
      touch.tapToast.includes('不支持触控回传') &&
      // 熄屏不像"源不支持"：**不能**自动关开关，只要如实提示
      touch.chipSleeping.on &&
      touch.sleepingToast.includes('屏幕没亮'),
  ],
  [`⑩ fixture 与原始采集输出一致${fixtureWhy ? `（${fixtureWhy}）` : ''}`, fixtureInSync],
  // ㉑ 大文件冷跳着色（见脚本里的长注释：这条钉的是 warmParse 不能掉）
  [
    `㉑ 8000 行 .ts：整篇 ${parseFull ? '已解析' : '未解析完'} · 打开着色 ${perf.openMs}ms · 冷跳 ${perf.coldMs}/${perf.cold2}ms（首次/稳态，上限 400ms）· scrollHeight ${perf.scrollHeight}`,
    parseFull &&
      perf.scrollHeight > 100000 &&
      perf.coldMs >= 0 &&
      perf.coldMs <= 400 &&
      perf.openMs <= 1500,
  ],
]
let bad = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${label}`)
  if (!ok) bad++
}
if (errors.length) console.log('  JS 错误：\n' + errors.map((e) => '   ' + e).join('\n'))
console.log(`\n面板快照：${path.relative(ROOT, outPath)}`)
console.log(`数据来源：${path.relative(ROOT, dataPath)}（真实跑机读数）· 机型来源：${deviceFrom}`)

// ── ★陈旧 .app 提醒（不是判据，不改变退出码；2026-10-25 用户实测踩到 · #1247 拆出）
warnIfAppStale(STUDIO)
process.exit(bad ? 1 : 0)
