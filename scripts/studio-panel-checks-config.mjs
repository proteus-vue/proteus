// scripts/studio-panel-checks-config.mjs —— ★「窗口权限 / 标题栏 / 设置 / 设备 / 画质」五组判据
//
// 【为什么拆出来】`scripts/check-studio-panel.mjs` 顶到 `check:file-size` 的 1000 行硬线
//   （2026-10-26 实测 1041 行）。这五组判据的共同点是**只吃 4 个采集结果对象**（capability /
//   set / dev / cap），不碰页面本身 ⇒ 天然是一个独立单元。
//
// 【纪律：判据拆文件不等于放宽】断言字符串与阈值**一字未改**，只是换了个存放位置。
//   任何一条变松都会在 check:studio-panel 的输出里立刻看出来（条目编号不变）。
//
// 【返回什么】`[标签, 是否通过]` 二元组数组，由调用方统一打印与计数。

/**
 * @param {{ capability: any, set: any, dev: any, cap: any }} p
 * @returns {[string, boolean][]}
 */
export function checksConfig({ capability, set, dev, cap }) {
  return [
  // ㊹ 窗口权限：capability 必须覆盖所有窗口（否则插件命令被 ACL 拒绝，拖拽静默失效）
  [
    `㊹ 窗口权限：${capability.detail}`,
    capability.ok,
  ],
  // ㊸ 端口归属 + 自绘标题栏拖拽/双击（决策 #1271）
  [
    `㊸ 标题栏与端口：iOS 端有端口=${set.portOnIos}（应 true）· Web 端有端口=${set.portOnWeb}（应 false）· 按下标题栏 ⇒ ${set.dragCmd} · 双击(未移动) ⇒ ${set.dblCmd} · 双击后拖动 ⇒ 额外 ${set.dblMoved} 次（应 0）`,
    set.portOnIos === true &&
      set.portOnWeb === false &&
      set.dragCmd === 'plugin:window|start_dragging' &&
      set.dblCmd === 'plugin:window|internal_toggle_maximize' &&
      set.dblMoved === 0,
  ],
  // ㊷ 设置页：按端分组（每端只显示自己那几个工具）+ 点选路径（决策 #1270）
  [
    `㊷ 按端分组：端页签 ${set.tabs0.map((t) => t.label).join('/')}（当前 ${set.tabs0.find((t) => t.on)?.label ?? '—'}）· Web 的 node 自动填=${set.webNode.value ? '是' : '否'}（版本「${set.webNode.msg}」）· 切到 iOS 后只剩 Xcode 字段=${set.iosFields.hasXcode && !set.iosFields.leakedWebNode}、候选 ${set.iosFields.cands.length} 条 · 点首条 ⇒ 「${String(set.picked.value).split('/').pop()}」版本「${set.picked.msg?.text ?? '—'}」额外探测 ${set.picked.extraProbes} 次（应 0）· 浏览 key=${set.pickArg?.key} · 取消后不变=${set.afterCancel === set.beforeCancel} · 无保存按钮=${set.noSaveBtn} · 改端口后自动落盘=${set.saved?.ios_port}（提示「${set.saveNote}」）`,
    set.tabs0.length === 5 &&
      set.tabs0.map((t) => t.id).join('/') === 'web/android/ios/harmony/mp' &&
      set.tabs0.find((t) => t.on)?.id === 'web' &&
      set.webNode.value === '/opt/homebrew/bin/node' &&
      set.webNode.msg.includes('v22') &&
      set.iosFields.hasXcode &&
      !set.iosFields.leakedWebNode &&
      set.iosFields.cands.length === 2 &&
      set.picked.value === '/Volumes/data1/work/office-applications/Xcode.app' &&
      set.picked.msg?.ok === true &&
      String(set.picked.msg?.text ?? '').includes('Xcode') &&
      set.picked.extraProbes === 0 &&
      set.pickArg?.key === 'ios.xcode' &&
      set.afterCancel === set.beforeCancel &&
      // ★即时生效（决策 #1273）：没有保存按钮，改端口 350ms 后自动落盘
      set.noSaveBtn === true &&
      Number(set.saved?.ios_port) === 9100 &&
      String(set.saved?.paths?.['ios.xcode'] ?? '').includes('Xcode-browse.app') &&
      set.saveNote === '已保存',
  ],
  // ㊶ 设置窗口：独立窗口入口 + 分类导航 + 设备只读 + 关于
  [
    `㊶ 设置窗口：主窗口点设置 ⇒ open_settings×${set.openCalls} · 分类 ${set.nav0.map((n) => n.label).join('/')}（当前 ${set.nav0.find((n) => n.on)?.label ?? '—'}）· 设备只读 ${set.devRows} 行 · 关于含设置路径=${set.aboutText.includes('settings.json')} · 子页 JS 错误 ${set.winErrors}`,
    set.openCalls === 1 &&
      set.nav0.length === 3 &&
      set.nav0.map((n) => n.label).join('/') === '开发环境/设备/关于' &&
      set.nav0.find((n) => n.on)?.id === 'env' &&
      set.devRows === 6 &&
      set.aboutText.includes('settings.json') &&
      set.winErrors === 0,
  ],
  // ㊺ 设备列表按平台分组（decision #1274）：Android / iOS 分开；iOS 离线不可投
  [
    `㊺ 设备按平台分组：分组 ${dev.groups.join('/')} · 各平台行数 ${JSON.stringify(dev.perPlatform)} · 点 iOS 在线 ⇒ ${JSON.stringify(dev.iosPick.arg)} 后当前=${dev.iosPick.current} · 点 iOS 离线发 IPC ${dev.offlineCalls} 次（应 0）`,
    dev.groups.join('/') === 'android/ios/simulator' &&
      dev.perPlatform.android === 3 &&
      dev.perPlatform.ios === 2 &&
      dev.perPlatform.simulator === 1 &&
      dev.iosPick.arg === 'IOS-00008101' &&
      dev.iosPick.current === 'IOS-00008101' &&
      dev.offlineCalls === 0,
  ],
  // ㊵ 设备管理：列表 + 切换（含"未授权不许点"和"失败不改状态"）
  [
    `㊵ 设备管理：列表 ${dev.count} 台（当前 ${dev.current0}）→ 点第二台 ${dev.pickedArg} 后当前 ${dev.currentAfter} · 点未授权发 IPC ${dev.deadCalls} 次（应 0）· 失败时当前 ${dev.beforeFail}→${dev.afterFail}（应不变）· 切模拟器后高亮=${dev.simSel.current}（安卓残留 ${dev.simSel.androidStillOn} 行，应 0）· 切换中提示=${dev.busyState.switchingText} 其它行禁用=${dev.busyState.othersDisabled} note=「${dev.busyState.note.slice(0, 12)}」 · 失败提示含 unauthorized=${dev.failToast.includes('unauthorized')}`,
    dev.count === 6 &&
      /* ★跨平台选中态 + 切换中反馈（决策 #1315）：这两条今天才被用户发现，
         而在此之前**没有任何判据覆盖**（桩里连模拟器行都没有）。 */
      dev.simSel.current === 'SIM-0000AAAA' &&
      dev.simSel.androidStillOn === 0 &&
      dev.busyState.switchingText &&
      dev.busyState.othersDisabled &&
      dev.busyState.note.includes('正在切换') &&
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
  ]
}
