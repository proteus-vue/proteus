// entry/src/main/cpp/types/libproteus_bench/index.d.ts
// Proteus 鸿蒙 4050 基准 + 命中探针模块 —— ArkTS 侧类型声明
/** 4050 元素应用级基准；返回 JSON 串 */
export const bench4050: (fixtureJson: string, viewportW: number, viewportH: number, depthLimit: number) => string;
/** ★命中测试探针（与 Android/iOS 同场景同探针点；逐位一致性判据） */
export const hitProbe: () => string;
/** Rust 排版核版本（仪器自检） */
export const version: () => string;
