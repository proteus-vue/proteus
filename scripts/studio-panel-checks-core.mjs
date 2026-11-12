// studio-panel-checks-core.mjs —— 面板门禁的**内联断言块**（决策 #1490 从主脚本搬出）
//
// 【为什么搬】`check-studio-panel.mjs` 里"探测"和"断言"混在一条直线脚本里，996 行中
//   **近 460 行是纯断言**。断言不碰浏览器、不碰时序、只吃探测结果 ⇒ 它是最该先独立的一块。
//   搬完主脚本只负责"把浏览器戳成某个状态"，这里负责"这个状态算不算对"。
//
// 【★断言一个字都没改】做法是**解构传值**：`ctx` 里放探测结果，模块头顶解构出来，
//   下面的数组元素保持**原文**。让断言去适配新参数，是这类重构里最容易引入
//   "看着一样、其实判据变了"的地方。
//
// 【★怎么保证没丢判据】`reportChecks` 的编号基线自检（#1489）会比对全部编号；
//   搬丢一条，门禁会当场点名 —— 这也是先补自检、再动结构的原因。

/** @param {object} ctx 主脚本的探测结果 @returns {Array<[string, boolean]>} 判据数组 */
export function coreChecks(ctx) {
  const {
    afterMenuUndo,
    beforeMenuUndo,
    beforeUndo,
    box1,
    box2,
    box3,
    cap,
    capability,
    closed,
    codeView,
    collapsed,
    cssColors,
    dev,
    dirtyByTab,
    dirtyShown,
    distinctOf,
    failedSave,
    g,
    hole,
    ios,
    iosStream,
    objcColors,
    panResetXY,
    panXY,
    parseFull,
    perf,
    pickSeen,
    pickXY,
    r,
    ratioErr,
    restored,
    roundTrip,
    rustColors,
    saved,
    savedState,
    seen,
    set,
    stats,
    switchedPath,
    tabLayout,
    tabState,
    tapSpace,
    termProbe,
    tokensCss,
    tokensObjc,
    tokensRust,
    tokensTs,
    tokensVue,
    touch,
    tsColors,
    undoKept,
    vueColors,
    zoomLabel,
    zoomState,
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
    iconOk,
    checksConfig,
    checksUiGuides,
    checksIosStream,
  } = ctx

  return [  ['① 面板调到了 stats（IPC 接线通）', seen.calls.includes('stats')],
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
        codeView.fileCount === 6 &&
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
  // ㊹㊸㊷㊶㊺㊵㊴ 五组判据在 studio-panel-checks-config.mjs（决策 #1277 拆出，断言一字未改）
  ...checksConfig({ capability, set, dev, cap }),
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
  // ㊻㊼ 两块"引导/输入类"判据在 studio-panel-checks-ui.mjs（决策 #1279 拆出，断言一字未改）
  ...checksUiGuides({ ios, term: termProbe }),
  ...checksIosStream({ stream: iosStream }),
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
}
