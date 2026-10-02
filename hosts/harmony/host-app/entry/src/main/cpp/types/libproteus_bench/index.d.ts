// entry/src/main/cpp/types/libproteus_bench/index.d.ts
// Proteus 鸿蒙基准模块 —— ArkTS 侧类型声明
/** 4050 元素应用级基准；返回 JSON 串 */
export const bench4050: (fixtureJson: string, viewportW: number, viewportH: number, depthLimit: number) => string;
/** ★命中测试探针（与 Android/iOS 同场景同探针点；逐位一致性判据） */
export const hitProbe: () => string;
/** ★长列表复用池探针（Rust 核决策 + 宿主真执行 RenderNode 复用） */
export const recycleProbe: (rows: number, frames: number) => string;
/** ★结构变更探针（splice；与 Android 同一棵树同一 payload） */
export const spliceProbe: () => string;
/** ★文本通道探针（ArkGraphics2D typography） */
export const textProbe: () => string;
/** ★内核动画探针（矩阵 #16；anim_seek + updates 读数） */
export const kernelAnimProbe: () => string;
/** ★内存探针（三段式：tree/nodes/release；ArkTS 在阶段间读 PSS） */
export const memProbe: (phase: string, fixtureJson?: string) => string;
/** Rust 排版核版本（仪器自检） */
export const version: () => string;
