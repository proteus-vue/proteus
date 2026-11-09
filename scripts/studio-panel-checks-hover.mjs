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
import { probeFileHover } from './studio-panel-probes.mjs'

export async function checksHover(page) {
  const { onApp, onMain, onProj, onOwner, gone } = await probeFileHover(page)

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
  ]
}
