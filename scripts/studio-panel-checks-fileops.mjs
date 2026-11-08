// scripts/studio-panel-checks-fileops.mjs —— 判据 ㊾ 的**采集 + 断言**（决策 #1460）
//
// 【为什么抽出来】`check-studio-panel.mjs` 原本 997 行，已贴 1000 行硬上限；把判据直接内联
//   会当场把门禁自身撑红（实测 1019 行 ⇒ check:file-size 报「新增大文件」）。
//   ⇒ 采集在 `studio-panel-probes-fileops.mjs`，断言在这里，主文件只留一句 spread。
//
// 【调用时机由主文件决定，不在这里假装有】必须在其它探针之后、`__BIG__` reload 与
//   `closeAll()` 之前：早跑会污染标签数/toast 栈，晚跑页面已关或树里只剩 big.ts。
import { probeFileOps } from './studio-panel-probes-fileops.mjs'

/** @returns {Promise<Array<[string, boolean]>>} 一条判据（文案 + 布尔） */
export async function checksFileOps(page) {
  const f = await probeFileOps(page)
  const hasOps = ['createFile', 'createDir', 'rename', 'delete'].every((x) => f.ids.includes(x))
  return [
    [
      `㊾ 文件树写操作（决策 #1460）：菜单含 4 动作=${hasOps} · create_file→${f.createPath} · 刷树后出现=${f.treeHasNew} · 删除取消后 delete_path=${f.deleteCalls} · 已打开标签保护=${f.guardToast}/${f.guardCalls}`,
      hasOps &&
        ['copyPath', 'refresh'].every((x) => f.ids.includes(x)) &&
        f.boxShown &&
        f.createCallCount === 1 &&
        f.createPath === f.newPath &&
        f.treeHasNew &&
        f.createdToast &&
        f.dialogShown &&
        f.deleteCalls === 0 &&
        !!f.opened &&
        f.guardToast &&
        f.guardCalls === 0,
    ],
  ]
}
