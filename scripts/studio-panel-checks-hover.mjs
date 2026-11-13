// scripts/studio-panel-checks-hover.mjs —— ㊿g 文件树悬停属性预览（决策 #1474）
//
// 【为什么单开一个文件】`check-studio-panel.mjs` 原本已 998 行、贴着 1000 行硬上限
//   （`check:file-size` 会红）。判据拆细是这批脚本的既有走向（fileops / format / termkeys
//   都是这么来的），照做即可，而不是把上限往上调。
//
// 【判据要钉的三件事，缺一条都可能假绿】
//   ① 悬停 250ms 后卡片**出现** —— 延迟本身是设计的一部分，测 0ms 等于没测；
//   ② 卡片内容跟着**被悬停的那一项**变 —— 桩里 App.vue=371 行、main.rs=997 行。
//      若桩对所有文件都返回同一个数，"卡片沿用了上一项数据"这类串数据缺陷根本抓不到；
//   ③ 移开即消失 —— 残留卡片会挡住下一行的点击，是可感知的缺陷。
import {
  probeDiagBadges,
  probeFileHover,
  probePopoverChain,
  probePopoverFit,
  probeSymbolFilter,
  probeSymbolPanel,
} from './studio-panel-probes.mjs'

export async function checksHover(page) {
  const {
    onApp,
    onMain,
    onProj,
    onOwner,
    onBig,
    onTs,
    onRs,
    onCard,
    peekWhileCard,
    gone,
    peekAfterGone,
  } = await probeFileHover(page)
  const sym = await probeSymbolPanel(page)
  const chain = await probePopoverChain(page)
  const fit = await probePopoverFit(page)
  const filt = await probeSymbolFilter(page)
  const dg = await probeDiagBadges(page)
  /** 从徽标 title（用户可见文案）里取「第 N/M 条」，取不到就原样留痕 */
  const stepOf = (s) => (String(s ?? '').match(/第 \d+\/\d+ 条/) ?? ['(无)'])[0]

  const appOk = onApp?.name === 'App.vue' && /371 行/.test(onApp?.text ?? '')
  const mainOk = onMain?.name === 'main.rs' && /997 行/.test(onMain?.text ?? '')

  /* ㊿h 项目识别（决策 #1475）：桩里 `packages/studio` 有项目标记、`packages` 没有。
     ★三条一起断：类型/名称（项目卡真的出现）、标记文件（不是只贴了个标签）、
       "所属"（非项目目录要能往上找到归属）。只断前两条的话，owner 分支坏了测不出来。 */
  const projOk =
    /Tauri 桌面应用/.test(onProj?.text ?? '') &&
    /Proteus Studio/.test(onProj?.text ?? '') &&
    /tauri\.conf\.json/.test(onProj?.text ?? '')
  const ownerOk = /所属/.test(onOwner?.text ?? '') && /proteus-vue/.test(onOwner?.text ?? '')

  /* ㊿i 角色 + 大文件行数（决策 #1476）
     ★「未统计」与「不含『— 行』」**两条都要断**：只断前者的话，把「—」留在别处也能绿；
       只断后者的话，什么都不显示也能绿。 */
  const roleOk = /角色/.test(onApp?.text ?? '') && /入口/.test(onApp?.text ?? '')
  const bigOk = /未统计/.test(onBig?.text ?? '') && !/—\s*行/.test(onBig?.text ?? '')

  /* ㊿j Git 信息（决策 #1477）：分支 / HEAD / 提交标题 / 该文件的变更状态。
     ★四条一起断：只断分支的话，"提交标题取不到"会静默降级成空行而没人发现。 */
  const gitOk =
    /main/.test(onApp?.text ?? '') &&
    /abc1234/.test(onApp?.text ?? '') &&
    /演示提交标题/.test(onApp?.text ?? '') &&
    /已修改/.test(onApp?.text ?? '')

  return [
    [
      `㊿g 悬停属性预览（决策 #1474）：App.vue→${onApp?.name || '(无卡片)'}/${
        /371 行/.test(onApp?.text ?? '') ? '371 行' : '行数未命中'
      } · main.rs→${onMain?.name || '(无卡片)'}/${
        /997 行/.test(onMain?.text ?? '') ? '997 行' : '行数未命中'
      } · 移开即消失=${gone === null}`,
      appOk && mainOk && gone === null,
    ],
    [
      `㊿h 项目识别（决策 #1475）：项目根→${
        projOk ? 'Tauri 桌面应用/Proteus Studio' : '项目卡未命中'
      } · 普通目录→${ownerOk ? '所属 proteus-vue' : '所属未命中'}`,
      projOk && ownerOk,
    ],
    [
      `㊿i 文件角色 + 大文件行数（决策 #1476）：App.vue→角色=${
        roleOk ? '入口' : '未命中'
      } · 12MB 文件→${bigOk ? '未统计（不含「— 行」）' : '仍显示含糊占位'}`,
      roleOk && bigOk,
    ],
    [
      `㊿j Git 悬停信息（决策 #1477）：分支+HEAD+提交标题+变更=${
        gitOk ? 'main/abc1234/演示提交标题/已修改' : '未命中'
      }`,
      gitOk,
    ],
    /* ㊿k 卡片可交互（决策 #1478）
       ★三条缺一不可：① 指针进卡片后 600ms（> 220ms 宽限）**还在**；
         ② 移开后 700ms **消失**（否则就是"挂住不走了"，比闪退更烦）；
         ③ 消失不是靠"本来就不消失"——两者一起才能证明宽限真的存在。 */
    [
      `㊿k 悬停卡可交互（决策 #1478）：指针进卡 600ms 后仍在=${
        onCard !== null
      } · 移开 700ms 后消失=${gone === null}`,
      onCard !== null && gone === null,
    ],
    /* ㊿l 符号/类型声明（决策 #1479）
       ★两条一起断：
         ① `.ts` 普通源码 → **不该有角色行**，但必须有「结构」行且含导出数；
         ② `.vue` → 结构行含 `script setup`。
       只断 ① 的话，vue 分支坏了没人发现；只断 ② 的话，"普通源码被硬加上角色"这种噪音回潮也测不出。 */
    [
      `㊿l 结构摘要（决策 #1479）：.ts→${
        /95 导出/.test(onTs?.text ?? '') ? '95 导出' : '未命中'
      }/无角色行=${!/角色/.test(onTs?.text ?? '')} · .vue→${
        /script setup/.test(onApp?.text ?? '') ? 'script setup' : '未命中'
      }`,
      /95 导出/.test(onTs?.text ?? '') &&
        !/角色/.test(onTs?.text ?? '') &&
        /script setup/.test(onApp?.text ?? ''),
    ],
    /* ㊿m 悬停行保持高亮（决策 #1480）
       ★两头都要断：卡片打开期间**有** `.peek`，卡片消失后**没有**。
         只断前者的话，"高亮永远不摘"也能绿——那会留下一个假的选中态。 */
    [
      `㊿m 悬停行高亮跟随（决策 #1480）：卡片打开时 peek=${
        peekWhileCard ? peekWhileCard.split('/').pop() : '(无)'
      } · 卡片消失后已清除=${peekAfterGone === null}`,
      peekWhileCard === 'packages/studio/ui/src/App.vue' && peekAfterGone === null,
    ],
    /* ㊿n 结构面板（决策 #1481）
       ★四条：面板出现 + 标题是当前文件 + 条目数对（桩给 80，见 #1483）+ Esc 能关。
         只断"出现了"的话，列错文件的清单、或永远关不掉的面板都能绿。 */
    [
      `㊿n 结构面板（决策 #1481）：${
        sym.info ? `${sym.info.name} · ${sym.info.items} 条 · 非导出 ${sym.info.dim} 条` : '未打开'
      } · Esc 关闭=${sym.gone}`,
      sym.info?.name === 'bridge.ts' &&
        sym.info.items === 80 &&
        sym.info.dim === 20 &&
        sym.gone === true,
    ],
    /* ㊿s `.rs` 结构摘要（决策 #1486 · 批次 3）
       ★两条：Rust 源文件要有 `pub` 计数（否则箭头永远不出现），且**不能冒出角色行**
         （普通源码显示"角色"就是噪音）。 */
    [
      `㊿s Rust 结构摘要（决策 #1486）：${/6 pub/.test(onRs?.text ?? '') ? '6 pub' : '未命中'}/无角色行=${!/角色/.test(onRs?.text ?? '')}｜${(onRs?.text ?? '').slice(0, 70)}`,
      /6 pub/.test(onRs?.text ?? '') && !/角色/.test(onRs?.text ?? ''),
    ],
    /* ㊿t 符号面板过滤 + 键盘导航（决策 #1491）
       ★走真实键盘。四条一起断：① 打字后条目变少且**全部含该串**；
         ② 副标题显示"匹配 M/N"；③ 能拿到当前光标行（↑↓ 真的在动）；
         ④ 回车后面板收起（说明触发了跳转）。
       只断②的话，"过滤后列表没变"也能绿；只断④的话，回车可能只是 Esc 的副作用。 */
    [
      `㊿t 符号面板过滤/键盘（决策 #1491）：面板=${filt.opened} · 过滤后 ${filt.filtered?.items ?? '?'} 条全含「sym1」=${
        filt.filtered?.allMatch
      } · 副标题「${(filt.filtered?.sub ?? '').slice(0, 28)}」· ↑↓选中=${filt.curText || '(无)'} · 回车关闭=${
        filt.closed
      }`,
      filt.opened === true &&
        (filt.filtered?.items ?? 0) > 0 &&
        (filt.filtered?.items ?? 99) < 80 &&
        filt.filtered?.allMatch === true &&
        /匹配\s+\d+\/80/.test(filt.filtered?.sub ?? '') &&
        filt.curText === 'sym12' &&
        filt.closed === true,
    ],
    /* ㊿u 树行诊断徽标（决策 #1492）
       ★两段都断：① Rust 源里确实存在 `diag:update`（事件名改掉就红，不会静默）；
         ② 前端收到事件后**按文件分组**显示错误/警告数，且没有诊断的文件不显示徽标。
       只断②的话，把路径分组写错（全挂到第一行）也能绿。 */
    [
      `㊿u 树行诊断徽标（决策 #1492）：后端推 diag:update=${dg.emits} · 监听就绪=${dg.listenerReady} · App.vue 错误 ${
        dg.shown.app?.e || '(无)'
      }/警告 ${dg.shown.app?.w || '(无)'} · bridge.ts 错误 ${dg.shown.bridge?.e || '(无)'}/警告 ${
        dg.shown.bridge?.w || '(无)'
      } · 无诊断文件=${!dg.shown.css?.e && !dg.shown.css?.w}`,
      dg.emits === true &&
        dg.listenerReady === true &&
        dg.shown.app?.e === '2' &&
        !dg.shown.app?.w &&
        dg.shown.bridge?.e === '' &&
        dg.shown.bridge?.w === '1' &&
        !dg.shown.css?.e &&
        !dg.shown.css?.w,
    ],
    /* ㊿v 目录行聚合诊断（决策 #1493）
       ★三条：① 有问题的目录显示**子文件之和**（ui/src = 2 错 1 警）；
         ② 没有问题的目录（native）不显示徽标；③ **顶层目录也要聚合**（packages）。
       只断①不够：把聚合只做一层（不向上传递）时，①照样绿、③会红。 */
    [
      `㊿v 目录聚合诊断（决策 #1493）：ui/src 错 ${dg.shown.dirs?.uiSrc?.e || '(无)'}/警 ${
        dg.shown.dirs?.uiSrc?.w || '(无)'
      } · native ${dg.shown.dirs?.native?.e || dg.shown.dirs?.native?.w ? '有徽标(错)' : '无徽标'} · packages 错 ${
        dg.shown.dirs?.pkg?.e || '(无)'
      }/警 ${dg.shown.dirs?.pkg?.w || '(无)'}`,
      dg.shown.dirs?.uiSrc?.e === '2' &&
        dg.shown.dirs?.uiSrc?.w === '1' &&
        !dg.shown.dirs?.native?.e &&
        !dg.shown.dirs?.native?.w &&
        dg.shown.dirs?.pkg?.e === '2' &&
        dg.shown.dirs?.pkg?.w === '1',
    ],
    /* ㊿w 点徽标跳到首条诊断（决策 #1494）
       ★三条：① 点之前不在该文件（否则证明不了"跳"）；② 点之后当前文件是它；
         ③ 点**目录**徽标只跳转、**不折叠**（`@click.stop` 那一下）。
       只断②的话，"点徽标顺手把文件打开了"也能绿 —— 那其实是另一件事。 */
    [
      `㊿w 点徽标跳诊断（决策 #1494）：跳前=${(dg.jump?.before ?? '').split('/').pop() || '(空)'} → 跳后=${
        (dg.jump?.after ?? '').split('/').pop() || '(空)'
      } · 点目录徽标不折叠=${dg.jump?.expBefore === dg.jump?.expAfter}`,
      (dg.jump?.before ?? '').endsWith('ui/src/App.vue') === false &&
        (dg.jump?.after ?? '').endsWith('ui/src/App.vue') === true &&
        dg.jump?.expBefore === dg.jump?.expAfter,
    ],
    /* ㊿x 徽标结构合法 + 键盘可达（决策 #1495）
       ★四条：① `button` 内**没有**嵌套可交互元素；② 徽标本身是 `<button>`；
         ③ 有 `aria-label`；④ **键盘**（聚焦 + Enter）也能跳到那个文件。
       只断①②③ 的话，"标签换了但 Tab 顺序/焦点不可用"照样绿；④ 才是 a11y 的实质。 */
    [
      `㊿x 徽标结构/键盘（决策 #1495）：button 内嵌交互=${dg.a11y?.nested} 个 · 徽标是 button=${
        dg.a11y?.isButton
      } · aria-label「${(dg.a11y?.label ?? '').slice(0, 16)}」· 键盘 Enter 跳到=${
        (dg.a11y?.kbd ?? '').split('/').pop() || '(无)'
      }`,
      dg.a11y?.nested === 0 &&
        dg.a11y?.isButton === true &&
        /跳到/.test(dg.a11y?.label ?? '') &&
        (dg.a11y?.kbd ?? '').endsWith('ui/src/App.vue'),
    ],
    /* ㊿y 徽标循环跳 + 刷新归零（决策 #1498）
       ★五步序列一起断：① 新作用域从 1/2 起；② 连点 2/2 → 1/2 → 2/2（确实在两条间循环，
       不是固定第一条）；③ 停在 2/2 时刷新 ⇒ 回 1/2（诊断变了不带旧游标）。
       只断「点完会跳」的话，游标恒为 0 的实现照样绿 —— 那正是 #1494 的旧行为。
       ★读徽标显示给用户的 title，不读内部变量、不注入状态；点击走真实鼠标。 */
    [
      `㊿y 徽标循环跳（决策 #1498）：${stepOf(dg.cycle?.initial)} → ${stepOf(dg.cycle?.after1)} → ${stepOf(
        dg.cycle?.after2,
      )} → ${stepOf(dg.cycle?.after3)} · 刷新后=${stepOf(dg.cycle?.refreshed)}`,
      stepOf(dg.cycle?.initial) === '第 1/2 条' &&
        stepOf(dg.cycle?.after1) === '第 2/2 条' &&
        stepOf(dg.cycle?.after2) === '第 1/2 条' &&
        stepOf(dg.cycle?.after3) === '第 2/2 条' &&
        stepOf(dg.cycle?.refreshed) === '第 1/2 条',
    ],
    /* ㊿o 面板级联模型（决策 #1482）——守的是用户三句话：
       "只能点箭头太固化" ⇒ 整行可点；
       "前面的面板不需要自动关闭" ⇒ 指针进子面板 700ms 后父面板仍在；
       "面板要紧挨触发入口" ⇒ 与父面板边缘的间距恒为 8px（误差 ≤1，浮点取整）。 */
    (() => {
      const gap =
        chain.panel && chain.card1
          ? chain.panel.side === 'left'
            ? chain.card1.left - chain.panel.right
            : chain.panel.left - chain.card1.right
          : NaN
      const gapOk = Number.isFinite(gap) && Math.abs(gap - 8) <= 1
      return [
        `㊿o 面板级联（决策 #1482）：整行可点=${chain.panel !== null && chain.panel !== undefined} · 父面板不关=${
          chain.cardKept
        } · 间距=${Number.isFinite(gap) ? Math.round(gap) : '?'}px · 关子后父仍在=${
          chain.cardAfterClose
        } · 移开双收=${chain.goneBoth}`,
        chain.panel != null &&
          chain.cardKept === true &&
          chain.panelKept === true &&
          gapOk &&
          chain.cardAfterClose === true &&
          chain.goneBoth === true,
      ]
    })(),
    /* ㊿q 触发入口保持激活（决策 #1484）——守用户这句"鼠标放到新面板上，上一个面板的
       悬停高亮就消失了"。指针在子面板上 700ms 后，卡片里那行必须仍是 active 态。
       ★只断"卡片还在"（㊿o②）不够：行变回普通样式时，卡片整个是还在的。 */
    [
      `㊿q 触发入口激活态（决策 #1484）：指针在子面板上时 入口行 active=${chain.rowActive}`,
      chain.rowActive === true,
    ],
    /* ㊿r 行高规范 + 箭头右对齐（决策 #1485）
       ★三条一起断：① 卡片各行等高（否则 hover 背景块忽高忽低）；
         ② chevron 贴右边缘（短名字时它不能挤在字后面）；
         ③ 面板行 = 标准档 24px（与文件树同一档）。
       只断①的话，箭头挤在内容后面照样能绿。 */
    (() => {
      const g = chain.geo
      const cardRows = new Set(g?.rows ?? [])
      const symRows = new Set(g?.sym ?? [])
      const chevGap = g && g.chevRight > 0 ? g.cardRight - g.chevRight : -1
      return [
        `㊿r 行高规范 + 箭头右对齐（决策 #1485）：卡片行高=${
          cardRows.size === 1 ? [...cardRows][0] : `不一致(${[...(g?.rows ?? [])].join('/')})`
        } · 面板行高=${symRows.size === 1 ? [...symRows][0] : '不一致'} · 箭头距右=${
          chevGap >= 0 ? chevGap : '?'
        }px`,
        cardRows.size === 1 &&
          [...cardRows][0] === 20 &&
          symRows.size === 1 &&
          [...symRows][0] === 24 &&
          chevGap >= 10 &&
          chevGap <= 16,
      ]
    })(),
    /* ㊿p 不得穿出可用区域（决策 #1483）——守用户这句"没考虑到被下面窗口遮挡"：
       窗口压到 420 高时，面板底边必须停在**状态栏上沿 8px 以内**，
       而且不能退化成高度 0（那样等于判据自己把内容藏了）。
       ★两条都断：只断底边的话，"高度 0" 也能过。 */
    [
      `㊿p 面板不穿底（决策 #1483）：420 高窗口下 底边=${fit?.bottom ?? '?'} / 状态栏上沿=${
        fit?.statusTop ?? '?'
      } · 高度=${fit?.height ?? '?'}px`,
      fit !== null &&
        fit !== undefined &&
        fit.bottom <= fit.statusTop - 8 + 1 &&
        fit.height >= 160,
    ],
  ]
}
