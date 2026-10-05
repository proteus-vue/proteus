// packages/compiler/src/cse/align.ts
// ★★★G-61 后批（2026-10-05）：**CSE ⇄ 旧折叠通路的树对齐**（切换/对账的公共机制 · 唯一实现）
//
// 【为什么单独成模块（"一处实现"纪律）】两处需要同一件东西：
//   · `scripts/check-app-ir-shadow.mjs`（对账装置——产出切换决策数据）
//   · `packages/compiler/src/cse/overlay.ts`（切换执行——把 IR 值写回旧产物）
//   若各写一份，会出现"对账说能对齐、切换却对不齐"的漂移（本仓已为"两处闭集漂移"付过代价）。
//
// 【★两棵树的差异（本仓实测，别假设结构相同）】
//   ① 旧通路**做平台转换**：混合文本拆出合成 `p-text` 叶（`text-runs.ts` 既定行为）⇒ 旧树更"多叶"
//   ② 旧通路可带 **statics**（构建期静态实例化：v-if 折叠 / v-for 展开 / :class 折入）⇒ 旧树更"少节点"
//      （实测 superapp/messages：无 statics 17 节点，有 statics 42 节点——**展开**）
//   ⇒ 对齐必须在**同一 statics 口径**下比对（调用方保证：给 extract 传与旧通路相同的 statics）。
//   ⇒ 对齐算法：双指针同步走子树，旧侧合成叶（`p-text`）跳过；tag 命中才配对；容错窗口 3；余数如实计数。

/** 对齐用的最小节点形态（两树各自可映射到此） */
export interface AlignNode {
  /** 旧侧：node.id；CSE 侧：key */
  id: number | string
  tag: string
  children: AlignNode[]
}

export interface AlignResult {
  /** 成功配对的节点对（旧 ↔ CSE；递归序） */
  pairs: Array<{ old: AlignNode; cse: AlignNode }>
  /** 未能配对的节点数（旧侧合成叶除外——它们**不算未对齐**，是"不参与比对的合成节点"） */
  unaligned: number
  /** 对齐失败原因（根级不符 / 无法起配 ⇒ 调用方应**整体拒绝**而非部分错配） */
  reason?: string
}

/** 旧侧合成叶标记（不参与配对——见头注①） */
const SYNTHETIC_TAG = 'p-text'

/** 双指针配对两段子节点序列；返回配对下标对 + 跳过计数 */
function alignChildren(oldKids: AlignNode[], cseKids: AlignNode[]): { pairs: Array<[number, number]>; skippedOld: number; skippedCse: number; unaligned: number } {
  const pairs: Array<[number, number]> = []
  let skippedOld = 0
  let skippedCse = 0
  let unaligned = 0
  let i = 0
  let j = 0
  while (i < oldKids.length && j < cseKids.length) {
    const o = oldKids[i]!
    const c = cseKids[j]!
    if (o.tag === c.tag) {
      pairs.push([i, j])
      i++
      j++
      continue
    }
    if (o.tag === SYNTHETIC_TAG && c.tag !== SYNTHETIC_TAG) {
      i++
      skippedOld++
      continue
    }
    if (c.tag === SYNTHETIC_TAG && o.tag !== SYNTHETIC_TAG) {
      j++
      skippedCse++
      continue
    }
    // 其余错位：向前最多 3 个内找可对齐者（容错）；找不到 ⇒ 各自跳过并计数
    let matched = false
    for (let look = 1; look <= 3 && !matched; look++) {
      if (oldKids[i + look]?.tag === c.tag) {
        unaligned += look
        i += look
        pairs.push([i, j])
        i++
        j++
        matched = true
      } else if (cseKids[j + look]?.tag === o.tag) {
        unaligned += look
        j += look
        pairs.push([i, j])
        i++
        j++
        matched = true
      }
    }
    if (!matched) {
      unaligned += 2
      i++
      j++
    }
  }
  unaligned += oldKids.length - i + (cseKids.length - j)
  return { pairs, skippedOld, skippedCse, unaligned }
}

function collectPairs(oldNode: AlignNode, cseNode: AlignNode, out: AlignResult): void {
  out.pairs.push({ old: oldNode, cse: cseNode })
  const oldKids = oldNode.children
  const cseKids = cseNode.children
  const r = alignChildren(oldKids, cseKids)
  out.unaligned += r.unaligned
  for (const [oi, ci] of r.pairs) collectPairs(oldKids[oi]!, cseKids[ci]!, out)
}

/**
 * 对齐两棵树（根级 + 递归子树）。
 * ★根级不符（tag 不同）⇒ 返回 reason（调用方应**整体拒绝**：错配比不切更危险）。
 */
export function alignTrees(oldRoots: AlignNode[], cseRoots: AlignNode[]): AlignResult {
  const out: AlignResult = { pairs: [], unaligned: 0 }
  const skipOld = (n: AlignNode): boolean => n.tag === SYNTHETIC_TAG
  const rootsOld = oldRoots.filter((r) => !skipOld(r))
  const rootsCse = cseRoots.filter((r) => !skipOld(r))
  if (rootsOld.length === 0 || rootsCse.length === 0) {
    return { pairs: [], unaligned: 0, reason: `根为空（旧 ${rootsOld.length} / CSE ${rootsCse.length}）` }
  }
  if (rootsOld.length !== rootsCse.length) {
    return { pairs: [], unaligned: 0, reason: `根数不一致（旧 ${rootsOld.length} vs CSE ${rootsCse.length}）——两树不同源（statics/平台转换口径不同？）` }
  }
  for (let k = 0; k < rootsOld.length; k++) {
    if (rootsOld[k]!.tag !== rootsCse[k]!.tag) {
      return { pairs: [], unaligned: 0, reason: `第 ${k} 根 tag 不符（旧 \`${rootsOld[k]!.tag}\` vs CSE \`${rootsCse[k]!.tag}\`）` }
    }
  }
  for (let k = 0; k < rootsOld.length; k++) collectPairs(rootsOld[k]!, rootsCse[k]!, out)
  return out
}
