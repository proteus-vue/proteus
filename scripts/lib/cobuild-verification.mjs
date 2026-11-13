// scripts/lib/cobuild-verification.mjs —— verification / verified_by 的合并判据（唯一实现）
//
// 为什么单列（2026-11-13，外部 F-46 报告）：
//   原判据内联在 sync-cobuild.mjs 里，把「外部结论」白名单写死成 `passed | failed`——
//   而 `partial` 是规范 §3 明列的**合法结论**（外部对「需真机才能验的部分」的诚实标注）。
//   后果：F-42/F-43 外部填 partial、框架填 unverified ⇒ 被判成**冲突**，要人工裁决。
//   这不是数据问题，是**判据把规范的合法值当成了非法值**。
//
//   抽成纯函数后，tests 可以**真跑**断言（而不是 toContain 查源码字符串——
//   那种断言正是这个缺陷长期存在而门禁全绿的原因）。

/**
 * 合并一个条目的 verification / verified_by。
 *
 * 判据（按「谁的字段 + 谁的结论更权威」，不按「值是否在白名单里」）：
 *   ① `verification` / `verified_by` 属**外部优先** ⇒ 外部给了值就采纳，
 *      含 partial / failed / unverified / n_a 全部合法值；
 *   ② **唯一保留为冲突**：框架已 `passed`（框架确信验过），而外部给了
 *      `passed` / `unverified` 之外的明确相反结论（`failed` / `partial`）
 *      —— 双方结论直接矛盾，交人裁决（覆盖解决不了）；
 *   ③ 框架 `passed` + 外部 `unverified` ⇒ 不是矛盾，是外部还没验新版 ⇒ 采纳并标记 note。
 *
 * @param {{verification?: string, verified_by?: string}} mine  框架侧现值
 * @param {{verification?: string, verified_by?: string}} ext   外部侧值
 * @returns {{value: string|undefined, by: string|undefined, conflict: boolean, note?: string}}
 */
export function mergeVerification (mine, ext) {
  const mineVer = mine?.verification
  const extVer = ext?.verification
  const mineBy = mine?.verified_by
  const extBy = ext?.verified_by

  // ② 真矛盾：框架 passed vs 外部明确相反
  const contradictory =
    mineVer === 'passed' &&
    extVer !== undefined &&
    extVer !== 'passed' &&
    extVer !== 'unverified'

  if (contradictory) {
    return { value: mineVer, by: mineBy, conflict: true }
  }

  // ① 外部优先（未给值则保留框架侧）
  const value = extVer !== undefined ? extVer : mineVer
  const by = extBy !== undefined ? extBy : mineBy
  // ③ 框架已 passed、外部尚未复测新版 → 不是矛盾，但记一条 note 便于追溯
  const note =
    mineVer === 'passed' && extVer === 'unverified'
      ? '外部 verification=unverified（尚未复测新版），框架已=passed'
      : undefined
  return { value, by, conflict: false, note }
}

/**
 * 该字段是否属于「外部优先」通道（sync-cobuild 用它决定走本模块还是走通用合并）。
 */
export function isExternalPriorityField (field) {
  return field === 'verification' || field === 'verified_by'
}
