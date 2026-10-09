// packages/compiler/src/vapor/source-loc.ts
// ★★★模板源位置换算（决策 #712/#713）——**唯一实现**（events.ts 与 template.ts 共用）。
//
// 【要解决什么】`@vue/compiler-dom` 对模板内容做 `parse()` 时，节点/属性的 `loc`
//   是**模板内容相对**的 1 基行列（content 的第 1 行 = `<template>` 开标签之后的那一行）。
//   要对回**整份 `.vue` 文件**的行号，必须加上「模板内容起点之前的行数」——
//   前导注释、上方 `<script>` 等都会让这个偏移 ≠ 0（实测：带前导注释时差 1 行）。
//
// 【为什么单列一个模块】events.ts（事件 `loc`）与 template.ts（节点 `loc`）**必须同一口径**，
//   否则运行期错误串、面板徽章、Elements 树三处对不上（同一份源码两个行号）。
//   ★列**不做**文件级换算（保持"模板内容相对列"）——见 events.ts 的诚实边界。
import type { SFCDescriptor } from '@vue/compiler-sfc'

/** 一个源位置（1 基；`line` 为**整份 `.vue`** 行号，`column` 为**模板内容**相对列号） */
export interface SourceLoc {
  line: number
  column: number
}

/**
 * 计算「模板内容起始位置之前的行数」——把模板内容相对行换算成整份 `.vue` 行要加的量。
 *
 * @param source 完整 SFC 源码
 * @param descriptor `sfcParse(source)` 的 descriptor
 * @returns 行偏移（≥0）；拿不到 `template.loc.start.offset` 时退回"开标签所在行 - 1"的近似
 */
export function templateContentLineOffset(source: string, descriptor: SFCDescriptor): number {
  const tpl = descriptor.template as { content?: string; loc?: { start?: { line?: number; offset?: number } } } | undefined
  if (!tpl) return 0
  const body = tpl.content ?? ''
  const startOff = tpl.loc?.start?.offset
  if (typeof startOff === 'number') {
    const contentOff = source.indexOf(body, startOff)
    if (contentOff >= 0) return source.slice(0, contentOff).match(/\n/g)?.length ?? 0
  }
  // 兜底：模板开标签所在行 - 1（无 offset 时的近似）
  return Math.max(0, (tpl.loc?.start?.line ?? 1) - 1)
}

/**
 * 取某 AST 节点的 `loc.start` 并换算成整份 `.vue` 坐标（`line` 已含偏移、`column` 为模板内容相对）。
 *
 * @returns 拿不到合法 loc 时返回 `undefined`（**不编造**位置）
 */
export function sourceLocOf(
  loc: { start?: { line?: number; column?: number } } | undefined,
  lineOffset: number,
): SourceLoc | undefined {
  const s = loc?.start
  return s && typeof s.line === 'number' && typeof s.column === 'number'
    ? { line: s.line + lineOffset, column: s.column }
    : undefined
}
