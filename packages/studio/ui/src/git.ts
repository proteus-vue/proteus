// ui/src/git.ts —— Git **只读**状态（决策 #1246 引入，#1247 从 CodePanel.vue 拆出）
//
// 【边界】只调 `git_status`（`status --porcelain=v2 --branch`）。这里**永远**不出现
//   stage / commit / checkout / push —— 本仓纪律是 push 必须人工批准，
//   工具在这一层就不该有那个能力（决策 #1246）。
//
// 【为什么抽成模块】Git 条（`GitBar.vue`）要用它渲染，编辑器（保存后）要刷新它。
//   状态留在一个模块里 = 一处真源；否则两个组件各存一份必然漂移。

import { ref } from 'vue'
import { gitStatus, hasBridge, type GitStatusInfo } from './bridge'

export const git = ref<GitStatusInfo | null>(null)
/** 改动清单是否展开（UI 状态，不落盘：重启后回到"收起"，不挡文件树） */
export const gitOpen = ref(false)

/** 拉一次状态。非仓库 / 没装 git / 无桥 一律降级为 null，**不抛错**
 *  （读代码不该被 git 拖下水 —— 决策 #1246）。 */
export async function refreshGit(): Promise<void> {
  if (!hasBridge()) return
  try {
    git.value = await gitStatus()
  } catch {
    git.value = null
  }
}
