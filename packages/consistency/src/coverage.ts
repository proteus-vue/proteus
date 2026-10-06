// packages/consistency/src/coverage.ts
// ★★★G-61 B3（2026-10-05）：**数值等价覆盖表**（每个 IR `semantic` 字段 ↔ 快照读数键）
//
// 【它是什么（plan §4.3 B3 要求的机器可读形态）】「**每个 IR `semantic` 字段**都有对应 snapshot
//   读数与**相对 Web 基准的**比对用例 ⇒ 分母全覆盖」——本文件把"对应关系"写成**单一事实源**：
//   · 门禁 `scripts/check-style-coverage.mjs`：断言这份映射**覆盖注册表全部 semantic 字段**、
//     且所有映射到的键都在 `snapshot.ts` 的 `STYLE_KEYS` 闭集内（三处同改，防"两套闭集漂移"）
//   · 指标 `scripts/gen-consistency-metrics.mjs`：L3（样式比对层）覆盖数**由本表推导**（不手写清单）
//
// 【诚实纪律（"数字不粉饰"）】本表声明的是"**有读数接线**"，不是"视觉已一致"——
//   字段级的**值**是否一致由比对引擎（判据②）判，光栅化差异归判据③（非门禁）。
//   App/Skyline 侧对某字段**无能力**时（如 Skyline 无 Grid）由 Applier 记 `unsupported`
//   （`appliers/*.ts`），不算"已覆盖"——那是**如实降级**，与"没接线"是两回事。

/**
 * IR `semantic` 字段 → 快照读数键（`NormalizedStyle` 的键）。
 * ★键集必须与 `snapshot.ts` 的 `STYLE_KEYS` 闭集**逐项一致**（门禁断言）。
 */
export const SEMANTIC_FIELD_SNAPSHOT_KEYS: Readonly<Record<string, readonly string[]>> = {
  /* ── 盒模型（geometry 侧也覆盖 width/height——L2 几何层的 2 项） ── */
  width: ['width'],
  height: ['height'],
  minWidth: ['minWidth'],
  maxWidth: ['maxWidth'],
  minHeight: ['minHeight'],
  maxHeight: ['maxHeight'],
  margin: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
  padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  /* ── 流式布局 ── */
  display: ['display'],
  position: ['position'],
  top: ['top'],
  left: ['left'],
  right: ['right'],
  bottom: ['bottom'],
  overflow: ['overflow'],
  // ★★★overflow-x 项（2026-10-06）：逐轴溢出进 semantic——读数键 = Web 计算值（含 visible→auto 归一）
  overflowX: ['overflowX'],
  overflowY: ['overflowY'],
  aspectRatio: ['aspectRatio'],
  pointerEvents: ['pointerEvents'],
  /* ── flex ── */
  flexDirection: ['flexDirection'],
  flexWrap: ['flexWrap'],
  justifyContent: ['justifyContent'],
  alignItems: ['alignItems'],
  alignContent: ['alignContent'],
  alignSelf: ['alignSelf'],
  flexGrow: ['flexGrow'],
  flexShrink: ['flexShrink'],
  flexBasis: ['flexBasis'],
  gap: ['gap'],
  rowGap: ['rowGap'],
  columnGap: ['columnGap'],
  /* ── grid ── */
  gridTemplateColumns: ['gridTemplateColumns'],
  gridTemplateRows: ['gridTemplateRows'],
  gridColumn: ['gridColumn'],
  gridRow: ['gridRow'],
  // ★★★justify-self 项（2026-10-06）：网格项行内轴自对齐（读数键 = 同名字符串）
  justifySelf: ['justifySelf'],
  /* ── 绘制 ── */
  backgroundColor: ['backgroundColor'],
  color: ['color'],
  borderRadius: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
  borderWidth: ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'],

  // ★★★逐边 border 批（2026-10-05）：逐边字段各自独立读数（读数键复用 STYLE_KEYS 里既有的四边键）
  borderTopWidth: ['borderTopWidth'],
  borderRightWidth: ['borderRightWidth'],
  borderBottomWidth: ['borderBottomWidth'],
  borderLeftWidth: ['borderLeftWidth'],
  borderTopColor: ['borderTopColor'],
  borderRightColor: ['borderRightColor'],
  borderBottomColor: ['borderBottomColor'],
  borderLeftColor: ['borderLeftColor'],  borderColor: ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'],
  // ★★★边框族收口批（2026-10-05）：逐边线型进 semantic——读数键为同名字符串（'solid'/'dashed'/'dotted'）
  borderTopStyle: ['borderTopStyle'],
  borderRightStyle: ['borderRightStyle'],
  borderBottomStyle: ['borderBottomStyle'],
  borderLeftStyle: ['borderLeftStyle'],
  opacity: ['opacity'],
  boxShadow: ['boxShadow'],
  transform: ['transform'],
  /* ── 文本 ── */
  fontSize: ['fontSize'],
  fontWeight: ['fontWeight'],
  fontFamily: ['fontFamily'],
  lineHeight: ['lineHeight'],
  textAlign: ['textAlign'],
  textOverflow: ['textOverflow'],
  letterSpacing: ['letterSpacing'],
  textDecoration: ['textDecoration'],
  /* ── 其余 ── */
  visibility: ['visibility'],
  // ★★补齐（2026-10-05 · check:style-coverage 抓出的上一轮债务）：whiteSpace 进 semantic 后缺快照读数
  whiteSpace: ['whiteSpace'],
}

/** 反向索引：快照读数键 → IR 字段（一个键只属一个字段——多对一由表保证） */
export const SNAPSHOT_KEY_TO_SEMANTIC_FIELD: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {}
  for (const [field, keys] of Object.entries(SEMANTIC_FIELD_SNAPSHOT_KEYS)) {
    for (const k of keys) out[k] = field
  }
  return out
})()
