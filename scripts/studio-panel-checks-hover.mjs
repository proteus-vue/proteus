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
  probeFileHover,
  probePopoverChain,
  probePopoverFit,
  probeSymbolPanel,
} from './studio-panel-probes.mjs'

export async function checksHover(page) {
  const { onApp, onMain, onProj, onOwner, onBig, onTs, onCard, peekWhileCard, gone, peekAfterGone } =
    await probeFileHover(page)
  const sym = await probeSymbolPanel(page)
  const chain = await probePopoverChain(page)
  const fit = await probePopoverFit(page)

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
