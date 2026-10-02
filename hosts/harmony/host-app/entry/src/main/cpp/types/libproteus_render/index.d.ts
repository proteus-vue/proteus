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
