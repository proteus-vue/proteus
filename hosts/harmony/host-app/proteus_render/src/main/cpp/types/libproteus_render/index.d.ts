// entry/src/main/cpp/types/libproteus_render/index.d.ts
// Proteus 鸿蒙原生渲染模块 —— ArkTS 侧类型声明（与 proteus_render.cpp 的 Init 一一对应）
//
// ★ArkTS 严格模式（arkts-no-any-unknown）：所有类型必须显式——本文件是唯一事实来源。
export interface ProteusRenderStats {
  nodes: number;
}
/** 把 NodeContent 句柄交给原生模块（挂载点）；返回 0 成功 / 负错误码 */
export const attach: (content: object, density: number, screenWvp: number, screenHvp: number) => number;
/** 消费 Proteus 指令流（RenderCmd 同形 JSON）；返回实际建出的渲染节点数 */
export const renderCommands: (json: string) => number;
/** ★★★"跳变驱动动画"（本批）：把内核逐帧视觉（`anim_tick` 回执的 `updates` 数组原文）写到
 *  RenderNode（SetTransform 平移+缩放 / SetScale / SetOpacity；tx/ty 为设计单位，内部 ×density）；
 *  返回 `{ok,applied,nodes}`——applied = 实际写了几个节点（判据证明"真的落到了渲染层"） */
export const applyNodeVisuals: (updatesJson: string) => string;
/** ★★★Dactyl 专项（按下态）：把 `:active` 折出的 press* 字段直写 RenderNode
 *  （底色/描边/缩放/发光；入参 `{"<id>":{...}}`；传空对象 `{}` 为该节点 ⇒ 还原为建树静态值）。
 *  返回 `{ok,applied}`；**同帧生效**（O(1) 属性直写，不重建整棵指令流）。 */
export const applyPressVisual: (json: string) => string;
/** 宿主记账读数（机器判据读它） */
export const stats: () => ProteusRenderStats;
/** ★矩阵 #15：平台零参与动画——记基线 + 取目标节点（根的第一个子节点）；返回 {ok, on_draw_count} */
export const platformAnimBegin: () => string;
/** ★一步变换（tx 设计单位 / scale / alpha）→ 写属性 + 读回；返回 JSON（含 on_draw_count） */
export const platformAnimStep: (json: string) => string;
/** ★窗口结算：{ok, draw_delta, measure_delta, layout_delta, on_draw_count}（三个增量应全 0） */
export const platformAnimEnd: () => string;
/** ★报告落盘（content, path）；返回 0 成功 */
export const platformAnimSave: (content: string, path: string) => number;
/** ★矩阵 #5：清空根子节点（重建内容前调用）；返回剩余子节点数（0=已清空） */
export const clearRoot: () => number;
/** ★矩阵 #5：平移根 RenderNode（yDesign 设计单位）——Proteus 渲染路径的滚动；返回错误码（0=OK） */
export const scrollRoot: (yDesign: number) => number;
/** ★矩阵 #7：在根节点装真触摸接收器（uitest uiInput 注入 → touch-samples.jsonl + PROTEUS_TOUCH）；
 *  filesDir = 样本落盘目录（ArkTS filesDir——el2 映射路径 hdc 可读）；返回 {ok,rc_*} */
export const gestureInstall: (filesDir: string) => string;
/** ★矩阵 #7：追加一行触摸样本（JSONL）→ <filesDir>/touch-samples.jsonl；返回累计行号（-1=未设目录） */
export const gestureSample: (lineJson: string) => number;
