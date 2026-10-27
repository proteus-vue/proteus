// scripts/studio-panel-probes-ios.mjs —— ㊻ iOS 接法引导卡（决策 #1277）
//
// 【这条判据要防的真问题】iOS 投屏的最后一公里**只能用户自己走**（装真机要钥匙串签名），
//   所以界面必须把「本机 IP + 端口 + 该跑的命令」摆出来。这段要是没接上，
//   用户点 iPhone 行就只看到黑屏——而纯代码审查看不出"卡是不是真的渲染了"。
//
// 【为什么必须走真实交互，不能只断言 DOM 存在】
//   `#iosGuide` 在不在，取决于**三个条件的合取**：没画面 · 采集源是 iOS · 提示拿到了。
//   只写"元素存在"的判据会在这三个条件都还没成立时就绿（假绿），
//   所以这里逐态验证：先证明**不该显示时不显示**（Android 有画面），再证明**该显示时显示**，
//   最后点真的复制按钮、验证 `copy_text` 收到的是**整条命令**。
//
// 【两态怎么造】桩支持 `__NO_FRAMES__`（把 frames 归零）与 `__IOS_ACTIVE__`（采集源是不是 iOS），
//   都在 localStorage 里 ⇒ 不用 reload 页面，下一拍 stats 轮询就生效（500ms）。
/* ★等多久：界面每 **2s** 拉一次 `ios_stream_hint`（App.vue 的 iosTimer），
   只等 700ms 会有一半概率拿到**上一态**的提示 ⇒ 时绿时红。
   2s + 400ms 余量是"一定跨过一个轮询周期"的最小值。 */
const HINT_REFRESH_MS = 2400

export async function probeIosGuide(page) {
  /* ★先切回**设备视图**：引导卡长在舞台里（`<template v-if="view === 'device'">`），
     而前面的采集段（⑫b reload 成 code 视图 + probeCodeExtras）会把页面留在代码视图。
     不切的话卡片和 `.empty` 都不在 DOM 里 ⇒ 判据会以为"功能没做"，是**假红**。
     （第一次跑就踩到了：空状态让位=true 其实是"整块模板没渲染"。） */
  await page.click('.rail button:nth-child(1)')
  await page.waitForTimeout(500)

  const setFlags = (flags) =>
    page.evaluate((f) => {
      for (const [k, v] of Object.entries(f)) {
        if (v === null) window.localStorage.removeItem(k)
        else window.localStorage.setItem(k, v)
      }
    }, flags)

  /* ① 有画面 + 源是 iOS ⇒ **不显示**：卡片的意义是"还没连上"，连上了还占着画面就是噪音 */
  await setFlags({ __NO_FRAMES__: null, __IOS_ACTIVE__: '1' })
  await page.waitForTimeout(HINT_REFRESH_MS)
  const withFrames = await page.evaluate(() => !!document.getElementById('iosGuide'))

  /* ② 没画面 + 源是 iOS ⇒ 显示，并且命令/状态文案要具体（不是"请配置一下"） */
  await setFlags({ __NO_FRAMES__: '1', __IOS_ACTIVE__: '1' })
  await page.waitForTimeout(HINT_REFRESH_MS)
  const shown = await page.evaluate(() => {
    const el = document.getElementById('iosGuide')
    return {
      has: !!el,
      cmd: document.getElementById('iosCmd')?.textContent?.trim() ?? '',
      state: document.getElementById('iosState')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      stateOk: !!document.getElementById('iosState')?.classList.contains('ok'),
      emptyHidden: !document.querySelector('.empty'),
      copyLabel: document.getElementById('iosCopy')?.textContent?.trim() ?? '',
    }
  })

  /* ③ 点真的「复制」按钮：剪贴板走的是 `copy_text` 命令（WKWebView 里 navigator.clipboard 不可靠） */
  const before = await page.evaluate(() => window.__STUB_CALLS__.filter((c) => c.cmd === 'copy_text').length)
  await page.evaluate(() => document.getElementById('iosCopy')?.click())
  await page.waitForTimeout(120)
  const copied = await page.evaluate(() => {
    const all = window.__STUB_CALLS__.filter((c) => c.cmd === 'copy_text')
    return { count: all.length, text: String(all[all.length - 1]?.args?.text ?? '') }
  })

  /* ④ 没画面 + 源**不是** iOS ⇒ 也不显示（Android 断流时弹"请在 iPhone 上跑宿主"是纯误导） */
  await setFlags({ __IOS_ACTIVE__: null })
  await page.waitForTimeout(HINT_REFRESH_MS)
  const androidEmpty = await page.evaluate(() => ({
    guide: !!document.getElementById('iosGuide'),
    empty: !!document.querySelector('.empty'),
  }))

  /* ⑤ 源是 iOS 但端口没人听 ⇒ 状态必须是**红**的（"没人监听"是排障第一句话） */
  await setFlags({ __IOS_ACTIVE__: '1', __IOS_LISTEN__: '0' })
  await page.waitForTimeout(HINT_REFRESH_MS)
  const noListen = await page.evaluate(() => {
    const s = document.getElementById('iosState')
    return { text: s?.textContent?.replace(/\s+/g, ' ').trim() ?? '', ok: !!s?.classList.contains('ok') }
  })

  // 收尾：把桩恢复成"有画面"，别把后续判据的现场搞乱
  await setFlags({ __NO_FRAMES__: null, __IOS_ACTIVE__: null, __IOS_LISTEN__: null })
  await page.waitForTimeout(600)

  return {
    withFrames,
    shown,
    copyAdded: copied.count - before,
    copyText: copied.text,
    androidEmpty,
    noListen,
  }
}
