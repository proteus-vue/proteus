// scripts/studio-panel-checks-ui.mjs —— ★画布上的两块"引导/输入类"判据（㊻ / ㊼）
//
// 【为什么单独成文件】`check-studio-panel.mjs` 到 1000 行硬线（2026-10-27 加 ㊼ 后又到 1013）。
//   这两条的共同点：**只吃两个采集结果对象**（ios / term），不碰页面，天然是一个单元。
//
// 【纪律】断言字符串与阈值**一字未改**，只换存放位置；条目编号不变，变松立刻在输出里看得出来。

/**
 * ㊽ 一键投屏（决策 #1288）：按钮 → 顺序 → 进度 → 失败翻译 → 卸载动作
 * @param {{ stream: any }} p
 * @returns {[string, boolean][]}
 */
export function checksIosStream({ stream }) {
  return [
    [
      `㊽ 一键投屏：按钮「${stream.btn.text}」可用=${stream.btn.found && !stream.btn.disabled} · ` +
        `先挂监听再启动=${stream.started.selBeforeStart} · ios_start_host(${stream.started.udid} · ${stream.started.ip}:${stream.started.port}) · 慢路径 ios_stream_start=${stream.slow.count > 0}(${stream.slow.udid}) · ` +
        `阶段「${stream.prog.stage}」· 日志含 bundle=${stream.prog.log.includes('bundle id')} · ` +
        `失败卡=${stream.fail.shown} 提示「${(stream.fail.hint || '').slice(0, 24)}…」卸载按钮=${stream.fail.uninstallBtn} 重试按钮=${stream.fail.retryBtn} · ` +
        `点卸载 ⇒ ios_uninstall +${stream.un.count - stream.uninstallBefore}（${stream.un.udid}）`,
      stream.btn.found &&
        !stream.btn.disabled &&
        stream.btn.text.includes('投屏') &&
        stream.started.selBeforeStart &&
        stream.started.started &&
        stream.started.udid === 'IOS-00008101' &&
        stream.started.ip === '192.168.1.24' &&
        stream.started.port === 9001 &&
        stream.prog.stage.includes('编译 Swift 宿主') &&
        stream.prog.log.includes('bundle id：cn.shxuxi.proteus.experiments') &&
        stream.fail.shown &&
        stream.fail.hint.includes('另一个开发团队') &&
        stream.fail.uninstallBtn &&
        stream.fail.retryBtn === false && // action=uninstall 时不该同时给"重新构建"
        stream.fail.goEnabled &&
        stream.slow.count > 0 &&
        stream.slow.udid === 'IOS-00008101' &&
        /* ⑥ iOS 源时点击必须走控制通道（归一化坐标），且不能同时走安卓腿 */
        stream.tap.afterTap.ios === stream.tap.beforeTap.ios + 1 &&
        stream.tap.afterTap.dev === stream.tap.beforeTap.dev &&
        typeof stream.tap.afterTap.nx === 'number' &&
        stream.tap.afterTap.nx > 0 && stream.tap.afterTap.nx < 1 &&
        stream.tap.afterTap.ny > 0 && stream.tap.afterTap.ny < 1 &&
        stream.un.count === stream.uninstallBefore + 1 &&
        stream.un.udid === 'IOS-00008101',
    ],
  ]
}

/**
 * @param {{ ios: any, term: any }} p
 * @returns {[string, boolean][]}
 */
