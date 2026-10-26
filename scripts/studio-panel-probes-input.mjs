// scripts/studio-panel-probes-input.mjs —— 输入类探针（决策 #1263 从 probes 拆出）
//
// 【为什么单独一个文件】触摸回传 / 手势 / 坐标空间 / 采集档位，都是"人对画布做了什么、
//   注入到设备是什么"。它们与"面板渲染/代码视图/搜索"这些探针没有共享状态，
//   却在同一个文件里把行数顶到 1000 上限（门禁硬红线）⇒ 按职责拆，不抬基线。

export async function probeTouch(page) {
// 【这条判据钉什么】① 坐标是**设备像素**（不是 CSS px）② 拖拽平移**不**注入
//   ③ 关掉开关不注入 ④ 源不支持时**提示一次并自动关开关**（不是每次都弹、也不是静默）。
const tapArgs = async () =>
  (await page.evaluate(() =>
    (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'device_tap').map((c) => c.args),
  ))
// ★一律用**增量**断言：⑬ 早就做过一次真实点击（那次就该注入一次），
//   拿"累计条数 == 0/1"当期望值会红，而红的不是功能（第一版就是这么错的）。
const tapsStart = await tapArgs()
const touchState = () =>
  page.evaluate(() => ({
    on: document.getElementById('touchChip')?.getAttribute('aria-pressed') === 'true',
    label: document.getElementById('touchChip')?.textContent?.trim() ?? '',
  }))
// ★**本探针自己拖一次**，不能用上面 ⑯ 那次：⑯ 发生在 `tapsStart` 之前，
//   它的注入早已落在窗口外 ⇒ "拖拽 +0" 会变成空断言（实测：把 moved 阈值删掉，判据照样绿）。
const centerAt = () =>
  page.evaluate(() => {
    const r = document.getElementById('canvas').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
let center = await centerAt()
await page.mouse.move(center.x, center.y)
await page.mouse.down()
await page.mouse.move(center.x - 40, center.y - 16, { steps: 3 })
await page.mouse.move(center.x - 80, center.y - 30, { steps: 3 })
await page.mouse.up()
await page.waitForTimeout(320)
const tapsAfterPan = await tapArgs()
const tapsAddedByPan = tapsAfterPan.length - tapsStart.length
// 拖拽把画面拖偏了 ⇒ 回「适应」再取中心（否则后面"点中心"就不再是设备中心）
await page.click('.zoom button[aria-label="适应窗口"]')
await page.waitForTimeout(380)
center = await centerAt()
await page.mouse.click(center.x, center.y)
await page.waitForTimeout(320)
const tapsAfterClick = await tapArgs()
const chipOn = await touchState()
// 关掉开关 ⇒ 再点一次也不注入
await page.click('#touchChip')
await page.waitForTimeout(160)
await page.mouse.click(center.x + 24, center.y + 12)
await page.waitForTimeout(320)
const tapsAfterOff = await tapArgs()
const chipOff = await touchState()
// 源不支持（iPhone 推流 / 录制流就是这样）⇒ 提示一次 + 自动关开关
await page.evaluate(() => localStorage.setItem('__TAP_UNSUPPORTED__', '1'))
await page.click('#touchChip')
await page.waitForTimeout(120)
await page.mouse.click(center.x, center.y)
await page.waitForTimeout(420)
const chipUnsupported = await touchState()
const tapToast = await page.evaluate(
  () => [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent?.trim() ?? '').join(' | '),
)
await page.evaluate(() => localStorage.removeItem('__TAP_UNSUPPORTED__'))
// 熄屏（真机实测：input tap 返回 0 但不生效）⇒ 必须**说出来**，而且开关不该被关掉
//   （这不是"源不支持"，是"这次没成功"——两者混淆会让用户以为功能坏了）
await page.evaluate(() => localStorage.setItem('__TAP_SLEEPING__', '1'))
await page.click('#touchChip')
await page.waitForTimeout(120)
await page.mouse.click(center.x, center.y)
await page.waitForTimeout(420)
const chipSleeping = await touchState()
const sleepingToast = await page.evaluate(
  () => [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent?.trim() ?? '').join(' | '),
)
await page.evaluate(() => localStorage.removeItem('__TAP_SLEEPING__'))

  return {
    tapsStart: tapsStart.length,
    tapsAddedByPan,
    tapsAddedByClick: tapsAfterClick.length - tapsAfterPan.length,
    tapAtCenter: tapsAfterClick[tapsAfterClick.length - 1] ?? null,
    tapsAddedWhileOff: tapsAfterOff.length - tapsAfterClick.length,
    chipOn,
    chipOff,
    chipUnsupported,
    tapToast,
    chipSleeping,
    sleepingToast,
  }
}

/**
 * ㊱ ⌥ 手势（决策 #1255）：拖动 = 滑动、按住不动 ≥600ms = 长按。
 * 【为什么用 ⌥ 而不是"拖拽即滑动"】平移是既有手势且被判据 ⑯ 钉住；直接把拖拽改成滑动，
 *   "看别处"就会变成"在手机上乱划"。⇒ 修饰键分流：**无 ⌥ = 平移画布，有 ⌥ = 注入设备**。
 * 【钉三件事】① ⌥ 拖拽产生 swipe（端点不同、时长 > 0）且**画布没被平移**
 *   ② ⌥ 按住不动产生**同点 + 600ms**（长按）③ 普通拖拽仍然只平移（不产生 swipe）。
 */

export async function probeGesture(page) {
  const swipes = () =>
    page.evaluate(() =>
      (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'device_swipe').map((c) => c.args),
    )
  const screenX = () => page.evaluate(() => document.querySelector('.screen').getBoundingClientRect().x)
  const center = await page.evaluate(() => {
    const r = document.getElementById('canvas').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })

  // ★**先取基线**：前面的触摸探针（㉟）为了证明"拖拽不产生点击"也做过一次拖拽，
  //   而现在"拖拽 = 滑动" ⇒ 那次也会产生 swipe。用累计条数当期望值必然红（第一版就这么红的）。
  const swipeBase = (await swipes()).length

  // ① 普通拖拽（向上 200 CSS px）⇒ 注入一条 swipe，且画布**不动**
  const xBefore = await screenX()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x, center.y - 100, { steps: 3 })
  await page.mouse.move(center.x, center.y - 200, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(320)
  const afterDrag = (await swipes()).slice(swipeBase)
  const xAfterDrag = await screenX()

  // ② 普通按住不动 700ms ⇒ 长按（同点 + 600ms），不带动画布
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForTimeout(320)
  const afterHold = (await swipes()).slice(swipeBase)

  // ③ ⌥ + 拖拽 ⇒ **只平移**，不多出 swipe
  //   ★必须先放大：1× 时画面比舞台小，平移被夹在 0，往哪拖都不动 ⇒ 断言"平移了"会假红。
  await page.click('.zoom button[aria-label="放大"]')
  await page.click('.zoom button[aria-label="放大"]')
  await page.waitForTimeout(500)
  const xBeforeAlt = await screenX()
  await page.keyboard.down('Alt')
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  // ★往**左**拖：画面在「适应」档本就贴着左边（平移被夹到 0），往右拖永远动不了 ⇒ 断言会假红
  await page.mouse.move(center.x - 60, center.y, { steps: 3 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await page.waitForTimeout(300)
  const afterAltDrag = (await swipes()).slice(swipeBase)
  const xAfterAlt = await screenX()
  // ④ 拖出画布（指针捕获会让拖拽继续产生事件）⇒ 坐标必须被**夹在画布内**，
  //    绝不能算出负数（真实命令参数是 u32，负数会被 Tauri 拒绝并弹红条，决策 #1262）
  const rect = await page.evaluate(() => {
    const r = document.getElementById('canvas').getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  const beforeOut = (await swipes()).length
  await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x - 220, rect.y - 180, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const afterOut = (await swipes()).slice(swipeBase)
  const outSwipe = afterOut[afterOut.length - 1] ?? null
  const outInBounds =
    !!outSwipe &&
    [outSwipe.x1, outSwipe.y1, outSwipe.x2, outSwipe.y2].every((v) => Number.isFinite(Number(v)) && Number(v) >= 0)
  const errToast = await page.evaluate(
    () => [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent?.trim() ?? '').join(' | '),
  )

  // 复位平移，别把状态留给后面
  await page.click('.zoom button[aria-label="适应窗口"]')
  await page.waitForTimeout(300)

  return {
    swipeOut: outSwipe,
    outInBounds,
    errToast,
    swipeCountAfterOut: beforeOut,
    swipeOfDrag: afterDrag[0] ?? null,
    swipeCountAfterDrag: afterDrag.length,
    panMovedByPlainDrag: Math.abs(xAfterDrag - xBefore) > 1,
    swipeOfHold: afterHold[1] ?? null,
    swipeCountAfterHold: afterHold.length,
    swipeCountAfterAltDrag: afterAltDrag.length,
    panMovedByAltDrag: Math.abs(xAfterAlt - xBeforeAlt) > 1,
  }
}

/**
 * ⑯ 拖拽平移（放大后必须能看别处，否则 4× 只能看中间那一点）。
 *  真实 mouse 事件序列（down → 多步 move → up），走浏览器命中测试 ⇒ 验的是真手势。
 *  ★只往左拖：1280x720 在 125% 下高 726 < 舞台 796 ⇒ **纵向本来就被夹紧到 0**，
 *    用纵向断言会红，而那不是 bug（正是"屏幕比舞台小就不该能拖"的正确行为）。
 */

export async function probeTapSpace(page) {
  const taps = () =>
    page.evaluate(() =>
      (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'device_tap').map((c) => c.args),
    )
  const center = await page.evaluate(() => {
    const r = document.getElementById('canvas').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height }
  })
  // 让桩把"设备物理尺寸"报成 1200×2608（码流仍是 fixture 的 1280×720 —— 故意不一致）
  await page.evaluate(() => localStorage.setItem('__DEV_SIZE__', '1200x2608'))
  // ★等**一整轮** stats 轮询（500ms 间隔 + IPC），否则第一下点击还在用旧的 dev_w=0
  //   —— 第一版等 420ms，结果"点中心"那次读到的还是码流中心 (640,360)，判据红得莫名其妙。
  await page.waitForTimeout(800)

  const before = (await taps()).length
  await page.mouse.click(center.x, center.y)
  await page.waitForTimeout(300)
  const atCenter = (await taps()).slice(before)[0] ?? null

  // 再点画布 3/4 高度处：物理空间下应是 1956（码流空间会是 540）
  const before2 = (await taps()).length
  await page.mouse.click(center.x, center.y + center.h / 4)
  await page.waitForTimeout(300)
  const at3q = (await taps()).slice(before2)[0] ?? null

  await page.evaluate(() => localStorage.removeItem('__DEV_SIZE__'))
  await page.waitForTimeout(200)
  return { atCenter, at3q }
}

/**
 * ㊴ 画质档位（决策 #1264 / #1265）：**分辨率不变，只改码率**——省流 4 / 标准 13 Mbps。
 *
 * 【钉三件事】① 点一下 → 调 `capture_preset('low')` 且**标签跟着变**（IPC 与界面必须同步）
 *   ② 再点 → 回到标准（两档循环）③ **失败时标签不许变**——乐观更新会让界面说谎。
 * 【为什么还要断分辨率不变】用户的诉求就是"同分辨率下的清晰度"；如果哪天有人把它改成
 *   顺带切分辨率，这条会立刻红。
 */
export async function probeCapPreset(page) {
  const calls = () =>
    page.evaluate(() =>
      (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'capture_preset').map((c) => c.args),
    )
  const label = () => page.evaluate(() => document.getElementById('capLabel')?.textContent?.trim() ?? '')
  const toast = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent?.trim() ?? '').join(' | '),
    )

  const base = (await calls()).length
  const before = await label()
  const steps = []
  for (let i = 0; i < 2; i++) {
    await page.click('#capChip')
    await page.waitForTimeout(400)
    steps.push({
      arg: (await calls())[base + i]?.preset ?? null,
      label: await label(),
      toast: await toast(),
    })
  }

  // 失败路径：桩抛错（源不支持）⇒ 标签**必须**原地不动
  await page.evaluate(() => localStorage.setItem('__CAP_FAIL__', '1'))
  const labelBeforeFail = await label()
  await page.click('#capChip')
  await page.waitForTimeout(400)
  const failLabel = await label()
  const failToast = await toast()
  await page.evaluate(() => localStorage.removeItem('__CAP_FAIL__'))

  return { before, steps, labelBeforeFail, failLabel, failToast }
}

/**
 * ㊵ 设备管理（决策 #1265）：列表 + 切换。
 *
 * 【为什么这条重要】切设备牵动三处全局状态（串号 / 物理尺寸 / 是否可注入）并**重启采集会话**。
 *   桩里放两台可投屏 + 一台未授权，钉四件事：
 *   ① 列表渲染出三台，当前项只有一台（`aria-pressed=true`）
 *   ② 点第二台 → 调 `select_device(serial2)`，完成后**当前项换过去**
 *   ③ 点"未授权"那台 → **不发** IPC（不能对不能投屏的设备发命令）
 *   ④ 切换失败 → 当前项**不变**（乐观更新会让界面说谎）
 */
export async function probeDeviceSwitch(page) {
  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll('#devList .devrow')].map((n) => ({
      serial: n.getAttribute('data-dev'),
      current: n.getAttribute('aria-pressed') === 'true',
      dead: n.classList.contains('dead'),
    })),
  )
  const calls = () =>
    page.evaluate(() =>
      (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'select_device').map((c) => c.args?.serial),
    )

  await page.waitForTimeout(400) // 面板 onMounted 拉列表
  const list0 = await rows()
  const currentOf = (l) => l.find((r) => r.current)?.serial ?? null

  // ② 切到第二台
  const base = (await calls()).length
  await page.click('#devList .devrow[data-dev="d2bbbbbbbb"]')
  await page.waitForTimeout(500)
  const afterPick = { arg: (await calls())[base] ?? null, list: await rows() }

  // ③ 点未授权那台：不该发 IPC
  const base2 = (await calls()).length
  await page.click('#devList .devrow[data-dev="d3cccccccc"]')
  await page.waitForTimeout(350)
  const deadCalls = (await calls()).length - base2

  // ④ 失败路径：当前项必须留在原地
  await page.evaluate(() => localStorage.setItem('__DEV_FAIL__', '1'))
  const beforeFail = currentOf(await rows())
  await page.click('#devList .devrow[data-dev="d1aaaaaaaa"]')
  await page.waitForTimeout(450)
  const afterFail = currentOf(await rows())
  const failToast = await page.evaluate(() =>
    [...document.querySelectorAll('#toasts .toast')].map((n) => n.textContent?.trim() ?? '').join(' | '),
  )
  await page.evaluate(() => {
    localStorage.removeItem('__DEV_FAIL__')
    window.__STUB_DEV_CUR__ = 'd1aaaaaaaa' // 复位，别把状态留给后面的判据
  })

  return {
    count: list0.length,
    current0: currentOf(list0),
    pickedArg: afterPick.arg,
    currentAfter: currentOf(afterPick.list),
    deadCalls,
    beforeFail,
    afterFail,
    failToast,
  }
}

/**
 * ㊶ 设置窗口（决策 #1266 / #1267）：**独立窗口** + 左侧分类 + 路径由人填。
 *
 * 【为什么两段】设置已经不是右栏面板，而是 `?view=settings` 的独立窗口：
 *   ① 主窗口：点 rail 里的设置按钮 ⇒ 必须调 `open_settings`（入口通不通）
 *   ② 子页面（同一份 dist）：分类导航能切、表单能改、检测真的跑、保存原样提交
 * 【钉住的作弊点】初始值来自**设置**（不是前端硬编码默认路径）；检测把**用户填的串**原样送出；
 *   路径不存在时**不许显示成功**；保存把填的值原样交出去。
 */
export async function probeSettings(page, baseUrl) {
  // ① 主窗口入口
  const mainCalls = () =>
    page.evaluate(() => (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'open_settings').length)
  const beforeOpen = await mainCalls()
  await page.evaluate(() => document.getElementById('openSettings').click())
  await page.waitForTimeout(250)
  const openCalls = (await mainCalls()) - beforeOpen

  // ② 独立窗口（新页面 = 新 WebviewWindow 的替身）
  const win = await page.context().newPage()
  const errs = []
  win.on('pageerror', (e) => errs.push(String(e)))
  await win.goto(`${baseUrl}?view=settings`)
  await win.waitForTimeout(600)

  const nav = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('#setNav .setnav-item')].map((n) => ({
        id: n.getAttribute('data-cat'),
        label: n.textContent?.trim() ?? '',
        on: n.getAttribute('aria-pressed') === 'true',
      })),
    )
  const nav0 = await nav()

  // 切到「设备」：只读表格里应有桩给的那几台
  await win.evaluate(() => document.querySelector('#setNav [data-cat="device"]').click())
  await win.waitForTimeout(250)
  const devRows = await win.evaluate(() => document.querySelectorAll('.settable .settr[data-dev]').length)
  // 切到「关于」：应当出现设置文件位置这条**常量事实**
  await win.evaluate(() => document.querySelector('#setNav [data-cat="about"]').click())
  await win.waitForTimeout(200)
  const aboutText = await win.evaluate(() => document.querySelector('.setkv')?.textContent ?? '')
  // 回到「开发环境」做表单断言
  await win.evaluate(() => document.querySelector('#setNav [data-cat="env"]').click())
  await win.waitForTimeout(250)

  const calls = () =>
    win.evaluate(() =>
      (window.__STUB_CALLS__ || []).filter((c) => ['probe_tool', 'save_settings'].includes(c.cmd)),
    )
  const msg = () =>
    win.evaluate(() => {
      const n = document.getElementById('xcodeMsg')
      return n ? { text: n.textContent?.trim() ?? '', ok: n.classList.contains('okmsg') } : null
    })

  const init = await win.evaluate(() => ({
    xcode: document.getElementById('setXcode')?.value ?? null,
    adb: document.getElementById('setAdb')?.value ?? null,
    port: document.getElementById('setPort')?.value ?? null,
    exists: !!document.getElementById('setXcode'),
    xCands: [...document.querySelectorAll('#xCands .setcand')].map((n) => ({
      path: n.getAttribute('data-cand'),
      ver: (n.querySelector('.cver')?.textContent ?? '').trim(),
    })),
    aCands: document.querySelectorAll('#aCands .setcand').length,
  }))

  /* ── 低门槛路径（决策 #1268）：点候选 / 浏览… / 取消不改 ────────────────── */

  // ① 点第一条候选 ⇒ 输入框被填上、版本直接可见（不需要再点"检测"）
  const probesBefore = (await calls()).length
  await win.evaluate(() => document.querySelector('#xCands .setcand').click())
  await win.waitForTimeout(250)
  const picked = {
    value: await win.evaluate(() => document.getElementById('setXcode')?.value ?? ''),
    msg: await msg(),
    extraProbes: (await calls()).length - probesBefore,
  }

  // ② 浏览… ⇒ 调 pick_tool，回来后填入并自动检测
  const pickArgs = []
  await win.evaluate(() => document.getElementById('browseXcode').click())
  await win.waitForTimeout(400)
  pickArgs.push(
    await win.evaluate(
      () => (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'pick_tool').pop()?.args ?? null,
    ),
  )
  const browsed = await win.evaluate(() => document.getElementById('setXcode')?.value ?? '')

  // ③ 取消 ⇒ **什么都不改**（最容易写错的一条：乐观地先填值）
  const beforeCancel = await win.evaluate(() => document.getElementById('setXcode')?.value ?? '')
  await win.evaluate(() => localStorage.setItem('__PICK_CANCEL__', '1'))
  await win.evaluate(() => document.getElementById('browseXcode').click())
  await win.waitForTimeout(350)
  const afterCancel = await win.evaluate(() => document.getElementById('setXcode')?.value ?? '')
  await win.evaluate(() => localStorage.removeItem('__PICK_CANCEL__'))

  const PATH = '/Volumes/data1/work/office-applications/Xcode.app'
  await win.fill('#setXcode', PATH)
  // ★DOM 级点击：独立窗口没有 toast 遮挡，但保持与另一条一致的"测数据流"手法
  await win.evaluate(() => document.getElementById('probeXcode').click())
  await win.waitForTimeout(350)
  /* ★取**最后一条** probe_tool：上面的"浏览…"也会探一次（那条是 Xcode-browse.app）。
     用 find() 会拿到更早的那次，断言就成了"在测别人的调用"。 */
  const probeOk = {
    arg: (await calls()).filter((c) => c.cmd === 'probe_tool').pop()?.args ?? null,
    msg: await msg(),
  }

  await win.evaluate(() => localStorage.setItem('__PROBE_FAIL__', '1'))
  await win.evaluate(() => document.getElementById('probeXcode').click())
  await win.waitForTimeout(350)
  const probeBad = await msg()
  await win.evaluate(() => localStorage.removeItem('__PROBE_FAIL__'))

  await win.evaluate(() => document.getElementById('setSave').click())
  await win.waitForTimeout(350)
  const saved = (await calls()).filter((c) => c.cmd === 'save_settings').pop()?.args?.s ?? null

  const winErrors = errs.length
  await win.close()

  return {
    openCalls,
    nav0,
    devRows,
    aboutText,
    init,
    picked,
    pickArgs,
    browsed,
    beforeCancel,
    afterCancel,
    probeOk,
    probeBad,
    saved,
    winErrors,
  }
}
