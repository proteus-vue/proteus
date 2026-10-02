// entry/src/main/cpp/types/libproteus_bench/index.d.ts
// Proteus 鸿蒙 4050 基准模块 —— ArkTS 侧类型声明
/** 4050 元素应用级基准；返回 JSON 串（字段见 proteus_bench.cpp 的 note） */
export const bench4050: (fixtureJson: string, viewportW: number, viewportH: number, depthLimit: number) => string;
/** Rust 排版核版本（仪器自检） */
export const version: () => string;
