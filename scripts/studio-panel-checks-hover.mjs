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
  const { onApp, onMain, gone } = await probeFileHover(page)

  const appOk = onApp?.name === 'App.vue' && /371 行/.test(onApp?.text ?? '')
  const mainOk = onMain?.name === 'main.rs' && /997 行/.test(onMain?.text ?? '')

  return [
    [
      `㊿g 悬停属性预览（决策 #1474）：App.vue→${onApp?.name || '(无卡片)'}/${
        /371 行/.test(onApp?.text ?? '') ? '371 行' : '行数未命中'
      } · main.rs→${onMain?.name || '(无卡片)'}/${
        /997 行/.test(onMain?.text ?? '') ? '997 行' : '行数未命中'
      } · 移开即消失=${gone === null}`,
      appOk && mainOk && gone === null,
    ],
  ]
}
