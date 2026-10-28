// scripts/studio-panel-probes-ios-stream.mjs —— ㊽ 一键投屏（决策 #1288）
//
// 【这条判据要防什么】"一键投屏"最容易的假绿是：按钮画出来了、点了也发了 IPC，
//   但**顺序错了**（先启动流水线后挂监听 ⇒ 手机连空气）、或者**失败时不给动作**（用户只能发呆）。
//   ⇒ 分四段验：
//     ① 按钮存在且可点
//     ② 点下去**先** select_device（起 nc 监听）**再** ios_stream_start（顺序可断）
//     ③ 进度：阶段标题与日志行都要能显示（否则用户看到的是"卡住"）
//     ④ 失败：后端翻译的 hint 要显示，且 action=uninstall 时必须出现"卸载并重装"按钮，
//        点它要真的发 ios_uninstall（团队冲突的唯一解法）
//
// 【它不证明什么】不证明真机能装 —— 那要钥匙串签名，属人工/真机环节（见 Rust 单测与实跑记录）。
export async function probeIosStream(page) {
  // ① 按钮
  const btn = await page.evaluate(() => {
    /* ★页面里跑的是**纯 JS**（Playwright 传函数源码），不能带 TS 断言 `as X` —— 会直接语法错。
       这点和 Node 侧代码不一样，踩过一次。 */
    const b = document.getElementById('iosStreamGo')
    return b ? { found: true, text: (b.textContent ?? '').trim(), disabled: !!b.disabled } : { found: false, text: '', disabled: true }
  })

  // ② 点它 ⇒ 顺序：select_device → ios_stream_start
  await page.click('#iosStreamGo')
  await page.waitForTimeout(400)
  const started = await page.evaluate(() => {
    const all = window.__STUB_CALLS__ || []
    /* ★主按钮走**快路径** `ios_start_host`（决策 #1297：秒级启动已装宿主，不重新构建） */
    const iSel = all.findIndex((c) => c.cmd === 'select_device' && String(c.args?.serial || '').startsWith('IOS-'))
    const iStart = all.findIndex((c) => c.cmd === 'ios_start_host')
    const st = all.filter((c) => c.cmd === 'ios_start_host').slice(-1)[0]
    return {
      selBeforeStart: iSel >= 0 && iStart > iSel,
      started: !!st,
      udid: st?.args?.udid ?? null,
      ip: st?.args?.ip ?? null,
      port: st?.args?.port ?? null,
    }
  })

  // ③ 进度：阶段 + 日志
  await page.evaluate(() => {
    const fire = (p) => window.dispatchEvent(new CustomEvent('studio:ios-progress', { detail: p }))
    fire({ stage: '④ 编译 Swift 宿主（自绘场景）', line: '==> ④ 编译 Swift 宿主（自绘场景）' })
    fire({ stage: null, line: '[pin] 按本机签名档选中 bundle id：cn.shxuxi.proteus.experiments（档位：office）' })
  })
  await page.waitForTimeout(250)
  const prog = await page.evaluate(() => ({
    stage: document.getElementById('iosStage')?.textContent?.trim() ?? '',
    log: document.getElementById('iosLog')?.textContent ?? '',
  }))

  // ④ 失败翻译 + 动作按钮
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('studio:ios-result', {
        detail: {
          ok: false,
          code: 1,
          hint: '这台设备上已经装过**另一个开发团队**签名的同名应用，iOS 不允许跨团队升级。',
          action: 'uninstall',
        },
      }),
    ),
  )
  await page.waitForTimeout(250)
  const fail = await page.evaluate(() => ({
    shown: !!document.getElementById('iosFail'),
    hint: document.getElementById('iosHint')?.textContent?.trim() ?? '',
    uninstallBtn: !!document.getElementById('iosUninstall'),
    retryBtn: !!document.getElementById('iosRetry'),
    goEnabled: !document.getElementById('iosStreamGo')?.disabled,
  }))

  // ⑤ 点「卸载旧应用并重装」⇒ 必须发 ios_uninstall（带 iOS 串号）
  const before = await page.evaluate(() => (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'ios_uninstall').length)
  await page.evaluate(() => document.getElementById('iosUninstall')?.click())
  await page.waitForTimeout(500)
  const un = await page.evaluate(() => {
    const all = (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'ios_uninstall')
    const last = all.slice(-1)[0]
    return { count: all.length, udid: last?.args?.udid ?? null }
  })

  /* ★慢路径**必须放在最后**：`rebuild()` 里会 `reset()`（清 outcome）⇒ 失败卡与
     「卸载旧应用并重装」按钮会消失。先测卸载、再测重建，否则后者会把前者的目标抹掉。
     （第一版就是这个顺序，判据如实报了 `ios_uninstall +0（null）`。） */
  /* 上一轮（卸载→重装）会把 `running` 置 true，而「重新构建」按钮带 `v-if="!running"`
     ⇒ 必须先收到一次结果事件把它复位，否则按钮根本不在 DOM 里（第一版就是这样点了空）。
     这也顺带验证了「结果事件会解禁按钮」。 */
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('studio:ios-result', {
      detail: { ok: true, code: 0, hint: null, action: null },
    })),
  )
  await page.waitForTimeout(250)
  await page.evaluate(() => document.getElementById('iosRebuild')?.click())
  await page.waitForTimeout(400)
  const slow = await page.evaluate(() => {
    const all = (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'ios_stream_start')
    return { count: all.length, udid: all.slice(-1)[0]?.args?.udid ?? null }
  })

  /* ⑥ ★触控分派（决策 #1298）：把采集源切成 ios，再点一下画布
     —— 必须发 `ios_tap`（归一化坐标），**不能**发 `device_tap`（那是安卓腿，iOS 模式下发给空气）。
     这一步直接锁住"用户点了没反应"那个 bug（当时 `iosSource` 读的是过期快照，恒 false）。 */
  await page.evaluate(() => window.localStorage.setItem('__SOURCE__', 'ios'))
  await page.waitForTimeout(600) // 等一拍 stats
  const beforeTap = await page.evaluate(() => ({
    ios: (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'ios_tap').length,
    dev: (window.__STUB_CALLS__ || []).filter((c) => c.cmd === 'device_tap').length,
  }))
  const box = await page.locator('#canvas').boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.25)
    await page.mouse.down()
    await page.mouse.up()
  }
  await page.waitForTimeout(300)
  const afterTap = await page.evaluate(() => {
    const all = window.__STUB_CALLS__ || []
    const t = all.filter((c) => c.cmd === 'ios_tap').slice(-1)[0]
    return {
      ios: all.filter((c) => c.cmd === 'ios_tap').length,
      dev: all.filter((c) => c.cmd === 'device_tap').length,
      nx: t?.args?.nx ?? null,
      ny: t?.args?.ny ?? null,
    }
  })
  await page.evaluate(() => window.localStorage.removeItem('__SOURCE__'))

  return { btn, started, prog, fail, slow, uninstallBefore: before, un, tap: { beforeTap, afterTap } }
}
