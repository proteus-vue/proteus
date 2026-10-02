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
/** ★SFC 压力夹具探针（矩阵 #21；44 节点，与六端一致性报告同源）；
 *  视口为**逻辑 vp 尺寸**（夹具 device-independent，widthRatio 在排版时按视口解析） */
export const sfcStressProbe: (fixtureJson: string, vpW: number, vpH: number, density: number) => string;
/** ★SFC 压力夹具 → 渲染指令数组（上屏通路；density = vp2px(1)，几何/字号在该处转物理 px） */
export const sfcStressCommands: (fixtureJson: string, density: number, vpW: number, vpH: number) => string;
/** ★JSVM（V8）引擎探针（矩阵 #13/#14 前置）：init→VM→Env→Compile→Run→取值；默认脚本 6*7 */
export const jsvmProbe: (script?: string) => string;
/** ★★★Vapor 设备端链（矩阵 #14）：JSVM eval bundle-vapor.js → 设备端实例化 + 订阅驱动增量。
 *  argsJson = { bundle, artifacts, vpW, vpH, density, filesDir? }；返回包装报告（含 report 原文） */
export const vaporProbe: (argsJson: string) => string;
/** ★内核曲线采样（矩阵 #15 A1："贝塞尔来自内核"）——id 缺省 1 */
export const animCurveBezier: (curveId?: number) => string;
/** Rust 排版核版本（仪器自检） */
export const version: () => string;
