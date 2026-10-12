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
/** ★★★决策 #842：切换内容渲染模式：`"render-node"`（缺省，RenderNode 属性树）/ `"self-draw"`
 *  （进程内自绘位图 ⇒ 玻璃可与内容同帧）。返回 0。 */
export const setContentMode: (mode: string) => number;
/** ★矩阵 #5：平移根 RenderNode（yDesign 设计单位）——Proteus 渲染路径的滚动；返回错误码（0=OK） */
export const scrollRoot: (yDesign: number) => number;
/** ★矩阵 #7：在根节点装真触摸接收器（uitest uiInput 注入 → touch-samples.jsonl + PROTEUS_TOUCH）；
 *  filesDir = 样本落盘目录（ArkTS filesDir——el2 映射路径 hdc 可读）；返回 {ok,rc_*} */
export const gestureInstall: (filesDir: string) => string;
/** ★矩阵 #7：追加一行触摸样本（JSONL）→ <filesDir>/touch-samples.jsonl；返回累计行号（-1=未设目录） */
export const gestureSample: (lineJson: string) => number;
/** ★★★决策 #840/#841：节点快照能力探针 —— 对节点调 OH_ArkUI_GetNodeSnapshot，
 *  返回 JSON（rc/ms/w/h/pxfmt/read_rc/sample_*），证实"能否捕获已渲染像素"（玻璃背景捕获来源）。
 *  target：0=自绘 customNode（缺省）/ 1=外层 Stack / 2=两者都试。在 glass 场景建树后调用。 */
export const snapshotProbe: (target?: number) => string;
/** ★★★决策 #841：离屏 Vulkan 玻璃 pass 探针 —— 用合成背景跑生成物 SPIR-V，读回像素并报告
 *  （ok/ms/info/nonzero/distinct/avg_rgb），证实"鸿蒙 GPU 能跑同一份 WGSL 落地的 SPIR-V"。
 *  filesDir（可选）：给了就把完整 RGBA 落 <filesDir>/vkglass-gpu.json，供像素等价门禁 compare。 */
export const vkGlassProbe: (filesDir?: string) => string;
/** ★★★决策 #841：玻璃 GPU pass 集成 —— 内容快照 → 裁剪每玻璃节点外扩区域 → 离屏 Vulkan（SPIR-V）
 *   → 覆盖节点背景图（真边缘折射）。返回 JSON（ok/nodes/snap_w/snap_h）。应在**建树后等一帧**再调。 */
export const glassPass: () => string;
/** ★★★决策 #847：自绘玻璃性能基线读数（`{"frames","avg_ms","max_ms","p50_ms","p95_ms","fps"}`）。
 *  传 `"reset"` 归零。 */
export const glassStats: (mode?: string) => string;