export function checksUiGuides({ ios, term: termProbe }) {
  return [
  // ㊻ iOS 接法引导卡（决策 #1277）：只在「没画面 + 采集源是 iOS」出现；
  //   命令要含 IP:端口、复制要真发 copy_text、端口没人听时状态必须是红的
  [
    `㊻ iOS 引导：有画面时显示=${ios.withFrames}（应 false）· 无画面+iOS ⇒ ${ios.shown.has}（空状态让位=${ios.shown.emptyHidden}）命令「${ios.shown.cmd}」· 状态「${ios.shown.state}」ok=${ios.shown.stateOk} · 复制按钮「${ios.shown.copyLabel}」⇒ copy_text +${ios.copyAdded}（收到「${ios.copyText}」）· 无画面+非 iOS ⇒ 卡片=${ios.androidEmpty.guide}（应 false）空状态回来=${ios.androidEmpty.empty} · 端口没人听 ⇒ ok=${ios.noListen.ok}（应 false）「${ios.noListen.text}」`,
    ios.withFrames === false &&
      ios.shown.has === true &&
      ios.shown.emptyHidden === true &&
      ios.shown.cmd === 'bash hosts/ios/run-selfdraw.sh --stream=192.168.1.24:9001' &&
      ios.shown.state.includes('192.168.1.24') &&
      ios.shown.state.includes('9001') &&
      ios.shown.stateOk === true &&
      ios.copyAdded === 1 &&
      ios.copyText === ios.shown.cmd &&
      ios.androidEmpty.guide === false &&
      ios.androidEmpty.empty === true &&
      ios.noListen.ok === false &&
      ios.noListen.text.includes('没人监听'),
  ],
  // ㊼ 内置终端（决策 #1279）：命令名三方对齐 + 真点真敲 + ANSI 上色 + resize
  //   ★颜色断言用 `rgb(...)` 而不是源码里的 `#e5534b`：`el.style.color` 读回来是浏览器**规范化后**的值
  [
    `㊼ 终端：命令名对齐 ${termProbe.parity.ok}（${termProbe.parity.cmds.join('/')}）· 点 rail ⇒ term_open ${termProbe.opened.cols}×${termProbe.opened.rows}（状态栏「${termProbe.opened.stat}」）· 上色 ERROR=${termProbe.painted.errColor} OK=${termProbe.painted.okColor} 默认色='${termProbe.painted.plainColor}' · 屏幕「${termProbe.painted.text.replace(/\s+/g, ' ').trim().slice(0, 40)}」· 次数 ${JSON.stringify(termProbe.painted.counts ?? {})}（每个词应为 1，>1 = 输出被应用多次）· 光标 ${termProbe.painted.cursorLeft},${termProbe.painted.cursorTop} · 按键 ${JSON.stringify(termProbe.sent)} · resize ${termProbe.resizeBefore}→${termProbe.resized.count} 次（${termProbe.resized.cols} 列）· 真实 zsh 字节回放：提示符${termProbe.replay.hasPrompt ? '在' : '没了'}／分支名${termProbe.replay.hasBranch ? '在' : '没了'}／${termProbe.replay.rows} 行有内容`,
    termProbe.parity.ok &&
      termProbe.parity.cmds.length === 5 &&
      /* ★**每个词恰好出现一次**（决策 #1378）：包含 ≠ 数量对。
         #1376 的"每块输出被应用两次"就是靠这一条才能被抓住 —— 之前只断言"包含"，门禁全绿。 */
      Object.values(termProbe.painted.counts ?? {}).every((n) => n === 1) &&
      termProbe.opened.called &&
      termProbe.opened.cols > 40 &&
      termProbe.opened.rows > 10 &&
      termProbe.opened.visible &&
      termProbe.opened.inputFound &&
      /^\d+×\d+ · 运行中$/.test(termProbe.opened.stat) &&
      termProbe.painted.errColor === 'rgb(229, 83, 75)' &&
      termProbe.painted.okColor === 'rgb(57, 192, 122)' &&
      termProbe.painted.plainColor === '' &&
      termProbe.painted.text.includes('ERROR plain 中文正常') &&
      termProbe.painted.text.includes('OK') &&
      termProbe.painted.cursorTop > 0 &&
      termProbe.painted.rowCount >= 10 &&
      termProbe.sent.join('|') === '\r|\u0003|\u001b[A|\u007f|\t|a' &&
      termProbe.resized.count > termProbe.resizeBefore &&
      termProbe.resized.cols < termProbe.opened.cols &&
      /* ★真实 zsh 字节回放：提示符必须还在（决策 #1285 的回归判据） */
      termProbe.replay.hasPrompt &&
      termProbe.replay.hasBranch &&
      termProbe.replay.rows >= 4,
  ],
  ]
}
